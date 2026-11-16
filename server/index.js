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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

function safeIsoDate(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    return val.slice(0, 10);
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

app.get(['/api/statistics', '/statistics'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [summary, focus, sessionDates, userSettingsRow, testDates] = await Promise.all([
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
      `, [userId]),
      query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]),
      query(`
        SELECT DISTINCT COALESCE(tested_at, created_at::date) AS test_date
        FROM mock_tests
        WHERE user_id = $1
      `, [userId])
    ]);

    const totals = summary.rows[0];
    const focusTotals = focus.rows[0];
    const userSettingsObj = (userSettingsRow.rows[0]?.settings && typeof userSettingsRow.rows[0].settings === 'object' && !Array.isArray(userSettingsRow.rows[0].settings))
      ? userSettingsRow.rows[0].settings
      : {};

    const activeDateSet = new Set();

    // 1. Study sessions from database
    for (const row of sessionDates.rows) {
      const d = safeIsoDate(row.study_date);
      if (d) activeDateSet.add(d);
    }

    // 2. Mock tests from database
    for (const row of testDates.rows) {
      const d = safeIsoDate(row.test_date);
      if (d) activeDateSet.add(d);
    }

    // 3. User settings: focus minutes
    const focusMinutes = userSettingsObj.focus?.minutes || {};
    for (const [dateStr, mins] of Object.entries(focusMinutes)) {
      if (Number(mins) > 0) {
        const d = safeIsoDate(dateStr);
        if (d) activeDateSet.add(d);
      }
    }

    // 4. User settings: completed tasks
    const tasksInSettings = Array.isArray(userSettingsObj.tasks) ? userSettingsObj.tasks : [];
    for (const t of tasksInSettings) {
      if (t && (t.done || t.completed)) {
        const d = safeIsoDate(t.completedAt) || safeIsoDate(t.due) || safeIsoDate(t.date);
        if (d) activeDateSet.add(d);
      }
    }

    // 5. User settings: mock tests
    const testsInSettings = Array.isArray(userSettingsObj.mockTests) ? userSettingsObj.mockTests : [];
    for (const t of testsInSettings) {
      if (t) {
        const d = safeIsoDate(t.date) || safeIsoDate(t.testedAt) || safeIsoDate(t.createdAt);
        if (d) activeDateSet.add(d);
      }
    }

    // Calculate daily consecutive streak
    const formatDate = (date) => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const now = new Date();
    const todayStr = formatDate(now);
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayStr = formatDate(yesterday);

    let streak = 0;
    let cursor = null;

    if (activeDateSet.has(todayStr)) {
      cursor = new Date(now.getTime());
    } else if (activeDateSet.has(yesterdayStr)) {
      cursor = new Date(yesterday.getTime());
    }

    if (cursor) {
      while (activeDateSet.has(formatDate(cursor))) {
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }

    // Task counts: merge DB totals with userSettings totals if DB is empty
    let totalTasks = Number(totals.total_tasks) || 0;
    let completedTasks = Number(totals.completed_tasks) || 0;
    let overdueTasks = Number(totals.overdue_tasks) || 0;

    if (totalTasks === 0 && tasksInSettings.length > 0) {
      totalTasks = tasksInSettings.length;
      completedTasks = tasksInSettings.filter(t => t.done || t.completed).length;
      overdueTasks = tasksInSettings.filter(t => !t.done && !t.completed && t.due && t.due < todayStr).length;
    }

    // Focus totals: merge DB totals with settings focus
    const settingsFocusMinutes = Object.values(focusMinutes).reduce((acc, m) => acc + (Number(m) || 0), 0);
    const dbFocusMinutes = Math.round((Number(focusTotals.focus_seconds) || 0) / 60);
    const totalMinutes = Math.max(dbFocusMinutes, settingsFocusMinutes);

    res.json({
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        overdue: overdueTasks,
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0
      },
      focus: {
        completedSessions: Math.max(Number(focusTotals.completed_sessions) || 0, Number(userSettingsObj.focus?.sessions) || 0),
        totalMinutes,
        weeklyMinutes: Math.max(Math.round((Number(focusTotals.weekly_focus_seconds) || 0) / 60), totalMinutes)
      },
      streak,
      activeDays: activeDateSet.size,
      activeDates: Array.from(activeDateSet).sort().reverse(),
      subjects: Number(totals.total_subjects) || (userSettingsObj.subjects?.length || 0),
      skills: Number(totals.total_skills) || (userSettingsObj.skills?.length || 0)
    });
  } catch (error) {
    next(error);
  }
});

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
          hasPaper: Boolean(row.has_paper),
          fileName: row.file_name || '',
          fileType: row.file_type || '',
          fileSize: Number(row.file_size) || 0,
          createdAt: row.created_at ? row.created_at.toISOString() : new Date().toISOString()
        });
        existingTestIds.add(testId);
      } else {
        const existing = stateObj.mockTests.find(t => t && String(t.id) === testId);
        if (existing && row.has_paper) {
          existing.hasPaper = true;
          existing.fileName = existing.fileName || row.file_name || '';
          existing.fileType = existing.fileType || row.file_type || '';
          existing.fileSize = existing.fileSize || Number(row.file_size) || 0;
        }
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
          `INSERT INTO mock_tests (user_id, client_id, name, tested_at, score, notes, has_paper, file_name, file_type, file_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name, tested_at = EXCLUDED.tested_at,
             score = EXCLUDED.score, notes = EXCLUDED.notes,
             has_paper = EXCLUDED.has_paper, file_name = EXCLUDED.file_name,
             file_type = EXCLUDED.file_type, file_size = EXCLUDED.file_size`,
          [
            userId,
            String(test.id),
            String(test.name || 'Mock Test'),
            testDate,
            parseFloat(test.marks) || 0,
            test.description || test.pointers || null,
            Boolean(test.hasPaper),
            test.fileName || null,
            test.fileType || null,
            parseInt(test.fileSize, 10) || 0
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
        `DELETE FROM mock_test_papers
         WHERE user_id = $1
           AND NOT (test_id = ANY($2::text[]))`,
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

      // 1. Check existing paper and upsert mock test
      const existingPaperRes = await client.query('SELECT file_name, file_type, file_size FROM mock_test_papers WHERE user_id = $1 AND test_id = $2', [userId, testId]);
      const hasExistingPaper = existingPaperRes.rows.length > 0;
      const willHavePaper = Boolean(body.paperFileData || hasExistingPaper);
      const finalFileName = body.paperFileName || (hasExistingPaper ? existingPaperRes.rows[0].file_name : '');
      const finalFileType = body.paperFileType || (hasExistingPaper ? existingPaperRes.rows[0].file_type : '');
      const finalFileSize = parseInt(body.paperFileSize, 10) || (hasExistingPaper ? existingPaperRes.rows[0].file_size : 0);

      if (body.paperFileData) {
        await client.query(
          `INSERT INTO mock_test_papers (user_id, test_id, file_name, file_type, file_size, file_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (user_id, test_id)
           DO UPDATE SET file_name = EXCLUDED.file_name, file_type = EXCLUDED.file_type,
             file_size = EXCLUDED.file_size, file_data = EXCLUDED.file_data, updated_at = NOW()`,
          [userId, testId, finalFileName || 'question-paper.pdf', finalFileType || 'application/pdf', finalFileSize, body.paperFileData]
        );
      }

      await client.query(
        `INSERT INTO mock_tests (user_id, client_id, name, tested_at, score, notes, has_paper, file_name, file_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, tested_at = EXCLUDED.tested_at,
           score = EXCLUDED.score, notes = EXCLUDED.notes,
           has_paper = EXCLUDED.has_paper, file_name = EXCLUDED.file_name,
           file_type = EXCLUDED.file_type, file_size = EXCLUDED.file_size`,
        [
          userId,
          testId,
          testName,
          testDate,
          score,
          `Imported ${inputMistakes.length} questions from spreadsheet`,
          willHavePaper,
          finalFileName,
          finalFileType,
          finalFileSize
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
        hasPaper: willHavePaper,
        fileName: finalFileName,
        fileType: finalFileType,
        fileSize: finalFileSize,
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
      await client.query(
        'DELETE FROM mock_test_papers WHERE user_id = $1 AND test_id = $2',
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
      await client.query('DELETE FROM mock_test_papers WHERE user_id = $1', [userId]);

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

// =========================================================================
// Question Paper Storage Endpoints (PDF / Images)
// =========================================================================

// Upload / Save Paper File
app.post(['/api/papers/upload', '/papers/upload', '/api/papers', '/papers'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { testId, fileName, fileType, fileSize, fileData } = req.body || {};

    if (!testId || !fileData) {
      res.status(400).json({ error: 'testId and fileData are required.' });
      return;
    }

    const cleanFileName = String(fileName || 'question-paper.pdf').trim();
    const cleanFileType = String(fileType || 'application/pdf').trim();
    const cleanFileSize = parseInt(fileSize, 10) || 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Upsert into mock_test_papers table
      await client.query(
        `INSERT INTO mock_test_papers (user_id, test_id, file_name, file_type, file_size, file_data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, test_id)
         DO UPDATE SET file_name = EXCLUDED.file_name, file_type = EXCLUDED.file_type,
           file_size = EXCLUDED.file_size, file_data = EXCLUDED.file_data, updated_at = NOW()`,
        [userId, String(testId), cleanFileName, cleanFileType, cleanFileSize, fileData]
      );

      // 2. Update mock_tests metadata in Neon DB table
      await client.query(
        `UPDATE mock_tests
         SET has_paper = TRUE, file_name = $3, file_type = $4, file_size = $5
         WHERE user_id = $1 AND (client_id = $2 OR id::text = $2)`,
        [userId, String(testId), cleanFileName, cleanFileType, cleanFileSize]
      );

      // 3. Keep user_settings snapshot synced
      const settingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = settingsRes.rows[0]?.settings || {};
      if (Array.isArray(currentSettings.mockTests)) {
        const t = currentSettings.mockTests.find(x => x && String(x.id) === String(testId));
        if (t) {
          t.hasPaper = true;
          t.fileName = cleanFileName;
          t.fileType = cleanFileType;
          t.fileSize = cleanFileSize;
        }
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

    res.json({
      ok: true,
      testId,
      fileName: cleanFileName,
      fileType: cleanFileType,
      fileSize: cleanFileSize
    });
  } catch (error) {
    next(error);
  }
});

// Retrieve / View Paper File
app.get(['/api/papers/:testId', '/papers/:testId'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { testId } = req.params;

    const result = await query(
      `SELECT file_name, file_type, file_size, file_data, updated_at
       FROM mock_test_papers
       WHERE user_id = $1 AND test_id = $2
       LIMIT 1`,
      [userId, String(testId)]
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'Paper file not found for this test.' });
      return;
    }

    const row = result.rows[0];

    // Raw file streaming for in-browser PDF viewer or direct download
    if (req.query.raw === '1' || req.query.view === '1' || req.query.download === '1') {
      let base64Data = row.file_data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      const buffer = Buffer.from(base64Data, 'base64');
      const mime = row.file_type || 'application/pdf';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buffer.length);
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(row.file_name || 'paper.pdf')}"`);
      res.send(buffer);
      return;
    }

    res.json({
      ok: true,
      testId,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSize: row.file_size,
      fileData: row.file_data,
      updatedAt: row.updated_at
    });
  } catch (error) {
    next(error);
  }
});

// Delete Paper File
app.delete(['/api/papers/:testId', '/papers/:testId'], requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { testId } = req.params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'DELETE FROM mock_test_papers WHERE user_id = $1 AND test_id = $2',
        [userId, String(testId)]
      );

      await client.query(
        `UPDATE mock_tests
         SET has_paper = FALSE, file_name = '', file_type = '', file_size = 0
         WHERE user_id = $1 AND (client_id = $2 OR id::text = $2)`,
        [userId, String(testId)]
      );

      const settingsRes = await client.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      const currentSettings = settingsRes.rows[0]?.settings || {};
      if (Array.isArray(currentSettings.mockTests)) {
        const t = currentSettings.mockTests.find(x => x && String(x.id) === String(testId));
        if (t) {
          t.hasPaper = false;
          t.fileName = '';
          t.fileType = '';
          t.fileSize = 0;
          t.thumbnail = null;
        }
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

    res.json({ ok: true, deleted: true, testId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/study-sessions', requireSession, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { mode, durationSeconds, taskId, taskTitle, startedAt, endedAt, completed } = req.body;
    
    // Check if taskId is a valid UUID and exists in tasks table
    let validTaskId = null;
    let clientTaskId = null;
    if (taskId) {
      clientTaskId = String(taskId);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(clientTaskId)) {
        const taskCheck = await query('SELECT id FROM tasks WHERE id = $1 AND user_id = $2', [clientTaskId, userId]);
        if (taskCheck.rows.length > 0) {
          validTaskId = clientTaskId;
        }
      }
    }

    const sessionDuration = Number(durationSeconds) || 0;
    const isCompleted = completed !== undefined ? Boolean(completed) : true;
    const sessionStartedAt = startedAt || new Date().toISOString();
    const sessionEndedAt = endedAt || new Date().toISOString();

    const result = await query(
      `INSERT INTO study_sessions (
         user_id, task_id, task_client_id, task_title, mode, started_at, ended_at, duration_seconds, completed
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        validTaskId,
        clientTaskId,
        taskTitle ? String(taskTitle).slice(0, 255) : null,
        mode || 'pomodoro',
        sessionStartedAt,
        sessionEndedAt,
        sessionDuration,
        isCompleted
      ]
    );

    // Sync focus minutes directly into user_settings table
    if (isCompleted && sessionDuration > 0) {
      try {
        const sessionDate = safeIsoDate(sessionStartedAt) || new Date().toISOString().slice(0, 10);
        const mins = Math.max(1, Math.round(sessionDuration / 60));
        const settingsRow = await query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
        if (settingsRow.rows.length > 0) {
          const currentSettings = settingsRow.rows[0].settings || {};
          currentSettings.focus = currentSettings.focus || { minutes: {}, sessions: 0 };
          currentSettings.focus.minutes = currentSettings.focus.minutes || {};
          currentSettings.focus.minutes[sessionDate] = (currentSettings.focus.minutes[sessionDate] || 0) + mins;
          currentSettings.focus.sessions = (currentSettings.focus.sessions || 0) + 1;
          await query(
            'UPDATE user_settings SET settings = $1::jsonb, updated_at = NOW() WHERE user_id = $2',
            [JSON.stringify(currentSettings), userId]
          );
        }
      } catch (syncErr) {
        console.warn('Failed to update user_settings focus from study-session:', syncErr);
      }
    }

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
