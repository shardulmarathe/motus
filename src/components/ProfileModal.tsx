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
  'longestSurvival', 'totalPlayTime', 'totalDistance', 'longestDrift', 'fastestSpeed',
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
        <h2 className="glow-text">Profile</h2>

        <div className="tabs">
          <button className={`tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>
            Statistics
          </button>
          <button className={`tab${tab === 'achievements' ? ' active' : ''}`} onClick={() => setTab('achievements')}>
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
          <div className="achv-list">
            {achievements.map((a) => (
              <div className={`achv-row${a.unlocked ? ' unlocked' : ''}`} key={a.id}>
                <span className="achv-icon">{a.unlocked ? a.icon : '🔒'}</span>
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
