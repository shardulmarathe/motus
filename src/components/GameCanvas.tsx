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
import { FONT_DATA } from '../lib/fonts'
import { palette, withAlpha } from '../lib/palette'
import { recordSpeed, resetTelemetry, runSeries } from '../lib/telemetry'
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
 * Hunters are additional to `enemyCount`, not carved out of it, the par model
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
 * Lethal hazards for navigate/minefield challenges, placed clear of the
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
 * mine, where collecting it costs the run, and on a sweep, where the whole set
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

/**
 * The active render palette. Themes rebuild this object per run (see
 * `resolveActiveTheme`), so every canvas-text helper takes it rather than
 * closing over the module import, two of the eight themes print dark marks on
 * light stock and nothing here may assume a dark field.
 */
type Pal = typeof palette

/** Corner radius for every instrument panel. Panels are cut, not rounded. */
const PANEL_RADIUS = 2

const TAU = Math.PI * 2

/**
 * The bullseye's dial face. A target is a *graduated* mark, two concentric
 * rings, a solid centre, and a scale of graduations around the outside, the way
 * a range finder or a dial gauge is ruled. The unit vectors are precomputed
 * once at module load; the ring rotates by transforming the context, so nothing
 * here is recalculated per target per frame.
 */
// 16 graduations, majors every fourth. 24 was tried first and at an orb's
// actual radius it closed into a sunburst; 16 keeps ~7px between marks, which
// is the point at which a scale still reads as a scale.
const BULLSEYE_TICK_COUNT = 16
const BULLSEYE_TICKS: { c: number; s: number; major: boolean }[] = Array.from(
  { length: BULLSEYE_TICK_COUNT },
  (_, i) => {
    const a = (i / BULLSEYE_TICK_COUNT) * TAU
    return { c: Math.cos(a), s: Math.sin(a), major: i % 4 === 0 }
  }
)
/** One revolution of the graduation scale, in ms. Slow, a settling instrument. */
const BULLSEYE_SPIN_MS = 14000

/**
 * `withAlpha` only parses hex. Theme background values are authored as `rgba()`
 * strings, and on light-stock themes those doubles as the panel/wash color, so
 * overlays need an alpha helper that accepts either form.
 */
