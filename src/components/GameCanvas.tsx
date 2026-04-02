"use client";

import React, { useEffect, useRef, forwardRef } from 'react'
import { Puck, Goal, integrate, applyAcceleration, applyDamping, circlesCollide, puckCollideGoal, isOutOfBounds, integrateGoal, isOutOfArena, getShakeOffset } from '../lib/physics'
import {
  createPlayer,
  spawnEnemy,
  spawnCataclysmGoals,
  getEventType,
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
  onStateChange?: (state: { score: number; stage: number; mode: string }) => void
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
    if (gameData.state === 'cataclysm' && gameData.cataclysm) {
      mode = `Cataclysm: ${gameData.cataclysm.eventType.replace(/([A-Z])/g, ' $1').trim()}`
    }

    const state = {
      score: gameData.score,
      stage: gameData.stage,
      mode,
    }

    if (props.onStateChange) {
      props.onStateChange(state)
    }

    // Also emit as event for backward compatibility
    window.dispatchEvent(
      new CustomEvent('gameStateUpdate', { detail: state })
    )
  }

  const resetGame = () => {
    const canvas = canvasRef.current!
    playerRef.current = createPlayer(canvas.width / 2, canvas.height / 2)
    enemiesRef.current = [spawnEnemy(canvas.width, canvas.height, 1, 1)]
    goalRef.current = spawnCataclysmGoals(
      canvas.width,
      canvas.height,
      playerRef.current.x,
      playerRef.current.y
    )[0]
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

  // Setup canvas and input
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const parent = canvas.parentElement!
      canvas.width = parent.clientWidth
      canvas.height = parent.clientHeight
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
      if (gameData.state === 'gameOver') return

      const player = playerRef.current!

      // ===== MOMENTUM-BASED MOVEMENT =====
      const acceleration = 800
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

      if (isOutOfBounds(player, canvas.width, canvas.height)) {
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
      if (Math.random() < dt * spawnChance && gameData.state === 'playing') {
        enemiesRef.current.push(spawnEnemy(canvas.width, canvas.height, gameData.stage, diffMultiplier))
      }

      enemiesRef.current = enemiesRef.current.filter((e) => {
        return (
          e.x + e.radius > -50 &&
          e.x - e.radius < canvas.width + 50 &&
          e.y + e.radius > -50 &&
          e.y - e.radius < canvas.height + 50
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
            const eventType = getEventType(gameData.cataclysmCount)
            const cataclysmGoals = spawnCataclysmGoals(
              canvas.width,
              canvas.height,
              player.x,
              player.y,
              eventType === 'movingGoals'
            )
            gameData.cataclysm = {
              timeLeft: 10,
              goalsNeeded: 7,
              goalsCollected: 0,
              eventType,
              goals: cataclysmGoals,
              arenaWidth: canvas.width,
              arenaHeight: canvas.height,
              enterTime: 0,
            }
          } else {
            const goals = spawnCataclysmGoals(canvas.width, canvas.height, player.x, player.y)
            goalRef.current = goals[0]
          }
          updateGameState()
        }
      }

      // ===== CATACLYSM MODE =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        const cat = gameData.cataclysm
        cat.timeLeft -= dt
        if (cat.enterTime !== undefined) cat.enterTime += dt

        if (cat.eventType === 'movingGoals') {
          for (const goal of cat.goals) {
            integrateGoal(goal, dt, canvas.width, canvas.height)
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
            10
          )
          if (isOutOfArena(player, arenaSize.x, arenaSize.y, arenaSize.width, arenaSize.height)) {
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
            return
          }
        }

        for (let i = 0; i < cat.goals.length; i++) {
          const goal = cat.goals[i]
          if (puckCollideGoal(player, goal)) {
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
              const goals = spawnCataclysmGoals(canvas.width, canvas.height, player.x, player.y)
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

      for (const enemy of enemiesRef.current) {
        if (circlesCollide(player, enemy)) {
          gameData.state = 'gameOver'
          player.vx = 0
          player.vy = 0
          shakeIntensityRef.current = 20
          collisionFlashRef.current = 0.5
          return
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
      const grad = ctx.createRadialGradient(x - 3, y - 3, 0, x, y, radius)
      grad.addColorStop(0, colorStop1)
      grad.addColorStop(1, colorStop2)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    const drawGlowCircle = (x: number, y: number, radius: number, color: string, blur: number, alpha: number) => {
      ctx.shadowColor = color
      ctx.shadowBlur = blur
      ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    function render() {
      const w = canvas.width
      const h = canvas.height
      const gameData = gameDataRef.current
      const shake = getShakeOffset(shakeIntensityRef.current)

      // Motion trail: fade instead of clear
      ctx.fillStyle = 'rgba(15, 23, 42, 0.15)'
      ctx.fillRect(0, 0, w, h)

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
          10
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

      // ===== COLLISION FLASH =====
      if (collisionFlashRef.current > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${collisionFlashRef.current * 0.3})`
        ctx.fillRect(0, 0, w, h)
      }

      // ===== CATACLYSM TEXT ANIMATION =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm && gameData.cataclysm.enterTime !== undefined) {
        const enterTime = gameData.cataclysm.enterTime
        const fadeInDuration = 0.5
        const displayDuration = 2
        const fadeOutDuration = 0.5

        if (enterTime < fadeInDuration + displayDuration + fadeOutDuration) {
          let alpha = 1

          if (enterTime < fadeInDuration) {
            alpha = enterTime / fadeInDuration
          } else if (enterTime > fadeInDuration + displayDuration) {
            alpha = 1 - (enterTime - fadeInDuration - displayDuration) / fadeOutDuration
          }

          ctx.save()
          ctx.globalAlpha = alpha
          ctx.fillStyle = '#fbbf24'
          ctx.font = 'bold 56px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.shadowColor = 'rgba(251, 191, 36, 0.8)'
          ctx.shadowBlur = 20
          ctx.fillText('CATACLYSM MODE', w / 2, h / 2 - 40)

          ctx.font = 'bold 32px monospace'
          ctx.fillStyle = '#06b6d4'
          ctx.shadowColor = 'rgba(6, 182, 212, 0.6)'
          ctx.fillText(gameData.cataclysm.eventType.replace(/([A-Z])/g, ' $1').toUpperCase(), w / 2, h / 2 + 40)

          ctx.restore()
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
