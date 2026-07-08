// Generates the 100-challenge campaign as static JSON.
//
// Challenges are composed from a set of hand-designed archetypes whose
// parameters escalate across five tiers, giving a curated difficulty curve
// while keeping the data authored rather than typed out by hand. Re-run with:
//   node scripts/generate-challenges.mjs
// Output is committed as src/lib/data/challenges.json (the game reads the JSON,
// not this script).

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'lib', 'data', 'challenges.json')

const ROMAN = ['I', 'II', 'III', 'IV', 'V']

// Each archetype returns a partial challenge given a tier index (0..4).
// `t` is a 0..1 intensity ramp within the whole campaign for smooth scaling.
const archetypes = [
  {
    key: 'collector',
    build: (tier, t) => ({
      title: `Collector ${ROMAN[tier]}`,
      description: `Collect ${10 + tier * 6} orbs. Take your time — but the enemies won't.`,
      goal: { type: 'orbs', target: 10 + tier * 6 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.4,
      modifiers: {},
    }),
  },
  {
    key: 'sprint',
    build: (tier, t) => ({
      title: `Quick Collector ${ROMAN[tier]}`,
      description: `Collect ${12 + tier * 3} orbs in under ${28 - tier * 3} seconds.`,
      goal: { type: 'orbs', target: 12 + tier * 3 },
      timeLimit: 28 - tier * 3,
      enemyCount: 1 + tier,
      enemySpeed: 1.1 + t * 0.4,
      modifiers: {},
    }),
  },
  {
    key: 'survivor',
    build: (tier, t) => ({
      title: `Survivor ${ROMAN[tier]}`,
      description: `Stay alive for ${20 + tier * 15} seconds.`,
      goal: { type: 'survive', target: 20 + tier * 15 },
      timeLimit: 20 + tier * 15,
      enemyCount: 3 + tier * 2,
      enemySpeed: 1.1 + t * 0.5,
      modifiers: {},
    }),
  },
  {
    key: 'purist',
    build: (tier, t) => ({
      title: `Untouchable ${ROMAN[tier]}`,
      description: `Collect ${8 + tier * 4} orbs without ever touching a wall.`,
      goal: { type: 'orbs', target: 8 + tier * 4 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.35,
      modifiers: { noWallTouch: true },
    }),
  },
  {
    key: 'sweep',
    build: (tier, t) => ({
      title: `Clean Sweep ${ROMAN[tier]}`,
      description: `Clear all ${9 + tier * 3} orbs before the timer runs out.`,
      goal: { type: 'collectAll', target: 9 + tier * 3 },
      timeLimit: 24 - tier * 2,
      enemyCount: 1 + tier,
      enemySpeed: 1 + t * 0.35,
      modifiers: {},
    }),
  },
  {
    key: 'swarm',
    build: (tier, t) => ({
      title: `Swarm ${ROMAN[tier]}`,
      description: `Collect ${10 + tier * 4} orbs with double-speed enemies everywhere.`,
      goal: { type: 'orbs', target: 10 + tier * 4 },
      timeLimit: 0,
      enemyCount: 5 + tier * 2,
      enemySpeed: 1.8 + t * 0.5,
      modifiers: {},
    }),
  },
  {
    key: 'chaos',
    build: (tier, t) => ({
      title: `Chaos ${ROMAN[tier]}`,
      description: `Survive ${18 + tier * 10}s as Cataclysms strike back to back.`,
      goal: { type: 'survive', target: 18 + tier * 10 },
      timeLimit: 18 + tier * 10,
      enemyCount: 3 + tier,
      enemySpeed: 1.2 + t * 0.4,
      modifiers: { frequentCataclysms: true, randomCataclysm: true },
    }),
  },
  {
    key: 'tiny',
    build: (tier, t) => ({
      title: `Claustrophobia ${ROMAN[tier]}`,
      description: `Collect ${8 + tier * 3} orbs in a cramped arena.`,
      goal: { type: 'orbs', target: 8 + tier * 3 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.35,
      modifiers: { arenaScale: 0.62 - tier * 0.03 },
    }),
  },
  {
    key: 'void',
    build: (tier, t) => ({
      title: `The Void ${ROMAN[tier]}`,
      description: `Collect ${12 + tier * 4} orbs in a vast arena — walls are lethal.`,
      goal: { type: 'orbs', target: 12 + tier * 4 },
      timeLimit: 0,
      enemyCount: 3 + tier,
      enemySpeed: 1.1 + t * 0.4,
      modifiers: { arenaScale: 1.0, wraparound: false },
    }),
  },
  {
    key: 'slippery',
    build: (tier, t) => ({
      title: `Frictionless ${ROMAN[tier]}`,
      description: `Collect ${10 + tier * 3} orbs on ice — momentum barely fades.`,
      goal: { type: 'orbs', target: 10 + tier * 3 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.35,
      modifiers: { friction: 0.997, acceleration: 1200 },
    }),
  },
  {
    key: 'molasses',
    build: (tier, t) => ({
      title: `Heavy ${ROMAN[tier]}`,
      description: `Collect ${9 + tier * 3} orbs with sluggish, heavy controls.`,
      goal: { type: 'orbs', target: 9 + tier * 3 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.3,
      modifiers: { friction: 0.97, acceleration: 760 },
    }),
  },
  {
    key: 'reversed',
    build: (tier, t) => ({
      title: `Mirror ${ROMAN[tier]}`,
      description: `Collect ${8 + tier * 3} orbs with your controls reversed.`,
      goal: { type: 'orbs', target: 8 + tier * 3 },
      timeLimit: 0,
      enemyCount: 2 + tier,
      enemySpeed: 1 + t * 0.35,
      modifiers: { reverseControls: true },
    }),
  },
  {
    key: 'suddendeath',
    build: (tier, t) => ({
      title: `Sudden Death ${ROMAN[tier]}`,
      description: `Collect ${10 + tier * 4} orbs. One touch ends everything.`,
      goal: { type: 'orbs', target: 10 + tier * 4 },
      timeLimit: 0,
      enemyCount: 4 + tier * 2,
      enemySpeed: 1.3 + t * 0.5,
      modifiers: { oneLife: true },
    }),
  },
  {
    key: 'endurance',
    build: (tier, t) => ({
      title: `Endurance ${ROMAN[tier]}`,
      description: `Outlast ${45 + tier * 25} seconds of relentless pressure.`,
      goal: { type: 'survive', target: 45 + tier * 25 },
      timeLimit: 45 + tier * 25,
      enemyCount: 4 + tier * 2,
      enemySpeed: 1.2 + t * 0.5,
      modifiers: {},
    }),
  },
]

// Star thresholds are expressed as fractions of the objective that must be
// beaten to earn 2 and 3 stars (more time to spare, or extra orbs collected).
function starRule(goalType) {
  // Fraction of time limit that must remain (time goals) OR spare orbs ratio.
  return goalType === 'survive'
    ? { two: 0, three: 0, mode: 'clear' } // survival: 3 stars = flawless (no near-death), handled in-game
    : { two: 0.25, three: 0.5, mode: 'time' } // collect goals: reward finishing early
}

const challenges = []
let id = 1
// 5 tiers x 14 archetypes would be 70; interleave to reach 100 with escalation.
for (let tier = 0; tier < 5; tier++) {
  for (let a = 0; a < archetypes.length; a++) {
    if (challenges.length >= 100) break
    const t = challenges.length / 99
    const part = archetypes[a].build(tier, t)
    challenges.push({
      id: id++,
      tier: tier + 1,
      archetype: archetypes[a].key,
      stars: starRule(part.goal.type),
      ...part,
    })
  }
}
// Top up to exactly 100 with escalating endurance/swarm finales if short.
const finales = ['endurance', 'swarm', 'chaos', 'suddendeath']
let fi = 0
while (challenges.length < 100) {
  const arche = archetypes.find((x) => x.key === finales[fi % finales.length])
  const t = challenges.length / 99
  const part = arche.build(4, Math.min(1, t + 0.1))
  part.title = `${part.title.replace(/ [IV]+$/, '')} — Finale ${challenges.length - 96}`
  challenges.push({ id: id++, tier: 5, archetype: arche.key, stars: starRule(part.goal.type), ...part })
  fi++
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(challenges, null, 2) + '\n')
console.log(`Wrote ${challenges.length} challenges to ${OUT}`)
