import './env.js';
import express from 'express';
import cors from 'cors';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { query } from './db.js';

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

    await query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
      [req.session.user.id, JSON.stringify(state)]
    );
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
