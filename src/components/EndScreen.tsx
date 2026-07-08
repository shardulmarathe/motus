"use client"

import React from 'react'
import type { RunSummary } from '../lib/stats'
import { formatDuration } from '../lib/stats'

interface EndScreenProps {
  summary: RunSummary
  newPersonalBest: boolean
  stars?: number
  challengeTitle?: string
  hasNextChallenge?: boolean
  onRetry: () => void
  onMenu: () => void
  onNext?: () => void
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-value">{value}</span>
    </div>
  )
}

/** Rich end-of-run screen: headline score, PB badge, run stats, and actions. */
export default function EndScreen({
  summary,
  newPersonalBest,
  stars,
  challengeTitle,
  hasNextChallenge,
  onRetry,
  onMenu,
  onNext,
}: EndScreenProps) {
  const won = summary.won
  const title = challengeTitle
    ? won ? 'Challenge Complete' : 'Challenge Failed'
    : 'Game Over'

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 95 }}>
      <div className="overlay-backdrop" />
      <div className="rules-modal end-modal">
        <div className={`end-title ${won ? 'end-title-win' : 'end-title-lose'}`}>{title}</div>
        {challengeTitle && <div className="end-subtitle">{challengeTitle}</div>}

        {typeof stars === 'number' && (
          <div className="stars stars-lg" aria-label={`${stars} of 3 stars`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= stars ? 'star on' : 'star'}>★</span>
            ))}
          </div>
        )}

        <div className="end-score-label">Final Score</div>
        <div className="end-score glow-text">{summary.score.toLocaleString()}</div>
        {newPersonalBest && <div className="pb-badge">New Personal Best</div>}

        <div className="stat-grid end-stat-grid">
          <StatRow label="Time Survived" value={formatDuration(summary.timeSurvived)} />
          <StatRow label="Orbs Collected" value={String(summary.orbsCollected)} />
          <StatRow label="Highest Combo" value={`x${summary.highestCombo}`} />
          <StatRow label="Near Misses" value={String(summary.nearMisses)} />
          <StatRow label="Distance" value={`${Math.round(summary.distanceTraveled).toLocaleString()} px`} />
          <StatRow label="Longest Drift" value={`${Math.round(summary.longestDrift).toLocaleString()} px`} />
          <StatRow label="Avg Speed" value={`${Math.round(summary.averageSpeed)} px/s`} />
          <StatRow label="Top Speed" value={`${Math.round(summary.highestSpeed)} px/s`} />
          {summary.cataclysmsTriggered > 0 && (
            <StatRow label="Cataclysms" value={String(summary.cataclysmsTriggered)} />
          )}
        </div>

        <div className="end-actions">
          <button className="pause-modal-btn pause-modal-btn-resume" onClick={onRetry}>Retry</button>
          {won && hasNextChallenge && onNext && (
            <button className="pause-modal-btn pause-modal-btn-restart" onClick={onNext}>Next Challenge</button>
          )}
          <button className="pause-modal-btn pause-modal-btn-menu" onClick={onMenu}>Main Menu</button>
        </div>
      </div>
    </div>
  )
}
