# Motus V2. Gameplay & Progression Update

An additive extension of Motus adding a full progression layer, challenges,
achievements, statistics, cosmetics, plus a design and game-feel refresh, while
preserving the original momentum-based feel. No existing gameplay was rewritten.

---

## Design language: "Signal in the Void"

Near-black canvas, confident neon, generous negative space, a mono "terminal"
type texture for eyebrows and data, hairline rules instead of uniform rounded
cards, and full-bleed panels rather than compact centered modals. The signature
motion is a **streaky light-trail field**: on the title it bends toward the
cursor's velocity; in-game it becomes a parallax speed field that lengthens and
aligns to the player's motion.

- **Title:** large `MOTUS` wordmark + tagline and a console-style numbered menu
  list (two columns on wide screens).
- **Panels** (challenges / settings / profile): full-bleed, left-aligned
  editorial headers, roomy grids, sectioned settings with dividers.
- **End screen:** enlarged, mono score readout, PB badge, run-stat grid.
- **Achievement unlock:** a bold sliding banner with an icon tile, a light-sweep
  shine, and a longer hold.

---

## Features

**Challenge Mode.** 100 handcrafted challenges (`src/lib/data/challenges.json`)
generated from a single global difficulty ramp, so **every challenge is harder
than the one before**. Types include collect-N, sprint (timed), survive, clean
sweep, tiny arena, no-wrap void, reversed controls, low/high friction, sudden
death, swarm, endurance, and **Navigator**, collect orbs while weaving through a
field of static lethal hazards (4→15 hazards as difficulty climbs). Unlock-gated;
tracks stars (speed-based), completion, and best time.

**Cataclysm events (8).** The original five (Precision Run, Chase Sequence, Last
Stand, The Hunt, Trickster) plus three new: **Repulsor** (goals flee the player),
**Blackout** (arena darkens to a light radius around you), and **Meteor Storm**
(fast hazards streak across while you collect).

**Achievements (16).** Persistent, evaluated after each run, announced by the
banner. Milestones for orbs, score, challenges, games, distance, survival time,
and Cataclysms (Storm Survivor / Storm Veteran).

**Statistics.** Lifetime profile: games, wins, deaths, orbs, distance, highest
score, longest survival, play time, fastest speed, longest drift, Cataclysms,
challenges completed, stars.

**Cosmetics + themes.** 8 unlockable arena themes (restyle background, player,
orb, enemy colors), earned player skins, and trail styles, all earned through
play, chosen on the Settings screen.

**End screen.** Final score, New Personal Best badge, challenge stars, run-stat
grid, and instant Retry / Main Menu / Next Challenge.

### Removed in the refresh
The combo multiplier and near-miss bonus were removed (they diluted the core
game). Score is once again a clean **1 point per orb**, which also matches the
leaderboard's historical metric and its elapsed-time anti-cheat bound.

---

## New / changed files

```
src/lib/storage.ts            SSR-safe namespaced localStorage wrapper
src/lib/stats.ts              Lifetime stats + RunSummary + recording
src/lib/achievements.ts       16 achievement predicates + unlock evaluation
src/lib/challenges.ts         Challenge types, unlock gating, star scoring, progress
src/lib/customization.ts      Themes, skins, trails, settings + palette resolver
src/lib/data/challenges.json  100 challenges (generated, committed)
scripts/generate-challenges.mjs   Campaign authoring script (monotonic ramp)

src/components/ChallengeSelect.tsx    Progression screen
src/components/SettingsModal.tsx      Theme / skin / trail selection
src/components/ProfileModal.tsx       Stats + achievements tabs
src/components/EndScreen.tsx          Run-end screen
src/components/AchievementToast.tsx   Bold unlock banner

Modified: GameCanvas.tsx (run stats, challenge mode, obstacles, backgrounds,
themed render), NeonBackground.tsx (streaky field), gameLogic.ts +
cataclysm/events.ts (3 new events), page.tsx (flow + title redesign),
globals.css (design system).
```

---

## Architecture

Progression logic lives in `src/lib` as pure, framework-free modules; challenge
data is separate from challenge logic. One SSR-safe wrapper namespaces every save
under `motus:v2:` and returns fallbacks on the server. `GameCanvas` accumulates
per-run stats and emits a single `RunSummary` via `onRunEnd` (one-shot guarded);
`page.tsx` records stats, scores challenge stars, unlocks achievements, and shows
the end screen. `resolveActiveTheme()` merges the base palette with the selected
theme + skin, and `render()` shadows the base palette import with it so all entity
colors follow the theme with no per-call changes.

---

## Future improvements

- **Interactive playtest pass** to tune the difficulty ramp, star thresholds, and
  obstacle density (systems are build/typecheck/SSR-verified).
- **Audio**, the game is silent; orb pickups, Cataclysm onsets, and achievement
  unlocks are prime SFX moments.
- **In-challenge Cataclysms** and **daily seeds / per-challenge leaderboards**.
- **Cloud sync** of progression (local-only today).
