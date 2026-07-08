"use client"

import React, { useEffect, useRef, useState } from 'react'

type Streak = {
  x: number
  y: number
  vx: number
  vy: number
  hue: number // 0 = cyan, 1 = violet blend
  weight: number
}

/**
 * Streaky, cursor-reactive backdrop. Particles drift slowly and leave light
 * trails (motion blur via a low-alpha fade instead of a hard clear). Moving the
 * cursor "combs" nearby streaks along the cursor's own velocity, so the field
 * reacts as fast, directional streaks rather than a soft wave.
 */
export default function NeonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streaksRef = useRef<Streak[]>([])
  const mouseRef = useRef({ x: -9999, y: -9999, px: -9999, py: -9999, vx: 0, vy: 0 })
  const animationRef = useRef<number>()
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const update = () => setDimensions({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return
    const count = Math.min(150, Math.max(70, Math.floor((dimensions.width * dimensions.height) / 15000)))
    const drift = 26 // base drift speed (px/s equivalent, scaled per frame)
    streaksRef.current = Array.from({ length: count }, () => {
      const angle = Math.PI * 0.72 + (Math.random() - 0.5) * 0.5 // mostly down-left flow
      const speed = drift * (0.4 + Math.random() * 0.9)
      return {
        x: Math.random() * dimensions.width,
        y: Math.random() * dimensions.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: Math.random(),
        weight: 0.6 + Math.random() * 1.4,
      }
    })
  }, [dimensions])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(dimensions.width * dpr)
    canvas.height = Math.floor(dimensions.height * dpr)
    canvas.style.width = `${dimensions.width}px`
    canvas.style.height = `${dimensions.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = dimensions.width
    const H = dimensions.height
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // Static, calm render for reduced-motion users.
    if (reduced) {
      ctx.fillStyle = '#04060c'
      ctx.fillRect(0, 0, W, H)
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.5, Math.max(W, H) * 0.7)
      g.addColorStop(0, 'rgba(20, 46, 92, 0.35)')
      g.addColorStop(1, 'rgba(3, 5, 9, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      return
    }

    // Paint an opaque dark base once; subsequent frames only fade partially.
    ctx.fillStyle = '#04060c'
    ctx.fillRect(0, 0, W, H)

    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const m = mouseRef.current
      m.vx = m.x - m.px
      m.vy = m.y - m.py
      m.px = m.x
      m.py = m.y
      const mouseSpeed = Math.hypot(m.vx, m.vy)

      // Motion-blur fade — leaves streaks; darker = longer trails.
      ctx.fillStyle = 'rgba(4, 6, 12, 0.22)'
      ctx.fillRect(0, 0, W, H)

      // Soft cool vignette toward the top so the wordmark reads.
      const g = ctx.createRadialGradient(W / 2, H * 0.34, 0, W / 2, H * 0.46, Math.max(W, H) * 0.7)
      g.addColorStop(0, 'rgba(18, 42, 86, 0.05)')
      g.addColorStop(1, 'rgba(4, 6, 12, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      const influence = 220
      for (const s of streaksRef.current) {
        // Cursor combs nearby streaks along its own motion vector.
        if (mouseSpeed > 0.5) {
          const dx = s.x - m.x
          const dy = s.y - m.y
          const d = Math.hypot(dx, dy)
          if (d < influence) {
            const force = (1 - d / influence) * 0.35
            s.vx += m.vx * force
            s.vy += m.vy * force
          }
        }

        // Ease back toward the baseline flow speed so combs relax into drift.
        s.vx *= 0.94
        s.vy *= 0.94
        const px = s.x
        const py = s.y
        s.x += s.vx * dt * 60
        s.y += s.vy * dt * 60

        // Wrap around edges.
        if (s.x < -20) s.x = W + 20
        if (s.x > W + 20) s.x = -20
        if (s.y < -20) s.y = H + 20
        if (s.y > H + 20) s.y = -20

        // Draw the streak as a line from the previous position to the head,
        // exaggerated by current speed so fast streaks read as long light trails.
        const speed = Math.hypot(s.vx, s.vy)
        const len = Math.min(60, 2 + speed * 2.2)
        const nx = speed > 0.01 ? s.vx / speed : 0
        const ny = speed > 0.01 ? s.vy / speed : 0
        const r = Math.round(90 + s.hue * 90)
        const gg = Math.round(200 - s.hue * 40)
        const b = 240
        const alpha = Math.min(0.5, 0.12 + speed * 0.03)

        ctx.strokeStyle = `rgba(${r}, ${gg}, ${b}, ${alpha})`
        ctx.lineWidth = s.weight
        ctx.beginPath()
        ctx.moveTo(px - nx * len, py - ny * len)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()

        // Bright head.
        ctx.fillStyle = `rgba(200, 240, 255, ${alpha + 0.15})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.weight * 0.9, 0, Math.PI * 2)
        ctx.fill()
      }

      animationRef.current = requestAnimationFrame(frame)
    }

    animationRef.current = requestAnimationFrame(frame)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [dimensions])

  return <canvas ref={canvasRef} aria-hidden="true" className="neon-background" />
}
