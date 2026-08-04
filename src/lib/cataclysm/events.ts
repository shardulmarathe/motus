import {
  Enemy,
  Goal,
  Puck,
  Vec,
  applySeek,
  integrate,
  integrateGoal,
  isOutOfArena,
  normalize,
  repositionGoalInBounds,
} from '../physics'
import {
  CataclysmEventType,
  calculateArenaSize,
  getEventName,
  spawnGoalClearOf,
} from '../gameLogic'
import { palette, withAlpha } from '../palette'

export type CataclysmData = {
  timeLeft: number
  goalsNeeded: number
  goalsCollected: number
  eventType: CataclysmEventType
  eventName: string
  goals: Goal[]
  arenaWidth?: number
  arenaHeight?: number
  enterTime?: number
  eventEnemies?: Enemy[]
  swapTimer?: number
  swapWarning?: number
  meteorTimer?: number
}

type CataclysmContext = {
  cat: CataclysmData
  /** Legacy alias, always equals players[0]. */
  player: Puck
  players: Puck[]
  worldEnemies: Enemy[]
  width: number
  height: number
  dt: number
}

/** The active render palette (themes rebuild this per run). */
type Pal = typeof palette

type CataclysmRenderContext = {
  ctx: CanvasRenderingContext2D
  cat: CataclysmData
  player?: Puck
  players?: Puck[]
  width?: number
  height?: number
  /**
   * The run's resolved palette. Cataclysm marks used to draw from the base
   * import, which printed Plotter's pens onto every other instrument; passing
   * the live palette keeps the closing limit in the theme's own red pen.
   */
  pal?: Pal
  /** True only on the three lit instruments. Chooses which value reads as "dark". */
  luminous?: boolean
}

type CataclysmDefinition = {
  onEnter: (width: number, height: number, players: Puck[], stage: number) => CataclysmData
  onUpdate?: (context: CataclysmContext) => 'gameOver' | number[] | void
  onRender?: (context: CataclysmRenderContext) => void
}

