# Motus

A momentum-driven arcade game rendered on an HTML5 canvas. You pilot a puck with
real inertia — it coasts after you let go — collecting orbs, dodging hazards, and
surviving periodic **Cataclysm** events that rewrite the rules for thirty seconds
at a time.

**[Play it →](https://playmotus.vercel.app)**

Built with Next.js, TypeScript and a hand-written canvas engine. No game
framework.

## What's in it

- **Survival** — score, stages, and a Neon Postgres leaderboard with server-side
  anti-cheat.
- **Eight Cataclysm events** — the arena shrinks, hunters home in, decoys swap
  places, the lights go out, meteors streak through. Every 10 orbs, never the
  same one twice in a row.
- **A 100-challenge campaign** with achievements, lifetime stats, and earned
  cosmetics and arena themes.
- **Versus** — three multiplayer variants (Orb Duel, Co-op Survival, Tag),
  playable locally on one keyboard or online across two devices.
- **Practice** and an eight-step **Tutorial**.

**Controls:** arrow keys or WASD to move, space to restart after game over, and
an on-screen D-pad on touch devices.

## Design — "Phosphor Scope"

The game presents itself as an instrument measuring a body in motion: a
long-persistence phosphor scope. The display is one monochrome tube, so
brightness is the only hierarchy — red is the one colour the tube cannot produce,
which is exactly why it means danger and nothing else.

The signature motif is **the trace**: one line plotting real speed over time,
drawn on four surfaces — the title backdrop (your cursor's velocity), the HUD
strip chart, your tick-stamped trail in the arena, and the end screen showing the
whole run with the death point marked.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

**Required env** (leaderboard only): `LEADERBOARD_SESSION_SECRET` plus a Neon
Postgres connection string as `DATABASE_URL`. Copy `.env.local.example` to
`.env.local` and fill it in. The game itself plays fine without them; only score
submission needs the database.

## Online multiplayer

Versus matches can be played online through a small relay running on
[Cloudflare Workers](https://developers.cloudflare.com/workers/)
(`worker/index.ts` — a Worker plus one Durable Object per room). The host runs the
simulation and broadcasts snapshots; the guest sends input. Rooms are identified
by 5-character codes (create a room, share the code, the other player joins with it).

> This used to run on PartyKit. PartyKit's managed platform puts every project on
> the shared `partykit.dev` zone, which has hit Cloudflare's hard limit of 10,000
> custom domains per zone, so new deploys are refused. A plain Worker gets a free
> `*.workers.dev` subdomain and needs no custom domain. The wire protocol is
> unchanged.

Configuration:

- `NEXT_PUBLIC_VERSUS_HOST` — host of the deployed relay
  (e.g. `motus-versus.your-name.workers.dev`). When unset, the client connects to
  `localhost:1999`, which is where `npm run versus:dev` listens.
  `NEXT_PUBLIC_PARTYKIT_HOST` is still read as a fallback.

Local development (two terminals):

```bash
npm run dev            # Next.js app on :3000
npm run versus:dev     # relay on :1999 (wrangler dev, fully local — no login needed)
```

Deploying the relay:

```bash
npx wrangler login     # once, opens a browser
npm run versus:deploy  # prints the deployed *.workers.dev host
```

The relay deploys separately from the Next.js app (Vercel). After deploying, set
`NEXT_PUBLIC_VERSUS_HOST` in the Vercel project environment to the deployed host,
then **redeploy** — `NEXT_PUBLIC_*` values are baked in at build time, so setting
the variable alone changes nothing.

Cost: Durable Objects run on the Cloudflare Workers **Free** plan. At this game's
20Hz snapshot + 10Hz input rate, and Cloudflare's 20:1 billing ratio for incoming
WebSocket messages, the free tier covers roughly 18 hours of live online play per
day.

Notes:

- Room codes are 5 characters from an unambiguous alphabet (no I/L/O/0/1).
- Multiplayer matches never write to the leaderboard — it is survival-only.

## Project structure

```
src/
  app/          App Router pages, layout, global styling, leaderboard API routes
  components/
    GameCanvas.tsx     canvas, main loop, all game state (the largest file)
    NeonBackground.tsx title backdrop — graticule + plotted cursor velocity
    TraceStrip.tsx     the trace, as a component
    ...                challenge / settings / profile / end-screen overlays
  lib/
    physics.ts         vectors, integration, collisions, bounds
    gameLogic.ts       spawning, cataclysm config, difficulty scaling
    cataclysm/events.ts  the eight event definitions
    telemetry.ts       speed ring buffer behind the trace
    game-session.ts    HMAC session signing + anti-cheat limits
    challenges.ts, achievements.ts, stats.ts, customization.ts
    multiplayer/, net/ player slots, variant rules, wire protocol, interpolation
worker/index.ts   Cloudflare Worker + Durable Object relay
neon/schema.sql   leaderboard schema
```

Progression is stored client-side in `localStorage`, namespaced `motus:v2:`.
Only the leaderboard touches the database.

For how the engine actually works — the design system's token architecture, the
netcode model, and the anti-cheat scheme — see
[ARCHITECTURE.md](./ARCHITECTURE.md). [MOTUS_V2.md](./MOTUS_V2.md) covers the
progression layer's design.

---

© 2026 Shardul Marathe. All rights reserved. This source is published for
portfolio review; it is not licensed for reuse, modification, or redistribution.
