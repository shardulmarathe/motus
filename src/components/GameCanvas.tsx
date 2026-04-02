"use client";

import React, { useEffect, useRef, forwardRef } from 'react'
import { Puck, Goal, integrate, applyAcceleration, applyDamping, circlesCollide, puckCollideGoal, isOutOfBounds, integrateGoal, isOutOfArena, getShakeOffset, repositionGoalInBounds } from '../lib/physics'
import {
  createPlayer,
  spawnEnemy,
  spawnCataclysmGoals,
  getEventType,
  getEventName,
  getCataclysmObjective,
  getDifficultyMultiplier,
  shouldTriggerCataclysm,
  calculateArenaSize,
  type CataclysmEventType,
} from '../lib/gameLogic'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

interface CataclysmData {
  timeLeft: number
  goalsNeeded: number
  goalsCollected: number
  eventType: CataclysmEventType
  eventName: string
  goals: Goal[]
  arenaWidth?: number
  arenaHeight?: number
  enterTime?: number // For fade-in animation
}

interface GameData {
  score: number
  stage: number
  state: 'playing' | 'cataclysm' | 'gameOver'
  cataclysm?: CataclysmData
  lastCataclysmTriggerScore: number
  cataclysmCount: number
}

interface GameCanvasProps {
  onStateChange?: (state: { score: number; stage: number; mode: string; eventTimeLeft?: number; inEvent?: boolean; eventName?: string }) => void
  isPaused?: boolean
  uiState?: 'title' | 'rules' | 'playing' | 'paused'
}

