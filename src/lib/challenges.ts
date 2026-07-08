// Challenge campaign: typed access to the generated challenge data, plus
// unlock gating, star scoring, and per-challenge progress persistence.
//
// The 100 challenges themselves live in ./data/challenges.json (authored by
// scripts/generate-challenges.mjs). This module keeps gameplay logic separate
// from that data, as the brief requires.

import rawChallenges from './data/challenges.json'
import { readJSON, writeJSON, STORAGE_KEYS } from './storage'
import { loadStats, saveStats } from './stats'

export type ChallengeGoalType = 'orbs' | 'survive' | 'collectAll'

export interface ChallengeGoal {
  type: ChallengeGoalType
  target: number
}

/** Runtime rule tweaks applied by GameCanvas when a challenge is active. */
export interface ChallengeModifiers {
  arenaScale?: number // fraction of full arena (1 = normal, <1 tiny, >1 giant)
  wraparound?: boolean // teleport across walls instead of dying
  reverseControls?: boolean
  friction?: number // per-frame damping override (default 0.99)
  acceleration?: number // input accel override (default 1000)
  frequentCataclysms?: boolean
  randomCataclysm?: boolean
  oneLife?: boolean // no forgiveness — informational (all survival deaths are terminal already)
  movingHazards?: boolean
  noWallTouch?: boolean // touching a wall fails the challenge
}

export interface Challenge {
  id: number
  tier: number
  archetype: string
  title: string
  description: string
  goal: ChallengeGoal
  timeLimit: number // seconds; 0 = untimed
  enemyCount: number
  enemySpeed: number // multiplier applied to base enemy speed
  modifiers: ChallengeModifiers
  stars: { two: number; three: number; mode: 'time' | 'clear' }
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
  timeRemaining: number
  timeLimit: number
  elapsed: number // seconds of active play at completion
  wallTouched: boolean
}

/**
 * Stars reward efficiency:
 *  - timed collect goals → by fraction of the time limit left over;
 *  - untimed collect goals → by clear speed vs a par derived from the goal;
 *  - survive goals → clearing the full duration is itself mastery (3 stars).
 */
export function computeStars(ch: Challenge, perf: ChallengePerf): number {
  if (!perf.completed) return 0

  if (ch.goal.type === 'survive') return 3

  let frac: number
  if (perf.timeLimit > 0) {
    frac = perf.timeRemaining / perf.timeLimit
  } else {
    const par = ch.goal.target * 1.6 + 5 // seconds of "expected" clear time
    frac = (par - perf.elapsed) / par
  }
  frac = Math.max(0, Math.min(1, frac))

  let stars = 1
  if (frac >= 0.2) stars = 2
  if (frac >= 0.45) stars = 3
  return stars
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
