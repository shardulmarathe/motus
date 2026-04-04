"use client"

import React, { useEffect, useRef, useState } from 'react'

interface Particle {
  x: number
  y: number
  baseX: number
  baseY: number
  vx: number
  vy: number
}

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
}

interface BackgroundDot {
  x: number
  y: number
  baseOpacity: number
  currentOpacity: number
  twinkleSpeed: number
  twinklePhase: number
}

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const backgroundDotsRef = useRef<BackgroundDot[]>([])
  const mouseRef = useRef({ x: 0, y: 0 })
  const lastRippleTimeRef = useRef(0)
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

  // Create particles and background dots when dimensions change
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return
    
    // Create magnetic particles
    const particleCount = 60
    const particles: Particle[] = []
    
    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * dimensions.width
      const y = Math.random() * dimensions.height
      
      particles.push({
        x,
        y,
        baseX: x,
        baseY: y,
        vx: 0,
        vy: 0
      })
    }
    
    particlesRef.current = particles
    
    // Create background dots
    const dotCount = 50
    const dots: BackgroundDot[] = []
    
    for (let i = 0; i < dotCount; i++) {
      dots.push({
        x: Math.random() * dimensions.width,
        y: Math.random() * dimensions.height,
        baseOpacity: 0.1 + Math.random() * 0.2, // 0.1 to 0.3
        currentOpacity: 0.1 + Math.random() * 0.2,
        twinkleSpeed: 0.001 + Math.random() * 0.002, // Very slow
        twinklePhase: Math.random() * Math.PI * 2
      })
    }
    
    backgroundDotsRef.current = dots
  }, [dimensions])

  // Track mouse movement and create ripples
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
      
      // Throttle ripple creation
      const now = Date.now()
      if (now - lastRippleTimeRef.current > 150) { // Create ripple every 150ms (was 300ms)
        createRipple(e.clientX, e.clientY)
        lastRippleTimeRef.current = now
      }
    }

    const handleClick = (e: MouseEvent) => {
      createRipple(e.clientX, e.clientY)
    }

    const createRipple = (x: number, y: number) => {
      // Limit active ripples
      if (ripplesRef.current.length >= 10) { // Increased from 6 to 10
        ripplesRef.current.shift() // Remove oldest ripple
      }
      
      ripplesRef.current.push({
        x,
        y,
        radius: 0,
        maxRadius: 120 + Math.random() * 60, // 120-180
        opacity: 0.15 + Math.random() * 0.1 // 0.15-0.25
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('click', handleClick)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('click', handleClick)
    }
  }, [])

  // Animation loop
  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0) return
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = dimensions.width
    canvas.height = dimensions.height

    let time = 0

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      time += 0.016 // ~60fps
      
      const mouseX = mouseRef.current.x
      const mouseY = mouseRef.current.y
      const radius = 180
      
      // Update and render background dots with subtle twinkle
      backgroundDotsRef.current.forEach(dot => {
        // Very subtle twinkle effect
        dot.twinklePhase += dot.twinkleSpeed
        const twinkle = Math.sin(dot.twinklePhase) * 0.05 // ±5% variation
        dot.currentOpacity = Math.max(0.05, Math.min(0.25, dot.baseOpacity + twinkle))
        
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(80, 120, 160, ${dot.currentOpacity})` // Darker, less blue
        ctx.fill()
      })
      
      // Update and render magnetic particles
      particlesRef.current.forEach(particle => {
        const dx = mouseX - particle.x
        const dy = mouseY - particle.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        // Magnetic force
        if (distance < radius) {
          const force = (1 - distance / radius)
          particle.vx += dx * force * 0.002
          particle.vy += dy * force * 0.002
        }
        
        // Return to original position
        particle.vx += (particle.baseX - particle.x) * 0.01
        particle.vy += (particle.baseY - particle.y) * 0.01
        
        // Damping
        particle.vx *= 0.9
        particle.vy *= 0.9
        
        // Update position
        particle.x += particle.vx
        particle.y += particle.vy
        
        // Render particle
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(80, 140, 180, 0.35)' // Darker, less blue, lower opacity
        ctx.fill()
      })
      
      // Update and render ripples
      ripplesRef.current = ripplesRef.current.filter(ripple => {
        ripple.radius += 2.5
        ripple.opacity -= 0.015
        
        // Remove ripple if it's too faded or too large
        if (ripple.opacity <= 0 || ripple.radius > ripple.maxRadius) {
          return false
        }
        
        // Render ripple as soft circle stroke
        ctx.beginPath()
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(80, 140, 180, ${ripple.opacity})` // Darker, less blue
        ctx.lineWidth = 1
        ctx.stroke()
        
        // Add subtle glow
        ctx.shadowColor = `rgba(80, 140, 180, ${ripple.opacity * 0.5})` // Darker, less blue
        ctx.shadowBlur = 10
        ctx.stroke()
        ctx.shadowBlur = 0
        
        return true
      })
      
      // Cursor glow temporarily removed for testing
      // const gradient = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 120)
      // gradient.addColorStop(0, 'rgba(80, 140, 180, 0.08)')
      // gradient.addColorStop(1, 'rgba(80, 140, 180, 0)')
      
      // ctx.beginPath()
      // ctx.arc(mouseX, mouseY, 120, 0, Math.PI * 2)
      // ctx.fillStyle = gradient
      // ctx.fill()
      
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
