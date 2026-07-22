"use client";

import React, { useEffect, useRef, forwardRef } from 'react'
import { Puck, Goal, Enemy, integrate, applyAcceleration, applyDamping, applySeek, circlesCollide, puckCollideGoal, isOutOfBounds, isOutOfArena, getShakeOffset, clampGoalToCanvas, clampToBounds, repositionGoalInBounds, normalize } from '../lib/physics'
import {
  createPlayer,
  spawnEnemy,
  spawnGoal,
  spawnGoalClearOf,
  spawnCataclysmGoals,
  getEventType,
  getCataclysmObjective,
  getDifficultyMultiplier,
  type CataclysmEventType,
} from '../lib/gameLogic'
import type { GameMode, MpVariant, MatchResult } from '../lib/modes'
import type { RoomClient } from '../lib/net/room'
import {
  INPUT_HEARTBEAT_HZ,
  SNAPSHOT_HZ,
  keysToMask,
  maskToKeys,
  type SnapEnemy,
  type SnapGameData,
  type SnapMsg,
  type SnapPlayer,
} from '../lib/net/protocol'
import { SnapshotBuffer } from '../lib/net/interpolation'
import {
  type PlayerSlot,
  type InputMap,
  P1_KEYS,
  P2_KEYS,
  SP_KEYS,
  isDirectionHeld,
  nearestLivingPlayer,
  livingPlayers,
  pickP2Colors,
} from '../lib/multiplayer/players'
import {
  DUEL_TARGET_SCORE,
  DUEL_ENEMY_COUNT,
  DUEL_STUN_SECONDS,
  DUEL_POST_STUN_IMMUNITY,
  DUEL_KNOCKBACK_SPEED,
  WALL_BOUNCE_DAMPING,
  COOP_ENEMY_SCALE,
  COOP_BLEEDOUT_SECONDS,
  COOP_REVIVE_IMMUNITY,
  TAG_ROUND_SECONDS,
  TAG_SWAP_COOLDOWN,
  TAG_IT_MAXVEL,
  TAG_IT_ACCEL,
  TAG_DRAW_MARGIN,
  MP_BASE_MAXVEL,
  MP_SPAWN_X_FRACTIONS,
} from '../lib/multiplayer/rules'
import {
  createCataclysm,
  renderCataclysmEvent,
  updateCataclysmEvent,
  type CataclysmData,
} from '../lib/cataclysm/events'
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
import { palette, withAlpha } from '../lib/palette'
import type { RunSummary } from '../lib/stats'
import { resolveActiveTheme, activeTrailStyle, type ResolvedTheme, type TrailStyle } from '../lib/customization'
import type { Challenge } from '../lib/challenges'
import { challengeTimeLimit, FEEL_PRESETS } from '../lib/challenge-par'

interface RunStats {
  elapsed: number // seconds of active play (pause-safe: accumulated from dt)
  orbs: number
  distance: number
  topSpeed: number
  longestDrift: number
  currentDrift: number
  cataclysms: number
  wallTouched: boolean
}

function freshRunStats(): RunStats {
  return {
    elapsed: 0,
    orbs: 0,
    distance: 0,
    topSpeed: 0,
    longestDrift: 0,
    currentDrift: 0,
    cataclysms: 0,
    wallTouched: false,
  }
}

/** Seconds a collapsing arena takes to close to its final size. */
const COLLAPSE_SECONDS = 45

/**
 * Centered play rectangle for challenges that shrink the arena. `arenaScale`
 * sets the size it starts at; `shrinkTo` closes it further over the run, so
 * `elapsed` has to be threaded through every caller.
 */
function challengeArena(w: number, h: number, ch?: Challenge | null, elapsed = 0) {
  const start = ch?.modifiers?.arenaScale ?? 1
  const shrinkTo = ch?.modifiers?.shrinkTo
  let s = start
  if (shrinkTo) {
    const progress = Math.min(1, elapsed / COLLAPSE_SECONDS)
    s = start * (1 - progress) + start * shrinkTo * progress
  }
  if (s >= 1) return null
  const aw = w * s
  const ah = h * s
  return { x: (w - aw) / 2, y: (h - ah) / 2, width: aw, height: ah }
}

/** Handling overrides for a challenge's `feel` preset, or the defaults. */
function challengeHandling(ch?: Challenge | null) {
  const feel = ch?.modifiers?.feel
  if (feel && FEEL_PRESETS[feel]) {
    return { friction: FEEL_PRESETS[feel].friction, acceleration: FEEL_PRESETS[feel].acceleration }
  }
  return { friction: 0.99, acceleration: 1000 }
}

/** Spawn a world enemy scaled to a challenge's enemy-speed multiplier. */
function makeChallengeEnemy(w: number, h: number, ch: Challenge, homing = false): Enemy {
  const e = spawnEnemy(w, h, 1, 1) as Enemy
  e.vx *= ch.enemySpeed
  e.vy *= ch.enemySpeed
  if (homing) {
    e.behavior = 'homing'
    e.hue = 'purple'
  }
  return e
}

/**
 * Hunters are additional to `enemyCount`, not carved out of it — the par model
 * counts them as their own pressure and the challenge text promises them on top
 * of the traffic.
 */
function homingQuota(ch: Challenge) {
  return ch.modifiers.homingEnemies ?? 0
}

/** Total roster a challenge maintains: drifting traffic plus hunters. */
function rosterSize(ch: Challenge) {
  return ch.enemyCount + homingQuota(ch)
}

/** Whether a challenge's win condition is met given current run progress. */
function challengeWon(ch: Challenge, orbs: number, elapsed: number): boolean {
  if (ch.goal.type === 'survive') return elapsed >= ch.goal.target
  return orbs >= ch.goal.target // 'orbs' and 'collectAll'
}

/**
 * Lethal hazards for navigate/minefield challenges — placed clear of the
 * player. `drift` gives them a slow wander, which turns a memorised route into
 * a read-and-react one.
 */
function spawnObstacles(
  width: number,
  height: number,
  player: Puck,
  count: number,
  arena: { x: number; y: number; width: number; height: number } | null,
  drift = false
): Goal[] {
  const obstacles: Goal[] = []
  const radius = 16
  const minX = (arena ? arena.x : 0) + radius + 24
  const maxX = (arena ? arena.x + arena.width : width) - radius - 24
  const minY = (arena ? arena.y : 0) + radius + 24
  const maxY = (arena ? arena.y + arena.height : height) - radius - 24
  let tries = 0
  while (obstacles.length < count && tries < count * 60) {
    tries++
    const x = minX + Math.random() * Math.max(1, maxX - minX)
    const y = minY + Math.random() * Math.max(1, maxY - minY)
    if (Math.hypot(x - player.x, y - player.y) < 110) continue // keep spawn area clear
    if (obstacles.some((o) => Math.hypot(x - o.x, y - o.y) < radius * 3)) continue
    const o: Goal = { x, y, radius }
    if (drift) {
      const speed = 26 + Math.random() * 30
      const angle = Math.random() * Math.PI * 2
      o.vx = Math.cos(angle) * speed
      o.vy = Math.sin(angle) * speed
    }
    obstacles.push(o)
  }
  return obstacles
}

/**
 * Keep an orb inside the play area. A collapsing arena would otherwise sweep
 * past its own orbs and strand them outside the lethal boundary, where reaching
 * one costs the run; instead the closing wall herds them inward.
 */
function containInside(
  o: Goal,
  bounds: { x: number; y: number; width: number; height: number }
) {
  o.x = Math.min(Math.max(o.x, bounds.x + o.radius), bounds.x + bounds.width - o.radius)
  o.y = Math.min(Math.max(o.y, bounds.y + o.radius), bounds.y + bounds.height - o.radius)
}

/** Drift a hazard or orb inside the play area, bouncing off its edges. */
function driftInside(
  o: Goal,
  dt: number,
  bounds: { x: number; y: number; width: number; height: number }
) {
  if (o.vx === undefined || o.vy === undefined) {
    containInside(o, bounds)
    return
  }
  o.x += o.vx * dt
  o.y += o.vy * dt

  const minX = bounds.x + o.radius
  const maxX = bounds.x + bounds.width - o.radius
  const minY = bounds.y + o.radius
  const maxY = bounds.y + bounds.height - o.radius

  if (o.x < minX) { o.x = minX; o.vx = Math.abs(o.vx) }
  else if (o.x > maxX) { o.x = maxX; o.vx = -Math.abs(o.vx) }
  if (o.y < minY) { o.y = minY; o.vy = Math.abs(o.vy) }
  else if (o.y > maxY) { o.y = maxY; o.vy = -Math.abs(o.vy) }
}

/**
 * Clearance an orb needs from a lethal hazard. Without it an orb can land on a
 * mine, where collecting it costs the run — and on a sweep, where the whole set
 * is on the board at once, that makes the challenge unwinnable rather than
 * merely unlucky.
 */
const ORB_HAZARD_CLEARANCE = 34

/** Minimum gap between two orbs of a sweep, so they read as separate targets. */
const ORB_SPACING = 70

/**
 * Place a challenge orb clear of the hazards and of the orbs already placed,
 * retrying the spawn until it lands somewhere reachable.
 */
