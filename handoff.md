# Motus — Project Handoff

> Repo folder is named `stay-on-deck`, but the game is branded **Motus** throughout the UI and code.

A Next.js (App Router) + TypeScript arcade game rendered on an HTML5 `<canvas>`. You pilot a
momentum-driven neon puck, collect green orbs for points, dodge red enemies, and survive periodic
"Cataclysm" events. Includes a hardened Neon Postgres leaderboard with server-side anti-cheat.

**V2 progression layer** (shipped): a 100-challenge campaign, achievements, a lifetime-stats
profile, earned cosmetics/arena themes, and a redesigned "Signal in the Void" UI. All progression
is stored client-side in `localStorage` (namespaced `motus:v2:`); only the leaderboard uses Neon.
See **`MOTUS_V2.md`** for the full V2 feature list and architecture.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

**Controls:** Arrow keys or WASD to move · Space to restart after game over · on-screen D-pad on touch devices.

**Required env var** (leaderboard/session signing): `LEADERBOARD_SESSION_SECRET` plus the Neon
Postgres connection string used by `src/lib/db.ts`. Without the secret, the session/leaderboard API
routes throw.

---

## Tech stack

- **Next.js App Router** + React (client-heavy; the game is one big client component).
- **TypeScript** throughout.
- **HTML5 Canvas** for all rendering (no game framework) — main loop in `GameCanvas.tsx`.
- **Neon Postgres** for the leaderboard (migrated from Supabase; see commit `3afd35d`).
- Google Fonts loaded at runtime (`src/lib/fonts.ts`) to avoid flaky Vercel builds (commit `408cf9c`).

---

## Screen flow / site layout

The live experience is a **single client page** (`src/app/page.tsx`) driven by a `uiState` state
machine — gameplay is not routed:

- **`title`** — streaky cursor-reactive backdrop (`NeonBackground`), the big `MOTUS` wordmark, and a
  console-style menu: Play · Challenges · Practice · Tutorial · Leaderboard · Profile · Settings.
- **`rules`** — mode-specific rules / briefing modal (challenges show their objective + hazards). In
  **Survival** it also forces a **username picker** before "Play" unlocks and a signed session is minted.
- **`playing`** — `GameCanvas` runs. HUD shows Score, the challenge/event objective, and (survival)
  the "Next X/10" counter + session Best.
- **`paused`** — Resume / Restart / Menu modal.

Overlays layered on top (managed in `page.tsx`): `ChallengeSelect`, `SettingsModal`, `ProfileModal`,
`EndScreen` (redesigned run-end screen), and `AchievementToast` (bold unlock banner).

> Legacy routes `src/app/rules/page.tsx` and `src/app/game/page.tsx` still exist (older `/game`
> flow) but are not part of the live single-page experience.

---

## Game modes

| Mode | Enemies | Death | Borders | Objective |
|---|---|---|---|---|
| **Tutorial** | Scripted | Restarts current step | Deadly | 8 guided steps (`tutorialLogic.ts`) |
| **Survival** | Yes, scaling | Game over | Deadly | Score + submit to leaderboard |
| **Practice** ("zen") | None | Cannot die | **Wrap-around** | Relaxed orb collecting |
| **Challenge** | Fixed roster + static hazards | Game over | Deadly (or wrap per challenge) | Clear the challenge's goal (`challenges.ts`) |

---

## Core mechanics

Main loop and rendering: `src/components/GameCanvas.tsx`. Math/collision helpers: `src/lib/physics.ts`.

- **Movement (momentum-based):** `acceleration = 1000` px/s² while a direction is held; per-frame
  damping `0.99`; velocity capped at `maxVel = 500` px/s. The puck coasts after keys release — the
  momentum feel is central. A fading trail spawns when speed > 60 px/s.
- **Scoring:** +1 per green orb collected; a new orb respawns immediately, kept clear of edges and
  the player (`spawnGoal` in `gameLogic.ts`).
- **Enemies:** spawn from a random edge aimed at center with jitter; base speed scaled by stage
  (`×(1 + 0.15·(stage−1))`). Enemy cap grows with stage (`12 + 2·stage`, max 80) with a maintained
  minimum. Any enemy contact = game over (in Survival).
- **Borders:** deadly in Tutorial/Survival (with a proximity warning glow); **wrap-around** teleport
  in Practice.

---

## Cataclysm events (the signature system)

Files: `src/lib/gameLogic.ts` (spawn/config) and `src/lib/cataclysm/events.ts` (per-event behavior).

Every **10 orbs** (the HUD "Next 10" counter) triggers a random **30-second** Cataclysm with a
**1.5s intro grace period** (no death during intro). Collect all **7** event goals to clear it and
advance a **stage**; letting the timer hit 0 = game over. Events never repeat back-to-back.

1. **Precision Run** (`staticGoals`) — 7 fixed orbs.
2. **Chase Sequence** (`movingGoals`) — 7 orbs drift and bounce with random direction changes.
3. **Last Stand** (`shrinkingArena`) — arena walls close inward; leaving the safe rectangle kills you.
4. **The Hunt** (`hunt`) — 2–5 purple homing "hunters" seek you while you collect.
5. **Trickster** (`swap`) — red decoys sit on orb positions and swap places every 5s (dashed-line warning).
6. **Repulsor** (`magnet`) — the 7 goals flee from the player when approached.
7. **Blackout** (`blackout`) — the arena darkens to a light radius around the player.
8. **Meteor Storm** (`meteorStorm`) — fast hazards streak across the arena while you collect.

