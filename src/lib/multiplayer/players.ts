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
// P1 always uses the active theme palette. P2 uses the Ember amber pair,
// falling back to Synthwave magenta when P1's resolved body color sits too
// close to amber on the hue wheel (e.g. Cyberpunk yellow, Ember/Gold skins).

export const MP_P2_BODY = '#ff8a3d'
export const MP_P2_LIGHT = '#ffd0a8'
export const MP_P2_ALT_BODY = '#ff5cf0'
export const MP_P2_ALT_LIGHT = '#ffc2f7'

const AMBER_HUE = 28
const HUE_CLASH_DEGREES = 45

function hexToHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return null // achromatic — never clashes
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

export function pickP2Colors(p1Body: string): { body: string; light: string } {
  const hue = hexToHue(p1Body)
  if (hue !== null) {
    const diff = Math.min(Math.abs(hue - AMBER_HUE), 360 - Math.abs(hue - AMBER_HUE))
    if (diff < HUE_CLASH_DEGREES) return { body: MP_P2_ALT_BODY, light: MP_P2_ALT_LIGHT }
  }
  return { body: MP_P2_BODY, light: MP_P2_LIGHT }
}
