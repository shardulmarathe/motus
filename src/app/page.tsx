"use client";
import React, { useRef, useEffect, useState } from 'react'
import GameCanvas from '../components/GameCanvas'

interface GameState {
  score: number
  stage: number
  mode: string
  eventTimeLeft?: number
  inEvent?: boolean
}

export default function Page() {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    stage: 1,
    mode: 'Normal',
  })

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

  return (
    <main className="page">
      {/* Top HUD Overlay */}
      <div className="hud-overlay">
        <div className="hud-panel hud-left">
          <div className="hud-label">Score</div>
          <div className="hud-value">{gameState.score.toString().padStart(3, '0')}</div>
        </div>

        <div className="hud-panel hud-center">
          <div className="hud-mode">{gameState.mode}</div>
        </div>

        <div className="hud-panel hud-right">
          {gameState.inEvent && gameState.eventTimeLeft !== undefined ? (
            <>
              <div className="hud-label">TIME</div>
              <div 
                className={`hud-timer ${
                  gameState.eventTimeLeft <= 5 
                    ? 'timer-critical' 
                    : gameState.eventTimeLeft <= 10 
                    ? 'timer-warning' 
                    : 'timer-normal'
                }`}
              >
                {Math.ceil(gameState.eventTimeLeft)}s
              </div>
            </>
          ) : (
            <>
              <div className="hud-label">Stage</div>
              <div className="hud-value">{gameState.stage}</div>
            </>
          )}
        </div>
      </div>

      {/* Main Game Canvas */}
      <div className="canvas-wrap">
        <GameCanvas ref={gameCanvasRef} onStateChange={setGameState} />
      </div>

      {/* Bottom Controls */}
      <div className="controls-overlay">
        <div>ARROW KEYS to move • CLICK to boost</div>
        <div>SPACE to restart • Stay inside the deck</div>
      </div>
    </main>
  )
}

