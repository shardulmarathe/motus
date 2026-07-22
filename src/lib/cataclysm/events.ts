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
  /** Legacy alias — always equals players[0]. */
  player: Puck
  players: Puck[]
  worldEnemies: Enemy[]
  width: number
  height: number
  dt: number
}

type CataclysmRenderContext = {
  ctx: CanvasRenderingContext2D
  cat: CataclysmData
  player?: Puck
  players?: Puck[]
  width?: number
  height?: number
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

function renderBlackout(ctx: CanvasRenderingContext2D, player: Puck, width: number, height: number) {
  const r = 128
  const grad = ctx.createRadialGradient(player.x, player.y, r * 0.35, player.x, player.y, r * 1.9)
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
  grad.addColorStop(0.7, 'rgba(2, 4, 10, 0.72)')
  grad.addColorStop(1, 'rgba(1, 2, 6, 0.97)')
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
  height: number
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
  lctx.fillStyle = `rgba(1, 2, 6, ${maxDark})`
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

function renderShrinkingArena(ctx: CanvasRenderingContext2D, cat: CataclysmData) {
  if (!cat.arenaWidth || !cat.arenaHeight) return

  const arena = calculateArenaSize(cat.arenaWidth, cat.arenaHeight, cat.timeLeft, 30)
  ctx.strokeStyle = withAlpha(palette.warn, 0.44)
  ctx.lineWidth = 2
  ctx.shadowColor = palette.warn
  ctx.shadowBlur = 16
  ctx.strokeRect(arena.x, arena.y, arena.width, arena.height)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}

function renderSwapWarning(ctx: CanvasRenderingContext2D, cat: CataclysmData) {
  if (!cat.swapWarning || cat.swapWarning <= 0) return

  const alpha = Math.min(1, cat.swapWarning / 0.6)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = withAlpha(palette.warn, 0.55)
  ctx.lineWidth = 2
  ctx.setLineDash([8, 10])

  const enemies = cat.eventEnemies ?? []
  const pairs = Math.min(cat.goals.length, enemies.length)
  for (let i = 0; i < pairs; i++) {
    const goal = cat.goals[i]
    const enemy = enemies[i]
    ctx.beginPath()
    ctx.moveTo(goal.x, goal.y)
    ctx.lineTo(enemy.x, enemy.y)
    ctx.stroke()
  }

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
    onRender: ({ ctx, cat }) => renderShrinkingArena(ctx, cat),
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
    onRender: ({ ctx, cat }) => renderSwapWarning(ctx, cat),
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
    onRender: ({ ctx, player, players, width, height }) => {
      if (!width || !height) return
      const pucks = players ?? (player ? [player] : [])
      if (pucks.length === 0) return
      // Single puck keeps the exact legacy gradient; multiple pucks punch one
      // light hole each into a shared darkness layer.
      if (pucks.length === 1) renderBlackout(ctx, pucks[0], width, height)
      else renderBlackoutMulti(ctx, pucks, width, height)
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
