-- Migration 004: Add paper support for mock tests and mock_test_papers table in Neon DB

ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS has_paper BOOLEAN DEFAULT FALSE;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS file_type TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS file_size INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS mock_test_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size INTEGER NOT NULL DEFAULT 0,
  file_data TEXT NOT NULL, -- Base64 encoded file string
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mock_test_papers_user_test_unique UNIQUE (user_id, test_id)
);

CREATE INDEX IF NOT EXISTS mock_test_papers_user_test_idx ON mock_test_papers (user_id, test_id);
