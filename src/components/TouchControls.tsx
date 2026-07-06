"use client"

import React, { useCallback, useEffect, useRef, useState } from 'react'

const DIRECTION_CODES = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const

/**
 * On-screen virtual joystick for touch devices. It translates drag direction
 * into the same synthetic arrow-key events the keyboard game loop already
 * listens for, so no game-logic changes are required. Supports 8-way movement.
 */
export default function TouchControls() {
  const baseRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<Set<string>>(new Set())
  const pointerIdRef = useRef<number | null>(null)
  const centerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [thumb, setThumb] = useState({ x: 0, y: 0 })

  const press = useCallback((code: string) => {
    if (activeRef.current.has(code)) return
    activeRef.current.add(code)
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
  }, [])

  const release = useCallback((code: string) => {
    if (!activeRef.current.has(code)) return
    activeRef.current.delete(code)
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
  }, [])

  const releaseAll = useCallback(() => {
    DIRECTION_CODES.forEach((code) => release(code))
  }, [release])

  const updateFromVector = useCallback(
    (dx: number, dy: number, radius: number) => {
      const dead = radius * 0.3

      if (dx > dead) {
        release('ArrowLeft')
        press('ArrowRight')
      } else if (dx < -dead) {
        release('ArrowRight')
        press('ArrowLeft')
      } else {
        release('ArrowLeft')
        release('ArrowRight')
      }

      if (dy > dead) {
        release('ArrowUp')
        press('ArrowDown')
      } else if (dy < -dead) {
        release('ArrowDown')
        press('ArrowUp')
      } else {
        release('ArrowUp')
        release('ArrowDown')
      }

      const mag = Math.hypot(dx, dy)
      let tx = dx
      let ty = dy
      if (mag > radius) {
        tx = (dx / mag) * radius
        ty = (dy / mag) * radius
      }
      setThumb({ x: tx, y: ty })
    },
    [press, release]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const base = baseRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    pointerIdRef.current = e.pointerId
    try {
      base.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    updateFromVector(e.clientX - centerRef.current.x, e.clientY - centerRef.current.y, rect.width / 2)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const base = baseRef.current
    if (!base) return
    const radius = base.getBoundingClientRect().width / 2
    updateFromVector(e.clientX - centerRef.current.x, e.clientY - centerRef.current.y, radius)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    releaseAll()
    setThumb({ x: 0, y: 0 })
  }

  // Release any held keys if the control unmounts (e.g. pause / menu)
  useEffect(() => releaseAll, [releaseAll])

  return (
    <div
      ref={baseRef}
      className="touch-joystick"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="Movement joystick"
    >
      <span
        className="touch-joystick-thumb"
        style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
      />
    </div>
  )
}
