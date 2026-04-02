"use client"

import React, { useCallback, useState } from 'react'
import GameCanvas from '../components/GameCanvas'

export default function Home() {
  const [uiState, setUiState] = useState<'title' | 'rules' | 'playing' | 'paused'>('title')
  const [hud, setHud] = useState({ score: 0, stage: 1, mode: 'Normal', eventName: '' })

  const handleStateUpdate = useCallback((s: any) => {
    setHud({ score: s.score ?? 0, stage: s.stage ?? 1, mode: s.mode ?? 'Normal', eventName: s.eventName ?? '' })
  }, [])

  return (
    <div className="page">
      {/* HUD Overlay */}
      <div className="hud-overlay">
        <div className="hud-box score-box">
          <div className="box-label">Score</div>
          <div className="box-value">{hud.score}</div>
        </div>

        <div className="center-status">
          {hud.mode === 'Event' ? (
            <div className="status-text event-name">{hud.eventName}</div>
          ) : (
            <div className="status-text">Stage {hud.stage}</div>
          )}
        </div>

        <button
          className="menu-button"
          onClick={() => setUiState('paused')}
          aria-label="Menu"
        >
          <div className="menu-icon">☰</div>
          <div className="menu-text">Menu</div>
        </button>
      </div>

      {/* Canvas area */}
      <div className="canvas-wrap">
        <GameCanvas uiState={uiState} isPaused={uiState !== 'playing'} onStateChange={handleStateUpdate} />

        {/* Title Screen (no blur/dim) */}
        {uiState === 'title' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', zIndex: 50 }}>
            <div style={{ textAlign: 'center' }}>
              <h1 className="glow-text" style={{ fontSize: 64, color: '#06b6d4', marginBottom: 12 }}>
                Survive the Field
              </h1>
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => setUiState('rules')}
                  style={{
                    background: 'rgba(6,182,212,0.08)',
                    border: '1px solid rgba(6,182,212,0.25)',
                    color: '#e6eef8',
                    padding: '18px 28px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'transform 0.2s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#67e8f9' }}>Endless Mode</div>
                  <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 6 }}>Survive as long as possible. Avoid enemies. Complete events.</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dark blur overlay + Rules modal */}
        {uiState === 'rules' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', transition: 'opacity 220ms' }} />
            <div style={{ width: 560, background: 'rgba(12,18,30,0.72)', borderRadius: 14, padding: 28, boxShadow: '0 8px 30px rgba(6,182,212,0.08)', color: '#e6eef8', textAlign: 'center', transform: 'translateY(0)', transition: 'all 240ms' }}>
              <h2 className="glow-text" style={{ fontSize: 32, color: '#67e8f9', marginBottom: 8 }}>Survive the Field</h2>
              <div style={{ color: '#cbd5e1', marginBottom: 16 }}>
                <ul style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Move using arrow keys or mouse boost</li>
                  <li>Avoid red enemies</li>
                  <li>Collect green goals</li>
                  <li>Every 10 goals triggers a challenge</li>
                  <li>Stay inside the field</li>
                </ul>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  onClick={() => setUiState('playing')}
                  style={{
                    background: '#06b6d4',
                    color: '#042027',
                    padding: '12px 28px',
                    borderRadius: 10,
                    fontWeight: 700,
                    boxShadow: '0 6px 18px rgba(6,182,212,0.18)',
                    transition: 'transform 200ms',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  PLAY
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pause Modal */}
        {uiState === 'paused' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', transition: 'opacity 220ms' }} />
            <div style={{ width: 420, background: 'rgba(12,18,30,0.78)', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 8px 30px rgba(6,182,212,0.08)' }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: '#06b6d4', marginBottom: 12 }} className="glow-text">Paused</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12 }}>
                <button
                  onClick={() => setUiState('playing')}
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#e6eef8', cursor: 'pointer', fontWeight: 700 }}
                >
                  Resume
                </button>
                <button
                  onClick={() => setUiState('title')}
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#ffdddd', cursor: 'pointer', fontWeight: 700 }}
                >
                  Exit to Menu
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

