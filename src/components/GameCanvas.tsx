"use client";

import React, { useEffect, useRef, forwardRef } from 'react'
import { Puck, Goal, Enemy, integrate, applyAcceleration, applyDamping, circlesCollide, puckCollideGoal, isOutOfBounds, integrateGoal, isOutOfArena, getShakeOffset, repositionGoalInBounds, clampGoalToCanvas } from '../lib/physics'
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
import {
  TutorialStep,
  TutorialGameState,
  tutorialSteps,
  createTutorialState,
  getCurrentTutorialStep,
  shouldShowInstruction,
  canProgressToNextStep,
  advanceStep,
  restartCurrentStep,
} from '../lib/tutorialLogic'
import { FONT_UI_BODY, FONT_UI_DISPLAY, FONT_GAME } from '../lib/fonts'

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawRoundedTextBox(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: string[],
  options: {
    boxWidth: number
    fontSize: number
    lineHeight: number
    paddingY: number
    fillStyle: string
    strokeStyle: string
    textColor: string
    fontWeight?: string
    globalAlpha?: number
  }
) {
  const {
    boxWidth,
    fontSize,
    lineHeight,
    paddingY,
    fillStyle,
    strokeStyle,
    textColor,
    fontWeight = '600',
    globalAlpha = 1,
  } = options

  const boxHeight = paddingY * 2 + lines.length * lineHeight
  const boxX = (w - boxWidth) / 2
  const boxY = (h - boxHeight) / 2

  ctx.save()
  ctx.globalAlpha = globalAlpha
  ctx.fillStyle = fillStyle
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = 2
  ctx.shadowColor = 'rgba(6, 182, 212, 0.3)'
  ctx.shadowBlur = 20

  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = textColor
  ctx.font = `${fontWeight} ${fontSize}px ${FONT_UI_BODY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  const startY = boxY + paddingY + lineHeight / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, w / 2, startY + index * lineHeight)
  })

  ctx.restore()
  return { boxX, boxY, boxHeight }
}

/** Rules-modal style card for tutorial step instructions */
function drawInstructionCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  stepLabel: string,
  lines: string[],
  options: { boxWidth: number; globalAlpha: number; topOffset?: number }
) {
  const boxWidth = options.boxWidth
  const padTop = 24
  const padBottom = 24
  const titleBlock = 38
  const bodyFontSize = 16
  const bodyLineHeight = Math.round(bodyFontSize * 1.7) // matches .rules-modal ul line-height
  const bodyHeight = lines.length * bodyLineHeight
  const boxHeight = padTop + titleBlock + bodyHeight + padBottom
  const boxX = (w - boxWidth) / 2
  const boxY = options.topOffset ?? 48

  ctx.save()
  ctx.globalAlpha = options.globalAlpha

  // Match .rules-modal panel
  ctx.fillStyle = 'rgba(12, 18, 30, 0.78)'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 24
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 14)
  ctx.fill()
  ctx.shadowBlur = 0

  // Match .rules-modal h2
  ctx.fillStyle = '#67e8f9'
  ctx.font = `700 22px ${FONT_UI_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(6, 182, 212, 0.35)'
  ctx.shadowBlur = 12
  ctx.fillText(stepLabel, w / 2, boxY + padTop + titleBlock / 2 - 4)
  ctx.shadowBlur = 0

  // Instruction body — centered
  ctx.fillStyle = '#cbd5e1'
  ctx.font = `600 ${bodyFontSize}px ${FONT_UI_BODY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const textStartY = boxY + padTop + titleBlock + bodyLineHeight / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, w / 2, textStartY + index * bodyLineHeight)
  })

  ctx.restore()
}

/** Survival game-over arcade overlay (also used for tutorial death) */
function drawArcadeGameOverOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: {
    title: string
    middle: string
    hint: string
  }
) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.fillRect(0, 0, w, h)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#ef4444'
  ctx.font = `bold 72px ${FONT_GAME}`
  ctx.shadowColor = 'rgba(239, 68, 68, 0.8)'
  ctx.shadowBlur = 30
  ctx.fillText(config.title, w / 2, h / 2 - 60)

  ctx.fillStyle = '#fbbf24'
  ctx.font = `bold 48px ${FONT_GAME}`
  ctx.shadowColor = 'rgba(251, 191, 36, 0.6)'
  ctx.shadowBlur = 20
  ctx.fillText(config.middle, w / 2, h / 2)

  ctx.fillStyle = '#a0aec0'
  ctx.font = `bold 24px ${FONT_GAME}`
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.fillText(config.hint, w / 2, h / 2 + 60)
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  centerX?: number
  centerY?: number
  angle?: number
  maxRadius?: number
  currentRadius?: number
  rotationSpeed?: number
  radiusGrowth?: number
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
  eventProgress: number
}

interface GameCanvasProps {
  onStateChange?: (state: {
    score: number
    stage: number
    mode: string
    eventTimeLeft?: number
    inEvent?: boolean
    eventName?: string
    eventProgress?: number
    gameOver?: boolean
  }) => void
  onSurvivalGameOver?: (score: number) => void
  isPaused?: boolean
  uiState?: 'title' | 'rules' | 'playing' | 'paused'
  gameMode?: 'survival' | 'zen' | 'tutorial'
}

const GameCanvas = forwardRef<HTMLCanvasElement, GameCanvasProps>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const playerRef = useRef<Puck | null>(null)
  const enemiesRef = useRef<Enemy[]>([])
  const goalRef = useRef<Goal | null>(null)
  const gameDataRef = useRef<GameData>({
    score: 0,
    stage: 1,
    state: 'playing',
    lastCataclysmTriggerScore: 0,
    cataclysmCount: 0,
    eventProgress: 0,
  })
  const lastStageRef = useRef<number>(1) // Track stage changes for speed updates

  const activeKeysRef = useRef<Set<string>>(new Set())
  const shakeIntensityRef = useRef<number>(0)
  const collisionFlashRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])
  const pauseTimeRef = useRef<number | null>(null)
  const canvasWidthRef = useRef<number>(0) // Display width (unscaled)
  const canvasHeightRef = useRef<number>(0) // Display height (unscaled)
  const tutorialStateRef = useRef<TutorialGameState>(createTutorialState())
  const tutorialGoalsRef = useRef<Goal[]>([])
  const lastMovementTimeRef = useRef<number>(0)
  const borderWarningStartTime = useRef<number>(0)
  const uiStateRef = useRef(props.uiState)
  const gameModeRef = useRef(props.gameMode)
  const lastGameOverNotifiedRef = useRef(false)

  useEffect(() => {
    uiStateRef.current = props.uiState
  }, [props.uiState])

  useEffect(() => {
    gameModeRef.current = props.gameMode
  }, [props.gameMode])

  useEffect(() => {
    if (props.uiState !== 'playing') {
      activeKeysRef.current.clear()
    }
  }, [props.uiState])

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  }

  function notifySurvivalGameOverIfNeeded() {
    const gameData = gameDataRef.current
    const isGameOver = gameData.state === 'gameOver'
    if (isGameOver && !lastGameOverNotifiedRef.current) {
      if (gameModeRef.current === 'survival' && props.onSurvivalGameOver) {
        props.onSurvivalGameOver(gameData.score)
      }
    }
    lastGameOverNotifiedRef.current = isGameOver
  }

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
    
    if (props.gameMode === 'zen') {
      mode = 'Zen'
    } else if (props.gameMode === 'tutorial') {
      mode = 'Tutorial'
      const tutorialState = tutorialStateRef.current
      const currentStep = getCurrentTutorialStep(tutorialState)
      if (currentStep) {
        eventName = `Step ${tutorialState.currentStep + 1} of ${tutorialSteps.length}`
      }
    } else if (gameData.state === 'cataclysm' && gameData.cataclysm) {
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
      eventProgress: gameData.eventProgress,
      gameOver: gameData.state === 'gameOver',
    }

    if (props.onStateChange) {
      props.onStateChange(state)
    }

    notifySurvivalGameOverIfNeeded()

    // Also emit as event for backward compatibility
    window.dispatchEvent(
      new CustomEvent('gameStateUpdate', { detail: state })
    )
  }

  const resetTutorial = () => {
    const w = canvasWidthRef.current
    const h = canvasHeightRef.current
    const tutorialState = tutorialStateRef.current
    const currentStep = getCurrentTutorialStep(tutorialState)
    
    if (currentStep) {
      const setup = currentStep.setup(w, h, playerRef.current!)
      tutorialStateRef.current = restartCurrentStep(tutorialState)
      
      // Set player position if specified
      if (setup.playerStart) {
        playerRef.current!.x = setup.playerStart.x
        playerRef.current!.y = setup.playerStart.y
        playerRef.current!.vx = 0
        playerRef.current!.vy = 0
      }
      
      // Set enemies and goals
      enemiesRef.current = (setup.enemies || []) as Enemy[]
      tutorialGoalsRef.current = (setup.goals || []).map((goal) => {
        const clamped = { ...goal }
        clampGoalToCanvas(clamped, w, h)
        return clamped
      })
      tutorialStateRef.current.totalGoalsInStep = tutorialGoalsRef.current.length
      
      // Clear regular goal to avoid conflicts
      goalRef.current = null
    }
  }

  const resetGame = (options?: { spawnEnemies?: boolean }) => {
    const w = canvasWidthRef.current
    const h = canvasHeightRef.current
    playerRef.current = createPlayer(w / 2, h / 2)
    
    if (props.gameMode === 'tutorial') {
      // Initialize tutorial state
      tutorialStateRef.current = createTutorialState()
      resetTutorial()
    } else {
      // Default: clear enemies on reset, but always spawn initial green goals.
      const spawnEnemies = options?.spawnEnemies ?? (props.gameMode === 'survival')
      enemiesRef.current = spawnEnemies ? [spawnEnemy(w, h, 1, 1) as Enemy] : []
      // Always spawn at least one goal on reset so the game shows green goals.
      goalRef.current = spawnCataclysmGoals(w, h, playerRef.current.x, playerRef.current.y)[0]
      if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
      tutorialGoalsRef.current = []
    }
    
    gameDataRef.current = {
      score: 0,
      stage: 1,
      state: 'playing',
      lastCataclysmTriggerScore: 0,
      cataclysmCount: 0,
      eventProgress: 0,
    }
    activeKeysRef.current.clear()
    shakeIntensityRef.current = 0
    collisionFlashRef.current = 0
    particlesRef.current = []
    lastMovementTimeRef.current = 0
    lastGameOverNotifiedRef.current = false
    updateGameState()
  }

  const spawnBurst = (x: number, y: number) => {
    const particleCount = 8 // Reduced from 10
    const rotationSpeed = 0.08 // Slower rotation (was 0.15)
    const radiusGrowth = 0.8 // Slower growth (was 1.5)
    
    for (let i = 0; i < particleCount; i++) {
      const baseAngle = (i / particleCount) * Math.PI * 2
      
      particlesRef.current.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.8, // Slightly longer life for smoother fade
        centerX: x,
        centerY: y,
        angle: baseAngle,
        maxRadius: 25 + Math.random() * 15, // Smaller max radius
        currentRadius: 0,
        rotationSpeed: rotationSpeed,
        radiusGrowth: radiusGrowth
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
      canvas.width = Math.max(1, Math.floor(clientWidth * dpr))
      canvas.height = Math.max(1, Math.floor(clientHeight * dpr))

      // Set transform to match device pixel ratio (avoid cumulative scaling)
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      
      // Set CSS size to match intended display size
      canvas.style.width = `${clientWidth}px`
      canvas.style.height = `${clientHeight}px`

      // DO NOT reset game - preserve all state during resize
    }

    // Run once on mount
    resize()

    window.addEventListener('resize', resize)
    // Handle fullscreen changes which may not trigger resize events on some browsers
    const onFullScreen = () => resize()
    document.addEventListener('fullscreenchange', onFullScreen)
    document.addEventListener('webkitfullscreenchange', onFullScreen)

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('fullscreenchange', onFullScreen)
      document.removeEventListener('webkitfullscreenchange', onFullScreen)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!

    const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']

    function onKeyDown(e: KeyboardEvent) {
      if (!playerRef.current) return

      if (isTypingTarget(e.target)) return
      if (uiStateRef.current !== 'playing') return
      
      // Disable all input when tutorial is complete
      if (props.gameMode === 'tutorial' && tutorialStateRef.current.isComplete) return

      // Handle Space key restart when dead in tutorial
      if (props.gameMode === 'tutorial' && tutorialStateRef.current.isDead && e.code === 'Space') {
        tutorialStateRef.current = restartCurrentStep(tutorialStateRef.current)
        resetTutorial()
        return
      }

      if (e.code === 'Space') {
        if (gameDataRef.current.state === 'gameOver') {
          resetGame()
          return
        }
      }

      // Disable movement when dead in tutorial
      if (props.gameMode === 'tutorial' && tutorialStateRef.current.isDead) return

      if (movementKeys.includes(e.code)) {
        activeKeysRef.current.add(e.code)
        e.preventDefault()
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (uiStateRef.current !== 'playing') return

      if (movementKeys.includes(e.code)) {
        activeKeysRef.current.delete(e.code)
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
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
      // Disable movement when dead in tutorial OR during instructions
      if (!(props.gameMode === 'tutorial' && (tutorialStateRef.current.isDead || tutorialStateRef.current.showInstruction))) {
        const acceleration = 1000
        if (activeKeysRef.current.has('ArrowRight') || activeKeysRef.current.has('KeyD')) applyAcceleration(player, acceleration * dt, 0)
        if (activeKeysRef.current.has('ArrowLeft') || activeKeysRef.current.has('KeyA')) applyAcceleration(player, -acceleration * dt, 0)
        if (activeKeysRef.current.has('ArrowDown') || activeKeysRef.current.has('KeyS')) applyAcceleration(player, 0, acceleration * dt)
        if (activeKeysRef.current.has('ArrowUp') || activeKeysRef.current.has('KeyW')) applyAcceleration(player, 0, -acceleration * dt)

        applyDamping(player, 0.99)

        const maxVel = 500
        const velMag = Math.hypot(player.vx, player.vy)
        if (velMag > maxVel) {
          const scale = maxVel / velMag
          player.vx *= scale
          player.vy *= scale
        }

        integrate(player, dt)
      }

      if (isOutOfBounds(player, w, h)) {
        if (props.gameMode === 'zen') {
          // Wrap-around teleport to opposite side in Practice Mode
          if (player.x - player.radius < 0) player.x = w - player.radius
          if (player.x + player.radius > w) player.x = player.radius
          if (player.y - player.radius < 0) player.y = h - player.radius
          if (player.y + player.radius > h) player.y = player.radius
        } else if (props.gameMode === 'tutorial') {
          // In tutorial mode, mark as dead to restart current step
          console.log('Tutorial death detected - setting isDead = true')
          tutorialStateRef.current.isDead = true
          player.vx = 0
          player.vy = 0
          shakeIntensityRef.current = 20
          collisionFlashRef.current = 0.5
          return
        } else {
          gameData.state = 'gameOver'
          player.vx = 0
          player.vy = 0
          shakeIntensityRef.current = 20
          collisionFlashRef.current = 0.5
          return
        }
      }

      for (const enemy of enemiesRef.current) {
        integrate(enemy, dt)
      }

      // ===== TUTORIAL MODE LOGIC =====
      if (props.gameMode === 'tutorial') {
        const tutorialState = tutorialStateRef.current
        
        // Handle death in tutorial - show respawn popup
        if (tutorialState.isDead) {
          // Don't auto-revive, instead show death popup
          return // Exit early when dead
        }
        
        // Handle Step 8 (congratulations) - auto-advance after 3 seconds
        if (tutorialState.currentStep === 7) {
          const timeInStep = Date.now() - tutorialState.stepStartTime
          tutorialState.movementTime = timeInStep / 1000
          
          if (timeInStep >= 3000 && canProgressToNextStep(tutorialState)) {
            console.log('Step 8 completed, returning to menu')
            window.dispatchEvent(new CustomEvent('returnToMenu'))
          }
          return // Exit after handling Step 8
        }
        
        // Guard against multiple advances in same frame
        if (tutorialState.stepCompleted || tutorialState.isComplete) return
        
        // Track movement time for step 1 (15 seconds total)
        if (tutorialState.currentStep === 0) { // Step 1 (index 0)
          const timeInStep = Date.now() - tutorialState.stepStartTime
          tutorialState.movementTime = timeInStep / 1000 // Convert to seconds for display
          
          // Advance after 15 seconds
          if (timeInStep >= 15000) {
            advanceStep(tutorialState, () => resetTutorial())
          }
        }
        
        // Check if instruction should be shown and auto-fade
        if (shouldShowInstruction(tutorialState)) {
          tutorialState.hasShownInstruction = true
          tutorialState.showInstruction = true
          tutorialState.instructionStartTime = Date.now()
        }
        
        // Auto-fade instruction after 3 seconds
        if (tutorialState.showInstruction) {
          const timeSinceInstruction = Date.now() - tutorialState.instructionStartTime
          if (timeSinceInstruction >= 3500) { // 3s + 500ms fade out
            tutorialState.showInstruction = false
          }
        }
        
        // Border behavior - match Survival Mode proximity detection
        const proximityThreshold = 120
        const minDistToBoundary = Math.min(
          player.x - player.radius,
          player.y - player.radius,
          w - (player.x + player.radius),
          h - (player.y + player.radius)
        )
        
        const rawFactor = Math.max(0, Math.min(1, 1 - minDistToBoundary / proximityThreshold))
        const dangerFactor = rawFactor * rawFactor * (3 - 2 * rawFactor)
        
        // One-time border warning
        if (!tutorialState.hasShownBorderWarning && dangerFactor > 0.3) {
          tutorialState.hasShownBorderWarning = true
          borderWarningStartTime.current = Date.now()
        }
        
        // Check if current step objective is completed (for goal-based steps)
        if (tutorialState.currentStep >= 1 && tutorialState.currentStep <= 6) {
          // Steps 2-7 are goal-based (indices 1-6)
          const goalsRemaining = tutorialGoalsRef.current.length
          const goalsCollected = tutorialState.goalsCollected
          const canProgress = canProgressToNextStep(tutorialState)
          
          console.log(`Step ${tutorialState.currentStep + 1} status: goalsCollected=${goalsCollected}, goalsRemaining=${goalsRemaining}, canProgress=${canProgress}`)
          
          if (goalsRemaining === 0) {
            // For Step 7, advance immediately when goals are collected
            const isFinalStep = tutorialState.currentStep === 6 // Step 7 (index 6)
            console.log(`Step ${tutorialState.currentStep + 1} completed, isFinalStep: ${isFinalStep}`)
            console.log('Calling advanceStep...')
            advanceStep(tutorialState, () => {
              console.log('advanceStep callback executed')
              // Always reset to set up the next step (including Step 8)
              console.log('Resetting tutorial for next step')
              resetTutorial()
              
              // DEBUG: Force Step 8 to show immediately
              if (isFinalStep) {
                console.log('DEBUG: Forcing Step 8 to show')
                tutorialStateRef.current.currentStep = 7
                tutorialStateRef.current.stepStartTime = Date.now()
                tutorialStateRef.current.hasShownInstruction = false
                tutorialStateRef.current.showInstruction = true
                tutorialStateRef.current.instructionStartTime = Date.now()
              }
            })
          }
        }
      }

      // Difficulty multiplier now factors stage and completed cataclysms
      const diffMultiplier = getDifficultyMultiplier(gameData.stage, gameData.cataclysmCount)
      const baseSpawnChance = 0.8
      // Slightly increase spawn frequency with stage so difficulty ramps smoothly
      const spawnChance = baseSpawnChance * diffMultiplier * (1 + (gameData.stage - 1) * 0.07)

      // Update enemy speeds when stage changes
    if (lastStageRef.current !== gameData.stage) {
      const stageMultiplier = 1 + 0.15 * (gameData.stage - 1) // Stage 1: 1.0x, Stage 2: 1.15x, Stage 3: 1.30x
      
      // Update all existing enemies
      enemiesRef.current = enemiesRef.current.map(enemy => ({
        ...enemy,
        vx: (enemy.vx / (enemy.baseSpeed || 80)) * stageMultiplier * (enemy.baseSpeed || 80),
        vy: (enemy.vy / (enemy.baseSpeed || 80)) * stageMultiplier * (enemy.baseSpeed || 80)
      }))
      
      lastStageRef.current = gameData.stage
    }
    
    // Cap max enemies and increase cap with stage for gradual difficulty
      const maxEnemies = Math.min(12 + Math.floor(gameData.stage * 2), 80)
      const minEnemies = 3 + Math.floor(gameData.stage / 3) // Minimum enemies: 3 at stage 1, +1 every 3 stages
      
      // Ensure minimum enemy count
      if (props.gameMode === 'survival' && enemiesRef.current.length < minEnemies) {
        const baseSpeed = 80 + gameData.stage * 20
        const speedVariation = 0.9 + Math.random() * 0.2 // 0.9-1.1 variation
        const finalSpeed = baseSpeed * speedVariation
        
        enemiesRef.current.push(spawnEnemy(w, h, gameData.stage, 1) as Enemy) // Use diffMultiplier=1
      }
      
      if (props.gameMode === 'survival' && enemiesRef.current.length < maxEnemies && Math.random() < dt * spawnChance) {
        const baseSpeed = 80 + gameData.stage * 20
        const speedVariation = 0.9 + Math.random() * 0.2 // 0.9-1.1 variation
        const finalSpeed = baseSpeed * speedVariation
        
        enemiesRef.current.push(spawnEnemy(w, h, gameData.stage, 1) as Enemy) // Use diffMultiplier=1
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
          gameData.eventProgress++
          spawnBurst(goalRef.current.x, goalRef.current.y)

          if (
            props.gameMode === 'survival' &&
            gameData.eventProgress >= 10 &&
            gameData.state === 'playing'
          ) {
            gameData.state = 'cataclysm'
            gameData.eventProgress = 0
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
            if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
          }
          updateGameState()
        }
      }

      // ===== TUTORIAL MODE: GOAL COLLECTION =====
      if (props.gameMode === 'tutorial') {
        const tutorialState = tutorialStateRef.current
        
        for (let i = 0; i < tutorialGoalsRef.current.length; i++) {
          const goal = tutorialGoalsRef.current[i]
          if (puckCollideGoal(player, goal)) {
            spawnBurst(goal.x, goal.y)
            tutorialGoalsRef.current.splice(i, 1)
            tutorialState.goalsCollected++
            gameData.score++
            gameData.eventProgress++
            console.log(`Goal collected! Total: ${tutorialState.goalsCollected}, Remaining: ${tutorialGoalsRef.current.length}`)
            i--
            updateGameState()
          }
        }
      }

      // ===== CATACLYSM MODE (SURVIVAL ONLY) =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm && props.gameMode === 'survival') {
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
          // SAFETY: Shake event disabled - return early
          return;
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
            gameData.score++
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
              if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
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
            if (props.gameMode === 'tutorial') {
              // In tutorial mode, mark as dead to restart current step
              console.log('Tutorial enemy collision detected - setting isDead = true')
              tutorialStateRef.current.isDead = true
            } else {
              gameData.state = 'gameOver'
              player.vx = 0
              player.vy = 0
              shakeIntensityRef.current = 20
              collisionFlashRef.current = 0.5
            }
            return
          }
        }
      }

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i]
        
        // Handle spiral motion for burst particles
        if (p.angle !== undefined && p.currentRadius !== undefined && p.centerX !== undefined && p.centerY !== undefined) {
          // Update spiral motion
          p.angle += (p.rotationSpeed || 0.15)
          p.currentRadius += (p.radiusGrowth || 1.5)
          
          // Calculate position based on spiral
          p.x = p.centerX + Math.cos(p.angle) * p.currentRadius
          p.y = p.centerY + Math.sin(p.angle) * p.currentRadius
        } else {
          // Regular linear motion for other particles
          p.x += p.vx * dt
          p.y += p.vy * dt
        }
        
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

      // ===== DRAW TUTORIAL GOALS =====
      if (props.gameMode === 'tutorial') {
        for (const goal of tutorialGoalsRef.current) {
          const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7
          const glowSize = goal.radius + 8 + pulse * 4
          drawGlowCircle(goal.x, goal.y, glowSize, '#22c55e', 20, 0.3)
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
      // Compute distance to nearest edge
      const proximityThreshold = 120 // px where warning starts
      const minDistToBoundary = Math.min(
        player.x - player.radius,
        player.y - player.radius,
        w - (player.x + player.radius),
        h - (player.y + player.radius)
      )

      // Raw factor 0..1 (0 far, 1 touching)
      const rawFactor = Math.max(0, Math.min(1, 1 - minDistToBoundary / proximityThreshold))
      const dangerFactor = rawFactor * rawFactor * (3 - 2 * rawFactor)

      // One-time border warning (only in tutorial mode)
      if (props.gameMode === 'tutorial') {
        const tutorialState = tutorialStateRef.current
        if (!tutorialState.hasShownBorderWarning && dangerFactor > 0.3) {
          tutorialState.hasShownBorderWarning = true
          borderWarningStartTime.current = Date.now()
        }
      }

      // Default subtle border (used for Zen or safe state)
      let outerLine = 6
      let innerLine = 1
      let outerColor = 'rgba(255,255,255,0.06)'
      let innerColor = 'rgba(255,255,255,0.08)'
      let shadowColor = 'transparent'
      let shadowBlur = 0

      if ((props.gameMode === 'survival' || props.gameMode === 'tutorial') && dangerFactor > 0) {
        // Amplify for survival and tutorial mode
        const of = Math.min(1, 0.15 + dangerFactor * 0.95)
        outerLine = 12 + dangerFactor * 16
        innerLine = 2 + dangerFactor * 6
        outerColor = `rgba(239,68,68,${0.6 * of})`
        innerColor = `rgba(255,90,90,${0.45 + dangerFactor * 0.55})`
        shadowColor = 'rgba(239,68,68,0.95)'
        shadowBlur = 20 + dangerFactor * 60
      }

      // Draw outer glow inset by half maximum stroke to avoid clipping
      const halfMax = Math.max(outerLine, innerLine) / 2
      ctx.strokeStyle = outerColor
      ctx.lineWidth = outerLine
      ctx.shadowColor = shadowColor
      ctx.shadowBlur = shadowBlur
      ctx.strokeRect(halfMax, halfMax, Math.max(0, w - halfMax * 2), Math.max(0, h - halfMax * 2))

      // Inner bright edge
      ctx.strokeStyle = innerColor
      ctx.lineWidth = innerLine
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      const halfInner = innerLine / 2
      ctx.strokeRect(halfInner + 2, halfInner + 2, Math.max(0, w - (halfInner + 2) * 2), Math.max(0, h - (halfInner + 2) * 2))

      // (removed full-screen tint) Keep only two border layers: base + glow

      // ===== COLLISION FLASH =====
      if (collisionFlashRef.current > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${collisionFlashRef.current * 0.3})`
        ctx.fillRect(0, 0, w, h)
      }

      // ===== OPTIONAL: EVENT VIGNETTE (subtle intensity effect, survival only) =====
      if (props.gameMode === 'survival' && gameData.state === 'cataclysm' && gameData.cataclysm) {
        const vignetteIntensity = 0.15
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.max(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8)
        gradient.addColorStop(0, `rgba(0, 0, 0, 0)`)
        gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteIntensity})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
      }

      // ===== CATACLYSM EVENT - INTRO OVERLAY + TIMER (survival only) =====
      if (props.gameMode === 'survival' && gameData.state === 'cataclysm' && gameData.cataclysm) {
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
          
          // Event name (large, bold, RED glow)
          ctx.fillStyle = '#ef4444'
          ctx.font = `bold 56px ${FONT_GAME}`
          ctx.shadowColor = 'rgba(239, 68, 68, 0.85)'
          ctx.shadowBlur = 30
          ctx.fillText(cat.eventName, w / 2, h / 2 - 40)
          
          // Event objective (smaller, gray)
          const objective = getCataclysmObjective(cat.eventType)
          ctx.fillStyle = '#a0aec0'
          ctx.font = `24px ${FONT_GAME}`
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
          
          ctx.font = `bold 48px ${FONT_GAME}`
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

      // ===== TUTORIAL INSTRUCTION OVERLAY =====
      if (props.gameMode === 'tutorial') {
        const tutorialState = tutorialStateRef.current
        
        // ===== TUTORIAL DEATH POPUP =====
        if (tutorialState.isDead) {
          drawArcadeGameOverOverlay(ctx, w, h, {
            title: 'YOU DIED!',
            middle: `Step ${tutorialState.currentStep + 1} Restart`,
            hint: 'Press SPACE to respawn at this step',
          })
          return // Don't render anything else when dead
        }
        
        // ===== BORDER WARNING POP-UP =====
        if (tutorialState.hasShownBorderWarning) {
          const timeSinceWarning = Date.now() - borderWarningStartTime.current
          const warningDuration = 2500 // Show for ~2.5 seconds
          
          if (timeSinceWarning < warningDuration) {
            const alpha = Math.max(0, 1 - timeSinceWarning / warningDuration)
            const boxWidth = Math.min(440, w - 80)
            const warningText = 'The wall is dangerous. The red glow means you\'re close to death.'
            ctx.font = `500 18px ${FONT_UI_BODY}`
            const warningLines = wrapCanvasText(ctx, warningText, boxWidth - 48)

            drawRoundedTextBox(ctx, w, h, warningLines, {
              boxWidth,
              fontSize: 18,
              lineHeight: 26,
              paddingY: 20,
              fillStyle: 'rgba(239, 68, 68, 0.95)',
              strokeStyle: 'rgba(252, 165, 165, 0.8)',
              textColor: '#ffffff',
              fontWeight: '600',
              globalAlpha: alpha * 0.95,
            })
          }
        }
        
        const currentStep = getCurrentTutorialStep(tutorialState)
        
        if (currentStep && tutorialState.showInstruction) {
          const timeSinceInstruction = Date.now() - tutorialState.instructionStartTime
          const fadeInDuration = 300
          const fadeOutDuration = 500
          const totalDuration = 3000 // Show for 3 seconds
          
          let alpha = 0
          if (timeSinceInstruction < fadeInDuration) {
            // Fade in
            alpha = Math.min(1, timeSinceInstruction / fadeInDuration)
          } else if (timeSinceInstruction < totalDuration) {
            // Fully visible
            alpha = 1
          } else if (timeSinceInstruction < totalDuration + fadeOutDuration) {
            // Fade out
            const fadeProgress = (timeSinceInstruction - totalDuration) / fadeOutDuration
            alpha = Math.max(0, 1 - fadeProgress)
          } else {
            // Hidden
            tutorialState.showInstruction = false
          }
          
          if (alpha > 0) {
            ctx.save()
            ctx.globalAlpha = alpha * 0.35
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
            ctx.fillRect(0, 0, w, h)
            ctx.restore()

            const boxWidth = Math.min(560, w - 64)
            ctx.font = `600 16px ${FONT_UI_BODY}`
            const lines = wrapCanvasText(ctx, currentStep.instruction, boxWidth - 56)
            const stepLabel = `Step ${tutorialState.currentStep + 1} of ${tutorialSteps.length}`

            drawInstructionCard(ctx, w, stepLabel, lines, {
              boxWidth,
              globalAlpha: alpha,
              topOffset: Math.max(40, h * 0.1),
            })
          }
        }
      }

      // ===== GAME OVER SCREEN =====
      if (gameData.state === 'gameOver') {
        drawArcadeGameOverOverlay(ctx, w, h, {
          title: 'GAME OVER',
          middle: `Score: ${gameData.score}`,
          hint: 'Press SPACE to restart',
        })
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
      // Reset game and spawn initial goals (no enemies) so title / restart always has green goals
      resetGame({ spawnEnemies: false })
    } else if (props.uiState === 'rules') {
      // Initialize entities but remain paused until user clicks Play
      resetGame({ spawnEnemies: props.gameMode === 'survival' })
    } else if (props.uiState === 'playing') {
      // Ensure timing doesn't jump when starting/resuming
      lastRef.current = performance.now()
      pauseTimeRef.current = null
    }
    // pausing is handled by the update gate (props.uiState !== 'playing')
    // Ensure layout recalculation (fixes fullscreen/bottom-border clipping)
    try {
      window.dispatchEvent(new Event('resize'))
    } catch (e) {
      /* ignore */
    }
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
