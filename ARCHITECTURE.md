# Architecture

Motus is a momentum-driven arcade game rendered on an HTML5 canvas: you pilot a
puck with inertia, collect orbs, dodge hazards, and survive periodic "Cataclysm"
events. It ships a 100-challenge campaign, achievements, a lifetime-stats
profile, earned cosmetics, and a Neon Postgres leaderboard with server-side
anti-cheat.

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

**Controls:** arrow keys or WASD to move, space to restart after game over, and
an on-screen D-pad on touch devices.

**Required env:** `LEADERBOARD_SESSION_SECRET` (session signing) plus the Neon
Postgres connection string used by `src/lib/db.ts`. Without the secret, the
session and leaderboard API routes throw.

## Tech stack

- **Next.js App Router** + React — client-heavy; the game is one large client
  component.
- **TypeScript** throughout.
- **HTML5 Canvas** for all rendering, with no game framework. The main loop lives
  in `GameCanvas.tsx`.
- **Neon Postgres** for the leaderboard.
- Google Fonts loaded at runtime (`src/lib/fonts.ts`) rather than at build time,
  which avoids flaky Vercel builds.

## Screen flow

The live experience is a **single client page** (`src/app/page.tsx`) driven by a
`uiState` state machine — gameplay is not routed.

- **`title`** — a scope graticule plus one full-width channel plotting the
  cursor's own velocity (`NeonBackground`), drawn the way a scope actually works:
  a beam sweeps left→right writing current speed into the column beneath it while
  the phosphor behind it decays over ~2.4s. Nothing scrolls, the sweep runs
  whether or not the visitor moves, and speed is soft-kneed rather than clamped,
  so a fast flick reads as taller instead of saturating. The menu rows each carry
  a live readout of the player's own data (`Best 412`, `37/100 · 91★`, the active
  instrument) rather than a decorative index; rows with nothing measured yet stay
  blank.
- **`rules`** — a mode-specific briefing modal. In Survival it also forces a
  username picker before Play unlocks, and mints a signed session.
- **`playing`** — `GameCanvas` runs. The HUD shows score, the current objective,
  and in survival the "Next X/10" counter plus session best. Time-bound
  challenges draw a top-center countdown styled like the Cataclysm timer.
- **`paused`** — resume / restart / menu.

Overlays layered on top: `ChallengeSelect`, `SettingsModal`, `ProfileModal`,
`EndScreen`, `AchievementToast`, `MultiplayerSelect`, and `VersusEndScreen` —
the last kept deliberately separate from `EndScreen` so multiplayer never
touches stats or achievements.

Legacy routes `src/app/rules/page.tsx` and `src/app/game/page.tsx` still exist
from an older flow but are not part of the live single-page experience.

## Design system — "Phosphor Scope"

The governing rule is **the beam writes, the phosphor remembers**. The display is
one *monochrome* tube: headings, body copy, rules and graduations are all
phosphor at different brightnesses, so brightness is the only hierarchy. It is
not a grey interface with a green accent bolted on. Red is the one colour the
tube cannot produce, which is exactly why it means danger and nothing else.

**The signature motif is the trace** — one line plotting real speed over time, on
four surfaces: the title backdrop (cursor velocity), the HUD bar (a live strip
chart, with score and stage as annotations *on* it), the player's trail in the
arena (tick-stamped, so tick spacing reads as speed), and the end screen (the
whole run, with the death point marked). `src/lib/telemetry.ts` owns the data — a
ring buffer written by the game loop — and `TraceStrip.tsx` owns the pixels.
React never re-renders to keep a chart moving.

**Tokens are medium-neutral on purpose**: `--field`, `--surface`, `--mark`,
`--mark-body`, `--mark-dim`, `--signal`, `--alarm`, `--rule`, `--lift`,
`--scrim`. The look changed medium twice during design (amber CRT → ink-on-paper
→ phosphor tube), and neutral names mean the next change is a few values rather
than a rename across the codebase. Every older name (`--panel`, `--hair`,
`--ink`, `--pen`, `--phosphor`, `--glow-*`) is kept as an alias resolving to one
of these, so nothing renders off-system.

