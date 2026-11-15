ALTER TABLE mock_tests
  ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mock_tests_user_client_idx
  ON mock_tests (user_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE mock_test_mistakes
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS mock_test_client_id TEXT,
  ADD COLUMN IF NOT EXISTS question_no TEXT,
  ADD COLUMN IF NOT EXISTS user_answer TEXT,
  ADD COLUMN IF NOT EXISTS correct_answer TEXT,
  ADD COLUMN IF NOT EXISTS marks_lost NUMERIC,
  ADD COLUMN IF NOT EXISTS is_blank BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mistake_type TEXT,
  ADD COLUMN IF NOT EXISTS pointers TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS test_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mock_test_mistakes_user_client_idx
  ON mock_test_mistakes (user_id, client_id)
  WHERE client_id IS NOT NULL;
