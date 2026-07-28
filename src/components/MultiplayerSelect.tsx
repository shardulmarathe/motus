"use client"

import React, { useCallback, useEffect, useState } from 'react'
import { MP_VARIANT_NAMES, type MpSession, type MpVariant } from '../lib/modes'
import { DUEL_TARGET_SCORE, TAG_ROUND_SECONDS } from '../lib/multiplayer/rules'
import type { RoomClient } from '../lib/net/room'
import {
  generateRoomCode,
  isValidRoomCode,
  ROOM_CODE_LENGTH,
} from '../lib/net/protocol'

interface MultiplayerSelectProps {
  onClose: () => void
  onSelect: (variant: MpVariant, session: MpSession) => void
  /** Lazily creates/returns the page-owned RoomClient (page.tsx owns its lifecycle). */
  getRoom: () => RoomClient
  /**
   * Guest successfully joined a room: the page records the online-guest
   * session and waits for the host's 'start' while this overlay stays open.
   */
  onGuestLobby: (code: string) => void
}

const VARIANT_ORDER: MpVariant[] = ['duel', 'coop', 'tag']

const VARIANT_DESCS: Record<MpVariant, string> = {
  duel: `Race for the orbs. First to ${DUEL_TARGET_SCORE} wins.`,
  coop: 'One shared score, real cataclysms. Revive each other by touch.',
  tag: `${TAG_ROUND_SECONDS}s round — don't be it when the clock runs out.`,
}

type LobbyView = 'variants' | 'create' | 'join'
type JoinPhase = 'input' | 'connecting' | 'connected'

const ROOM_ERROR_TEXT: Record<string, string> = {
  full: 'That room is full.',
  noHost: 'No room with that code. Check it and try again.',
  badRole: 'Connection rejected. Try again.',
}

/**
 * The lobby's status line. Nothing lights up here — the line is stamped in the
 * ink its condition calls for: red pen for a fault, pen for a live link, and
 * plain graphite while the room is still waiting.
 */
function StatusLine({ text, tone }: { text: string; tone: 'idle' | 'live' | 'fault' }) {
  const color =
    tone === 'fault' ? 'var(--red-pen)' : tone === 'live' ? 'var(--pen)' : 'var(--ink-dim)'
  return (
    <p className="modal-eyebrow" style={{ color, marginBottom: 18 }} role="status" aria-live="polite">
      {text}
    </p>
  )
}

