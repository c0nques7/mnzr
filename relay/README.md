# mnzr relay

A small Cloudflare Worker that lets online play work on mnzr.lol (outside claude.ai there is no `window.claude` room).
Each room code is one Durable Object; every player holds a WebSocket to it. The relay keeps each player's latest
presence and forwards `state` / `hit` emits to the others. It has no game logic. The game side is `relayRooms()` in
`index.html`, which gives the same API as `claude.use('room')`, so the netcode is unchanged.

- Live at `wss://mnzr-relay.joewade0110.workers.dev`; `GET /health` returns `mnzr relay ok`. If the worker moves, update `RELAY_URL` in `index.html`.
- Deploys through Cloudflare Workers Builds (root directory `relay`, deploy command `npx wrangler deploy`).
- Only pages from mnzr.lol, this project's Vercel previews (`mnzr-…-c0nques7s-projects.vercel.app`) and localhost may connect (`ORIGINS` in worker.js).
- Limits: 4 KiB per message, 60 messages a second per player, 16 players per room.
- There is no join token for matches: the room code is the only credential, and the relay forwards messages without checking game rules. Google sign-in is for saves only.
- Local test: `npx wrangler dev --port 8787` here, serve index.html on localhost:8080, open `http://localhost:8080/?relay=ws://localhost:8787`.

## Google sign-in and cloud saves

The same Worker also hosts `/auth/*` and `/api/save`. Google identifies the player; the save is a JSON
snapshot of progression keys from `localStorage`, stored in KV under the Google `sub`. Signing in never
overwrites local data without an explicit choice — the first sign-in offers to import the current browser,
and Settings > Account can export/import a save file at any time.

**One-time setup**

1. In Google Cloud Console, create/select a project, configure the OAuth consent screen (External; add your
   own Google account as a test user while the app is in testing), then create an **OAuth client ID** of type
   **Web application**.
2. Add both redirect URIs: `https://mnzr-relay.joewade0110.workers.dev/auth/callback` and
   `http://localhost:8787/auth/callback`. Copy the client ID and secret.
3. Create two KV namespaces and paste their IDs into `wrangler.toml`:
   `npx wrangler kv namespace create SESSIONS` and `npx wrangler kv namespace create SAVES`
   (add `--preview` for the preview IDs).
4. The client ID is already in `[vars]` in `wrangler.toml`. Store only the client secret:
   `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Set `APP_ORIGIN` in `[vars]` if the game moves off mnzr.lol.
5. `npx wrangler deploy`. Check `/health`, then sign in from Settings > Account on the game.

**Flow and API**

- `GET /auth/google?app=<origin>&state=<random>` — validates the game origin, creates a PKCE verifier in KV
  (10-minute TTL), and redirects to Google. The browser only supplies a random `state`.
- `GET /auth/callback?code&state` — redeems the code, verifies the ID token's `aud`/`iss`, creates a 30-day
  bearer token in the `SESSIONS` KV, and redirects to `<app>/#auth=<token>&state=<state>`. The token is in a
  URL fragment, so it never reaches a server log. The game stores it in `localStorage` as `za-cloud-token`.
- `GET /auth/me`, `POST /auth/logout`, `GET /api/save`, `PUT /api/save` — bearer token required, CORS limited
  to the same origin allowlist. `PUT` accepts `{v:1,save:{...}}` and caps the body at 512 KiB.
- The game derives the auth base URL from `RELAY_URL` (`wss://` becomes `https://`), so a `?relay=` override also redirects sign-in to that host. Point it at this Worker, or leave the override off.
- Saves are opaque to the worker: it stores and returns bytes, never interprets progression or enforces game
  rules. KV is eventually consistent, so a second device can briefly see the previous save.
- The bearer token is a password for the save. Anyone with it can read/overwrite that save; keep it out of
  logs and share URLs, and use Sign out to revoke it immediately.
