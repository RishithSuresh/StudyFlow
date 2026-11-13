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
app.use(express.json({ limit: '100kb' }));

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

app.get('/api/workspace', requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [tasks, subjects, skills, events, mistakes, sessions] = await Promise.all([
      query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_at NULLS LAST, created_at DESC', [userId]),
      query('SELECT * FROM academic_subjects WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM calendar_events WHERE user_id = $1 ORDER BY starts_at', [userId]),
      query('SELECT * FROM mock_test_mistakes WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100', [userId])
    ]);
    res.json({
      tasks: tasks.rows,
      subjects: subjects.rows,
      skills: skills.rows,
      events: events.rows,
      mistakes: mistakes.rows,
      sessions: sessions.rows
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(port, () => {
  console.log(`StudyFlow API listening on http://localhost:${port}`);
});
