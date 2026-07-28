# Motus

Simple Next.js + TypeScript HTML5 Canvas game MVP.

Run:

```bash
npm install
npm run dev
```

Controls:
- Arrow keys or WASD: move the puck
- Space: restart after game over

## Online multiplayer

Versus matches (Orb Duel, Co-op Survival, Tag) can be played online through a
small relay running on [Cloudflare Workers](https://developers.cloudflare.com/workers/)
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

Project structure:

- `src/app` - Next.js App Router pages and layout
- `src/components/GameCanvas.tsx` - canvas and game loop
- `src/lib/physics.ts` - vector and collision helpers
- `src/lib/gameLogic.ts` - spawn/reset helpers