function spawnSafeGoal(
  width: number,
  height: number,
  player: Puck,
  moving: boolean,
  obstacles: Goal[],
  placed: Goal[],
  arena: { x: number; y: number; width: number; height: number } | null
): Goal {
  let best: Goal | null = null
  let bestClearance = -Infinity

  for (let attempt = 0; attempt < 60; attempt++) {
    const g = spawnGoal(width, height, player.x, player.y, moving)
    clampGoalToCanvas(g, width, height)
    if (arena) repositionGoalInBounds(g, arena.x, arena.y, arena.width, arena.height)

    // Score the spot by how much room it has to spare, so even a crowded arena
    // returns the roomiest candidate rather than an arbitrary one.
    let clearance = Infinity
    for (const o of obstacles) {
      clearance = Math.min(clearance, Math.hypot(g.x - o.x, g.y - o.y) - o.radius - g.radius - ORB_HAZARD_CLEARANCE)
    }
    for (const p of placed) {
      clearance = Math.min(clearance, Math.hypot(g.x - p.x, g.y - p.y) - ORB_SPACING)
    }
    if (clearance >= 0) return g
    if (clearance > bestClearance) {
      bestClearance = clearance
      best = g
    }
  }

  return best!
}

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
  ctx.shadowColor = withAlpha(palette.player, 0.3)
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
  ctx.fillStyle = withAlpha(palette.panel, 0.78)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 24
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 14)
  ctx.fill()
  ctx.shadowBlur = 0

  // Match .rules-modal h2
  ctx.fillStyle = palette.playerLight
  ctx.font = `700 22px ${FONT_UI_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = withAlpha(palette.player, 0.35)
  ctx.shadowBlur = 12
  ctx.fillText(stepLabel, w / 2, boxY + padTop + titleBlock / 2 - 4)
  ctx.shadowBlur = 0

  // Instruction body — centered
  ctx.fillStyle = palette.text
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
  ctx.fillStyle = withAlpha(palette.panel, 0.85)
  ctx.fillRect(0, 0, w, h)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = palette.hostile
  ctx.font = `bold 72px ${FONT_GAME}`
  ctx.shadowColor = withAlpha(palette.hostile, 0.8)
  ctx.shadowBlur = 30
  ctx.fillText(config.title, w / 2, h / 2 - 60)

  ctx.fillStyle = palette.warn
  ctx.font = `bold 48px ${FONT_GAME}`
  ctx.shadowColor = withAlpha(palette.warn, 0.6)
  ctx.shadowBlur = 20
  ctx.fillText(config.middle, w / 2, h / 2)

  ctx.fillStyle = palette.muted
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
  color?: string
}

interface TrailPoint {
  x: number
  y: number
  radius: number
  life: number
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
    /** Multiplayer only: per-player orb counts (duel) / it-time (tag). */
    p1Score?: number
    p2Score?: number
    /** Multiplayer only: seconds left on a timed variant (tag). */
    matchTimeLeft?: number
  }) => void
  onSurvivalGameOver?: (score: number) => void
  /** Emitted once when a survival/challenge run ends, with the full run summary. */
  onRunEnd?: (
    summary: RunSummary,
    perf: { orbs: number; elapsed: number; wallTouched: boolean; arenaWidth: number; arenaHeight: number }
  ) => void
  isPaused?: boolean
  uiState?: 'title' | 'rules' | 'playing' | 'paused'
  gameMode?: GameMode
  /** Active challenge config when gameMode === 'challenge'. */
  challenge?: Challenge | null
  /** Active variant when gameMode === 'multiplayer'. */
  mpVariant?: MpVariant | null
  /** Fired exactly once per multiplayer match, when the match resolves. */
  onMatchEnd?: (result: MatchResult) => void
  /**
   * Online play: this client's role. The host runs the sim (slot 1 driven by
   * network input) and broadcasts snapshots; the guest runs no sim and renders
   * interpolated snapshots. null/undefined = local play, all net paths no-op.
   */
  netRole?: 'host' | 'guest' | null
  /** Online play: the connected room. Listened to via addMessageListener. */
  net?: RoomClient | null
}

const GameCanvas = forwardRef<HTMLCanvasElement, GameCanvasProps>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const playerRef = useRef<Puck | null>(null)
  /**
   * All player slots. Single-player holds ONE slot whose puck IS the same
   * object as playerRef.current (aliased, not copied), so every existing
   * playerRef read keeps working. Multiplayer holds two slots; playerRef
   * aliases slot 0's puck.
   */
  const playersRef = useRef<PlayerSlot[]>([])
  const enemiesRef = useRef<Enemy[]>([])
  const goalRef = useRef<Goal | null>(null)
  const obstaclesRef = useRef<Goal[]>([])
  /** Every orb of a `collectAll` challenge, on the board at once. */
  const sweepGoalsRef = useRef<Goal[]>([])
  const bgStreaksRef = useRef<{ x: number; y: number; depth: number }[]>([])
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
  /** One trail per player slot (single-player uses index 0 only). */
  const playerTrailRef = useRef<TrailPoint[][]>([])
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

  // ── V2 progression refs ──
  const runStatsRef = useRef<RunStats>(freshRunStats())
  const themeRef = useRef<ResolvedTheme>(resolveActiveTheme())
  const trailStyleRef = useRef<TrailStyle>(activeTrailStyle())
  const challengeDoneRef = useRef(false) // guards one-shot challenge completion
  const runFinalizedRef = useRef(false) // guards one-shot run-summary emission
  const matchEndFiredRef = useRef(false) // guards one-shot onMatchEnd emission (multiplayer)
  const prevStunnedRef = useRef<[boolean, boolean]>([false, false]) // recover-pop edge detection

  // ── Online multiplayer (host-authoritative) refs ──
  /** HOST: the guest's held keys (Arrow codes decoded from InputMsg bitmasks). */
  const remoteKeysRef = useRef<Set<string>>(new Set())
  /** GUEST: interpolation buffer over host snapshots. */
  const snapshotBufferRef = useRef<SnapshotBuffer>(new SnapshotBuffer())
  /** GUEST: newest raw snapshot — source of the host sim clock + arena dims. */
  const latestSnapRef = useRef<SnapMsg | null>(null)
  const snapSeqRef = useRef(0) // HOST: outgoing snapshot sequence
  const snapAccumMsRef = useRef(0) // HOST: ms accumulated toward the next snapshot
  const inputSeqRef = useRef(0) // GUEST: outgoing input sequence
  const lastInputMaskRef = useRef(-1) // GUEST: last sent key bitmask
  const lastInputSentAtRef = useRef(0) // GUEST: performance.now() of last input send
  /** GUEST: previously applied goals + score sum, to spot pickups and burst. */
  const prevGuestGoalsRef = useRef<Goal[]>([])
  const prevGuestScoreRef = useRef(0)
  /** GUEST: false until the first snapshot lands — mutes join/rematch FX. */
  const firstSnapAppliedRef = useRef(false)

  const propsRef = useRef(props)
  propsRef.current = props

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

  // Online play: subscribe to the peer's messages. The host consumes guest
  // key bitmasks; the guest buffers host snapshots. addMessageListener keeps
  // page.tsx's own listener (start/pause/end/peerLeft) untouched.
  useEffect(() => {
    const net = props.net
    const role = props.netRole
    if (!net || !role) return
    const unsubscribe = net.addMessageListener((msg) => {
      if (role === 'host' && msg.t === 'input') {
        remoteKeysRef.current = maskToKeys(msg.k)
      } else if (role === 'guest' && msg.t === 'snap') {
        latestSnapRef.current = msg
        snapshotBufferRef.current.push(msg, performance.now())
      }
    })
    return unsubscribe
  }, [props.net, props.netRole])

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  }

  /** Build the run summary from accumulated stats and emit it once. */
  const finalizeRun = (won: boolean) => {
    if (runFinalizedRef.current) return
    const p = propsRef.current
    const mode = p.gameMode
    if (mode !== 'survival' && mode !== 'challenge') return
    runFinalizedRef.current = true

    const gameData = gameDataRef.current
    const rs = runStatsRef.current
    const arenaWidth = canvasWidthRef.current
    const arenaHeight = canvasHeightRef.current

    const summary: RunSummary = {
      mode: mode === 'challenge' ? 'challenge' : 'survival',
      score: gameData.score,
      timeSurvived: rs.elapsed,
      orbsCollected: rs.orbs,
      distanceTraveled: rs.distance,
      longestDrift: rs.longestDrift,
      averageSpeed: rs.elapsed > 0 ? rs.distance / rs.elapsed : 0,
      highestSpeed: rs.topSpeed,
      cataclysmsTriggered: rs.cataclysms,
      won,
      challengeId: p.challenge?.id,
    }
    // Stars are scored against the arena the run was actually played on, so the
    // dimensions travel with the result.
    p.onRunEnd?.(summary, {
      orbs: rs.orbs,
      elapsed: rs.elapsed,
      wallTouched: rs.wallTouched,
      arenaWidth,
      arenaHeight,
    })
  }

  function notifySurvivalGameOverIfNeeded() {
    const gameData = gameDataRef.current
    const isGameOver = gameData.state === 'gameOver'
    if (isGameOver && !lastGameOverNotifiedRef.current) {
      if (gameModeRef.current === 'survival' && props.onSurvivalGameOver) {
        // Score is 1 point per orb, matching the leaderboard's historical metric
        // and its elapsed-time anti-cheat bound.
        props.onSurvivalGameOver(gameData.score)
      }
      // A game-over is always a loss; challenge wins call finalizeRun(true) directly.
      finalizeRun(false)
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
    } else if (props.gameMode === 'challenge' && props.challenge) {
      mode = 'Challenge'
      const ch = props.challenge
      const rs = runStatsRef.current
      eventName =
        ch.goal.type === 'survive'
          ? 'Survive'
          : `Orbs ${rs.orbs}/${ch.goal.target}`
    } else if (props.gameMode === 'multiplayer') {
      mode = 'Versus'
    } else if (gameData.state === 'cataclysm' && gameData.cataclysm) {
      mode = 'Event'
      eventTimeLeft = gameData.cataclysm.timeLeft
      inEvent = true
      eventName = gameData.cataclysm.eventName
    }

    // Multiplayer-only fields: per-player scores (P1 also mirrors into `score`
    // via gameData) and, for timed variants (tag), the match clock.
    let p1Score: number | undefined
    let p2Score: number | undefined
    let matchTimeLeft: number | undefined = undefined
    if (props.gameMode === 'multiplayer') {
      if (props.mpVariant === 'tag') {
        // Tag: slot.score is accumulated it-time; the HUD shows SAFE time
        // (elapsed − it-time) in whole seconds, plus the round countdown.
        const elapsed = Math.min(runStatsRef.current.elapsed, TAG_ROUND_SECONDS)
        p1Score = Math.max(0, Math.floor(elapsed - (playersRef.current[0]?.score ?? 0)))
        p2Score = Math.max(0, Math.floor(elapsed - (playersRef.current[1]?.score ?? 0)))
        matchTimeLeft = Math.max(0, TAG_ROUND_SECONDS - runStatsRef.current.elapsed)
      } else {
        p1Score = playersRef.current[0]?.score ?? 0
        p2Score = playersRef.current[1]?.score ?? 0
      }
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
      p1Score,
      p2Score,
      matchTimeLeft,
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

  const makeSlot = (
    puck: Puck,
    index: 0 | 1,
    inputMap: InputMap,
    colors: { body: string; light: string }
  ): PlayerSlot => ({
    puck,
    index,
    colors,
    inputMap,
    alive: true,
    downedAt: null,
    stunnedUntil: 0,
    immuneUntil: 0,
    score: 0,
    isIt: false,
  })

  const resetGame = (options?: { spawnEnemies?: boolean }) => {
    const w = canvasWidthRef.current
    const h = canvasHeightRef.current
    // Re-resolve cosmetics for this run before slot colors reference them.
    themeRef.current = resolveActiveTheme()
    trailStyleRef.current = activeTrailStyle()
    const pal = themeRef.current.palette

    if (props.gameMode === 'multiplayer') {
      // Two slots; playerRef aliases slot 0's puck so every existing
      // playerRef read keeps working.
      const p1 = createPlayer(w * MP_SPAWN_X_FRACTIONS[0], h / 2)
      const p2 = createPlayer(w * MP_SPAWN_X_FRACTIONS[1], h / 2, 'player2')
      playerRef.current = p1
      playersRef.current = [
        makeSlot(p1, 0, P1_KEYS, { body: pal.player, light: pal.playerLight }),
        makeSlot(p2, 1, P2_KEYS, pickP2Colors(pal.player)),
      ]
    } else {
      // Single slot whose puck IS playerRef.current (aliased, not copied).
      playerRef.current = createPlayer(w / 2, h / 2)
      playersRef.current = [
        makeSlot(playerRef.current, 0, SP_KEYS, { body: pal.player, light: pal.playerLight }),
      ]
    }
    obstaclesRef.current = [] // overwritten below for hazard challenges
    sweepGoalsRef.current = [] // overwritten below for collectAll challenges

    if (props.gameMode === 'tutorial') {
      // Initialize tutorial state
      tutorialStateRef.current = createTutorialState()
      resetTutorial()
    } else if (props.gameMode === 'challenge' && props.challenge) {
      // Challenge: fixed enemy roster + the goal's orbs, all kept inside the arena.
      const ch = props.challenge
      const player = playerRef.current
      const arena = challengeArena(w, h, ch, 0)
      const hunters = homingQuota(ch)
      enemiesRef.current = Array.from({ length: rosterSize(ch) }, (_, i) =>
        makeChallengeEnemy(w, h, ch, i < hunters)
      )
      obstaclesRef.current = ch.modifiers.obstacles
        ? spawnObstacles(w, h, player, ch.modifiers.obstacles, arena, ch.modifiers.movingHazards)
        : []

      const moving = !!ch.modifiers.movingOrbs
      const place = (placed: Goal[]) =>
        spawnSafeGoal(w, h, player, moving, obstaclesRef.current, placed, arena)

      // A sweep puts the whole set on the board so the run is a route to plan,
      // rather than the same chase-the-single-orb loop every other goal type
      // already is.
      if (ch.goal.type === 'collectAll') {
        const placed: Goal[] = []
        for (let i = 0; i < ch.goal.target; i++) placed.push(place(placed))
        sweepGoalsRef.current = placed
        goalRef.current = null
      } else {
        sweepGoalsRef.current = []
        goalRef.current = place([])
      }
      tutorialGoalsRef.current = []
    } else if (props.gameMode === 'multiplayer') {
      const variant = props.mpVariant ?? 'duel'
      if (variant === 'tag') {
        // Tag: no enemies, no orbs, no obstacles — just two pucks. One slot
        // is randomly chosen to start as "it".
        enemiesRef.current = []
        goalRef.current = null
        const itIndex = Math.random() < 0.5 ? 0 : 1
        if (playersRef.current[itIndex]) playersRef.current[itIndex].isIt = true
      } else if (variant === 'coop') {
        // Co-op survival: starts like survival (one enemy, the roster grows
        // via the survival spawn cadence) with the orb clear of BOTH pucks.
        enemiesRef.current = [spawnEnemy(w, h, 1, 1) as Enemy]
        goalRef.current = spawnGoalClearOf(
          w,
          h,
          playersRef.current.map((s) => ({ x: s.puck.x, y: s.puck.y }))
        )
        if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
      } else {
        // Duel: a fixed roster of linear red enemies (no stage scaling — stage
        // stays 1) and a single orb placed clear of BOTH pucks.
        enemiesRef.current = Array.from(
          { length: DUEL_ENEMY_COUNT },
          () => spawnEnemy(w, h, 1, 1) as Enemy
        )
        goalRef.current = spawnGoalClearOf(
          w,
          h,
          playersRef.current.map((s) => ({ x: s.puck.x, y: s.puck.y }))
        )
        if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
      }
      tutorialGoalsRef.current = []
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
    playerTrailRef.current = playersRef.current.map(() => [])
    lastMovementTimeRef.current = 0
    lastGameOverNotifiedRef.current = false

    // V2: reset run-scoped progression state (cosmetics were re-resolved above,
    // before the slot colors referenced them)
    runStatsRef.current = freshRunStats()
    challengeDoneRef.current = false
    runFinalizedRef.current = false
    matchEndFiredRef.current = false
    prevStunnedRef.current = [false, false]

    // Online: a fresh match starts with fresh net state on both sides.
    if (props.netRole) {
      remoteKeysRef.current = new Set()
      snapshotBufferRef.current = new SnapshotBuffer()
      latestSnapRef.current = null
      snapSeqRef.current = 0
      snapAccumMsRef.current = 0
      inputSeqRef.current = 0
      lastInputMaskRef.current = -1
      lastInputSentAtRef.current = 0
      prevGuestGoalsRef.current = []
      prevGuestScoreRef.current = 0
      firstSnapAppliedRef.current = false
    }

    updateGameState()
  }

  const spawnBurst = (x: number, y: number, color?: string, scale = 1) => {
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
        maxRadius: (25 + Math.random() * 15) * scale, // Smaller max radius
        currentRadius: 0,
        rotationSpeed: rotationSpeed,
        radiusGrowth: radiusGrowth,
        color,
      })
    }
  }

  /** Register an orb pickup: +1 score, tracks the run stat, spawns a burst. */
  const registerOrb = (x: number, y: number): number => {
    runStatsRef.current.orbs++
    spawnBurst(x, y)
    return 1
  }

  /** Apply this slot's held directions to its puck (order matches the old inline block). */
  const applyPlayerInput = (
    slot: PlayerSlot,
    keys: Set<string>,
    acceleration: number,
    rev: number,
    dt: number
  ) => {
    const p = slot.puck
    if (isDirectionHeld(keys, slot.inputMap.right)) applyAcceleration(p, rev * acceleration * dt, 0)
    if (isDirectionHeld(keys, slot.inputMap.left)) applyAcceleration(p, rev * -acceleration * dt, 0)
    if (isDirectionHeld(keys, slot.inputMap.down)) applyAcceleration(p, 0, rev * acceleration * dt)
    if (isDirectionHeld(keys, slot.inputMap.up)) applyAcceleration(p, 0, rev * -acceleration * dt)
  }

  /**
   * Velocity driving the parallax streak field: the player's own in
   * single-player (slot 0 is the only slot, so this is bit-identical to the
   * old playerRef read), the living players' average in multiplayer.
   */
  const avgPlayerVelocity = (): { vx: number; vy: number } => {
    const slots = playersRef.current
    if (propsRef.current.gameMode !== 'multiplayer' || slots.length === 0) {
      const p = playerRef.current
      return { vx: p?.vx ?? 0, vy: p?.vy ?? 0 }
    }
    const living = livingPlayers(slots)
    const src = living.length > 0 ? living : slots
    let vx = 0
    let vy = 0
    for (const s of src) {
      vx += s.puck.vx
      vy += s.puck.vy
    }
    return { vx: vx / src.length, vy: vy / src.length }
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
          // Multiplayer rematches go through the page's VersusEndScreen button,
          // which dispatches a synthetic (untrusted) Space; a physical Space
          // press behind the end screen still does nothing.
          if (gameModeRef.current === 'multiplayer' && e.isTrusted) return
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

      // ===== V2: per-frame progression accumulators =====
      const rs = runStatsRef.current
      rs.elapsed += dt

      const mods = propsRef.current.challenge?.modifiers ?? {}
      const handling = challengeHandling(propsRef.current.challenge)
      const isMultiplayer = props.gameMode === 'multiplayer'
      const mpVariant = isMultiplayer ? propsRef.current.mpVariant ?? 'duel' : null
      const isDuel = mpVariant === 'duel'
      const isCoop = mpVariant === 'coop'
      const isTag = mpVariant === 'tag'
      // Cataclysms (and the survival enemy spawn cadence/scaling) run in
      // survival AND co-op; every leaderboard/run-summary gate stays
      // survival-only.
      const cataclysmsOn = props.gameMode === 'survival' || isCoop

      /** Co-op: a slot goes down — frozen in place, bleedout clock running. */
      const downSlot = (slot: PlayerSlot) => {
        if (!slot.alive) return
        slot.alive = false
        slot.downedAt = rs.elapsed
        slot.puck.vx = 0
        slot.puck.vy = 0
      }

      /** Co-op: end the shared run exactly once (wipe or failed cataclysm). */
      const endCoopRun = (reason: 'wipe' | 'timer') => {
        gameData.state = 'gameOver'
        for (const s of playersRef.current) {
          s.puck.vx = 0
          s.puck.vy = 0
        }
        shakeIntensityRef.current = 20
        collisionFlashRef.current = 0.5
        if (!matchEndFiredRef.current) {
          matchEndFiredRef.current = true
          propsRef.current.onMatchEnd?.({
            variant: 'coop',
            winner: 'team',
            scores: [gameData.score, gameData.score],
            elapsed: rs.elapsed,
            reason,
            cataclysmsCleared: gameData.cataclysmCount,
          })
        }
      }

      /**
       * A player touched something lethal. Single-player keeps the exact
       * pre-refactor behavior per cause; multiplayer routes to the variant's
       * rule instead of ending the run.
       */
      const handlePlayerDeath = (
        slot: PlayerSlot,
        cause: 'wall' | 'enemy' | 'obstacle',
        source?: { x: number; y: number }
      ) => {
        const p = slot.puck
        if (isMultiplayer) {
          switch (propsRef.current.mpVariant) {
            case 'coop': {
              // Down, not dead: freeze in place and start the bleedout clock.
              // Revive immunity shields a fresh revive from an instant re-down.
              if (!slot.alive || rs.elapsed < slot.immuneUntil) return
              downSlot(slot)
              clampToBounds(p, w, h)
              spawnBurst(p.x, p.y, themeRef.current.palette.hostile)
              shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 10)
              collisionFlashRef.current = Math.max(collisionFlashRef.current, 0.2)
              return
            }
            case 'tag':
              // Nothing is lethal in tag (no enemies/obstacles, walls wrap),
              // so this is unreachable — swaps happen on puck-vs-puck contact.
              return
            case 'duel':
            default: {
              if (cause === 'wall') {
                // Walls don't stun — they're elastic. Reflect the crossed axis
                // (position not yet clamped, so the overshoot tells us which),
                // bleed some energy, and spark.
                if (p.x - p.radius < 0 || p.x + p.radius > w) p.vx = -p.vx * WALL_BOUNCE_DAMPING
                if (p.y - p.radius < 0 || p.y + p.radius > h) p.vy = -p.vy * WALL_BOUNCE_DAMPING
                clampToBounds(p, w, h)
                spawnBurst(p.x, p.y, '#ffffff', 0.6)
                shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 5)
                return
              }
              // Enemy/obstacle: knockback away from the hit, a short stagger
              // (physics keeps carrying the puck), then i-frames so bouncing
              // through traffic can't chain-stun.
              let dir = source ? normalize({ x: p.x - source.x, y: p.y - source.y }) : { x: 0, y: 0 }
              if (dir.x === 0 && dir.y === 0) dir = normalize({ x: w / 2 - p.x, y: h / 2 - p.y })
              if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: -1 }
              p.vx = dir.x * DUEL_KNOCKBACK_SPEED
              p.vy = dir.y * DUEL_KNOCKBACK_SPEED
              slot.stunnedUntil = rs.elapsed + DUEL_STUN_SECONDS
              slot.immuneUntil = slot.stunnedUntil + DUEL_POST_STUN_IMMUNITY
              clampToBounds(p, w, h)
              spawnBurst(p.x, p.y, themeRef.current.palette.hostile)
              shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 10)
              collisionFlashRef.current = Math.max(collisionFlashRef.current, 0.2)
              return
            }
          }
        }
        if (props.gameMode === 'tutorial') {
          // In tutorial mode, mark as dead to restart current step. Only wall
          // deaths carried the freeze/shake/flash before the refactor.
          tutorialStateRef.current.isDead = true
          if (cause === 'wall') {
            p.vx = 0
            p.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
          }
          return
        }
        gameData.state = 'gameOver'
        p.vx = 0
        p.vy = 0
        shakeIntensityRef.current = 20
        collisionFlashRef.current = 0.5
      }

      // ===== MOMENTUM-BASED MOVEMENT =====
      // Disable movement when dead in tutorial OR during instructions
      if (!(props.gameMode === 'tutorial' && (tutorialStateRef.current.isDead || tutorialStateRef.current.showInstruction))) {
        const acceleration = handling.acceleration
        const rev = mods.reverseControls ? -1 : 1
        const maxVel = isMultiplayer ? MP_BASE_MAXVEL : 500

        playersRef.current.forEach((slot, i) => {
          const p = slot.puck
          // Tag: the "it" puck is buffed — faster acceleration, higher cap.
          const itBuffed = isTag && slot.isIt
          const slotAccel = itBuffed ? acceleration * TAG_IT_ACCEL : acceleration
          const slotMaxVel = itBuffed ? TAG_IT_MAXVEL : maxVel
          // Stunned pucks ignore input (their velocity was zeroed at the hit);
          // downed co-op pucks are frozen entirely until revived.
          const downed = isCoop && !slot.alive
          if (!downed && !(rs.elapsed < slot.stunnedUntil)) {
            // Online host: slot 1 is the guest's puck, driven by the network
            // key bitmask (Arrow codes, matching slot 1's P2_KEYS map).
            const keys =
              props.netRole === 'host' && slot.index === 1
                ? remoteKeysRef.current
                : activeKeysRef.current
            applyPlayerInput(slot, keys, slotAccel, rev, dt)
          }

          applyDamping(p, handling.friction)

          const velMag = Math.hypot(p.vx, p.vy)
          if (velMag > slotMaxVel) {
            const scale = slotMaxVel / velMag
            p.vx *= scale
            p.vy *= scale
          }

          integrate(p, dt)

          if (velMag > 60) {
            const slotTrail = (playerTrailRef.current[i] ??= [])
            slotTrail.push({
              x: p.x,
              y: p.y,
              radius: p.radius,
              life: 0.42,
            })
            if (slotTrail.length > 18) slotTrail.shift()
          }
        })

        // Run-stat tracking (slot 0 only, exactly as before the refactor):
        // distance, top speed, and longest no-input glide (drift)
        const speed = Math.hypot(player.vx, player.vy)
        rs.distance += speed * dt
        if (speed > rs.topSpeed) rs.topSpeed = speed
        if (activeKeysRef.current.size === 0 && speed > 40) {
          rs.currentDrift += speed * dt
          if (rs.currentDrift > rs.longestDrift) rs.longestDrift = rs.currentDrift
        } else {
          rs.currentDrift = 0
        }
      }

      const arena =
        props.gameMode === 'challenge'
          ? challengeArena(w, h, propsRef.current.challenge, runStatsRef.current.elapsed)
          : null
      for (const slot of playersRef.current) {
        const p = slot.puck
        const outOfPlay = arena
          ? isOutOfArena(p, arena.x, arena.y, arena.width, arena.height)
          : isOutOfBounds(p, w, h)
        if (!outOfPlay) continue
        // Untouchable challenges score on this rather than ending the run: the
        // wrap below still carries you through, but the clean route is the only
        // one worth more than a single star.
        runStatsRef.current.wallTouched = true
        if (props.gameMode === 'zen' || mods.wraparound === true || isTag) {
          // Wrap-around teleport to the opposite side. Wrapping happens at the
          // active play edge, so a shrunken or collapsing arena still wraps at
          // its own border rather than the far-off canvas edge.
          const left = arena ? arena.x : 0
          const right = arena ? arena.x + arena.width : w
          const top = arena ? arena.y : 0
          const bottom = arena ? arena.y + arena.height : h
          if (p.x - p.radius < left) p.x = right - p.radius
          else if (p.x + p.radius > right) p.x = left + p.radius
          if (p.y - p.radius < top) p.y = bottom - p.radius
          else if (p.y + p.radius > bottom) p.y = top + p.radius
        } else {
          handlePlayerDeath(slot, 'wall')
          // Preserve the pre-refactor early return when the run (or the
          // tutorial step) actually ended; a duel stun keeps the frame going.
          // (Read via the ref: handlePlayerDeath mutates state behind TS's
          // control-flow narrowing.)
          if (gameDataRef.current.state === 'gameOver') return
          if (props.gameMode === 'tutorial' && tutorialStateRef.current.isDead) return
        }
      }

      for (const enemy of enemiesRef.current) {
        // Hunters steer toward the nearest living player instead of coasting
        // across the arena (with one slot this IS the player, as before).
        if (enemy.behavior === 'homing') {
          const nearest = nearestLivingPlayer(playersRef.current, enemy.x, enemy.y)
          applySeek(enemy, nearest.x, nearest.y, dt)
        }
        integrate(enemy, dt)
      }

      // Drifting hazards and orbs move within the active play area.
      if (props.gameMode === 'challenge') {
        const bounds = arena ?? { x: 0, y: 0, width: w, height: h }
        for (const o of obstaclesRef.current) driftInside(o, dt, bounds)
        if (goalRef.current) driftInside(goalRef.current, dt, bounds)
        for (const g of sweepGoalsRef.current) driftInside(g, dt, bounds)
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
          
          if (goalsRemaining === 0) {
            // For Step 7, advance immediately when goals are collected
            const isFinalStep = tutorialState.currentStep === 6 // Step 7 (index 6)
            advanceStep(tutorialState, () => {
              // Always reset to set up the next step (including Step 8)
              resetTutorial()
              
              if (isFinalStep) {
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
    
    // Cap max enemies and increase cap with stage for gradual difficulty.
      // Co-op scales both caps up: two pucks share the arena.
      const enemyCapScale = isCoop ? COOP_ENEMY_SCALE : 1
      const maxEnemies = Math.round(Math.min(12 + Math.floor(gameData.stage * 2), 80) * enemyCapScale)
      const minEnemies = Math.round((3 + Math.floor(gameData.stage / 3)) * enemyCapScale) // Minimum enemies: 3 at stage 1, +1 every 3 stages

      // Ensure minimum enemy count
      if (cataclysmsOn && enemiesRef.current.length < minEnemies) {
        const baseSpeed = 80 + gameData.stage * 20
        const speedVariation = 0.9 + Math.random() * 0.2 // 0.9-1.1 variation
        const finalSpeed = baseSpeed * speedVariation

        enemiesRef.current.push(spawnEnemy(w, h, gameData.stage, 1) as Enemy) // Use diffMultiplier=1
      }

      if (cataclysmsOn && enemiesRef.current.length < maxEnemies && Math.random() < dt * spawnChance) {
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

      // ===== CHALLENGE: maintain fixed roster + resolve win/lose =====
      if (props.gameMode === 'challenge' && propsRef.current.challenge) {
        const ch = propsRef.current.challenge
        // Hunters that wander off screen must come back as hunters, or a chase
        // challenge quietly decays into a plain one.
        while (enemiesRef.current.length < rosterSize(ch)) {
          const hunters = enemiesRef.current.filter((e) => e.behavior === 'homing').length
          enemiesRef.current.push(makeChallengeEnemy(w, h, ch, hunters < homingQuota(ch)))
        }

        const deadline = challengeTimeLimit(ch, w, h)
        if (!challengeDoneRef.current && gameData.state === 'playing') {
          const rsC = runStatsRef.current
          if (challengeWon(ch, rsC.orbs, rsC.elapsed)) {
            challengeDoneRef.current = true
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            finalizeRun(true)
          } else if (deadline > 0 && ch.goal.type !== 'survive' && rsC.elapsed >= deadline) {
            // Timed collect goal expired without finishing — a loss.
            challengeDoneRef.current = true
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 16
            finalizeRun(false)
          }
        }
      }

      // ===== MULTIPLAYER (DUEL): maintain the fixed enemy roster =====
      // Enemies that drift off the canvas (filtered above) respawn at an edge,
      // like the challenge roster; no stage speed scaling (stage stays 1).
      // Co-op uses the survival spawn cadence above; tag has no enemies.
      if (isDuel) {
        while (enemiesRef.current.length < DUEL_ENEMY_COUNT) {
          enemiesRef.current.push(spawnEnemy(w, h, 1, 1) as Enemy)
        }
      }

      // ===== SWEEP CHALLENGE: COLLECT THE WHOLE BOARD =====
      if (gameData.state === 'playing' && sweepGoalsRef.current.length > 0) {
        const remaining: Goal[] = []
        for (const g of sweepGoalsRef.current) {
          if (puckCollideGoal(player, g)) {
            gameData.score += registerOrb(g.x, g.y)
          } else {
            remaining.push(g)
          }
        }
        if (remaining.length !== sweepGoalsRef.current.length) {
          sweepGoalsRef.current = remaining
          updateGameState()
        }
      }

      // ===== MULTIPLAYER (CO-OP): SHARED GOAL COLLECTION =====
      // Mirrors the survival path: shared score + eventProgress, cataclysm
      // trigger every 10 orbs, respawns placed clear of BOTH pucks. No
      // per-slot score is tracked in co-op.
      if (isCoop && gameData.state === 'playing' && goalRef.current) {
        for (const slot of livingPlayers(playersRef.current)) {
          const g = goalRef.current
          if (!g || !puckCollideGoal(slot.puck, g)) continue
          gameData.score += registerOrb(g.x, g.y)
          gameData.eventProgress++

          if (gameData.eventProgress >= 10) {
            gameData.state = 'cataclysm'
            gameData.eventProgress = 0
            runStatsRef.current.cataclysms++
            const eventType = getEventType()
            gameData.cataclysm = createCataclysm(
              eventType,
              w,
              h,
              livingPlayers(playersRef.current).map((s) => s.puck),
              gameData.stage
            )
          } else {
            goalRef.current = spawnGoalClearOf(
              w,
              h,
              playersRef.current.map((s) => ({ x: s.puck.x, y: s.puck.y }))
            )
            clampGoalToCanvas(goalRef.current, w, h)
          }
          updateGameState()
          break // one orb, one collector per frame
        }
      }

      // ===== MULTIPLAYER (DUEL): GOAL COLLECTION + WIN CHECK =====
      if (isDuel && gameData.state === 'playing' && goalRef.current) {
        for (const slot of playersRef.current) {
          const g = goalRef.current
          // Stunned pucks are ghosted: they can't collect either.
          if (rs.elapsed < slot.stunnedUntil) continue
          if (!g || !puckCollideGoal(slot.puck, g)) continue
          registerOrb(g.x, g.y)
          slot.score++
          // Mirror P1's orbs into the legacy score field.
          if (slot.index === 0) gameData.score = slot.score

          if (propsRef.current.mpVariant === 'duel' && slot.score >= DUEL_TARGET_SCORE) {
            // First to the target wins — end the match exactly once.
            if (!matchEndFiredRef.current) {
              matchEndFiredRef.current = true
              gameData.state = 'gameOver'
              for (const s of playersRef.current) {
                s.puck.vx = 0
                s.puck.vy = 0
              }
              propsRef.current.onMatchEnd?.({
                variant: 'duel',
                winner: slot.index,
                scores: [
                  playersRef.current[0]?.score ?? 0,
                  playersRef.current[1]?.score ?? 0,
                ],
                elapsed: rs.elapsed,
                reason: 'score',
              })
            }
          } else {
            // Respawn the orb clear of BOTH pucks.
            goalRef.current = spawnGoalClearOf(
              w,
              h,
              playersRef.current.map((s) => ({ x: s.puck.x, y: s.puck.y }))
            )
            clampGoalToCanvas(goalRef.current, w, h)
          }
          updateGameState()
          break // one orb, one collector per frame
        }
      }

      // ===== NORMAL MODE: GOAL COLLECTION =====
      if (!isMultiplayer && gameData.state === 'playing' && goalRef.current) {
        if (puckCollideGoal(player, goalRef.current)) {
          gameData.score += registerOrb(goalRef.current.x, goalRef.current.y)
          gameData.eventProgress++

          if (
            props.gameMode === 'survival' &&
            gameData.eventProgress >= 10 &&
            gameData.state === 'playing'
          ) {
            gameData.state = 'cataclysm'
            gameData.eventProgress = 0
            runStatsRef.current.cataclysms++
            const eventType = getEventType()
            gameData.cataclysm = createCataclysm(
              eventType,
              w,
              h,
              [player],
              gameData.stage
            )
          } else {
            if (props.gameMode === 'challenge' && propsRef.current.challenge) {
              // Respawns dodge the hazards too — a mid-run orb landing on a mine
              // would stall the challenge just as badly as one placed there.
              goalRef.current = spawnSafeGoal(
                w,
                h,
                player,
                !!propsRef.current.challenge.modifiers.movingOrbs,
                obstaclesRef.current,
                [],
                arena
              )
            } else {
              goalRef.current = spawnCataclysmGoals(w, h, player.x, player.y)[0]
              if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
            }
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
            i--
            updateGameState()
          }
        }
      }

      // ===== CATACLYSM MODE (SURVIVAL + CO-OP) =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm && cataclysmsOn) {
        const cat = gameData.cataclysm
        if (cat.enterTime !== undefined) cat.enterTime += dt

        // Only decrement timer AFTER intro finishes (enterTime >= 1.5)
        if (cat.enterTime === undefined || cat.enterTime >= 1.5) {
          cat.timeLeft -= dt
        }

        // Only LIVING pucks are passed to the event (downed co-op pucks are
        // excluded); livingSlots is the parallel array that maps any indices
        // the event returns back to the right slot. Single-player this is
        // exactly [slot 0].
        const livingSlots = isCoop ? livingPlayers(playersRef.current) : playersRef.current
        const eventResult = updateCataclysmEvent({
          cat,
          players: livingSlots.map((s) => s.puck),
          player: playersRef.current[0].puck,
          worldEnemies: enemiesRef.current,
          width: w,
          height: h,
          dt,
        })

        if (eventResult === 'gameOver') {
          // Non-arena failures (e.g. a timer event) end the run outright.
          if (isCoop) {
            endCoopRun('timer')
          } else {
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
          }
          return
        } else if (Array.isArray(eventResult) && eventResult.length > 0) {
          // Indices into the passed players array: pucks caught by the
          // shrinking arena this tick.
          if (isCoop) {
            // Co-op: those players go DOWN (bleedout/revive rules apply; the
            // end-condition check below this frame handles a full wipe).
            for (const idx of eventResult) {
              const caught = livingSlots[idx]
              if (caught) downSlot(caught)
            }
          } else {
            // Single-player: exactly like 'gameOver' (today's behavior).
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
          // Co-op: BOTH living pucks can collect event goals; single-player
          // this is the player puck exactly as before.
          const collector = isInOverlay
            ? undefined
            : livingSlots.find((s) => puckCollideGoal(s.puck, goal))
          if (collector) {
            cat.goalsCollected++
            gameData.score += registerOrb(goal.x, goal.y)
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

              if (isCoop) {
                goalRef.current = spawnGoalClearOf(
                  w,
                  h,
                  playersRef.current.map((s) => ({ x: s.puck.x, y: s.puck.y }))
                )
                clampGoalToCanvas(goalRef.current, w, h)
              } else {
                const goals = spawnCataclysmGoals(w, h, player.x, player.y)
                goalRef.current = goals[0]
                if (goalRef.current) clampGoalToCanvas(goalRef.current, w, h)
              }
              updateGameState()
            }
          }
        }

        if (cat.timeLeft <= 0) {
          // Failing the cataclysm ends the run in co-op too.
          if (isCoop) {
            endCoopRun('timer')
          } else {
            gameData.state = 'gameOver'
            player.vx = 0
            player.vy = 0
            shakeIntensityRef.current = 20
            collisionFlashRef.current = 0.5
          }
        }
      }

      // Collision detection - with grace period during event overlay
      const isInEventOverlay = gameData.state === 'cataclysm' && 
        gameData.cataclysm && 
        (gameData.cataclysm.enterTime ?? 0) < 1.5
      
      const eventEnemies = gameData.cataclysm?.eventEnemies ?? []
      for (const slot of playersRef.current) {
        // Stunned pucks are ghosted; post-stun immunity also skips contact.
        // Downed co-op pucks are already dead-ish — enemies pass through them.
        if (!slot.alive) continue
        if (rs.elapsed < slot.stunnedUntil || rs.elapsed < slot.immuneUntil) continue
        for (const enemy of [...enemiesRef.current, ...eventEnemies]) {
          if (circlesCollide(slot.puck, enemy)) {
            // Don't die during overlay grace period (fairness - transition from intro to gameplay)
            if (!isInEventOverlay) {
              handlePlayerDeath(slot, 'enemy', enemy)
              if (gameData.state === 'gameOver') return
              if (props.gameMode === 'tutorial' && tutorialStateRef.current.isDead) return
              break // duel stun: this slot is done, check the other slot
            }
          }
        }
      }

      // ===== STATIC OBSTACLE COLLISION (navigate challenges) =====
      if (!isInEventOverlay && obstaclesRef.current.length > 0) {
        for (const slot of playersRef.current) {
          if (!slot.alive) continue
          if (rs.elapsed < slot.stunnedUntil || rs.elapsed < slot.immuneUntil) continue
          for (const o of obstaclesRef.current) {
            if (puckCollideGoal(slot.puck, o)) {
              handlePlayerDeath(slot, 'obstacle', o)
              if (gameData.state === 'gameOver') return
              break
            }
          }
        }
      }

      // ===== CO-OP: TOUCH REVIVES + TEAM END CONDITIONS =====
      if (isCoop && gameData.state !== 'gameOver') {
        const slots = playersRef.current
        for (const downed of slots) {
          if (downed.alive) continue
          const helper = slots.find((s) => s !== downed && s.alive)
          if (helper && circlesCollide(helper.puck, downed.puck)) {
            // Revived on touch: brief immunity, velocity stays frozen — the
            // player accelerates away themselves.
            downed.alive = true
            downed.downedAt = null
            downed.immuneUntil = rs.elapsed + COOP_REVIVE_IMMUNITY
            downed.puck.vx = 0
            downed.puck.vy = 0
            spawnBurst(downed.puck.x, downed.puck.y)
          }
        }
        const bothDown = slots.length > 0 && slots.every((s) => !s.alive)
        const bledOut = slots.some(
          (s) => !s.alive && s.downedAt !== null && rs.elapsed - s.downedAt >= COOP_BLEEDOUT_SECONDS
        )
        if (bothDown || bledOut) endCoopRun('wipe')
      }

      // ===== TAG: TOUCH SWAPS, IT-TIME, ROUND TIMER =====
      if (isTag && gameData.state === 'playing') {
        const [s0, s1] = playersRef.current
        if (s0 && s1) {
          if (
            rs.elapsed >= s0.immuneUntil &&
            rs.elapsed >= s1.immuneUntil &&
            circlesCollide(s0.puck, s1.puck)
          ) {
            // Pass "it" and start the swap cooldown on BOTH slots so it can't
            // ping-pong back within the same touch.
            s0.isIt = !s0.isIt
            s1.isIt = !s1.isIt
            s0.immuneUntil = rs.elapsed + TAG_SWAP_COOLDOWN
            s1.immuneUntil = rs.elapsed + TAG_SWAP_COOLDOWN
            spawnBurst(
              (s0.puck.x + s1.puck.x) / 2,
              (s0.puck.y + s1.puck.y) / 2,
              themeRef.current.palette.hostile,
              0.6
            )
            shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 6)
          }

          // slot.score accumulates seconds spent as "it".
          for (const s of playersRef.current) {
            if (s.isIt) s.score += dt
          }

          if (rs.elapsed >= TAG_ROUND_SECONDS) {
            gameData.state = 'gameOver'
            for (const s of playersRef.current) {
              s.puck.vx = 0
              s.puck.vy = 0
            }
            if (!matchEndFiredRef.current) {
              matchEndFiredRef.current = true
              const it0 = s0.score
              const it1 = s1.score
              // Winner spent LESS time as it; too close is a draw.
              const winner: MatchResult['winner'] =
                Math.abs(it0 - it1) < TAG_DRAW_MARGIN ? 'draw' : it0 < it1 ? 0 : 1
              propsRef.current.onMatchEnd?.({
                variant: 'tag',
                winner,
                scores: [
                  Math.round(Math.max(0, TAG_ROUND_SECONDS - it0)),
                  Math.round(Math.max(0, TAG_ROUND_SECONDS - it1)),
                ],
                elapsed: TAG_ROUND_SECONDS,
                reason: 'timer',
              })
            }
          }
        }
      }

      updateEffects(dt, w, h)
    }

    /**
     * Purely-cosmetic per-frame systems shared by the local sim and the
     * online guest (which runs no sim but still animates these): parallax
     * streak drift, particle motion, trail decay, shake/flash decay.
     * `w`/`h` are the coordinate space the streaks live in (host arena dims
     * on the guest, local canvas dims everywhere else).
     */
    function updateEffects(dt: number, w: number, h: number) {
      // Parallax speed-streak field drifts opposite the players' motion
      // (slot 0's own velocity in single-player, the living average in MP).
      if (bgStreaksRef.current.length > 0) {
        const av = avgPlayerVelocity()
        for (const st of bgStreaksRef.current) {
          st.x -= av.vx * dt * 0.12 * st.depth
          st.y -= av.vy * dt * 0.12 * st.depth
          if (st.x < 0) st.x += w
          else if (st.x > w) st.x -= w
          if (st.y < 0) st.y += h
          else if (st.y > h) st.y -= h
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

      for (const slotTrail of playerTrailRef.current) {
        for (let i = 0; i < slotTrail.length; i++) {
          slotTrail[i].life -= dt
          if (slotTrail[i].life <= 0) {
            slotTrail.splice(i, 1)
            i--
          }
        }
      }

      shakeIntensityRef.current *= 0.95
      collisionFlashRef.current *= 0.92
    }

    // ===== ONLINE MULTIPLAYER (HOST-AUTHORITATIVE) =====

    /** HOST: build one wire snapshot straight from the live sim refs. */
    function buildSnapshot(): SnapMsg {
      const gameData = gameDataRef.current
      const rs = runStatsRef.current
      const slots = playersRef.current

      const toSnapPlayer = (slot: PlayerSlot | undefined): SnapPlayer =>
        slot
          ? {
              x: slot.puck.x,
              y: slot.puck.y,
              vx: slot.puck.vx,
              vy: slot.puck.vy,
              alive: slot.alive,
              stun: slot.stunnedUntil,
              imm: slot.immuneUntil,
              it: slot.isIt,
              score: slot.score,
            }
          : { x: 0, y: 0, vx: 0, vy: 0, alive: true, stun: 0, imm: 0, it: false, score: 0 }

      // Cataclysm event enemies (hunters/swap sentinels/meteors) ride along in
      // the same enemies list — the guest re-splits them by hue for styling.
      const cat = gameData.state === 'cataclysm' ? gameData.cataclysm : undefined
      const enemies: SnapEnemy[] = []
      let fallbackId = 0
      const pushEnemy = (e: Enemy) => {
        enemies.push({ id: e.id ?? `e${fallbackId++}`, x: e.x, y: e.y, vx: e.vx, vy: e.vy, hue: e.hue })
      }
      for (const e of enemiesRef.current) pushEnemy(e)
      for (const e of cat?.eventEnemies ?? []) pushEnemy(e)

      // Goals: the 7 event goals during a cataclysm, the single orb otherwise.
      const goalList = cat ? cat.goals : goalRef.current ? [goalRef.current] : []
      const goals = goalList.map((g) => ({ x: g.x, y: g.y, r: g.radius }))

      const gd: SnapGameData = {
        state: gameData.state,
        score: gameData.score,
        stage: gameData.stage,
        // Orbs toward the next cataclysm (HUD shows X/10); 0 during events,
        // matching what the host HUD itself displays.
        eventProgress: gameData.eventProgress,
      }
      if (cat) {
        gd.eventType = cat.eventType
        gd.eventName = cat.eventName
        gd.eventTimeLeft = cat.timeLeft
      }
      if (propsRef.current.mpVariant === 'tag') {
        gd.matchTimeLeft = Math.max(0, TAG_ROUND_SECONDS - rs.elapsed)
      }

      return {
        t: 'snap',
        seq: ++snapSeqRef.current,
        // Host sim-elapsed ms: monotonic while playing, frozen while paused
        // (the guest buffer dedups frozen timestamps, which is fine — paused
        // frames carry no new state).
        ts: Math.round(rs.elapsed * 1000),
        players: [toSnapPlayer(slots[0]), toSnapPlayer(slots[1])],
        enemies,
        goals,
        gd,
        arena: { w: canvasWidthRef.current, h: canvasHeightRef.current },
      }
    }

    /** HOST: broadcast at SNAPSHOT_HZ via accumulated frame time (no timers). */
    function maybeBroadcastSnapshot(net: RoomClient, dtMs: number) {
      const intervalMs = 1000 / SNAPSHOT_HZ
      snapAccumMsRef.current += dtMs
      if (snapAccumMsRef.current < intervalMs) return
      // Cap the carried debt so one long frame can't fire a snapshot burst.
      snapAccumMsRef.current = Math.min(snapAccumMsRef.current - intervalMs, intervalMs)
      net.send(buildSnapshot())
    }

    /** GUEST: minimal render-side Enemy from a wire enemy. */
    const snapToEnemy = (e: SnapEnemy): Enemy => ({
      id: e.id,
      x: e.x,
      y: e.y,
      vx: e.vx,
      vy: e.vy,
      radius: 12,
      baseSpeed: 0,
      behavior: 'linear',
      hue: e.hue ?? 'red',
    })

    /**
     * GUEST: no sim — pour the interpolated snapshot into the same refs
     * render() already reads, so the entire existing render path draws the
     * host's world unchanged. `dt` only advances the local intro-banner clock
     * (pass 0 while paused).
     */
    function applySnapshotState(dt: number) {
      const sampled = snapshotBufferRef.current.sample(performance.now())
      if (!sampled) return
      const gameData = gameDataRef.current
      const rs = runStatsRef.current

      // The host sim clock drives every elapsed-relative visual: stun rings,
      // bleedout arcs, tag cooldown dashes, and the tag HUD clock.
      const latest = latestSnapRef.current
      if (latest) rs.elapsed = latest.ts / 1000

      const slots = playersRef.current
      const firstSnapApplied = firstSnapAppliedRef.current
      for (let i = 0; i < slots.length && i < 2; i++) {
        const slot = slots[i]
        const sp = sampled.players[i]

        // Locally-derived hit/down/swap FX: the host doesn't send effects, so
        // the guest fires its own on state transitions. Gated behind the
        // first-snapshot flag so joining or rematching mid-state stays quiet.
        if (firstSnapApplied) {
          if (sp.stun > slot.stunnedUntil && rs.elapsed < sp.stun) {
            // Freshly staggered (duel): burst + shake + flash at the puck.
            spawnBurst(sp.x, sp.y, themeRef.current.palette.hostile)
            shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 10)
            collisionFlashRef.current = Math.max(collisionFlashRef.current, 0.2)
          }
          if (!sp.alive && slot.alive) {
            // Freshly downed (co-op).
            spawnBurst(sp.x, sp.y, themeRef.current.palette.hostile)
            shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 10)
            collisionFlashRef.current = Math.max(collisionFlashRef.current, 0.2)
          }
          if (sp.it && !slot.isIt) {
            // Tag passed to this slot (fire once — only for the newly-"it" side).
            spawnBurst(sp.x, sp.y, themeRef.current.palette.hostile, 0.6)
            shakeIntensityRef.current = Math.max(shakeIntensityRef.current, 6)
          }
        }

        slot.puck.x = sp.x
        slot.puck.y = sp.y
        slot.puck.vx = sp.vx
        slot.puck.vy = sp.vy
        // downedAt isn't on the wire: start the bleedout arc at the first
        // snapshot that shows the puck down (visual-only approximation).
        if (!sp.alive && slot.alive) slot.downedAt = rs.elapsed
        if (sp.alive) slot.downedAt = null
        slot.alive = sp.alive
        slot.stunnedUntil = sp.stun
        slot.immuneUntil = sp.imm ?? 0
        slot.isIt = sp.it
        slot.score = sp.score

        // Trails don't travel over the wire — regrow them from sampled motion
        // (same speed gate and cap as the sim's own trail writer).
        if (Math.hypot(sp.vx, sp.vy) > 60) {
          const slotTrail = (playerTrailRef.current[i] ??= [])
          slotTrail.push({ x: sp.x, y: sp.y, radius: slot.puck.radius, life: 0.42 })
          if (slotTrail.length > 18) slotTrail.shift()
        }
      }

      const gd = sampled.gd
      gameData.score = gd.score
      gameData.stage = gd.stage
      gameData.eventProgress = gd.eventProgress ?? 0
      gameData.state = gd.state

      // Orb pickups don't happen locally: when any score ticks up, burst at
      // whichever goal vanished from the synced set.
      const scoreSum =
        gd.score + (sampled.players[0]?.score ?? 0) + (sampled.players[1]?.score ?? 0)
      if (scoreSum > prevGuestScoreRef.current) {
        const vanished = prevGuestGoalsRef.current.find(
          (pg) => !sampled.goals.some((g) => Math.hypot(g.x - pg.x, g.y - pg.y) < 30)
        )
        if (vanished) spawnBurst(vanished.x, vanished.y)
      }
      prevGuestScoreRef.current = scoreSum
      prevGuestGoalsRef.current = sampled.goals.map((g) => ({ x: g.x, y: g.y, radius: g.r }))

      if (gd.state === 'cataclysm' && gd.eventType) {
        // Rebuild the minimal render-side CataclysmData the render path reads.
        // enterTime is local-only so the intro banner plays on the guest too.
        const evType = gd.eventType as CataclysmEventType
        let cat = gameData.cataclysm
        if (!cat || cat.eventType !== evType) {
          cat = {
            timeLeft: gd.eventTimeLeft ?? 30,
            goalsNeeded: 7,
            goalsCollected: 0,
            eventType: evType,
            eventName: gd.eventName ?? '',
            goals: [],
            arenaWidth: sampled.arena.w,
            arenaHeight: sampled.arena.h,
            enterTime: 0,
          }
          gameData.cataclysm = cat
        }
        cat.timeLeft = gd.eventTimeLeft ?? cat.timeLeft
        if (gd.eventName) cat.eventName = gd.eventName
        cat.arenaWidth = sampled.arena.w
        cat.arenaHeight = sampled.arena.h
        cat.enterTime = (cat.enterTime ?? 0) + dt
        cat.goals = sampled.goals.map((g) => ({ x: g.x, y: g.y, radius: g.r }))

        // Purple hunters go through the eventEnemies render path so they keep
        // hunter styling; everything else draws as a plain enemy (identical
        // visuals for red event enemies).
        const world: Enemy[] = []
        const hunters: Enemy[] = []
        for (const e of sampled.enemies) {
          ;(e.hue === 'purple' ? hunters : world).push(snapToEnemy(e))
        }
        cat.eventEnemies = hunters
        enemiesRef.current = world
        goalRef.current = null
      } else {
        gameData.cataclysm = undefined
        enemiesRef.current = sampled.enemies.map(snapToEnemy)
        const g = sampled.goals[0]
        goalRef.current = g ? { x: g.x, y: g.y, radius: g.r } : null
      }

      firstSnapAppliedRef.current = true
    }

    /** GUEST: send held keys as a bitmask on change, plus a low-rate heartbeat. */
    function sendGuestInput(net: RoomClient, nowMs: number) {
      if (props.uiState !== 'playing') return
      const mask = keysToMask(activeKeysRef.current)
      const heartbeatMs = 1000 / INPUT_HEARTBEAT_HZ
      if (mask === lastInputMaskRef.current && nowMs - lastInputSentAtRef.current < heartbeatMs) {
        return
      }
      lastInputMaskRef.current = mask
      lastInputSentAtRef.current = nowMs
      net.send({ t: 'input', seq: ++inputSeqRef.current, k: mask })
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

    /** Player puck body: velocity-reactive glow + squash/stretch + highlight. */
    const drawPlayerBody = (p: Puck, body: string, light: string) => {
      const pSpeed = Math.hypot(p.vx, p.vy)
      const speedT = Math.min(1, pSpeed / 500)
      drawGlowCircle(p.x, p.y, p.radius + 8 + speedT * 8, body, 25 + speedT * 22, 0.4 + speedT * 0.25)

      ctx.save()
      // Stretch the body along the direction of travel — subtle arcade juice.
      if (pSpeed > 30) {
        const ang = Math.atan2(p.vy, p.vx)
        const stretch = speedT * 0.18
        ctx.translate(p.x, p.y)
        ctx.rotate(ang)
        ctx.scale(1 + stretch, 1 - stretch)
        ctx.rotate(-ang)
        ctx.translate(-p.x, -p.y)
      }
      drawGradientPuck(p.x, p.y, p.radius, light, body)

      // Player highlight
      const highlightGrad = ctx.createRadialGradient(p.x - 4, p.y - 4, 0, p.x, p.y, p.radius)
      highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
      highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = highlightGrad
      ctx.beginPath()
      ctx.arc(p.x - 4, p.y - 4, p.radius * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function render() {
      const localW = canvasWidthRef.current
      const localH = canvasHeightRef.current
      const gameData = gameDataRef.current
      const shake = getShakeOffset(shakeIntensityRef.current)
      // Active-theme palette shadows the base import so all entity colors below
      // pick up the player's selected arena theme with no per-call changes.
      const theme = themeRef.current
      const palette = theme.palette

      // Multiplayer variant flags (mirrors update()); cataclysm visuals run in
      // survival AND co-op.
      const mpVariantR =
        propsRef.current.gameMode === 'multiplayer' ? propsRef.current.mpVariant ?? 'duel' : null
      const cataclysmsOn = props.gameMode === 'survival' || mpVariantR === 'coop'

      // Clear canvas completely to prevent motion trails/streaking
      ctx.clearRect(0, 0, localW, localH)

      // ===== ONLINE GUEST: HOST-ARENA COORDINATE SPACE =====
      // Snapshots are in HOST arena coordinates. Uniformly scale + center
      // (letterbox) the host arena onto the local canvas; every scene draw
      // below then works in host coords untouched. Restored before the
      // stall ribbon, which is a local-space overlay.
      let w = localW
      let h = localH
      let guestTransformed = false
      const guestArena =
        props.netRole === 'guest' && props.net ? latestSnapRef.current?.arena ?? null : null
      if (guestArena && guestArena.w > 0 && guestArena.h > 0 && localW > 0 && localH > 0) {
        const scale = Math.min(localW / guestArena.w, localH / guestArena.h)
        // Fill the letterbox bars with the arena's outer wash so they read
        // as backdrop rather than dead space.
        ctx.fillStyle = theme.bgOuter
        ctx.fillRect(0, 0, localW, localH)
        ctx.save()
        ctx.translate((localW - guestArena.w * scale) / 2, (localH - guestArena.h * scale) / 2)
        ctx.scale(scale, scale)
        guestTransformed = true
        w = guestArena.w
        h = guestArena.h
      }

      // ===== THEMED ARENA BACKGROUND (radial wash + faint grid) =====
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
      bgGrad.addColorStop(0, theme.bgInner)
      bgGrad.addColorStop(1, theme.bgOuter)
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // Parallax speed-streak field — the arena's living texture. Streaks lengthen
      // and align to the player's motion (idle = a slow ambient downward drift).
      if (bgStreaksRef.current.length === 0 && w > 0) {
        bgStreaksRef.current = Array.from({ length: 64 }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          depth: 0.4 + Math.random() * 1.2,
        }))
      }
      const pv = avgPlayerVelocity()
      const psp = Math.hypot(pv.vx, pv.vy)
      const dirx = psp > 6 ? -pv.vx / psp : 0
      const diry = psp > 6 ? -pv.vy / psp : 1
      const baseLen = 5 + Math.min(28, psp * 0.06)
      ctx.strokeStyle = withAlpha(palette.player, 0.05 + Math.min(0.16, psp * 0.0004))
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const st of bgStreaksRef.current) {
        const len = baseLen * st.depth
        ctx.moveTo(st.x, st.y)
        ctx.lineTo(st.x + dirx * len, st.y + diry * len)
      }
      ctx.stroke()

      // ===== CHALLENGE ARENA BOUNDARY (tiny-arena challenges) =====
      const chArena =
        propsRef.current.gameMode === 'challenge'
          ? challengeArena(w, h, propsRef.current.challenge, runStatsRef.current.elapsed)
          : null
      if (chArena) {
        ctx.strokeStyle = withAlpha(palette.hostile, 0.5)
        ctx.lineWidth = 2
        ctx.shadowColor = palette.hostile
        ctx.shadowBlur = 16
        ctx.strokeRect(chArena.x, chArena.y, chArena.width, chArena.height)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }

      ctx.save()
      ctx.translate(shake.x, shake.y)

      const player = playerRef.current!

      // ===== DRAW NORMAL MODE GOAL =====
      if (gameData.state === 'playing' && goalRef.current) {
        const goal = goalRef.current
        const pulse = (Math.sin(Date.now() / 260) + 1) / 2
        const glowSize = goal.radius + 7 + pulse * 3

        drawGlowCircle(goal.x, goal.y, glowSize, palette.orb, 20, 0.3)
        drawGradientPuck(goal.x, goal.y, goal.radius, palette.orb, palette.orbDeep)
      }

      // ===== DRAW SWEEP CHALLENGE GOALS =====
      if (gameData.state === 'playing' && sweepGoalsRef.current.length > 0) {
        const pulse = (Math.sin(Date.now() / 260) + 1) / 2
        for (const goal of sweepGoalsRef.current) {
          drawGlowCircle(goal.x, goal.y, goal.radius + 7 + pulse * 3, palette.orb, 20, 0.3)
          drawGradientPuck(goal.x, goal.y, goal.radius, palette.orb, palette.orbDeep)
        }
      }

      // ===== DRAW CATACLYSM GOALS =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        for (const goal of gameData.cataclysm.goals) {
          drawGlowCircle(goal.x, goal.y, goal.radius + 6, palette.orb, 15, 0.25)
          drawGradientPuck(goal.x, goal.y, goal.radius, palette.orb, palette.orbDeep)
        }
      }

      // ===== DRAW TUTORIAL GOALS =====
      if (props.gameMode === 'tutorial') {
        for (const goal of tutorialGoalsRef.current) {
          const pulse = (Math.sin(Date.now() / 260) + 1) / 2
          const glowSize = goal.radius + 7 + pulse * 3
          drawGlowCircle(goal.x, goal.y, glowSize, palette.orb, 20, 0.3)
          drawGradientPuck(goal.x, goal.y, goal.radius, palette.orb, palette.orbDeep)
        }
      }

      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        renderCataclysmEvent({ ctx, cat: gameData.cataclysm, player, width: w, height: h })
      }

      // ===== DRAW ENEMIES =====
      for (const enemy of enemiesRef.current) {
        drawGlowCircle(enemy.x, enemy.y, enemy.radius + 6, palette.hostile, 12, 0.2)
        drawGradientPuck(enemy.x, enemy.y, enemy.radius, palette.hostileLight, palette.hostile)
      }

      // ===== DRAW STATIC OBSTACLES (navigate hazards) =====
      if (obstaclesRef.current.length > 0) {
        const pulse = (Math.sin(Date.now() / 300) + 1) / 2
        for (const o of obstaclesRef.current) {
          drawGlowCircle(o.x, o.y, o.radius + 6 + pulse * 3, palette.hostile, 16, 0.24)
          drawGradientPuck(o.x, o.y, o.radius, palette.hostileLight, palette.hostile)
          ctx.strokeStyle = withAlpha(palette.hostileLight, 0.4 + pulse * 0.3)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(o.x, o.y, o.radius + 5, 0, Math.PI * 2)
          ctx.stroke()
          // Inner cross marks it as a fixed hazard, not a moving enemy
          ctx.strokeStyle = withAlpha(palette.void, 0.55)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(o.x - o.radius * 0.45, o.y)
          ctx.lineTo(o.x + o.radius * 0.45, o.y)
          ctx.moveTo(o.x, o.y - o.radius * 0.45)
          ctx.lineTo(o.x, o.y + o.radius * 0.45)
          ctx.stroke()
        }
      }

      if (gameData.state === 'cataclysm' && gameData.cataclysm?.eventEnemies) {
        for (const enemy of gameData.cataclysm.eventEnemies) {
          if (enemy.hue === 'purple') {
            const pulse = Math.sin(Date.now() / 160) * 0.35 + 0.65
            drawGlowCircle(enemy.x, enemy.y, enemy.radius + 8 + pulse * 4, palette.hunter, 18, 0.26)
            drawGradientPuck(enemy.x, enemy.y, enemy.radius, palette.hunterLight, palette.hunter)
            ctx.strokeStyle = withAlpha(palette.hunterLight, 0.35 + pulse * 0.35)
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(enemy.x, enemy.y, enemy.radius + 6, 0, Math.PI * 2)
            ctx.stroke()
          } else {
            drawGlowCircle(enemy.x, enemy.y, enemy.radius + 6, palette.hostile, 12, 0.2)
            drawGradientPuck(enemy.x, enemy.y, enemy.radius, palette.hostileLight, palette.hostile)
          }
        }
      }

      // ===== DRAW PARTICLES =====
      for (const p of particlesRef.current) {
        const alpha = p.life / 0.6
        ctx.fillStyle = withAlpha(p.color ?? palette.orb, alpha * 0.7)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }

      // Slot colors resolve against the live theme every frame: slot 0 is the
      // theme's player pair (exactly as before), slot 1 dodges it for contrast.
      const colorsForSlot = (slot: PlayerSlot): { body: string; light: string } =>
        slot.index === 0
          ? { body: palette.player, light: palette.playerLight }
          : pickP2Colors(palette.player)

      const trail = trailStyleRef.current
      playersRef.current.forEach((slot, i) => {
        const trailColor = colorsForSlot(slot).body
        for (const point of playerTrailRef.current[i] ?? []) {
          const alpha = Math.max(0, point.life / 0.42)
          ctx.fillStyle = withAlpha(trailColor, alpha * trail.opacity)
          ctx.beginPath()
          ctx.arc(point.x, point.y, point.radius * trail.width * (1.15 + (1 - alpha) * 0.8), 0, Math.PI * 2)
          ctx.fill()
        }
      })

      // ===== DRAW PLAYERS (velocity-reactive glow + squash/stretch) =====
      for (const slot of playersRef.current) {
        const colors = colorsForSlot(slot)
        const p = slot.puck

        // Co-op downed: pulsing hollow ring in the slot color + a thin arc
        // counting down the bleedout window — no body fill.
        if (mpVariantR === 'coop' && !slot.alive) {
          const pulse = (Math.sin(Date.now() / 220) + 1) / 2
          ctx.strokeStyle = withAlpha(colors.body, 0.35 + pulse * 0.45)
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 2 + pulse * 2, 0, Math.PI * 2)
          ctx.stroke()

          const downedAt = slot.downedAt ?? runStatsRef.current.elapsed
          const frac = Math.min(
            1,
            Math.max(0, (runStatsRef.current.elapsed - downedAt) / COOP_BLEEDOUT_SECONDS)
          )
          ctx.strokeStyle = withAlpha(palette.hostile, 0.85)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 9, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
          ctx.stroke()
          continue
        }

        const stunned =
          propsRef.current.gameMode === 'multiplayer' &&
          runStatsRef.current.elapsed < slot.stunnedUntil
        // Recover pop: fires the frame a stun expires — render-side detection
        // so it plays identically on host and guest with no wire data.
        if (propsRef.current.gameMode === 'multiplayer') {
          if (prevStunnedRef.current[slot.index] && !stunned) {
            spawnBurst(p.x, p.y, '#ffffff', 0.6)
          }
          prevStunnedRef.current[slot.index] = stunned
        }
        if (stunned) {
          // Ghosted while stunned, with a depleting white arc counting down
          // the stagger (mirrors the co-op bleedout arc).
          ctx.save()
          ctx.globalAlpha = 0.4
          drawPlayerBody(p, colors.body, colors.light)
          ctx.restore()
          const remaining = slot.stunnedUntil - runStatsRef.current.elapsed
          const frac = Math.min(1, Math.max(0, remaining / DUEL_STUN_SECONDS))
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
          ctx.stroke()
        } else {
          const isIt = mpVariantR === 'tag' && slot.isIt
          if (isIt) {
            // The "it" puck reads hostile: a stronger red glow behind it...
            drawGlowCircle(p.x, p.y, p.radius + 14, palette.hostile, 32, 0.3)
          }
          // I-frame flicker after a duel stagger or co-op revive. Tag is
          // excluded: it reuses immuneUntil as the swap cooldown and has its
          // own dashed-ring treatment.
          const immuneFlicker =
            mpVariantR !== null &&
            mpVariantR !== 'tag' &&
            runStatsRef.current.elapsed < slot.immuneUntil
          if (immuneFlicker) {
            ctx.save()
            ctx.globalAlpha = 0.55 + 0.45 * Math.sin(runStatsRef.current.elapsed * 30)
          }
          drawPlayerBody(p, colors.body, colors.light)
          if (immuneFlicker) ctx.restore()
          if (isIt) {
            // ...plus a red outer ring — dashed and dimmed during the
            // post-swap cooldown while tags can't land.
            const inCooldown = runStatsRef.current.elapsed < slot.immuneUntil
            ctx.save()
            if (inCooldown) ctx.setLineDash([5, 5])
            ctx.strokeStyle = withAlpha(palette.hostile, inCooldown ? 0.45 : 0.95)
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.radius + 7, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }
        }
      }

      ctx.restore()

      // ===== RENDER ORDER ===== 
      // 1. Background (cleared above)
      // 2. Border (canvas boundary)
      // 3. Goals and enemies and player (drawn above)
      // 4. Effects and particles (drawn above)
      // 5. Now draw boundary border at the end
      
      // ===== DRAW BOUNDARY INDICATOR WITH PROXIMITY-BASED GLOW =====
      // Compute distance to nearest edge — the closest living player counts
      // (with one slot this is exactly the old single-player computation).
      const proximityThreshold = 120 // px where warning starts
      let minDistToBoundary = Math.min(
        player.x - player.radius,
        player.y - player.radius,
        w - (player.x + player.radius),
        h - (player.y + player.radius)
      )
      if (propsRef.current.gameMode === 'multiplayer') {
        minDistToBoundary = Infinity
        for (const s of livingPlayers(playersRef.current)) {
          const p = s.puck
          minDistToBoundary = Math.min(
            minDistToBoundary,
            p.x - p.radius,
            p.y - p.radius,
            w - (p.x + p.radius),
            h - (p.y + p.radius)
          )
        }
      }

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

      if (
        (props.gameMode === 'survival' ||
          props.gameMode === 'tutorial' ||
          (props.gameMode === 'multiplayer' && mpVariantR !== 'tag')) &&
        dangerFactor > 0
      ) {
        // Amplify for survival, tutorial and multiplayer (walls stun in duel,
        // down in co-op); tag wraps like zen, so no warning there
        const of = Math.min(1, 0.15 + dangerFactor * 0.95)
        outerLine = 12 + dangerFactor * 16
        innerLine = 2 + dangerFactor * 6
        outerColor = withAlpha(palette.hostile, 0.6 * of)
        innerColor = withAlpha(palette.hostileLight, 0.45 + dangerFactor * 0.55)
        shadowColor = withAlpha(palette.hostile, 0.95)
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
        ctx.fillStyle = withAlpha(palette.hostile, collisionFlashRef.current * 0.3)
        ctx.fillRect(0, 0, w, h)
      }

      // ===== OPTIONAL: EVENT VIGNETTE (subtle intensity effect, survival + co-op) =====
      if (cataclysmsOn && gameData.state === 'cataclysm' && gameData.cataclysm) {
        const vignetteIntensity = 0.15
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.max(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8)
        gradient.addColorStop(0, `rgba(0, 0, 0, 0)`)
        gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteIntensity})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)

        // Urgency pulse: the whole screen throbs red in the final seconds.
        const tl = gameData.cataclysm.timeLeft
        if (tl > 0 && tl <= 5) {
          const pulse = (Math.sin(Date.now() / 140) + 1) / 2
          ctx.fillStyle = withAlpha(palette.hostile, (1 - tl / 5) * 0.16 * pulse)
          ctx.fillRect(0, 0, w, h)
        }
      }

      // ===== CATACLYSM EVENT - INTRO OVERLAY + TIMER (survival + co-op) =====
      if (cataclysmsOn && gameData.state === 'cataclysm' && gameData.cataclysm) {
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
          ctx.fillStyle = withAlpha(palette.panel, 0.9)
          ctx.fillRect(0, 0, w, h)
          ctx.restore()
          
          // Centered event title and objective
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          
          // Event name (large, bold, RED glow)
          ctx.fillStyle = palette.hostile
          ctx.font = `bold 56px ${FONT_GAME}`
          ctx.shadowColor = withAlpha(palette.hostile, 0.85)
          ctx.shadowBlur = 30
          ctx.fillText(cat.eventName, w / 2, h / 2 - 40)
          
          // Event objective (smaller, gray)
          const objective = getCataclysmObjective(cat.eventType)
          ctx.fillStyle = palette.muted
          ctx.font = `24px ${FONT_GAME}`
          ctx.shadowColor = withAlpha(palette.muted, 0.5)
          ctx.shadowBlur = 15
          ctx.fillText(objective, w / 2, h / 2 + 30)
          
          ctx.restore()
        
        // ===== CATACLYSM TIMER (After intro ends) =====
        } else {
          const timeLeft = Math.ceil(cat.timeLeft)
          
          // Color based on time remaining
          if (timeLeft > 10) {
            ctx.fillStyle = palette.white
            ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
          } else if (timeLeft > 5) {
            ctx.fillStyle = palette.warn
            ctx.shadowColor = withAlpha(palette.warn, 0.8)
          } else {
            ctx.fillStyle = palette.hostile
            ctx.shadowColor = withAlpha(palette.hostile, 1)
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

      // ===== CHALLENGE TIMER (time-bound challenges) =====
      // Mirrors the Cataclysm countdown so timed challenges surface the clock the
      // same way events do. Survive challenges count down their target; timed
      // collect challenges count down their deadline. Both escalate to red.
      if (
        props.gameMode === 'challenge' &&
        propsRef.current.challenge &&
        gameData.state === 'playing'
      ) {
        const ch = propsRef.current.challenge
        const limit = challengeTimeLimit(ch, w, h)
        if (limit > 0) {
          const secs = Math.max(0, Math.ceil(limit - runStatsRef.current.elapsed))

          // Color by urgency, matching the Cataclysm timer.
          if (secs > 10) {
            ctx.fillStyle = palette.white
            ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
          } else if (secs > 5) {
            ctx.fillStyle = palette.warn
            ctx.shadowColor = withAlpha(palette.warn, 0.8)
          } else {
            ctx.fillStyle = palette.hostile
            ctx.shadowColor = withAlpha(palette.hostile, 1)
          }

          ctx.font = `bold 48px ${FONT_GAME}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.shadowBlur = 20

          // Subtle pulse in the final seconds.
          let scaleOffset = 1
          if (secs <= 5) {
            const pulsePhase = (Date.now() % 400) / 400
            scaleOffset = 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.05
          }

          ctx.save()
          ctx.translate(w / 2, 40)
          ctx.scale(scaleOffset, scaleOffset)
          ctx.translate(-w / 2, -40)
          ctx.fillText(`${secs}s`, w / 2, 40)
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
              fillStyle: withAlpha(palette.hostile, 0.95),
              strokeStyle: withAlpha(palette.hostileLight, 0.8),
              textColor: palette.white,
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
            ctx.fillStyle = withAlpha(palette.panel, 0.85)
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
      // Survival + challenge deaths are handled by the React end screen, and
      // multiplayer matches by the page's VersusEndScreen; only fall back to
      // the canvas overlay for any other mode.
      if (
        gameData.state === 'gameOver' &&
        props.gameMode !== 'survival' &&
        props.gameMode !== 'challenge' &&
        props.gameMode !== 'multiplayer'
      ) {
        drawArcadeGameOverOverlay(ctx, w, h, {
          title: 'GAME OVER',
          middle: `Score: ${gameData.score}`,
          hint: 'Press SPACE to restart',
        })
      }

      // Leave host-arena coordinate space before local-space overlays.
      if (guestTransformed) ctx.restore()

      // ===== ONLINE GUEST: STALL RIBBON =====
      // Snapshots stopped arriving mid-match — surface it in the same
      // mono/terminal style as the cataclysm timer. Suppressed while paused.
      if (
        props.netRole === 'guest' &&
        props.net &&
        props.uiState === 'playing' &&
        !props.isPaused &&
        snapshotBufferRef.current.isStalled(performance.now())
      ) {
        const text = 'CONNECTION UNSTABLE — waiting for host…'
        ctx.save()
        ctx.font = `bold 13px ${FONT_GAME}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const textW = ctx.measureText(text).width
        const boxW = Math.min(localW - 16, textW + 36)
        const boxH = 30
        const boxX = (localW - boxW) / 2
        const boxY = 10
        ctx.fillStyle = withAlpha(palette.panel, 0.88)
        ctx.strokeStyle = withAlpha(palette.warn, 0.8)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(boxX, boxY, boxW, boxH, 8)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = palette.warn
        ctx.shadowColor = withAlpha(palette.warn, 0.6)
        ctx.shadowBlur = 10
        ctx.fillText(text, localW / 2, boxY + boxH / 2 + 1)
        ctx.restore()
      }
    }

    function loop(now: number) {
      if (!lastRef.current) lastRef.current = now
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now

      const capped = Math.min(dt, 0.05)
      const net = props.net
      if (props.netRole === 'guest' && net) {
        // Online guest: NO simulation. Interpolated host snapshots become the
        // world; only local cosmetic effects (particles/trails/streaks)
        // advance. Snapshots also apply while paused so the world never
        // desyncs across a pause; the intro-banner clock (dt) freezes.
        const active = props.uiState === 'playing' && !props.isPaused
        if (props.uiState === 'playing' || props.uiState === 'paused') {
          applySnapshotState(active ? capped : 0)
        }
        if (active) {
          const arena = latestSnapRef.current?.arena
          updateEffects(
            capped,
            arena?.w ?? canvasWidthRef.current,
            arena?.h ?? canvasHeightRef.current
          )
        }
        sendGuestInput(net, now)
      } else {
        update(capped)
        // Online host: broadcast while a match is in progress — including
        // paused, so the guest's buffer never reads as stalled mid-match.
        if (
          props.netRole === 'host' &&
          net &&
          (props.uiState === 'playing' || props.uiState === 'paused')
        ) {
          maybeBroadcastSnapshot(net, capped * 1000)
        }
      }
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
