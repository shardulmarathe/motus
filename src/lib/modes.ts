// Shared mode/type contracts used by page.tsx, GameCanvas.tsx and the
// multiplayer modules. This is the single source of truth for the mode
// unions that were previously duplicated inline.

export type GameMode = 'survival' | 'zen' | 'tutorial' | 'challenge' | 'multiplayer'

export type MpVariant = 'duel' | 'coop' | 'tag'

export type MpSession =
  | { kind: 'local' }
  | { kind: 'online'; role: 'host' | 'guest'; code: string }

export type MatchEndReason = 'score' | 'timer' | 'wipe' | 'disconnect'

export type MatchResult = {
  variant: MpVariant
  /** 0 = P1, 1 = P2, 'team' for co-op runs (win or lose together) */
  winner: 0 | 1 | 'draw' | 'team'
  /** duel: orbs; coop: shared score twice; tag: seconds spent NOT it */
  scores: [number, number]
  /** total match time in seconds */
  elapsed: number
  reason: MatchEndReason
  /** coop only: cataclysms cleared */
  cataclysmsCleared?: number
}

export const MP_VARIANT_NAMES: Record<MpVariant, string> = {
  duel: 'Orb Duel',
  coop: 'Co-op Survival',
  tag: 'Tag',
}
