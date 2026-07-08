import { getSql } from './db'
import type { LeaderboardEntry } from './leaderboard'
import { normalizeUsername } from './leaderboard'

type LeaderboardRow = {
  username: string
  score: number
  updated_at: string | Date
}

type GameSessionRow = {
  id: string
  username: string
  started_at: string | Date
  consumed_at: string | Date | null
}

function toLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    username: row.username,
    score: Number(row.score),
    updated_at: new Date(row.updated_at).toISOString(),
  }
}

export async function fetchLeaderboardTop(limit: number): Promise<LeaderboardEntry[]> {
  const sql = getSql()
  const rows = (await sql`
    SELECT username, score, updated_at
    FROM leaderboard
    ORDER BY score DESC, updated_at ASC
    LIMIT ${limit}
  `) as LeaderboardRow[]

  return rows.map(toLeaderboardEntry)
}

export async function findLeaderboardEntry(username: string): Promise<LeaderboardEntry | null> {
  const sql = getSql()
  const normalized = normalizeUsername(username).toLowerCase()
  const rows = (await sql`
    SELECT username, score, updated_at
    FROM leaderboard
    WHERE lower(username) = ${normalized}
    LIMIT 1
  `) as LeaderboardRow[]

  return rows[0] ? toLeaderboardEntry(rows[0]) : null
}

export async function insertLeaderboardEntry(username: string, score: number): Promise<void> {
  const sql = getSql()
  const updatedAt = new Date().toISOString()
  await sql`
    INSERT INTO leaderboard (username, score, updated_at)
    VALUES (${username}, ${score}, ${updatedAt})
  `
}

export async function updateLeaderboardScore(username: string, score: number): Promise<void> {
  const sql = getSql()
  const updatedAt = new Date().toISOString()
  await sql`
    UPDATE leaderboard
    SET score = ${score}, updated_at = ${updatedAt}
    WHERE username = ${username}
  `
}

export type GameSessionRecord = {
  id: string
  username: string
  started_at: string
  consumed_at: string | null
}

export async function createGameSession(
  id: string,
  username: string,
  startedAt: Date
): Promise<void> {
  const sql = getSql()
  await sql`
    INSERT INTO game_sessions (id, username, started_at)
    VALUES (${id}::uuid, ${username}, ${startedAt.toISOString()})
  `
}

export async function getGameSession(id: string): Promise<GameSessionRecord | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT id, username, started_at, consumed_at
    FROM game_sessions
    WHERE id = ${id}::uuid
    LIMIT 1
  `) as GameSessionRow[]

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    started_at: new Date(row.started_at).toISOString(),
    consumed_at: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
  }
}

export async function markGameSessionConsumed(id: string): Promise<void> {
  const sql = getSql()
  const consumedAt = new Date().toISOString()
  await sql`
    UPDATE game_sessions
    SET consumed_at = ${consumedAt}
    WHERE id = ${id}::uuid
  `
}

export async function listLeaderboardUsernames(): Promise<string[]> {
  const sql = getSql()
  const rows = (await sql`SELECT username FROM leaderboard`) as { username: string }[]
  return rows.map((row) => row.username)
}

export async function deleteLeaderboardEntry(username: string): Promise<void> {
  const sql = getSql()
  await sql`DELETE FROM leaderboard WHERE username = ${username}`
}
