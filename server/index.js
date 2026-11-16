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
    if (session) {
      req.session = session;
      return next();
    }

    // Direct bearer token fallback
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const sessRes = await query(
        `SELECT s.*, u.id AS "user_id", u.name, u.email
         FROM session s
         JOIN "user" u ON s."userId" = u.id
         WHERE s.token = $1 AND s."expiresAt" > NOW()
         LIMIT 1`,
        [token]
      );
      if (sessRes.rows.length) {
        const row = sessRes.rows[0];
        req.session = {
          session: { id: row.id, userId: row.user_id, token: row.token, expiresAt: row.expiresAt },
          user: { id: row.user_id, name: row.name, email: row.email }
        };
        return next();
      }
    }

    res.status(401).json({ error: 'Authentication required.' });
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
    const validTestClientIds = new Set(mockTests.rows.map(r => String(r.client_id || r.id)));
    for (const row of mockTests.rows) {
      const testId = String(row.client_id || row.id);
      if (!existingTestIds.has(testId)) {
        stateObj.mockTests.push({
          id: testId,
          name: row.name || 'Mock Test',
          marks: Number(row.score) || 0,
          totalMarks: 100,
          date: safeIsoDate(row.tested_at) || safeIsoDate(row.created_at),
          description: row.notes || '',
          pointers: row.notes || '',
          hasPaper: false,
          createdAt: row.created_at ? row.created_at.toISOString() : new Date().toISOString()
        });
        existingTestIds.add(testId);
      }
    }

    // Ensure mock_test_mistakes from Neon DB table are merged into stateObj.mistakes only if their test exists
    const existingMistakeIds = new Set((stateObj.mistakes || []).map(m => m && String(m.id)).filter(Boolean));
    for (const row of mistakes.rows) {
      const mistakeId = String(row.client_id || row.id);
      const testClientId = row.mock_test_client_id || (row.mock_test_id ? String(row.mock_test_id) : null);
      // Skip orphaned mistakes from tests that were deleted
      if (testClientId && !validTestClientIds.has(String(testClientId))) {
        continue;
      }
      if (!existingMistakeIds.has(mistakeId)) {
        stateObj.mistakes.push({
          id: mistakeId,
          mockTestId: testClientId,
          test: row.test_name || '',
          subject: row.subject || '',
          questionNo: row.question_no || '',
          userAnswer: row.user_answer || '',
          correctAnswer: row.correct_answer || row.status || '',
          status: row.status || row.correct_answer || '',
          topic: row.topic || 'General',
          whyCorrection: row.why_correction || row.error || '',
          revisionAction: row.revision_action || row.correction || '',
          error: row.why_correction || row.error || '',
          correction: row.revision_action || row.correction || '',
          pointers: row.pointers || row.revision_action || '',
          marks: Number(row.marks) || Number(row.marks_lost) || 0,
          marksLost: Number(row.marks_lost) || Number(row.marks) || 0,
          isBlank: Boolean(row.is_blank),
          mistakeType: row.mistake_type || 'Conceptual misunderstanding',
          resolved: Boolean(row.resolved),
          source: row.source || 'excel_import',
          date: safeIsoDate(row.created_at)
        });
        existingMistakeIds.add(mistakeId);
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
        const errorText = mistake.whyCorrection || mistake.error || '';
        const correctionText = mistake.revisionAction || mistake.correction || '';
        const markVal = parseFloat(mistake.marksLost ?? mistake.marks) || 0;
        await client.query(
          `INSERT INTO mock_test_mistakes (
             user_id, client_id, mock_test_client_id, topic, subject, error, correction,
             resolved, question_no, user_answer, correct_answer, status, why_correction,
             revision_action, marks, marks_lost, is_blank, mistake_type, pointers, source, test_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET mock_test_client_id = EXCLUDED.mock_test_client_id,
             topic = EXCLUDED.topic, subject = EXCLUDED.subject,
             error = EXCLUDED.error, correction = EXCLUDED.correction,
             resolved = EXCLUDED.resolved, question_no = EXCLUDED.question_no,
             user_answer = EXCLUDED.user_answer, correct_answer = EXCLUDED.correct_answer,
             status = EXCLUDED.status, why_correction = EXCLUDED.why_correction,
             revision_action = EXCLUDED.revision_action, marks = EXCLUDED.marks,
             marks_lost = EXCLUDED.marks_lost, is_blank = EXCLUDED.is_blank,
             mistake_type = EXCLUDED.mistake_type, pointers = EXCLUDED.pointers,
             source = EXCLUDED.source, test_name = EXCLUDED.test_name`,
          [
            userId,
            String(mistake.id),
            mistake.mockTestId ? String(mistake.mockTestId) : null,
            String(mistake.topic || 'General'),
            mistake.subject || null,
            errorText,
            correctionText,
            Boolean(mistake.resolved),
            mistake.questionNo || null,
            mistake.userAnswer || null,
            mistake.correctAnswer || null,
            mistake.status || null,
            errorText,
            correctionText,
            markVal,
            markVal,
            Boolean(mistake.isBlank),
            mistake.mistakeType || null,
            mistake.pointers || correctionText || null,
            mistake.source || null,
            mistake.test || null
          ]
        );
      }

      const testIds = mockTests.map(test => test && String(test.id)).filter(Boolean);
      const mistakeIds = mistakes.map(mistake => mistake && String(mistake.id)).filter(Boolean);
      await client.query(
        `DELETE FROM mock_test_mistakes
         WHERE user_id = $1 AND (
           (client_id IS NOT NULL AND NOT (client_id = ANY($2::text[])))
           OR (mock_test_client_id IS NOT NULL AND NOT (mock_test_client_id = ANY($3::text[])))
         )`,
        [userId, mistakeIds, testIds]
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

// Dedicated Instant Mistake Logging & Upload Endpoint
app.post(['/api/mistakes/upload', '/mistakes/upload', '/api/mistakes', '/mistakes'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const body = req.body || {};
    const inputMistakes = Array.isArray(body.mistakes) ? body.mistakes : [];
    if (!inputMistakes.length) {
      res.status(400).json({ error: 'No mistakes provided in payload.' });
      return;
    }

    const testId = String(body.testId || `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const testName = String(body.testName || 'Mock Test Review');
    const testDate = safeIsoDate(body.testDate) || new Date().toISOString().slice(0, 10);
    const totalMarks = Number(body.totalMarks) || 100;
    const totalMarksLost = inputMistakes.reduce((sum, m) => sum + (parseFloat(m.marksLost ?? m.marks) || 0), 0);
    const score = Math.max(0, Math.round((totalMarks - totalMarksLost) * 100) / 100);

    const client = await pool.connect();
    let savedTest = null;
    const savedMistakes = [];

    try {
      await client.query('BEGIN');

      // 1. Upsert mock test
      await client.query(
        `INSERT INTO mock_tests (user_id, client_id, name, tested_at, score, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, tested_at = EXCLUDED.tested_at,
           score = EXCLUDED.score, notes = EXCLUDED.notes`,
        [
          userId,
          testId,
          testName,
          testDate,
          score,
          `Imported ${inputMistakes.length} questions from spreadsheet`
        ]
      );

      savedTest = {
        id: testId,
        name: testName,
        marks: score,
        totalMarks,
        date: testDate,
        description: `Imported ${inputMistakes.length} questions from spreadsheet`,
        pointers: '',
        hasPaper: false,
        createdAt: new Date().toISOString()
      };

      // 2. Insert all mistakes
      for (const m of inputMistakes) {
        const mistakeId = String(m.id || `mistake_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        const qNo = String(m.questionNo || '').trim();
        const yourAns = String(m.userAnswer || '').trim();
        const correctAns = String(m.correctAnswer || '').trim();
        const status = String(m.status || (m.isBlank ? 'Blank' : 'Incorrect')).trim();
        const topic = String(m.topic || 'General').trim() || 'General';
        const whyCorrection = String(m.whyCorrection || m.error || '').trim();
        const revisionAction = String(m.revisionAction || m.correction || '').trim();
        const marks = parseFloat(m.marks ?? m.marksLost) || 0;
        const marksLost = parseFloat(m.marksLost ?? m.marks) || 0;
        const isBlank = Boolean(m.isBlank);
        const mistakeType = String(m.mistakeType || (isBlank ? 'Unattempted / Left blank' : 'Conceptual misunderstanding'));

        await client.query(
          `INSERT INTO mock_test_mistakes (
             user_id, client_id, mock_test_client_id, topic, subject, error, correction,
             resolved, question_no, user_answer, correct_answer, status, why_correction,
             revision_action, marks, marks_lost, is_blank, mistake_type, pointers, source, test_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET mock_test_client_id = EXCLUDED.mock_test_client_id,
             topic = EXCLUDED.topic, subject = EXCLUDED.subject,
             error = EXCLUDED.error, correction = EXCLUDED.correction,
             resolved = EXCLUDED.resolved, question_no = EXCLUDED.question_no,
             user_answer = EXCLUDED.user_answer, correct_answer = EXCLUDED.correct_answer,
             status = EXCLUDED.status, why_correction = EXCLUDED.why_correction,
             revision_action = EXCLUDED.revision_action, marks = EXCLUDED.marks,
             marks_lost = EXCLUDED.marks_lost, is_blank = EXCLUDED.is_blank,
             mistake_type = EXCLUDED.mistake_type, pointers = EXCLUDED.pointers,
             source = EXCLUDED.source, test_name = EXCLUDED.test_name`,
          [
            userId,
            mistakeId,
            testId,
            topic,
            testName,
            whyCorrection,
            revisionAction,
            false,
            qNo,
            yourAns,
            correctAns,
            status,
            whyCorrection,
            revisionAction,
            marks,
            marksLost,
            isBlank,
            mistakeType,
            revisionAction || null,
            'excel_import',
            testName
          ]
        );

        savedMistakes.push({
          id: mistakeId,
          mockTestId: testId,
          test: testName,
          subject: testName,
          questionNo: qNo,
          userAnswer: yourAns,
          correctAnswer: correctAns,
          status,
          topic,
          whyCorrection,
          revisionAction,
          error: whyCorrection,
          correction: revisionAction,
          pointers: revisionAction,
          marks,
          marksLost,
          isBlank,
          mistakeType,
          resolved: false,
          source: 'excel_import',
          date: testDate
        });
      }

      // 3. Keep user_settings snapshot synced
      const currentSettingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = (currentSettingsRes.rows[0]?.settings && typeof currentSettingsRes.rows[0].settings === 'object')
        ? currentSettingsRes.rows[0].settings
        : {};
      
      const updatedTests = [
        ...(currentSettings.mockTests || []).filter(t => t && String(t.id) !== testId),
        savedTest
      ];
      const newMistakeIds = new Set(savedMistakes.map(m => String(m.id)));
      const updatedMistakes = [
        ...(currentSettings.mistakes || []).filter(m => m && !newMistakeIds.has(String(m.id))),
        ...savedMistakes
      ];

      currentSettings.mockTests = updatedTests;
      currentSettings.mistakes = updatedMistakes;

      await client.query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, JSON.stringify(currentSettings)]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      count: savedMistakes.length,
      test: savedTest,
      mistakes: savedMistakes
    });
  } catch (error) {
    next(error);
  }
});

