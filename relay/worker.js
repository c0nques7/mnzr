/* mnzr relay: one Durable Object per room name. Each player holds one WebSocket to its room.
   The room keeps every peer's latest presence and forwards emits to the other peers; it has no game logic.
   Wire format (JSON text frames):
     client -> relay  {k:'p', p:{...}}            replace my presence
                      {k:'e', t:'state', d:{...}}  emit on a topic
     relay -> client  {k:'hi', you, peers:[{peer,p}]}   sent once on connect
                      {k:'p', peer, p}                  a peer's presence changed (or it joined)
                      {k:'x', peer}                     a peer left
                      {k:'e', t, peer, d}               an emit from another peer */
const MAX_MSG = 4096 + 64;          /* the game keeps payloads under 4 KiB, same as the claude.ai room */
const MAX_PEERS = 16;
const RATE = 60;                    /* frames a second per socket before the relay starts dropping */
const ORIGINS = [/^https:\/\/(www\.)?mnzr\.lol$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const NAME = /^[a-z0-9-]{1,64}$/;
const PEER = /^[a-z0-9]{4,24}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('mnzr relay ok\n', { headers: { 'content-type': 'text/plain' } });
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
