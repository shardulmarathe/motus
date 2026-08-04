/**
 * One-off admin script, run with: npx tsx scripts/leaderboard-admin.mjs
 * Requires .env.local with DATABASE_URL.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'
import { isAppropriateUsername } from '../src/lib/profanity.ts'

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local')
  const raw = readFileSync(path, 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    env[trimmed.slice(0, i)] = trimmed.slice(i + 1)
  }
  return env
}

const env = loadEnvLocal()
const databaseUrl = env.DATABASE_URL
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in .env.local')
  process.exit(1)
}

const sql = neon(databaseUrl)

const rows = await sql`SELECT username FROM leaderboard`
const toRemove = rows.filter((r) => !isAppropriateUsername(r.username))

if (toRemove.length === 0) {
  console.log('No disallowed leaderboard rows to remove.')
} else {
  for (const row of toRemove) {
    await sql`DELETE FROM leaderboard WHERE username = ${row.username}`
    console.log(`Removed: ${row.username}`)
  }
}

console.log('Done.')
