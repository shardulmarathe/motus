"use client"

import React from 'react'
import TraceStrip from './TraceStrip'
import type { RunSummary } from '../lib/stats'
import { formatDuration, formatCompact } from '../lib/stats'

interface EndScreenProps {
  summary: RunSummary
  newPersonalBest: boolean
  stars?: number
  challengeTitle?: string
  hasNextChallenge?: boolean
  /** Survival only, when not `ok`, the score never reached the leaderboard. */
  leaderboardSubmitState?: 'ok' | 'unavailable' | 'failed'
  onRetry: () => void
  onMenu: () => void
  onNext?: () => void
}

/** Height of the run trace, in CSS px. The plot is the screen's subject. */
const TRACE_HEIGHT = 104

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-value">{value}</span>
    </div>
  )
}

/**
 * End of run, plotted: the run's own speed trace with the stop marked, and the
 * score read off it as an annotation. A run too short to plot shows the numbers
 * alone, an empty chart would be a shape the run never made.
 *
 * The trace is drawn as ink, not light: `TraceStrip` defaults `glow` to 0 and
 * resolves its stroke from `--pen` off the `.end-trace` wrapper, which also
 * lightens the fill wash so the line stays the subject on a light sheet.
 */
export default function EndScreen({
  summary,
  newPersonalBest,
  stars,
  challengeTitle,
  hasNextChallenge,
  leaderboardSubmitState,
  onRetry,
  onMenu,
  onNext,
}: EndScreenProps) {
  const won = summary.won
  const title = challengeTitle
    ? won ? 'Challenge Complete' : 'Challenge Failed'
    : 'Game Over'

  const samples = summary.speedSamples ?? []
  // Two points is the minimum that describes motion; below that there is no
  // trace to draw, so we show none rather than inventing one.
  const hasTrace = samples.length >= 2
  const duration = formatDuration(summary.timeSurvived)
  const leaderboardMissed =
    leaderboardSubmitState != null && leaderboardSubmitState !== 'ok'

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 95 }}>
      <div className="overlay-backdrop" />
      <div
        className="rules-modal end-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-title"
      >
        {/* A div, not an h2: `.rules-modal h2` outranks `.end-title-win` and
            would repaint the verdict plain ink. The role restores the semantics
            the tag would have carried. */}
        <div
          id="end-title"
          role="heading"
          aria-level={2}
          className={`end-title ${won ? 'end-title-win' : 'end-title-lose'}`}
        >
          {title}
        </div>
        {challengeTitle && <div className="end-subtitle">{challengeTitle}</div>}

        {typeof stars === 'number' && (
          <div className="stars stars-lg" aria-label={`${stars} of 3 stars`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= stars ? 'star on' : 'star'}>★</span>
            ))}
          </div>
        )}

        {hasTrace && (
          <>
            <div className="modal-eyebrow">Speed · px/s</div>
            <div className="end-trace">
              <TraceStrip
                mode="static"
                series={samples}
                markEnd
                height={TRACE_HEIGHT}
                label={`Speed over the run: ${duration}, peaking at ${Math.round(summary.highestSpeed)} pixels per second. The cross marks where the run stopped.`}
              />
            </div>
            <div className="end-trace-caption">
              <span>Start</span>
              <span>{won ? `Finish ${duration}` : `Stop ${duration}`}</span>
            </div>
          </>
        )}

        <div className="end-score-label">Final Score</div>
        <div className="end-score">{summary.score.toLocaleString()}</div>
        {newPersonalBest && <div className="pb-badge">New Personal Best</div>}
        {leaderboardMissed && (
          <div className="end-leaderboard-miss" role="status">
            <div className="modal-eyebrow">Leaderboard</div>
            <p className="end-leaderboard-miss-line">
              Score not submitted — leaderboard unavailable
            </p>
          </div>
        )}

        <div className="stat-grid end-stat-grid">
          <StatRow label="Time Survived" value={duration} />
          <StatRow label="Orbs Collected" value={String(summary.orbsCollected)} />
          <StatRow label="Distance" value={`${formatCompact(summary.distanceTraveled)} px`} />
          <StatRow label="Longest Drift" value={`${formatCompact(summary.longestDrift)} px`} />
          <StatRow label="Avg Speed" value={`${Math.round(summary.averageSpeed)} px/s`} />
          <StatRow label="Top Speed" value={`${Math.round(summary.highestSpeed)} px/s`} />
          {summary.cataclysmsTriggered > 0 && (
            <StatRow label="Cataclysms" value={String(summary.cataclysmsTriggered)} />
          )}
        </div>

        <div className="end-actions">
          {won && hasNextChallenge && onNext ? (
            <>
              <button className="btn btn-primary" onClick={onNext}>Next Challenge</button>
              <button className="btn btn-ghost" onClick={onRetry}>Retry</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onRetry}>Retry</button>
          )}
          <button className="btn btn-ghost" onClick={onMenu}>Main Menu</button>
        </div>
      </div>
    </div>
  )
}
