// Challenge campaign: typed access to the generated challenge data, plus
// unlock gating, star scoring, and per-challenge progress persistence.
//
// The 100 challenges themselves live in ./data/challenges.json (authored by
// scripts/generate-challenges.mjs). This module keeps gameplay logic separate
// from that data, as the brief requires.

import rawChallenges from './data/challenges.json'
import { readJSON, writeJSON, STORAGE_KEYS } from './storage'
import { loadStats, saveStats } from './stats'
import {
  parSeconds,
  surviveStarOrbs,
  TWO_STAR_PAR_MULT,
  REFERENCE_ARENA,
  type ChallengeFeel,
} from './challenge-par'

export type ChallengeGoalType = 'orbs' | 'survive' | 'collectAll'

export interface ChallengeGoal {
  type: ChallengeGoalType
  target: number
}

/**
 * Runtime rule tweaks applied by GameCanvas when a challenge is active.
 *
 * Every field here must change something the player can feel. Modifiers that
 * read as flavour but resolve to the base rules (a "one life" flag in a game
 * where every hit is fatal, "walls are lethal" where they already are) make
 * distinct-looking challenges play identically, so they don't belong.
 */
export interface ChallengeModifiers {
  arenaScale?: number // fraction of full arena (1 = normal, <1 tiny)
  shrinkTo?: number // arena closes to this fraction of its start over the run
  wraparound?: boolean // teleport across walls instead of dying
  noWallTouch?: boolean // wall contact fails the run (only meaningful with wraparound)
  reverseControls?: boolean
  feel?: ChallengeFeel // handling preset: 'ice' (slick) or 'heavy' (sluggish)
  movingOrbs?: boolean // orbs drift instead of sitting still
  homingEnemies?: number // how many of the roster steer toward the player
  obstacles?: number // count of lethal hazards that block the route
  movingHazards?: boolean // those hazards drift and bounce
}

export interface Challenge {
  id: number
  tier: number
  archetype: string
  title: string
  description: string
  goal: ChallengeGoal
  /**
   * Deadline as a multiple of par, or 0 for untimed. Deadlines are derived at
   * run time rather than authored in seconds so they scale with the arena — a
   * fixed second count is either trivial on a small window or impossible on a
   * large one.
   */
  deadlineMult: number
  enemyCount: number
  enemySpeed: number // multiplier applied to base enemy speed
  modifiers: ChallengeModifiers
  /**
   * Collect goals: unused (thresholds come from par). Survive goals: the
   * fraction of collectable orbs needed for two and three stars.
   */
  stars: { two: number; three: number; mode: 'par' | 'survive' }
}

export const challenges = rawChallenges as Challenge[]

export function getChallenge(id: number): Challenge | undefined {
  return challenges.find((c) => c.id === id)
}

// ── Progress persistence ────────────────────────────────────────────────

export interface ChallengeRecord {
  completed: boolean
  bestStars: number
  bestScore: number
  bestTimeMs: number // fastest clear; 0 if never cleared
}

export type ChallengeProgress = Record<number, ChallengeRecord>

export function loadProgress(): ChallengeProgress {
  return readJSON<ChallengeProgress>(STORAGE_KEYS.challenges, {})
}

export function isChallengeUnlocked(id: number, progress: ChallengeProgress = loadProgress()): boolean {
  if (id <= 1) return true
  return progress[id - 1]?.completed === true
}

/** Performance snapshot used to score stars, produced by the game loop. */
export interface ChallengePerf {
  completed: boolean
  elapsed: number // seconds of active play at completion
  orbs: number // orbs collected over the run
  wallTouched: boolean // grazed the boundary at any point
  arenaWidth: number // the canvas the run was actually played on
  arenaHeight: number
}

