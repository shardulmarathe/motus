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
  const headline =
    result.winner === 0 ? 'Player 1 wins' :
    result.winner === 1 ? 'Player 2 wins' :
    result.winner === 'draw' ? 'Draw' :
    'Run over — together'

  // P1 keeps the theme's win green; P2 is tinted with their puck color below.
  const headlineClass = result.winner === 0 ? 'end-title end-title-win' : 'end-title'

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 95 }}>
      <div className="overlay-backdrop" />
      <div className="rules-modal end-modal">
        <span className="modal-eyebrow">VERSUS // MATCH OVER</span>
        <div
          className={headlineClass}
          style={result.winner === 1 ? { color: MP_P2_BODY, textShadow: `0 0 24px ${MP_P2_BODY}88` } : undefined}
        >
          {headline}
        </div>
        <div className="end-subtitle">{MP_VARIANT_NAMES[result.variant]}</div>

        <div className="stat-grid end-stat-grid">
          {result.variant === 'coop' ? (
            <>
              <StatRow label="Shared Score" value={String(result.scores[0])} />
              {result.cataclysmsCleared !== undefined && (
                <StatRow label="Cataclysms Cleared" value={String(result.cataclysmsCleared)} />
              )}
            </>
          ) : (
            <>
              <StatRow label="Player 1" value={String(result.scores[0])} />
              <StatRow label="Player 2" value={String(result.scores[1])} valueColor={MP_P2_BODY} />
            </>
          )}
          <StatRow label="Match Time" value={formatDuration(result.elapsed)} />
        </div>

        <div className="end-actions">
          {rematch === 'enabled' && (
            <button className="btn btn-primary" onClick={onRematch}>Rematch</button>
          )}
          {rematch === 'waiting' && (
            <span className="modal-eyebrow" style={{ alignSelf: 'center' }}>
              WAITING FOR HOST…
            </span>
          )}
          <button className="btn btn-ghost" onClick={onMenu}>Menu</button>
        </div>
      </div>
    </div>
  )
}