**Theming is app-wide, not arena-only.** `themeCssVars()` and
`applyThemeToDocument()` in `customization.ts` translate the selected instrument
into those CSS tokens and push them onto `:root`; `saveSettings()` calls it, so
picking an instrument reskins every screen immediately without a reload. Canvas
components cache their tokens, so it also fires `THEME_CHANGE_EVENT` — without
that, the title backdrop and HUD chart would keep the old instrument until the
next resize. `chassisTheme()` deliberately ignores the *random theme each run*
option, because re-rolling the menus between runs reads as a bug.

Every panel shares `.rules-modal` as its base — reskin it and the challenge,
settings, profile, end and leaderboard panels follow. Reusable pieces: `.btn`
with `.btn-primary`/`.btn-ghost` (one primary per screen), `.modal-eyebrow`,
`.brief-list`/`.brief-row`, `.menu-row`/`.menu-readout`, `.stat-row` (dotted
leaders), and `.tick-rule` (the ticked baseline used wherever a plain hairline
would read as generic). Type is two families: Archivo (variable `wdth`, expanded
for display) and IBM Plex Mono for all data, labels and **all canvas text**. HUD
sizing is driven by `--hud-*` tokens — recolor, don't resize.

## Game modes

| Mode | Enemies | Death | Borders | Objective |
|---|---|---|---|---|
| **Tutorial** | Scripted | Restarts current step | Deadly | 8 guided steps (`tutorialLogic.ts`) |
| **Survival** | Yes, scaling | Game over | Deadly | Score, submit to leaderboard |
| **Practice** ("zen") | None | Cannot die | Wrap-around | Relaxed orb collecting |
| **Challenge** | Fixed roster + static hazards | Game over | Per challenge | Clear the goal (`challenges.ts`) |
| **Multiplayer** | Per variant | Stun / downed / never | Per variant | Win the match, or survive together |

## Core mechanics

Main loop and rendering live in `src/components/GameCanvas.tsx`; math and
collision helpers in `src/lib/physics.ts`.

- **Movement is momentum-based.** Acceleration is 1000 px/s² while a direction is
  held, with per-frame damping of 0.99 and velocity capped at 500 px/s. The puck
  coasts after keys release — this feel is the point of the game. A fading trail
  spawns above 60 px/s.
- **Scoring:** +1 per orb; a replacement respawns immediately, kept clear of
  edges and the player (`spawnGoal` in `gameLogic.ts`).
- **Enemies** spawn from a random edge aimed at centre with jitter, with base
  speed scaled by stage (`×(1 + 0.15·(stage−1))`). The cap grows as
  `12 + 2·stage`, maxing at 80. Any contact ends a Survival run.
- **Borders** are deadly in Tutorial and Survival, with a proximity warning glow,
  and wrap around in Practice.

## Cataclysm events

Spawn and config in `src/lib/gameLogic.ts`; per-event behaviour in
`src/lib/cataclysm/events.ts`.

Every 10 orbs triggers a random 30-second Cataclysm with a 1.5s intro grace
period during which you cannot die. Collecting all 7 event goals clears it and
advances a stage; letting the timer reach zero ends the run. Events never repeat
back-to-back, and fire in Survival only — not in Challenge mode.

1. **Precision Run** (`staticGoals`) — 7 fixed orbs.
2. **Chase Sequence** (`movingGoals`) — orbs drift and bounce, changing direction.
3. **Last Stand** (`shrinkingArena`) — walls close in; leaving the safe rectangle kills.
4. **The Hunt** (`hunt`) — 2–5 homing hunters seek you while you collect.
5. **Trickster** (`swap`) — decoys sit on orb positions and swap every 5s.
6. **Repulsor** (`magnet`) — goals flee the player on approach.
7. **Blackout** (`blackout`) — the arena darkens to a light radius around you.
8. **Meteor Storm** (`meteorStorm`) — fast hazards streak across the arena.

