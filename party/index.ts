import {
  parseMsg,
  PeerLeftMsg,
  PeersMsg,
  RoomErrorMsg,
} from '../src/lib/net/protocol'

// Minimal structural types mirroring the surface of `partykit/server`.
// We deliberately avoid importing from 'partykit/server' so the app
// typechecks without the partykit dev-dependency; the real types come in
// when partykit is added at deploy time. Because these are structural,
// this default class remains compatible with PartyKit's Server contract.
interface Connection {
  id: string
  send(message: string): void
  close(code?: number, reason?: string): void
}

interface Room {
  id: string
  broadcast(message: string, without?: string[]): void
  getConnections(): Iterable<Connection>
}

interface ConnectionContext {
  request: { url: string }
}

type Role = 'host' | 'guest'

/**
 * Thin relay for Motus versus rooms. The room id IS the room code.
 * Holds at most one host and one guest; forwards guest input to the host
 * and host state to the guest. Never echoes a message back to its sender.
 */
export default class MotusVersusServer {
  private hostConnId: string | null = null
  private guestConnId: string | null = null

  constructor(readonly room: Room) {}

  onConnect(conn: Connection, ctx: ConnectionContext): void {
    const role = this.parseRole(ctx.request.url)

    if (role === 'host') {
      if (this.hostConnId !== null) {
        this.reject(conn, this.guestConnId !== null ? 'full' : 'badRole')
        return
      }
      this.hostConnId = conn.id
    } else if (role === 'guest') {
      if (this.hostConnId === null) {
        this.reject(conn, 'noHost')
        return
      }
      if (this.guestConnId !== null) {
        this.reject(conn, 'full')
        return
      }
      this.guestConnId = conn.id
    } else {
      this.reject(conn, 'badRole')
      return
    }

    this.broadcastPeers()
  }

  onMessage(message: string, sender: Connection): void {
    const msg = parseMsg(message)
    if (!msg) return

    if (sender.id === this.guestConnId) {
      // guest → host only
      if (msg.t === 'input' || msg.t === 'pauseRequest') {
        this.sendTo(this.hostConnId, message)
      }
    } else if (sender.id === this.hostConnId) {
      // host → guest only
      if (
        msg.t === 'snap' ||
        msg.t === 'start' ||
        msg.t === 'pause' ||
        msg.t === 'resume' ||
        msg.t === 'end'
      ) {
        this.sendTo(this.guestConnId, message)
      }
    }
    // anything else is dropped
  }

  onClose(conn: Connection): void {
    let leftRole: Role | null = null
    if (conn.id === this.hostConnId) {
      this.hostConnId = null
      leftRole = 'host'
    } else if (conn.id === this.guestConnId) {
      this.guestConnId = null
      leftRole = 'guest'
    }
    if (leftRole === null) return

    const peerLeft: PeerLeftMsg = { t: 'peerLeft', role: leftRole }
    this.room.broadcast(JSON.stringify(peerLeft))
    this.broadcastPeers()
  }

  private parseRole(url: string): Role | null {
    try {
      const role = new URL(url).searchParams.get('role')
      return role === 'host' || role === 'guest' ? role : null
    } catch {
      return null
    }
  }

  private reject(conn: Connection, reason: RoomErrorMsg['reason']): void {
    const err: RoomErrorMsg = { t: 'roomError', reason }
    conn.send(JSON.stringify(err))
    conn.close(4000, reason)
  }

  private sendTo(connId: string | null, message: string): void {
    if (connId === null) return
    for (const c of this.room.getConnections()) {
      if (c.id === connId) {
        c.send(message)
        return
      }
    }
  }

  private broadcastPeers(): void {
    const peers: PeersMsg = {
      t: 'peers',
      hostPresent: this.hostConnId !== null,
      guestPresent: this.guestConnId !== null,
    }
    this.room.broadcast(JSON.stringify(peers))
  }
}
