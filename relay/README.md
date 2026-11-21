# mnzr relay

A small Cloudflare Worker that lets online play work on mnzr.lol (outside claude.ai there is no `window.claude` room).
Each room code is one Durable Object; every player holds a WebSocket to it. The relay keeps each player's latest
presence and forwards `state` / `hit` emits to the others. It has no game logic. The game side is `relayRooms()` in
`index.html`, which gives the same API as `claude.use('room')`, so the netcode is unchanged.

- Deploys through Cloudflare Workers Builds (root directory `relay`, deploy command `npx wrangler deploy`).
- Only pages from mnzr.lol, *.vercel.app and localhost may connect (`ORIGINS` in worker.js).
- Limits: 4 KiB per message, 60 messages a second per player, 16 players per room.
- Local test: `npx wrangler dev --port 8787` here, serve index.html on localhost:8080, open `http://localhost:8080/?relay=ws://localhost:8787`.
