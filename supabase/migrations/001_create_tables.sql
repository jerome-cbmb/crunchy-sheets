-- ============================================================================
-- Crunchy Sheets — Database Schema
-- Supabase project: diselpdcsgjgetgmixhc (us-west-2)
--
-- Tables:
--   users    — Registered users (linked to Google account)
--   sessions — Analysis sessions (one per spreadsheet interaction)
--   usage    — Token usage tracking for billing & analytics
-- ============================================================================

-- ─── Users ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups by Google ID (used on every request)
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Sessions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spreadsheet_id      TEXT NOT NULL,
  workbook_state_hash TEXT,         -- SHA-256 of the state string (for cache invalidation)
  model_used          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_spreadsheet ON sessions(spreadsheet_id);

-- ─── Usage ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  skill_used  TEXT,                 -- NULL for general analysis
  model_used  TEXT,
  cost_usd    NUMERIC(10, 6),      -- Computed cost (optional, for billing)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage(created_at);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Service key bypasses RLS, but set it up for future direct client access.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_all" ON users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON sessions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON usage
  FOR ALL USING (true) WITH CHECK (true);

-- ─── Useful Views ───────────────────────────────────────────────────────────

-- Monthly usage summary per user (for billing dashboard)
CREATE OR REPLACE VIEW usage_monthly AS
SELECT
  u.id AS user_id,
  u.email,
  u.plan,
  DATE_TRUNC('month', us.created_at) AS month,
  COUNT(*)                            AS request_count,
  SUM(us.tokens_in)                   AS total_tokens_in,
  SUM(us.tokens_out)                  AS total_tokens_out,
  SUM(us.cost_usd)                    AS total_cost_usd
FROM users u
JOIN usage us ON us.user_id = u.id
GROUP BY u.id, u.email, u.plan, DATE_TRUNC('month', us.created_at);
