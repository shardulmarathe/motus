// Telemetry, the shared speed trace behind Motus's signature motif.
//
// One amber line plotting real speed over time, drawn on four surfaces: the
// title screen (cursor velocity), the in-game HUD (last 8 seconds), the player
// trail in the arena, and the end screen (the whole run). This module owns the
// data; `TraceStrip` and the canvas renderer own the pixels.
//
// The game loop writes here every frame, so nothing in this module allocates
// per sample and React never re-renders to keep the chart moving, consumers
// read the buffer from their own rAF.

/** Seconds of history held by the live strip chart. */
export const LIVE_WINDOW_SECONDS = 8

/** Live ring capacity, 30 samples/second across the window. */
const LIVE_CAPACITY = 240
const LIVE_INTERVAL = LIVE_WINDOW_SECONDS / LIVE_CAPACITY

/**
 * Vertical floor for auto-scaling, in px/s. Without it a barely-moving player
 * produces a full-height trace of pure noise, which reads as broken.
 */
const MIN_PEAK = 140

/** Run-series bucket, in seconds. Doubles whenever the series would overflow. */
const RUN_BUCKET_START = 0.25
const RUN_CAPACITY = 320

const live = new Float32Array(LIVE_CAPACITY)
let liveHead = 0
let liveFilled = 0
let liveAccTime = 0
let liveAccSum = 0
let liveAccCount = 0
let livePeakValue = MIN_PEAK

let runValues: number[] = []
let runBucket = RUN_BUCKET_START
let runAccTime = 0
let runAccSum = 0
let runAccCount = 0
let runPeakValue = MIN_PEAK

/**
 * Feed one frame of motion. `speed` is px/s, `dt` seconds.
 * Samples are time-bucketed, so the trace shape is frame-rate independent.
 */
export function recordSpeed(speed: number, dt: number): void {
  if (!Number.isFinite(speed) || !Number.isFinite(dt) || dt <= 0) return

  liveAccSum += speed
  liveAccCount += 1
  liveAccTime += dt
  if (liveAccTime >= LIVE_INTERVAL) {
    const value = liveAccSum / liveAccCount
    live[liveHead] = value
    liveHead = (liveHead + 1) % LIVE_CAPACITY
    if (liveFilled < LIVE_CAPACITY) liveFilled += 1
    if (value > livePeakValue) livePeakValue = value
    liveAccSum = 0
    liveAccCount = 0
    liveAccTime = 0
  }

  runAccSum += speed
  runAccCount += 1
  runAccTime += dt
  if (runAccTime >= runBucket) {
    const value = runAccSum / runAccCount
    runValues.push(value)
    if (value > runPeakValue) runPeakValue = value
    runAccSum = 0
    runAccCount = 0
    runAccTime = 0

    // Long runs decimate rather than grow without bound: halve the resolution
    // and double the bucket, so a 20-minute run costs the same as a 20-second one.
    if (runValues.length > RUN_CAPACITY) {
      const halved: number[] = []
      for (let i = 0; i + 1 < runValues.length; i += 2) {
        halved.push((runValues[i] + runValues[i + 1]) / 2)
      }
      runValues = halved
      runBucket *= 2
    }
  }
}

/**
 * Copy the live window into `out`, oldest sample first.
 * Returns how many samples were written (may be less than the buffer length).
 */
export function readLive(out: Float32Array): number {
  const n = Math.min(liveFilled, out.length)
  const start = (liveHead - n + LIVE_CAPACITY) % LIVE_CAPACITY
  for (let i = 0; i < n; i++) out[i] = live[(start + i) % LIVE_CAPACITY]
  return n
}

/** Auto-scale ceiling for the live window. */
export function livePeak(): number {
  return livePeakValue
}

/** The finished run, oldest sample first. Safe to keep, it is a fresh array. */
export function runSeries(): number[] {
  return runValues.slice()
}

export function runPeak(): number {
  return runPeakValue
}

/** Clear everything. Call at the start of each run. */
export function resetTelemetry(): void {
  live.fill(0)
  liveHead = 0
  liveFilled = 0
  liveAccTime = 0
  liveAccSum = 0
  liveAccCount = 0
  livePeakValue = MIN_PEAK

  runValues = []
  runBucket = RUN_BUCKET_START
  runAccTime = 0
  runAccSum = 0
  runAccCount = 0
  runPeakValue = MIN_PEAK
}

export interface TraceStyle {
  /** The plotted line. */
  stroke: string
  /** Optional wash under the line. */
  fill?: string | null
  /** Optional baseline rule. */
  baseline?: string | null
  /** Optional tick stamps along the trace, spacing reads as speed. */
  tick?: string | null
  /** Stamp a tick every N samples. */
  tickEvery?: number
  lineWidth?: number
  /** Phosphor bloom. Only the signal is allowed to glow. */
  glow?: number
  /** Mark the final sample, used by the end screen to show where the run stopped. */
  endMark?: string | null
}

/**
 * Plot `count` samples across `w × h`, scaled to `peak`.
 * Shared by the HUD strip chart, the title screen and the end screen so all
 * four expressions of the motif are literally the same line.
 */
export function drawTrace(
  ctx: CanvasRenderingContext2D,
  samples: ArrayLike<number>,
  count: number,
  peak: number,
  w: number,
  h: number,
  style: TraceStyle
): void {
  if (w <= 0 || h <= 0) return

  const pad = Math.min(6, h * 0.16)
  const baseY = h - pad
  const span = Math.max(1, h - pad * 2)
  const scale = Math.max(peak, MIN_PEAK)

  if (style.baseline) {
    ctx.strokeStyle = style.baseline
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, Math.round(baseY) + 0.5)
    ctx.lineTo(w, Math.round(baseY) + 0.5)
    ctx.stroke()
  }

  if (count < 2) return

  const xAt = (i: number) => (i / (count - 1)) * w
  const yAt = (i: number) => baseY - Math.min(1, Math.max(0, samples[i] / scale)) * span

  if (style.fill) {
    ctx.fillStyle = style.fill
    ctx.beginPath()
    ctx.moveTo(0, baseY)
    for (let i = 0; i < count; i++) ctx.lineTo(xAt(i), yAt(i))
    ctx.lineTo(w, baseY)
    ctx.closePath()
    ctx.fill()
  }

  ctx.save()
  if (style.glow) {
    ctx.shadowColor = style.stroke
    ctx.shadowBlur = style.glow
  }
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.lineWidth ?? 1.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const x = xAt(i)
    const y = yAt(i)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()

  if (style.tick) {
    const every = Math.max(1, style.tickEvery ?? 15)
    ctx.strokeStyle = style.tick
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = count - 1; i >= 0; i -= every) {
      const x = Math.round(xAt(i)) + 0.5
      ctx.moveTo(x, baseY)
      ctx.lineTo(x, baseY + 3)
    }
    ctx.stroke()
  }

  if (style.endMark) {
    // Inset so the cross reads as a mark on the plot rather than a clipped
    // glyph hanging off the right edge.
    const x = Math.min(xAt(count - 1), w - 6)
    const y = yAt(count - 1)
    ctx.strokeStyle = style.endMark
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - 5, y - 5)
    ctx.lineTo(x + 5, y + 5)
    ctx.moveTo(x + 5, y - 5)
    ctx.lineTo(x - 5, y + 5)
    ctx.stroke()
  }
}