// Delete Entire Mock Test and its Mistakes
app.delete(['/api/mistakes/test/:testId', '/mistakes/test/:testId'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { testId } = req.params;
    if (!testId) {
      res.status(400).json({ error: 'testId is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM mock_test_mistakes WHERE user_id = $1 AND (mock_test_client_id = $2 OR mock_test_id::text = $2)',
        [userId, String(testId)]
      );
      await client.query(
        'DELETE FROM mock_tests WHERE user_id = $1 AND (client_id = $2 OR id::text = $2)',
        [userId, String(testId)]
      );

      const settingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = settingsRes.rows[0]?.settings || {};
      if (Array.isArray(currentSettings.mockTests)) {
        currentSettings.mockTests = currentSettings.mockTests.filter(t => t && String(t.id) !== String(testId));
      }
      if (Array.isArray(currentSettings.mistakes)) {
        currentSettings.mistakes = currentSettings.mistakes.filter(m => m && String(m.mockTestId) !== String(testId));
      }

      await client.query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, JSON.stringify(currentSettings)]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, deletedTestId: testId });
  } catch (error) {
    next(error);
  }
});

// Delete All Mistakes and Mock Tests for current user
app.delete(['/api/mistakes/all', '/mistakes/all'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM mock_test_mistakes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM mock_tests WHERE user_id = $1', [userId]);

      const settingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = settingsRes.rows[0]?.settings || {};
      currentSettings.mockTests = [];
      currentSettings.mistakes = [];

      await client.query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, JSON.stringify(currentSettings)]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Delete Single Mistake
app.delete(['/api/mistakes/:id', '/mistakes/:id'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM mock_test_mistakes WHERE user_id = $1 AND (client_id = $2 OR id::text = $2)',
        [userId, String(id)]
      );

      const settingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = settingsRes.rows[0]?.settings || {};
      if (Array.isArray(currentSettings.mistakes)) {
        currentSettings.mistakes = currentSettings.mistakes.filter(m => m && String(m.id) !== String(id));
      }

      await client.query(
        `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, JSON.stringify(currentSettings)]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, deletedId: id });
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
