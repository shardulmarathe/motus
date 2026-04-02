// Physics and collision detection utilities for the game

export type Puck = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  isPlayer?: boolean
  id?: string
}

export type Goal = {
  x: number
  y: number
  radius: number
  vx?: number
  vy?: number
}

export type Vec = { x: number; y: number }

/**
 * Returns squared distance between two points (faster than sqrt when just comparing)
 */
export function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/**
 * Returns actual distance between two points
 */
export function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}

/**
 * Normalize a vector and return as unit vector (returns zero vector if input is zero)
 */
export function normalize(v: Vec): Vec {
  const mag = Math.hypot(v.x, v.y)
  if (mag === 0) return { x: 0, y: 0 }
  return { x: v.x / mag, y: v.y / mag }
}

/**
 * Update puck position using basic Euler integration
 * dt is in seconds
 */
export function integrate(p: Puck, dt: number) {
  p.x += p.vx * dt
  p.y += p.vy * dt
}

/**
 * Apply light damping to puck velocity (for smooth deceleration)
 * Factor should be < 1.0 (e.g., 0.995 for 0.5% damping per frame)
 */
export function applyDamping(p: Puck, factor: number) {
  p.vx *= factor
  p.vy *= factor
}

/**
 * Apply acceleration/impulse to a puck (for momentum-based movement)
 */
export function applyAcceleration(p: Puck, ax: number, ay: number) {
  p.vx += ax
  p.vy += ay
}

/**
 * Check if two circles collide (distance between centers <= sum of radii)
 */
export function circlesCollide(a: Puck, b: Puck) {
  const r = a.radius + b.radius
  return dist2(a.x, a.y, b.x, b.y) <= r * r
}

/**
 * Check if a puck collides with a goal
 */
export function puckCollideGoal(puck: Puck, goal: Goal): boolean {
  const r = puck.radius + goal.radius
  return dist2(puck.x, puck.y, goal.x, goal.y) <= r * r
}

/**
 * Check if player is touching or crossed the boundary
 * Returns true if out of bounds
 */
export function isOutOfBounds(puck: Puck, canvasWidth: number, canvasHeight: number): boolean {
  return (
    puck.x - puck.radius < 0 ||
    puck.x + puck.radius > canvasWidth ||
    puck.y - puck.radius < 0 ||
    puck.y + puck.radius > canvasHeight
  )
}

/**
 * Clamp puck position to stay within canvas bounds
 */
export function clampToBounds(puck: Puck, canvasWidth: number, canvasHeight: number) {
  puck.x = Math.max(puck.radius, Math.min(canvasWidth - puck.radius, puck.x))
  puck.y = Math.max(puck.radius, Math.min(canvasHeight - puck.radius, puck.y))
}

/**
 * Update a goal position (for moving goals with velocity)
 * Goals bounce off walls
 */
export function integrateGoal(goal: Goal, dt: number, canvasWidth: number, canvasHeight: number) {
  if (goal.vx === undefined || goal.vy === undefined) return

  goal.x += goal.vx * dt
  goal.y += goal.vy * dt

  // Bounce off walls
  const margin = goal.radius
  if (goal.x - margin < 0 || goal.x + margin > canvasWidth) {
    goal.vx = -goal.vx
    goal.x = Math.max(margin, Math.min(canvasWidth - margin, goal.x))
  }
  if (goal.y - margin < 0 || goal.y + margin > canvasHeight) {
    goal.vy = -goal.vy
    goal.y = Math.max(margin, Math.min(canvasHeight - margin, goal.y))
  }
}

/**
 * Check if puck is inside a rectangular boundary (for shrinking arena)
 * Returns true if puck is OUT of bounds
 */
export function isOutOfArena(
  puck: Puck,
  arenaX: number,
  arenaY: number,
  arenaWidth: number,
  arenaHeight: number
): boolean {
  return (
    puck.x - puck.radius < arenaX ||
    puck.x + puck.radius > arenaX + arenaWidth ||
    puck.y - puck.radius < arenaY ||
    puck.y + puck.radius > arenaY + arenaHeight
  )
}

/**
 * Generate screen shake offset based on intensity
 * Intensity should decay over time
 */
export function getShakeOffset(intensity: number): { x: number; y: number } {
  return {
    x: (Math.random() - 0.5) * intensity * 2,
    y: (Math.random() - 0.5) * intensity * 2,
  }
}
