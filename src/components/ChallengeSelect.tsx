"use client"

import React, { useMemo } from 'react'
import { challenges, loadProgress, isChallengeUnlocked, challengeStats, type Challenge } from '../lib/challenges'

interface ChallengeSelectProps {
  onSelect: (challenge: Challenge) => void
  onClose: () => void
}

function Stars({ count }: { count: number }) {
  return (
    <span className="stars">
      {[1, 2, 3].map((n) => (
        <span key={n} className={n <= count ? 'star on' : 'star'}>★</span>
      ))}
    </span>
  )
}

/** Progression screen: 100 challenges, unlock-gated, showing stars + best. */
export default function ChallengeSelect({ onSelect, onClose }: ChallengeSelectProps) {
  const progress = useMemo(() => loadProgress(), [])
  const summary = useMemo(() => challengeStats(), [])

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 85 }}>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="rules-modal challenge-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="glow-text">Challenges</h2>
        <p className="challenge-progress-line">
          {summary.completedCount}/100 cleared · {summary.totalStars}/300 stars
        </p>

        <div className="challenge-grid">
          {challenges.map((ch) => {
            const rec = progress[ch.id]
            const unlocked = isChallengeUnlocked(ch.id, progress)
            const cleared = rec?.completed
            return (
              <button
                key={ch.id}
                className={`challenge-card${unlocked ? '' : ' locked'}${cleared ? ' cleared' : ''}`}
                onClick={() => unlocked && onSelect(ch)}
                disabled={!unlocked}
                title={unlocked ? ch.title : 'Locked — beat the previous challenge'}
              >
                <span className="challenge-num">{ch.id}</span>
                <span className="challenge-title">{unlocked ? ch.title : '🔒'}</span>
                {cleared ? <Stars count={rec.bestStars} /> : <span className="challenge-tier">Tier {ch.tier}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
