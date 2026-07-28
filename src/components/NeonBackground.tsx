"use client"

import React, { useEffect, useRef, useState } from 'react'
import { drawTrace, type TraceStyle } from '../lib/telemetry'
import { THEME_CHANGE_EVENT } from '../lib/customization'

/** Samples per second written to the title trace. */
const SAMPLE_HZ = 30
const SAMPLE_INTERVAL = 1 / SAMPLE_HZ

/**
 * Vertical floor for the trace's auto-scale, in px/s. Without it a resting
 * cursor's jitter would fill the plot and read as noise instead of stillness.
 */
const MIN_PEAK = 600

/** How fast the scale ceiling relaxes back down after a fast sweep. */
const PEAK_DECAY = 0.997

/** Measurement-field spacing, in CSS px. */
const GRID = 56

/** Fallbacks used before the stylesheet resolves (SSR hydration, mostly). */
const STOCK = '#04120a'
const PEN = '#46ff8c'

type Tokens = {
  ground: string
  phosphor: string
  rule: string
  ruleStrong: string
}

/**
 * Alpha-blend a resolved CSS colour. Tokens reach us as either `#rrggbb` or
 * `rgb(r, g, b)` depending on whether the instrument supplied the value or it
 * was derived by mixing, so this has to accept both.
 */
function toRgba(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const rgb = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  return `rgba(70, 255, 140, ${alpha})`
}

/**
 * Draw the measurement field: graph-paper intersections plus edge rulers.
 * Rendered once to an offscreen canvas and blitted per frame — it never
 * changes, and it must stay quiet enough for the wordmark to sit on top of it.
 */
function paintField(ctx: CanvasRenderingContext2D, w: number, h: number, t: Tokens): void {
  // A scope graticule: the full etched grid a tube carries, faint minor lines
  // every cell and a firmer line every fifth division. Both stay well under the
  // type so the wordmark still sits on top of it.
  const grid = (step: number, alpha: number) => {
    ctx.strokeStyle = t.rule
    ctx.globalAlpha = alpha
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = step; x < w; x += step) {
      const cx = Math.round(x) + 0.5
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, h)
    }
    for (let y = step; y < h; y += step) {
      const cy = Math.round(y) + 0.5
      ctx.moveTo(0, cy)
      ctx.lineTo(w, cy)
    }
    ctx.stroke()
  }
  grid(GRID, 0.42)
  grid(GRID * 5, 0.78)
  ctx.globalAlpha = 1

  // Edge rulers: minor tick every cell, major every fifth.
  const ruler = (major: boolean) => {
    ctx.strokeStyle = major ? t.ruleStrong : t.rule
    ctx.lineWidth = 1
    ctx.beginPath()
    const step = major ? GRID * 5 : GRID
    const len = major ? 10 : 5
    for (let x = step; x < w; x += step) {
      const cx = Math.round(x) + 0.5
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, len)
      ctx.moveTo(cx, h)
      ctx.lineTo(cx, h - len)
    }
    for (let y = step; y < h; y += step) {
      const cy = Math.round(y) + 0.5
      ctx.moveTo(0, cy)
      ctx.lineTo(len, cy)
      ctx.moveTo(w, cy)
      ctx.lineTo(w - len, cy)
    }
    ctx.stroke()
  }
  ruler(false)
  ruler(true)
}

/**
 * The title screen's instrument backdrop.
 *
 * One plotted channel — the cursor's own velocity over time — on a sparse
 * measurement field. The visitor moves the pointer and the instrument responds,
 * which states the game's premise before a key is pressed. It is real data:
 * a still pointer plots a still line.
 */