(Cataclysms fire in **Survival** only, not inside Challenge mode.)

**Difficulty scaling** (`getDifficultyMultiplier`): compounds ~6% per stage × ~5% per completed
cataclysm.

---

## Leaderboard & anti-cheat

Files: `src/lib/game-session.ts`, `src/app/api/leaderboard/route.ts`,
`src/app/api/leaderboard/session/route.ts`, `src/lib/leaderboard.ts`, `src/lib/leaderboard-db.ts`.

- **Signed sessions:** starting a Survival run mints an HMAC-SHA256 token (`LEADERBOARD_SESSION_SECRET`)
  bound to username + issued/expiry timestamps, also persisted server-side.
- **Server-side score validation on submit:** verifies the signature, confirms the session exists and
  is unconsumed, then rejects any score exceeding `elapsed_time / 400ms` (`MIN_MS_PER_POINT`).
  Additional guards: `MIN_RUN_MS = 2000`, `MAX_SESSION_MS = 45 min`, and sessions are single-use
  (marked consumed after submit).
- **Username hygiene:** large blocked-words list (`src/lib/blocked-words.json`) + profanity filter
  (`src/lib/profanity.ts`), live "already taken" checks, and 3–20 character validation. Top 7 shown.

---

## Project structure

```
src/
  app/
    page.tsx                 # single-page state machine (title/rules/playing/paused) — the live game
    layout.tsx, globals.css  # shell + all styling
    game/page.tsx            # legacy standalone game route
    rules/page.tsx           # legacy standalone rules route
    api/leaderboard/route.ts             # GET top 7 / POST validated score
    api/leaderboard/session/route.ts     # POST mint signed game session
  components/
    GameCanvas.tsx           # canvas, main loop, all game state (largest file)
    NeonBackground.tsx       # streaky, cursor-reactive title background
    TouchControls.tsx        # on-screen D-pad for touch devices
    LeaderboardModal.tsx     # leaderboard overlay
    ChallengeSelect.tsx      # V2 — 100-challenge progression screen
    SettingsModal.tsx        # V2 — theme / skin / trail selection
    ProfileModal.tsx         # V2 — lifetime stats + achievements
    EndScreen.tsx            # V2 — redesigned run-end screen
    AchievementToast.tsx     # V2 — bold unlock banner
    ParticleBackground.tsx   # UNUSED / untracked — not imported anywhere
    WaterDistortion.tsx      # UNUSED / untracked — not imported anywhere
  lib/
    physics.ts               # vectors, integration, collisions, arena/bounds helpers
    gameLogic.ts             # player/enemy/goal spawning, cataclysm config, difficulty scaling
    cataclysm/events.ts      # the 8 event definitions (onEnter/onUpdate/onRender)
    tutorialLogic.ts         # 8-step tutorial script + progression state
    palette.ts               # color palette + withAlpha helper
    game-session.ts          # HMAC session signing/verification + anti-cheat limits
    leaderboard.ts           # username/score validation, filtering, normalization
    leaderboard-db.ts        # Neon Postgres queries
    db.ts                    # Postgres client
    profanity.ts, blocked-words.json     # username moderation
    fonts.ts                 # runtime Google Fonts loader
    storage.ts               # V2 — SSR-safe namespaced localStorage wrapper
    stats.ts                 # V2 — lifetime stats + per-run summary
    achievements.ts          # V2 — 16 achievement predicates
    challenges.ts            # V2 — challenge types, unlock gating, star scoring
    customization.ts         # V2 — themes, skins, trails, settings + palette resolver
    data/challenges.json     # V2 — the 100 challenges (generated, committed)
scripts/generate-challenges.mjs  # V2 — challenge campaign authoring script
```

See `MOTUS_V2.md` for the V2 design system, progression architecture, and future-work notes.

---

## Known cleanup / notes

- `src/components/ParticleBackground.tsx` and `src/components/WaterDistortion.tsx` are **untracked and
  unused** (nothing imports them). Decide whether to wire them in or delete.
- Two rules surfaces exist (the in-page modal vs. the legacy `/rules` route) and can drift out of
  sync — keep copy consistent or remove the legacy route.
- `GameCanvas.tsx` holds most state and the full loop in one file; the natural next refactor is to
  extract state/update from rendering.
- V2 progression is `localStorage`-only (no accounts). Moving it to Neon would require real auth —
  see the "storage" discussion in `MOTUS_V2.md`.

---

## Branches & deploy

- Single branch: **`master`** (the V2 work was developed on `feature/challenge-mode-progression`,
  then merged). Vercel's Production Branch is `master`; pushing there deploys production.
- Production needs `LEADERBOARD_SESSION_SECRET` and the Neon connection string set in the Vercel
  Production environment, or the leaderboard/session routes fail at runtime.

---

_Last updated: 2026-07-08. V2 (challenge mode + progression + design refresh) merged to `master`._
