/**
 * One-off admin script — run with: npx tsx scripts/leaderboard-admin.mjs
 * Requires .env.local with Supabase credentials.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
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
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing Supabase env vars in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: rows, error: listError } = await supabase.from('leaderboard').select('username')
if (listError) {
  console.error('List failed:', listError.message)
  process.exit(1)
}

const toRemove = (rows ?? []).filter((r) => !isAppropriateUsername(r.username))
if (toRemove.length === 0) {
  console.log('No disallowed leaderboard rows to remove.')
} else {
  for (const row of toRemove) {
    const { error } = await supabase.from('leaderboard').delete().eq('username', row.username)
    if (error) {
      console.error(`Delete failed for ${row.username}:`, error.message)
      process.exit(1)
    }
    console.log(`Removed: ${row.username}`)
  }
}

console.log('Done.')