/**
 * Stars are scored against par — the time a skilled player needs for a clean
 * run of *this* challenge on *this* screen (see ./challenge-par).
 *
 *  - collect goals → 3 stars at par, 2 stars at 1.45x par, 1 star for clearing;
 *  - survive goals → the clear is one star; orbs banked while surviving earn
 *    the rest, so outlasting the clock is a floor rather than a perfect score.
 *
 * `noWallTouch` challenges then cap the result at one star if the boundary was
 * ever grazed. The wall is a scoring line there, not a wall — wrapping through
 * it is survivable, which is the whole point of the archetype.
 */
export function computeStars(ch: Challenge, perf: ChallengePerf): number {
  if (!perf.completed) return 0

  const w = perf.arenaWidth || REFERENCE_ARENA.width
  const h = perf.arenaHeight || REFERENCE_ARENA.height

  if (ch.modifiers.noWallTouch && perf.wallTouched) return 1

  if (ch.goal.type === 'survive') {
    const need = surviveStarOrbs(ch, w, h)
    if (perf.orbs >= need.three) return 3
    if (perf.orbs >= need.two) return 2
    return 1
  }

  const par = parSeconds(ch, w, h)
  if (perf.elapsed <= par) return 3
  if (perf.elapsed <= par * TWO_STAR_PAR_MULT) return 2
  return 1
}

/**
 * What the player has to do for each star, in plain text. Needs the live arena
 * because both par and the survive orb targets scale with it.
 */
export function starRequirements(ch: Challenge, width: number, height: number): string[] {
  const clean = ch.modifiers.noWallTouch ? ', never touching a wall' : ''
  if (ch.goal.type === 'survive') {
    const need = surviveStarOrbs(ch, width, height)
    return [
      'Outlast the clock',
      `Bank ${need.two} orbs${clean}`,
      `Bank ${need.three} orbs${clean}`,
    ]
  }
  const par = parSeconds(ch, width, height)
  return [
    'Clear the goal',
    `Clear in ${Math.round(par * TWO_STAR_PAR_MULT)}s${clean}`,
    `Clear in ${Math.round(par)}s${clean}`,
  ]
}

export interface ChallengeResultSummary {
  progress: ChallengeProgress
  completedCount: number
  highestCleared: number
  totalStars: number
  newlyCompleted: boolean
  improvedStars: boolean
}

/**
 * Record a finished challenge attempt: updates the per-challenge best, mirrors
 * aggregate challenge stats into lifetime stats, and returns a fresh summary.
 */
export function recordChallengeResult(
  id: number,
  result: { completed: boolean; stars: number; score: number; timeMs: number }
): ChallengeResultSummary {
  const progress = loadProgress()
  const prev = progress[id]
  const wasCompleted = prev?.completed === true
  const prevStars = prev?.bestStars ?? 0

  const record: ChallengeRecord = {
    completed: wasCompleted || result.completed,
    bestStars: Math.max(prevStars, result.completed ? result.stars : 0),
    bestScore: Math.max(prev?.bestScore ?? 0, result.score),
    bestTimeMs:
      result.completed && result.timeMs > 0
        ? prev?.bestTimeMs
          ? Math.min(prev.bestTimeMs, result.timeMs)
          : result.timeMs
        : prev?.bestTimeMs ?? 0,
  }
  progress[id] = record
  writeJSON(STORAGE_KEYS.challenges, progress)

  const summary = summarizeProgress(progress)

  // Mirror totals into lifetime stats so achievements + the profile screen see them.
  const stats = loadStats()
  stats.challengesCompleted = summary.completedCount
  stats.starsEarned = summary.totalStars
  saveStats(stats)

  return {
    ...summary,
    newlyCompleted: result.completed && !wasCompleted,
    improvedStars: result.completed && result.stars > prevStars,
  }
}

function summarizeProgress(progress: ChallengeProgress) {
  let completedCount = 0
  let highestCleared = 0
  let totalStars = 0
  for (const ch of challenges) {
    const rec = progress[ch.id]
    if (rec?.completed) {
      completedCount++
      highestCleared = Math.max(highestCleared, ch.id)
    }
    totalStars += rec?.bestStars ?? 0
  }
  return { progress, completedCount, highestCleared, totalStars }
}

export function challengeStats() {
  return summarizeProgress(loadProgress())
}
