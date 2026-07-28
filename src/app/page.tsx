"use client"

import React, { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import GameCanvas from '../components/GameCanvas'
import NeonBackground from '../components/NeonBackground'
import TouchControls from '../components/TouchControls'
import ChallengeSelect from '../components/ChallengeSelect'
import SettingsModal from '../components/SettingsModal'
import ProfileModal from '../components/ProfileModal'
import EndScreen from '../components/EndScreen'
import MultiplayerSelect from '../components/MultiplayerSelect'
import VersusEndScreen from '../components/VersusEndScreen'
import {
  MP_VARIANT_NAMES,
  type GameMode,
  type MatchResult,
  type MpSession,
  type MpVariant,
} from '../lib/modes'
import {
  DUEL_TARGET_SCORE,
  DUEL_STUN_SECONDS,
  DUEL_POST_STUN_IMMUNITY,
  COOP_BLEEDOUT_SECONDS,
  COOP_REVIVE_IMMUNITY,
  TAG_ROUND_SECONDS,
} from '../lib/multiplayer/rules'
import { RoomClient } from '../lib/net/room'
import { PROTOCOL_VERSION, type AnyMsg } from '../lib/net/protocol'
import { MP_P2_BODY } from '../lib/multiplayer/players'
import AchievementToast from '../components/AchievementToast'
import TraceStrip from '../components/TraceStrip'
import { applyThemeToDocument, chassisTheme } from '../lib/customization'
import { recordRun, loadStats, type RunSummary } from '../lib/stats'
import { checkAchievements, type Achievement } from '../lib/achievements'
import {
  challenges,
  computeStars,
  recordChallengeResult,
  isChallengeUnlocked,
  challengeStats,
  starRequirements,
  type Challenge,
} from '../lib/challenges'
import { challengeTimeLimit, REFERENCE_ARENA } from '../lib/challenge-par'
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

/**
 * The numbers the title screen puts on its own menu rows. Read from local
 * storage after mount — reading during render would disagree with the server
 * render and break hydration.
 */
type HomeReadouts = {
  best: number
  cleared: number
  stars: number
  runs: number
  instrument: string
}

type HudState = {
  score: number
  stage: number
  mode: string
  eventName?: string
  eventProgress?: number
  gameOver?: boolean
  // Multiplayer-only fields (set by GameCanvas when gameMode === 'multiplayer')
  p1Score?: number
  p2Score?: number
  matchTimeLeft?: number
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
  const [gameMode, setGameMode] = useState<GameMode>('survival')
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null)
  const [mpVariant, setMpVariant] = useState<MpVariant | null>(null)
  const [mpSession, setMpSession] = useState<MpSession | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [menuScreen, setMenuScreen] = useState<'challenges' | 'settings' | 'profile' | 'multiplayer' | null>(null)
  const [endRun, setEndRun] = useState<{
    summary: RunSummary
    newPersonalBest: boolean
    stars?: number
  } | null>(null)
  const [achievementQueue, setAchievementQueue] = useState<Achievement[]>([])
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
  const gameAreaRef = useRef<HTMLElement | null>(null)
  // Online play: one RoomClient for the whole session (lobby → match → end).
  // The ref is the owner; the state mirror exists so effects/props re-run
  // when the client is created or torn down.
  const roomRef = useRef<RoomClient | null>(null)
  const [room, setRoom] = useState<RoomClient | null>(null)
  // Par, deadlines and star bars all scale with the play surface, so the
  // briefing needs the same dimensions the canvas is about to use.
  const [arenaSize, setArenaSize] = useState(REFERENCE_ARENA)

  useEffect(() => {
    const el = gameAreaRef.current
    if (!el) return
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setArenaSize({ width: el.clientWidth, height: el.clientHeight })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

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

  // --- Online multiplayer: room lifecycle -----------------------------------

  /** Lazily create the shared RoomClient (called by the lobby on first online action). */
  const getRoom = useCallback((): RoomClient => {
    if (!roomRef.current) {
      roomRef.current = new RoomClient()
      setRoom(roomRef.current)
    }
    return roomRef.current
  }, [])

  const closeRoom = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.close()
      roomRef.current = null
      setRoom(null)
    }
  }, [])

  /** Guest connected in the lobby: adopt the session; the host's `start` drives the rest. */
  const handleGuestLobby = useCallback((code: string) => {
    setGameMode('multiplayer')
    setMpSession({ kind: 'online', role: 'guest', code })
  }, [])

  const isOnline = mpSession?.kind === 'online'
  const onlineRole = mpSession?.kind === 'online' ? mpSession.role : null

  // Close the room whenever we are back on the title screen without the
  // versus lobby open (menu exits, disconnect-end Menu, etc.).
  useEffect(() => {
    if (uiState !== 'title' || menuScreen === 'multiplayer') return
    closeRoom()
    if (mpSession?.kind === 'online') {
      setMpSession(null)
      setMpVariant(null)
    }
  }, [uiState, menuScreen, mpSession, closeRoom])

  // Close the socket if the page unmounts entirely.
  useEffect(() => {
    return () => {
      roomRef.current?.close()
      roomRef.current = null
    }
  }, [])

  // Host mirrors its local pause state to the guest.
  const prevUiStateRef = useRef(uiState)
  useEffect(() => {
    const prev = prevUiStateRef.current
    prevUiStateRef.current = uiState
    if (mpSession?.kind !== 'online' || mpSession.role !== 'host') return
    if (prev === 'playing' && uiState === 'paused') roomRef.current?.send({ t: 'pause' })
    else if (prev === 'paused' && uiState === 'playing') roomRef.current?.send({ t: 'resume' })
  }, [uiState, mpSession])

  // --- Online multiplayer: message handling ---------------------------------
  // The listener is registered once per RoomClient; the ref indirection keeps
  // it reading fresh state without re-subscribing every render.
  const netMsgRef = useRef<(msg: AnyMsg) => void>(() => {})
  useEffect(() => {
    netMsgRef.current = (msg: AnyMsg) => {
      if (mpSession?.kind !== 'online') return
      const role = mpSession.role

      switch (msg.t) {
        case 'pauseRequest':
          // Guest asked to pause; only the host owns pause state.
          if (role === 'host' && uiState === 'playing') setUiState('paused')
          break
        case 'start':
          // Host started (or restarted) the match. The guest skips the
          // briefing — the host already read it — and goes straight in.
          if (role === 'guest') {
            setMpVariant(msg.variant)
            setGameMode('multiplayer')
            setMatchResult(null)
            setMenuScreen(null)
            setUiState('playing')
          }
          break
        case 'pause':
          if (role === 'guest' && uiState === 'playing') setUiState('paused')
          break
        case 'resume':
          if (role === 'guest' && uiState === 'paused') setUiState('playing')
          break
        case 'end':
          // Guests never run the sim, so this is their only end-screen path.
          if (role === 'guest') setMatchResult(msg.result)
          break
        case 'peerLeft':
          // Mid-match disconnect: remaining player wins by default.
          if ((uiState === 'playing' || uiState === 'paused') && !matchResult) {
            const elapsed =
              mpVariant === 'tag'
                ? Math.max(0, TAG_ROUND_SECONDS - (hud.matchTimeLeft ?? TAG_ROUND_SECONDS))
                : 0
            setMatchResult({
              variant: mpVariant ?? 'duel',
              winner: role === 'host' ? 0 : 1,
              scores: [hud.p1Score ?? hud.score, hud.p2Score ?? 0],
              elapsed,
              reason: 'disconnect',
            })
            // 'paused' halts the sim; the pause modal is gated behind
            // !matchResult so only the end screen shows.
            setUiState('paused')
            closeRoom()
          } else if (uiState === 'rules' && role === 'host') {
            // Guest bailed while the host was reading the briefing: there is
            // no match to award, so drop back to the versus lobby.
            closeRoom()
            setMpSession(null)
            setMpVariant(null)
            setUiState('title')
            setMenuScreen('multiplayer')
          }
          // In the lobby, MultiplayerSelect's own listener updates presence.
          break
        default:
          // 'peers' / 'roomError' are lobby concerns (handled in
          // MultiplayerSelect); 'snap' / 'input' belong to GameCanvas.
          break
      }
    }
  })

  useEffect(() => {
    if (!room) return
    const unsubscribe = room.addMessageListener((msg) => netMsgRef.current(msg))
    return unsubscribe
  }, [room])

  // The selected instrument skins the whole product, not just the arena.
  // `saveSettings` re-applies on every change; this covers the first paint,
  // which has to happen after mount because the choice lives in localStorage.
  useEffect(() => {
    applyThemeToDocument()
  }, [])

  // Refreshed every time we land back on the title screen so a finished run
  // shows up on the menu immediately.
  const [homeReadouts, setHomeReadouts] = useState<HomeReadouts | null>(null)
  useEffect(() => {
    if (uiState !== 'title') return
    const stats = loadStats()
    const cs = challengeStats()
    setHomeReadouts({
      best: stats.highestScore,
      cleared: cs.completedCount,
      stars: cs.totalStars,
      runs: stats.gamesPlayed,
      // Same resolver the chassis uses, so the readout can never disagree with
      // the instrument actually on screen.
      instrument: chassisTheme().name,
    })
  }, [uiState, menuScreen, endRun])

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

  // Process a finished run: persist stats, score challenge stars, unlock
  // achievements, then surface the end screen + any achievement toasts.
  const handleRunEnd = useCallback(
    (
      summary: RunSummary,
      perf: { orbs: number; elapsed: number; wallTouched: boolean; arenaWidth: number; arenaHeight: number }
    ) => {
      const { newPersonalBest } = recordRun(summary)

      let stars: number | undefined
      if (summary.mode === 'challenge' && activeChallenge) {
        stars = computeStars(activeChallenge, {
          completed: summary.won,
          elapsed: perf.elapsed,
          orbs: perf.orbs,
          wallTouched: perf.wallTouched,
          arenaWidth: perf.arenaWidth,
          arenaHeight: perf.arenaHeight,
        })
        recordChallengeResult(activeChallenge.id, {
          completed: summary.won,
          stars: stars ?? 0,
          score: summary.score,
          timeMs: Math.round(summary.timeSurvived * 1000),
        })
      }

      const cs = challengeStats()
      const fresh = checkAchievements(
        {
          stats: loadStats(),
          lastRun: summary,
          challengesCompleted: cs.completedCount,
          highestChallengeCleared: cs.highestCleared,
          perfectChallengeCleared: summary.mode === 'challenge' && summary.won && stars === 3,
        },
        Date.now()
      )

      setEndRun({ summary, newPersonalBest, stars })
      if (fresh.length > 0) setAchievementQueue(fresh)
    },
    [activeChallenge]
  )

  const handleSelectChallenge = useCallback((ch: Challenge) => {
    setActiveChallenge(ch)
    setGameMode('challenge')
    setMenuScreen(null)
    setUiState('rules')
  }, [])

  const handleSelectMultiplayer = useCallback((variant: MpVariant, session: MpSession) => {
    setMpVariant(variant)
    setMpSession(session)
    setGameMode('multiplayer')
    setMenuScreen(null)
    setUiState('rules')
  }, [])

  const handleVersusRematch = useCallback(() => {
    if (mpSession?.kind === 'online') {
      // Only the host can restart an online match. The guest's button is a
      // no-op; their real transition is the fresh 'start' broadcast below.
      if (mpSession.role !== 'host' || !roomRef.current || !mpVariant) return
      setMatchResult(null)
      roomRef.current.send({
        t: 'start',
        v: PROTOCOL_VERSION,
        variant: mpVariant,
        arena: { w: arenaSize.width, h: arenaSize.height },
      })
      setUiState('playing')
      dispatchSpace()
      return
    }
    setMatchResult(null)
    dispatchSpace() // same in-canvas Space restart the single-player retry uses
  }, [dispatchSpace, mpSession, mpVariant, arenaSize])

  const handleVersusMenu = useCallback(() => {
    setMatchResult(null)
    setMpVariant(null)
    setMpSession(null)
    setUiState('title')
    closeRoom()
  }, [closeRoom])

  const handleEndRetry = useCallback(() => {
    setEndRun(null)
    setAchievementQueue([])
    dispatchSpace() // in-canvas Space handler restarts survival/challenge instantly
  }, [dispatchSpace])

  const handleEndMenu = useCallback(() => {
    setEndRun(null)
    setAchievementQueue([])
    setActiveChallenge(null)
    setUiState('title')
  }, [])

  const handleEndNext = useCallback(() => {
    if (!activeChallenge) return
    const next = challenges.find((c) => c.id === activeChallenge.id + 1)
    if (!next) return
    setEndRun(null)
    setAchievementQueue([])
    setActiveChallenge(next)
    setUiState('rules')
  }, [activeChallenge])

  // Local versus + online host: GameCanvas resolves the match here. The
  // online host additionally relays the verdict — the guest never simulates,
  // so this broadcast is the guest's only path to an end screen.
  const handleMatchEnd = useCallback(
    (r: MatchResult) => {
      setMatchResult(r)
      if (mpSession?.kind === 'online' && mpSession.role === 'host') {
        roomRef.current?.send({ t: 'end', result: r })
      }
    },
    [mpSession]
  )

  // Pause control: an online guest may only *request* a pause — the host owns
  // the pause state and mirrors it back via 'pause'/'resume'.
  const handlePausePress = useCallback(() => {
    if (mpSession?.kind === 'online' && mpSession.role === 'guest') {
      roomRef.current?.send({ t: 'pauseRequest' })
      return
    }
    setUiState('paused')
  }, [mpSession])

  const handleStateUpdate = useCallback(
    (s: HudState) => {
      setHud({
        score: s.score ?? 0,
        stage: s.stage ?? 1,
        mode: s.mode ?? 'Normal',
        eventName: s.eventName ?? '',
        eventProgress: s.eventProgress ?? 0,
        gameOver: s.gameOver,
        p1Score: s.p1Score,
        p2Score: s.p2Score,
        matchTimeLeft: s.matchTimeLeft,
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

  // Dismiss the end screen once the game is live again (covers a direct Space restart).
  useEffect(() => {
    if (!hud.gameOver && endRun) {
      setEndRun(null)
      setAchievementQueue([])
    }
  }, [hud.gameOver, endRun])

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

    // Online host: broadcast the match parameters before going live so the
    // guest (who skips this briefing) enters in lockstep.
    if (
      gameMode === 'multiplayer' &&
      mpSession?.kind === 'online' &&
      mpSession.role === 'host' &&
      mpVariant
    ) {
      roomRef.current?.send({
        t: 'start',
        v: PROTOCOL_VERSION,
        variant: mpVariant,
        arena: { w: arenaSize.width, h: arenaSize.height },
      })
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
          {/* The bar is a live strip chart of your own speed; the readouts
              below are annotations on it. */}
          <TraceStrip mode="live" className="hud-trace" height="100%" plotScale={0.6} />
          <div className="hud-left">
            {gameMode === 'multiplayer' ? (
              mpVariant === 'coop' ? (
                // Co-op: one shared score plus the survival-style event counter.
                <>
                  <div className="hud-box score-box signal">
                    <div className="box-label">Score</div>
                    <div className="box-value">{hud.score}</div>
                  </div>
                  <div className="hud-box score-box">
                    <div className="box-label">Next</div>
                    <div className="box-value">{hud.eventProgress}/10</div>
                  </div>
                </>
              ) : (
                // Duel: orbs collected. Tag: whole seconds of safe (not-it) time.
                <>
                  <div className="hud-box score-box">
                    <div className="box-label">P1</div>
                    <div className="box-value">
                      {mpVariant === 'tag' ? `${hud.p1Score ?? 0}s` : hud.p1Score ?? 0}
                    </div>
                  </div>
                  <div className="hud-box score-box">
                    <div className="box-label">P2</div>
                    <div className="box-value" style={{ color: MP_P2_BODY }}>
                      {mpVariant === 'tag' ? `${hud.p2Score ?? 0}s` : hud.p2Score ?? 0}
                    </div>
                  </div>
                </>
              )
            ) : (
              <>
                <div className="hud-box score-box signal">
                  <div className="box-label">Score</div>
                  <div className="box-value">{hud.score}</div>
                </div>

                {gameMode === 'survival' && (
                  <div className="hud-box score-box">
                    <div className="box-label">Next</div>
                    <div className="box-value">{hud.eventProgress}/10</div>
                  </div>
                )}
              </>
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

            {gameMode === 'challenge' && (
              <div className="status-text status-text-tutorial">{hud.eventName}</div>
            )}

            {gameMode === 'multiplayer' && mpVariant === 'tag' && (
              // Round countdown, styled like the event name when time runs low.
              <div
                className={`status-text${
                  (hud.matchTimeLeft ?? TAG_ROUND_SECONDS) <= 10 ? ' event-name' : ''
                }`}
              >
                {Math.ceil(hud.matchTimeLeft ?? TAG_ROUND_SECONDS)}s
              </div>
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
              onClick={handlePausePress}
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

      <main className="canvas-wrap game-area" ref={gameAreaRef}>
        {uiState !== 'title' && (
          <GameCanvas
            gameMode={gameMode}
            uiState={uiState}
            isPaused={uiState !== 'playing'}
            onStateChange={handleStateUpdate}
            onSurvivalGameOver={handleSurvivalGameOver}
            onRunEnd={handleRunEnd}
            challenge={gameMode === 'challenge' ? activeChallenge : null}
            mpVariant={gameMode === 'multiplayer' ? mpVariant : null}
            onMatchEnd={handleMatchEnd}
            netRole={gameMode === 'multiplayer' && isOnline ? onlineRole : null}
            net={gameMode === 'multiplayer' && isOnline ? room : null}
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
            <div className="home-shell">
              <header className="home-head">
                <span className="home-spec">
                  <span>Inertial test rig</span>
                  <span>100 trials</span>
                  <span>8 instruments</span>
                </span>
                <h1 className="home-wordmark">MOTUS</h1>
                <div className="home-rule" />
                <p className="home-tagline">
                  Momentum is the only input. You have mass — you accelerate, you drift,
                  and you cannot stop on demand.
                </p>
              </header>

              {/* Each row carries a live reading of your own data instead of a
                  decorative index. Rows with nothing measured yet stay blank. */}
              <nav className="menu-list" aria-label="Main menu">
                {[
                  {
                    title: 'Play',
                    desc: 'Endless survival. Posts to the global leaderboard.',
                    readout: homeReadouts && homeReadouts.best > 0 ? `Best ${homeReadouts.best}` : null,
                    on: () => { setGameMode('survival'); setUiState('rules') },
                  },
                  {
                    title: 'Challenges',
                    desc: '100 trials, each harder than the one before.',
                    readout: homeReadouts ? `${homeReadouts.cleared}/100 · ${homeReadouts.stars}★` : null,
                    on: () => setMenuScreen('challenges'),
                  },
                  {
                    title: 'Practice',
                    desc: 'No hazards, no death. Movement only.',
                    readout: null,
                    on: () => { setGameMode('zen'); setUiState('rules') },
                  },
                  {
                    title: 'Tutorial',
                    desc: 'Learn the controls step by step.',
                    readout: null,
                    on: () => { setGameMode('tutorial'); setUiState('rules') },
                  },
                  {
                    title: 'Leaderboard',
                    desc: 'Who is holding the top of the board.',
                    readout: null,
                    on: () => setLeaderboardOpen(true),
                  },
                  {
                    title: 'Profile',
                    desc: 'Lifetime measurements and achievements.',
                    readout: homeReadouts && homeReadouts.runs > 0 ? `${homeReadouts.runs} runs` : null,
                    on: () => setMenuScreen('profile'),
                  },
                  {
                    title: 'Settings',
                    desc: 'Instruments, marks and trails you have earned.',
                    readout: homeReadouts?.instrument ?? null,
                    on: () => setMenuScreen('settings'),
                  },
                  {
                    title: 'Versus',
                    desc: 'Duel, co-op or tag. One keyboard, or two machines.',
                    readout: null,
                    on: () => setMenuScreen('multiplayer'),
                  },
                ].map((item) => (
                  <button key={item.title} type="button" className="menu-row" onClick={item.on}>
                    <span className="menu-row-body">
                      <span className="menu-row-title">{item.title}</span>
                      <span className="menu-row-desc">{item.desc}</span>
                    </span>
                    {item.readout && <span className="menu-readout">{item.readout}</span>}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}

        {uiState === 'rules' && (
          <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 80 }}>
            <div className="overlay-backdrop" />
            <div className="rules-modal">
              {(() => {
                const eyebrow =
                  gameMode === 'zen' ? 'PRACTICE // BRIEFING' :
                  gameMode === 'tutorial' ? 'TUTORIAL // BRIEFING' :
                  gameMode === 'challenge' ? `CHALLENGE ${activeChallenge?.id ?? ''}`.trim() :
                  gameMode === 'multiplayer' ? `VERSUS // ${MP_VARIANT_NAMES[mpVariant ?? 'duel'].toUpperCase()}` :
                  'SURVIVAL // BRIEFING'
                const title =
                  gameMode === 'zen' ? 'Practice Mode' :
                  gameMode === 'tutorial' ? 'Tutorial' :
                  gameMode === 'challenge' ? (activeChallenge?.title ?? 'Challenge') :
                  gameMode === 'multiplayer' ? MP_VARIANT_NAMES[mpVariant ?? 'duel'] :
                  'Survival Mode'
                // Star bars scale with the arena, so the briefing quotes the
                // numbers for the surface this run will actually be played on.
                const deadline =
                  gameMode === 'challenge' && activeChallenge
                    ? challengeTimeLimit(activeChallenge, arenaSize.width, arenaSize.height)
                    : 0
                const items: string[] =
                  gameMode === 'challenge' && activeChallenge ? [
                    activeChallenge.description,
                    `Objective: ${
                      activeChallenge.goal.type === 'survive'
                        ? `Survive ${activeChallenge.goal.target}s`
                        : `Collect ${activeChallenge.goal.target} orbs`
                    }${
                      deadline > 0 && activeChallenge.goal.type !== 'survive'
                        ? ` within ${deadline}s`
                        : ''
                    }`,
                    ...starRequirements(activeChallenge, arenaSize.width, arenaSize.height).map(
                      (req, i) => `${'★'.repeat(i + 1)} ${req}`
                    ),
                  ] : gameMode === 'multiplayer' ? (
                    mpVariant === 'coop' ? [
                      'One shared score — collect orbs together.',
                      'Every 10 orbs triggers a Cataclysm. Clear it to advance the stage.',
                      `Hazard or wall contact downs you — a teammate's touch revives you within ${COOP_BLEEDOUT_SECONDS}s.`,
                      `Fresh revives are shielded for ${COOP_REVIVE_IMMUNITY}s.`,
                      'Both down and the run is over. Co-op runs do not post to the leaderboard.',
                    ] : mpVariant === 'tag' ? [
                      `One ${TAG_ROUND_SECONDS}s round — don’t be it when it ends.`,
                      'Touch the other puck to pass it. Whoever is it moves faster.',
                      'Borders wrap around — walls never hurt here.',
                      'Least time spent as it wins.',
                    ] : [
                      `First to ${DUEL_TARGET_SCORE} orbs wins the duel.`,
                      `Hazard contact knocks you back and staggers you for ${DUEL_STUN_SECONDS}s — staggered pucks can't collect.`,
                      `After a stagger you're briefly untouchable (${DUEL_POST_STUN_IMMUNITY}s) — and walls just bounce you back.`,
                    ]
                  ) : gameMode === 'zen' ? [
                    'No hazards. You cannot lose.',
                    'The borders wrap — leave one edge, arrive at the opposite one.',
                    'Collect orbs and learn how the puck carries speed.',
                  ] : gameMode === 'tutorial' ? [
                    'Each step teaches one mechanic.',
                    'Follow the instruction on screen to advance.',
                    'Movement and collection first, hazards after.',
                  ] : [
                    'Move with the arrow keys or WASD. You drift — plan the stop.',
                    'Take the orbs to score. Hatched marks are hazards; contact ends the run.',
                    'Every ten orbs triggers a Cataclysm.',
                    'The limit rails read out your distance as you close on them.',
                  ]
                // Versus briefings get a variant accent + a keycap control
                // legend; single-player briefings render exactly as before.
                const accent =
                  gameMode === 'multiplayer'
                    ? ({ duel: 'var(--glow-cyan)', coop: 'var(--glow-green)', tag: 'var(--glow-red)' } as const)[
                        mpVariant ?? 'duel'
                      ]
                    : undefined
                const onlineRole = mpSession?.kind === 'online' ? mpSession.role : null
                const wasdKeys = ['W', 'A', 'S', 'D']
                const arrowKeys = ['↑', '←', '↓', '→']
                const keycaps = (keys: string[]) => (
                  <span className="kbd-row">
                    {keys.map((k) => (
                      <kbd className="kbd" key={k}>{k}</kbd>
                    ))}
                  </span>
                )
                return (
                  <>
                    <span className="modal-eyebrow" style={accent ? { color: accent } : undefined}>
                      {eyebrow}
                    </span>
                    <h2>{title}</h2>
                    <div className="brief-list">
                      {/* Briefing lines are a spec sheet, not a sequence — a
                          tick marks each entry rather than a fake step number. */}
                      {items.map((text, i) => (
                        <div className="brief-row" key={i}>
                          <span className="brief-row-index" aria-hidden="true">—</span>
                          <span className="brief-row-text">{text}</span>
                        </div>
                      ))}
                    </div>
                    {gameMode === 'multiplayer' && (
                      <div className="mp-legend">
                        {onlineRole ? (
                          // Online, both key groups steer YOUR puck — one row,
                          // tinted with the local slot's color.
                          <div
                            className="mp-legend-row"
                            style={{ color: onlineRole === 'host' ? 'var(--glow-cyan)' : MP_P2_BODY }}
                          >
                            <span className="mp-legend-dot" />
                            <span className="mp-legend-name">YOU</span>
                            {keycaps(wasdKeys)}
                            {keycaps(arrowKeys)}
                          </div>
                        ) : (
                          <>
                            <div className="mp-legend-row" style={{ color: 'var(--glow-cyan)' }}>
                              <span className="mp-legend-dot" />
                              <span className="mp-legend-name">PLAYER 1</span>
                              {keycaps(wasdKeys)}
                            </div>
                            <div className="mp-legend-row" style={{ color: MP_P2_BODY }}>
                              <span className="mp-legend-dot" />
                              <span className="mp-legend-name">PLAYER 2</span>
                              {keycaps(arrowKeys)}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}

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

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start' }}>
                <button
                  className="btn btn-primary"
                  disabled={!canPlaySurvival}
                  onClick={() => void handleStartPlaying()}
                >
                  {startingSession ? 'Starting…' : 'Play'}
                </button>
              </div>
            </div>
          </div>
        )}

        {uiState === 'paused' && !matchResult && (
          <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 90 }}>
            <div className="overlay-backdrop" />
            {isOnline && onlineRole === 'guest' ? (
              // Guests cannot resume — the host owns the pause state.
              <div className="rules-modal pause-modal">
                <span className="modal-eyebrow">HOST PAUSED</span>
                <div className="pause-modal-title">Paused</div>
                <p className="username-hint" style={{ textAlign: 'center', marginTop: 8 }}>
                  The host paused the match — waiting for them to resume.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                  <button className="btn btn-ghost" onClick={handleVersusMenu}>
                    Menu
                  </button>
                </div>
              </div>
            ) : (
              <div className="rules-modal pause-modal">
                <span className="modal-eyebrow">SESSION PAUSED</span>
                <div className="pause-modal-title">Paused</div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => setUiState('playing')}
                  >
                    Resume
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setUiState('rules')}
                  >
                    Restart
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setUiState('title')}
                  >
                    Menu
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <LeaderboardModal open={leaderboardOpen} onClose={() => setLeaderboardOpen(false)} />

      {menuScreen === 'challenges' && (
        <ChallengeSelect onSelect={handleSelectChallenge} onClose={() => setMenuScreen(null)} />
      )}
      {menuScreen === 'settings' && <SettingsModal onClose={() => setMenuScreen(null)} />}
      {menuScreen === 'profile' && <ProfileModal onClose={() => setMenuScreen(null)} />}
      {menuScreen === 'multiplayer' && (
        <MultiplayerSelect
          onSelect={handleSelectMultiplayer}
          onClose={() => setMenuScreen(null)}
          getRoom={getRoom}
          onGuestLobby={handleGuestLobby}
        />
      )}

      {endRun && (
        <EndScreen
          summary={endRun.summary}
          newPersonalBest={endRun.newPersonalBest}
          stars={endRun.stars}
          challengeTitle={endRun.summary.mode === 'challenge' ? activeChallenge?.title : undefined}
          hasNextChallenge={
            !!activeChallenge && challenges.some((c) => c.id === activeChallenge.id + 1)
          }
          onRetry={handleEndRetry}
          onMenu={handleEndMenu}
          onNext={handleEndNext}
        />
      )}

      {matchResult && (
        <VersusEndScreen
          result={matchResult}
          onRematch={handleVersusRematch}
          onMenu={handleVersusMenu}
          rematch={
            matchResult.reason === 'disconnect'
              ? 'hidden'
              : mpSession?.kind === 'online' && mpSession.role === 'guest'
                ? 'waiting'
                : 'enabled'
          }
        />
      )}

      <AchievementToast queue={achievementQueue} onDrained={() => setAchievementQueue([])} />
    </div>
  )
}
