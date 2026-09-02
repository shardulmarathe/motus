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
 * Purely presentational, the parent owns the queue.
 */
export default function AchievementToast({ queue, onDrained }: AchievementToastProps) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(false)

  // Reset to the first achievement when a new queue arrives. Adjusting state
  // during render rather than in an effect: React re-renders immediately
  // without painting the stale index, so the toast never flashes the previous
  // queue's entry. This is the pattern React documents for derived resets.
  const [queueSeen, setQueueSeen] = useState(queue)
  if (queueSeen !== queue) {
    setQueueSeen(queue)
    setIndex(0)
    setVisible(false)
  }

  useEffect(() => {
    if (queue.length === 0 || index >= queue.length) return
    // Slide-in is driven by a state flip on mount of each entry, so this has to
    // happen here rather than being derived -- `visible` is not a function of
    // the props, it is a function of elapsed time (see the timeouts below).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
    const hide = setTimeout(() => setVisible(false), 3600)
    const next = setTimeout(() => {
      if (index + 1 >= queue.length) {
        onDrained()
      } else {
        setIndex((i) => i + 1)
      }
    }, 4000)
    return () => {
      clearTimeout(hide)
      clearTimeout(next)
    }
  }, [queue, index, onDrained])

  if (queue.length === 0 || index >= queue.length) return null
  const a = queue[index]

  return (
    <div className="achv-banner-wrap" role="status" aria-live="polite">
      <div className={`achv-banner${visible ? ' show' : ''}`}>
        {/* The bordered tile is the annunciator socket; the glyph inside it is
            decoration, so it is hidden from assistive tech and the label,
            name and description carry the announcement. */}
        <span className="achv-banner-icon" aria-hidden="true">{a.icon}</span>
        <span className="achv-banner-text">
          <span className="achv-banner-label">Achievement unlocked</span>
          <span className="achv-banner-name">{a.name}</span>
          <span className="achv-banner-desc">{a.description}</span>
        </span>
        {queue.length > 1 && (
          <span className="achv-banner-count">{index + 1}/{queue.length}</span>
        )}
      </div>
    </div>
  )
}
