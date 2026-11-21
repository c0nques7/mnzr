# mnzr
Monday Night Zombie Rumble


# Monday Night Zombie Rumble

A browser-based 3D arena shooter. Play it solo against bots, co-op against waves of zombies ("Revenants"), or online with friends. The whole game is one static HTML file, so it needs no build step and no server.

> **Status:** prototype build. The menu footer reads "Prototype build".
> **Planned home:** https://mnzr.lol (Vercel static hosting)

## Game modes

| Mode | Format | Notes |
|---|---|---|
| Zone | 2v2 objective | Attack and defend zones/sites. Includes the bomb arm/defuse mechanic. |
| Deathmatch | 1v1 duel | |
| Team Deathmatch | 2v2 or 4v4 | |
| Zombie Rumble | 2-player co-op | Waves of Revenants between intermissions. Enemy types include Shambler, Bloater and Juggernaut. Offers a Full (25 min) or Short (10 min) broadcast length, plus weekly episodes and a campaign intro. |

Bot skill (Easy / Normal / Hard) and team (Auto / Blue / Orange) are chosen in the menu.

## Maps

Yard, Foundry, Atrium and Warren. Each has its own colour theme and cover layout. Foundry has a flooding molten-metal channel and Yard has a moving crane.

## Menu

Play, Play online, Workshop, Locker, Sandbox, Settings and Full screen.

- **Workshop:** build gun loadouts from parts, name your builds, and set up the weapon wheel. Builds are saved in your browser.
- **Locker:** unlock items (Zombie Rumble credits).
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
```

`index.html` is about 11.6 MB and has three script blocks:

1. A boot check that shows an error panel if WebGL 2 or the game script fails.
2. A bundled copy of three.js r186.1 and its addons, so no CDN is needed. Its comment gives the rebuild recipe: esbuild with `--format=iife --global-name=__ZA3 --minify`.
3. The game itself, as an ES module. It holds the rules (`CFG`), maps (`MAPS`), weapons, bots, Zombie Rumble logic, UI, audio, key bindings (`KB_ACTS`) and networking.

**External resources**
- Google Fonts: Saira Condensed and IBM Plex Mono (the game falls back to system fonts if blocked).
- `music/*.mp3`: six tracks referenced by `MATCH_LIST` (`dark-synthwave-loka`, `neon-nights`, `oblivion-echo`, `spectral`, `neon-synthwave-vibe`, `dark-synthwave-kulakovka`). One more track, "Evasion", is embedded in the file. A missing MP3 is skipped, not fatal.

**Saved in the browser (`localStorage`)**
Key bindings (`za-binds`), settings (`za-opt`, `za-gfx`, `za-sens`, `za-dev`), progress (`za-prog`), loadouts (`za-w`), name (`za-name`), last map and mode (`za-map`, `za-mode`), Zombie Rumble settings (`za-zr`, `za-zrlen`), and a few others. Clearing site data resets all of them.

## Online play (important for deployment)

The online code uses `window.claude.use('room')`, a room service that exists only when the page is opened inside claude.ai. Without it, the menu shows "Online play works when this page is opened on claude.ai. Play works anywhere."

**On mnzr.lol, solo and bot play will work, but online play will not** until the networking layer is replaced. Options include WebRTC with a signalling service, WebSockets on a separate host, or a hosted realtime service. Vercel Functions do not support WebSockets.

## Deploying to Vercel

1. Push the repo to GitHub.
2. In Vercel, import the repo with Framework Preset **Other**, and leave the build command and output directory empty.
3. Add `mnzr.lol` and `www.mnzr.lol` under Settings, then Domains, and follow the DNS records Vercel shows.
4. Commit the `music/` folder with the exact lowercase filenames above.

Because of the file's size, enable compression on your host (Vercel compresses text responses automatically) and consider splitting out the three.js bundle and music later.

## Credits

- three.js (MIT), https://threejs.org
- Music credits as named in `MATCH_LIST`: loka_music, turtlebeats, echoes_of_lumen, kulakovka. Check each track's licence before publishing.

## Known gaps

- This README comes from static reading of `index.html`. The game has not been run or tested here.

