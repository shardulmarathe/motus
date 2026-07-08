"use client"

import React, { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import GameCanvas from '../components/GameCanvas'
import NeonBackground from '../components/NeonBackground'
import TouchControls from '../components/TouchControls'
import {
  filterPublicLeaderboardEntries,
  getUsernameValidationIssue,
  isAllowedUsername,
  isUsernameTakenOnLeaderboard,
  loadRegisteredPlayerName,
  normalizeUsername,
  saveRegisteredPlayerName,
  sanitizeUsernameInput,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  type LeaderboardEntry,
} from '../lib/leaderboard'

const LeaderboardModal = dynamic(() => import('../components/LeaderboardModal'), { ssr: false })

type HudState = {
  score: number
  stage: number
  mode: string
  eventName?: string
  eventProgress?: number
  gameOver?: boolean
}

export default function Home() {
  const [uiState, setUiState] = useState<'title' | 'rules' | 'playing' | 'paused'>('title')
  const [hud, setHud] = useState<HudState>({
    score: 0,
    stage: 1,
    mode: 'Normal',
    eventName: '',
    eventProgress: 0,
  })
  const [gameMode, setGameMode] = useState<'survival' | 'zen' | 'tutorial'>('survival')
  const [sessionBest, setSessionBest] = useState(0)
  const [registeredName, setRegisteredName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([])
  const [leaderboardNamesLoading, setLeaderboardNamesLoading] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [startingSession, setStartingSession] = useState(false)
  const [isTouch, setIsTouch] = useState(false)
  const submittedDeathRef = useRef(false)
  const gameSessionTokenRef = useRef<string | null>(null)

  // Detect coarse-pointer (touch) devices to surface on-screen controls
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setIsTouch(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  const dispatchSpace = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
  }, [])

  useEffect(() => {
    setRegisteredName(loadRegisteredPlayerName())
    try {
      const savedBest = sessionStorage.getItem('motus-session-best')
      if (savedBest) setSessionBest(Number(savedBest) || 0)
    } catch {
      // storage unavailable
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem('motus-session-best', String(sessionBest))
    } catch {
      // storage unavailable
    }
  }, [sessionBest])

  // Fetch top-7 names when a new player needs to pick a username
  useEffect(() => {
    if (uiState !== 'rules' || gameMode !== 'survival' || registeredName) return

    let cancelled = false
    setLeaderboardNamesLoading(true)

    fetch('/api/leaderboard')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setLeaderboardEntries(filterPublicLeaderboardEntries(data.entries ?? []))
      })
      .catch(() => {
        if (!cancelled) setLeaderboardEntries([])
      })
      .finally(() => {
        if (!cancelled) setLeaderboardNamesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [uiState, gameMode, registeredName])

  const submitLeaderboardScore = useCallback(
    async (score: number) => {
      if (gameMode !== 'survival' || submittedDeathRef.current || !registeredName) return

      const sessionToken = gameSessionTokenRef.current
      if (!sessionToken) return

      submittedDeathRef.current = true
      const username = registeredName

      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, score, sessionToken }),
        })
        if (!res.ok) {
          submittedDeathRef.current = false
        }
      } catch {
        submittedDeathRef.current = false
      } finally {
        gameSessionTokenRef.current = null
      }
    },
    [gameMode, registeredName]
  )

  const handleSurvivalGameOver = useCallback(
    (score: number) => {
      void submitLeaderboardScore(score)
    },
    [submitLeaderboardScore]
  )

  const handleStateUpdate = useCallback(
    (s: HudState) => {
      setHud({
        score: s.score ?? 0,
        stage: s.stage ?? 1,
        mode: s.mode ?? 'Normal',
        eventName: s.eventName ?? '',
        eventProgress: s.eventProgress ?? 0,
        gameOver: s.gameOver,
      })

      if (gameMode === 'survival' && typeof s.score === 'number') {
        setSessionBest((prev) => Math.max(prev, s.score))
      }
    },
    [gameMode]
  )

  useEffect(() => {
    if (uiState === 'playing') {
      submittedDeathRef.current = false
    }
    if (uiState === 'title') {
      gameSessionTokenRef.current = null
    }
  }, [uiState])

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

  const draftNameIssue = getUsernameValidationIssue(
    draftName,
    isAllowedUsername(draftName) &&
      isUsernameTakenOnLeaderboard(draftName, leaderboardEntries, null)
  )

  const canPlaySurvival =
    gameMode !== 'survival' ||
    (!startingSession &&
      (registeredName
        ? true
        : draftNameIssue === null && draftName.trim().length >= USERNAME_MIN_LENGTH && !leaderboardNamesLoading))

  const handleStartPlaying = async () => {
    let survivalName = registeredName

    if (gameMode === 'survival') {
      if (!survivalName) {
        if (!isAllowedUsername(draftName) || getUsernameValidationIssue(
          draftName,
          isUsernameTakenOnLeaderboard(draftName, leaderboardEntries, null)
        )) return
        survivalName = normalizeUsername(draftName)
        setRegisteredName(survivalName)
        saveRegisteredPlayerName(survivalName)
      }

      setStartingSession(true)
      gameSessionTokenRef.current = null

      try {
        const res = await fetch('/api/leaderboard/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: survivalName }),
        })
        if (res.ok) {
          const data = await res.json()
          if (typeof data.sessionToken === 'string') {
            gameSessionTokenRef.current = data.sessionToken
          }
        }
      } catch {
        // Play without leaderboard submit if session service is unavailable
      } finally {
        setStartingSession(false)
      }
    }

    setUiState('playing')
  }

  return (
    <div className="page">
      {uiState === 'title' && (
        <>
          <div className="home-background" />
          <NeonBackground />
        </>
      )}

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
            {gameMode === 'survival' && (
              <div className="hud-box score-box">
                <div className="box-label">Best</div>
                <div className="box-value">{sessionBest}</div>
              </div>
            )}
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

      <main className="canvas-wrap game-area">
        {uiState !== 'title' && (
          <GameCanvas
            gameMode={gameMode}
            uiState={uiState}
            isPaused={uiState !== 'playing'}
            onStateChange={handleStateUpdate}
            onSurvivalGameOver={handleSurvivalGameOver}
          />
        )}

        {uiState === 'playing' && isTouch && (
          <>
            <TouchControls />
            <div className="rotate-hint">Rotate your device for a bigger play area</div>
            {(hud.gameOver || gameMode === 'tutorial') && (
              <button
                type="button"
                className="touch-action-btn"
                onClick={dispatchSpace}
                aria-label={gameMode === 'tutorial' ? 'Respawn' : 'Restart'}
              >
                {gameMode === 'tutorial' ? 'Respawn' : 'Restart'}
              </button>
            )}
          </>
        )}

        {uiState === 'title' && (
          <div className="title-screen-center">
            <div className="title-screen-inner">
              <h1 className="glow-text title-logo">
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

                <button
                  type="button"
                  className="mode-btn"
                  onClick={() => setLeaderboardOpen(true)}
                >
                  <div className="mode-btn-title">Leaderboard</div>
                  <div className="mode-btn-desc">See who is on top.</div>
                </button>
              </div>
            </div>
          </div>
        )}

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
                    <li>Move with arrow keys or WASD.</li>
                    <li>Avoid red enemies; touch green goals to score.</li>
                    <li>Every few goals triggers a short challenge event.</li>
                    <li>Stay inside the field — edges will warn you.</li>
                  </ul>
                )}
              </div>

              {gameMode === 'survival' && registeredName && (
                <p className="username-registered">
                  Playing as <strong>{registeredName}</strong>
                </p>
              )}

              {gameMode === 'survival' && !registeredName && (
                <div className="username-field">
                  <label htmlFor="player-name" className="username-label">
                    Choose your display name
                  </label>
                  <input
                    id="player-name"
                    className={`username-input${draftNameIssue ? ' username-input-invalid' : ''}`}
                    type="text"
                    maxLength={USERNAME_MAX_LENGTH}
                    placeholder="Pick a name not on the leaderboard"
                    value={draftName}
                    onChange={(e) => setDraftName(sanitizeUsernameInput(e.target.value))}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-invalid={draftNameIssue !== null}
                    aria-describedby={draftNameIssue ? 'player-name-hint' : undefined}
                    autoFocus
                  />
                  <p
                    id="player-name-hint"
                    className="username-meta"
                    aria-live="polite"
                  >
                    {draftName.trim().length}/{USERNAME_MAX_LENGTH} characters
                  </p>
                  {draftNameIssue === 'too_short' && (
                    <p className="username-hint">At least {USERNAME_MIN_LENGTH} characters required.</p>
                  )}
                  {draftNameIssue === 'invalid_chars' && (
                    <p className="username-hint">
                      {USERNAME_MIN_LENGTH}–{USERNAME_MAX_LENGTH} characters: letters, numbers, spaces, - or _
                    </p>
                  )}
                  {draftNameIssue === 'inappropriate' && (
                    <p className="username-hint">That username isn&apos;t allowed — please pick another.</p>
                  )}
                  {draftNameIssue === 'taken' && (
                    <p className="username-hint">That name is already on the leaderboard — pick another.</p>
                  )}
                  {leaderboardNamesLoading && (
                    <p className="username-hint" style={{ color: '#94a3b8' }}>Checking leaderboard names…</p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  className="rules-modal-play"
                  disabled={!canPlaySurvival}
                  onClick={() => void handleStartPlaying()}
                >
                  {startingSession ? 'Starting…' : 'Play'}
                </button>
              </div>
            </div>
          </div>
        )}

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
                  onClick={() => setUiState('rules')}
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

      <LeaderboardModal open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} />
    </div>
  )
}
