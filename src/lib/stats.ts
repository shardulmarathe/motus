// Persistent lifetime statistics + per-run summary model.
//
// A `RunSummary` is produced by the game loop when a run ends; `recordRun`
// folds it into the persistent `LifetimeStats`. The end screen renders the
// summary, and achievements are evaluated against the merged lifetime stats.

import { readJSON, writeJSON, STORAGE_KEYS } from './storage'

export type GameModeId = 'survival' | 'zen' | 'tutorial' | 'challenge'

export interface RunSummary {
  mode: GameModeId
  score: number
  timeSurvived: number // seconds
  orbsCollected: number
  distanceTraveled: number // pixels
  longestDrift: number // pixels — longest single no-input glide
  averageSpeed: number // px/s
  highestSpeed: number // px/s
  cataclysmsTriggered: number
  won: boolean
  challengeId?: number
  starsEarned?: number
  /**
   * The run's speed trace (px/s, oldest first), sampled by src/lib/telemetry.
   * Plotted on the end screen. In-memory only — `recordRun` folds scalars into
   * `LifetimeStats` and the summary itself is never persisted.
   */
  speedSamples?: number[]
}

export interface LifetimeStats {
  gamesPlayed: number
  gamesWon: number
  totalDeaths: number
  totalOrbs: number
  totalDistance: number
  highestScore: number
  longestSurvival: number // seconds
  totalPlayTime: number // seconds
  fastestSpeed: number // px/s
  longestDrift: number // pixels
  cataclysmsTriggered: number
  challengesCompleted: number
  starsEarned: number
}

export function defaultStats(): LifetimeStats {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    totalDeaths: 0,
    totalOrbs: 0,
    totalDistance: 0,
    highestScore: 0,
    longestSurvival: 0,
    totalPlayTime: 0,
    fastestSpeed: 0,
    longestDrift: 0,
    cataclysmsTriggered: 0,
    challengesCompleted: 0,
    starsEarned: 0,
  }
}

export function loadStats(): LifetimeStats {
  return { ...defaultStats(), ...readJSON<Partial<LifetimeStats>>(STORAGE_KEYS.stats, {}) }
}

export function saveStats(stats: LifetimeStats): void {
  writeJSON(STORAGE_KEYS.stats, stats)
}

export interface RecordRunResult {
  stats: LifetimeStats
  newPersonalBest: boolean
}

/**
 * Merge a finished run into lifetime stats and persist.
 * Tutorial runs are ignored for lifetime totals (they are practice).
 */
export function recordRun(summary: RunSummary): RecordRunResult {
  const stats = loadStats()

  if (summary.mode === 'tutorial') {
    return { stats, newPersonalBest: false }
  }

  const scoreCountsForBest = summary.mode === 'survival'
  const newPersonalBest = scoreCountsForBest && summary.score > stats.highestScore

  const next: LifetimeStats = {
    gamesPlayed: stats.gamesPlayed + 1,
    gamesWon: stats.gamesWon + (summary.won ? 1 : 0),
    totalDeaths: stats.totalDeaths + (summary.won ? 0 : 1),
    totalOrbs: stats.totalOrbs + summary.orbsCollected,
    totalDistance: stats.totalDistance + summary.distanceTraveled,
    highestScore: scoreCountsForBest ? Math.max(stats.highestScore, summary.score) : stats.highestScore,
    longestSurvival: Math.max(stats.longestSurvival, summary.timeSurvived),
    totalPlayTime: stats.totalPlayTime + summary.timeSurvived,
    fastestSpeed: Math.max(stats.fastestSpeed, summary.highestSpeed),
    longestDrift: Math.max(stats.longestDrift, summary.longestDrift),
    cataclysmsTriggered: stats.cataclysmsTriggered + summary.cataclysmsTriggered,
    challengesCompleted: stats.challengesCompleted, // updated by challenge system on first clear
    starsEarned: stats.starsEarned, // updated by challenge system
  }

  saveStats(next)
  return { stats: next, newPersonalBest }
}

const STAT_LABELS: Record<keyof LifetimeStats, string> = {
  gamesPlayed: 'Games Played',
  gamesWon: 'Games Won',
  totalDeaths: 'Total Deaths',
  totalOrbs: 'Total Orbs Collected',
  totalDistance: 'Total Distance',
  highestScore: 'Highest Score',
  longestSurvival: 'Longest Survival',
  totalPlayTime: 'Total Play Time',
  fastestSpeed: 'Fastest Speed',
  longestDrift: 'Longest Drift',
  cataclysmsTriggered: 'Cataclysms Triggered',
  challengesCompleted: 'Challenges Completed',
  starsEarned: 'Stars Earned',
}

export function statLabel(key: keyof LifetimeStats): string {
  return STAT_LABELS[key]
}

/**
 * Compact large numbers so big readouts never overflow their box:
 * 950 → "950", 1_200 → "1.2k", 3_400_000 → "3.4M", 1_100_000_000 → "1.1B".
 */
export function formatCompact(value: number): string {
  const n = Math.round(value)
  const abs = Math.abs(n)
  if (abs < 1000) return n.toLocaleString()
  for (const { v, s } of [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'k' },
  ]) {
    if (abs >= v) {
      const scaled = n / v
      // One decimal below 100 of a unit (1.2k), none above (340k)
      const str = scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1).replace(/\.0$/, '')
      return `${str}${s}`
    }
  }
  return n.toLocaleString()
}

/** Human-readable value formatting for the stats/profile screen. */
export function formatStat(key: keyof LifetimeStats, value: number): string {
  switch (key) {
    case 'totalDistance':
    case 'longestDrift':
      return `${formatCompact(value)} px`
    case 'fastestSpeed':
      return `${Math.round(value)} px/s`
    case 'longestSurvival':
    case 'totalPlayTime':
      return formatDuration(value)
    default:
      return Math.round(value).toLocaleString()
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
