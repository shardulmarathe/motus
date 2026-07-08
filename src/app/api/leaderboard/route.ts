import { NextResponse } from 'next/server'
import { maxScoreForDuration, verifyGameSession } from '../../../lib/game-session'
import {
  fetchLeaderboardTop,
  findLeaderboardEntry,
  insertLeaderboardEntry,
  getGameSession,
  markGameSessionConsumed,
  updateLeaderboardScore,
} from '../../../lib/leaderboard-db'
import {
  filterPublicLeaderboardEntries,
  isAppropriateUsername,
  isValidScore,
  isValidUsername,
  isUsernameTakenOnTopLeaderboard,
  normalizeUsername,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  usernamesMatch,
} from '../../../lib/leaderboard'

export const dynamic = 'force-dynamic'

const TOP_N = 7

export async function GET() {
  try {
    const rows = await fetchLeaderboardTop(TOP_N * 4)
    const entries = filterPublicLeaderboardEntries(rows).slice(0, TOP_N)
    return NextResponse.json({ entries })
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
      return NextResponse.json(
        { error: `Invalid username (${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} letters, numbers, spaces, - or _)` },
        { status: 400 }
      )
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

    const gameSession = await getGameSession(session.sid)
    if (!gameSession) {
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

    const existing = await findLeaderboardEntry(username)
    const top = filterPublicLeaderboardEntries(await fetchLeaderboardTop(TOP_N * 4)).slice(0, TOP_N)

    const boardRow =
      existing ?? top.find((entry) => usernamesMatch(entry.username, username)) ?? null

    if (boardRow) {
      if (boardRow.score >= score) {
        await markGameSessionConsumed(session.sid)
        return NextResponse.json({ entries: top, updated: false })
      }

      try {
        await updateLeaderboardScore(boardRow.username, score)
      } catch (error) {
        console.error('leaderboard POST update:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
      }
    } else {
      if (isUsernameTakenOnTopLeaderboard(username, top)) {
        return NextResponse.json({ error: 'Username is already on the leaderboard' }, { status: 400 })
      }

      try {
        await insertLeaderboardEntry(username, score)
      } catch (error) {
        console.error('leaderboard POST insert:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
      }
    }

    await markGameSessionConsumed(session.sid)
    const updatedTop = filterPublicLeaderboardEntries(await fetchLeaderboardTop(TOP_N * 4)).slice(0, TOP_N)
    return NextResponse.json({ entries: updatedTop, updated: true })
  } catch (e) {
    console.error('leaderboard POST:', e)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
}

function usernamesEqual(a: string, b: string): boolean {
  return usernamesMatch(a, b)
}
