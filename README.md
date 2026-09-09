# LAST-VECTOR

Multiplayer alien-strike arena shooter for CrazyGames, playable on desktop and mobile browsers.

**Stack:** React + PixiJS (WebGL) + Rapier (physics) on the client, Node.js + Colyseus (authoritative multiplayer) on the server.

## Layout

```
client/   React + PixiJS + Rapier — what players load in the browser
server/   Node + Colyseus — authoritative rooms, server-side Rapier
shared/   constants + types imported by BOTH client and server (single source of truth)
```

## Getting started

```bash
npm install          # installs all workspaces
npm run dev          # client on http://localhost:5173, server on ws://localhost:2567
```

**Play on a phone (same Wi-Fi):** open `http://<your-mac-LAN-ip>:5173` on the phone. The client connects to the game server on the same host at port 2567 automatically (no `.env` needed).

Other scripts:

```bash
npm run build        # builds shared -> client -> server
npm run typecheck    # tsc --noEmit across workspaces
npm test             # shared-sim unit tests (vitest)
npm run check        # headless Chrome: menus, weapons, aliens, mobile, 2-tab multiplayer
npm run lint
npm run format
```

## Architecture

- `shared/src/sim/` — the **entire game simulation** (`Match`): cave + colliders, players, six weapons, aliens, bombs, pickups, waves. Pure TypeScript + Rapier, no DOM. Emits `SimEvent`s and a `Snapshot`.
- `client/` — engine + rendering only. A `MatchSource` feeds it: `LocalSource` (runs a Match in the browser for single-player) or `NetSource` (mirrors the Colyseus room). Views/FX never know which.
- Netcode: the client predicts its own player with a dry-run `Match`, reconciles against the server's acknowledged input seq (rewind + replay, residual error blended out), and interpolates remote entities ~100 ms behind. `F3` debug overlay (ping, tick, patch Hz, prediction error), `F4` or `?lag=120` simulates latency.
- `server/` — `ArenaRoom` runs the same `Match` authoritatively at 60 Hz, sanitises inputs, mirrors the snapshot into a Colyseus schema at 20 Hz and broadcasts destroyed-tile deltas + transient events.

## Build order

1. Client-only single-player: Pixi rendering + Rapier physics
2. Mobile input + responsive layout
3. `shared/` constants + types
4. Colyseus server, single room, server-authoritative physics
5. Client networking layer (interpolation / prediction)
6. CrazyGames SDK integration + submission

## Deployment

- **Client → CrazyGames:** `npm run build:client` produces `client/dist/`; zip and upload via the CrazyGames developer portal.
- **Server → Render / Fly.io / VPS:** long-running Node process (`npm run start:server`). Colyseus needs persistent WebSocket connections, so no serverless.
