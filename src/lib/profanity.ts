import BLOCKED_WORDS_LIST from './blocked-words.json'

const BLOCKED_WORDS = new Set(BLOCKED_WORDS_LIST as string[])

const LEET_MAP: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '3': 'e',
  '€': 'e',
  '6': 'g',
  '!': 'i',
  '1': 'i',
  '|': 'i',
  '0': 'o',
  '9': 'g',
  '$': 's',
  '5': 's',
  '7': 't',
  '+': 't',
  '2': 'z',
}

/** Minimum length for glued-string detection (avoids "class" → "ass"). */
const GLUED_MIN_LEN = 4

/** Collapse stretched spellings: goooon → goon */
function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/g, '$1')
}

/** Normalize for matching: leetspeak, strip separators, collapse repeats. */
export function normalizeForProfanityCheck(name: string): string {
  let s = name.toLowerCase()
  for (const [from, to] of Object.entries(LEET_MAP)) {
    s = s.split(from).join(to)
  }
  s = s.replace(/[^a-z0-9]/g, '')
  return collapseRepeats(s)
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s_.-]+/)
    .map((t) => normalizeForProfanityCheck(t))
    .filter((t) => t.length >= 2)
}

function matchesBlocked(normalized: string): boolean {
  if (normalized.length < 2) return true

  if (BLOCKED_WORDS.has(normalized)) return true

  for (const word of BLOCKED_WORDS) {
    if (word.length < GLUED_MIN_LEN) {
      if (normalized === word) return true
      continue
    }
    if (normalized.includes(word)) return true
  }

  return false
}

export function isAppropriateUsername(name: string): boolean {
  const normalized = normalizeForProfanityCheck(name)
  if (normalized.length < 2) return false

  if (matchesBlocked(normalized)) return false

  for (const token of tokenize(name)) {
    if (matchesBlocked(token)) return false
  }

  return true
}

export const BLOCKED_WORD_COUNT = BLOCKED_WORDS.size
