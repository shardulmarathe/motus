"use client"

import React, { useEffect, useRef, useState } from 'react'
import { THEME_CHANGE_EVENT } from '../lib/customization'

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
 * Rendered once to an offscreen canvas and blitted per frame, it never
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
 * One plotted channel, the cursor's own velocity over time, on a sparse
 * measurement field. The visitor moves the pointer and the instrument responds,
 * which states the game's premise before a key is pressed. It is real data:
 * a still pointer plots a still line.
 */
export default function NeonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999, px: -9999, py: -9999, vx: 0, vy: 0, seen: false })
  const animationRef = useRef<number | undefined>(undefined)
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

    // ── Sweep + persistence ────────────────────────────────────────────
    //
    // This is how a scope actually behaves, and it is the design's own rule
    // made literal: the beam writes, the phosphor remembers. A beam travels
    // left→right writing the current speed into the column under it; behind it
    // the phosphor decays. Nothing scrolls. Two things follow from that:
    //
    //  - The sweep keeps moving whether or not the visitor does, so the page is
    //    never static. With no pointer input the trace simply fades to an empty
    //    field with a live beam, an instrument idling, which is honest.
    //  - A flick burns a hot streak in place that visibly cools, instead of
    //    being shoved off-screen by newer samples.

    /** Seconds for the beam to cross the full width. */
    const SWEEP_SECONDS = 6
    /** How long a written column takes to fade to nothing. */
    const PERSIST_SECONDS = 2.4
    /**
     * Soft-knee reference speed, px/s. The old plot clamped the cursor delta to
     * 30px/frame, so every fast flick saturated at the same height; this
     * compresses asymptotically instead, so faster always reads as taller.
     */
    const SPEED_SCALE = 900
    /** Column width in CSS px. */
    const COL_PX = 2
    /** Alpha buckets, one stroke each, rather than one per segment. */
    const BANDS = 12

    // Printed instruments (Thermal, Plotter, Blackline) set --bloom to `none`.
    // A glowing beam on paper would be nonsense, so the halo is gated on it.
    const luminous = token('--bloom', '') !== 'none'

    const bandH = Math.max(150, Math.min(360, H * 0.34))
    const baseY = Math.round(H - 20)
    const cols = Math.max(120, Math.ceil(W / COL_PX))
    const colW = W / cols

    /** Normalised height (0..1) written into each column, and when. */
    const val = new Float32Array(cols)
    const writtenAt = new Float32Array(cols).fill(-1)

    const yFor = (v: number) => baseY - v * bandH
    const xFor = (c: number) => c * colW

    const drawBaseline = () => {
      ctx.strokeStyle = tokens.rule
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, baseY + 0.5)
      ctx.lineTo(W, baseY + 0.5)
      ctx.stroke()
    }

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

    // Reduced motion: the graticule and a settled baseline, no beam.
    if (reduced) {
      paintGround()
      drawBaseline()
      return
    }

    let sweep = 0 // float column position of the beam
    let elapsed = 0
    let plotted = 0 // smoothed height actually written to columns
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += dt

      const m = mouseRef.current
      // Low-pass the pointer so a flick reads as a measured excursion rather
      // than a single-frame spike. No hard clamp any more, the soft knee below
      // does that job without flattening everything above the threshold.
      m.vx += (m.x - m.px - m.vx) * 0.22
      m.vy += (m.y - m.py - m.vy) * 0.22
      m.px = m.x
      m.py = m.y
      const speed = m.seen ? Math.hypot(m.vx, m.vy) / Math.max(dt, 1 / 240) : 0
      // Asymptotic: 0 → 0, SPEED_SCALE → 0.63, 3× → 0.95. Never clips.
      const norm = 1 - Math.exp(-speed / SPEED_SCALE)
      // The beam writes ~2 columns per frame, so writing the instantaneous
      // value would plot per-frame jitter as a picket fence. Smoothing here
      // does what the old 30Hz bucketing did, without the latency of a bucket.
      // Frame-rate independent so the shape is the same at 60 and 144Hz.
      plotted += (norm - plotted) * (1 - Math.exp(-dt / 0.06))

      // Advance the beam, writing every column it crossed this frame.
      const prev = sweep
      sweep += (cols / SWEEP_SECONDS) * dt
      for (let i = Math.floor(prev); i <= Math.floor(sweep); i++) {
        const idx = ((i % cols) + cols) % cols
        val[idx] = plotted
        writtenAt[idx] = elapsed
      }
      if (sweep >= cols) sweep -= cols

      paintGround()
      drawBaseline()

      // One path per alpha band keeps this to BANDS strokes a frame instead of
      // one per column.
      const paths: Path2D[] = []
      for (let b = 0; b < BANDS; b++) paths.push(new Path2D())

      for (let i = 0; i < cols - 1; i++) {
        const a = writtenAt[i]
        const bNext = writtenAt[i + 1]
        if (a < 0 || bNext < 0) continue
        // Don't join across the seam the beam just wrapped through.
        if (Math.abs(a - bNext) > 0.3) continue
        const life = 1 - (elapsed - a) / PERSIST_SECONDS
        if (life <= 0) continue
        const band = Math.min(BANDS - 1, Math.floor(life * BANDS))
        paths[band].moveTo(xFor(i), yFor(val[i]))
        paths[band].lineTo(xFor(i + 1), yFor(val[i + 1]))
      }

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let b = 0; b < BANDS; b++) {
        const life = (b + 0.5) / BANDS
        ctx.strokeStyle = toRgba(tokens.phosphor, 0.12 + life * 0.78)
        ctx.lineWidth = 1 + life * 0.9
        // Only the freshest phosphor blooms; old trace is just dim.
        const hot = luminous && b >= BANDS - 3
        ctx.shadowBlur = hot ? 10 : 0
        ctx.shadowColor = hot ? tokens.phosphor : 'transparent'
        ctx.stroke(paths[b])
      }
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'

      // The beam head: the brightest thing on the page, at the write point.
      const hx = xFor(sweep)
      const hy = yFor(plotted)
      ctx.strokeStyle = toRgba(tokens.phosphor, 0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hx + 0.5, hy)
      ctx.lineTo(hx + 0.5, baseY)
      ctx.stroke()

      ctx.shadowBlur = luminous ? 14 : 0
      ctx.shadowColor = luminous ? tokens.phosphor : 'transparent'
      ctx.fillStyle = tokens.phosphor
      ctx.beginPath()
      ctx.arc(hx, yFor(plotted), 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'

      animationRef.current = requestAnimationFrame(frame)
    }

    animationRef.current = requestAnimationFrame(frame)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [dimensions, themeTick])

  return <canvas ref={canvasRef} aria-hidden="true" className="neon-background" />
}
