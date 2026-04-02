// Simple vector and physics utilities used by the game

export type Puck = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  isPlayer?: boolean
}

export type Vec = { x: number; y: number }

// Returns squared distance between two points (faster than sqrt when comparing)
export function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

// Normalize a vector and return as unit vector (0,0 if zero length)
export function normalize(v: Vec): Vec {
  const mag = Math.hypot(v.x, v.y)
  if (mag === 0) return { x: 0, y: 0 }
  return { x: v.x / mag, y: v.y / mag }
}

// Update puck position using basic Euler integration
// dt is in seconds
export function integrate(p: Puck, dt: number) {
  p.x += p.vx * dt
  p.y += p.vy * dt
}

// Simple circle-circle collision check
// Two circles collide if distance between centers <= sum of radii
export function circlesCollide(a: Puck, b: Puck) {
  const r = a.radius + b.radius
  return dist2(a.x, a.y, b.x, b.y) <= r * r
}
