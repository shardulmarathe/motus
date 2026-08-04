// SSR-safe localStorage wrapper for all persistent progression data.
//
// All V2 progression state (stats, achievements, challenge progress, cosmetics,
// settings) is namespaced under a single prefix + schema version so the whole
// save can be reasoned about and migrated as one unit.

const PREFIX = 'motus:v2:'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

/** Read a JSON value from storage, returning `fallback` on any failure. */
export function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Persist a JSON value. Silently no-ops if storage is unavailable. */
export function writeJSON<T>(key: string, value: T): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage full / unavailable, progression is best-effort, never fatal
  }
}

/** Remove a single namespaced key. */
export function removeKey(key: string): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

export const STORAGE_KEYS = {
  stats: 'stats',
  achievements: 'achievements',
  challenges: 'challenges',
  cosmetics: 'cosmetics',
  settings: 'settings',
} as const