Difficulty (`getDifficultyMultiplier`) compounds roughly 6% per stage and 5% per
completed cataclysm.

## Multiplayer ("Versus")

A `gameMode: 'multiplayer'` plus an `mpVariant` prop (`'duel' | 'coop' | 'tag'`),
chosen so every existing `=== 'survival'` check in `GameCanvas` is automatically
false in multiplayer, and the leaderboard, stats and achievement paths
(`finalizeRun`, `onSurvivalGameOver`) are bypassed by construction. Shared type
contracts live in `src/lib/modes.ts`; tuning constants in
`src/lib/multiplayer/rules.ts`.

**Engine model.** `GameCanvas` holds a `playersRef: PlayerSlot[]`
(`src/lib/multiplayer/players.ts` — puck, input map, colours, and
alive/stunned/downed/isIt state). Single-player uses one slot whose puck
*aliases* `playerRef.current` with the combined WASD + arrows keymap, so
single-player behaviour is unchanged. Locally, P1 is WASD in the theme palette
and P2 is arrows in fixed amber, with a magenta fallback via `pickP2Colors` when
the theme clashes. Enemy homing and cataclysm hunters target the *nearest living*
player, blackout punches one light hole per player, and orbs spawn clear of all
pucks (`spawnGoalClearOf`). The cataclysm context takes `players: Puck[]` with
`player` kept as a `players[0]` alias, and `shrinkingArena.onUpdate` returns
caught player *indices* rather than `'gameOver'` so co-op can down them —
single-player maps a non-empty result to game over.

**Variants:**

- **Orb Duel** — first to 15 orbs, 4 linear enemies, no cataclysms. Enemy contact
  knocks you away at 420 px/s with a 0.6s stagger (ghosted, cannot collect, but
  physics keeps carrying you) and 1.2s of i-frames. Walls never stun; they are
  elastic, with a 0.75 damping ricochet and a spark.
- **Co-op Survival** — shared score, cataclysms fire as in survival, enemy caps
  ×1.35. A hit *downs* you for a 6s bleed-out and a teammate's touch revives with
  2s immunity; both down, or a bleed-out, ends the run. Not leaderboard-eligible.
- **Tag** — 90s round, wraparound walls, no enemies or orbs. "It" gets +15%
  acceleration and 575 max velocity; touch swaps roles with 2s of no-tag-back;
  least time as "it" wins, drawn within 0.5s.