function withAlphaAny(color: string, alpha: number): string {
  if (color.startsWith('#')) return withAlpha(color, alpha)
  const m = /rgba?\(([^)]+)\)/.exec(color)
  if (!m) return color
  const parts = m[1].split(',').map((s) => s.trim())
  if (parts.length < 3) return color
  const base = parts.length > 3 ? parseFloat(parts[3]) : 1
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${base * alpha})`
}

/**
 * Mono text with manual tracking. `ctx.letterSpacing` is not in lib.dom and is
 * unevenly supported, so wide-tracked control-panel labels are drawn per glyph.
 * Only used for short overlay headings, never in the hot entity loop.
 */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number
) {
  const widths: number[] = []
  let total = 0
  for (const ch of text) {
    const cw = ctx.measureText(ch).width
    widths.push(cw)
    total += cw + spacing
  }
  total -= spacing
  const prevAlign = ctx.textAlign
  ctx.textAlign = 'left'
  let x = cx - total / 2
  let i = 0
  for (const ch of text) {
    ctx.fillText(ch, x, y)
    x += widths[i++] + spacing
  }
  ctx.textAlign = prevAlign
}

/**
 * Flat instrument panel: `panel` fill, 1px hairline border, ~2px corners, no
 * bloom. Every canvas card in the arena is built from this.
 */
function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  border: string,
  borderWidth = 1
) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h), PANEL_RADIUS)
  ctx.fill()
  ctx.strokeStyle = border
  ctx.lineWidth = borderWidth
  ctx.stroke()
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
    /** Optional wide-tracked label stamped above the body copy. */
    label?: string
    labelColor?: string
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
    label,
    labelColor,
    globalAlpha = 1,
  } = options

  const labelBlock = label ? 20 : 0
  const boxHeight = paddingY * 2 + labelBlock + lines.length * lineHeight
  const boxX = (w - boxWidth) / 2
  const boxY = (h - boxHeight) / 2

  ctx.save()
  ctx.globalAlpha = globalAlpha
  drawPanel(ctx, boxX, boxY, boxWidth, boxHeight, fillStyle, strokeStyle)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (label) {
    ctx.fillStyle = labelColor ?? textColor
    ctx.font = `500 10px ${FONT_DATA}`
    drawTrackedText(ctx, label, w / 2, boxY + paddingY + 4, 2.6)
  }

  ctx.fillStyle = textColor
  ctx.font = `400 ${fontSize}px ${FONT_DATA}`
  const startY = boxY + paddingY + labelBlock + lineHeight / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, w / 2, startY + index * lineHeight)
  })

  ctx.restore()
  return { boxX, boxY, boxHeight }
}

/** Instrument panel carrying a tutorial step's instruction. */
function drawInstructionCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  stepLabel: string,
  lines: string[],
  pal: Pal,
  options: { boxWidth: number; globalAlpha: number; topOffset?: number }
) {
  const boxWidth = options.boxWidth
  const padTop = 20
  const padBottom = 22
  const titleBlock = 30
  const bodyFontSize = 14
  const bodyLineHeight = Math.round(bodyFontSize * 1.7)
  const bodyHeight = lines.length * bodyLineHeight
  const boxHeight = padTop + titleBlock + bodyHeight + padBottom
  const boxX = (w - boxWidth) / 2
  const boxY = options.topOffset ?? 48

  ctx.save()
  ctx.globalAlpha = options.globalAlpha

  drawPanel(ctx, boxX, boxY, boxWidth, boxHeight, pal.panel, withAlpha(pal.ink, 0.5))

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Step label, wide-tracked mono caps, the control-panel register.
  ctx.fillStyle = pal.player
  ctx.font = `500 11px ${FONT_DATA}`
  drawTrackedText(ctx, stepLabel.toUpperCase(), w / 2, boxY + padTop + 6, 3)

  // Hairline rule between label and body.
  const ruleY = Math.round(boxY + padTop + titleBlock - 8) + 0.5
  ctx.strokeStyle = withAlpha(pal.ink, 0.18)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(boxX + 16, ruleY)
  ctx.lineTo(boxX + boxWidth - 16, ruleY)
  ctx.stroke()

  ctx.fillStyle = pal.text
  ctx.font = `400 ${bodyFontSize}px ${FONT_DATA}`
  const textStartY = boxY + padTop + titleBlock + bodyLineHeight / 2
  lines.forEach((line, index) => {
    ctx.fillText(line, w / 2, textStartY + index * bodyLineHeight)
  })

  ctx.restore()
}

/**
 * Run-terminated panel (tutorial death, and the fallback game-over for modes
 * without a React end screen). A readout, not a marquee: flat panel, hairline
 * border, mono throughout.
 */
function drawArcadeGameOverOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pal: Pal,
  config: {
    title: string
    middle: string
    hint: string
  }
) {
  ctx.save()
  ctx.fillStyle = withAlphaAny(pal.void, 0.86)
  ctx.fillRect(0, 0, w, h)

  const boxWidth = Math.min(420, Math.max(220, w - 64))
  const boxHeight = 148
  const boxX = (w - boxWidth) / 2
  const boxY = (h - boxHeight) / 2
  drawPanel(ctx, boxX, boxY, boxWidth, boxHeight, pal.panel, withAlpha(pal.ink, 0.55))

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Vermilion status line, the only alarm color on the panel.
  ctx.fillStyle = pal.hostile
  ctx.font = `600 15px ${FONT_DATA}`
  drawTrackedText(ctx, config.title.toUpperCase(), w / 2, boxY + 34, 4)

  const ruleY = Math.round(boxY + 54) + 0.5
  ctx.strokeStyle = withAlpha(pal.ink, 0.18)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(boxX + 18, ruleY)
  ctx.lineTo(boxX + boxWidth - 18, ruleY)
  ctx.stroke()

  ctx.fillStyle = pal.ink
  ctx.font = `500 22px ${FONT_DATA}`
  ctx.fillText(config.middle, w / 2, boxY + 84)

  ctx.fillStyle = pal.muted
  ctx.font = `400 11px ${FONT_DATA}`
  drawTrackedText(ctx, config.hint.toUpperCase(), w / 2, boxY + boxHeight - 26, 1.6)

  ctx.restore()
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
  /** Honors prefers-reduced-motion for every instrument animation added below. */
  const reducedMotionRef = useRef(false)
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
  /** GUEST: newest raw snapshot, source of the host sim clock + arena dims. */
  const latestSnapRef = useRef<SnapMsg | null>(null)
  const snapSeqRef = useRef(0) // HOST: outgoing snapshot sequence
  const snapAccumMsRef = useRef(0) // HOST: ms accumulated toward the next snapshot
  const inputSeqRef = useRef(0) // GUEST: outgoing input sequence
  const lastInputMaskRef = useRef(-1) // GUEST: last sent key bitmask
  const lastInputSentAtRef = useRef(0) // GUEST: performance.now() of last input send
  /** GUEST: previously applied goals + score sum, to spot pickups and burst. */
  const prevGuestGoalsRef = useRef<Goal[]>([])
  const prevGuestScoreRef = useRef(0)
  /** GUEST: false until the first snapshot lands, mutes join/rematch FX. */
  const firstSnapAppliedRef = useRef(false)

  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    uiStateRef.current = props.uiState
  }, [props.uiState])

  // Reduced motion: sweeps, pulses and scan rules settle to a static reading.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const onChange = () => {
      reducedMotionRef.current = mq.matches
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

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
      // The run's own speed trace, the end screen plots it and marks the
      // point the run stopped.
      speedSamples: runSeries(),
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
        makeSlot(p2, 1, P2_KEYS, pickP2Colors(pal.player, themeRef.current.luminous)),
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
        // Tag: no enemies, no orbs, no obstacles, just two pucks. One slot
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
        // Duel: a fixed roster of linear red enemies (no stage scaling, stage
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
    // The speed trace is run-scoped too: a restart starts a fresh chart.
    resetTelemetry()
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
    const particleCount = 8
    // Both rates are per SECOND and integrated with dt. They used to be applied
    // per frame, which made the spiral grow larger on a high-refresh display
    // than on a 60Hz one.
    const rotationSpeed = 4.8 // rad/s
    const radiusGrowth = 72 * scale // px/s, `scale` reaches the spiral now

    for (let i = 0; i < particleCount; i++) {
      const baseAngle = (i / particleCount) * Math.PI * 2

      particlesRef.current.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.8,
        centerX: x,
        centerY: y,
        angle: baseAngle,
        currentRadius: 0,
        rotationSpeed,
        radiusGrowth,
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
    // Mount-only by design: the listeners read live state through refs, so
    // re-running this would only churn window listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      /** Co-op: a slot goes down, frozen in place, bleedout clock running. */
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
              // so this is unreachable, swaps happen on puck-vs-puck contact.
              return
            case 'duel':
            default: {
              if (cause === 'wall') {
                // Walls don't stun, they're elastic. Reflect the crossed axis
                // (position not yet clamped, so the overshoot tells us which),
                // bleed some energy, and spark.
                if (p.x - p.radius < 0 || p.x + p.radius > w) p.vx = -p.vx * WALL_BOUNCE_DAMPING
                if (p.y - p.radius < 0 || p.y + p.radius > h) p.vy = -p.vy * WALL_BOUNCE_DAMPING
                clampToBounds(p, w, h)
                spawnBurst(p.x, p.y, themeRef.current.palette.ink, 0.6)
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
          // Tag: the "it" puck is buffed, faster acceleration, higher cap.
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

      // Feed the shared speed trace, the HUD strip chart, the arena trail and
      // the end-screen plot are all this one channel. Runs unconditionally so a
      // stalled or frozen puck still plots a flat line rather than a gap.
      recordSpeed(Math.hypot(player.vx, player.vy), dt)

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
            // Timed collect goal expired without finishing, a loss.
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
            // First to the target wins, end the match exactly once.
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
              // Respawns dodge the hazards too, a mid-run orb landing on a mine
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
        // Downed co-op pucks are already dead-ish, enemies pass through them.
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
            // Revived on touch: brief immunity, velocity stays frozen, the
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

      updateEffects(dt)
    }

    /**
     * Purely-cosmetic per-frame systems shared by the local sim and the
     * online guest (which runs no sim but still animates these): particle
     * motion, trail decay, shake/flash decay.
     *
     * The measurement field that replaced the parallax streaks is static, it
     * is graph paper, not weather, so it needs no per-frame update.
     */
    function updateEffects(dt: number) {
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i]

        // Handle spiral motion for burst particles
        if (p.angle !== undefined && p.currentRadius !== undefined && p.centerX !== undefined && p.centerY !== undefined) {
          // Update spiral motion
          p.angle += (p.rotationSpeed ?? 4.8) * dt
          p.currentRadius += (p.radiusGrowth ?? 72) * dt

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
      // the same enemies list, the guest re-splits them by hue for styling.
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
        // (the guest buffer dedups frozen timestamps, which is fine, paused
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
     * GUEST: no sim, pour the interpolated snapshot into the same refs
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
            // Tag passed to this slot (fire once, only for the newly-"it" side).
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

        // Trails don't travel over the wire, regrow them from sampled motion
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

    // ===== RENDERING: THE INSTRUMENT =====
    //
    // Everything on the field is either the specimen (player, targets, hazards)
    // or the instrumentation reading it (ticks, rules, traces, labels).
    // The governing rule is THE MARK IS THE SIGNAL. `shadowBlur` appears in
    // exactly one place in this file and is gated strictly on
    // `theme.luminous`, the printed instruments (Thermal, Plotter, Blackline)
    // have no light to spend, so on those the specimen earns its presence from
    // stroke weight and a double-struck contour instead of a halo. Every value
    // below that differs between the two media reads that same flag; nothing is
    // hardcoded for one chassis.

    /**
     * Diagonal hatch fill, cached per color. Hazards are hollow shapes filled
     * with a screen, the mark of an annotated danger zone on a chart, and a
     * pattern keeps that cheap: one small tile reused by every hazard on screen,
     * instead of a clip + line loop per entity per frame.
     *
     * The tile carries ONE diagonal per period, so the hatch reads as ruled pen
     * strokes (~3.5px apart) rather than the near-solid tint the old two-line
     * tile produced. It is rasterized at device resolution and scaled back down
     * by the pattern transform, because a hairline hatch blurred across a 2x
     * canvas is exactly the mush that made red-on-paper look like a smudge.
     */
    const HATCH_TILE = 5
    const hatchCache = new Map<string, CanvasPattern | null>()
    const hatchFor = (color: string): CanvasPattern | null => {
      const hit = hatchCache.get(color)
      if (hit !== undefined) return hit
      let pattern: CanvasPattern | null = null
      if (typeof document !== 'undefined') {
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
        const tile = document.createElement('canvas')
        tile.width = Math.round(HATCH_TILE * dpr)
        tile.height = Math.round(HATCH_TILE * dpr)
        const tctx = tile.getContext('2d')
        if (tctx) {
          tctx.scale(dpr, dpr)
          tctx.strokeStyle = color
          tctx.lineWidth = 1
          tctx.lineCap = 'square'
          // x + y = TILE/2, extended past both corners so adjacent tiles join.
          const c = HATCH_TILE / 2
          tctx.beginPath()
          tctx.moveTo(-HATCH_TILE, c + HATCH_TILE)
          tctx.lineTo(c + HATCH_TILE, -HATCH_TILE)
          tctx.stroke()
          pattern = ctx.createPattern(tile, 'repeat')
          if (pattern && typeof DOMMatrix !== 'undefined') {
            pattern.setTransform(new DOMMatrix().scaleSelf(1 / dpr, 1 / dpr))
          }
        }
      }
      hatchCache.set(color, pattern)
      return pattern
    }

    /** Diamond path, the moving-hazard silhouette. */
    const diamondPath = (x: number, y: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
    }

    /**
     * A hazard mark: hollow outline over a hatched screen. `square` is the
     * fixed-hazard silhouette, `diamond` the moving one, neither reads as the
     * ring-and-ticks of a target or the solid disc of a player. Silhouette, not
     * hue, carries the safety-critical distinction (amber vs vermilion is a
     * weak protan/deutan pair).
     */
    const drawHazardMark = (
      x: number,
      y: number,
      r: number,
      color: string,
      shape: 'diamond' | 'square',
      emphasis = 1
    ) => {
      // Incircle == the collision radius, so the mark never reads smaller than
      // the thing that kills you.
      const half = shape === 'diamond' ? r * Math.SQRT2 : r
      if (shape === 'diamond') diamondPath(x, y, half)
      else {
        ctx.beginPath()
        ctx.rect(x - half, y - half, half * 2, half * 2)
      }

      // Print media has no bloom to spend, so the hazard buys its weight in
      // pen: a denser hatch and a heavier outline than a lit instrument needs.
      const paper = !themeRef.current.luminous
      const hatch = hatchFor(withAlpha(color, (paper ? 0.9 : 0.62) * emphasis))
      if (hatch) {
        ctx.fillStyle = hatch
        ctx.fill()
      } else {
        ctx.fillStyle = withAlpha(color, 0.18 * emphasis)
        ctx.fill()
      }

      ctx.strokeStyle = withAlpha(color, (paper ? 1 : 0.9) * emphasis)
      ctx.lineWidth = paper ? 1.75 : 1.5
      ctx.stroke()
    }

    /**
     * The specimen. A solid disc of the signal pen, no gradient body, no
     * specular highlight, plus a velocity vector whose length is speed.
     * Momentum is the only input, so the renderer draws it.
     *
     * On a printed instrument the mark cannot glow, so it is given WEIGHT
     * instead: the pen goes round the disc a second time (a hard-struck
     * contour) and lays a registration ring just outside it. Both are drawn
     * lines, not halos, the mark stays a mark, and it still finds the eye
     * instantly against stock.
     *
     * `hollow` is P2's silhouette in multiplayer: an annulus against P1's solid
     * disc, so the two players separate without a sixth hue.
     */
    const drawPlayerBody = (p: Puck, body: string, hollow = false) => {
      const luminous = themeRef.current.luminous
      const pSpeed = Math.hypot(p.vx, p.vy)
      const speedT = Math.min(1, pSpeed / 500)

      // ── Velocity vector: the reading this whole instrument exists to take.
      if (pSpeed > 24) {
        const ux = p.vx / pSpeed
        const uy = p.vy / pSpeed
        const from = p.radius + 3
        const to = p.radius + 6 + speedT * 44
        const hx = p.x + ux * to
        const hy = p.y + uy * to
        ctx.strokeStyle = withAlpha(body, 0.45 + speedT * 0.5)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(p.x + ux * from, p.y + uy * from)
        ctx.lineTo(hx, hy)
        // Cross-tick at the head, a cursor on a scale, not an arrowhead.
        ctx.moveTo(hx - uy * 3.5, hy + ux * 3.5)
        ctx.lineTo(hx + uy * 3.5, hy - ux * 3.5)
        ctx.stroke()
      }

      ctx.save()
      // Squash/stretch survives: it still reads as mass resisting a direction
      // change, which is the thing being measured.
      if (pSpeed > 30) {
        const ang = Math.atan2(p.vy, p.vx)
        const stretch = speedT * 0.16
        ctx.translate(p.x, p.y)
        ctx.rotate(ang)
        ctx.scale(1 + stretch, 1 - stretch)
        ctx.rotate(-ang)
        ctx.translate(-p.x, -p.y)
      }

      // The one permitted bloom in the whole renderer, and only on a tube. On a
      // printed instrument this branch never runs.
      if (luminous) {
        ctx.shadowColor = body
        ctx.shadowBlur = 8 + speedT * 8
      }
      ctx.fillStyle = body
      if (hollow) {
        // Annulus: outer disc minus a punched center, drawn as one even-odd
        // path so the hole is transparent rather than filled with a guess at
        // the background color (which light-stock themes would get wrong).
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, TAU)
        ctx.arc(p.x, p.y, p.radius * 0.46, 0, TAU, true)
        ctx.fill('evenodd')
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, TAU)
        ctx.fill()
      }

      if (!luminous) {
        // Double-struck contour: the pen retraces the edge, so the mark ends
        // ~1px larger with a hard, dense boundary instead of a soft one.
        ctx.shadowBlur = 0
        ctx.strokeStyle = body
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, TAU)
        if (hollow) {
          ctx.moveTo(p.x + p.radius * 0.46, p.y)
          ctx.arc(p.x, p.y, p.radius * 0.46, 0, TAU)
        }
        ctx.stroke()

        // Registration ring: a separate hairline standing off the body, which
        // is how a plotter says "this mark is the subject" without a halo. It
        // presses harder the faster the specimen is travelling.
        ctx.strokeStyle = withAlpha(body, 0.42 + speedT * 0.28)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius + 3.5, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }

    /**
     * A target is a graduated mark, not a lamp: two concentric rings, a solid
     * centre, and a scale of 24 graduations ruled around the outside (majors
     * every sixth), like the face of a dial gauge or a range finder.
     *
     * The scale turns slowly, the instrument hunting for a reading, and
     * `lock` (0..1, driven by player proximity) TIGHTENS the rings toward the
     * centre as the specimen closes, so acquisition is read from geometry
     * rather than brightness. Nothing here glows on either medium.
     *
     * Cost: the graduations are one batched path and their unit vectors are
     * precomputed at module load, so a target is three draw calls flat -
     * cheap enough for the seven-goal cataclysms.
     */
    const drawBullseye = (x: number, y: number, r: number, color: string, lock: number) => {
      // Rings close in on approach; the outer never shrinks past the inner.
      const outer = r * (0.98 - lock * 0.13)
      const inner = r * (0.6 - lock * 0.17)
      const dot = Math.max(1.6, r * (0.19 + lock * 0.07))

      ctx.save()
      ctx.translate(x, y)
      if (!reducedMotionRef.current) {
        ctx.rotate(((Date.now() % BULLSEYE_SPIN_MS) / BULLSEYE_SPIN_MS) * TAU)
      }

      // ── The graduation scale, batched into one path.
      const base = outer + 3
      ctx.strokeStyle = withAlpha(color, 0.45 + lock * 0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const t of BULLSEYE_TICKS) {
        const end = base + (t.major ? 5 : 2.5)
        ctx.moveTo(t.c * base, t.s * base)
        ctx.lineTo(t.c * end, t.s * end)
      }
      ctx.stroke()

      // ── Two concentric rings, one path. They carry the silhouette, so they
      // are struck heavier than the scale around them.
      ctx.strokeStyle = withAlpha(color, 0.8 + lock * 0.2)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(0, 0, outer, 0, TAU)
      ctx.moveTo(inner, 0)
      ctx.arc(0, 0, inner, 0, TAU)
      ctx.stroke()

      // ── The centre: a hard press of the pen.
      ctx.fillStyle = withAlpha(color, 0.88 + lock * 0.12)
      ctx.beginPath()
      ctx.arc(0, 0, dot, 0, TAU)
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

      // Chassis roles (`panel`, `void`, `muted`, `warn`) now come off the
      // resolved theme itself, `resolveActiveTheme` maps them to the
      // instrument's own sheet, stock and secondary pen, so overlays read
      // straight off `palette` on every medium. The old per-frame re-derivation
      // is gone.

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

      // ===== THE MEASUREMENT FIELD =====
      // Flat ground, then graph paper: crosses at the grid intersections and a
      // stepped graduation along the edges. Static and quiet, the field is the
      // paper the run is drawn on, not weather. Everything batches into two
      // paths, so the cost is two strokes per frame regardless of arena size.
      ctx.fillStyle = theme.bgOuter
      ctx.fillRect(0, 0, w, h)

      const GRID = 80
      const MINOR = 20
      const CROSS = 2.5

      // Interior intersection crosses.
      ctx.strokeStyle = theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let gx = GRID; gx < w; gx += GRID) {
        const x = Math.round(gx) + 0.5
        for (let gy = GRID; gy < h; gy += GRID) {
          const y = Math.round(gy) + 0.5
          ctx.moveTo(x - CROSS, y)
          ctx.lineTo(x + CROSS, y)
          ctx.moveTo(x, y - CROSS)
          ctx.lineTo(x, y + CROSS)
        }
      }
      ctx.stroke()

      // Minor graduation stepping in from each edge. 0.07 was a legible ghost
      // on a black field; against stock it disappeared, so the edge scale is
      // printed at a value that actually survives paper.
      ctx.strokeStyle = withAlpha(palette.ink, theme.luminous ? 0.09 : 0.14)
      ctx.beginPath()
      for (let gx = MINOR; gx < w; gx += MINOR) {
        const x = Math.round(gx) + 0.5
        ctx.moveTo(x, 0); ctx.lineTo(x, 4)
        ctx.moveTo(x, h); ctx.lineTo(x, h - 4)
      }
      for (let gy = MINOR; gy < h; gy += MINOR) {
        const y = Math.round(gy) + 0.5
        ctx.moveTo(0, y); ctx.lineTo(4, y)
        ctx.moveTo(w, y); ctx.lineTo(w - 4, y)
      }
      ctx.stroke()

      // ===== CHALLENGE ARENA LIMIT (tiny-arena challenges) =====
      // A ruled limit with corner brackets, the same language as the
      // cataclysm's closing arena, and lethal for the same reason.
      const chArena =
        propsRef.current.gameMode === 'challenge'
          ? challengeArena(w, h, propsRef.current.challenge, runStatsRef.current.elapsed)
          : null
      if (chArena) {
        const ax = Math.round(chArena.x) + 0.5
        const ay = Math.round(chArena.y) + 0.5
        const ax2 = Math.round(chArena.x + chArena.width) - 0.5
        const ay2 = Math.round(chArena.y + chArena.height) - 0.5
        ctx.strokeStyle = withAlpha(palette.hostile, 0.9)
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.rect(ax, ay, ax2 - ax, ay2 - ay)
        ctx.stroke()

        const arm = 16
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(ax, ay + arm); ctx.lineTo(ax, ay); ctx.lineTo(ax + arm, ay)
        ctx.moveTo(ax2 - arm, ay); ctx.lineTo(ax2, ay); ctx.lineTo(ax2, ay + arm)
        ctx.moveTo(ax2, ay2 - arm); ctx.lineTo(ax2, ay2); ctx.lineTo(ax2 - arm, ay2)
        ctx.moveTo(ax + arm, ay2); ctx.lineTo(ax, ay2); ctx.lineTo(ax, ay2 - arm)
        ctx.stroke()
      }

      ctx.save()
      ctx.translate(shake.x, shake.y)

      const player = playerRef.current!

      // Acquisition cue: how locked-on a target is, from the distance to the
      // nearest puck that can still collect it. Single-player this is simply
      // the player.
      const LOCK_RANGE = 150
      const lockAt = (x: number, y: number) => {
        let best = Infinity
        for (const s of playersRef.current) {
          if (!s.alive) continue
          best = Math.min(best, Math.hypot(s.puck.x - x, s.puck.y - y))
        }
        if (!Number.isFinite(best)) best = Math.hypot(player.x - x, player.y - y)
        const t = Math.max(0, Math.min(1, 1 - best / LOCK_RANGE))
        return t * t
      }

      // ===== DRAW NORMAL MODE GOAL =====
      if (gameData.state === 'playing' && goalRef.current) {
        const goal = goalRef.current
        drawBullseye(goal.x, goal.y, goal.radius, palette.orb, lockAt(goal.x, goal.y))
      }

      // ===== DRAW SWEEP CHALLENGE GOALS =====
      if (gameData.state === 'playing' && sweepGoalsRef.current.length > 0) {
        for (const goal of sweepGoalsRef.current) {
          drawBullseye(goal.x, goal.y, goal.radius, palette.orb, lockAt(goal.x, goal.y))
        }
      }

      // ===== DRAW CATACLYSM GOALS =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        for (const goal of gameData.cataclysm.goals) {
          drawBullseye(goal.x, goal.y, goal.radius, palette.orb, lockAt(goal.x, goal.y))
        }
      }

      // ===== DRAW TUTORIAL GOALS =====
      if (props.gameMode === 'tutorial') {
        for (const goal of tutorialGoalsRef.current) {
          drawBullseye(goal.x, goal.y, goal.radius, palette.orb, lockAt(goal.x, goal.y))
        }
      }

      if (gameData.state === 'cataclysm' && gameData.cataclysm) {
        renderCataclysmEvent({
          ctx,
          cat: gameData.cataclysm,
          player,
          width: w,
          height: h,
          // Event marks draw in the run's own pens, and the blackout mask needs
          // to know which value counts as "dark" on this medium.
          pal: palette,
          luminous: theme.luminous,
        })
      }

      // ===== DRAW ENEMIES (moving hazard: hatched diamond) =====
      for (const enemy of enemiesRef.current) {
        drawHazardMark(enemy.x, enemy.y, enemy.radius, palette.hostile, 'diamond')
      }

      // ===== DRAW STATIC OBSTACLES (fixed hazard: hatched square) =====
      // Rectilinear and axis-aligned so it reads as bolted down, against the
      // enemies' diamonds. Corner ticks are the surveyor's mark for a fixed
      // point, they replace the old pulsing glow ring.
      if (obstaclesRef.current.length > 0) {
        for (const o of obstaclesRef.current) {
          drawHazardMark(o.x, o.y, o.radius, palette.hostile, 'square')
          const c = o.radius + 4
          const arm = 4
          ctx.strokeStyle = withAlpha(palette.hostile, 0.6)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(o.x - c, o.y - c + arm); ctx.lineTo(o.x - c, o.y - c); ctx.lineTo(o.x - c + arm, o.y - c)
          ctx.moveTo(o.x + c - arm, o.y - c); ctx.lineTo(o.x + c, o.y - c); ctx.lineTo(o.x + c, o.y - c + arm)
          ctx.moveTo(o.x + c, o.y + c - arm); ctx.lineTo(o.x + c, o.y + c); ctx.lineTo(o.x + c - arm, o.y + c)
          ctx.moveTo(o.x - c + arm, o.y + c); ctx.lineTo(o.x - c, o.y + c); ctx.lineTo(o.x - c, o.y + c - arm)
          ctx.stroke()
        }
      }

      // ===== DRAW EVENT ENEMIES (hunters carry a pursuit annotation) =====
      if (gameData.state === 'cataclysm' && gameData.cataclysm?.eventEnemies) {
        // Hunters share the hazard hue on purpose. What separates them is the
        // annotation: a dashed pursuit ring and a lead line pointing at whom
        // they are tracking.
        const dashOffset = reducedMotionRef.current ? 0 : (Date.now() / 90) % 12
        for (const enemy of gameData.cataclysm.eventEnemies) {
          drawHazardMark(enemy.x, enemy.y, enemy.radius, palette.hostile, 'diamond')
          if (enemy.hue !== 'purple') continue

          const target = nearestLivingPlayer(playersRef.current, enemy.x, enemy.y)
          ctx.save()
          ctx.setLineDash([3, 4])
          ctx.lineDashOffset = -dashOffset
          ctx.strokeStyle = withAlpha(palette.hunter, 0.7)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(enemy.x, enemy.y, enemy.radius + 8, 0, Math.PI * 2)
          ctx.stroke()

          const dx = target.x - enemy.x
          const dy = target.y - enemy.y
          const d = Math.hypot(dx, dy)
          if (d > 1) {
            const lead = Math.min(d - enemy.radius - 4, 52)
            if (lead > 0) {
              const ux = dx / d
              const uy = dy / d
              ctx.strokeStyle = withAlpha(palette.hunter, 0.5)
              ctx.beginPath()
              ctx.moveTo(enemy.x + ux * (enemy.radius + 9), enemy.y + uy * (enemy.radius + 9))
              ctx.lineTo(enemy.x + ux * (enemy.radius + 9 + lead), enemy.y + uy * (enemy.radius + 9 + lead))
              ctx.stroke()
            }
          }
          ctx.restore()
        }
      }

      // ===== DRAW PARTICLES =====
      // Radial tick marks rather than glowing dots, a burst is a scatter of
      // marks thrown off the impact, drawn in the same pen as everything else.
      ctx.lineWidth = 1.4
      for (const p of particlesRef.current) {
        const alpha = Math.max(0, p.life / 0.6)
        const cx = p.centerX ?? p.x
        const cy = p.centerY ?? p.y
        let ux = p.x - cx
        let uy = p.y - cy
        const d = Math.hypot(ux, uy)
        if (d < 0.001) {
          ux = 0
          uy = -1
        } else {
          ux /= d
          uy /= d
        }
        // A short ink stroke fading out. On stock a 0.7 ceiling read as a smear
        // of gray, so the mark is struck nearer full pen and fades from there.
        ctx.strokeStyle = withAlpha(p.color ?? palette.ink, alpha * (theme.luminous ? 0.7 : 0.9))
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + ux * 4, p.y + uy * 4)
        ctx.stroke()
      }

      // Slot colors resolve against the live theme every frame: slot 0 is the
      // theme's player pair (exactly as before), slot 1 dodges it for contrast.
      const colorsForSlot = (slot: PlayerSlot): { body: string; light: string } =>
        slot.index === 0
          ? { body: palette.player, light: palette.playerLight }
          : pickP2Colors(palette.player, theme.luminous)

      // ===== THE TRACE =====
      // The trail is not a smear, it is the chart recorder's pen: a hairline
      // path through the last ~0.42s of travel, with a tick stamped at a FIXED
      // TIME INTERVAL. Because the interval is time and the path is distance,
      // tick spacing *is* speed, a momentum game drawing its own momentum.
      //
      // `point.life` counts down from TRAIL_LIFE at dt, so age is exact and
      // frame-rate independent; a tick lands wherever the age crosses a
      // multiple of TICK_SECONDS.
      const TRAIL_LIFE = 0.42
      const TICK_SECONDS = 0.09
      const trail = trailStyleRef.current
      // `trail.opacity` was authored for soft blobs smeared over a black field,
      // where a low alpha still glowed. A hairline of ink laid on stock at the
      // same value is simply pale, so the multiplier is medium-dependent: the
      // pen presses harder on paper than the tube needs to be driven.
      const traceAlpha = Math.min(0.95, trail.opacity * (theme.luminous ? 2.6 : 3.4))
      const tickAlpha = Math.min(1, traceAlpha * (trail.ticks ? 1.15 : 0.75))
      const tickLen = trail.ticks ? 4.5 : 2.75

      ctx.save()
      playersRef.current.forEach((slot, i) => {
        const points = playerTrailRef.current[i] ?? []
        if (points.length < 2) return
        const traceColor = colorsForSlot(slot).body

        ctx.strokeStyle = withAlpha(traceColor, traceAlpha)
        ctx.lineWidth = Math.max(0.9, 1.25 * trail.width)
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let k = 1; k < points.length; k++) ctx.lineTo(points[k].x, points[k].y)
        ctx.stroke()

        // Interval stamps, perpendicular to the direction of travel.
        ctx.strokeStyle = withAlpha(traceColor, tickAlpha)
        ctx.lineWidth = 1
        ctx.beginPath()
        let stamped = 0
        for (let k = 1; k < points.length; k++) {
          const ageA = TRAIL_LIFE - points[k - 1].life
          const ageB = TRAIL_LIFE - points[k].life
          if (Math.floor(ageA / TICK_SECONDS) === Math.floor(ageB / TICK_SECONDS)) continue
          const dx = points[k].x - points[k - 1].x
          const dy = points[k].y - points[k - 1].y
          const d = Math.hypot(dx, dy)
          if (d < 0.01) continue
          const nx = -dy / d
          const ny = dx / d
          ctx.moveTo(points[k].x - nx * tickLen, points[k].y - ny * tickLen)
          ctx.lineTo(points[k].x + nx * tickLen, points[k].y + ny * tickLen)
          stamped++
        }
        if (stamped > 0) ctx.stroke()
      })
      ctx.restore()

      // ===== DRAW PLAYERS (the specimen) =====
      for (const slot of playersRef.current) {
        const colors = colorsForSlot(slot)
        const p = slot.puck
        // P2 is an annulus against P1's solid disc, the silhouette, not a
        // sixth hue, is what tells the two players apart.
        const hollow = mpVariantR !== null && slot.index === 1

        // Co-op downed: the specimen stops reading. A dashed hollow ring where
        // the puck was, plus a vermilion arc counting the bleedout down.
        if (mpVariantR === 'coop' && !slot.alive) {
          const pulse = reducedMotionRef.current ? 0.5 : (Math.sin(Date.now() / 220) + 1) / 2
          ctx.save()
          ctx.setLineDash([3, 3])
          ctx.strokeStyle = withAlpha(colors.body, 0.4 + pulse * 0.4)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()

          const downedAt = slot.downedAt ?? runStatsRef.current.elapsed
          const frac = Math.min(
            1,
            Math.max(0, (runStatsRef.current.elapsed - downedAt) / COOP_BLEEDOUT_SECONDS)
          )
          ctx.strokeStyle = withAlpha(palette.hostile, 0.9)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 9, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
          ctx.stroke()
          continue
        }

        const stunned =
          propsRef.current.gameMode === 'multiplayer' &&
          runStatsRef.current.elapsed < slot.stunnedUntil
        // Recover pop: fires the frame a stun expires, render-side detection
        // so it plays identically on host and guest with no wire data.
        if (propsRef.current.gameMode === 'multiplayer') {
          if (prevStunnedRef.current[slot.index] && !stunned) {
            spawnBurst(p.x, p.y, palette.ink, 0.6)
          }
          prevStunnedRef.current[slot.index] = stunned
        }
        if (stunned) {
          // Ghosted while stunned, with a depleting ink arc counting down the
          // stagger (mirrors the co-op bleedout arc).
          ctx.save()
          ctx.globalAlpha = 0.4
          drawPlayerBody(p, colors.body, hollow)
          ctx.restore()
          const remaining = slot.stunnedUntil - runStatsRef.current.elapsed
          const frac = Math.min(1, Math.max(0, remaining / DUEL_STUN_SECONDS))
          ctx.strokeStyle = withAlpha(palette.ink, 0.85)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.radius + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
          ctx.stroke()
        } else {
          const isIt = mpVariantR === 'tag' && slot.isIt
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
          drawPlayerBody(p, colors.body, hollow)
          if (immuneFlicker) ctx.restore()
          if (isIt) {
            // "It" is flagged, not lit: a vermilion ring with four cardinal
            // ticks, the arena's mark for a live hazard attached to a player.
            // Dashed and dimmed during the post-swap cooldown, when tags can't
            // land.
            const inCooldown = runStatsRef.current.elapsed < slot.immuneUntil
            const r = p.radius + 7
            ctx.save()
            if (inCooldown) ctx.setLineDash([4, 4])
            ctx.strokeStyle = withAlpha(palette.hostile, inCooldown ? 0.5 : 1)
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.beginPath()
            ctx.moveTo(p.x, p.y - r - 1); ctx.lineTo(p.x, p.y - r - 5)
            ctx.moveTo(p.x, p.y + r + 1); ctx.lineTo(p.x, p.y + r + 5)
            ctx.moveTo(p.x - r - 1, p.y); ctx.lineTo(p.x - r - 5, p.y)
            ctx.moveTo(p.x + r + 1, p.y); ctx.lineTo(p.x + r + 5, p.y)
            ctx.stroke()
            ctx.restore()
          }
        }
      }

      ctx.restore()

      // ===== RENDER ORDER =====
      // 1. Measurement field (drawn first, under everything)
      // 2. Targets, hazards, trace, specimen (drawn above)
      // 3. Limit rails, instrumentation reads on TOP of the field
      // 4. Fault-state overlays and panels

      // ===== LIMIT RAILS =====
      // The old border was a red bloom scaling to an 80px blur. It is now a
      // ruled edge: a hairline rail with a stepped graduation, where the ticks
      // nearest you go vermilion and a mono readout states the gap in pixels.
      // This is safety-critical feedback, so proximity gets MORE signal than
      // before, not less: the local rail thickens, the ticks triple in length,
      // and the number is unambiguous where a glow was only a vibe.
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

      // Walls are lethal in survival/tutorial and punishing in duel/co-op; tag
      // and zen wrap, so their rails stay inert. Challenges are excluded for
      // the same reason as before the redesign: a shrunken challenge arena has
      // its own limit, and the canvas edge is not it.
      const railsArmed =
        props.gameMode === 'survival' ||
        props.gameMode === 'tutorial' ||
        (props.gameMode === 'multiplayer' && mpVariantR !== 'tag')

      // Base rail + MAJOR graduation, batched into two paths for the whole
      // frame. The minor graduation belongs to the measurement field below and
      // steps at MINOR, so major ticks land on the same lattice as the interior
      // crosses rather than fighting them.
      //
      // Both are graphite (`ink`) while the puck is clear of them, and the
      // warning band below overprints in red pen. On stock the old 0.18/0.16
      // values sat under the grid; the rail is a ruled edge and has to read as
      // a drawn line, so print gets a firmer press than the tube.
      const RAIL_STEP = GRID
      const railAlpha = theme.luminous ? 0.2 : 0.3
      ctx.lineWidth = 1
      ctx.lineCap = 'butt'
      ctx.strokeStyle = withAlpha(palette.ink, railAlpha)
      ctx.beginPath()
      ctx.rect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
      ctx.stroke()

      ctx.strokeStyle = withAlpha(palette.ink, railAlpha * 0.85)
      ctx.beginPath()
      for (let gx = RAIL_STEP; gx < w; gx += RAIL_STEP) {
        const x = Math.round(gx) + 0.5
        ctx.moveTo(x, 0); ctx.lineTo(x, 9)
        ctx.moveTo(x, h); ctx.lineTo(x, h - 9)
      }
      for (let gy = RAIL_STEP; gy < h; gy += RAIL_STEP) {
        const y = Math.round(gy) + 0.5
        ctx.moveTo(0, y); ctx.lineTo(9, y)
        ctx.moveTo(w, y); ctx.lineTo(w - 9, y)
      }
      ctx.stroke()

      if (railsArmed && dangerFactor > 0) {
        // Per-player, per-edge: light up the stretch of rail the puck is
        // actually closing on, and state the gap.
        const watched =
          propsRef.current.gameMode === 'multiplayer'
            ? livingPlayers(playersRef.current).map((s) => s.puck)
            : [player]
        const SPAN = 150 // px of rail lit either side of the puck's projection

        ctx.font = `500 11px ${FONT_DATA}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        for (const p of watched) {
          const edges: { gap: number; horizontal: boolean; at: number; far: boolean }[] = [
            { gap: p.x - p.radius, horizontal: false, at: p.y, far: false },
            { gap: w - (p.x + p.radius), horizontal: false, at: p.y, far: true },
            { gap: p.y - p.radius, horizontal: true, at: p.x, far: false },
            { gap: h - (p.y + p.radius), horizontal: true, at: p.x, far: true },
          ]

          for (const e of edges) {
            if (e.gap >= proximityThreshold) continue
            const raw = Math.max(0, Math.min(1, 1 - e.gap / proximityThreshold))
            const t = raw * raw * (3 - 2 * raw)
            // Entry into the band has to be visible on stock too, where a
            // 35%-alpha red is barely a tint, so the pen starts down harder.
            const alpha = 0.45 + t * 0.55
            const tickLong = 6 + t * 14
            const lo = e.at - SPAN
            const hi = e.at + SPAN

            // The rail segment itself, thickening as the gap closes.
            ctx.strokeStyle = withAlpha(palette.hostile, alpha)
            ctx.lineWidth = 1 + t * 3
            ctx.beginPath()
            if (e.horizontal) {
              const y = e.far ? h - 2 : 2
              ctx.moveTo(Math.max(0, lo), y)
              ctx.lineTo(Math.min(w, hi), y)
            } else {
              const x = e.far ? w - 2 : 2
              ctx.moveTo(x, Math.max(0, lo))
              ctx.lineTo(x, Math.min(h, hi))
            }
            ctx.stroke()

            // Vermilion graduation over the same span.
            ctx.lineWidth = 1
            ctx.beginPath()
            if (e.horizontal) {
              const y = e.far ? h : 0
              const dir = e.far ? -1 : 1
              const start = Math.max(MINOR, Math.ceil(lo / MINOR) * MINOR)
              for (let gx = start; gx < Math.min(w, hi); gx += MINOR) {
                const x = Math.round(gx) + 0.5
                const fall = 1 - Math.abs(gx - e.at) / SPAN
                ctx.moveTo(x, y)
                ctx.lineTo(x, y + dir * tickLong * Math.max(0.35, fall))
              }
            } else {
              const x = e.far ? w : 0
              const dir = e.far ? -1 : 1
              const start = Math.max(MINOR, Math.ceil(lo / MINOR) * MINOR)
              for (let gy = start; gy < Math.min(h, hi); gy += MINOR) {
                const y = Math.round(gy) + 0.5
                const fall = 1 - Math.abs(gy - e.at) / SPAN
                ctx.moveTo(x, y)
                ctx.lineTo(x + dir * tickLong * Math.max(0.35, fall), y)
              }
            }
            ctx.stroke()

            // Dimension line from the puck to the limit. The gap readout at the
            // edge is peripheral; this puts the same fact where the player is
            // actually looking, which is what the old bloom was doing badly.
            if (t > 0.25) {
              ctx.save()
              ctx.setLineDash([2, 4])
              ctx.strokeStyle = withAlpha(palette.hostile, 0.3 + t * 0.5)
              ctx.lineWidth = 1
              ctx.beginPath()
              if (e.horizontal) {
                ctx.moveTo(p.x, e.far ? p.y + p.radius : p.y - p.radius)
                ctx.lineTo(p.x, e.far ? h : 0)
              } else {
                ctx.moveTo(e.far ? p.x + p.radius : p.x - p.radius, p.y)
                ctx.lineTo(e.far ? w : 0, p.y)
              }
              ctx.stroke()
              ctx.restore()
            }

            // Numeric gap readout: annotated on the dimension line the way a
            // drawing dimensions a clearance, offset off the line so it never
            // lands on top of the puck it is measuring.
            if (t > 0.12) {
              const label = String(Math.max(0, Math.round(e.gap)))
              const lx = e.horizontal
                ? Math.max(18, Math.min(w - 18, p.x + 22))
                : Math.max(
                    14,
                    Math.min(w - 14, (e.far ? p.x + p.radius + w : p.x - p.radius) / 2)
                  )
              const ly = e.horizontal
                ? Math.max(
                    14,
                    Math.min(h - 14, (e.far ? p.y + p.radius + h : p.y - p.radius) / 2)
                  )
                : Math.max(14, Math.min(h - 14, p.y - 22))

              // A dimension figure sits in a break in the line, not on top of
              // it. The break is cut in the medium's own stock so the number
              // reads over grid, trace or hatch on either medium.
              const lw = ctx.measureText(label).width
              ctx.fillStyle = withAlphaAny(theme.bgOuter, 0.88)
              ctx.fillRect(lx - lw / 2 - 3, ly - 8, lw + 6, 16)

              ctx.fillStyle = withAlpha(palette.hostile, Math.min(1, 0.65 + t * 0.35))
              ctx.fillText(label, lx, ly)
            }
          }
        }
      }

      // ===== COLLISION FLASH =====
      if (collisionFlashRef.current > 0) {
        ctx.fillStyle = withAlpha(palette.hostile, collisionFlashRef.current * 0.3)
        ctx.fillRect(0, 0, w, h)
      }

      /**
       * Mono timecode at the top of the field, over a hairline depletion rule.
       * Replaces the 48px glowing countdown: ink while there is room, warn
       * under 10s, vermilion under 5s. Shared by the fault clock and the
       * challenge deadline so both read on the same instrument.
       */
      const drawTimecode = (secondsLeft: number, total: number) => {
        const s = Math.max(0, secondsLeft)
        const color = s > 10 ? palette.ink : s > 5 ? palette.warn : palette.hostile
        const barW = Math.min(240, Math.max(110, w * 0.24))
        const cx = w / 2
        const y = 20

        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = color
        ctx.font = `600 19px ${FONT_DATA}`
        drawTrackedText(ctx, `T-${s.toFixed(1)}`, cx, y, 2)

        const ruleY = Math.round(y + 16) + 0.5
        ctx.strokeStyle = withAlpha(palette.ink, 0.24)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx - barW / 2, ruleY)
        ctx.lineTo(cx + barW / 2, ruleY)
        ctx.stroke()

        const frac = total > 0 ? Math.max(0, Math.min(1, s / total)) : 0
        if (frac > 0) {
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(cx - barW / 2, ruleY)
          ctx.lineTo(cx - barW / 2 + barW * frac, ruleY)
          ctx.stroke()
        }
        ctx.restore()
      }

      /**
       * Final-5s urgency, as a hairline scan and a 1px frame flash rather than
       * a full-screen red wash. Under reduced motion the scan parks at the
       * center line and the flash holds a steady value.
       */
      const drawUrgencyScan = (secondsLeft: number) => {
        if (secondsLeft <= 0 || secondsLeft > 5) return
        const intensity = 1 - secondsLeft / 5
        const reduce = reducedMotionRef.current
        const scanY = reduce
          ? Math.round(h / 2) + 0.5
          : Math.round(((Date.now() % 900) / 900) * h) + 0.5

        ctx.save()
        ctx.strokeStyle = withAlpha(palette.hostile, 0.18 + intensity * 0.42)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, scanY)
        ctx.lineTo(w, scanY)
        ctx.stroke()

        const pulse = reduce ? 0.6 : (Math.sin(Date.now() / 140) + 1) / 2
        ctx.strokeStyle = withAlpha(palette.hostile, intensity * (0.25 + pulse * 0.6))
        ctx.lineWidth = 2
        ctx.strokeRect(1, 1, Math.max(0, w - 2), Math.max(0, h - 2))
        ctx.restore()
      }

      /**
       * Set `ctx.font` for a tracked mono line, shrinking it until it fits
       * `maxWidth`, and return the tracking to use. Wide tracking plus a narrow
       * phone arena would otherwise run the fault annunciation off both edges.
       */
      const fitTracked = (
        text: string,
        maxWidth: number,
        weight: string,
        size: number,
        track: number
      ) => {
        ctx.font = `${weight} ${size}px ${FONT_DATA}`
        const width = ctx.measureText(text).width + Math.max(0, text.length - 1) * track
        if (width <= maxWidth || width <= 0 || maxWidth <= 0) return track
        const k = maxWidth / width
        ctx.font = `${weight} ${(size * k).toFixed(2)}px ${FONT_DATA}`
        return track * k
      }

      // ===== CATACLYSM EVENT - INTRO OVERLAY + TIMER (survival + co-op) =====
      if (cataclysmsOn && gameData.state === 'cataclysm' && gameData.cataclysm) {
        const cat = gameData.cataclysm
        const enterTime = cat.enterTime ?? 0
        
        // ===== FAULT STATE: INTRO (first 1.5 seconds) =====
        // Not a title card, a fault annunciator. Corner brackets frame the
        // arena, a scan rule crosses it, the event is named in tracked mono
        // caps and the clock is a timecode. No 56px glowing text, no vignette.
        if (enterTime < 1.5) {
          const fadeInDuration = 0.3
          const holdDuration = 0.9
          const fadeOutDuration = 0.3

          let alpha = 1
          if (enterTime < fadeInDuration) {
            alpha = enterTime / fadeInDuration
          } else if (enterTime < fadeInDuration + holdDuration) {
            alpha = 1
          } else {
            alpha = 1 - (enterTime - fadeInDuration - holdDuration) / fadeOutDuration
          }
          alpha = Math.max(0, Math.min(1, alpha))

          ctx.save()
          ctx.globalAlpha = alpha

          // The field is washed back so the annunciation reads. `void` is the
          // instrument's own stock, so this darkens a tube and pales a sheet -
          // either way the marks underneath drop back. Flat, no radial bloom.
          ctx.fillStyle = withAlphaAny(palette.void, 0.72)
          ctx.fillRect(0, 0, w, h)

          // Corner brackets.
          const inset = 18
          const arm = Math.min(56, Math.max(24, Math.min(w, h) * 0.08))
          const bx = inset + 0.5
          const by = inset + 0.5
          const bx2 = w - inset - 0.5
          const by2 = h - inset - 0.5
          ctx.strokeStyle = withAlpha(palette.hostile, 0.9)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(bx, by + arm); ctx.lineTo(bx, by); ctx.lineTo(bx + arm, by)
          ctx.moveTo(bx2 - arm, by); ctx.lineTo(bx2, by); ctx.lineTo(bx2, by + arm)
          ctx.moveTo(bx2, by2 - arm); ctx.lineTo(bx2, by2); ctx.lineTo(bx2 - arm, by2)
          ctx.moveTo(bx + arm, by2); ctx.lineTo(bx, by2); ctx.lineTo(bx, by2 - arm)
          ctx.stroke()

          // Scan rule: a full-width hairline that sweeps into position, or
          // simply sits at the reading line under reduced motion.
          const settle = Math.min(1, enterTime / 0.45)
          const scanY = reducedMotionRef.current
            ? Math.round(h / 2) + 0.5
            : Math.round(h / 2 - (1 - settle) * h * 0.22) + 0.5
          // Annunciator band. The specimen keeps moving under the overlay, and
          // a puck parked on the reading line would swallow the fault text; the
          // band guarantees the annunciation reads whatever is behind it, and
          // gives the scan rule something to be the axis of. It is cut from
          // `panel`, the theme's own sheet, so it separates from the washed
          // field on paper instead of vanishing into it.
          const bandTop = scanY - 64
          const bandH = 122
          ctx.fillStyle = withAlphaAny(palette.panel, 0.94)
          ctx.fillRect(0, bandTop, w, bandH)
          ctx.strokeStyle = withAlpha(palette.hostile, 0.45)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, Math.round(bandTop) + 0.5)
          ctx.lineTo(w, Math.round(bandTop) + 0.5)
          ctx.moveTo(0, Math.round(bandTop + bandH) - 0.5)
          ctx.lineTo(w, Math.round(bandTop + bandH) - 0.5)
          ctx.stroke()

          ctx.strokeStyle = withAlpha(palette.hostile, 0.35)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(inset, scanY)
          ctx.lineTo(w - inset, scanY)
          ctx.stroke()

          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          // Status word.
          ctx.fillStyle = palette.hostile
          ctx.font = `600 11px ${FONT_DATA}`
          drawTrackedText(ctx, 'FAULT', w / 2, scanY - 52, 5)

          // Event name, mono caps, wide tracking, ink not alarm: the fault is
          // flagged by the frame, named by the type.
          const fitW = Math.max(80, w - inset * 2 - 16)
          const nameText = cat.eventName.toUpperCase()
          const nameSize = Math.min(30, Math.max(16, w * 0.035))
          ctx.fillStyle = palette.ink
          drawTrackedText(
            ctx,
            nameText,
            w / 2,
            scanY - 22,
            fitTracked(nameText, fitW, '500', nameSize, nameSize * 0.18)
          )

          // Objective + timecode below the rule.
          const objText = getCataclysmObjective(cat.eventType).toUpperCase()
          ctx.fillStyle = palette.muted
          drawTrackedText(ctx, objText, w / 2, scanY + 22, fitTracked(objText, fitW, '400', 12, 1.4))

          ctx.fillStyle = withAlpha(palette.ink, 0.7)
          ctx.font = `500 13px ${FONT_DATA}`
          drawTrackedText(ctx, `T-${cat.timeLeft.toFixed(1)}`, w / 2, scanY + 46, 2)

          ctx.restore()

        // ===== FAULT STATE: RUNNING CLOCK =====
        } else {
          drawTimecode(cat.timeLeft, 30)
          drawUrgencyScan(cat.timeLeft)
        }
      }

      // ===== CHALLENGE TIMER (time-bound challenges) =====
      // Same timecode as the fault clock, so a timed challenge reads on the
      // same instrument as an event.
      if (
        props.gameMode === 'challenge' &&
        propsRef.current.challenge &&
        gameData.state === 'playing'
      ) {
        const ch = propsRef.current.challenge
        const limit = challengeTimeLimit(ch, w, h)
        if (limit > 0) {
          const secs = Math.max(0, limit - runStatsRef.current.elapsed)
          drawTimecode(secs, limit)
          drawUrgencyScan(secs)
        }
      }

      // ===== TUTORIAL INSTRUCTION OVERLAY =====
      if (props.gameMode === 'tutorial') {
        const tutorialState = tutorialStateRef.current
        
        // ===== TUTORIAL DEATH POPUP =====
        if (tutorialState.isDead) {
          drawArcadeGameOverOverlay(ctx, w, h, palette, {
            title: 'Run terminated',
            middle: `Step ${tutorialState.currentStep + 1}`,
            hint: 'Space to restart the step',
          })
          return // Don't render anything else when dead
        }

        // ===== LIMIT WARNING PANEL =====
        if (tutorialState.hasShownBorderWarning) {
          const timeSinceWarning = Date.now() - borderWarningStartTime.current
          const warningDuration = 2500 // Show for ~2.5 seconds

          if (timeSinceWarning < warningDuration) {
            const alpha = Math.max(0, 1 - timeSinceWarning / warningDuration)
            const boxWidth = Math.min(440, w - 80)
            const warningText =
              'The limit rail is lethal. Vermilion ticks and the gap readout mean you are closing on it.'
            ctx.font = `400 13px ${FONT_DATA}`
            const warningLines = wrapCanvasText(ctx, warningText, boxWidth - 48)

            drawRoundedTextBox(ctx, w, h, warningLines, {
              boxWidth,
              fontSize: 13,
              lineHeight: 22,
              paddingY: 18,
              fillStyle: palette.panel,
              strokeStyle: withAlpha(palette.hostile, 0.9),
              textColor: palette.ink,
              label: 'LIMIT',
              labelColor: palette.hostile,
              globalAlpha: alpha,
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
            ctx.fillStyle = withAlphaAny(palette.void, 0.85)
            ctx.fillRect(0, 0, w, h)
            ctx.restore()

            const boxWidth = Math.min(560, w - 64)
            ctx.font = `400 14px ${FONT_DATA}`
            const lines = wrapCanvasText(ctx, currentStep.instruction, boxWidth - 56)
            const stepLabel = `Step ${tutorialState.currentStep + 1} / ${tutorialSteps.length}`

            drawInstructionCard(ctx, w, stepLabel, lines, palette, {
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
        drawArcadeGameOverOverlay(ctx, w, h, palette, {
          title: 'Run terminated',
          middle: `SCORE ${gameData.score}`,
          hint: 'Space to restart',
        })
      }

      // Leave host-arena coordinate space before local-space overlays.
      if (guestTransformed) ctx.restore()

      // ===== ONLINE GUEST: STALL RIBBON =====
      // Snapshots stopped arriving mid-match, a status readout on a flat
      // panel, same instrument as every other card. Suppressed while paused.
      if (
        props.netRole === 'guest' &&
        props.net &&
        props.uiState === 'playing' &&
        !props.isPaused &&
        snapshotBufferRef.current.isStalled(performance.now())
      ) {
        const text = 'LINK UNSTABLE — WAITING FOR HOST'
        ctx.save()
        ctx.font = `500 11px ${FONT_DATA}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const textW = ctx.measureText(text).width + text.length * 1.6
        const boxW = Math.min(localW - 16, textW + 36)
        const boxH = 26
        const boxX = (localW - boxW) / 2
        const boxY = 10
        drawPanel(ctx, boxX, boxY, boxW, boxH, palette.panel, withAlpha(palette.warn, 0.85))
        ctx.fillStyle = palette.warn
        drawTrackedText(ctx, text, localW / 2, boxY + boxH / 2 + 1, 1.6)
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
        // world; only local cosmetic effects (particles/trails) advance.
        // Snapshots also apply while paused so the world never desyncs across
        // a pause; the intro-banner clock (dt) freezes.
        const active = props.uiState === 'playing' && !props.isPaused
        if (props.uiState === 'playing' || props.uiState === 'paused') {
          applySnapshotState(active ? capped : 0)
        }
        if (active) {
          updateEffects(capped)
          // The guest simulates nothing, so its speed trace comes off the
          // interpolated puck it actually controls (slot 1).
          const local = playersRef.current[1]?.puck ?? playerRef.current
          if (local) recordSpeed(Math.hypot(local.vx, local.vy), capped)
        }
        sendGuestInput(net, now)
      } else {
        update(capped)
        // Online host: broadcast while a match is in progress, including
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
    // Intentionally keyed on `props` alone. The loop reads everything else
    // through refs; adding the callbacks would cancel and restart the
    // animation frame whenever their identity changed, stuttering the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Must fire on uiState transitions only. Including resetGame would rerun
    // this, and reset a run in progress, on any unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
