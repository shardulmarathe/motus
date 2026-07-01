import type { SupabaseClient } from '@supabase/supabase-js'
import { isAppropriateUsername } from './profanity'

export type LeaderboardEntry = {
  username: string
  score: number
  updated_at: string
}

export const LEADERBOARD_TOP_N = 7

const USERNAME_RE = /^[a-zA-Z0-9 _-]{2,16}$/

export function isValidUsername(name: string): boolean {
  const trimmed = name.trim()
  return USERNAME_RE.test(trimmed)
}

export function isAllowedUsername(name: string): boolean {
  return isValidUsername(name) && isAppropriateUsername(name)
}

export { isAppropriateUsername }

export function normalizeUsername(name: string): string {
  return name.trim()
}

export function usernamesMatch(a: string, b: string): boolean {
  return normalizeUsername(a).toLowerCase() === normalizeUsername(b).toLowerCase()
}

/** True if name is taken by someone else on the current top 7 (exempt = returning player's saved name). */
export function isUsernameTakenOnLeaderboard(
  name: string,
  entries: LeaderboardEntry[],
  exemptUsername?: string | null
): boolean {
  return isUsernameTakenOnTopLeaderboard(name, entries, exemptUsername)
}

export function isUsernameTakenOnTopLeaderboard(
  name: string,
  entries: LeaderboardEntry[],
  exemptUsername?: string | null
): boolean {
  const normalized = normalizeUsername(name).toLowerCase()
  if (exemptUsername && usernamesMatch(name, exemptUsername)) return false
  return entries.some((entry) => entry.username.toLowerCase() === normalized)
}

export function isValidScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 999999
}

export const PLAYER_NAME_STORAGE_KEY = 'motus-player-name'

export function loadRegisteredPlayerName(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY)
    if (saved && isAllowedUsername(saved)) return normalizeUsername(saved)
    if (saved) localStorage.removeItem(PLAYER_NAME_STORAGE_KEY)
  } catch {
    // storage unavailable
  }
  return null
}

export function saveRegisteredPlayerName(name: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, normalizeUsername(name))
  } catch {
    // storage unavailable
  }
}

/** Case-insensitive lookup across the full leaderboard table. */
export async function findLeaderboardEntry(
  supabase: SupabaseClient,
  username: string
): Promise<LeaderboardEntry | null> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('username, score, updated_at')

  if (error || !data) return null

  return data.find((entry) => usernamesMatch(entry.username, username)) ?? null
}
