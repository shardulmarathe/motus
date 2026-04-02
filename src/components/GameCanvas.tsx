"use client";
import React, { useEffect, useRef } from 'react'
import { Puck, integrate, circlesCollide } from '../lib/physics'
import { createPlayer, spawnEnemy } from '../lib/gameLogic'

type GameState = 'playing' | 'gameOver'

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const playerRef = useRef<Puck | null>(null)
  const enemiesRef = useRef<Puck[]>([])
  const stateRef = useRef<GameState>('playing')

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const parent = canvas.parentElement!
      canvas.width = parent.clientWidth - 16
      canvas.height = parent.clientHeight - 16
      // Reset player to center on resize
      playerRef.current = createPlayer(canvas.width / 2, canvas.height / 2)
      enemiesRef.current = [spawnEnemy(canvas.width, canvas.height)]
      stateRef.current = 'playing'
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Input: mouse clicks => set player velocity towards click
  useEffect(() => {
    const canvas = canvasRef.current!
    function onClick(e: MouseEvent) {
      if (!playerRef.current || stateRef.current === 'gameOver') return
      const rect = canvas.getBoundingClientRect()
      const cx = rect.left
      const cy = rect.top
      const tx = e.clientX - cx
      const ty = e.clientY - cy
      const dx = tx - playerRef.current.x
      const dy = ty - playerRef.current.y
      const mag = Math.hypot(dx, dy)
      const maxSpeed = 300
      const speed = Math.min(maxSpeed, mag * 3)
      if (mag > 0) {
        playerRef.current.vx = (dx / mag) * speed
        playerRef.current.vy = (dy / mag) * speed
      }
    }

    function onKey(e: KeyboardEvent) {
      if (!playerRef.current) return
      if (e.code === 'Space') {
        // restart
        const canvas = canvasRef.current!
        playerRef.current = createPlayer(canvas.width / 2, canvas.height / 2)
        enemiesRef.current = [spawnEnemy(canvas.width, canvas.height)]
        stateRef.current = 'playing'
      }

      if (stateRef.current === 'gameOver') return

      const keySpeed = 220
      if (e.key === 'ArrowUp') playerRef.current.vy = -keySpeed
      if (e.key === 'ArrowDown') playerRef.current.vy = keySpeed
      if (e.key === 'ArrowLeft') playerRef.current.vx = -keySpeed
      if (e.key === 'ArrowRight') playerRef.current.vx = keySpeed
    }

    canvas.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Main game loop using requestAnimationFrame
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    // update() moves simulation forward by dt seconds
    function update(dt: number) {
      if (stateRef.current === 'gameOver') return
      const player = playerRef.current!
      integrate(player, dt)

      // Keep player inside bounds
      if (player.x < player.radius) player.x = player.radius
      if (player.y < player.radius) player.y = player.radius
      if (player.x > canvas.width - player.radius) player.x = canvas.width - player.radius
      if (player.y > canvas.height - player.radius) player.y = canvas.height - player.radius

      // Update enemies
      for (const e of enemiesRef.current) {
        integrate(e, dt)
      }

      // Spawn a new enemy occasionally
      if (Math.random() < dt * 0.8) {
        enemiesRef.current.push(spawnEnemy(canvas.width, canvas.height))
      }

      // Collision detection: player vs enemies
      for (const e of enemiesRef.current) {
        if (circlesCollide(player, e)) {
          stateRef.current = 'gameOver'
          // Stop movement
          player.vx = 0
          player.vy = 0
        }
      }
    }

    // render() draws the current state to the canvas
    function render() {
      const w = canvas.width
      const h = canvas.height
      // Clear
      ctx.clearRect(0, 0, w, h)

      // Background subtle grid (optional)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(0, 0, w, h)

      // Draw player
      const player = playerRef.current!
      ctx.beginPath()
      ctx.fillStyle = '#60a5fa'
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2)
      ctx.fill()

      // Draw enemies
      for (const e of enemiesRef.current) {
        ctx.beginPath()
        ctx.fillStyle = '#fb7185'
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // If game over, overlay message
      if (stateRef.current === 'gameOver') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#fff'
        ctx.font = '28px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Game Over — Press SPACE to restart', w / 2, h / 2)
      }
    }

    function loop(now: number) {
      if (!lastRef.current) lastRef.current = now
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now

      // Cap dt to avoid huge jumps when tab was inactive
      const capped = Math.min(dt, 0.05)
      update(capped)
      render()

      rafRef.current = requestAnimationFrame(loop)
    }

    // Initialize player & an enemy if missing
    if (!playerRef.current) {
      playerRef.current = createPlayer(canvas.width / 2, canvas.height / 2)
    }
    if (enemiesRef.current.length === 0) {
      enemiesRef.current = [spawnEnemy(canvas.width, canvas.height)]
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 6 }} />
}