/** Nearest puck in `players` to a point (players is never empty in practice). */
function nearestPuck(players: Puck[], x: number, y: number): Puck {
  let best = players[0]
  let bestDist = Infinity
  for (const p of players) {
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

/**
 * Spawn the 7 cataclysm goals clear of EVERY puck. Local multi-avoid version
 * of gameLogic's spawnCataclysmGoals (which only takes one player position).
 */
function spawnGoalsClearOfAll(
  width: number,
  height: number,
  players: Puck[],
  isMoving = false
): Goal[] {
  const avoid: Vec[] = players.map((p) => ({ x: p.x, y: p.y }))
  const goals: Goal[] = []
  for (let i = 0; i < 7; i++) {
    goals.push(spawnGoalClearOf(width, height, avoid, isMoving))
  }
  return goals
}

function makeEventBase(
  eventType: CataclysmEventType,
  width: number,
  height: number,
  players: Puck[],
  movingGoals = false
): CataclysmData {
  return {
    timeLeft: 30,
    goalsNeeded: 7,
    goalsCollected: 0,
    eventType,
    eventName: getEventName(eventType),
    goals: spawnGoalsClearOfAll(width, height, players, movingGoals),
    arenaWidth: width,
    arenaHeight: height,
    enterTime: 0,
  }
}

function spawnHunter(width: number, height: number, players: Puck[], index: number, stage: number): Enemy {
  const edge = index % 4
  const x = edge === 1 ? width + 24 : edge === 3 ? -24 : Math.random() * width
  const y = edge === 0 ? -24 : edge === 2 ? height + 24 : Math.random() * height
  const target = nearestPuck(players, x, y)
  const dir = normalize({ x: target.x - x, y: target.y - y })
  const baseSpeed = 115 + stage * 8

  return {
    x,
    y,
    vx: dir.x * baseSpeed,
    vy: dir.y * baseSpeed,
    radius: 12,
    id: `hunter-${Date.now()}-${index}-${Math.random()}`,
    baseSpeed,
    behavior: 'homing',
    hue: 'purple',
  }
}

function spawnSwapEnemy(goal: Goal, index: number): Enemy {
  return {
    x: goal.x,
    y: goal.y,
    vx: 0,
    vy: 0,
    radius: 12,
    id: `swap-enemy-${Date.now()}-${index}-${Math.random()}`,
    baseSpeed: 0,
    behavior: 'linear',
    hue: 'red',
  }
}

/** A fast hazard that streaks straight across the arena (Meteor Storm). */
function spawnMeteor(width: number, height: number): Enemy {
  const speed = 320 + Math.random() * 160
  const horizontal = Math.random() < 0.5
  let x: number, y: number, vx: number, vy: number
  if (horizontal) {
    const fromLeft = Math.random() < 0.5
    x = fromLeft ? -40 : width + 40
    y = Math.random() * height
    vx = (fromLeft ? 1 : -1) * speed
    vy = (Math.random() - 0.5) * 60
  } else {
    const fromTop = Math.random() < 0.5
    x = Math.random() * width
    y = fromTop ? -40 : height + 40
    vx = (Math.random() - 0.5) * 60
    vy = (fromTop ? 1 : -1) * speed
  }
  return {
    x, y, vx, vy,
    radius: 11,
    id: `meteor-${Date.now()}-${Math.random()}`,
    baseSpeed: speed,
    behavior: 'linear',
    hue: 'red',
  }
}

/**
 * The blackout mask is "the dark of this medium", which is a different role on
 * each: on a lit instrument the field itself is dark (`void`), on paper the
 * only dark available is the pen (`ink`). Either way the sheet outside the
 * light hole stops carrying marks, which is the whole event.
 */
function maskColor(pal: Pal, luminous: boolean): string {
  return luminous ? pal.void : pal.ink
}

function renderBlackout(
  ctx: CanvasRenderingContext2D,
  player: Puck,
  width: number,
  height: number,
  mask: string
) {
  const r = 128
  const grad = ctx.createRadialGradient(player.x, player.y, r * 0.35, player.x, player.y, r * 1.9)
  grad.addColorStop(0, withAlpha(mask, 0))
  grad.addColorStop(0.7, withAlpha(mask, 0.72))
  grad.addColorStop(1, withAlpha(mask, 0.97))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
}

/** Reused offscreen layer for the multi-light blackout (avoids per-frame allocation). */
let blackoutLayer: HTMLCanvasElement | null = null

/**
 * Multi-puck blackout: draw the full-darkness layer once offscreen, then punch
 * one light hole per puck with destination-out so overlapping lights compose
 * (never double-darken). Each hole's erase profile is tuned so a lone puck
 * matches the single-player gradient (0 alpha at center, 0.72 mid, 0.97 edge).
 */
function renderBlackoutMulti(
  ctx: CanvasRenderingContext2D,
  players: Puck[],
  width: number,
  height: number,
  mask: string
) {
  if (typeof document === 'undefined') return
  if (!blackoutLayer) blackoutLayer = document.createElement('canvas')
  if (blackoutLayer.width !== width || blackoutLayer.height !== height) {
    blackoutLayer.width = width
    blackoutLayer.height = height
  }
  const lctx = blackoutLayer.getContext('2d')
  if (!lctx) return

  const maxDark = 0.97
  lctx.globalCompositeOperation = 'source-over'
  lctx.clearRect(0, 0, width, height)
  lctx.fillStyle = withAlpha(mask, maxDark)
  lctx.fillRect(0, 0, width, height)

  lctx.globalCompositeOperation = 'destination-out'
  const r = 128
  for (const p of players) {
    const hole = lctx.createRadialGradient(p.x, p.y, r * 0.35, p.x, p.y, r * 1.9)
    // destination-out: remaining = maxDark * (1 - srcAlpha); stops chosen so a
    // single hole leaves 0 at center, 0.72 at the 0.7 stop, 0.97 at the edge.
    hole.addColorStop(0, 'rgba(0, 0, 0, 1)')
    hole.addColorStop(0.7, `rgba(0, 0, 0, ${1 - 0.72 / maxDark})`)
    hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
    lctx.fillStyle = hole
    lctx.fillRect(0, 0, width, height)
  }
  lctx.globalCompositeOperation = 'source-over'

  ctx.drawImage(blackoutLayer, 0, 0)
}

/**
 * The closing limit, drawn as a moving rail rather than a glowing box: a red-pen
 * hairline, inward graduation ticks, and corner brackets that mark it as an
 * instrument boundary. Crossing it is lethal, so it stays the most legible mark
 * on the field without resorting to bloom, weight and graduation do the work
 * a halo used to.
 */
function renderShrinkingArena(ctx: CanvasRenderingContext2D, cat: CataclysmData, pal: Pal) {
  if (!cat.arenaWidth || !cat.arenaHeight) return

  const arena = calculateArenaSize(cat.arenaWidth, cat.arenaHeight, cat.timeLeft, 30)
  const x0 = Math.round(arena.x) + 0.5
  const y0 = Math.round(arena.y) + 0.5
  const x1 = Math.round(arena.x + arena.width) - 0.5
  const y1 = Math.round(arena.y + arena.height) - 0.5

  ctx.save()

  // Graduation ticks stepping inward, the rail reads as a ruled scale.
  const step = 26
  const tick = 6
  // Bumped from 0.4: a 40%-alpha red on bone stock washes out to pink, where on
  // a dark tube it read as a lit hairline.
  ctx.strokeStyle = withAlpha(pal.hostile, 0.55)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = x0 + step; x < x1; x += step) {
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y0 + tick)
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y1 - tick)
  }
  for (let y = y0 + step; y < y1; y += step) {
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + tick, y)
    ctx.moveTo(x1, y)
    ctx.lineTo(x1 - tick, y)
  }
  ctx.stroke()

  // The limit itself, struck at full pen weight on both media.
  ctx.strokeStyle = pal.hostile
  ctx.lineWidth = 1.75
  ctx.beginPath()
  ctx.rect(x0, y0, x1 - x0, y1 - y0)
  ctx.stroke()

  // Corner brackets.
  const arm = 18
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0)
  ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm)
  ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1)
  ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm)
  ctx.stroke()

  ctx.restore()
}

