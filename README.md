# mnzr
Monday Night Zombie Rumble


# Monday Night Zombie Rumble

A browser-based 3D arena shooter. Play it solo against bots, co-op against waves of zombies ("Revenants"), or online with friends. The game is one static HTML file with no build step; serve it over HTTP for the music, and online play uses a separate Cloudflare relay.

> **Status:** prototype build. The menu footer reads "Prototype build".
> **Live at:** https://mnzr.lol (Vercel static hosting, deploys from `main`)
>
> Full development notes (systems, tuning, tests, history) are in [DEVELOPMENT.md](DEVELOPMENT.md). This repo took over from `c0nques7/2v2-Shooter-Idea` on 2026-11-21 with its full history.

## Game modes

| Mode | Format | Notes |
|---|---|---|
| Zone | 2v2 objective | Attack and defend zones/sites. Includes the bomb arm/defuse mechanic. |
| Deathmatch | 1v1 duel | |
| Team Deathmatch | 2v2 or 4v4 | |
| Zombie Rumble | 2-player co-op | Waves of Revenants between intermissions. Weeks 1–2 are playable (Weeks 3–4 coming soon). Enemies include Shamblers, Crawlers, Sprinters, Bloaters and Spitters, plus Shielded/Splitter elites and a different headliner each week. Full (25 min) or Short (10 min) broadcasts, plus a campaign intro. |

Bot skill (Easy / Normal / Hard) and team (Auto / Blue / Orange) are chosen in the menu.

## Maps

Yard, Foundry, Atrium and Warren. Each has its own colour theme and cover layout. Foundry has a flooding molten-metal channel and Yard has a moving crane.

## Menu

Play, Play online, Workshop, Locker, Sandbox, Settings and Full screen.

