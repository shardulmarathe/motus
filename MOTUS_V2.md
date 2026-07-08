# Motus V2 — Gameplay & Progression Update

Branch: `feature/challenge-mode-progression` (not merged into `main`).

An additive extension of Motus that adds a full progression layer — challenges,
achievements, statistics, cosmetics, combos, and a redesigned end screen — while
preserving the original momentum-based feel. No existing gameplay was rewritten.

---

## Features added

**Challenge Mode (P1).** A new menu entry opens a progression screen of **100
handcrafted challenges** (`src/lib/data/challenges.json`) across 5 difficulty
tiers. Each is unlock-gated behind the previous one and tracks completion, best
stars (0–3), best score, and best time. Challenge types: collect N orbs, survive
N seconds, clear before a timer, tiny arena, giant/no-wrap arena, reversed
controls, low/high friction, accelerated momentum, sudden death (one life),
swarms, relentless waves, and endurance. Star scoring rewards finishing early
(timed goals) or flawless danger-free clears (survival goals).

**Achievements (P2).** 16 persistent achievements evaluated after every run, with
a subtle sliding **unlock toast**. Covers first death/cataclysm, orb milestones
(100/500/1000), score milestones (25/50/100), challenge milestones (10/50/100),
100 games, distance, 5-minute survival, near-miss mastery, and flawless clears.

**Persistent statistics (P3).** A lifetime profile: games played/won, deaths,
orbs, distance, highest score, highest combo, longest survival, total play time,
fastest speed, longest drift, cataclysms, challenges completed, stars, and near
misses. Viewable on the **Profile** screen.

**Redesigned end screen (P4).** Replaces the on-canvas "GAME OVER" text with a
React screen showing final score, a **New Personal Best** badge, challenge stars,
a full run-stat grid, and **Retry / Main Menu / Next Challenge** actions. Retry is
instant (no reload).

**Game feel (P5).** Velocity-reactive player glow, squash/stretch along the
travel direction, themed backgrounds, orb collection bursts, floating combo/near-
miss labels, and a red screen throb in a Cataclysm's final seconds. Camera was
deliberately kept full-field — whole-arena visibility is essential to reading
enemies in this game.

**Combo system (P6).** Collecting orbs in quick succession (2.2s window) builds a
×1–×5 multiplier that boosts the arcade score, shown floating above the player.

**Cosmetics (P7).** Earned player skins and trail styles, selected on the Settings
screen. Everything is unlocked through play — no monetization.

**Arena themes (P8).** 8 unlockable themes (Classic Neon, Azure, Amethyst,
Emerald, Synthwave, Cyberpunk, Matrix, Minimal White) that restyle the arena
background, grid, player, orb, and enemy colors. Optional random-theme-per-run.

**Near miss (P9).** Grazing an enemy without dying awards **+25**, shows a floating
"NEAR MISS", and is tracked in stats.

**Menu polish (P10).** Hover glow on menu buttons and a pop-in animation on the new
overlays; reduced-motion respected throughout.

---

## New files

```
src/lib/storage.ts            SSR-safe namespaced localStorage wrapper
src/lib/stats.ts              Lifetime stats model + RunSummary + recording
src/lib/achievements.ts       16 achievement predicates + unlock evaluation
src/lib/challenges.ts         Challenge types, unlock gating, star scoring, progress
src/lib/customization.ts      Themes, skins, trails, settings + palette resolver
src/lib/data/challenges.json  The 100 challenges (generated, committed)
scripts/generate-challenges.mjs   Authoring script for the campaign

src/components/ChallengeSelect.tsx    Progression screen
src/components/SettingsModal.tsx      Theme / skin / trail selection
src/components/ProfileModal.tsx       Stats + achievements tabs
src/components/EndScreen.tsx          Redesigned run-end screen
src/components/AchievementToast.tsx   Unlock toast queue
```

Modified: `GameCanvas.tsx` (gameplay hooks), `page.tsx` (flow + wiring),
`globals.css` (new UI styles).

---

## Architecture

**Separation of concerns.** All progression logic lives in `src/lib` as pure,
framework-free modules. Challenge *data* (`challenges.json`) is fully separate from
challenge *logic* (`challenges.ts`), as required.

**Persistence.** One SSR-safe wrapper (`storage.ts`) namespaces every save under
`motus:v2:`. It returns fallbacks on the server, so all reads are safe during SSR.

**Run lifecycle.** `GameCanvas` accumulates per-run stats (distance, speed, drift,
orbs, combos, near misses) into a ref and, on game over/win, emits a single
`RunSummary` via `onRunEnd` (guarded so it fires exactly once). `page.tsx` owns the
consequences: `recordRun` folds it into lifetime stats, `recordChallengeResult`
scores stars, `checkAchievements` unlocks and returns toasts, and the end screen is
shown. GameCanvas stays focused on gameplay; the page owns progression + UI.

**Theming.** `resolveActiveTheme()` merges the base palette with the selected
theme + skin into one palette object. `render()` shadows the base `palette` import
with it, so every entity color picks up the theme with no per-call changes.

**Leaderboard integrity.** Combos and near-miss bonuses inflate the on-screen
arcade score, so the online leaderboard keeps submitting **raw orb count** (its
historical metric and anti-cheat contract). The two numbers are intentionally
distinct: arcade score is local flair; the leaderboard ranks orbs.

---

## Future improvements

- **Interactive playtest pass:** systems are build/typecheck/SSR-verified; a human
  browser session should tune combo timing, near-miss band, and star thresholds.
- **In-challenge cataclysms:** the "chaos" archetype was reframed as waves to avoid
  entangling the cataclysm state machine with challenge mode; wiring it in could
  restore true cataclysm challenges.
- **Cloud sync:** progression is local-only; a signed-in sync would carry it across
  devices (the leaderboard backend already has sessions to build on).
- **Daily challenge / seeds** and **per-challenge leaderboards** for replay depth.
- **Audio** — the game is currently silent; combos and near misses are prime SFX
  moments.
- **Giant arena (arenaScale > 1)** via a zoom-out or scrolling camera if the
  full-field constraint is ever relaxed.
