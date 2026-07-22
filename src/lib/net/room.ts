import { AnyMsg, ClientMsg, InputMsg, parseMsg } from './protocol'

export type RoomStatus = 'connecting' | 'open' | 'closed' | 'error'
export type RoomRole = 'host' | 'guest'

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 8000
const RECONNECT_MAX_ATTEMPTS = 6

/**
 * Resolve the PartyKit websocket base URL from NEXT_PUBLIC_PARTYKIT_HOST.
 * Accepts a bare host ("localhost:1999", "motus.user.partykit.dev") or a
 * value that already carries a scheme (http(s):// or ws(s)://).
 */
function resolveWsBase(): string {
  const raw = (process.env.NEXT_PUBLIC_PARTYKIT_HOST || 'localhost:1999').trim()
  const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    const rest = raw.slice(schemeMatch[0].length).replace(/\/$/, '')
    const ws = scheme === 'http' || scheme === 'ws' ? 'ws' : 'wss'
    return `${ws}://${rest}`
  }
  const host = raw.replace(/\/$/, '')
  const isLocal = host.startsWith('localhost') || host.startsWith('127.')
  return `${isLocal ? 'ws' : 'wss'}://${host}`
}

/**
 * Thin client for a Motus versus room. Wraps a native browser WebSocket
 * with capped-exponential-backoff reconnection. SSR-safe: WebSocket is only
 * touched inside connect(), never at module or construction time.
 */
export class RoomClient {
  onMessage: (msg: AnyMsg) => void = () => {}
  onStatus: (s: RoomStatus) => void = () => {}

  // Multiple consumers (page.tsx lobby/pause/end + GameCanvas input/snap)
  // listen to the same socket; onMessage above stays for single-listener use.
  private listeners = new Set<(msg: AnyMsg) => void>()

  addMessageListener(fn: (msg: AnyMsg) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private ws: WebSocket | null = null
  private url: string | null = null
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false
  /** last input msg sent while the socket was down, re-sent on (re)open */
  private pendingInput: InputMsg | null = null

  connect(code: string, role: RoomRole): void {
    if (typeof WebSocket === 'undefined') return // SSR guard
    this.closedByUser = false
    this.url = `${resolveWsBase()}/parties/main/${code}?role=${role}`
    this.attempts = 0
    this.open()
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
      return
    }
    // Not open: drop, except remember the latest input to resend on open
    // so the host never sees stale held keys after a reconnect.
    if (msg.t === 'input') this.pendingInput = msg
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    this.onStatus('closed')
  }

  private open(): void {
    if (!this.url) return
    this.onStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.attempts = 0
      this.onStatus('open')
      if (this.pendingInput) {
        ws.send(JSON.stringify(this.pendingInput))
        this.pendingInput = null
      }
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return
      const msg = parseMsg(ev.data)
      if (!msg) return
      this.onMessage(msg)
      for (const fn of this.listeners) fn(msg)
    }

    ws.onerror = () => {
      if (this.ws !== ws) return
      this.onStatus('error')
    }

    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.closedByUser) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.attempts >= RECONNECT_MAX_ATTEMPTS) {
      this.onStatus('closed')
      return
    }
    this.attempts++
    const backoff = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** (this.attempts - 1),
    )
    const delay = backoff * (0.5 + Math.random() * 0.5) // jitter: 50–100%
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUser) this.open()
    }, delay)
  }
}
