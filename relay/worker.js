/* mnzr service worker: realtime relay + Google sign-in / cloud saves.
   Rooms: one Durable Object per room name. Each player holds one WebSocket to its room.
   The room keeps every peer's latest presence and forwards emits to the other peers; it has no game logic.
   Wire format (JSON text frames):
      client -> relay  {k:'p', p:{...}}            replace my presence
                       {k:'e', t:'state', d:{...}}  emit on a topic
      relay -> client  {k:'hi', you, peers:[{peer,p}]}   sent once on connect
                       {k:'p', peer, p}                  a peer's presence changed (or it joined)
                       {k:'x', peer}                     a peer left
                       {k:'e', t, peer, d}               an emit from another peer
   Accounts: /auth/google starts a PKCE flow, /auth/callback finishes it and redirects to the game with a
   bearer token in the URL fragment. /auth/me, /auth/logout and /api/save use that token. PUT /api/save with `base`
   (the `at` the client last saw) is refused with 409 if another device saved since. Saves are opaque
   JSON snapshots keyed by Google `sub`; the worker never reads or validates game progression. */
const MAX_MSG = 4096 + 64;          /* the game keeps payloads under 4 KiB, same as the claude.ai room */
const MAX_PEERS = 16;
const RATE = 60;                    /* frames a second per socket before the relay starts dropping */
/* Only the game's own pages. Vercel previews are limited to this project's deployments (mnzr-<hash>-c0nques7s-projects,
   mnzr-git-<branch>-c0nques7s-projects): any *.vercel.app would let anyone's Vercel site receive a player's sign-in token. */
const ORIGINS = [/^https:\/\/(www\.)?mnzr\.lol$/, /^https:\/\/mnzr(-[a-z0-9-]+)?-c0nques7s-projects\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const NAME = /^[a-z0-9-]{1,64}$/;
const PEER = /^[a-z0-9]{4,24}$/;
const SESSION_TTL = 30 * 86400;     /* 30 days, refreshed by signing in again */
const OAUTH_TTL = 600;              /* state/challenge records expire in 10 minutes */
const MAX_SAVE = 512 * 1024;        /* a progression snapshot should be a few KB */
/* Accounts that see the developer tools (Sandbox, Unlock everything) on mnzr.lol: SHA-256 of the lowercased
   Google email, so the address itself is not in the public repo. A DEV_EMAILS var/secret (comma separated) adds more. */
const DEV_HASHES = ['f39a817aa29567b9439707ecfd40db8ad2555ff8faf1963876b0945e7e5fc0a0'];
async function isDev(env, s) {
  const email = String(s.email || '').trim().toLowerCase();
  if (!email || s.ev === false) return false;
  if (String(env.DEV_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).includes(email)) return true;
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return DEV_HASHES.includes(h);
}

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const originOK = o => ORIGINS.some(r => r.test(o || ''));
function headers(req, extra) {
  const o = req.headers.get('Origin') || '';
  return Object.assign({
    'access-control-allow-origin': originOK(o) ? o : 'null',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    vary: 'Origin'
  }, extra || {});
}
const json = (req, body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: headers(req, { 'content-type': 'application/json' }) });
const fail = (req, msg, status) => json(req, { error: msg }, status || 400);

function configured(env, req) {
  if (!env.SESSIONS || !env.SAVES || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return fail(req, 'cloud saves are not configured on this worker', 503);
  return null;
}
async function session(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const raw = await env.SESSIONS.get('s:' + m[1]);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!(s.exp > Date.now())) { await env.SESSIONS.delete('s:' + m[1]); return null; }
    return { bearer: m[1], sub: s.sub, email: s.email, name: s.name, pic: s.pic, ev: s.ev };
  } catch (e) { return null; }
}

/* Google OAuth 2.0 with PKCE. This confidential client generates the verifier and keeps it in KV with the
   random state; Google only ever sees the SHA-256 challenge. The state is deleted on first use. */
