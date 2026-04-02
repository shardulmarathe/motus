import { Puck, Goal, normalize } from './physics'

// Event types for Cataclysm mode
export type CataclysmEventType = 'staticGoals' | 'movingGoals' | 'shakeMode' | 'shrinkingArena'

/**
 * Create the player puck centered at (cx, cy)
 */
export function createPlayer(cx: number, cy: number): Puck {
  return {
    x: cx,
    y: cy,
    vx: 0,
    vy: 0,
    radius: 14,
    isPlayer: true,
    id: 'player',
  }
}

/**
 * Spawn an enemy on a random edge with velocity pointing inward
 * Difficulty scales with stage: higher stages spawn faster enemies
 */
export function spawnEnemy(width: number, height: number, stage: number, diffMultiplier: number): Puck {
  const edge = Math.floor(Math.random() * 4) // 0=top, 1=right, 2=bottom, 3=left
  let x = 0
  let y = 0

  if (edge === 0) {
    x = Math.random() * width
    y = -20
  } else if (edge === 1) {
    x = width + 20
    y = Math.random() * height
  } else if (edge === 2) {
    x = Math.random() * width
    y = height + 20
  } else {
    x = -20
    y = Math.random() * height
  }

  // Aim towards center plus small variation
  const cx = width / 2
  const cy = height / 2
  const dir = normalize({
    x: cx - x + (Math.random() - 0.5) * 80,
    y: cy - y + (Math.random() - 0.5) * 80,
  })

  // Base speed increases with stages and difficulty multiplier
  const baseSpeed = 80 + stage * 20
  const speed = (baseSpeed + Math.random() * 100) * diffMultiplier

  return {
    x,
    y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    radius: 12,
    id: `enemy-${Date.now()}-${Math.random()}`,
  }
}

/**
 * Spawn a goal at a random position on the board
 * Avoid spawning too close to edges or the player
 */
export function spawnGoal(
  width: number,
  height: number,
  playerX: number,
  playerY: number,
  isMoving: boolean = false
): Goal {
  const minMargin = 60 // pixels from edge
  const minDistanceFromPlayer = 120 // pixels from player

  let x = 0
  let y = 0
  let tooCloseToPlayer = true
  let attempts = 0

  // Keep trying until we find a safe spot
  while (tooCloseToPlayer && attempts < 20) {
    x = minMargin + Math.random() * (width - 2 * minMargin)
    y = minMargin + Math.random() * (height - 2 * minMargin)

    const dist = Math.hypot(x - playerX, y - playerY)
    tooCloseToPlayer = dist < minDistanceFromPlayer
    attempts++
  }

  const goal: Goal = {
    x,
    y,
    radius: 12,
  }

  // For moving goals, add velocity
  if (isMoving) {
    const moveSpeed = 40 // pixels per second, slower than enemies
    const angle = Math.random() * Math.PI * 2
    goal.vx = Math.cos(angle) * moveSpeed
    goal.vy = Math.sin(angle) * moveSpeed
  }

  return goal
}

/**
 * Spawn 7 static goals for Cataclysm event
 */
export function spawnCataclysmGoals(
  width: number,
  height: number,
  playerX: number,
  playerY: number,
  isMoving: boolean = false
): Goal[] {
  const goals: Goal[] = []
  for (let i = 0; i < 7; i++) {
    goals.push(spawnGoal(width, height, playerX, playerY, isMoving))
  }
  return goals
}

/**
 * Get Cataclysm event type based on event count
 * Cycles through: staticGoals → movingGoals → shakeMode → shrinkingArena → (repeat)
 */
export function getEventType(eventCount: number): CataclysmEventType {
  const types: CataclysmEventType[] = ['staticGoals', 'movingGoals', 'shakeMode', 'shrinkingArena']
  return types[eventCount % types.length]
}

/**
 * Calculate difficulty multiplier based on number of completed cataclysms
 * Values slightly increase each time for gradual challenge scaling
 */
export function getDifficultyMultiplier(cataclysmCount: number): number {
  // Each completed cataclysm increases difficulty by ~5%
  return Math.pow(1.05, cataclysmCount)
}

/**
 * Check if cataclysm event should trigger
 * Triggers every 10 goals (at 10, 20, 30, etc.)
 */
export function shouldTriggerCataclysm(score: number): boolean {
  return score > 0 && score % 10 === 0
}

/**
 * Calculate shrinking arena size at a given time
 * Returns the current arena rectangle dimensions
 */
export function calculateArenaSize(
  initialWidth: number,
  initialHeight: number,
  timeLeft: number,
  totalTime: number
): {
  x: number
  y: number
  width: number
  height: number
} {
  // Shrink from edges inward as time decreases
  const shrinkProgress = 1 - timeLeft / totalTime
  const maxShrink = Math.min(initialWidth, initialHeight) * 0.3
  const shrinkAmount = maxShrink * shrinkProgress

  return {
    x: shrinkAmount,
    y: shrinkAmount,
    width: initialWidth - shrinkAmount * 2,
    height: initialHeight - shrinkAmount * 2,
  }
}
