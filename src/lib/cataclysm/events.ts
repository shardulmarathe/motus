import {
  Enemy,
  Goal,
  Puck,
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
  spawnCataclysmGoals,
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
}

type CataclysmContext = {
  cat: CataclysmData
  player: Puck
  worldEnemies: Enemy[]
  width: number
  height: number
  dt: number
}

type CataclysmRenderContext = {
  ctx: CanvasRenderingContext2D
  cat: CataclysmData
}

type CataclysmDefinition = {
  onEnter: (width: number, height: number, player: Puck, stage: number) => CataclysmData
  onUpdate?: (context: CataclysmContext) => 'gameOver' | void
  onRender?: (context: CataclysmRenderContext) => void
}

function makeEventBase(
  eventType: CataclysmEventType,
  width: number,
  height: number,
  player: Puck,
  movingGoals = false
): CataclysmData {
  return {
    timeLeft: 30,
    goalsNeeded: 7,
    goalsCollected: 0,
    eventType,
    eventName: getEventName(eventType),
    goals: spawnCataclysmGoals(width, height, player.x, player.y, movingGoals),
    arenaWidth: width,
    arenaHeight: height,
    enterTime: 0,
  }
}

function spawnHunter(width: number, height: number, player: Puck, index: number, stage: number): Enemy {
  const edge = index % 4
  const x = edge === 1 ? width + 24 : edge === 3 ? -24 : Math.random() * width
  const y = edge === 0 ? -24 : edge === 2 ? height + 24 : Math.random() * height
  const dir = normalize({ x: player.x - x, y: player.y - y })
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
    onEnter: (width, height, player) => makeEventBase('staticGoals', width, height, player),
  },
  movingGoals: {
    onEnter: (width, height, player) => makeEventBase('movingGoals', width, height, player, true),
    onUpdate: ({ cat, width, height, dt }) => {
      for (const goal of cat.goals) integrateGoal(goal, dt, width, height)
    },
  },
  shrinkingArena: {
    onEnter: (width, height, player) => makeEventBase('shrinkingArena', width, height, player),
    onUpdate: ({ cat, player, worldEnemies }) => {
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

      if (isOutOfArena(player, arena.x, arena.y, arena.width, arena.height)) return 'gameOver'
    },
    onRender: ({ ctx, cat }) => renderShrinkingArena(ctx, cat),
  },
  hunt: {
    onEnter: (width, height, player, stage) => {
      const cat = makeEventBase('hunt', width, height, player)
      const hunterCount = Math.min(5, 2 + Math.floor(stage / 2))
      cat.eventEnemies = Array.from({ length: hunterCount }, (_, index) =>
        spawnHunter(width, height, player, index, stage)
      )
      return cat
    },
    onUpdate: ({ cat, player, dt }) => {
      for (const enemy of cat.eventEnemies ?? []) {
        applySeek(enemy, player.x, player.y, dt, 2.4)
        integrate(enemy, dt)
      }
    },
  },
  swap: {
    onEnter: (width, height, player) => {
      const cat = makeEventBase('swap', width, height, player)
      const enemySeeds = spawnCataclysmGoals(width, height, player.x, player.y)
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
}

export function createCataclysm(
  eventType: CataclysmEventType,
  width: number,
  height: number,
  player: Puck,
  stage: number
) {
  return cataclysmEvents[eventType].onEnter(width, height, player, stage)
}

export function updateCataclysmEvent(context: CataclysmContext) {
  return cataclysmEvents[context.cat.eventType].onUpdate?.(context)
}

export function renderCataclysmEvent(context: CataclysmRenderContext) {
  cataclysmEvents[context.cat.eventType].onRender?.(context)
}