async function accounts(req, env, url) {
  const p = url.pathname, method = req.method;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req, { 'access-control-max-age': '86400' }) });
  const notReady = configured(env, req);
  if (notReady) return notReady;

  if (p === '/auth/google' && method === 'GET') {
    const app = url.searchParams.get('app') || env.APP_ORIGIN || '';
    const state = url.searchParams.get('state') || '';
    if (!originOK(app)) return fail(req, 'app origin not allowed', 403);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return fail(req, 'bad oauth request');
    const verifier = token(32);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = b64u(digest);
    await env.SESSIONS.put('o:' + state, JSON.stringify({ app: app.replace(/\/$/, ''), verifier, at: Date.now() }), { expirationTtl: OAUTH_TTL });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: url.origin + '/auth/callback',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      prompt: 'select_account'
    });
    return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString() } });
  }

  if (p === '/auth/callback' && method === 'GET') {
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    const raw = state && await env.SESSIONS.get('o:' + state);
    if (!raw) return fail(req, 'unknown or expired sign-in', 400);
    const o = JSON.parse(raw);
    await env.SESSIONS.delete('o:' + state);
    if (!code) return fail(req, 'sign-in was cancelled', 400);
    try {
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code',
          code_verifier: o.verifier
        }).toString()
      });
      if (!tr.ok) return fail(req, 'Google rejected the sign-in code', 502);
      const tok = await tr.json();
      const ir = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok.id_token || ''));
      if (!ir.ok) return fail(req, 'Google identity check failed', 502);
      const info = await ir.json();
      if (info.aud !== env.GOOGLE_CLIENT_ID || !/^https:\/\/accounts\.google\.com$/.test(info.iss || '')) return fail(req, 'wrong token audience', 401);
      if (!info.sub) return fail(req, 'no Google account in token', 401);
      const bearer = token(32);
      const profile = {
        sub: info.sub, email: info.email || '', ev: info.email_verified === true || info.email_verified === 'true',
        name: info.name || info.email || 'Player',
        pic: info.picture || '', iat: Date.now(), exp: Date.now() + SESSION_TTL * 1000
      };
      await env.SESSIONS.put('s:' + bearer, JSON.stringify(profile), { expirationTtl: SESSION_TTL });
      return new Response(null, { status: 302, headers: { location: o.app + '/#auth=' + bearer + '&state=' + encodeURIComponent(state) } });
    } catch (e) { return fail(req, 'sign-in failed: ' + (e && e.message || 'unknown'), 502); }
  }

  const s = await session(req, env);
  if (!s) return fail(req, 'sign in required', 401);

  if (p === '/auth/me' && method === 'GET')
    return json(req, { sub: s.sub, email: s.email, name: s.name, pic: s.pic, dev: await isDev(env, s) });
  if (p === '/auth/logout' && method === 'POST') {
    await env.SESSIONS.delete('s:' + s.bearer);
    return json(req, { ok: true });
  }
  if (p === '/api/save' && method === 'GET') {
    const raw = await env.SAVES.get('u:' + s.sub);
    return json(req, raw ? JSON.parse(raw) : { v: 1, at: null, save: null });
  }
  if (p === '/api/save' && method === 'PUT') {
    let body;
    try { body = await req.json(); } catch (e) { return fail(req, 'bad json'); }
    if (!body || body.v !== 1 || !body.save || typeof body.save !== 'object' || Array.isArray(body.save))
      return fail(req, 'bad save');
    if (JSON.stringify(body.save).length > MAX_SAVE) return fail(req, 'save too large', 413);
    /* optimistic concurrency: a client sends base = the `at` of the cloud save it last saw (null if it saw none).
       If another device uploaded since, refuse with 409 and the current save so the client can ask which to keep. */
    if ('base' in body) {
      const raw = await env.SAVES.get('u:' + s.sub), cur = raw ? JSON.parse(raw) : null, curAt = cur && cur.at || null;
      if (curAt !== (body.base || null)) return json(req, { error: 'cloud save changed on another device', conflict: true, at: curAt, save: cur && cur.save || null }, 409);
    }
    const out = { v: 1, at: new Date().toISOString(), save: body.save };
    await env.SAVES.put('u:' + s.sub, JSON.stringify(out));
    return json(req, { ok: true, at: out.at });
  }
  return fail(req, 'not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('mnzr relay ok\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) return accounts(req, env, url);
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response('not found', { status: 404 });
    const origin = req.headers.get('Origin') || '';
    if (!ORIGINS.some(r => r.test(origin))) return new Response('origin not allowed', { status: 403 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const name = decodeURIComponent(m[1]).toLowerCase();
    const peer = url.searchParams.get('peer') || '';
    if (!NAME.test(name) || !PEER.test(peer)) return new Response('bad room or peer', { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
    return stub.fetch(req);
  }
};

export class Room {
  constructor(state) { this.state = state; this.rate = new Map(); }

  async fetch(req) {
    const peer = new URL(req.url).searchParams.get('peer');
    const live = this.state.getWebSockets();
    /* the same peer reconnecting replaces its old socket and keeps its presence */
    let presence = {};
    for (const ws of live) { const a = ws.deserializeAttachment(); if (a && a.peer === peer) { presence = a.p || {}; a.gone = 1; ws.serializeAttachment(a); try { ws.close(4000, 'replaced'); } catch (e) {} } }
    if (live.filter(ws => { const a = ws.deserializeAttachment(); return a && !a.gone; }).length >= MAX_PEERS) return new Response('room full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ peer, p: presence });
    const peers = [];
    for (const ws of this.state.getWebSockets()) { if (ws === server) continue; const a = ws.deserializeAttachment(); if (a && !a.gone) peers.push({ peer: a.peer, p: a.p || {} }); }
    server.send(JSON.stringify({ k: 'hi', you: peer, peers }));
    this.broadcast({ k: 'p', peer, p: presence }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, except) {
    const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) { if (ws === except) continue; const a = ws.deserializeAttachment(); if (!a || a.gone) continue; try { ws.send(s); } catch (e) {} }
  }

  allow(ws) {
    const now = Date.now(); let r = this.rate.get(ws);
    if (!r || now - r.t >= 1000) { r = { t: now, n: 0 }; this.rate.set(ws, r); }
    return ++r.n <= RATE;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    if (!this.allow(ws)) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const a = ws.deserializeAttachment(); if (!a || a.gone) return;
    if (m.k === 'p' && m.p && typeof m.p === 'object') { a.p = m.p; ws.serializeAttachment(a); this.broadcast({ k: 'p', peer: a.peer, p: m.p }, ws); }
    else if (m.k === 'e' && typeof m.t === 'string' && m.t.length <= 32) this.broadcast({ k: 'e', t: m.t, peer: a.peer, d: m.d }, ws);
  }

  gone(ws) {
    this.rate.delete(ws);
    const a = ws.deserializeAttachment(); if (!a) return;
    const replaced = a.gone; a.gone = 1; try { ws.serializeAttachment(a); } catch (e) {}
    if (!replaced) this.broadcast({ k: 'x', peer: a.peer }, ws);
  }
  async webSocketClose(ws) { this.gone(ws); try { ws.close(1000, 'bye'); } catch (e) {} }
  async webSocketError(ws) { this.gone(ws); }
}
