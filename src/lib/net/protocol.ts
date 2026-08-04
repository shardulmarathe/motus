import { MatchResult, MpVariant } from '../modes'

// Wire protocol between host, guest and the PartyKit relay. JSON v1.
// The host is authoritative: it runs the sim and broadcasts snapshots;
// the guest only sends held-key state.

export const PROTOCOL_VERSION = 1

export const SNAPSHOT_HZ = 20
export const INPUT_HEARTBEAT_HZ = 10
export const INTERP_DELAY_MS = 100
export const EXTRAP_MAX_MS = 200
export const NET_STALL_MS = 1000
/** displacement above which an entity snaps instead of lerping (swap event teleports) */
export const TELEPORT_SNAP_PX = 150

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 5

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
  }
  return code
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false
  return true
}

// --- Key bitmask (URDL) ---
export const KEY_UP = 1
export const KEY_RIGHT = 2
export const KEY_DOWN = 4
export const KEY_LEFT = 8

/** Arrow-key codes → bitmask (the guest's puck is always driven by arrow semantics) */
export function keysToMask(keys: Set<string>): number {
  let m = 0
  if (keys.has('ArrowUp') || keys.has('KeyW')) m |= KEY_UP
  if (keys.has('ArrowRight') || keys.has('KeyD')) m |= KEY_RIGHT
  if (keys.has('ArrowDown') || keys.has('KeyS')) m |= KEY_DOWN
  if (keys.has('ArrowLeft') || keys.has('KeyA')) m |= KEY_LEFT
  return m
}

/** bitmask → the Arrow* key-code set fed into P2's InputMap on the host */
export function maskToKeys(mask: number): Set<string> {
  const keys = new Set<string>()
  if (mask & KEY_UP) keys.add('ArrowUp')
  if (mask & KEY_RIGHT) keys.add('ArrowRight')
  if (mask & KEY_DOWN) keys.add('ArrowDown')
  if (mask & KEY_LEFT) keys.add('ArrowLeft')
  return keys
}

// --- Snapshot entity shapes ---

export type SnapPlayer = {
  x: number
  y: number
  vx: number
  vy: number
  alive: boolean
  stun: number // stunnedUntil (sim seconds)
  imm: number // immuneUntil (sim seconds), drives i-frame flicker + tag cooldown ring
  it: boolean
  score: number
}

export type SnapEnemy = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  hue?: 'red' | 'purple'
}

export type SnapGoal = { x: number; y: number; r: number }

export type SnapGameData = {
  state: 'playing' | 'cataclysm' | 'gameOver'
  score: number
  stage: number
  eventType?: string
  eventName?: string
  eventTimeLeft?: number
  eventProgress?: number
  matchTimeLeft?: number
}

// --- Messages ---

export type InputMsg = { t: 'input'; seq: number; k: number }

export type SnapMsg = {
  t: 'snap'
  seq: number
  /** host sim-elapsed ms, used as the interpolation clock */
  ts: number
  players: [SnapPlayer, SnapPlayer]
  enemies: SnapEnemy[]
  goals: SnapGoal[]
  gd: SnapGameData
  arena: { w: number; h: number }
}

export type StartMsg = { t: 'start'; v: number; variant: MpVariant; arena: { w: number; h: number } }
export type PauseMsg = { t: 'pause' }
export type ResumeMsg = { t: 'resume' }
export type EndMsg = { t: 'end'; result: MatchResult }
/** guest asking the host to pause */
export type PauseRequestMsg = { t: 'pauseRequest' }

// server → clients
export type PeersMsg = { t: 'peers'; hostPresent: boolean; guestPresent: boolean }
export type PeerLeftMsg = { t: 'peerLeft'; role: 'host' | 'guest' }
export type RoomErrorMsg = { t: 'roomError'; reason: 'full' | 'noHost' | 'badRole' }

export type ClientMsg = InputMsg | SnapMsg | StartMsg | PauseMsg | ResumeMsg | EndMsg | PauseRequestMsg
export type ServerMsg = PeersMsg | PeerLeftMsg | RoomErrorMsg
export type AnyMsg = ClientMsg | ServerMsg

export function parseMsg(raw: string): AnyMsg | null {
  try {
    const msg = JSON.parse(raw)
    if (msg && typeof msg.t === 'string') return msg as AnyMsg
    return null
  } catch {
    return null
  }
}
