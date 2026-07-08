import { createHmac, randomUUID, timingSafeEqual } from 'crypto'

/** Max survival run length before session expires. */
export const MAX_SESSION_MS = 45 * 60 * 1000

/** Minimum elapsed time per point (allows cataclysm bursts; still blocks instant fake scores). */
export const MIN_MS_PER_POINT = 400

/** Minimum run time before any score can be submitted. */
export const MIN_RUN_MS = 2000

export type VerifiedGameSession = {
  sid: string
  username: string
  iat: number
  exp: number
}

export function getSessionSecret(): string {
  const secret = process.env.LEADERBOARD_SESSION_SECRET?.trim()
  if (!secret) {
    throw new Error('Missing LEADERBOARD_SESSION_SECRET')
  }
  return secret
}

export function createSessionId(): string {
  return randomUUID()
}

export function signGameSession(username: string, sessionId: string, startedAt: number): string {
  const exp = startedAt + MAX_SESSION_MS
  const payload = JSON.stringify({ sid: sessionId, user: username, iat: startedAt, exp })
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url')
  const sig = createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyGameSession(token: string): VerifiedGameSession | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null

  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url')

  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (typeof payload.sid !== 'string' || typeof payload.user !== 'string') return null
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return { sid: payload.sid, username: payload.user, iat: payload.iat, exp: payload.exp }
  } catch {
    return null
  }
}

export function maxScoreForDuration(startedAtMs: number, nowMs = Date.now()): number {
  const elapsed = nowMs - startedAtMs
  if (elapsed < MIN_RUN_MS) return 0
  return Math.floor(elapsed / MIN_MS_PER_POINT)
}
