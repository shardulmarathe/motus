import { Puck } from '../physics'

// Per-player slot state for multiplayer. In single-player modes GameCanvas
// holds one slot whose puck aliases playerRef.current, so every existing
// read of playerRef keeps working unchanged.

export type InputMap = {
  up: string[]
  down: string[]
  left: string[]
  right: string[]
}

/** P1 in local multiplayer */
export const P1_KEYS: InputMap = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
}

/** P2 in local multiplayer (also what TouchControls synthesizes) */
export const P2_KEYS: InputMap = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
}

/** Single-player: arrows and WASD both steer the one puck (existing behavior) */
export const SP_KEYS: InputMap = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
}

export type PlayerSlot = {
  puck: Puck
  index: 0 | 1
  colors: { body: string; light: string }
  inputMap: InputMap
  /** coop: false while downed */
  alive: boolean
  /** sim-elapsed timestamp the player went down, null when up */
  downedAt: number | null
  /** duel: sim-elapsed timestamp the stun ends (0 = not stunned) */
  stunnedUntil: number
  /** post-stun / post-revive grace window end */
  immuneUntil: number
  /** duel: orbs collected; tag: accumulated seconds spent as "it" */
  score: number
  /** tag role */
  isIt: boolean
}

export function isDirectionHeld(keys: Set<string>, codes: string[]): boolean {
  for (const code of codes) if (keys.has(code)) return true
  return false
}

/**
 * The puck of the nearest player that is up (alive and not downed).
 * Falls back to slot 0's puck so seek math never divides by nothing.
 */
export function nearestLivingPlayer(slots: PlayerSlot[], x: number, y: number): Puck {
  let best: Puck | null = null
  let bestD = Infinity
  for (const s of slots) {
    if (!s.alive) continue
    const dx = s.puck.x - x
    const dy = s.puck.y - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = s.puck
    }
  }
  return best ?? slots[0].puck
}

export function livingPlayers(slots: PlayerSlot[]): PlayerSlot[] {
  return slots.filter((s) => s.alive)
}

// --- P2 colors ---
//
// P2 is a *second pen*, not a second lamp. P1 already holds the instrument's
// own signal color, hazards hold red, and targets hold the foreground mark -
// so P2 takes the one hue none of the eight instruments spends: violet. It
// stays clear of the signal on every theme (green scope, amber tube, white
// blueprint, blue plotter), clear of hazard red, and clear of graphite.
//
// One hex cannot hold contrast against light stock *and* a near-black tube, so
// the pen has two nibs: a deep violet that presses into paper and a pale violet
// that reads on a lit instrument. `pickP2Colors` picks by medium. `MP_P2_BODY`
// is the mid value the DOM uses, which survives either chassis.
//
// Hue is NOT the load-bearing distinction. The renderer draws P2 as an annulus
// (hollow puck) against P1's solid disc, so the two read apart in monochrome,
// at speed, and for protan/deutan players. The colors below are the second
// signal, not the first.

/** Mid violet, the DOM value, legible on a dark chassis and on stock. */
export const MP_P2_BODY = '#8f5cf0'
export const MP_P2_LIGHT = '#bfa1f7'
/** The same pen pressed into paper, where a pale violet would not register. */
export const MP_P2_PRINT_BODY = '#5b2d91'
export const MP_P2_PRINT_LIGHT = '#8a63bd'
/** And driven on a tube, where a deep violet sinks into the field. */
export const MP_P2_LUMINOUS_BODY = '#b47ae8'
export const MP_P2_LUMINOUS_LIGHT = '#dcbcf6'

// Fallback pen, used only when P1 is itself violet (the Violet skin). Green is
// the next hue clear of red, of every theme's signal, and of violet.
export const MP_P2_ALT_BODY = '#126b4a'
export const MP_P2_ALT_LIGHT = '#3f9c78'
export const MP_P2_ALT_LUMINOUS_BODY = '#43c98d'
export const MP_P2_ALT_LUMINOUS_LIGHT = '#9fe9c6'

/**
 * RGB distance below which two body colors read as "the same mark". Wide enough
 * to catch two violets of different value, which the eye merges at speed even
 * though their components are far apart.
 */
const COLOR_CLASH_DISTANCE = 122

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** Plain RGB distance, enough to catch "these are the same gray". */
function colorDistance(a: string, b: string): number | null {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return null
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b)
}

/**
 * The second pen, chosen for the medium. `luminous` is the theme's own flag, so
 * a printed instrument gets the deep nib and a tube the pale one. If P1 is
 * itself violet, both fall back to green rather than asking the player to tell
 * two violets apart mid-drift.
 */
export function pickP2Colors(
  p1Body: string,
  luminous = false
): { body: string; light: string } {
  const violet = luminous
    ? { body: MP_P2_LUMINOUS_BODY, light: MP_P2_LUMINOUS_LIGHT }
    : { body: MP_P2_PRINT_BODY, light: MP_P2_PRINT_LIGHT }
  const d = colorDistance(p1Body, violet.body)
  if (d !== null && d < COLOR_CLASH_DISTANCE) {
    return luminous
      ? { body: MP_P2_ALT_LUMINOUS_BODY, light: MP_P2_ALT_LUMINOUS_LIGHT }
      : { body: MP_P2_ALT_BODY, light: MP_P2_ALT_LIGHT }
  }
  return violet
}
