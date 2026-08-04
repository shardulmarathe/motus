"use client"

import React, { useEffect, useRef } from 'react'
import { drawTrace, livePeak, readLive, type TraceStyle } from '../lib/telemetry'
import { THEME_CHANGE_EVENT } from '../lib/customization'

const LIVE_BUFFER = new Float32Array(240)

/** Update cadence when the viewer has asked for reduced motion (ms). */
const REDUCED_INTERVAL = 500

interface TraceStripProps {
  /** `live` plots the shared telemetry ring; `static` plots `series`. */
  mode?: 'live' | 'static'
  /** Samples to plot in `static` mode, oldest first. */
  series?: number[]
  /** Scale ceiling for `static` mode. Defaults to the series maximum. */
  peak?: number
  className?: string
  /** CSS height. Pass `'100%'` to fill a positioned parent. Width always fills. */
  height?: number | string
  /** Stamp ticks along the baseline, spacing reads as speed. */
  ticks?: boolean
  /** Mark the final sample with a cross (the end screen's death point). */
  markEnd?: boolean
  /**
   * Fraction of the height the plot may occupy, measured up from the baseline.
   * Below 1 the trace keeps headroom so a peak reads as a peak instead of
   * clipping against the top edge, the HUD bar needs this, a panel does not.
   */
  plotScale?: number
  /** Phosphor bloom on the line. */
  glow?: number
  /** Accessible description; without one the strip is decorative. */
  label?: string
}

/**
 * The signature motif as a component: one plotted line of real speed over time.
 *
 * Live mode runs its own animation frame and reads the telemetry ring directly,
 * so a 60fps chart never re-renders React.
 */
export default function TraceStrip({
  mode = 'live',
  series,
  peak,
  className,
  height = 34,
  ticks = true,
  markEnd = false,
  plotScale = 1,
  // A beam on a phosphor tube blooms. Kept small, this is a readout, and the
  // DOM type around it stays crisp.
  glow = 6,
  label,
}: TraceStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const seriesRef = useRef(series)
  seriesRef.current = series

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const fallbackHeight = typeof height === 'number' ? height : 34
    let width = 0
    let cssHeight = fallbackHeight
    let style: TraceStyle = { stroke: '#ffb245' }

    // Resolve tokens off the element so the strip follows the active theme
    // rather than hardcoding the palette a second time.
    const readTokens = () => {
      const cs = getComputedStyle(canvas)
      const token = (name: string, fallback: string) =>
        cs.getPropertyValue(name).trim() || fallback
      const pen = token('--pen', '#1f3fd1')
      style = {
        stroke: pen,
        fill: token('--pen-wash', 'rgba(31, 63, 209, 0.09)'),
        baseline: token('--rule', 'rgba(22, 32, 43, 0.16)'),
        tick: ticks ? token('--rule-strong', 'rgba(22, 32, 43, 0.34)') : null,
        tickEvery: 15,
        lineWidth: 1.5,
        glow,
        endMark: markEnd ? token('--red-pen', '#c8221a') : null,
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0) return
      const dpr = window.devicePixelRatio || 1
      width = rect.width
      cssHeight = rect.height || fallbackHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      readTokens()
    }

    const paint = () => {
      if (width <= 0) return
      ctx.clearRect(0, 0, width, cssHeight)
      const bandH = cssHeight * Math.min(1, Math.max(0.1, plotScale))
      ctx.save()
      ctx.translate(0, cssHeight - bandH)
      if (mode === 'live') {
        const n = readLive(LIVE_BUFFER)
        drawTrace(ctx, LIVE_BUFFER, n, livePeak(), width, bandH, style)
      } else {
        const data = seriesRef.current ?? []
        const max = peak ?? data.reduce((a, b) => (b > a ? b : a), 0)
        drawTrace(ctx, data, data.length, max, width, bandH, style)
      }
      ctx.restore()
    }

    resize()
    paint()

    const observer = new ResizeObserver(() => {
      resize()
      paint()
    })
    observer.observe(canvas)

    // Tokens are cached per setup, so a change of instrument has to re-sample.
    const onTheme = () => {
      readTokens()
      paint()
    }
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)

    // Static traces are drawn once; only the live chart needs a clock, and a
    // reduced-motion viewer gets a slow tick instead of a running line.
    let frame = 0
    let timer: ReturnType<typeof setInterval> | undefined
    if (mode === 'live') {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        timer = setInterval(paint, REDUCED_INTERVAL)
      } else {
        const loop = () => {
          paint()
          frame = requestAnimationFrame(loop)
        }
        frame = requestAnimationFrame(loop)
      }
    }

    return () => {
      observer.disconnect()
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      if (frame) cancelAnimationFrame(frame)
      if (timer) clearInterval(timer)
    }
  }, [mode, peak, height, ticks, markEnd, plotScale, glow])

  return (
    <canvas
      ref={canvasRef}
      className={className ? `trace-strip ${className}` : 'trace-strip'}
      style={{ height }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
