"use client"

import React, { useEffect, useRef, useState } from 'react'

type Dot = {
  x: number
  y: number
  baseX: number
  baseY: number
  vx: number
  vy: number
  radius: number
  opacity: number
  phase: number
}

type Ripple = {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
}

export default function NeonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotsRef = useRef<Dot[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const lastRippleTimeRef = useRef(0)
  const animationRef = useRef<number>()
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight })
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return

    const count = Math.min(160, Math.max(90, Math.floor((dimensions.width * dimensions.height) / 11000)))
    dotsRef.current = Array.from({ length: count }, () => {
      const x = Math.random() * dimensions.width
      const y = Math.random() * dimensions.height

      return {
        x,
        y,
        baseX: x,
        baseY: y,
        vx: 0,
        vy: 0,
        radius: 1 + Math.random() * 1.6,
        opacity: 0.1 + Math.random() * 0.22,
        phase: Math.random() * Math.PI * 2,
      }
    })
  }, [dimensions])

  useEffect(() => {
    const createRipple = (x: number, y: number) => {
      if (ripplesRef.current.length >= 6) ripplesRef.current.shift()

      ripplesRef.current.push({
        x,
        y,
        radius: 0,
        maxRadius: 110 + Math.random() * 70,
        opacity: 0.16 + Math.random() * 0.08,
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
      const now = Date.now()

      if (now - lastRippleTimeRef.current > 220) {
        createRipple(e.clientX, e.clientY)
        lastRippleTimeRef.current = now
      }
    }

    const handleClick = (e: MouseEvent) => createRipple(e.clientX, e.clientY)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('click', handleClick)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('click', handleClick)
    }
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

    const animate = () => {
      ctx.clearRect(0, 0, dimensions.width, dimensions.height)

      const gradient = ctx.createRadialGradient(
        dimensions.width / 2,
        dimensions.height * 0.35,
        0,
        dimensions.width / 2,
        dimensions.height * 0.5,
        Math.max(dimensions.width, dimensions.height) * 0.75
      )
      gradient.addColorStop(0, 'rgba(45, 226, 230, 0.08)')
      gradient.addColorStop(0.5, 'rgba(10, 18, 42, 0.28)')
      gradient.addColorStop(1, 'rgba(5, 7, 15, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, dimensions.width, dimensions.height)

      const { x: mouseX, y: mouseY } = mouseRef.current
      const influenceRadius = 190

      for (const dot of dotsRef.current) {
        dot.phase += 0.012
        const dx = mouseX - dot.x
        const dy = mouseY - dot.y
        const distance = Math.hypot(dx, dy)

        if (distance < influenceRadius) {
          const force = 1 - distance / influenceRadius
          dot.vx += dx * force * 0.004
          dot.vy += dy * force * 0.004
        }

        dot.vx += (dot.baseX - dot.x) * 0.012
        dot.vy += (dot.baseY - dot.y) * 0.012
        dot.vx *= 0.9
        dot.vy *= 0.9
        dot.x += dot.vx
        dot.y += dot.vy

        const twinkle = Math.sin(dot.phase) * 0.04
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(132, 184, 211, ${Math.max(0.05, dot.opacity + twinkle)})`
        ctx.fill()
      }

      ripplesRef.current = ripplesRef.current.filter((ripple) => {
        ripple.radius += 2.1
        ripple.opacity -= 0.011
        if (ripple.opacity <= 0 || ripple.radius > ripple.maxRadius) return false

        ctx.beginPath()
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(45, 226, 230, ${ripple.opacity})`
        ctx.lineWidth = 1
        ctx.shadowColor = `rgba(45, 226, 230, ${ripple.opacity * 0.6})`
        ctx.shadowBlur = 10
        ctx.stroke()
        ctx.shadowBlur = 0

        return true
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [dimensions])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="neon-background"
    />
  )
}
