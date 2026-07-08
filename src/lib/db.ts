import { neon } from '@neondatabase/serverless'

export function getSql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('Missing DATABASE_URL')
  }
  return neon(url)
}
