ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS task_client_id TEXT,
  ADD COLUMN IF NOT EXISTS task_title TEXT;

CREATE INDEX IF NOT EXISTS study_sessions_user_mode_completed_idx
  ON study_sessions (user_id, mode, completed, started_at DESC);
