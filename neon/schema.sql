-- Motus leaderboard schema (Neon Postgres)
-- Applied via Neon MCP to project "Motus" (summer-firefly-14614867).

CREATE TABLE IF NOT EXISTS leaderboard (
  username TEXT PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 999999),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leaderboard_score_idx ON leaderboard (score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS game_sessions_username_idx ON game_sessions (username);
