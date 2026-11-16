import './env.js';
import express from 'express';
import cors from 'cors';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { pool, query } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      origin.includes('localhost') ||
      origin.endsWith('.vercel.app') ||
      (process.env.FRONTEND_ORIGIN && origin === process.env.FRONTEND_ORIGIN) ||
      (process.env.BETTER_AUTH_URL && origin === process.env.BETTER_AUTH_URL)
    ) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true
}));
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '10mb' }));

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

app.get(['/api/health', '/health'], async (_req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get(['/api/me', '/me'], requireSession, (req, res) => {
  res.json({ user: req.session.user, session: req.session.session });
});

app.get(['/api/statistics', '/statistics'], requireSession, async (req, res, next) => {
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

function safeIsoDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

app.get(['/api/workspace', '/workspace'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [tasks, subjects, skills, events, mockTests, mistakes, sessions, settings] = await Promise.all([
      query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_at NULLS LAST, created_at DESC', [userId]),
      query('SELECT * FROM academic_subjects WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM calendar_events WHERE user_id = $1 ORDER BY starts_at', [userId]),
      query('SELECT * FROM mock_tests WHERE user_id = $1 ORDER BY tested_at DESC NULLS LAST, created_at DESC', [userId]),
      query('SELECT * FROM mock_test_mistakes WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100', [userId]),
      query('SELECT settings FROM user_settings WHERE user_id = $1', [userId])
    ]);

    const userSettingsObj = (settings.rows[0]?.settings && typeof settings.rows[0].settings === 'object' && !Array.isArray(settings.rows[0].settings))
      ? settings.rows[0].settings
      : {};

    const stateObj = {
      subjects: userSettingsObj.subjects || [],
      tasks: userSettingsObj.tasks || [],
      skills: userSettingsObj.skills || [],
      events: userSettingsObj.events || [],
      focus: userSettingsObj.focus || { minutes: {}, sessions: 0 },
      mockTests: userSettingsObj.mockTests || [],
      mistakes: userSettingsObj.mistakes || []
    };

    // Ensure mock_tests from Neon DB table are merged into stateObj.mockTests
    const existingTestIds = new Set((stateObj.mockTests || []).map(t => t && String(t.id)).filter(Boolean));
    for (const row of mockTests.rows) {
      const testId = row.client_id || row.id;
      if (!existingTestIds.has(String(testId))) {
        stateObj.mockTests.push({
          id: String(testId),
          name: row.name || 'Mock Test',
          marks: Number(row.score) || 0,
          totalMarks: 100,
          date: safeIsoDate(row.tested_at) || safeIsoDate(row.created_at),
          description: row.notes || '',
          pointers: row.notes || '',
          hasPaper: false,
          createdAt: row.created_at ? row.created_at.toISOString() : new Date().toISOString()
        });
        existingTestIds.add(String(testId));
      }
    }

    // Ensure mock_test_mistakes from Neon DB table are merged into stateObj.mistakes
    const existingMistakeIds = new Set((stateObj.mistakes || []).map(m => m && String(m.id)).filter(Boolean));
    for (const row of mistakes.rows) {
      const mistakeId = row.client_id || row.id;
      if (!existingMistakeIds.has(String(mistakeId))) {
        stateObj.mistakes.push({
          id: String(mistakeId),
          mockTestId: row.mock_test_client_id || (row.mock_test_id ? String(row.mock_test_id) : null),
          test: row.test_name || '',
          subject: row.subject || '',
          questionNo: row.question_no || '',
          userAnswer: row.user_answer || '',
          correctAnswer: row.correct_answer || '',
          topic: row.topic || 'General',
          error: row.error || '',
          correction: row.correction || '',
          pointers: row.pointers || '',
          marksLost: Number(row.marks_lost) || 0,
          isBlank: Boolean(row.is_blank),
          mistakeType: row.mistake_type || 'Conceptual misunderstanding',
          resolved: Boolean(row.resolved),
          source: row.source || 'excel_import',
          date: safeIsoDate(row.created_at)
        });
        existingMistakeIds.add(String(mistakeId));
      }
    }

    res.json({
      tasks: tasks.rows,
      subjects: subjects.rows,
      skills: skills.rows,
      events: events.rows,
      mockTests: mockTests.rows,
      mistakes: mistakes.rows,
      sessions: sessions.rows,
      state: stateObj
    });
  } catch (error) {
    next(error);
  }
});

app.put(['/api/workspace', '/workspace'], requireSession, async (req, res, next) => {
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
        if (!test || !test.id) continue;
        const testDate = safeIsoDate(test.date) || safeIsoDate(test.createdAt);
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
            testDate,
            parseFloat(test.marks) || 0,
            test.description || test.pointers || null
          ]
        );
      }

      for (const mistake of mistakes) {
        if (!mistake || !mistake.id) continue;
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
            parseFloat(mistake.marksLost) || 0,
            Boolean(mistake.isBlank),
            mistake.mistakeType || null,
            mistake.pointers || null,
            mistake.source || null,
            mistake.test || null
          ]
        );
      }

      const testIds = mockTests.map(test => test && String(test.id)).filter(Boolean);
      const mistakeIds = mistakes.map(mistake => mistake && String(mistake.id)).filter(Boolean);
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
    res.json({ ok: true, count: mistakes.length });
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
