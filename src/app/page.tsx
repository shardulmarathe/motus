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
          <div className="hud-left">
            <div className="hud-box score-box">
              <div className="box-label">Score</div>
              <div className="box-value">{hud.score}</div>
            </div>

            {gameMode === 'survival' && (
              <div className="hud-box score-box">
                <div className="box-label">Next</div>
                <div className="box-value">{hud.eventProgress}/10</div>
              </div>
            )}
          </div>

          <div className="hud-center">
            {gameMode === 'survival' && (
              hud.mode === 'Event' ? (
                <div className="status-text event-name">{hud.eventName}</div>
              ) : (
                <div className="status-text">Stage {hud.stage}</div>
              )
            )}

            {gameMode === 'tutorial' && (
              <div className="status-text status-text-tutorial">{hud.eventName}</div>
            )}
          </div>

          <div className="hud-right">
            <button
              className="menu-button"
              onClick={() => setUiState('paused')}
              aria-label="Menu"
              title="Menu"
            >
              <span className="menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
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
          <div className="title-screen-center">
            <div className="title-screen-inner">
              <h1 className="glow-text title-logo" style={{ fontSize: 110, color: '#06b6d4', margin: 0 }}>
                Motus
              </h1>
              <div className="mode-btn-row">
                <button
                  className="mode-btn"
                  onClick={() => { setGameMode('tutorial'); setUiState('rules') }}
                >
                  <div className="mode-btn-title">Tutorial Mode</div>
                  <div className="mode-btn-desc">Learn the basics of gameplay step-by-step.</div>
                </button>

                <button
                  className="mode-btn"
                  onClick={() => { setGameMode('survival'); setUiState('rules') }}
                >
                  <div className="mode-btn-title">Survival Mode</div>
                  <div className="mode-btn-desc">Avoid enemies and score points. Be the Best!</div>
                </button>

                <button
                  className="mode-btn"
                  onClick={() => { setGameMode('zen'); setUiState('rules') }}
                >
                  <div className="mode-btn-title">Practice Mode</div>
                  <div className="mode-btn-desc">There are no enemies; only good vibes!</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dark blur overlay + Rules modal */}
        {uiState === 'rules' && (
          <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 80 }}>
            <div className="overlay-backdrop" />
            <div className="rules-modal">
              <h2 className="glow-text">
                {gameMode === 'zen' ? 'Practice Mode – Rules' :
                 gameMode === 'tutorial' ? 'Tutorial Mode – Rules' :
                 'Survival Mode – Rules'}
              </h2>
              <div>
                {gameMode === 'zen' ? (
                  <ul>
                    <li>No enemies</li>
                    <li>No death — you cannot lose</li>
                    <li>Wrap-around borders (teleport to opposite side)</li>
                    <li>Focus on collecting green orbs and movement</li>
                  </ul>
                ) : gameMode === 'tutorial' ? (
                  <ul>
                    <li>Learn the game mechanics step-by-step</li>
                    <li>Follow instructions to complete each tutorial step</li>
                    <li>Practice movement and goal collection</li>
                    <li>Learn to avoid enemies in a safe environment</li>
                  </ul>
                ) : (
                  <ul>
                    <li>Move with arrow keys or click to boost toward the cursor.</li>
                    <li>Avoid red enemies; touch green goals to score.</li>
                    <li>Every few goals triggers a short challenge event.</li>
                    <li>Stay inside the field — edges will warn you.</li>
                  </ul>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  className="rules-modal-play"
                  onClick={() => setUiState('playing')}
                >
                  Play
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pause Modal */}
        {uiState === 'paused' && (
          <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 90 }}>
            <div className="overlay-backdrop" />
            <div className="pause-modal">
              <div className="pause-modal-title glow-text">Paused</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  className="pause-modal-btn pause-modal-btn-resume"
                  onClick={() => setUiState('playing')}
                >
                  Resume
                </button>
                <button
                  className="pause-modal-btn pause-modal-btn-restart"
                  onClick={() => {
                    setGameMode(gameMode);
                    setUiState('rules');
                  }}
                >
                  Restart
                </button>
                <button
                  className="pause-modal-btn pause-modal-btn-menu"
                  onClick={() => setUiState('title')}
                >
                  Menu
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

