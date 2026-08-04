// Calibrated difficulty model for the challenge campaign.
//
// Star thresholds used to come from a magic formula (`target * 1.6 + 5` seconds
// of par, three stars at 45% of it left over). That made three stars
// mathematically unreachable: driving the real physics with a flawless
// controller and *zero* enemies on screen takes ~1.28 s per orb on a 1200x680
// arena, while the old rule demanded 0.95-1.19 s. It also meant your rating
// depended on your window size, since par was fixed but travel distance is not.
//
// Par is now derived from the things that actually decide how long a run takes:
// how far you have to travel (arena area), how the puck handles, and how much
// of your attention the hazards steal. Every threshold is a multiple of par, so
// the bar tracks the challenge instead of drifting away from it.

import type { Challenge, ChallengeModifiers } from './challenges'

/** Arena the authored constants were measured against. */
export const REFERENCE_ARENA = { width: 1200, height: 680 }

// Measured by simulating the real movement code (accel 1000, damping 0.99,
// maxVel 500) against this repo's orb spawn distribution across arena sizes:
//   1400x760 -> 1.41 s/orb   1200x680 -> 1.28   900x520 -> 1.06   700x420 -> 0.89
// Those points are linear in sqrt(area) to within 2%.
const BOT_SECONDS_INTERCEPT = 0.314
const BOT_SECONDS_PER_ROOT_AREA = 0.001063

/**
 * How long a flawless controller needs per orb on an empty arena of this size.
 * This is the floor: no human beats it, and nothing on screen makes it faster.
 */
export function botSecondsPerOrb(width: number, height: number): number {
  return BOT_SECONDS_INTERCEPT + BOT_SECONDS_PER_ROOT_AREA * Math.sqrt(width * height)
}

/**
 * Gap between the flawless line and a skilled player having a clean run.
 * Three stars sits exactly here, reachable on a good attempt, missed on a
 * sloppy one.
 */
const SKILL_FACTOR = 1.3

/** Fixed cost of getting moving at the start of a run. */
const STARTUP_SECONDS = 1.2

/** Two stars is a comfortable clear; one star is just clearing. */
export const TWO_STAR_PAR_MULT = 1.45

/** Timed challenges get a deadline this many times par, so clearing is never a coin flip. */
const DEFAULT_DEADLINE_MULT = 1.7

/** Handling presets. The par cost of each is measured the same way as the base. */
export const FEEL_PRESETS = {
  ice: { friction: 0.997, acceleration: 1200, parMult: 0.95 },
  heavy: { friction: 0.97, acceleration: 760, parMult: 1.25 },
} as const

export type ChallengeFeel = keyof typeof FEEL_PRESETS

/** The play rectangle a challenge starts with, after any arena scaling. */
export function challengeArenaSize(width: number, height: number, mods: ChallengeModifiers) {
  const s = mods.arenaScale ?? 1
  return { width: width * s, height: height * s }
}

/**
 * Cost multipliers for modifiers that slow a player down without changing how
 * far they have to travel. Reversed controls and fleeing orbs cost a human far
 * more than they cost the simulated floor, so these are calibrated against
 * play, not the bot.
 */
function controlMultiplier(mods: ChallengeModifiers): number {
  let m = 1
  if (mods.feel) m *= FEEL_PRESETS[mods.feel].parMult
  if (mods.reverseControls) m *= 1.3
  if (mods.movingOrbs) m *= 1.3
  if (mods.noWallTouch) m *= 1.2 // forces conservative routing away from the edges
  return m
}

/**
 * How much of the run is spent dodging rather than collecting. Homing enemies
 * demand continuous attention, so they count double.
 */
function pressureMultiplier(ch: Challenge): number {
  const homing = ch.modifiers.homingEnemies ?? 0
  const threat = ch.enemyCount + homing
  const enemies = Math.min(2.0, 1 + 0.026 * threat * ch.enemySpeed)

  const hazards = ch.modifiers.obstacles ?? 0
  const hazardWeight = ch.modifiers.movingHazards ? 1.6 : 1
  const obstacles = Math.min(1.7, 1 + 0.014 * hazards * hazardWeight)

  // A closing arena spends the back half of the run at a size the base par
  // never saw; charge for the average shortfall.
  const collapse = ch.modifiers.shrinkTo ? 1 + (1 - ch.modifiers.shrinkTo) * 0.5 : 1

  return enemies * obstacles * collapse
}

/** Seconds a skilled player spends per orb under this challenge's rules. */
export function secondsPerOrb(ch: Challenge, width: number, height: number): number {
  const arena = challengeArenaSize(width, height, ch.modifiers)
  return (
    botSecondsPerOrb(arena.width, arena.height) *
    controlMultiplier(ch.modifiers) *
    pressureMultiplier(ch) *
    SKILL_FACTOR
  )
}

/**
 * Reference clear time for a collect goal, the three-star bar. Scales with the
 * real arena, so the same play earns the same rating on any screen.
 */
export function parSeconds(ch: Challenge, width: number, height: number): number {
  if (ch.goal.type === 'survive') return ch.goal.target
  return ch.goal.target * secondsPerOrb(ch, width, height) + STARTUP_SECONDS
}

/**
 * The run's deadline in seconds, or 0 for untimed. Survive goals are their own
 * clock; timed collect goals get a deadline derived from par, which is why no
 * challenge can be authored unclearable.
 */
export function challengeTimeLimit(ch: Challenge, width: number, height: number): number {
  if (ch.goal.type === 'survive') return ch.goal.target
  if (!ch.deadlineMult) return 0
  // A deadline tighter than the two-star bar would make two stars unwinnable -
  // you would fail the run before you could earn them. Clamp rather than trust
  // the authored value, so no future tuning pass can reintroduce that.
  const mult = Math.max(ch.deadlineMult || DEFAULT_DEADLINE_MULT, TWO_STAR_PAR_MULT * 1.1)
  return Math.round(parSeconds(ch, width, height) * mult)
}

/**
 * Orb counts that upgrade a survive clear to two and three stars. Surviving the
 * full duration used to award three stars outright, which made the survive
 * challenges the only reliable stars in the game and left nothing to master.
 */
export function surviveStarOrbs(ch: Challenge, width: number, height: number) {
  if (ch.goal.type !== 'survive') return { two: 0, three: 0 }
  const perOrb = secondsPerOrb(ch, width, height)
  const reachable = ch.goal.target / perOrb
  return {
    two: Math.max(1, Math.round(reachable * (ch.stars.two || 0.35))),
    three: Math.max(2, Math.round(reachable * (ch.stars.three || 0.6))),
  }
}
