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
[PartyKit](https://www.partykit.io/) relay. The host runs the simulation and
broadcasts snapshots; the guest sends input. Rooms are identified by 5-character
codes (create a room, share the code, the other player joins with it).

Configuration:

- `NEXT_PUBLIC_PARTYKIT_HOST` — host of the deployed PartyKit server
  (e.g. `motus-versus.your-name.partykit.dev`). When unset, the client
  connects to `localhost:1999`, which is where `partykit dev` listens.

Local development (two terminals):

```bash
npm run dev            # Next.js app
npx partykit dev       # relay server on localhost:1999 (or: npm run party:dev)
```

Deploying:

```bash
npx partykit deploy    # or: npm run party:deploy
```

The PartyKit server deploys separately from the Next.js app (Vercel). After
deploying, set `NEXT_PUBLIC_PARTYKIT_HOST` in the Vercel project environment
to the deployed PartyKit host so production clients connect to it.

Notes:

- Room codes are 5 characters from an unambiguous alphabet (no I/L/O/0/1).
- Multiplayer matches never write to the leaderboard — it is survival-only.

Project structure:

- `src/app` - Next.js App Router pages and layout
- `src/components/GameCanvas.tsx` - canvas and game loop
- `src/lib/physics.ts` - vector and collision helpers
- `src/lib/gameLogic.ts` - spawn/reset helpers
