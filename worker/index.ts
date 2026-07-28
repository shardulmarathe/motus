import {
  parseMsg,
  PeerLeftMsg,
  PeersMsg,
  RoomErrorMsg,
} from '../src/lib/net/protocol'

// Thin relay for Motus versus rooms, as a Cloudflare Worker + Durable Object.
//
// This replaces the PartyKit deployment. PartyKit's managed platform puts every
// project on the shared `partykit.dev` zone, which has hit Cloudflare's hard cap
// of 10,000 custom domains per zone, so new deploys are refused. A plain Worker
// gets a free `*.workers.dev` subdomain and needs no custom domain at all.
//
// The wire contract is unchanged: the client (src/lib/net/room.ts) still opens a
// native WebSocket at `/parties/main/<room-code>?role=host|guest`, so nothing in
// the game had to change.
//
// As in the PartyKit version, the Workers runtime types are mirrored
// structurally rather than imported, so this file typechecks under the Next
// app's tsconfig (which includes `**/*.ts`) without pulling in
// @cloudflare/workers-types. Wrangler bundles with esbuild and does not
// typecheck, so the real runtime shapes apply at deploy time.

interface WsLike {
  send(message: string): void
  close(code?: number, reason?: string): void
}

/**
 * The subset of DurableObjectState we use. `acceptWebSocket` opts into the
 * WebSocket Hibernation API: an idle room (a host waiting for someone to join)
 * costs no duration, which matters on the free tier. Tags are how we find a
 * socket again after a hibernation wake, so no instance state is kept.
 */
interface DurableState {
  acceptWebSocket(ws: WsLike, tags?: string[]): void
  getWebSockets(tag?: string): WsLike[]
}

interface RoomStub {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  ROOMS: {
    idFromName(name: string): unknown
    get(id: unknown): RoomStub
  }
}

type Role = 'host' | 'guest'

/** Matches `/parties/main/<code>` with an optional trailing slash. */
const ROOM_PATH = /^\/parties\/main\/([^/]+)\/?$/

function parseRole(url: string): Role | null {
  try {
    const role = new URL(url).searchParams.get('role')
    return role === 'host' || role === 'guest' ? role : null
  } catch {
    return null
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') return new Response('ok')

    const match = url.pathname.match(ROOM_PATH)
    if (!match) return new Response('Not found', { status: 404 })

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }

    // The room code IS the Durable Object name, so every player using a code
    // lands on the same instance. Uppercased to match the client's alphabet.
    const code = decodeURIComponent(match[1]).toUpperCase()
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
    return stub.fetch(request)
  },
}

/**
 * One room. Holds at most one host and one guest; forwards guest input to the
 * host and host state to the guest, and never echoes a message to its sender.
 */
export class MotusVersusRoom {
  constructor(private readonly ctx: DurableState) {}

  async fetch(request: Request): Promise<Response> {
    const role = parseRole(request.url)

    // `WebSocketPair` is a Workers runtime global with no DOM equivalent.
    const pair = new (globalThis as unknown as {
      WebSocketPair: new () => { 0: WsLike; 1: WsLike }
    }).WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    const reason = this.rejectionFor(role)

    if (reason) {
      // Accept before closing so the client actually receives `roomError` —
      // the lobby renders that reason. Tagged `rejected` so it can never be
      // mistaken for a live host or guest.
      this.ctx.acceptWebSocket(server, ['rejected'])
      this.send(server, JSON.stringify({ t: 'roomError', reason } satisfies RoomErrorMsg))
      server.close(4000, reason)
    } else {
      this.ctx.acceptWebSocket(server, [role as Role])
      this.broadcastPeers()
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WsLike })
  }

  webSocketMessage(ws: WsLike, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return
    const msg = parseMsg(message)
    if (!msg) return

    const host = this.socketFor('host')
    const guest = this.socketFor('guest')

    if (guest && ws === guest) {
      // guest → host only
      if (msg.t === 'input' || msg.t === 'pauseRequest') this.send(host, message)
    } else if (host && ws === host) {
      // host → guest only
      if (
        msg.t === 'snap' ||
        msg.t === 'start' ||
        msg.t === 'pause' ||
        msg.t === 'resume' ||
        msg.t === 'end'
      ) {
        this.send(guest, message)
      }
    }
    // anything else is dropped
  }

  webSocketClose(ws: WsLike): void {
    this.handleDeparture(ws)
  }

  webSocketError(ws: WsLike): void {
    this.handleDeparture(ws)
  }

  private handleDeparture(ws: WsLike): void {
    let leftRole: Role | null = null
    if (ws === this.socketFor('host')) leftRole = 'host'
    else if (ws === this.socketFor('guest')) leftRole = 'guest'
    if (leftRole === null) return

    // The departing socket can still be listed while this handler runs, so it
    // is excluded explicitly rather than assumed gone.
    const peerLeft: PeerLeftMsg = { t: 'peerLeft', role: leftRole }
    this.broadcast(JSON.stringify(peerLeft), ws)
    this.broadcastPeers(ws)
  }

  /** The reason this role cannot join, or null if it can. */
  private rejectionFor(role: Role | null): RoomErrorMsg['reason'] | null {
    const hostPresent = this.socketFor('host') !== null
    const guestPresent = this.socketFor('guest') !== null

    if (role === 'host') {
      if (!hostPresent) return null
      return guestPresent ? 'full' : 'badRole'
    }
    if (role === 'guest') {
      if (!hostPresent) return 'noHost'
      return guestPresent ? 'full' : null
    }
    return 'badRole'
  }

  private socketFor(role: Role, exclude?: WsLike): WsLike | null {
    for (const ws of this.ctx.getWebSockets(role)) {
      if (ws !== exclude) return ws
    }
    return null
  }

  private broadcast(message: string, exclude?: WsLike): void {
    this.send(this.socketFor('host', exclude), message)
    this.send(this.socketFor('guest', exclude), message)
  }

  private broadcastPeers(exclude?: WsLike): void {
    const peers: PeersMsg = {
      t: 'peers',
      hostPresent: this.socketFor('host', exclude) !== null,
      guestPresent: this.socketFor('guest', exclude) !== null,
    }
    this.broadcast(JSON.stringify(peers), exclude)
  }

  /** Sending on a socket that is already closing throws; a dead peer is not an error. */
  private send(ws: WsLike | null, message: string): void {
    if (!ws) return
    try {
      ws.send(message)
    } catch {
      /* peer already gone */
    }
  }
}
