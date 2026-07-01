"use client"

import React, { useCallback, useEffect, useState } from 'react'
import type { LeaderboardEntry } from '../lib/leaderboard'
import { filterPublicLeaderboardEntries } from '../lib/leaderboard'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

interface LeaderboardModalProps {
  open: boolean
  onClose: () => void
}

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
      setError('Could not load leaderboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return

    setLoading(true)
    fetchLeaderboard()

    let supabase: SupabaseClient | null = null
    let channel: RealtimeChannel | null = null
    let cancelled = false

    void (async () => {
      try {
        const { createBrowserSupabaseClient } = await import('../lib/supabase/client')
        if (cancelled) return
        supabase = createBrowserSupabaseClient()
        channel = supabase
          .channel('leaderboard-changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'leaderboard' },
            () => {
              fetchLeaderboard()
            }
          )
          .subscribe()
      } catch {
        // Env missing locally — still show fetched data
      }
    })()

    return () => {
      cancelled = true
      if (supabase && channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [open, fetchLeaderboard])

  if (!open) return null

  return (
    <div className="overlay-center leaderboard-overlay" onClick={onClose}>
      <div className="overlay-backdrop" />
      <div
        className="leaderboard-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="leaderboard-title"
      >
        <h2 id="leaderboard-title" className="glow-text leaderboard-modal-title">
          Top 7 Leaderboard
        </h2>
        <p className="leaderboard-modal-subtitle">Survival Mode — highest scores</p>

        {loading && <p className="leaderboard-status">Loading…</p>}
        {error && <p className="leaderboard-status leaderboard-error">{error}</p>}

        {!loading && !error && (
          <ol className="leaderboard-list">
            {entries.length === 0 ? (
              <li className="leaderboard-empty">No scores yet — be the first!</li>
            ) : (
              entries.map((entry, i) => (
                <li key={entry.username} className="leaderboard-row">
                  <span className="leaderboard-rank">{i + 1}</span>
                  <span className="leaderboard-name">{entry.username}</span>
                  <span className="leaderboard-score">{entry.score}</span>
                </li>
              ))
            )}
          </ol>
        )}

        <button type="button" className="rules-modal-play" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