function renderSwapWarning(ctx: CanvasRenderingContext2D, cat: CataclysmData, pal: Pal) {
  if (!cat.swapWarning || cat.swapWarning <= 0) return

  // Transfer lines: hairline vermilion leaders showing which mark is about to
  // become which. Batched into one path, this fires for every pair at once.
  const alpha = Math.min(1, cat.swapWarning / 0.6)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = withAlpha(pal.hostile, 0.8)
  ctx.lineWidth = 1
  ctx.setLineDash([3, 5])

  const enemies = cat.eventEnemies ?? []
  const pairs = Math.min(cat.goals.length, enemies.length)
  ctx.beginPath()
  for (let i = 0; i < pairs; i++) {
    const goal = cat.goals[i]
    const enemy = enemies[i]
    ctx.moveTo(goal.x, goal.y)
    ctx.lineTo(enemy.x, enemy.y)
  }
  ctx.stroke()

  ctx.restore()
}

export const cataclysmEvents: Record<CataclysmEventType, CataclysmDefinition> = {
  staticGoals: {
    onEnter: (width, height, players) => makeEventBase('staticGoals', width, height, players),
  },
  movingGoals: {
    onEnter: (width, height, players) => makeEventBase('movingGoals', width, height, players, true),
    onUpdate: ({ cat, width, height, dt }) => {
      for (const goal of cat.goals) integrateGoal(goal, dt, width, height)
    },
  },
  shrinkingArena: {
    onEnter: (width, height, players) => makeEventBase('shrinkingArena', width, height, players),
    onUpdate: ({ cat, players, worldEnemies }) => {
      if (!cat.arenaWidth || !cat.arenaHeight) return
      const arena = calculateArenaSize(cat.arenaWidth, cat.arenaHeight, cat.timeLeft, 30)

      for (const goal of cat.goals) {
        repositionGoalInBounds(goal, arena.x, arena.y, arena.width, arena.height)
      }

      for (const enemy of worldEnemies) {
        const enemyLeft = enemy.x - enemy.radius
        const enemyRight = enemy.x + enemy.radius
        const enemyTop = enemy.y - enemy.radius
        const enemyBottom = enemy.y + enemy.radius

        if (enemyLeft < arena.x) {
          enemy.x = arena.x + enemy.radius
          enemy.vx = Math.abs(enemy.vx)
        }
        if (enemyRight > arena.x + arena.width) {
          enemy.x = arena.x + arena.width - enemy.radius
          enemy.vx = -Math.abs(enemy.vx)
        }
        if (enemyTop < arena.y) {
          enemy.y = arena.y + enemy.radius
          enemy.vy = Math.abs(enemy.vy)
        }
        if (enemyBottom > arena.y + arena.height) {
          enemy.y = arena.y + arena.height - enemy.radius
          enemy.vy = -Math.abs(enemy.vy)
        }
      }

      // Report which players are outside the safe rect; the caller decides
      // the death policy (single-player: game over, co-op: down those players).
      const caught: number[] = []
      for (let i = 0; i < players.length; i++) {
        if (isOutOfArena(players[i], arena.x, arena.y, arena.width, arena.height)) caught.push(i)
      }
      if (caught.length > 0) return caught
    },
    onRender: ({ ctx, cat, pal }) => renderShrinkingArena(ctx, cat, pal ?? palette),
  },
  hunt: {
    onEnter: (width, height, players, stage) => {
      const cat = makeEventBase('hunt', width, height, players)
      const hunterCount = Math.min(5, 2 + Math.floor(stage / 2))
      cat.eventEnemies = Array.from({ length: hunterCount }, (_, index) =>
        spawnHunter(width, height, players, index, stage)
      )
      return cat
    },
    onUpdate: ({ cat, players, dt }) => {
      for (const enemy of cat.eventEnemies ?? []) {
        const target = nearestPuck(players, enemy.x, enemy.y)
        applySeek(enemy, target.x, target.y, dt, 2.4)
        integrate(enemy, dt)
      }
    },
  },
  swap: {
    onEnter: (width, height, players) => {
      const cat = makeEventBase('swap', width, height, players)
      const enemySeeds = spawnGoalsClearOfAll(width, height, players)
      cat.eventEnemies = enemySeeds.map(spawnSwapEnemy)
      cat.swapTimer = 5
      cat.swapWarning = 0
      return cat
    },
    onUpdate: ({ cat, dt }) => {
      cat.swapTimer = (cat.swapTimer ?? 5) - dt
      cat.swapWarning = cat.swapTimer <= 0.6 ? Math.max(0, cat.swapTimer) : 0

      if (cat.swapTimer <= 0) {
        const enemies = cat.eventEnemies ?? []
        const pairs = Math.min(cat.goals.length, enemies.length)

        for (let i = 0; i < pairs; i++) {
          const goal = cat.goals[i]
          const enemy = enemies[i]
          const x = goal.x
          const y = goal.y
          goal.x = enemy.x
          goal.y = enemy.y
          enemy.x = x
          enemy.y = y
        }

        cat.swapTimer = 5
        cat.swapWarning = 0
      }
    },
    onRender: ({ ctx, cat, pal }) => renderSwapWarning(ctx, cat, pal ?? palette),
  },
  magnet: {
    onEnter: (width, height, players) => makeEventBase('magnet', width, height, players),
    onUpdate: ({ cat, players, width, height, dt }) => {
      // Goals actively flee the nearest puck when approached.
      for (const goal of cat.goals) {
        const near = nearestPuck(players, goal.x, goal.y)
        const dx = goal.x - near.x
        const dy = goal.y - near.y
        const d = Math.hypot(dx, dy) || 1
        if (d < 200) {
          const push = (200 - d) * 3.4 * dt
          goal.x += (dx / d) * push
          goal.y += (dy / d) * push
        }
        const m = goal.radius + 10
        goal.x = Math.max(m, Math.min(width - m, goal.x))
        goal.y = Math.max(m, Math.min(height - m, goal.y))
      }
    },
  },
  blackout: {
    onEnter: (width, height, players) => makeEventBase('blackout', width, height, players),
    onRender: ({ ctx, player, players, width, height, pal, luminous }) => {
      if (!width || !height) return
      const pucks = players ?? (player ? [player] : [])
      if (pucks.length === 0) return
      const mask = maskColor(pal ?? palette, luminous ?? false)
      // Single puck keeps the exact legacy gradient; multiple pucks punch one
      // light hole each into a shared darkness layer.
      if (pucks.length === 1) renderBlackout(ctx, pucks[0], width, height, mask)
      else renderBlackoutMulti(ctx, pucks, width, height, mask)
    },
  },
  meteorStorm: {
    onEnter: (width, height, players) => {
      const cat = makeEventBase('meteorStorm', width, height, players)
      cat.eventEnemies = []
      cat.meteorTimer = 0.4
      return cat
    },
    onUpdate: ({ cat, width, height, dt }) => {
      cat.meteorTimer = (cat.meteorTimer ?? 0) - dt
      if (cat.meteorTimer <= 0) {
        cat.meteorTimer = 0.5 + Math.random() * 0.45
        cat.eventEnemies = cat.eventEnemies ?? []
        cat.eventEnemies.push(spawnMeteor(width, height))
      }
      const list = cat.eventEnemies ?? []
      for (const m of list) integrate(m, dt)
      cat.eventEnemies = list.filter(
        (m) => m.x > -70 && m.x < width + 70 && m.y > -70 && m.y < height + 70
      )
    },
  },
}

export function createCataclysm(
  eventType: CataclysmEventType,
  width: number,
  height: number,
  players: Puck[],
  stage: number
) {
  return cataclysmEvents[eventType].onEnter(width, height, players, stage)
}

export function updateCataclysmEvent(context: CataclysmContext) {
  return cataclysmEvents[context.cat.eventType].onUpdate?.(context)
}

export function renderCataclysmEvent(context: CataclysmRenderContext) {
  cataclysmEvents[context.cat.eventType].onRender?.(context)
}