/** Versus lobby: pick a variant, then start a local (shared-keyboard) or online match. */
export default function MultiplayerSelect({
  onClose,
  onSelect,
  getRoom,
  onGuestLobby,
}: MultiplayerSelectProps) {
  const [selected, setSelected] = useState<MpVariant | null>('duel')
  const [isTouch, setIsTouch] = useState(false)

  const [view, setView] = useState<LobbyView>('variants')
  const [hostCode, setHostCode] = useState('')
  const [guestPresent, setGuestPresent] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinPhase, setJoinPhase] = useState<JoinPhase>('input')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  // Same coarse-pointer detection the rest of the app uses (see page.tsx /
  // TouchControls): local versus needs two hands on one keyboard. Online
  // play is fine on touch — TouchControls drive the guest's puck.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setIsTouch(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  const canStartLocal = selected !== null && !isTouch

  // Room traffic while an online view is up: presence, rejections, drops.
  useEffect(() => {
    if (view === 'variants') return
    const room = getRoom()

    room.onStatus = (s) => {
      if (s === 'open') setLost(false)
      else if (s === 'error' || s === 'closed') setLost(true)
    }

    const unsubscribe = room.addMessageListener((msg) => {
      if (msg.t === 'peers') {
        setGuestPresent(msg.guestPresent)
        if (view === 'join' && joinPhase === 'connecting' && msg.hostPresent) {
          setJoinPhase('connected')
          setErrorMsg(null)
          onGuestLobby(joinCode)
        }
      } else if (msg.t === 'peerLeft') {
        if (msg.role === 'guest') setGuestPresent(false)
        if (msg.role === 'host' && view === 'join') {
          setErrorMsg('The host left the room.')
          setJoinPhase('input')
        }
      } else if (msg.t === 'roomError') {
        setErrorMsg(ROOM_ERROR_TEXT[msg.reason] ?? 'Connection rejected — try again.')
        // Stop the client's auto-reconnect from hammering a dead/full room.
        room.close()
        if (view === 'join') setJoinPhase('input')
      }
    })

    return () => {
      unsubscribe()
      room.onStatus = () => {}
    }
  }, [view, joinPhase, joinCode, getRoom, onGuestLobby])

  const handleCreate = useCallback(() => {
    const code = generateRoomCode()
    setHostCode(code)
    setGuestPresent(false)
    setErrorMsg(null)
    setLost(false)
    setView('create')
    getRoom().connect(code, 'host')
  }, [getRoom])

  const handleJoinConnect = useCallback(() => {
    const code = joinInput.trim().toUpperCase()
    if (!isValidRoomCode(code)) {
      setErrorMsg(`Codes are ${ROOM_CODE_LENGTH} characters: letters and digits.`)
      return
    }
    setJoinCode(code)
    setErrorMsg(null)
    setLost(false)
    setJoinPhase('connecting')
    getRoom().connect(code, 'guest')
  }, [joinInput, getRoom])

  const handleRetry = useCallback(() => {
    setErrorMsg(null)
    setLost(false)
    if (view === 'create' && hostCode) getRoom().connect(hostCode, 'host')
    else if (view === 'join' && joinPhase !== 'input' && joinCode) getRoom().connect(joinCode, 'guest')
  }, [view, hostCode, joinPhase, joinCode, getRoom])

  const handleBack = useCallback(() => {
    // Leaving an online view drops the connection; page.tsx clears any
    // half-formed guest session when the overlay closes.
    getRoom().close()
    setView('variants')
    setGuestPresent(false)
    setJoinPhase('input')
    setErrorMsg(null)
    setLost(false)
  }, [getRoom])

  const connectionIssue = lost && !errorMsg

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 85 }}>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="rules-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {view === 'variants' && (
          <>
            <span className="modal-eyebrow">VERSUS // SELECT</span>
            <h2>Versus</h2>

            {/* Three modes are not a sequence, so there is no index to show:
                the title and its description carry the row, and the arrow
                marks the current selection. */}
            <nav className="menu-list" aria-label="Versus variants" style={{ margin: '18px 0 24px' }}>
              {VARIANT_ORDER.map((variant) => {
                const active = selected === variant
                return (
                  <button
                    key={variant}
                    type="button"
                    className={`menu-row${active ? ' selected' : ''}`}
                    onClick={() => setSelected(variant)}
                    aria-pressed={active}
                  >
                    <span className="menu-row-body">
                      <span className="menu-row-title">{MP_VARIANT_NAMES[variant]}</span>
                      <span className="menu-row-desc">{VARIANT_DESCS[variant]}</span>
                    </span>
                    <span className="menu-arrow" aria-hidden="true">{active ? '●' : '→'}</span>
                  </button>
                )
              })}
            </nav>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  disabled={!canStartLocal}
                  onClick={() => selected && onSelect(selected, { kind: 'local' })}
                >
                  Start local
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={selected === null}
                  onClick={handleCreate}
                >
                  Create room
                </button>
                <button className="btn btn-ghost" onClick={() => setView('join')}>
                  Join room
                </button>
              </div>
              {isTouch && (
                <p className="settings-hint">
                  Local versus needs a keyboard. Online rooms work with touch controls.
                </p>
              )}
            </div>
          </>
        )}

        {view === 'create' && (
          <>
            <span className="modal-eyebrow">
              VERSUS // ONLINE — {MP_VARIANT_NAMES[selected ?? 'duel'].toUpperCase()}
            </span>
            <h2>Room created</h2>

            <span className="username-label" style={{ marginTop: 16 }}>
              Share this code
            </span>
            <div className="room-code" role="img" aria-label={`Room code ${hostCode}`}>
              {hostCode}
            </div>
            <StatusLine
              tone={connectionIssue ? 'fault' : guestPresent ? 'live' : 'idle'}
              text={
                connectionIssue
                  ? 'CONNECTION LOST'
                  : guestPresent
                    ? 'PLAYER CONNECTED'
                    : 'WAITING FOR PLAYER'
              }
            />

            {errorMsg && <p className="username-hint">{errorMsg}</p>}

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                disabled={!guestPresent || !selected || connectionIssue}
                onClick={() =>
                  selected && onSelect(selected, { kind: 'online', role: 'host', code: hostCode })
                }
              >
                Start match
              </button>
              {(connectionIssue || errorMsg) && (
                <button className="btn btn-ghost" onClick={handleRetry}>
                  Retry
                </button>
              )}
              <button className="btn btn-ghost" onClick={handleBack}>
                Back
              </button>
            </div>
          </>
        )}

        {view === 'join' && (
          <>
            <span className="modal-eyebrow">VERSUS // ONLINE — JOIN</span>
            <h2>Join room</h2>

            {joinPhase !== 'connected' ? (
              <>
                <div className="username-field" style={{ marginTop: 16 }}>
                  <label htmlFor="room-code" className="username-label">
                    Enter the {ROOM_CODE_LENGTH}-character room code
                  </label>
                  <input
                    id="room-code"
                    className="username-input"
                    style={{ letterSpacing: '0.3em', textTransform: 'uppercase' }}
                    type="text"
                    maxLength={ROOM_CODE_LENGTH}
                    placeholder="ABC12"
                    value={joinInput}
                    onChange={(e) =>
                      setJoinInput(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH)
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isValidRoomCode(joinInput)) handleJoinConnect()
                    }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    autoFocus
                  />
                  {errorMsg && <p className="username-hint">{errorMsg}</p>}
                  {joinPhase === 'connecting' && !errorMsg && (
                    connectionIssue ? (
                      <p className="username-hint" aria-live="polite">
                        Connection lost. Retry below.
                      </p>
                    ) : (
                      <p className="username-meta" aria-live="polite">
                        CONNECTING…
                      </p>
                    )
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    disabled={!isValidRoomCode(joinInput) || joinPhase === 'connecting'}
                    onClick={handleJoinConnect}
                  >
                    Connect
                  </button>
                  {joinPhase === 'connecting' && connectionIssue && (
                    <button className="btn btn-ghost" onClick={handleRetry}>
                      Retry
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={handleBack}>
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="room-code" role="img" aria-label={`Room code ${joinCode}`}>
                  {joinCode}
                </div>
                <StatusLine
                  tone={connectionIssue ? 'fault' : 'live'}
                  text={connectionIssue ? 'CONNECTION LOST' : 'CONNECTED — WAITING FOR HOST'}
                />

                {errorMsg && <p className="username-hint">{errorMsg}</p>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {connectionIssue && (
                    <button className="btn btn-ghost" onClick={handleRetry}>
                      Retry
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={handleBack}>
                    Back
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