export default function NeonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999, px: -9999, py: -9999, vx: 0, vy: 0, seen: false })
  const animationRef = useRef<number>()
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  // Tokens are sampled once per setup, so a change of instrument has to force
  // a re-run rather than waiting for the next resize.
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    const update = () => setDimensions({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const onTheme = () => setThemeTick((n) => n + 1)
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
  }, [])

  useEffect(() => {
    // Pointer events, not mouse events, so a touch drag is measured too.
    const onMove = (e: PointerEvent) => {
      const m = mouseRef.current
      if (!m.seen) {
        // Seed both positions on first sight, or the jump from the sentinel
        // origin would register as one enormous fake sample.
        m.px = e.clientX
        m.py = e.clientY
        m.seen = true
      }
      m.x = e.clientX
      m.y = e.clientY
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
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

    // Resolve tokens off the element so the backdrop follows the stylesheet
    // rather than hardcoding the palette a second time.
    const cs = getComputedStyle(canvas)
    const token = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const tokens: Tokens = {
      ground: token('--stock', STOCK),
      phosphor: token('--pen', PEN),
      rule: token('--rule', 'rgba(22, 32, 43, 0.16)'),
      ruleStrong: token('--rule-strong', 'rgba(22, 32, 43, 0.34)'),
    }

    const style: TraceStyle = {
      stroke: tokens.phosphor,
      // Lighter than the strip chart's wash: this band is large and the
      // wordmark sits beside it.
      // Lighter than the strip chart's wash — this band is large — but still
      // the instrument's own signal, not a fixed colour.
      fill: toRgba(tokens.phosphor, 0.05),
      baseline: tokens.rule,
      tick: tokens.ruleStrong,
      tickEvery: 20,
      lineWidth: 1.5,
      glow: 8,
      endMark: null,
    }

    // The channel spans the whole display — it is the instrument's readout, not
    // an ornament parked in one column. Anchoring the band to the bottom edge
    // is what makes the full width safe: a resting pointer plots a dead-flat
    // line, and at the baseline that reads as the trace's zero rather than as a
    // stray rule through the type.
    const bandH = Math.max(150, Math.min(360, H * 0.34))
    const bandTop = Math.round(H - 20 - bandH)
    const traceW = W

    // The field is static; render it once and blit.
    const field = document.createElement('canvas')
    field.width = canvas.width
    field.height = canvas.height
    const fctx = field.getContext('2d')
    if (fctx) {
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paintField(fctx, W, H, tokens)
    }

    const paintGround = () => {
      ctx.fillStyle = tokens.ground
      ctx.fillRect(0, 0, W, H)
      if (fctx) ctx.drawImage(field, 0, 0, W, H)
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // One sample per column of a few px — enough resolution to read a flick,
    // cheap enough to redraw every frame.
    const capacity = Math.max(120, Math.min(480, Math.round(W / 3)))
    const samples = new Float32Array(capacity)
    const ordered = new Float32Array(capacity)

    const plot = (data: Float32Array, ceiling: number) => {
      if (traceW <= 0) return
      ctx.save()
      ctx.translate(0, bandTop)
      drawTrace(ctx, data, capacity, ceiling, traceW, bandH, style)
      ctx.restore()
    }

    // Static equivalent for reduced motion: the field and a settled trace.
    if (reduced) {
      paintGround()
      plot(ordered, MIN_PEAK)
      return
    }

    let head = 0
    let accTime = 0
    let accSum = 0
    let accCount = 0
    let peak = MIN_PEAK
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const m = mouseRef.current
      // Low-pass + cap the cursor velocity so a fast flick reads as a measured
      // excursion rather than a single-frame spike.
      const CAP = 30
      const rawVx = Math.max(-CAP, Math.min(CAP, m.x - m.px))
      const rawVy = Math.max(-CAP, Math.min(CAP, m.y - m.py))
      m.px = m.x
      m.py = m.y
      m.vx += (rawVx - m.vx) * 0.22
      m.vy += (rawVy - m.vy) * 0.22
      // Report in px/s so the channel carries a real unit, like every other
      // trace in the game.
      const speed = m.seen ? Math.hypot(m.vx, m.vy) / Math.max(dt, 1 / 240) : 0

      // Time-bucket the samples so the plotted shape is frame-rate independent.
      accSum += speed
      accCount += 1
      accTime += dt
      if (accTime >= SAMPLE_INTERVAL) {
        samples[head] = accSum / accCount
        head = (head + 1) % capacity
        accSum = 0
        accCount = 0
        accTime = 0
      }

      // Ceiling follows the fastest recent sweep and relaxes back down, so the
      // plot rescales instead of clipping or flattening.
      peak = Math.max(MIN_PEAK, speed, peak * PEAK_DECAY)

      // `head` is the next write slot, which is also the oldest sample.
      for (let i = 0; i < capacity; i++) ordered[i] = samples[(head + i) % capacity]

      paintGround()
      plot(ordered, peak)

      animationRef.current = requestAnimationFrame(frame)
    }

    animationRef.current = requestAnimationFrame(frame)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [dimensions, themeTick])

  return <canvas ref={canvasRef} aria-hidden="true" className="neon-background" />
}
