"use client"

import React, { useMemo, useState } from 'react'
import { loadStats, statLabel, formatStat, type LifetimeStats } from '../lib/stats'
import { achievementViews } from '../lib/achievements'

interface ProfileModalProps {
  onClose: () => void
}

const STAT_ORDER: (keyof LifetimeStats)[] = [
  'gamesPlayed', 'gamesWon', 'totalDeaths', 'highestScore',
  'totalOrbs', 'cataclysmsTriggered', 'challengesCompleted', 'starsEarned',
  'longestSurvival', 'totalPlayTime', 'totalDistance', 'longestDrift',
]

/** Profile: lifetime statistics and achievements, in two tabs. */
export default function ProfileModal({ onClose }: ProfileModalProps) {
  const [tab, setTab] = useState<'stats' | 'achievements'>('stats')
  const stats = useMemo(() => loadStats(), [])
  const achievements = useMemo(() => achievementViews(), [])
  const unlockedCount = achievements.filter((a) => a.unlocked).length

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 85 }}>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="rules-modal profile-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <span className="modal-eyebrow">PROFILE // LIFETIME RECORD</span>
        <h2>Profile</h2>

        <div className="tabs">
          <button
            type="button"
            className={`tab${tab === 'stats' ? ' active' : ''}`}
            aria-pressed={tab === 'stats'}
            onClick={() => setTab('stats')}
          >
            Statistics
          </button>
          <button
            type="button"
            className={`tab${tab === 'achievements' ? ' active' : ''}`}
            aria-pressed={tab === 'achievements'}
            onClick={() => setTab('achievements')}
          >
            Achievements {unlockedCount}/{achievements.length}
          </button>
        </div>

        {tab === 'stats' ? (
          <div className="stat-grid">
            {STAT_ORDER.map((key) => (
              <div className="stat-row" key={key}>
                <span className="stat-row-label">{statLabel(key)}</span>
                <span className="stat-row-value">{formatStat(key, stats[key])}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="achv-list" role="list">
            {achievements.map((a) => (
              <div
                className={`achv-row${a.unlocked ? ' unlocked' : ''}`}
                key={a.id}
                role="listitem"
                aria-label={`${a.name}. ${a.description}. ${a.unlocked ? 'Unlocked.' : 'Locked.'}`}
              >
                {/* The tile is the frame; an empty socket reads as not-yet-lit. */}
                <span className="achv-icon" aria-hidden="true">{a.unlocked ? a.icon : '—'}</span>
                <span className="achv-text">
                  <span className="achv-name">{a.name}</span>
                  <span className="achv-desc">{a.description}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
