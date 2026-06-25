import { NextResponse } from 'next/server'
import { maxScoreForDuration, verifyGameSession } from '../../../lib/game-session'
import { isValidScore, isValidUsername, normalizeUsername, type LeaderboardEntry } from '../../../lib/leaderboard'
import { createAnonSupabaseClient, createServiceSupabaseClient } from '../../../lib/supabase/server'

export const dynamic = 'force-dynamic'

const TOP_N = 7

export async function GET() {
  try {
    const supabase = createAnonSupabaseClient()
    const { data, error } = await supabase
      .from('leaderboard')
      .select('username, score, updated_at')
      .order('score', { ascending: false })
      .order('updated_at', { ascending: true })
      .limit(TOP_N)

    if (error) {
      console.error('leaderboard GET:', error)
      return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 })
    }

    return NextResponse.json({ entries: (data ?? []) as LeaderboardEntry[] })
  } catch (e) {
    console.error('leaderboard GET:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = typeof body.username === 'string' ? normalizeUsername(body.username) : ''
    const score = body.score
    const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : ''

    if (!isValidUsername(username)) {
      return NextResponse.json({ error: 'Invalid username (2–16 letters, numbers, spaces, - or _)' }, { status: 400 })
    }
    if (!isValidScore(score)) {
      return NextResponse.json({ error: 'Invalid score' }, { status: 400 })
    }
    if (!sessionToken) {
      return NextResponse.json({ error: 'Missing game session' }, { status: 400 })
    }

    const session = verifyGameSession(sessionToken)
    if (!session || !usernamesEqual(session.username, username)) {
      return NextResponse.json({ error: 'Invalid or expired game session' }, { status: 403 })
    }

    const maxAllowed = maxScoreForDuration(session.iat)
    if (score > maxAllowed) {
      return NextResponse.json({ error: 'Score exceeds allowed maximum for run duration' }, { status: 400 })
    }

    const supabase = createServiceSupabaseClient()

    const { data: gameSession, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, username, consumed_at')
      .eq('id', session.sid)
      .maybeSingle()

    if (sessionError || !gameSession) {
      return NextResponse.json({ error: 'Unknown game session' }, { status: 403 })
    }
    if (!usernamesEqual(gameSession.username, username)) {
      return NextResponse.json({ error: 'Session username mismatch' }, { status: 403 })
    }
    if (gameSession.consumed_at) {
      return NextResponse.json({ error: 'Game session already used' }, { status: 403 })
    }

    const { data: existing } = await supabase
      .from('leaderboard')
      .select('score')
      .eq('username', username)
      .maybeSingle()

    if (existing && existing.score >= score) {
      await markSessionConsumed(supabase, session.sid)
      const top = await fetchTop(supabase)
      return NextResponse.json({ entries: top, updated: false })
    }

    const { error } = await supabase.from('leaderboard').upsert(
      { username, score, updated_at: new Date().toISOString() },
      { onConflict: 'username' }
    )

    if (error) {
      console.error('leaderboard POST:', error)
      return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }

    await markSessionConsumed(supabase, session.sid)
    const top = await fetchTop(supabase)
    return NextResponse.json({ entries: top, updated: true })
  } catch (e) {
    console.error('leaderboard POST:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}

function usernamesEqual(a: string, b: string): boolean {
  return normalizeUsername(a).toLowerCase() === normalizeUsername(b).toLowerCase()
}

async function markSessionConsumed(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  sessionId: string
) {
  await supabase
    .from('game_sessions')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', sessionId)
}

async function fetchTop(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data } = await supabase
    .from('leaderboard')
    .select('username, score, updated_at')
    .order('score', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(TOP_N)
  return (data ?? []) as LeaderboardEntry[]
}
