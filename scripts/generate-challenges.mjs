// Generates the 100-challenge campaign as static JSON.
//
// Two rules shape the output:
//
//  1. Mechanics arrive over time. Archetypes are gated by tier, so the campaign
//     keeps introducing rules the player has never seen through to level 100.
//     (Cycling every archetype through the first fourteen levels, as this
//     script used to, meant levels 15-100 had nothing left to show.)
//  2. A repeat is never just bigger numbers. Every archetype carries a list of
//     twists — a compatible second modifier — and each successive instance
//     takes the next one, so Collector V plays unlike Collector I.
//
// Difficulty still rises monotonically with id via the global ramp t, but the
// *time* budget no longer lives here: deadlines and star thresholds are derived
// at run time from the real arena (see src/lib/challenge-par.ts). This file
// authors intent; the game measures the bar.
//
// Re-run with:  node scripts/generate-challenges.mjs

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'lib', 'data', 'challenges.json')

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
const r = (n) => Math.round(n)
const lerp = (a, b, t) => a + (b - a) * t

// Deterministic RNG so regenerating never reshuffles a player's campaign.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(0x4d4f5455) // "MOTU"

// ── Twists ──────────────────────────────────────────────────────────────
// A twist is a second rule layered onto an archetype. Each declares the challenge
// id it unlocks at, so early instances stay clean and later ones compound.

const TWISTS = {
  none: { unlockAt: 1, mods: {}, note: '' },
  tight: { unlockAt: 12, mods: { arenaScale: 0.72 }, note: 'in a tighter arena' },
  ice: { unlockAt: 24, mods: { feel: 'ice' }, note: 'on ice' },
  heavy: { unlockAt: 40, mods: { feel: 'heavy' }, note: 'with heavy controls' },
  wrap: { unlockAt: 20, mods: { wraparound: true }, note: 'with wrapping walls' },
  moving: { unlockAt: 28, mods: { movingOrbs: true }, note: 'as the orbs drift' },
  hunters: { unlockAt: 34, mods: { homingEnemies: 2 }, note: 'with hunters on your tail' },
  mines: { unlockAt: 44, mods: { obstacles: 6 }, note: 'through a minefield' },
  drifting: { unlockAt: 58, mods: { obstacles: 5, movingHazards: true }, note: 'as mines drift past' },
  mirror: { unlockAt: 50, mods: { reverseControls: true }, note: 'with reversed controls' },
  collapse: { unlockAt: 66, mods: { shrinkTo: 0.6 }, note: 'as the walls close in' },
}

/** Twists that would duplicate or contradict what an archetype already does. */
const CONFLICTS = {
  collector: [],
  sprint: [],
  sweep: [],
  survivor: ['moving'],
  navigate: ['mines', 'drifting'],
  tiny: ['tight', 'collapse'],
  mirror: ['mirror'],
  ice: ['ice', 'heavy'],
  heavy: ['heavy', 'ice'],
  weave: ['wrap'],
  swarm: ['hunters'],
  hunt: ['hunters'],
  chase: ['moving'],
  endurance: ['moving'],
  minefield: ['mines', 'drifting'],
  untouchable: ['wrap', 'tight'],
  collapse: ['collapse', 'tight'],
}

// ── Archetypes ──────────────────────────────────────────────────────────
// `unlockAt` is the challenge id where a mechanic first becomes eligible. The
// schedule is deliberately staggered rather than tier-chunked, so a new rule
// lands every few levels instead of five at once. `build` maps the global ramp
// t (0..1) to the challenge body.

