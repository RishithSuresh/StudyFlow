-- Migration 003: Dedicated columns for Excel mistake logging
-- Q No. | Your Answer | Correct Answer / Status | Topic | Why your response needs correction | Revision action | Marks

ALTER TABLE mock_test_mistakes
  ADD COLUMN IF NOT EXISTS question_no TEXT,
  ADD COLUMN IF NOT EXISTS user_answer TEXT,
  ADD COLUMN IF NOT EXISTS correct_answer TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS topic TEXT,
  ADD COLUMN IF NOT EXISTS why_correction TEXT,
  ADD COLUMN IF NOT EXISTS revision_action TEXT,
  ADD COLUMN IF NOT EXISTS marks NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marks_lost NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS mock_test_mistakes_topic_idx ON mock_test_mistakes (user_id, topic);
CREATE INDEX IF NOT EXISTS mock_test_mistakes_test_idx ON mock_test_mistakes (user_id, mock_test_client_id);
