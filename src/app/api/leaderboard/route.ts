import { NextResponse } from 'next/server'
import { maxScoreForDuration, verifyGameSession } from '../../../lib/game-session'
import {
  findLeaderboardEntry,
  isAppropriateUsername,
  isValidScore,
  isValidUsername,
  isUsernameTakenOnTopLeaderboard,
  normalizeUsername,
  usernamesMatch,
  type LeaderboardEntry,
} from '../../../lib/leaderboard'
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
    if (!isAppropriateUsername(username)) {
      return NextResponse.json({ error: 'Username not allowed' }, { status: 400 })
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

    const supabase = createServiceSupabaseClient()

    const { data: gameSession, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, username, started_at, consumed_at')
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

    const runStartedAt = new Date(gameSession.started_at).getTime()
    const maxAllowed = maxScoreForDuration(runStartedAt)
    if (score > maxAllowed) {
      return NextResponse.json({ error: 'Score exceeds allowed maximum for run duration' }, { status: 400 })
    }

    const existing = await findLeaderboardEntry(supabase, username)
    const top = await fetchTop(supabase)

    // Returning player already on the board (including top 7) — always allow personal-best update.
    const boardRow =
      existing ?? top.find((entry) => usernamesMatch(entry.username, username)) ?? null

    if (boardRow) {
      if (boardRow.score >= score) {
        await markSessionConsumed(supabase, session.sid)
        return NextResponse.json({ entries: top, updated: false })
      }

      const { error } = await supabase
        .from('leaderboard')
        .update({ score, updated_at: new Date().toISOString() })
        .eq('username', boardRow.username)

      if (error) {
        console.error('leaderboard POST update:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
      }
    } else {
      if (isUsernameTakenOnTopLeaderboard(username, top)) {
        return NextResponse.json({ error: 'Username is already on the leaderboard' }, { status: 400 })
      }

      const { error } = await supabase.from('leaderboard').insert({
        username,
        score,
        updated_at: new Date().toISOString(),
      })

      if (error) {
        console.error('leaderboard POST insert:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
      }
    }

    await markSessionConsumed(supabase, session.sid)
    const updatedTop = await fetchTop(supabase)
    return NextResponse.json({ entries: updatedTop, updated: true })
  } catch (e) {
    console.error('leaderboard POST:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}

function usernamesEqual(a: string, b: string): boolean {
  return usernamesMatch(a, b)
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
