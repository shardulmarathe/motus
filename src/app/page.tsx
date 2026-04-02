"use client";
import React, { useRef, useEffect, useState } from 'react'
import GameCanvas from '../components/GameCanvas'

interface GameState {
  score: number
  stage: number
  mode: string
  eventTimeLeft?: number
  inEvent?: boolean
  eventName?: string
}

export default function Page() {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    stage: 1,
    mode: 'Normal',
  })
  const [isPaused, setIsPaused] = useState(false)

  const gameCanvasRef = useRef<any>(null)

  // Listen for game state updates from GameCanvas
  useEffect(() => {
    const handleStateChange = (e: any) => {
      if (e.detail) {
        setGameState(e.detail)
      }
    }

    window.addEventListener('gameStateUpdate', handleStateChange)
    return () => window.removeEventListener('gameStateUpdate', handleStateChange)
  }, [])

  const handlePauseClick = () => {
    setIsPaused(!isPaused)
    // Dispatch pause event to canvas
    window.dispatchEvent(new CustomEvent('gamePause', { detail: !isPaused }))
  }

  return (
    <main className="page">
      {/* Top Header - Score | Stage | Center Status | Menu */}
      <div className="hud-overlay">
        {/* Score Box */}
        <div className="hud-box score-box">
          <div className="box-label">SCORE</div>
          <div className="box-value">{gameState.score.toString().padStart(3, '0')}</div>
        </div>

        {/* Stage Box */}
        <div className="hud-box stage-box">
          <div className="box-label">STAGE</div>
          <div className="box-value">{gameState.stage}</div>
        </div>

        {/* Center Status Area - Shows event name during event */}
        <div className="center-status">
          {gameState.inEvent && gameState.eventName ? (
            <div className="status-text event-name">{gameState.eventName}</div>
          ) : null}
        </div>

        {/* Menu Button (Pause) */}
        <button 
          className="menu-button"
          onClick={handlePauseClick}
          title={isPaused ? 'Resume' : 'Pause'}
        >
          <span className="menu-icon">{isPaused ? '▶' : '⏸'}</span>
          <span className="menu-text">{isPaused ? 'RESUME' : 'PAUSE'}</span>
        </button>
      </div>

      {/* Gameplay Area - Canvas positioned below HUD */}
      <div className="canvas-wrap">
        <GameCanvas 
          ref={gameCanvasRef} 
          onStateChange={setGameState}
          isPaused={isPaused}
        />
      </div>

      {/* Pause Overlay */}
      {isPaused && (
        <div className="pause-overlay">
          <div className="pause-content">
            <div className="pause-text">PAUSED</div>
            <div className="pause-hint">Click PAUSE button to resume</div>
          </div>
        </div>
      )}
    </main>
  )
}