- **Workshop:** build gun loadouts from parts, name your builds, and set up the weapon wheel. Builds are saved in your browser.
- **Locker:** unlock items (Zombie Rumble credits).
- **Updates:** the panel on the right reads published releases from `c0nques7/mnzr` on GitHub, so notes can be posted without rebuilding the game. It falls back to the built-in list when offline.
- **Sandbox:** a test range with a tuning panel (default key `T` or `` ` ``).
- **Progression:** XP and levels.

## Controls (defaults, all rebindable in Settings)

| Action | Default |
|---|---|
| Move | `W` `A` `S` `D` |
| Sprint (hold) | `Shift` |
| Jump | `Space` |
| Crouch / slide | `C` |
| Dash | `V` |
| Lean | `Q` / `E` |
| Fire / Aim | Left click / Right click |
| Reload | `R` |
| Weapon wheel (hold) | Middle click |
| Weapon / zone select | `1`-`6` |
| Use (revive, arm, defuse, take) | `F` |
| Give up when down | `G` |
| Look with keyboard | Arrow keys |
| Settings | `O` |
| Sandbox tuning panel | `T` or `` ` `` |
| Pause | `Esc` (fixed, not rebindable) |

The code also contains touch-control and game-controller handling.

## Running locally

Serve the folder over HTTP rather than opening the file directly. The music files are loaded with `fetch()`, which browsers block on `file://`.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

**Requirements:** a browser with WebGL 2 and hardware acceleration. If the game cannot start, an on-screen message explains why.

## Project structure

```
index.html     the entire game: HTML, CSS, bundled three.js, game code
music/         MP3 tracks loaded at runtime (see below)
relay/         Cloudflare Worker: WebSocket relay for online play
```

`index.html` is about 11.4 MB and has three script blocks:

1. A boot check that shows an error panel if WebGL 2 or the game script fails.
2. A bundled copy of three.js r186.1 and its addons, so no CDN is needed. Its comment gives the rebuild recipe: esbuild with `--format=iife --global-name=__ZA3 --minify`.
3. The game itself, as an ES module. It holds the rules (`CFG`), maps (`MAPS`), weapons, bots, Zombie Rumble logic, UI, audio, key bindings (`KB_ACTS`) and networking.

**External resources**
- Google Fonts: Saira Condensed and IBM Plex Mono (the game falls back to system fonts if blocked).
- `music/*.mp3`: eleven tracks referenced by `MATCH_LIST` (`dark-synthwave-loka`, `neon-nights`, `oblivion-echo`, `spectral`, `neon-synthwave-vibe`, `dark-synthwave-kulakovka`, `war-cyberpunk`, `cyberpunk-neon-city`, `downtown-80s-club`, `darkish-focus-80s`, `supercars-action`). One more track, "Evasion", is embedded in the file. A missing MP3 is skipped, not fatal.

**Saved in the browser (`localStorage`)**
Key bindings (`za-binds`), settings (`za-opt`, `za-gfx`, `za-sens`, `za-dev`), progress (`za-prog`), loadouts (`za-w`), name (`za-name`), last map and mode (`za-map`, `za-mode`), Zombie Rumble settings (`za-zr`, `za-zrlen`), and a few others. Clearing site data resets all of them unless you sign in to cloud saves first.

## Online play

When the page is opened inside claude.ai it uses the built-in `window.claude.use('room')` service. Everywhere else, `relayRooms()` in `index.html` connects to a small Cloudflare Worker in [`relay/`](relay/), defaulting to `wss://mnzr-relay.joewade0110.workers.dev`. Each room code is one Durable Object; it holds a WebSocket per player and forwards presence and `state`/`hit` emits without running any game logic. The game stays host-authoritative, and bots fill empty slots.

The room code is the only credential: anyone who knows it can join. Payloads are capped at 4 KiB per message, 60 messages a second per socket and 16 players per room. Only `mnzr.lol`, `*.vercel.app` and localhost origins may connect. Vercel Functions cannot host WebSockets, which is why the relay is a separate Worker.

For local testing, run `npx wrangler dev --port 8787` in `relay/`, serve `index.html` on localhost:8080 and open `http://localhost:8080/?relay=ws://localhost:8787`. The `?relay=` override is remembered in `localStorage` as `za-relay`. `GET /health` on the worker returns `mnzr relay ok`.

## Cloud saves

Settings > Account can sign in with Google. The relay Worker handles the OAuth flow and stores a snapshot of your progression in Cloudflare KV, so the same Locker, weapon builds and campaign progress work on every device. On first sign-in you choose whether to upload this browser's existing save; nothing is copied without that choice. Export save file and Import save file are available there too, whether or not you sign in. See [`relay/README.md`](relay/README.md) for the one-time Google Cloud and KV setup.

## Deploying to Vercel

1. Push the repo to GitHub.
2. In Vercel, import the repo with Framework Preset **Other**, and leave the build command and output directory empty.
3. Add `mnzr.lol` and `www.mnzr.lol` under Settings, then Domains, and follow the DNS records Vercel shows.
4. Commit the `music/` folder with the exact lowercase filenames above.
5. Deploy `relay/` separately to Cloudflare Workers (Workers Builds: root directory `relay`, deploy command `npx wrangler deploy`; the `v1` migration creates the Durable Object class), then check `/health`. If the worker URL changes, update `RELAY_URL` in `index.html`. For cloud saves, also create the two KV namespaces, set the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets and add the callback URI as described in `relay/README.md`.

Because of the file's size, enable compression on your host (Vercel compresses text responses automatically) and consider splitting out the three.js bundle and music later.

## Credits

- three.js (MIT), https://threejs.org
- Dash recharge cue: "energy" by freesound_community (Pixabay 90321, Pixabay Content License), trimmed and pitched up.
- Arena buzz bed (every map): "High energy buzzing ambience" by alex_jauk (Pixabay 195142, Pixabay Content License), looped.
- Music credits as named in `MATCH_LIST`: loka_music, turtlebeats, echoes_of_lumen, kulakovka, EnergySound, SlimeyFox, fassounds. Check each track's licence before publishing.
- Encore grenade burst: "Chunky Explosion" (OpenGameArt, CC0), trimmed. Credit pickup: coin.1 from "12 Coin Sound Effects" by starninjas (OpenGameArt, CC0).

## Known gaps

- Zombie Rumble Weeks 3 and 4 appear in the menu but are not built; only Weeks 1 and 2 play.
- The relay has no join token for matches: anyone with a room code can join. Google sign-in is for saves, not match access.
- Cloud saves need the Google Cloud project, KV namespaces and Worker secrets in `relay/README.md`; until then Settings > Account reports "not configured".
- There is no automated test suite. The relay `/health` endpoint was checked live, but the game has not been played from this repo.

