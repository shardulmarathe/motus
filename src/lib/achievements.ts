// Achievement definitions + unlock evaluation.
//
// Achievements are pure predicates over a snapshot of lifetime stats plus
// optional context from the run/challenge that just finished. `checkAchievements`
// persists newly-unlocked ids and returns them so the UI can animate a toast.

import { readJSON, writeJSON, STORAGE_KEYS } from './storage'
import type { LifetimeStats, RunSummary } from './stats'

export interface AchievementContext {
  stats: LifetimeStats
  lastRun?: RunSummary
  challengesCompleted: number
  highestChallengeCleared: number
  perfectChallengeCleared?: boolean
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  test: (ctx: AchievementContext) => boolean
}

export const achievements: Achievement[] = [
  { id: 'first-death', name: 'First Steps', description: 'Meet your first game over.', icon: '💀',
    test: (c) => c.stats.totalDeaths >= 1 },
  { id: 'first-cataclysm', name: 'Into the Storm', description: 'Trigger your first Cataclysm.', icon: '🌀',
    test: (c) => c.stats.cataclysmsTriggered >= 1 },
  { id: 'orbs-100', name: 'Collector', description: 'Collect 100 orbs in total.', icon: '🟢',
    test: (c) => c.stats.totalOrbs >= 100 },
  { id: 'orbs-500', name: 'Hoarder', description: 'Collect 500 orbs in total.', icon: '💚',
    test: (c) => c.stats.totalOrbs >= 500 },
  { id: 'orbs-1000', name: 'Orb Baron', description: 'Collect 1,000 orbs in total.', icon: '🏵️',
    test: (c) => c.stats.totalOrbs >= 1000 },
  { id: 'score-25', name: 'Getting Warm', description: 'Reach a score of 25 in Survival.', icon: '🔥',
    test: (c) => c.stats.highestScore >= 25 },
  { id: 'score-50', name: 'On a Roll', description: 'Reach a score of 50 in Survival.', icon: '⚡',
    test: (c) => c.stats.highestScore >= 50 },
  { id: 'score-100', name: 'Centurion', description: 'Reach a score of 100 in Survival.', icon: '👑',
    test: (c) => c.stats.highestScore >= 100 },
  { id: 'challenge-10', name: 'Challenger', description: 'Beat 10 challenges.', icon: '🎯',
    test: (c) => c.challengesCompleted >= 10 },
  { id: 'challenge-50', name: 'Trial Master', description: 'Beat 50 challenges.', icon: '🏆',
    test: (c) => c.challengesCompleted >= 50 },
  { id: 'challenge-100', name: 'Completionist', description: 'Beat all 100 challenges.', icon: '🌟',
    test: (c) => c.challengesCompleted >= 100 },
  { id: 'games-100', name: 'Dedicated', description: 'Play 100 games.', icon: '🎮',
    test: (c) => c.stats.gamesPlayed >= 100 },
  { id: 'distance-10000', name: 'Long Hauler', description: 'Travel 10,000 units of distance.', icon: '🛸',
    test: (c) => c.stats.totalDistance >= 10000 },
  { id: 'survive-5min', name: 'Endurance', description: 'Survive a single run for 5 minutes.', icon: '⏳',
    test: (c) => c.stats.longestSurvival >= 300 },
  { id: 'near-miss-master', name: 'Near Miss Master', description: 'Pull off 8 near misses in one run.', icon: '😅',
    test: (c) => (c.lastRun?.nearMisses ?? 0) >= 8 },
  { id: 'perfect-challenge', name: 'Flawless', description: 'Earn 3 stars on a challenge.', icon: '✨',
    test: (c) => c.perfectChallengeCleared === true },
]

type UnlockedMap = Record<string, number> // id -> unlock timestamp (ms)

export function loadUnlocked(): UnlockedMap {
  return readJSON<UnlockedMap>(STORAGE_KEYS.achievements, {})
}

export function isUnlocked(id: string): boolean {
  return id in loadUnlocked()
}

export interface AchievementView extends Achievement {
  unlocked: boolean
  unlockedAt?: number
}

/** Full list with unlock state, for the achievements screen. */
export function achievementViews(): AchievementView[] {
  const unlocked = loadUnlocked()
  return achievements.map((a) => ({ ...a, unlocked: a.id in unlocked, unlockedAt: unlocked[a.id] }))
}

/**
 * Evaluate all achievements against the given context, persist any that newly
 * pass, and return the freshly-unlocked ones (for toast display).
 * `now` is passed in so callers control the timestamp (keeps this pure-ish).
 */
export function checkAchievements(ctx: AchievementContext, now: number): Achievement[] {
  const unlocked = loadUnlocked()
  const fresh: Achievement[] = []

  for (const a of achievements) {
    if (a.id in unlocked) continue
    if (a.test(ctx)) {
      unlocked[a.id] = now
      fresh.push(a)
    }
  }

  if (fresh.length > 0) writeJSON(STORAGE_KEYS.achievements, unlocked)
  return fresh
}
