import { NextResponse } from 'next/server'
import { createSessionId, getSessionSecret, signGameSession } from '../../../../lib/game-session'
import { createGameSession } from '../../../../lib/leaderboard-db'
import { isAllowedUsername, normalizeUsername } from '../../../../lib/leaderboard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = typeof body.username === 'string' ? normalizeUsername(body.username) : ''

    if (!isAllowedUsername(username)) {
      return NextResponse.json({ error: 'Invalid or disallowed username' }, { status: 400 })
    }

    // Validate signing secret before any DB write so a missing env var never
    // leaves an orphaned game_sessions row.
    try {
      getSessionSecret()
    } catch {
      return NextResponse.json(
        { error: 'Leaderboard temporarily unavailable' },
        { status: 503 }
      )
    }

    const sessionId = createSessionId()
    const startedAt = new Date()

    try {
      await createGameSession(sessionId, username, startedAt)
    } catch (error) {
      console.error('game session create:', error)
      return NextResponse.json(
        { error: 'Could not start game session. Run neon/schema.sql in your Neon database.' },
        { status: 500 }
      )
    }

    const sessionToken = signGameSession(username, sessionId, startedAt.getTime())
    return NextResponse.json({ sessionToken })
  } catch (e) {
    console.error('game session POST:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}
