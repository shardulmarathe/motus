"use client"

import React from 'react'
import { MP_VARIANT_NAMES, type MatchResult } from '../lib/modes'
import { MP_P2_BODY } from '../lib/multiplayer/players'
import { formatDuration } from '../lib/stats'

interface VersusEndScreenProps {
  result: MatchResult
  onRematch: () => void
  onMenu: () => void
  /**
   * 'enabled' shows the Rematch button (default); 'waiting' replaces it with
   * a "waiting for host" note (online guest); 'hidden' drops it entirely
   * (disconnect ends, where no rematch is possible).
   */
  rematch?: 'enabled' | 'waiting' | 'hidden'
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  )
}

/** Lightweight versus end screen — no stats/achievements, just the verdict. */
export default function VersusEndScreen({ result, onRematch, onMenu, rematch = 'enabled' }: VersusEndScreenProps) {
  // A dropped peer is a fault, not a verdict: it reads in red pen and says what
  // happened, even though the remaining player is recorded as the winner.
  const dropped = result.reason === 'disconnect'

  const headline =
    dropped ? 'Opponent disconnected' :
    result.winner === 0 ? 'Player 1 wins' :
    result.winner === 1 ? 'Player 2 wins' :
    result.winner === 'draw' ? 'Draw' :
    'Run over — together'

  // Pen for a clean P1 win, red pen for a fault. P2 keeps their own puck colour
  // — read from the shared constant, never restated here — so the verdict points
  // at the player who actually scored it.
  const headlineClass = dropped
    ? 'end-title end-title-lose'
    : result.winner === 0
      ? 'end-title end-title-win'
      : 'end-title'

  const headlineStyle =
    !dropped && result.winner === 1 ? { color: MP_P2_BODY } : undefined

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 95 }}>
      <div className="overlay-backdrop" />
      <div
        className="rules-modal end-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="versus-end-title"
      >
        <span className="modal-eyebrow">VERSUS // MATCH OVER</span>
        {/* A div, not an h2: `.rules-modal h2` outranks `.end-title-win` and
            would repaint the verdict plain ink. */}
        <div
          id="versus-end-title"
          role="heading"
          aria-level={2}
          className={headlineClass}
          style={headlineStyle}
        >
          {headline}
        </div>
        <p className="end-subtitle">{MP_VARIANT_NAMES[result.variant]}</p>

        <div className="stat-grid end-stat-grid">
          {result.variant === 'coop' ? (
            <>
              <StatRow label="Shared Score" value={result.scores[0].toLocaleString()} />
              {result.cataclysmsCleared !== undefined && (
                <StatRow label="Cataclysms Cleared" value={String(result.cataclysmsCleared)} />
              )}
            </>
          ) : (
            <>
              <StatRow label="Player 1" value={result.scores[0].toLocaleString()} />
              <StatRow
                label="Player 2"
                value={result.scores[1].toLocaleString()}
                valueColor={MP_P2_BODY}
              />
            </>
          )}
          <StatRow label="Match Time" value={formatDuration(result.elapsed)} />
        </div>

        <div className="end-actions">
          {rematch === 'enabled' && (
            <button type="button" className="btn btn-primary" onClick={onRematch}>Rematch</button>
          )}
          {rematch === 'waiting' && (
            <span className="modal-eyebrow" style={{ alignSelf: 'center' }} role="status">
              WAITING FOR HOST
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={onMenu}>Menu</button>
        </div>
      </div>
    </div>
  )
}
