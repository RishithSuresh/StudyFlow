import './env.js';
import express from 'express';
import cors from 'cors';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { pool, query } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '1mb' }));

async function requireSession(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });
    if (!session) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', requireSession, (req, res) => {
  res.json({ user: req.session.user, session: req.session.session });
});

app.get('/api/statistics', requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [summary, focus, activeDates] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*) FROM tasks WHERE user_id = $1) AS total_tasks,
          (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND completed = TRUE) AS completed_tasks,
          (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND completed = FALSE AND due_at < NOW()) AS overdue_tasks,
          (SELECT COUNT(*) FROM academic_subjects WHERE user_id = $1) AS total_subjects,
          (SELECT COUNT(*) FROM skills WHERE user_id = $1) AS total_skills
      `, [userId]),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE mode = 'pomodoro' AND completed = TRUE) AS completed_sessions,
          COALESCE(SUM(duration_seconds) FILTER (WHERE mode = 'pomodoro' AND completed = TRUE), 0) AS focus_seconds,
          COALESCE(SUM(duration_seconds) FILTER (
            WHERE mode = 'pomodoro' AND completed = TRUE
            AND started_at >= NOW() - INTERVAL '7 days'
          ), 0) AS weekly_focus_seconds
        FROM study_sessions
        WHERE user_id = $1
      `, [userId]),
      query(`
        SELECT DISTINCT started_at::date AS study_date
        FROM study_sessions
        WHERE user_id = $1
          AND mode = 'pomodoro'
          AND completed = TRUE
          AND started_at >= NOW() - INTERVAL '365 days'
        ORDER BY study_date DESC
      `, [userId])
    ]);

    const totals = summary.rows[0];
    const focusTotals = focus.rows[0];
    const totalTasks = Number(totals.total_tasks);
    const completedTasks = Number(totals.completed_tasks);
    const activeDateSet = new Set(activeDates.rows.map(row => String(row.study_date).slice(0, 10)));
    let streak = 0;
    const cursor = new Date();
    if (!activeDateSet.has(cursor.toISOString().slice(0, 10))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    while (activeDateSet.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    res.json({
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        overdue: Number(totals.overdue_tasks),
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0
      },
      focus: {
        completedSessions: Number(focusTotals.completed_sessions),
        totalMinutes: Math.round(Number(focusTotals.focus_seconds) / 60),
        weeklyMinutes: Math.round(Number(focusTotals.weekly_focus_seconds) / 60)
      },
      streak,
      subjects: Number(totals.total_subjects),
      skills: Number(totals.total_skills)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/workspace', requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [tasks, subjects, skills, events, mistakes, sessions, settings] = await Promise.all([
      query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_at NULLS LAST, created_at DESC', [userId]),
      query('SELECT * FROM academic_subjects WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM calendar_events WHERE user_id = $1 ORDER BY starts_at', [userId]),
      query('SELECT * FROM mock_test_mistakes WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100', [userId]),
      query('SELECT settings FROM user_settings WHERE user_id = $1', [userId])
    ]);
    res.json({
      tasks: tasks.rows,
      subjects: subjects.rows,
      skills: skills.rows,
      events: events.rows,
      mistakes: mistakes.rows,
      sessions: sessions.rows,
      state: settings.rows[0]?.settings || null
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/workspace', requireSession, async (req, res, next) => {
  try {
    const state = req.body?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      res.status(400).json({ error: 'Workspace state must be an object.' });
      return;
    }

    const userId = req.session.user.id;
    const mockTests = Array.isArray(state.mockTests) ? state.mockTests : [];
    const mistakes = Array.isArray(state.mistakes) ? state.mistakes : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const test of mockTests) {
        await client.query(
          `INSERT INTO mock_tests (user_id, client_id, name, tested_at, score, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name, tested_at = EXCLUDED.tested_at,
             score = EXCLUDED.score, notes = EXCLUDED.notes`,
          [
            userId,
            String(test.id),
            String(test.name || 'Mock Test'),
            test.date || null,
            Number(test.marks) || 0,
            test.description || test.pointers || null
          ]
        );
      }

      for (const mistake of mistakes) {
        await client.query(
          `INSERT INTO mock_test_mistakes (
             user_id, client_id, mock_test_client_id, topic, subject, error, correction,
             resolved, question_no, user_answer, correct_answer, marks_lost, is_blank,
             mistake_type, pointers, source, test_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET mock_test_client_id = EXCLUDED.mock_test_client_id,
             topic = EXCLUDED.topic, subject = EXCLUDED.subject, error = EXCLUDED.error,
             correction = EXCLUDED.correction, resolved = EXCLUDED.resolved,
             question_no = EXCLUDED.question_no, user_answer = EXCLUDED.user_answer,
             correct_answer = EXCLUDED.correct_answer, marks_lost = EXCLUDED.marks_lost,
             is_blank = EXCLUDED.is_blank, mistake_type = EXCLUDED.mistake_type,
             pointers = EXCLUDED.pointers, source = EXCLUDED.source, test_name = EXCLUDED.test_name`,
          [
            userId,
            String(mistake.id),
            mistake.mockTestId ? String(mistake.mockTestId) : null,
            String(mistake.topic || 'General'),
            mistake.subject || null,
            mistake.error || null,
            mistake.correction || null,
            Boolean(mistake.resolved),
            mistake.questionNo || null,
            mistake.userAnswer || null,
            mistake.correctAnswer || null,
            Number(mistake.marksLost) || 0,
            Boolean(mistake.isBlank),
            mistake.mistakeType || null,
            mistake.pointers || null,
            mistake.source || null,
            mistake.test || null
          ]
        );
      }

      const testIds = mockTests.map(test => String(test.id));
      const mistakeIds = mistakes.map(mistake => String(mistake.id));
      await client.query(
        `DELETE FROM mock_test_mistakes
         WHERE user_id = $1 AND client_id IS NOT NULL
           AND NOT (client_id = ANY($2::text[]))`,
        [userId, mistakeIds]
      );
      await client.query(
        `DELETE FROM mock_tests
         WHERE user_id = $1 AND client_id IS NOT NULL
           AND NOT (client_id = ANY($2::text[]))`,
        [userId, testIds]
      );
      await client.query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, JSON.stringify(state)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/study-sessions', requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { mode, durationSeconds, taskId, startedAt, endedAt, completed } = req.body;
    const result = await query(
      `INSERT INTO study_sessions (user_id, task_id, mode, started_at, ended_at, duration_seconds, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        taskId || null,
        mode || 'pomodoro',
        startedAt || new Date().toISOString(),
        endedAt || new Date().toISOString(),
        Number(durationSeconds) || 0,
        completed !== undefined ? Boolean(completed) : true
      ]
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`StudyFlow API listening on http://localhost:${port}`);
  });
}

export { app };
