"use client"

import React, { useEffect, useRef, useState } from 'react'

interface Dot {
  x: number
  y: number
  baseX: number
  baseY: number
  vx: number
  vy: number
}

export default function WaterDistortion() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotsRef = useRef<Dot[]>([])
  const mouseRef = useRef({ x: 0, y: 0 })
  const animationRef = useRef<number>()
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  // Initialize dimensions
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight })
    }
    
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Create dot field when dimensions change
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return
    
    const dotCount = 150 // Increased density
    const dots: Dot[] = []
    
    for (let i = 0; i < dotCount; i++) {
      const x = Math.random() * dimensions.width
      const y = Math.random() * dimensions.height
      
      dots.push({
        x,
        y,
        baseX: x,
        baseY: y,
        vx: 0,
        vy: 0
      })
    }
    
    dotsRef.current = dots
  }, [dimensions])

  // Track mouse movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Animation loop
  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0) return
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = dimensions.width
    canvas.height = dimensions.height

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const mouseX = mouseRef.current.x
      const mouseY = mouseRef.current.y
      const radius = 200 // Increased radius
      
      // Update dots with magnetic distortion
      dotsRef.current.forEach(dot => {
        const dx = mouseX - dot.x
        const dy = mouseY - dot.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        // Magnetic distortion - stronger pull
        if (distance < radius) {
          const influence = (1 - distance / radius)
          dot.vx += dx * influence * 0.01 // Stronger pull
          dot.vy += dy * influence * 0.01
        }
        
        // Return force
        dot.vx += (dot.baseX - dot.x) * 0.02
        dot.vy += (dot.baseY - dot.y) * 0.02
        
        // Damping
        dot.vx *= 0.88
        dot.vy *= 0.88
        
        // Update position
        dot.x += dot.vx
        dot.y += dot.vy
      })
      
      // Render dots
      ctx.fillStyle = 'rgba(130, 170, 210, 0.28)'
      
      dotsRef.current.forEach(dot => {
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, 1.8, 0, Math.PI * 2) // Larger dots
        ctx.fill()
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }
    
    animate()
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [dimensions])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        pointerEvents: 'none'
      }}
    />
  )
}
