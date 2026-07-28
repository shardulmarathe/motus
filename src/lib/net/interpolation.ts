import {
  EXTRAP_MAX_MS,
  INTERP_DELAY_MS,
  NET_STALL_MS,
  SnapEnemy,
  SnapGameData,
  SnapGoal,
  SnapMsg,
  SnapPlayer,
  TELEPORT_SNAP_PX,
} from './protocol'

/** Interpolated view of the world at a render instant; mirrors SnapMsg post-lerp. */
export type SampledState = {
  players: [SnapPlayer, SnapPlayer]
  enemies: SnapEnemy[]
  goals: SnapGoal[]
  gd: SnapGameData
  arena: { w: number; h: number }
}

const RING_SIZE = 10

type Entry = { snap: SnapMsg; receivedAtMs: number }

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Lerp positions of two states of the same entity; snap (don't slide) across teleports. */
function lerpPoint<T extends { x: number; y: number }>(older: T, newer: T, t: number): T {
  const dx = newer.x - older.x
  const dy = newer.y - older.y
  if (dx * dx + dy * dy > TELEPORT_SNAP_PX * TELEPORT_SNAP_PX) return newer
  return { ...newer, x: lerp(older.x, newer.x, t), y: lerp(older.y, newer.y, t) }
}

/**
 * Buffers host snapshots on the guest and samples them INTERP_DELAY_MS in
 * the past for smooth rendering. Snapshot `ts` (host sim-elapsed ms) is
 * mapped to the local clock via the median of the per-snapshot offsets
 * (receivedAtMs - ts) currently in the ring — the median is robust to the
 * occasional delayed packet while staying trivially simple.
 */
export class SnapshotBuffer {
  private ring: Entry[] = []
  private lastReceivedAtMs: number | null = null

  push(snap: SnapMsg, receivedAtMs: number): void {
    // Ignore out-of-order snapshots (older sim time than the newest held).
    const newest = this.ring[this.ring.length - 1]
    if (newest && snap.ts <= newest.snap.ts) return
    this.ring.push({ snap, receivedAtMs })
    if (this.ring.length > RING_SIZE) this.ring.shift()
    this.lastReceivedAtMs = receivedAtMs
  }

  isStalled(nowMs: number): boolean {
    if (this.lastReceivedAtMs === null) return true
    return nowMs - this.lastReceivedAtMs >= NET_STALL_MS
  }

  /** Median of (receivedAtMs - snap.ts): local-clock ms corresponding to snapshot ts 0. */
  private clockOffset(): number {
    const offsets = this.ring.map((e) => e.receivedAtMs - e.snap.ts).sort((a, b) => a - b)
    return offsets[Math.floor(offsets.length / 2)]
  }

  sample(nowMs: number): SampledState | null {
    if (this.ring.length === 0) return null

    // Target render time mapped into snapshot-ts space.
    const target = nowMs - INTERP_DELAY_MS - this.clockOffset()
    const newest = this.ring[this.ring.length - 1]
    const oldest = this.ring[0]

    if (target >= newest.snap.ts) {
      // Ahead of the newest snapshot: extrapolate with velocities, then freeze.
      const dtMs = Math.min(target - newest.snap.ts, EXTRAP_MAX_MS)
      return this.extrapolate(newest.snap, dtMs)
    }
    if (target <= oldest.snap.ts) return this.toState(oldest.snap)

    // Find the bracketing pair (older.ts <= target < newer.ts).
    for (let i = this.ring.length - 1; i > 0; i--) {
      const older = this.ring[i - 1].snap
      const newer = this.ring[i].snap
      if (older.ts <= target && target <= newer.ts) {
        const span = newer.ts - older.ts
        const t = span > 0 ? (target - older.ts) / span : 1
        return this.lerpSnaps(older, newer, t)
      }
    }
    return this.toState(newest.snap) // unreachable, defensive
  }

  private lerpSnaps(older: SnapMsg, newer: SnapMsg, t: number): SampledState {
    const players: [SnapPlayer, SnapPlayer] = [
      lerpPoint(older.players[0], newer.players[0], t),
      lerpPoint(older.players[1], newer.players[1], t),
    ]
    const olderEnemies = new Map(older.enemies.map((e) => [e.id, e]))
    // Match enemies by id; ones present only in the newer snap are taken
    // un-lerped (freshly spawned), ones only in the older snap are dropped.
    const enemies = newer.enemies.map((e) => {
      const prev = olderEnemies.get(e.id)
      return prev ? lerpPoint(prev, e, t) : e
    })
    // Non-positional fields come from the newer snapshot.
    return { players, enemies, goals: newer.goals, gd: newer.gd, arena: newer.arena }
  }

  /** Advance positions by velocity for dtMs. Velocities are px per sim-second. */
  private extrapolate(snap: SnapMsg, dtMs: number): SampledState {
    const dt = dtMs / 1000
    const advance = <T extends { x: number; y: number; vx: number; vy: number }>(e: T): T => ({
      ...e,
      x: e.x + e.vx * dt,
      y: e.y + e.vy * dt,
    })
    return {
      players: [advance(snap.players[0]), advance(snap.players[1])],
      enemies: snap.enemies.map(advance),
      goals: snap.goals,
      gd: snap.gd,
      arena: snap.arena,
    }
  }

  private toState(snap: SnapMsg): SampledState {
    return {
      players: [snap.players[0], snap.players[1]],
      enemies: snap.enemies,
      goals: snap.goals,
      gd: snap.gd,
      arena: snap.arena,
    }
  }
}
