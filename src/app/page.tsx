"use client"

import React, { useCallback, useState, useEffect } from 'react'
import GameCanvas from '../components/GameCanvas'
import ParticleBackground from '../components/ParticleBackground'
import WaterDistortion from '../components/WaterDistortion'

export default function Home() {
  const [uiState, setUiState] = useState<'title' | 'rules' | 'playing' | 'paused'>('title')
  const [hud, setHud] = useState({ score: 0, stage: 1, mode: 'Normal', eventName: '', eventProgress: 0 })
  const [gameMode, setGameMode] = useState<'survival' | 'zen' | 'tutorial'>('survival')

  const handleStateUpdate = useCallback((s: any) => {
    setHud({ score: s.score ?? 0, stage: s.stage ?? 1, mode: s.mode ?? 'Normal', eventName: s.eventName ?? '', eventProgress: s.eventProgress ?? 0 })
  }, [])

  // Handle tutorial completion
  useEffect(() => {
    const handleSwitchToSurvival = () => {
      setGameMode('survival')
      setUiState('rules')
    }

    const handleReturnToMenu = () => {
      setUiState('title')
    }

    window.addEventListener('switchToSurvival', handleSwitchToSurvival)
    window.addEventListener('returnToMenu', handleReturnToMenu)
    return () => {
      window.removeEventListener('switchToSurvival', handleSwitchToSurvival)
      window.removeEventListener('returnToMenu', handleReturnToMenu)
    }
  }, [])

  return (
    <div className="page">
      {/* Only show animated background on home screen */}
      {uiState === 'title' && (
        <>
          <div className="home-background" />
          <WaterDistortion />
          <ParticleBackground />
        </>
      )}
      
      {/* HUD only visible while actively playing or paused (no HUD on title/rules) */}
      {(uiState === 'playing' || uiState === 'paused') && (
        <header className="hud-overlay">
          <>
            <div className="hud-box score-box">
              <div className="box-label">Score</div>
              <div className="box-value">{hud.score}</div>
            </div>

            {gameMode !== 'tutorial' && (
              <div className="hud-box score-box">
                <div className="box-label">Next</div>
                <div className="box-value">{hud.eventProgress}/10</div>
              </div>
            )}

            {gameMode === 'survival' && (
              <div className="center-status">
                {hud.mode === 'Event' ? (
                  <div className="status-text event-name">{hud.eventName}</div>
                ) : (
                  <div className="status-text">Stage {hud.stage}</div>
                )}
              </div>
            )}

            {gameMode === 'tutorial' && (
              <div className="center-status">
                <div className="status-text">{hud.eventName}</div>
              </div>
            )}

            <button
              className="menu-button"
              onClick={() => setUiState('paused')}
              aria-label="Menu"
            >
              <div className="menu-icon">☰</div>
              <div className="menu-text">Menu</div>
            </button>
          </>
        </header>
      )}


      {/* Canvas area: only initialize/render game when not on the main title screen.
          For "rules" we render a paused/dimmed game behind the overlay. */}
      <main className="canvas-wrap game-area">
        {uiState !== 'title' && (
          <GameCanvas gameMode={gameMode} uiState={uiState} isPaused={uiState !== 'playing'} onStateChange={handleStateUpdate} />
        )}

        {/* Title Screen (clean, minimal - no game HUD, no boundaries) */}
        {uiState === 'title' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', zIndex: 50 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36, transform: 'translateY(-6vh)' }}>
              <h1 className="glow-text" style={{ fontSize: 110, color: '#06b6d4', margin: 0 }}>
                Motus
              </h1>
              <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
                <button
                  onClick={() => { setGameMode('tutorial'); setUiState('rules') }}
                  style={{
                    minWidth: 200,
                    background: 'rgba(6,182,212,0.08)',
                    border: '1px solid rgba(6,182,212,0.25)',
                    color: '#e6eef8',
                    padding: '24px 28px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'transform 0.24s ease, box-shadow 240ms',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#67e8f9' }}>Tutorial Mode</div>
                  <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 6 }}>Learn the basics step-by-step.</div>
                </button>

                <button
                  onClick={() => { setGameMode('survival'); setUiState('rules') }}
                  style={{
                    minWidth: 200,
                    background: 'rgba(6,182,212,0.06)',
                    border: '1px solid rgba(6,182,212,0.18)',
                    color: '#e6eef8',
                    padding: '24px 28px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'transform 0.24s ease, box-shadow 240ms',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#67e8f9' }}>Survival Mode</div>
                  <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 6 }}>Avoid enemies and score points.</div>
                </button>

                <button
                  onClick={() => { setGameMode('zen'); setUiState('rules') }}
                  style={{
                    minWidth: 200,
                    background: 'rgba(6,182,212,0.06)',
                    border: '1px solid rgba(6,182,212,0.18)',
                    color: '#e6eef8',
                    padding: '24px 28px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'transform 0.24s ease, box-shadow 240ms',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#67e8f9' }}>Practice Mode</div>
                  <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 6 }}>No enemies; just have fun!</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dark blur overlay + Rules modal */}
        {uiState === 'rules' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', transition: 'opacity 220ms', zIndex: 10, pointerEvents: 'auto' }} />
            <div style={{ position: 'relative', zIndex: 20, width: 560, background: 'rgba(12,18,30,0.78)', borderRadius: 14, padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.6)', color: '#e6eef8', textAlign: 'center', transform: 'translateY(0)', transition: 'all 240ms' }}>
              <h2 className="glow-text" style={{ fontSize: 28, color: '#67e8f9', marginBottom: 10 }}>
                {gameMode === 'zen' ? 'Practice Mode – Rules' : 
                 gameMode === 'tutorial' ? 'Tutorial Mode – Rules' : 
                 'Survival Mode – Rules'}
              </h2>
              <div style={{ color: '#cbd5e1', marginBottom: 18 }}>
                {gameMode === 'zen' ? (
                  <ul style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>No enemies</li>
                    <li>No death — you cannot lose</li>
                    <li>Wrap-around borders (teleport to opposite side)</li>
                    <li>Focus on collecting green orbs and movement</li>
                  </ul>
                ) : gameMode === 'tutorial' ? (
                  <ul style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>Learn the game mechanics step-by-step</li>
                    <li>Follow instructions to complete each tutorial step</li>
                    <li>Practice movement and goal collection</li>
                    <li>Learn to avoid enemies in a safe environment</li>
                  </ul>
                ) : (
                  <ul style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>Move with arrow keys or click to boost toward the cursor.</li>
                    <li>Avoid red enemies; touch green goals to score.</li>
                    <li>Every few goals triggers a short challenge event.</li>
                    <li>Stay inside the field — edges will warn you.</li>
                  </ul>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  onClick={() => setUiState('playing')}
                  style={{
                    background: '#06b6d4',
                    color: '#042027',
                    padding: '12px 28px',
                    borderRadius: 10,
                    fontWeight: 800,
                    boxShadow: '0 6px 18px rgba(6,182,212,0.18)',
                    transition: 'transform 200ms',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  Play
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pause Modal */}
        {uiState === 'paused' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', transition: 'opacity 220ms', zIndex: 10, pointerEvents: 'auto' }} />
            <div style={{ position: 'relative', zIndex: 20, width: 420, background: 'rgba(12,18,30,0.78)', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 8px 30px rgba(6,182,212,0.08)', transition: 'transform 240ms, opacity 240ms' }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: '#06b6d4', marginBottom: 12 }} className="glow-text">Paused</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12 }}>
                <button
                  onClick={() => setUiState('playing')}
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#e6eef8', cursor: 'pointer', fontWeight: 700 }}
                >
                  Resume
                </button>
                <button
                  onClick={() => {
                    setGameMode(gameMode);
                    setUiState('rules');
                  }}
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fef3c7', cursor: 'pointer', fontWeight: 700 }}
                >
                  Restart
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
      </main>
    </div>
  )
}

