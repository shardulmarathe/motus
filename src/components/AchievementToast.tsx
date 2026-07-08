"use client"

import React, { useEffect, useState } from 'react'
import type { Achievement } from '../lib/achievements'

interface AchievementToastProps {
  /** Queue of newly-unlocked achievements to announce, in order. */
  queue: Achievement[]
  /** Called once the whole queue has been shown, so the parent can clear it. */
  onDrained: () => void
}

/**
 * Shows unlocked achievements one at a time as a subtle sliding toast.
 * Purely presentational — the parent owns the queue.
 */
export default function AchievementToast({ queue, onDrained }: AchievementToastProps) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setIndex(0)
  }, [queue])

  useEffect(() => {
    if (queue.length === 0 || index >= queue.length) return
    setVisible(true)
    const hide = setTimeout(() => setVisible(false), 2600)
    const next = setTimeout(() => {
      if (index + 1 >= queue.length) {
        onDrained()
      } else {
        setIndex((i) => i + 1)
      }
    }, 3000)
    return () => {
      clearTimeout(hide)
      clearTimeout(next)
    }
  }, [queue, index, onDrained])

  if (queue.length === 0 || index >= queue.length) return null
  const a = queue[index]

  return (
    <div className={`achv-toast${visible ? ' show' : ''}`} role="status" aria-live="polite">
      <span className="achv-toast-icon">{a.icon}</span>
      <span className="achv-toast-text">
        <span className="achv-toast-label">Achievement Unlocked</span>
        <span className="achv-toast-name">{a.name}</span>
      </span>
    </div>
  )
}