const archetypes = [
  {
    key: 'collector',
    unlockAt: 1,
    twists: ['none', 'tight', 'wrap', 'moving', 'hunters', 'mirror', 'collapse'],
    build: (t) => ({
      title: 'Collector',
      base: (n) => `Collect ${n} orbs. No timer — but the enemies won't wait.`,
      goal: { type: 'orbs', target: r(lerp(10, 26, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 9, t)),
      enemySpeed: +lerp(1, 1.7, t).toFixed(2),
    }),
  },
  {
    key: 'sprint',
    unlockAt: 3,
    twists: ['none', 'ice', 'tight', 'wrap', 'hunters', 'drifting'],
    build: (t) => ({
      title: 'Sprint',
      base: (n) => `Collect ${n} orbs before the clock runs out.`,
      goal: { type: 'orbs', target: r(lerp(10, 22, t)) },
      deadlineMult: +lerp(1.95, 1.62, t).toFixed(2),
      enemyCount: r(lerp(1, 6, t)),
      enemySpeed: +lerp(1.1, 1.75, t).toFixed(2),
    }),
  },
  {
    key: 'sweep',
    unlockAt: 4,
    twists: ['none', 'tight', 'ice', 'moving', 'mines', 'collapse'],
    build: (t) => ({
      title: 'Clean Sweep',
      base: (n) => `Clear every one of the ${n} orbs before the clock runs out.`,
      goal: { type: 'collectAll', target: r(lerp(9, 20, t)) },
      deadlineMult: +lerp(2.05, 1.68, t).toFixed(2),
      enemyCount: r(lerp(1, 5, t)),
      enemySpeed: +lerp(1, 1.6, t).toFixed(2),
    }),
  },
  {
    key: 'survivor',
    unlockAt: 2,
    twists: ['none', 'tight', 'ice', 'wrap', 'hunters', 'mines', 'mirror'],
    build: (t) => ({
      title: 'Survivor',
      base: () => `Stay alive for ${r(lerp(20, 60, t))} seconds. Orbs you bank on the way earn stars.`,
      goal: { type: 'survive', target: r(lerp(20, 60, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(3, 10, t)),
      enemySpeed: +lerp(1.1, 1.8, t).toFixed(2),
    }),
  },
  {
    key: 'navigate',
    unlockAt: 5,
    twists: ['none', 'ice', 'wrap', 'moving', 'heavy', 'collapse'],
    build: (t) => ({
      title: 'Navigator',
      base: (n) => `Thread ${n} orbs out of a field of ${r(lerp(5, 14, t))} fixed hazards.`,
      goal: { type: 'orbs', target: r(lerp(5, 14, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(0, 3, t)),
      enemySpeed: +lerp(1, 1.5, t).toFixed(2),
      modifiers: { obstacles: r(lerp(5, 14, t)) },
    }),
  },
  {
    key: 'tiny',
    unlockAt: 7,
    twists: ['none', 'ice', 'wrap', 'moving', 'hunters', 'mirror'],
    build: (t) => ({
      title: 'Claustrophobia',
      base: (n) => `Collect ${n} orbs in a box with no room to breathe.`,
      goal: { type: 'orbs', target: r(lerp(8, 16, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 6, t)),
      enemySpeed: +lerp(1, 1.5, t).toFixed(2),
      modifiers: { arenaScale: +lerp(0.6, 0.44, t).toFixed(2) },
    }),
  },
  {
    key: 'mirror',
    unlockAt: 9,
    twists: ['none', 'tight', 'wrap', 'moving', 'mines'],
    build: (t) => ({
      title: 'Mirror',
      base: (n) => `Collect ${n} orbs with every input inverted.`,
      goal: { type: 'orbs', target: r(lerp(8, 15, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 6, t)),
      enemySpeed: +lerp(1, 1.5, t).toFixed(2),
      modifiers: { reverseControls: true },
    }),
  },
  {
    key: 'ice',
    unlockAt: 11,
    twists: ['none', 'tight', 'wrap', 'moving', 'hunters', 'mines'],
    build: (t) => ({
      title: 'Frictionless',
      base: (n) => `Collect ${n} orbs on ice — momentum barely fades.`,
      goal: { type: 'orbs', target: r(lerp(10, 20, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 7, t)),
      enemySpeed: +lerp(1, 1.6, t).toFixed(2),
      modifiers: { feel: 'ice' },
    }),
  },
  {
    key: 'heavy',
    unlockAt: 13,
    twists: ['none', 'tight', 'wrap', 'moving', 'mines'],
    build: (t) => ({
      title: 'Deadweight',
      base: (n) => `Collect ${n} orbs hauling a puck that fights every turn.`,
      goal: { type: 'orbs', target: r(lerp(9, 16, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 6, t)),
      enemySpeed: +lerp(1, 1.5, t).toFixed(2),
      modifiers: { feel: 'heavy' },
    }),
  },
  {
    key: 'weave',
    unlockAt: 15,
    twists: ['none', 'ice', 'moving', 'hunters', 'mirror', 'drifting'],
    build: (t) => ({
      title: 'The Weave',
      base: (n) => `Collect ${n} orbs. The walls are doors — run straight through them.`,
      goal: { type: 'orbs', target: r(lerp(12, 24, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(6, 16, t)),
      enemySpeed: +lerp(1.2, 1.9, t).toFixed(2),
      modifiers: { wraparound: true },
    }),
  },
  {
    key: 'swarm',
    unlockAt: 26,
    twists: ['none', 'tight', 'ice', 'wrap', 'moving', 'collapse'],
    build: (t) => ({
      title: 'Swarm',
      base: (n) => `Collect ${n} orbs inside a storm of traffic.`,
      goal: { type: 'orbs', target: r(lerp(12, 22, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(10, 20, t)),
      enemySpeed: +lerp(1.6, 2.2, t).toFixed(2),
    }),
  },
  {
    key: 'hunt',
    unlockAt: 22,
    twists: ['none', 'tight', 'ice', 'wrap', 'moving', 'mines'],
    build: (t) => ({
      title: 'The Hunt',
      base: (n) => `Collect ${n} orbs while ${r(lerp(2, 6, t))} hunters track you across the arena.`,
      goal: { type: 'orbs', target: r(lerp(10, 18, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(3, 8, t)),
      enemySpeed: +lerp(1.1, 1.6, t).toFixed(2),
      modifiers: { homingEnemies: r(lerp(2, 6, t)) },
    }),
  },
  {
    key: 'chase',
    unlockAt: 18,
    twists: ['none', 'tight', 'ice', 'wrap', 'hunters', 'mirror'],
    build: (t) => ({
      title: 'Chase Sequence',
      base: (n) => `Run down ${n} orbs that won't hold still.`,
      goal: { type: 'orbs', target: r(lerp(10, 18, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(2, 8, t)),
      enemySpeed: +lerp(1.1, 1.7, t).toFixed(2),
      modifiers: { movingOrbs: true },
    }),
  },
  {
    key: 'endurance',
    unlockAt: 30,
    twists: ['none', 'tight', 'ice', 'wrap', 'hunters', 'drifting', 'mirror'],
    build: (t) => ({
      title: 'Endurance',
      base: () => `Outlast ${r(lerp(60, 110, t))} seconds of relentless pressure. Bank orbs for stars.`,
      goal: { type: 'survive', target: r(lerp(60, 110, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(6, 14, t)),
      enemySpeed: +lerp(1.3, 2, t).toFixed(2),
    }),
  },
  {
    key: 'minefield',
    unlockAt: 46,
    twists: ['none', 'tight', 'ice', 'wrap', 'moving', 'mirror'],
    build: (t) => ({
      title: 'Minefield',
      base: (n) => `Collect ${n} orbs while ${r(lerp(6, 12, t))} live mines drift across your route.`,
      goal: { type: 'orbs', target: r(lerp(8, 15, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(1, 4, t)),
      enemySpeed: +lerp(1, 1.5, t).toFixed(2),
      modifiers: { obstacles: r(lerp(6, 12, t)), movingHazards: true },
    }),
  },
  {
    key: 'untouchable',
    unlockAt: 54,
    twists: ['none', 'ice', 'moving', 'hunters', 'mirror'],
    build: (t) => ({
      title: 'Untouchable',
      base: (n) => `Collect ${n} orbs. The walls carry you through — but graze one and the run caps at a single star.`,
      goal: { type: 'orbs', target: r(lerp(9, 16, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(3, 8, t)),
      enemySpeed: +lerp(1.1, 1.6, t).toFixed(2),
      modifiers: { wraparound: true, noWallTouch: true },
    }),
  },
  {
    key: 'collapse',
    unlockAt: 38,
    twists: ['none', 'ice', 'moving', 'hunters', 'mirror', 'mines'],
    build: (t) => ({
      title: 'Collapse',
      base: (n) => `Collect ${n} orbs as the arena closes in around you.`,
      goal: { type: 'orbs', target: r(lerp(10, 18, t)) },
      deadlineMult: 0,
      enemyCount: r(lerp(3, 8, t)),
      enemySpeed: +lerp(1.1, 1.7, t).toFixed(2),
      modifiers: { shrinkTo: +lerp(0.55, 0.34, t).toFixed(2) },
    }),
  },
]

// ── Bosses ──────────────────────────────────────────────────────────────
// One at the close of every tier: a fixed, hand-shaped combination that reads
// as an exam on the mechanics that tier taught.

const bosses = {
  20: {
    key: 'boss',
    title: 'Gatekeeper',
    base: (n) => `Clear all ${n} orbs in a shrinking box, on the clock. Tier one ends here.`,
    goal: { type: 'collectAll', target: 14 },
    deadlineMult: 1.75,
    enemyCount: 5,
    enemySpeed: 1.4,
    modifiers: { arenaScale: 0.7, obstacles: 5 },
  },
  40: {
    key: 'boss',
    title: 'Hall of Mirrors',
    base: (n) => `Collect ${n} orbs on ice, inverted, with the walls wide open.`,
    goal: { type: 'orbs', target: 18 },
    deadlineMult: 0,
    enemyCount: 9,
    enemySpeed: 1.7,
    modifiers: { reverseControls: true, feel: 'ice', wraparound: true },
  },
  60: {
    key: 'boss',
    title: 'Pack Hunt',
    base: () => `Outlast 90 seconds with the pack on you the whole way. Orbs still count.`,
    goal: { type: 'survive', target: 90 },
    deadlineMult: 0,
    enemyCount: 10,
    enemySpeed: 1.8,
    modifiers: { homingEnemies: 6 },
  },
  80: {
    key: 'boss',
    title: 'No Quarter',
    base: (n) => `Collect ${n} drifting orbs through a live minefield. Ride the walls if you must, but only a clean run scores.`,
    goal: { type: 'orbs', target: 15 },
    deadlineMult: 0,
    enemyCount: 6,
    enemySpeed: 1.7,
    modifiers: { obstacles: 10, movingHazards: true, movingOrbs: true, wraparound: true, noWallTouch: true },
  },
  100: {
    key: 'boss',
    title: 'Signal in the Void',
    base: (n) => `Everything at once. Collect ${n} orbs and the campaign is yours.`,
    goal: { type: 'orbs', target: 20 },
    deadlineMult: 1.7,
    enemyCount: 14,
    enemySpeed: 2.1,
    modifiers: { shrinkTo: 0.4, homingEnemies: 5, feel: 'ice', movingOrbs: true },
  },
}

// ── Assembly ────────────────────────────────────────────────────────────

const tierOf = (id) => Math.min(5, Math.floor((id - 1) / 20) + 1)

/** Archetypes unlocked by this point, minus anything used too recently. */
function pick(id, recent) {
  const unlocked = archetypes.filter((a) => a.unlockAt <= id)
  const fresh = unlocked.filter((a) => !recent.includes(a.key))
  const pool = fresh.length > 0 ? fresh : unlocked

  // A mechanic that just unlocked should show up promptly rather than wait on
  // the shuffle, so weight it heavily for the few levels after it arrives.
  const weighted = pool.flatMap((a) => (id - a.unlockAt <= 2 ? [a, a, a, a] : [a]))
  return weighted[Math.floor(rand() * weighted.length)]
}

/** The next unused twist for this archetype that has unlocked by this point. */
function pickTwist(arch, instance, id) {
  const banned = CONFLICTS[arch.key] ?? []
  let usable = arch.twists.filter((k) => !banned.includes(k) && TWISTS[k].unlockAt <= id)
  // Only the first sighting of an archetype is served plain. Once the cycle has
  // wrapped, falling back to 'none' would hand a late challenge a version
  // simpler than the one the player already beat.
  if (instance > 0) usable = usable.filter((k) => k !== 'none')
  if (usable.length === 0) return TWISTS.none
  return TWISTS[usable[(instance - 1 + usable.length) % usable.length]]
}

const occurrences = {}
const recent = []
const challenges = []

for (let id = 1; id <= 100; id++) {
  const t = (id - 1) / 99
  const tier = tierOf(id)

  let key, part, twist
  if (bosses[id]) {
    const b = bosses[id]
    key = `boss${id}`
    part = b
    twist = TWISTS.none
  } else {
    const arch = pick(id, recent)
    key = arch.key
    occurrences[key] = (occurrences[key] || 0) + 1
    part = arch.build(t)
    twist = pickTwist(arch, occurrences[key] - 1, id)

    recent.push(key)
    if (recent.length > 6) recent.shift()
  }

  const modifiers = { ...(part.modifiers ?? {}), ...twist.mods }

  // Merge rather than overwrite where a twist stacks with the archetype's own
  // dial, so e.g. a tight Collapse still collapses from its smaller start.
  if (part.modifiers?.arenaScale && twist.mods.arenaScale) {
    modifiers.arenaScale = +(part.modifiers.arenaScale * 0.9).toFixed(2)
  }
  if (part.modifiers?.obstacles && twist.mods.obstacles) {
    modifiers.obstacles = part.modifiers.obstacles + twist.mods.obstacles
  }
  if (part.modifiers?.homingEnemies && twist.mods.homingEnemies) {
    modifiers.homingEnemies = part.modifiers.homingEnemies + twist.mods.homingEnemies
  }

  const isSurvive = part.goal.type === 'survive'
  const suffix = bosses[id] ? '' : ` ${ROMAN[Math.min(ROMAN.length - 1, occurrences[key] - 1)]}`
  const note = twist.note ? ` ${twist.note.charAt(0).toUpperCase()}${twist.note.slice(1)}.` : ''

  challenges.push({
    id,
    tier,
    archetype: key,
    title: `${part.title}${suffix}`,
    description: part.base(part.goal.target) + note,
    goal: part.goal,
    deadlineMult: part.deadlineMult,
    enemyCount: part.enemyCount,
    enemySpeed: part.enemySpeed,
    modifiers,
    stars: isSurvive
      ? { two: +lerp(0.3, 0.4, t).toFixed(2), three: +lerp(0.5, 0.65, t).toFixed(2), mode: 'survive' }
      : { two: 0, three: 0, mode: 'par' },
  })
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(challenges, null, 2) + '\n')

const spread = {}
for (const c of challenges) spread[c.archetype] = (spread[c.archetype] || 0) + 1
console.log(`Wrote ${challenges.length} challenges to ${OUT}`)
console.log('Archetype spread:', spread)
