// Generates the 100-challenge campaign as static JSON.
//
// Difficulty rises monotonically with challenge id: every parameter is derived
// from a single global ramp t = (id-1)/99, so later challenges are always
// harder than earlier ones. Archetypes cycle for variety, and each successive
// instance of an archetype is tuned to the higher ramp value. Re-run with:
//   node scripts/generate-challenges.mjs

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'lib', 'data', 'challenges.json')

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const r = (n) => Math.round(n)

// Each archetype maps the global ramp t (0..1) to a challenge spec.
const archetypes = [
  {
    key: 'collector',
    build: (t) => ({
      title: 'Collector',
      description: `Collect ${r(10 + t * 30)} orbs. No timer — but the enemies won't wait.`,
      goal: { type: 'orbs', target: r(10 + t * 30) },
      timeLimit: 0,
      enemyCount: r(2 + t * 8),
      enemySpeed: +(1 + t * 0.8).toFixed(2),
      modifiers: {},
    }),
  },
  {
    key: 'navigate',
    build: (t) => ({
      title: 'Navigator',
      description: `Weave through ${r(4 + t * 11)} static hazards to collect ${r(3 + t * 7)} orbs.`,
      goal: { type: 'orbs', target: r(3 + t * 7) },
      timeLimit: 0,
      enemyCount: r(t * 3),
      enemySpeed: +(1 + t * 0.5).toFixed(2),
      modifiers: { obstacles: r(4 + t * 11) },
    }),
  },
  {
    key: 'sprint',
    build: (t) => ({
      title: 'Sprint',
      description: `Collect ${r(12 + t * 16)} orbs in under ${r(30 - t * 14)} seconds.`,
      goal: { type: 'orbs', target: r(12 + t * 16) },
      timeLimit: r(30 - t * 14),
      enemyCount: r(1 + t * 6),
      enemySpeed: +(1.1 + t * 0.7).toFixed(2),
      modifiers: {},
    }),
  },
  {
    key: 'survivor',
    build: (t) => ({
      title: 'Survivor',
      description: `Stay alive for ${r(20 + t * 70)} seconds.`,
      goal: { type: 'survive', target: r(20 + t * 70) },
      timeLimit: r(20 + t * 70),
      enemyCount: r(3 + t * 10),
      enemySpeed: +(1.1 + t * 0.9).toFixed(2),
      modifiers: {},
    }),
  },
  {
    key: 'sweep',
    build: (t) => ({
      title: 'Clean Sweep',
      description: `Clear all ${r(9 + t * 12)} orbs before the timer runs out.`,
      goal: { type: 'collectAll', target: r(9 + t * 12) },
      timeLimit: r(26 - t * 10),
      enemyCount: r(1 + t * 5),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: {},
    }),
  },
  {
    key: 'tiny',
    build: (t) => ({
      title: 'Claustrophobia',
      description: `Collect ${r(8 + t * 8)} orbs in a cramped arena.`,
      goal: { type: 'orbs', target: r(8 + t * 8) },
      timeLimit: 0,
      enemyCount: r(2 + t * 5),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: { arenaScale: +(0.62 - t * 0.16).toFixed(2) },
    }),
  },
  {
    key: 'purist',
    build: (t) => ({
      title: 'Untouchable',
      description: `Collect ${r(8 + t * 10)} orbs without ever touching a wall.`,
      goal: { type: 'orbs', target: r(8 + t * 10) },
      timeLimit: 0,
      enemyCount: r(2 + t * 6),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: { noWallTouch: true },
    }),
  },
  {
    key: 'swarm',
    build: (t) => ({
      title: 'Swarm',
      description: `Collect ${r(10 + t * 16)} orbs amid a swarm of fast enemies.`,
      goal: { type: 'orbs', target: r(10 + t * 16) },
      timeLimit: 0,
      enemyCount: r(6 + t * 12),
      enemySpeed: +(1.6 + t * 0.8).toFixed(2),
      modifiers: {},
    }),
  },
  {
    key: 'void',
    build: (t) => ({
      title: 'The Void',
      description: `Collect ${r(12 + t * 14)} orbs — walls are lethal, no wrap.`,
      goal: { type: 'orbs', target: r(12 + t * 14) },
      timeLimit: 0,
      enemyCount: r(3 + t * 7),
      enemySpeed: +(1.1 + t * 0.7).toFixed(2),
      modifiers: { wraparound: false },
    }),
  },
  {
    key: 'slippery',
    build: (t) => ({
      title: 'Frictionless',
      description: `Collect ${r(10 + t * 10)} orbs on ice — momentum barely fades.`,
      goal: { type: 'orbs', target: r(10 + t * 10) },
      timeLimit: 0,
      enemyCount: r(2 + t * 6),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: { friction: 0.997, acceleration: 1200 },
    }),
  },
  {
    key: 'molasses',
    build: (t) => ({
      title: 'Heavy',
      description: `Collect ${r(9 + t * 9)} orbs with sluggish, heavy controls.`,
      goal: { type: 'orbs', target: r(9 + t * 9) },
      timeLimit: 0,
      enemyCount: r(2 + t * 6),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: { friction: 0.97, acceleration: 760 },
    }),
  },
  {
    key: 'reversed',
    build: (t) => ({
      title: 'Mirror',
      description: `Collect ${r(8 + t * 9)} orbs with your controls reversed.`,
      goal: { type: 'orbs', target: r(8 + t * 9) },
      timeLimit: 0,
      enemyCount: r(2 + t * 5),
      enemySpeed: +(1 + t * 0.6).toFixed(2),
      modifiers: { reverseControls: true },
    }),
  },
  {
    key: 'suddendeath',
    build: (t) => ({
      title: 'Sudden Death',
      description: `Collect ${r(10 + t * 14)} orbs. One touch ends everything.`,
      goal: { type: 'orbs', target: r(10 + t * 14) },
      timeLimit: 0,
      enemyCount: r(4 + t * 9),
      enemySpeed: +(1.3 + t * 0.8).toFixed(2),
      modifiers: { oneLife: true },
    }),
  },
  {
    key: 'endurance',
    build: (t) => ({
      title: 'Endurance',
      description: `Outlast ${r(45 + t * 95)} seconds of relentless pressure.`,
      goal: { type: 'survive', target: r(45 + t * 95) },
      timeLimit: r(45 + t * 95),
      enemyCount: r(4 + t * 11),
      enemySpeed: +(1.2 + t * 0.9).toFixed(2),
      modifiers: {},
    }),
  },
]

function starRule(goalType) {
  return goalType === 'survive' ? { two: 0, three: 0, mode: 'clear' } : { two: 0.2, three: 0.45, mode: 'time' }
}

const occurrences = {}
const challenges = []
for (let id = 1; id <= 100; id++) {
  const t = (id - 1) / 99
  const arch = archetypes[(id - 1) % archetypes.length]
  occurrences[arch.key] = (occurrences[arch.key] || 0) + 1
  const suffix = ROMAN[Math.min(ROMAN.length - 1, occurrences[arch.key] - 1)]
  const tier = Math.min(5, Math.floor((id - 1) / 20) + 1)
  const part = arch.build(t)
  challenges.push({
    id,
    tier,
    archetype: arch.key,
    stars: starRule(part.goal.type),
    ...part,
    title: `${part.title} ${suffix}`,
  })
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(challenges, null, 2) + '\n')
console.log(`Wrote ${challenges.length} challenges to ${OUT}`)