const GameCanvas = forwardRef<HTMLCanvasElement, GameCanvasProps>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const playerRef = useRef<Puck | null>(null)
  const enemiesRef = useRef<Puck[]>([])
  const goalRef = useRef<Goal | null>(null)
  const gameDataRef = useRef<GameData>({
    score: 0,
    stage: 1,
    state: 'playing',
    lastCataclysmTriggerScore: 0,
    cataclysmCount: 0,
  })

  const activeKeysRef = useRef<Set<string>>(new Set())
  const shakeIntensityRef = useRef<number>(0)
  const collisionFlashRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])
  const pauseTimeRef = useRef<number | null>(null)
  const canvasWidthRef = useRef<number>(0) // Display width (unscaled)
  const canvasHeightRef = useRef<number>(0) // Display height (unscaled)

  // Expose canvas ref
  useEffect(() => {
    if (ref) {
      if (typeof ref === 'function') {
        ref(canvasRef.current)
      } else {
        ref.current = canvasRef.current
      }
    }
  }, [ref])

  // Emit game state updates
  const updateGameState = () => {
    const gameData = gameDataRef.current
    let mode = 'Normal'
    let eventTimeLeft: number | undefined = undefined
    let inEvent = false
    let eventName: string | undefined = undefined
    
    if (gameData.state === 'cataclysm' && gameData.cataclysm) {
      mode = 'Event'
      eventTimeLeft = gameData.cataclysm.timeLeft
      inEvent = true
      eventName = gameData.cataclysm.eventName
    }

    const state = {
      score: gameData.score,
      stage: gameData.stage,
      mode,
      eventTimeLeft,
      inEvent,
      eventName,
    }

    if (props.onStateChange) {
      props.onStateChange(state)
    }

    // Also emit as event for backward compatibility
    window.dispatchEvent(
      new CustomEvent('gameStateUpdate', { detail: state })
    )
  }

  const resetGame = (options?: { spawnEnemies?: boolean }) => {
    const w = canvasWidthRef.current
    const h = canvasHeightRef.current
    playerRef.current = createPlayer(w / 2, h / 2)
    const spawnEnemies = options?.spawnEnemies ?? (props.uiState === 'playing' || props.uiState === 'rules')
    enemiesRef.current = spawnEnemies ? [spawnEnemy(w, h, 1, 1)] : []
    goalRef.current = spawnEnemies
      ? spawnCataclysmGoals(w, h, playerRef.current.x, playerRef.current.y)[0]
      : null
    gameDataRef.current = {
      score: 0,
      stage: 1,
      state: 'playing',
      lastCataclysmTriggerScore: 0,
      cataclysmCount: 0,
    }
    activeKeysRef.current.clear()
    shakeIntensityRef.current = 0
    collisionFlashRef.current = 0
    particlesRef.current = []
    updateGameState()
  }

  const spawnBurst = (x: number, y: number) => {
    const particleCount = 12
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2
      const speed = 200
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
      })
    }
  }

  // Handle pause events
  useEffect(() => {
    const handlePause = (e: any) => {
      if (e.detail && !props.isPaused && lastRef.current) {
        // Pause started, save current time
        pauseTimeRef.current = performance.now()
      } else if (!e.detail && props.isPaused && pauseTimeRef.current) {
        // Resume, add pause duration to lastRef
        const pauseDuration = (performance.now() - pauseTimeRef.current) / 1000
        if (lastRef.current) {
          lastRef.current += pauseDuration
        }
        pauseTimeRef.current = null
      }
    }

    window.addEventListener('gamePause', handlePause)
    return () => window.removeEventListener('gamePause', handlePause)
  }, [props.isPaused])

  // Setup canvas and input
  useEffect(() => {
    // Respond to UI state changes from parent. This allows the page to control
    // initialization (title = clean canvas, rules = initialize but paused,
    // playing = start game, paused = keep paused)
    // Note: we intentionally initialize entities for `rules` so the rules modal
    // shows over a ready-but-paused game.
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const parent = canvas.parentElement!
      const clientWidth = parent.clientWidth
      const clientHeight = parent.clientHeight
      
      // Store display dimensions for game logic (no HUD offset needed - canvas is below HUD)
      canvasWidthRef.current = clientWidth
      canvasHeightRef.current = clientHeight
      
      // Set internal resolution for high-DPI displays
      canvas.width = clientWidth * dpr
      canvas.height = clientHeight * dpr
      
      // Scale context to match device pixel ratio
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      
      // Set CSS size to match intended display size
      canvas.style.width = `${clientWidth}px`
      canvas.style.height = `${clientHeight}px`
      
      resetGame()
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!

    function onClick(e: MouseEvent) {
      if (!playerRef.current || gameDataRef.current.state === 'gameOver') return
      const rect = canvas.getBoundingClientRect()
      const tx = e.clientX - rect.left
      const ty = e.clientY - rect.top
      const dx = tx - playerRef.current.x
      const dy = ty - playerRef.current.y
      const mag = Math.hypot(dx, dy)
      const maxSpeed = 350
      const speed = Math.min(maxSpeed, mag * 2.5)
      if (mag > 0) {
        playerRef.current.vx = (dx / mag) * speed
        playerRef.current.vy = (dy / mag) * speed
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!playerRef.current) return

      if (e.code === 'Space') {
        if (gameDataRef.current.state === 'gameOver') {
          resetGame()
          return
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        activeKeysRef.current.add(e.key)
        e.preventDefault()
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        activeKeysRef.current.delete(e.key)
        e.preventDefault()
      }
    }

    canvas.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      canvas.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Main game loop
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    function update(dt: number) {
      const gameData = gameDataRef.current
      // Only run game logic when the UI state explicitly indicates `playing`.
      if (props.uiState !== 'playing' || gameData.state === 'gameOver' || props.isPaused) return

      const player = playerRef.current!
      const w = canvasWidthRef.current
      const h = canvasHeightRef.current

      // ===== MOMENTUM-BASED MOVEMENT =====
      const acceleration = 1000
      if (activeKeysRef.current.has('ArrowRight')) applyAcceleration(player, acceleration * dt, 0)
      if (activeKeysRef.current.has('ArrowLeft')) applyAcceleration(player, -acceleration * dt, 0)
      if (activeKeysRef.current.has('ArrowDown')) applyAcceleration(player, 0, acceleration * dt)
      if (activeKeysRef.current.has('ArrowUp')) applyAcceleration(player, 0, -acceleration * dt)

      applyDamping(player, 0.99)

      const maxVel = 500
      const velMag = Math.hypot(player.vx, player.vy)
      if (velMag > maxVel) {
        const scale = maxVel / velMag
        player.vx *= scale
        player.vy *= scale
      }

      integrate(player, dt)

      if (isOutOfBounds(player, w, h)) {
        gameData.state = 'gameOver'
        player.vx = 0
        player.vy = 0
        shakeIntensityRef.current = 20
        collisionFlashRef.current = 0.5
        return
      }

      for (const enemy of enemiesRef.current) {
        integrate(enemy, dt)
      }

      const diffMultiplier = getDifficultyMultiplier(gameData.cataclysmCount)
      const baseSpawnChance = 0.8
      const spawnChance = baseSpawnChance * diffMultiplier
      // CRITICAL FIX: Enemies spawn during ALL modes, not just playing
      if (Math.random() < dt * spawnChance) {
        enemiesRef.current.push(spawnEnemy(w, h, gameData.stage, diffMultiplier))
      }

      enemiesRef.current = enemiesRef.current.filter((e) => {
        return (
          e.x + e.radius > -50 &&
          e.x - e.radius < w + 50 &&
          e.y + e.radius > -50 &&
          e.y - e.radius < h + 50
        )
      })

      // ===== NORMAL MODE: GOAL COLLECTION =====
      if (gameData.state === 'playing' && goalRef.current) {
        if (puckCollideGoal(player, goalRef.current)) {
          gameData.score++
          spawnBurst(goalRef.current.x, goalRef.current.y)

          if (
            shouldTriggerCataclysm(gameData.score) &&
            gameData.score > gameData.lastCataclysmTriggerScore
          ) {
            gameData.state = 'cataclysm'
            gameData.lastCataclysmTriggerScore = gameData.score
            const eventType = getEventType()
            const cataclysmGoals = spawnCataclysmGoals(
              w,
              h,
              player.x,
              player.y,
              eventType === 'movingGoals'
            )
            gameData.cataclysm = {
              timeLeft: 30,
              goalsNeeded: 7,
              goalsCollected: 0,
              eventType,
              eventName: getEventName(eventType),
              goals: cataclysmGoals,
              arenaWidth: w,
              arenaHeight: h,
              enterTime: 0,
            }
          } else {
            const goals = spawnCataclysmGoals(w, h, player.x, player.y)
            goalRef.current = goals[0]
          }
          updateGameState()
        }
      }

      // ===== CATACLYSM MODE =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        const cat = gameData.cataclysm
        if (cat.enterTime !== undefined) cat.enterTime += dt
        
        // Only decrement timer AFTER intro finishes (enterTime >= 1.5)
        if (cat.enterTime === undefined || cat.enterTime >= 1.5) {
          cat.timeLeft -= dt
        }

        if (cat.eventType === 'movingGoals') {
          for (const goal of cat.goals) {
            integrateGoal(goal, dt, w, h)
          }
        }

        if (cat.eventType === 'shakeMode') {
          shakeIntensityRef.current = Math.max(0, 8 - cat.goalsCollected)
        }

        if (cat.eventType === 'shrinkingArena') {
          const arenaSize = calculateArenaSize(
            cat.arenaWidth!,
            cat.arenaHeight!,
            cat.timeLeft,
            30
          )
          
          // Ensure all goals stay within the shrinking boundary
          for (const goal of cat.goals) {
            repositionGoalInBounds(goal, arenaSize.x, arenaSize.y, arenaSize.width, arenaSize.height)
          }
          
          // CONSTRAINT: Keep enemies within shrinking arena
          for (const enemy of enemiesRef.current) {
            const enemyLeft = enemy.x - enemy.radius
            const enemyRight = enemy.x + enemy.radius
            const enemyTop = enemy.y - enemy.radius
            const enemyBottom = enemy.y + enemy.radius
            
            // Clamp enemy position to stay within shrinking boundary
            if (enemyLeft < arenaSize.x) {
              enemy.x = arenaSize.x + enemy.radius
              enemy.vx = Math.abs(enemy.vx) // Bounce inward
            }
            if (enemyRight > arenaSize.x + arenaSize.width) {
              enemy.x = arenaSize.x + arenaSize.width - enemy.radius
              enemy.vx = -Math.abs(enemy.vx) // Bounce inward
            }
            if (enemyTop < arenaSize.y) {
              enemy.y = arenaSize.y + enemy.radius
              enemy.vy = Math.abs(enemy.vy) // Bounce inward
            }
            if (enemyBottom > arenaSize.y + arenaSize.height) {
              enemy.y = arenaSize.y + arenaSize.height - enemy.radius
              enemy.vy = -Math.abs(enemy.vy) // Bounce inward
            }
          }
          
          if (isOutOfArena(player, arenaSize.x, arenaSize.y, arenaSize.width, arenaSize.height)) {
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
            return
          }
        }

        // Only count goals AFTER overlay finishes (enterTime >= 1.5)
        const isInOverlay = (cat.enterTime ?? 0) < 1.5
        
        for (let i = 0; i < cat.goals.length; i++) {
          const goal = cat.goals[i]
          if (puckCollideGoal(player, goal) && !isInOverlay) {
            cat.goalsCollected++
            spawnBurst(goal.x, goal.y)
            cat.goals.splice(i, 1)
            i--

            if (cat.goalsCollected >= cat.goalsNeeded) {
              gameData.stage++
              gameData.cataclysmCount++
              gameData.state = 'playing'
              gameData.cataclysm = undefined
              shakeIntensityRef.current = 0
              
              // Apply difficulty scaling: increase enemy speed and spawn rate
              // Enemies spawned after this point will use the updated difficulty multiplier
              
              const goals = spawnCataclysmGoals(w, h, player.x, player.y)
              goalRef.current = goals[0]
              updateGameState()
            }
          }
        }

        if (cat.timeLeft <= 0) {
          gameData.state = 'gameOver'
          player.vx = 0
          player.vy = 0
          shakeIntensityRef.current = 20
          collisionFlashRef.current = 0.5
        }
      }

      // Collision detection - with grace period during event overlay
      const isInEventOverlay = gameData.state === 'cataclysm' && 
        gameData.cataclysm && 
        (gameData.cataclysm.enterTime ?? 0) < 1.5
      
      for (const enemy of enemiesRef.current) {
        if (circlesCollide(player, enemy)) {
          // Don't die during overlay grace period (fairness - transition from intro to gameplay)
          if (!isInEventOverlay) {
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
            return
          }
        }
      }

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i]
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.life -= dt
        if (p.life <= 0) {
          particlesRef.current.splice(i, 1)
          i--
        }
      }

      shakeIntensityRef.current *= 0.95
      collisionFlashRef.current *= 0.92
    }

    // ===== RENDERING FUNCTIONS =====

    const drawGradientPuck = (x: number, y: number, radius: number, colorStop1: string, colorStop2: string) => {
      // Use perfect circle with radial gradient - no distortion
      const grad = ctx.createRadialGradient(x - 3, y - 3, 0, x, y, radius)
      grad.addColorStop(0, colorStop1)
      grad.addColorStop(1, colorStop2)
      ctx.fillStyle = grad
      ctx.beginPath()
      // Perfect circle: same radius for x and y
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    const drawGlowCircle = (x: number, y: number, radius: number, color: string, blur: number, alpha: number) => {
      // Draw perfect glow circle without distortion
      ctx.shadowColor = color
      ctx.shadowBlur = blur
      ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
      ctx.beginPath()
      // Perfect circle: same radius for x and y
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    function render() {
      const w = canvasWidthRef.current
      const h = canvasHeightRef.current
      const gameData = gameDataRef.current
      const shake = getShakeOffset(shakeIntensityRef.current)

      // Clear canvas completely to prevent motion trails/streaking
      ctx.clearRect(0, 0, w, h)

      ctx.save()
      ctx.translate(shake.x, shake.y)

      const player = playerRef.current!

      // ===== DRAW NORMAL MODE GOAL =====
      if (gameData.state === 'playing' && goalRef.current) {
        const goal = goalRef.current
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7
        const glowSize = goal.radius + 8 + pulse * 4

        drawGlowCircle(goal.x, goal.y, glowSize, '#22c55e', 20, 0.3)
        drawGradientPuck(goal.x, goal.y, goal.radius, '#4ade80', '#22c55e')
      }

      // ===== DRAW CATACLYSM GOALS =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        for (const goal of gameData.cataclysm.goals) {
          drawGlowCircle(goal.x, goal.y, goal.radius + 6, '#22c55e', 15, 0.25)
          drawGradientPuck(goal.x, goal.y, goal.radius, '#4ade80', '#22c55e')
        }
      }

      // ===== DRAW SHRINKING ARENA =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm?.eventType === 'shrinkingArena' && gameData.cataclysm) {
        const arenaSize = calculateArenaSize(
          gameData.cataclysm.arenaWidth!,
          gameData.cataclysm.arenaHeight!,
          gameData.cataclysm.timeLeft,
          30
        )
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'
        ctx.lineWidth = 2
        ctx.shadowColor = '#fbbf24'
        ctx.shadowBlur = 15
        ctx.strokeRect(arenaSize.x, arenaSize.y, arenaSize.width, arenaSize.height)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }

      // ===== DRAW ENEMIES =====
      for (const enemy of enemiesRef.current) {
        drawGlowCircle(enemy.x, enemy.y, enemy.radius + 6, '#ef4444', 12, 0.2)
        drawGradientPuck(enemy.x, enemy.y, enemy.radius, '#fca5a5', '#ef4444')
      }

      // ===== DRAW PARTICLES =====
      for (const p of particlesRef.current) {
        const alpha = p.life / 0.6
        ctx.fillStyle = `rgba(34, 197, 94, ${alpha * 0.7})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }

      // ===== DRAW PLAYER =====
      drawGlowCircle(player.x, player.y, player.radius + 8, '#06b6d4', 25, 0.4)
      drawGradientPuck(player.x, player.y, player.radius, '#67e8f9', '#06b6d4')

      // Player highlight
      const highlightGrad = ctx.createRadialGradient(player.x - 4, player.y - 4, 0, player.x, player.y, player.radius)
      highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
      highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = highlightGrad
      ctx.beginPath()
      ctx.arc(player.x - 4, player.y - 4, player.radius * 0.4, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()

      // ===== RENDER ORDER ===== 
      // 1. Background (cleared above)
      // 2. Border (canvas boundary)
      // 3. Goals and enemies and player (drawn above)
      // 4. Effects and particles (drawn above)
      // 5. Now draw boundary border at the end
      
      // ===== DRAW BOUNDARY INDICATOR WITH PROXIMITY-BASED GLOW =====
      // Border is subtle when far from edge, glows red when player approaches danger
      const proximityThreshold = 100 // pixels from edge where danger activates
      const minDistToBoundary = Math.min(
        player.x - player.radius,
        player.y - player.radius,
        w - (player.x + player.radius),
        h - (player.y + player.radius)
      )
      
      // proximityFactor: 0 = far from edge (safe), 1 = at edge (danger)
      const proximityFactor = Math.max(0, 1 - (minDistToBoundary / proximityThreshold))
      
      // Dynamic styling based on proximity
      // Far from edge: very subtle white border
      // Near edge: transitions to intense red glow
      let outerColor: string
      let innerColor: string
      let shadowColor: string
      let shadowBlur: number
      let outerOpacity: number
      let innerOpacity: number
      let lineWidth: number
      
      if (proximityFactor < 0.1) {
        // SAFE: Very subtle neutral border (almost invisible)
        outerColor = 'rgba(255, 255, 255, 0.05)'
        innerColor = 'rgba(255, 255, 255, 0.08)'
        shadowColor = 'transparent'
        shadowBlur = 0
        outerOpacity = 1
        innerOpacity = 1
        lineWidth = 1
      } else {
        // DANGER: Red/orange glowing alarm state
        const dangerFactor = proximityFactor // Now 0.1 to 1.0
        outerColor = `rgba(239, 68, 68, ${0.3 * dangerFactor})`
        innerColor = `rgba(252, 165, 165, ${0.4 + dangerFactor * 0.6})`
        shadowColor = '#ef4444'
        shadowBlur = 15 + dangerFactor * 25
        outerOpacity = 1
        innerOpacity = 1
        lineWidth = 2 + dangerFactor * 2
      }
      
      // Outer glow layer
      ctx.strokeStyle = outerColor
      ctx.lineWidth = 8
      ctx.shadowColor = shadowColor
      ctx.shadowBlur = shadowBlur
      ctx.strokeRect(0, 0, w, h)
      
      // Inner bright edge
      ctx.strokeStyle = innerColor
      ctx.lineWidth = lineWidth
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.strokeRect(0, 0, w, h)
      
      // Optional: Subtle screen tint when VERY close to danger (proximityFactor > 0.8)
      if (proximityFactor > 0.8) {
        const tintAlpha = (proximityFactor - 0.8) * 0.2 * 0.15 // Very subtle
        ctx.fillStyle = `rgba(239, 68, 68, ${tintAlpha})`
        ctx.fillRect(0, 0, w, h)
      }

      // ===== COLLISION FLASH =====
      if (collisionFlashRef.current > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${collisionFlashRef.current * 0.3})`
        ctx.fillRect(0, 0, w, h)
      }

      // ===== OPTIONAL: EVENT VIGNETTE (subtle intensity effect) =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        const vignetteIntensity = 0.15
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.max(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8)
        gradient.addColorStop(0, `rgba(0, 0, 0, 0)`)
        gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteIntensity})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
      }

      // ===== CATACLYSM EVENT - INTRO OVERLAY + TIMER =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        const cat = gameData.cataclysm
        const enterTime = cat.enterTime ?? 0
        
        // ===== EVENT INTRO OVERLAY (First 1.5 seconds) =====
        if (enterTime < 1.5) {
          const fadeInDuration = 0.3
          const holdDuration = 0.9
          const fadeOutDuration = 0.3
          
          let alpha = 1
          if (enterTime < fadeInDuration) {
            // Fade in
            alpha = enterTime / fadeInDuration
          } else if (enterTime < fadeInDuration + holdDuration) {
            // Hold
            alpha = 1
          } else {
            // Fade out
            alpha = 1 - ((enterTime - fadeInDuration - holdDuration) / fadeOutDuration)
          }
          
          // Semi-transparent dark background with blue tint
          ctx.save()
          ctx.globalAlpha = alpha * 0.5
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
          ctx.fillRect(0, 0, w, h)
          ctx.restore()
          
          // Centered event title and objective
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          
          // Event name (large, bold, blue glow)
          ctx.fillStyle = '#06b6d4'
          ctx.font = 'bold 56px monospace'
          ctx.shadowColor = 'rgba(6, 182, 212, 0.8)'
          ctx.shadowBlur = 30
          ctx.fillText(cat.eventName, w / 2, h / 2 - 40)
          
          // Event objective (smaller, gray)
          const objective = getCataclysmObjective(cat.eventType)
          ctx.fillStyle = '#a0aec0'
          ctx.font = '24px monospace'
          ctx.shadowColor = 'rgba(160, 174, 192, 0.5)'
          ctx.shadowBlur = 15
          ctx.fillText(objective, w / 2, h / 2 + 30)
          
          ctx.restore()
        
        // ===== CATACLYSM TIMER (After intro ends) =====
        } else {
          const timeLeft = Math.ceil(cat.timeLeft)
          
          // Color based on time remaining
          if (timeLeft > 10) {
            ctx.fillStyle = '#FFFFFF'
            ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
          } else if (timeLeft > 5) {
            ctx.fillStyle = '#FFD166'
            ctx.shadowColor = 'rgba(255, 209, 102, 0.8)'
          } else {
            ctx.fillStyle = '#EF4444'
            ctx.shadowColor = 'rgba(239, 68, 68, 1)'
          }
          
          ctx.font = 'bold 48px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.shadowBlur = 20
          
          // Apply subtle pulse when critical
          let scaleOffset = 1
          if (timeLeft <= 5) {
            const pulsePhase = (Date.now() % 400) / 400
            scaleOffset = 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.05
          }
          
          ctx.save()
          ctx.translate(w / 2, 40)
          ctx.scale(scaleOffset, scaleOffset)
          ctx.translate(-w / 2, -40)
          ctx.fillText(`${timeLeft}s`, w / 2, 40)
          ctx.restore()
          
          ctx.shadowColor = 'transparent'
          ctx.shadowBlur = 0
        }
      }

      // ===== GAME OVER SCREEN =====
      if (gameData.state === 'gameOver') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
        ctx.fillRect(0, 0, w, h)

        ctx.fillStyle = '#ef4444'
        ctx.font = 'bold 72px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(239, 68, 68, 0.8)'
        ctx.shadowBlur = 30
        ctx.fillText('GAME OVER', w / 2, h / 2 - 80)

        ctx.fillStyle = '#fbbf24'
        ctx.font = 'bold 48px monospace'
        ctx.shadowColor = 'rgba(251, 191, 36, 0.6)'
        ctx.shadowBlur = 20
        ctx.fillText(`Score: ${gameData.score}`, w / 2, h / 2)

        ctx.fillStyle = '#a0aec0'
        ctx.font = 'bold 24px monospace'
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.fillText('Press SPACE to restart', w / 2, h / 2 + 80)
      }
    }

    function loop(now: number) {
      if (!lastRef.current) lastRef.current = now
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now

      const capped = Math.min(dt, 0.05)
      update(capped)
      render()
      // CRITICAL: Update game state every frame so timer renders/updates in HUD
      updateGameState()

      rafRef.current = requestAnimationFrame(loop)
    }

    if (!playerRef.current) {
      resetGame()
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [props])

  // Watch UI state changes (title/rules/playing/paused) and react accordingly.
  useEffect(() => {
    if (!props.uiState) return

    if (props.uiState === 'title') {
      // Clean canvas, no enemies
      resetGame({ spawnEnemies: false })
    } else if (props.uiState === 'rules') {
      // Initialize entities but remain paused until user clicks Play
      resetGame({ spawnEnemies: true })
    } else if (props.uiState === 'playing') {
      // Ensure timing doesn't jump when starting/resuming
      lastRef.current = performance.now()
      pauseTimeRef.current = null
    }
    // pausing is handled by the update gate (props.uiState !== 'playing')
  }, [props.uiState])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
      }}
    />
  )
})

GameCanvas.displayName = 'GameCanvas'

export default GameCanvas
