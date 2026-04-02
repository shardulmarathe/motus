import { Puck, normalize } from './physics'

// Create the player puck centered at (cx, cy)
export function createPlayer(cx: number, cy: number): Puck {
  return {
    x: cx,
    y: cy,
    vx: 0,
    vy: 0,
    radius: 14,
    isPlayer: true,
  }
}

// Spawn an enemy on a random edge with velocity pointing inward
export function spawnEnemy(width: number, height: number): Puck {
  const edge = Math.floor(Math.random() * 4) // 0=top,1=right,2=bottom,3=left
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

  // Aim towards center plus a small random variation
  const cx = width / 2
  const cy = height / 2
  const dir = normalize({ x: cx - x + (Math.random() - 0.5) * 80, y: cy - y + (Math.random() - 0.5) * 80 })

  const speed = 60 + Math.random() * 100 // px/s

  return {
    x,
    y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    radius: 12,
  }
}
