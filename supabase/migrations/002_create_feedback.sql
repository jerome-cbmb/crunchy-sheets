-- ============================================================================
-- Feedback table — user-submitted feedback from sidebar
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      TEXT NOT NULL,
  text            TEXT NOT NULL,
  screenshot_b64  TEXT,              -- base64 image data (optional)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON feedback
  FOR ALL USING (true) WITH CHECK (true);
