import { Puck, Goal, normalize, clampGoalToCanvas } from './physics'
import { Enemy } from './physics'

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

  // Stage-based speed scaling: baseSpeed * (1 + 0.15 * (stage - 1))
  const baseSpeed = 80
  const stageMultiplier = 1 + 0.15 * (stage - 1) // Stage 1: 1.0x, Stage 2: 1.15x, Stage 3: 1.30x
  const speed = (baseSpeed + Math.random() * 100) * stageMultiplier

  return {
    x,
    y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    radius: 12,
    id: `enemy-${Date.now()}-${Math.random()}`,
    baseSpeed: baseSpeed, // Store base speed for dynamic updates
  } as Enemy
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
  const radius = 12
  const desiredMargin = 60
  // Margin must fit the full goal circle inside the canvas
  const effMarginX = Math.max(
    radius + 8,
    Math.min(desiredMargin, Math.floor(width * 0.25))
  )
  const effMarginY = Math.max(
    radius + 8,
    Math.min(desiredMargin, Math.floor(height * 0.25))
  )
  const minDistanceFromPlayer = Math.min(120, Math.max(40, Math.min(width, height) * 0.25))

  let x = width / 2
  let y = height / 2
  let tooCloseToPlayer = true
  let attempts = 0

  const minX = effMarginX
  const maxX = Math.max(effMarginX, width - effMarginX)
  const minY = effMarginY
  const maxY = Math.max(effMarginY, height - effMarginY)

  // Keep trying until we find a safe spot
  while (tooCloseToPlayer && attempts < 40) {
    x = maxX > minX ? minX + Math.random() * (maxX - minX) : width / 2
    y = maxY > minY ? minY + Math.random() * (maxY - minY) : height / 2

    const dist = Math.hypot(x - playerX, y - playerY)
    tooCloseToPlayer = dist < minDistanceFromPlayer
    attempts++
  }

  const goal: Goal = {
    x,
    y,
    radius,
  }

  clampGoalToCanvas(goal, width, height, Math.max(effMarginX, effMarginY) - radius)

  // For moving goals, add velocity with variation per goal
  if (isMoving) {
    const baseSpeed = 50 // pixels per second
    const moveSpeed = baseSpeed * (0.7 + Math.random() * 0.6) // Each goal has different speed (0.7x to 1.3x)
    const angle = Math.random() * Math.PI * 2
    goal.vx = Math.cos(angle) * moveSpeed
    goal.vy = Math.sin(angle) * moveSpeed
    goal.moveSpeed = moveSpeed // Store for direction changes
    goal.directionChangeTimer = 0.5 + Math.random() * 1.0 // Start timer for first direction change
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
 * Get a random Cataclysm event type
 * Randomly selects from available events, avoiding immediate repeats
 */
let lastEventType: CataclysmEventType | null = null

export function getEventType(): CataclysmEventType {
  const types: CataclysmEventType[] = ['staticGoals', 'movingGoals', 'shrinkingArena'] // Removed 'shakeMode'
  // Filter out the last event type to avoid immediate repeats
  const availableTypes = lastEventType ? types.filter(t => t !== lastEventType) : types
  const selected = availableTypes[Math.floor(Math.random() * availableTypes.length)]
  lastEventType = selected
  return selected
}

/**
 * Get event name for current Cataclysm event (themed)
 */
export function getEventName(eventType: CataclysmEventType): string {
  switch (eventType) {
    case 'staticGoals':
      return 'Precision Run'
    case 'movingGoals':
      return 'Chase Sequence'
    case 'shakeMode':
      return 'System Overload'
    case 'shrinkingArena':
      return 'Last Stand'
    default:
      return 'Event'
  }
}

/**
 * Get objective text for current Cataclysm event
 */
export function getCataclysmObjective(eventType: CataclysmEventType): string {
  switch (eventType) {
    case 'staticGoals':
      return 'Collect all 7 goals'
    case 'movingGoals':
      return 'Collect all 7 moving goals'
    case 'shakeMode':
      return 'Collect all 7 goals before time runs out'
    case 'shrinkingArena':
      return 'Stay inside the shrinking area'
    default:
      return 'Complete the objective'
  }
}

/**
 * Calculate difficulty multiplier based on number of completed cataclysms
 * Values slightly increase each time for gradual challenge scaling
 */
export function getDifficultyMultiplier(stage: number, cataclysmCount: number): number {
  // Difficulty increases smoothly with stage and number of completed cataclysms.
  // Stage scaling: ~6% per stage (configurable), Cataclysm scaling: ~5% per event.
  const stageMultiplier = Math.pow(1.06, Math.max(0, stage - 1))
  const eventMultiplier = Math.pow(1.05, Math.max(0, cataclysmCount))
  return stageMultiplier * eventMultiplier
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
  const maxShrink = Math.min(initialWidth, initialHeight) * 0.375 // Increased from 0.3 (25% faster)
  const shrinkAmount = maxShrink * shrinkProgress

  return {
    x: shrinkAmount,
    y: shrinkAmount,
    width: initialWidth - shrinkAmount * 2,
    height: initialHeight - shrinkAmount * 2,
  }
}
