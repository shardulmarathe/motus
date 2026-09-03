"use client"

import React, { useCallback, useEffect, useState } from 'react'
import type { LeaderboardEntry } from '../lib/leaderboard'
import { filterPublicLeaderboardEntries } from '../lib/leaderboard'

interface LeaderboardModalProps {
  open: boolean
  onClose: () => void
}

const POLL_MS = 15_000

export default function LeaderboardModal({ open, onClose }: LeaderboardModalProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard')
      if (!res.ok) throw new Error('Failed to load leaderboard')
      const data = await res.json()
      setEntries(filterPublicLeaderboardEntries(data.entries ?? []))
      setError(null)
    } catch {
      setError(`Leaderboard unavailable. Retrying every ${POLL_MS / 1000} seconds.`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return

    // Loading flag for the fetch below; standard data-fetching effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void fetchLeaderboard()

    const interval = window.setInterval(() => {
      void fetchLeaderboard()
    }, POLL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [open, fetchLeaderboard])

  if (!open) return null

  return (
    <div className="overlay-center leaderboard-overlay" onClick={onClose}>
      <div className="overlay-backdrop" />
      <div
        className="rules-modal leaderboard-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <span className="modal-eyebrow">SURVIVAL // GLOBAL</span>
        <h2 id="leaderboard-title" className="leaderboard-modal-title">
          Leaderboard
        </h2>
        <p className="leaderboard-modal-subtitle">Top 7 · highest score per player</p>

        <div aria-live="polite">
          {loading && <p className="leaderboard-status">Loading…</p>}
          {error && <p className="leaderboard-status leaderboard-error">{error}</p>}

          {!loading && !error && (
            <ol className="leaderboard-list">
              {entries.length === 0 ? (
                <li className="leaderboard-empty">No runs logged yet.</li>
              ) : (
                entries.map((entry, i) => (
                  <li key={entry.username} className="leaderboard-row">
                    <span className="leaderboard-rank">{String(i + 1).padStart(2, '0')}</span>
                    <span className="leaderboard-name">{entry.username}</span>
                    <span className="leaderboard-score">{entry.score.toLocaleString()}</span>
                  </li>
                ))
              )}
            </ol>
          )}
        </div>

        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