**Online play** runs through a Cloudflare Worker relay and is host-authoritative.
The host client runs the normal simulation; the guest's held keys arrive as a
4-bit mask feeding player slot 1. The host broadcasts 20Hz snapshots that the
guest interpolates (100ms delay, ≤200ms extrapolation, teleport-snap beyond
150px so Trickster swaps do not slide) and renders letterboxed into host arena
coordinates. Files: `worker/index.ts` (the relay — role claiming, 2-player cap,
message routing, `peerLeft`), `wrangler.jsonc`, and `src/lib/net/`
(`protocol.ts`, `room.ts` with reconnect backoff and multi-listener support, and
`interpolation.ts`'s `SnapshotBuffer`). No new runtime dependencies. `page.tsx`
owns the `RoomClient` lifecycle, the lobby (create/join by 5-character code), the
pause relay (guest requests, host decides), and match-end/disconnect handling.

Rooms enforce exactly one host and one guest. There is deliberately **no
anti-cheat**, because multiplayer never posts scores.

To run online locally: `npm run party:dev` (relay on `:1999`) alongside
`npm run dev`; the client defaults to `localhost:1999` when
`NEXT_PUBLIC_VERSUS_HOST` is unset. Deploy with `npm run versus:deploy`,
separately from Vercel, and set `NEXT_PUBLIC_VERSUS_HOST` in the Vercel env.

## Leaderboard and anti-cheat

Files: `src/lib/game-session.ts`, `src/app/api/leaderboard/route.ts`,
`src/app/api/leaderboard/session/route.ts`, `src/lib/leaderboard.ts`,
`src/lib/leaderboard-db.ts`.

- **Signed sessions.** Starting a Survival run mints an HMAC-SHA256 token
  (`LEADERBOARD_SESSION_SECRET`) bound to username and issued/expiry timestamps,
  also persisted server-side.
- **Server-side validation on submit.** The signature is verified, the session
  must exist and be unconsumed, and any score exceeding `elapsed_time / 400ms`
  (`MIN_MS_PER_POINT`) is rejected. Further guards: `MIN_RUN_MS = 2000`,
  `MAX_SESSION_MS = 45 min`, and single-use sessions marked consumed after
  submit.
- **Username hygiene.** A blocked-words list (`src/lib/blocked-words.json`) plus
  a profanity filter (`src/lib/profanity.ts`), live "already taken" checks, and
  3–20 character validation. The top 7 are shown.

Minting a fresh session per run is the correct behaviour rather than reusing one:
a long-lived token would let a single mint back many submissions.

## Project structure

```
src/
  app/
    page.tsx                 # single-page state machine — the live game
    layout.tsx, globals.css  # shell + all styling
    game/page.tsx            # legacy standalone game route
    rules/page.tsx           # legacy standalone rules route
    api/leaderboard/route.ts             # GET top 7 / POST validated score
    api/leaderboard/session/route.ts     # POST mint signed game session
  components/
    GameCanvas.tsx           # canvas, main loop, all game state (largest file)
    NeonBackground.tsx       # title backdrop — graticule + cursor-velocity channel
    TraceStrip.tsx           # the trace (live HUD chart / static run plot)
    TouchControls.tsx        # on-screen D-pad
    LeaderboardModal.tsx, ChallengeSelect.tsx, SettingsModal.tsx
    ProfileModal.tsx, EndScreen.tsx, AchievementToast.tsx
    MultiplayerSelect.tsx    # variant picker + local/online lobby
    VersusEndScreen.tsx      # match result (no stats writes)
  lib/
    telemetry.ts             # speed ring buffer + shared drawTrace()
    physics.ts               # vectors, integration, collisions, bounds
    gameLogic.ts             # spawning, cataclysm config, difficulty scaling
    cataclysm/events.ts      # the 8 event definitions
    tutorialLogic.ts         # 8-step tutorial script
    palette.ts               # base medium + withAlpha helper
    game-session.ts          # HMAC signing/verification + anti-cheat limits
    leaderboard.ts           # username/score validation
    leaderboard-db.ts, db.ts # Neon Postgres
    profanity.ts, blocked-words.json
    fonts.ts                 # runtime Google Fonts loader
    storage.ts               # SSR-safe namespaced localStorage wrapper
    stats.ts                 # lifetime stats + per-run summary
    achievements.ts          # 16 achievement predicates
    challenges.ts            # challenge types, unlock gating, star scoring
    customization.ts         # instruments, pens, persistence, app-wide theming
    data/challenges.json     # the 100 challenges (generated, committed)
    modes.ts                 # shared GameMode/MpVariant/MpSession contracts
    multiplayer/players.ts   # PlayerSlot, input maps, P2 colours
    multiplayer/rules.ts     # variant tuning constants
    net/protocol.ts          # wire messages, key bitmask, constants
    net/room.ts              # RoomClient (native WebSocket, reconnect)
    net/interpolation.ts     # SnapshotBuffer (lerp/extrapolate/teleport-snap)
worker/index.ts              # Cloudflare Worker + Durable Object relay
wrangler.jsonc               # Worker config (DO binding, SQLite migration)
scripts/generate-challenges.mjs  # challenge campaign authoring script
```

All progression is stored client-side in `localStorage`, namespaced `motus:v2:`.
Only the leaderboard touches the database.

See [MOTUS_V2.md](./MOTUS_V2.md) for the progression layer's design notes.
