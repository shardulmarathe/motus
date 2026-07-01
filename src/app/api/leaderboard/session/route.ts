import { NextResponse } from 'next/server'
import { createSessionId, signGameSession } from '../../../../lib/game-session'
import { isAllowedUsername, normalizeUsername } from '../../../../lib/leaderboard'
import { createServiceSupabaseClient } from '../../../../lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = typeof body.username === 'string' ? normalizeUsername(body.username) : ''

    if (!isAllowedUsername(username)) {
      return NextResponse.json({ error: 'Invalid or disallowed username' }, { status: 400 })
    }

    const sessionId = createSessionId()
    const startedAt = Date.now()
    const supabase = createServiceSupabaseClient()

    const { error } = await supabase.from('game_sessions').insert({
      id: sessionId,
      username,
      started_at: new Date(startedAt).toISOString(),
    })

    if (error) {
      console.error('game session create:', error)
      return NextResponse.json(
        { error: 'Could not start game session. Run supabase/game_sessions.sql in Supabase.' },
        { status: 500 }
      )
    }

    const sessionToken = signGameSession(username, sessionId, startedAt)
    return NextResponse.json({ sessionToken })
  } catch (e) {
    console.error('game session POST:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}
