const API_BASE = window.STUDYFLOW_API_URL
  || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

const profileName = document.querySelector('#profile-name');
const profileEmail = document.querySelector('#profile-email');
const profileAvatar = document.querySelector('#profile-avatar');
const sidebarName = document.querySelector('#sidebar-user-name');
const sidebarEmail = document.querySelector('#sidebar-user-email');
const badgesCluster = document.querySelector('#profile-badges-cluster');
const statsContainer = document.querySelector('#profile-stats');

const weeklyBarchart = document.querySelector('#profile-weekly-barchart');
const weeklySummary = document.querySelector('#profile-weekly-summary');
const subjectBreakdown = document.querySelector('#profile-subject-breakdown');
const syllabusTotalBadge = document.querySelector('#profile-syllabus-total-badge');
const mistakeBreakdown = document.querySelector('#profile-mistake-breakdown');
const mistakeTotalBadge = document.querySelector('#profile-mistake-total-badge');
const taskPipeline = document.querySelector('#profile-task-pipeline');
const taskRateBadge = document.querySelector('#profile-task-rate-badge');
const recommendationsGrid = document.querySelector('#profile-recommendations-grid');
const refreshBtn = document.querySelector('#profile-refresh-btn');
const signOutBtn = document.querySelector('#profile-sign-out');

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function initials(name) {
  return String(name || 'SF')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() || 'SF';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLocalDb(userId) {
  const candidateKeys = userId ? [`studyflow-v1:${userId}`, 'studyflow-v1'] : ['studyflow-v1'];
  for (const key of candidateKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
  }
  return {
    subjects: [],
    tasks: [],
    events: [],
    mistakes: [],
    mockTests: [],
    skills: [],
    focus: { minutes: {}, sessions: 0 }
  };
}

function getPomodoroSessions() {
  try {
    const raw = localStorage.getItem('deeptick_sessions_v1');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function computeWeeklyFocus(db, pomodoroSessions) {
  const today = new Date();
  const days = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = toIsoDate(d);

    const dbMins = (db.focus && db.focus.minutes && db.focus.minutes[iso]) || 0;
    const sessionMins = pomodoroSessions
      .filter(s => s && s.completedAt && s.completedAt.slice(0, 10) === iso)
      .reduce((sum, s) => sum + Math.round((s.durationSeconds || 0) / 60), 0);

    const totalDayMins = Math.max(dbMins, sessionMins);

    days.push({
      date: iso,
      dayName: dayNames[d.getDay()],
      minutes: totalDayMins,
      isToday: i === 0
    });
  }

  const totalWeeklyMinutes = days.reduce((sum, d) => sum + d.minutes, 0);
  const avgDailyMinutes = Math.round(totalWeeklyMinutes / 7);

  let peakDay = days[0];
  for (const d of days) {
    if (d.minutes > peakDay.minutes) peakDay = d;
  }

  return {
    days,
    totalWeeklyMinutes,
    avgDailyMinutes,
    peakDay
  };
}

function computeSubjectProgress(subjects) {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    return { list: [], totalTopics: 0, doneTopics: 0, overallPct: 0 };
  }

  let totalTopics = 0;
  let doneTopics = 0;

  const list = subjects.map(sub => {
    const topics = Array.isArray(sub.topics) ? sub.topics : [];
    const subTotal = topics.length;
    const subDone = topics.filter(t => t.done).length;
    const pct = subTotal ? Math.round((subDone / subTotal) * 100) : 0;

    totalTopics += subTotal;
    doneTopics += subDone;

    return {
      id: sub.id,
      name: sub.name || 'Untitled Subject',
      total: subTotal,
      done: subDone,
      pct
    };
  });

  const overallPct = totalTopics ? Math.round((doneTopics / totalTopics) * 100) : 0;

  return { list, totalTopics, doneTopics, overallPct };
}

function computeMockTestAndMistakeAnalytics(mockTests, mistakes) {
  const tests = Array.isArray(mockTests) ? mockTests : [];
  const errs = Array.isArray(mistakes) ? mistakes : [];

  let totalScorePct = 0;
  let scoredCount = 0;
  let bestScore = 0;

  tests.forEach(t => {
    const got = Number(t.marksGot ?? t.score ?? 0);
    const total = Number(t.marksTotal ?? t.totalMarks ?? 0);
    if (total > 0) {
      const pct = Math.round((got / total) * 100);
      totalScorePct += pct;
      scoredCount++;
      if (pct > bestScore) bestScore = pct;
    }
  });

  const avgScore = scoredCount > 0 ? Math.round(totalScorePct / scoredCount) : null;

  const totalMistakes = errs.length;
  const resolvedMistakes = errs.filter(m => m.resolved).length;
  const resolutionRate = totalMistakes > 0 ? Math.round((resolvedMistakes / totalMistakes) * 100) : 0;

  const categoryColors = {
    Conceptual: '#d9534f',
    Calculation: '#e08e45',
    Formula: '#8a58d6',
    Misread: '#3f6e8c',
    'Time Pressure': '#d9822b',
    Other: '#707e94'
  };

  const categoryCounts = {
    Conceptual: 0,
    Calculation: 0,
    Formula: 0,
    Misread: 0,
    'Time Pressure': 0,
    Other: 0
  };

  const topicCounts = {};

  errs.forEach(m => {
    const type = m.type || 'Other';
    if (categoryCounts[type] !== undefined) {
      categoryCounts[type]++;
    } else {
      categoryCounts.Other++;
    }

    if (m.topic) {
      const topName = String(m.topic).trim();
      topicCounts[topName] = (topicCounts[topName] || 0) + 1;
    }
  });

  let topWeakTopic = null;
  let topWeakCount = 0;
  for (const [top, count] of Object.entries(topicCounts)) {
    if (count > topWeakCount) {
      topWeakTopic = top;
      topWeakCount = count;
    }
  }

  const categoriesList = Object.keys(categoryCounts)
    .map(name => {
      const count = categoryCounts[name];
      const pct = totalMistakes > 0 ? Math.round((count / totalMistakes) * 100) : 0;
      return {
        name,
        count,
        pct,
        color: categoryColors[name] || '#707e94'
      };
    })
    .sort((a, b) => b.count - a.count);

  const topCategory = categoriesList[0];

  return {
    totalTests: tests.length,
    avgScore,
    bestScore,
    totalMistakes,
    resolvedMistakes,
    resolutionRate,
    categoriesList,
    topCategory,
    topWeakTopic,
    topWeakCount
  };
}

function computeTaskMetrics(tasks, serverTaskStats) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const today = toIsoDate(new Date());

  const total = taskList.length || (serverTaskStats?.total || 0);
  const completed = taskList.filter(t => t.done).length || (serverTaskStats?.completed || 0);
  const overdue = taskList.filter(t => t.due && t.due < today && !t.done).length || (serverTaskStats?.overdue || 0);
  const open = Math.max(0, total - completed - overdue);
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : (serverTaskStats?.completionRate || 0);

  const dailyTasks = taskList.filter(t => t.scope === 'daily' || (!t.scope && (!t.due || t.due === today)));
  const overallTasks = taskList.filter(t => t.scope === 'overall' || (!t.scope && t.due && t.due !== today));
  const carriedForward = taskList.filter(t => t.isCarriedForward && !t.done).length;

  return {
    total,
    completed,
    overdue,
    open,
    completionRate,
    dailyTotal: dailyTasks.length,
    dailyCompleted: dailyTasks.filter(t => t.done).length,
    overallTotal: overallTasks.length,
    overallCompleted: overallTasks.filter(t => t.done).length,
    carriedForward
  };
}

function computeHealthAndTier(taskStats, weeklyFocusMins, streak, mistakeStats) {
  const taskPts = (taskStats.completionRate / 100) * 30;
  const focusPts = Math.min(30, (weeklyFocusMins / 300) * 30);
  const streakPts = Math.min(20, (streak || 0) * 4);
  const mistakePts = (mistakeStats.resolutionRate / 100) * 20;
  const penalty = (taskStats.overdue || 0) * 5;

  let healthScore = Math.round(taskPts + focusPts + streakPts + mistakePts - penalty);
  if (healthScore < 20) healthScore = 20;
  if (healthScore > 99) healthScore = 99;

  let scholarTier = 'Apprentice Learner';
  if (healthScore >= 90) scholarTier = 'Grandmaster Strategist';
  else if (healthScore >= 75) scholarTier = 'Master Analyst';
  else if (healthScore >= 60) scholarTier = 'Advanced Pacer';
  else if (healthScore >= 45) scholarTier = 'Consistent Scholar';

  return { healthScore, scholarTier };
}

function renderWeeklyChart(focusData) {
  if (!weeklyBarchart) return;

  const maxVal = Math.max(60, ...focusData.days.map(d => d.minutes));

  weeklyBarchart.innerHTML = focusData.days.map(d => {
    const heightPct = Math.min(100, Math.max(4, Math.round((d.minutes / maxVal) * 100)));
    return `
      <div class="barchart-col">
        <span class="barchart-val">${d.minutes}m</span>
        <div class="barchart-track">
          <div class="barchart-fill ${d.isToday ? 'today' : ''}" style="height: ${heightPct}%;" title="${d.dayName} (${d.date}): ${d.minutes} mins"></div>
        </div>
        <span class="barchart-day ${d.isToday ? 'is-today' : ''}">${d.dayName}</span>
      </div>
    `;
  }).join('');

  if (weeklySummary) {
    const hours = (focusData.totalWeeklyMinutes / 60).toFixed(1);
    weeklySummary.innerHTML = `
      <span>Weekly Total: <b>${focusData.totalWeeklyMinutes}m (${hours}h)</b></span>
      <span>Daily Average: <b>${focusData.avgDailyMinutes}m/day</b></span>
      <span>Peak Day: <b>${focusData.peakDay.dayName} (${focusData.peakDay.minutes}m)</b></span>
    `;
  }
}

function renderSubjectProgress(subjectData) {
  if (!subjectBreakdown) return;

  if (syllabusTotalBadge) {
    syllabusTotalBadge.textContent = `${subjectData.overallPct}% Complete`;
  }

  if (subjectData.list.length === 0) {
    subjectBreakdown.innerHTML = `
      <div class="panel empty-state" style="padding: 18px; text-align: center; border: 1px dashed var(--sf-border);">
        No subjects added yet. Add subjects and syllabus topics to track mastery breakdown.
      </div>
    `;
    return;
  }

  subjectBreakdown.innerHTML = subjectData.list.map(s => `
    <div class="profile-subject-row">
      <div class="profile-subject-info">
        <span class="profile-subject-name">${escapeHtml(s.name)}</span>
        <span class="muted" style="font-size: 11px; font-weight: 600;">
          ${s.done}/${s.total} topics · <b>${s.pct}%</b>
        </span>
      </div>
      <div class="progress-track" style="margin: 0; height: 8px;">
        <span style="width: ${s.pct}%;"></span>
      </div>
    </div>
  `).join('');
}

function renderMistakeBreakdown(mistakeData) {
  if (!mistakeBreakdown) return;

  if (mistakeTotalBadge) {
    mistakeTotalBadge.textContent = mistakeData.totalMistakes > 0
      ? `${mistakeData.totalMistakes} Mistakes (${mistakeData.resolvedMistakes} Fixed)`
      : '0 Mistakes';
  }

  if (mistakeData.totalMistakes === 0) {
    mistakeBreakdown.innerHTML = `
      <div class="panel empty-state" style="padding: 18px; text-align: center; border: 1px dashed var(--sf-border);">
        No test mistakes logged yet. Upload a mock test paper and log errors to uncover diagnostic patterns.
      </div>
    `;
    return;
  }

  const activeCategories = mistakeData.categoriesList.filter(c => c.count > 0);

  mistakeBreakdown.innerHTML = (activeCategories.length ? activeCategories : mistakeData.categoriesList.slice(0, 4)).map(c => `
    <div class="profile-subject-row">
      <div class="profile-subject-info">
        <span style="font-weight: 750; color: var(--sf-navy); display: flex; align-items: center; gap: 7px;">
          <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${c.color};"></span>
          ${escapeHtml(c.name)}
        </span>
        <span class="muted" style="font-size: 11px;"><b>${c.count}</b> mistakes (${c.pct}%)</span>
      </div>
      <div class="progress-track" style="margin: 0; height: 7px; background: var(--sf-sand);">
        <span style="width: ${c.pct}%; background: ${c.color};"></span>
      </div>
    </div>
  `).join('');
}

function renderTaskPipeline(taskStats) {
  if (!taskPipeline) return;

  if (taskRateBadge) {
    taskRateBadge.textContent = `${taskStats.completionRate}% Velocity`;
  }

  if (taskStats.total === 0) {
    taskPipeline.innerHTML = `
      <div class="panel empty-state" style="padding: 18px; text-align: center; border: 1px dashed var(--sf-border);">
        No tasks created yet. Plan your high-leverage study tasks to track execution health.
      </div>
    `;
    return;
  }

  const donePct = Math.round((taskStats.completed / taskStats.total) * 100);
  const overduePct = Math.round((taskStats.overdue / taskStats.total) * 100);
  const openPct = Math.max(0, 100 - donePct - overduePct);

  taskPipeline.innerHTML = `
    <div class="pipeline-track">
      <div class="pipeline-seg done" style="width: ${donePct}%;" title="Completed: ${taskStats.completed} (${donePct}%)"></div>
      <div class="pipeline-seg open" style="width: ${openPct}%;" title="In Progress: ${taskStats.open} (${openPct}%)"></div>
      <div class="pipeline-seg overdue" style="width: ${overduePct}%;" title="Overdue: ${taskStats.overdue} (${overduePct}%)"></div>
    </div>
    <div class="pipeline-legend">
      <div class="legend-item"><span class="legend-dot" style="background:#3c8253"></span><span>Completed: <b>${taskStats.completed}</b> (${donePct}%)</span></div>
      <div class="legend-item"><span class="legend-dot" style="background:var(--sf-navy-soft)"></span><span>In Progress: <b>${taskStats.open}</b> (${openPct}%)</span></div>
      <div class="legend-item"><span class="legend-dot" style="background:var(--sf-coral)"></span><span>Overdue: <b>${taskStats.overdue}</b> (${overduePct}%)</span></div>
    </div>
    <div style="font-size: 11px; color: var(--sf-navy-soft); margin-top: 6px; line-height: 1.4;">
      ${taskStats.overdue === 0
        ? '✓ Excellent execution rhythm: zero overdue bottlenecks in your active backlog.'
        : `⚠ Attention needed: ${taskStats.overdue} overdue task${taskStats.overdue > 1 ? 's are' : ' is'} creating friction. Consider clearing or rescheduling immediately.`}
    </div>
  `;
}

function renderKpiCards({
  weeklyFocusFormatted,
  dailyAvgMins,
  peakDayName,
  peakDayMins,
  taskStats,
  streak,
  subjectStats,
  mistakeStats,
  skillsCount,
  subjectsCount
}) {
  if (!statsContainer) return;

  const totalActiveTracks = subjectsCount + skillsCount;

  statsContainer.innerHTML = [
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${weeklyFocusFormatted}</span>
        <span class="kpi-icon">⏱️</span>
      </div>
      <span class="kpi-lbl">Weekly Deep Focus</span>
      <span class="kpi-sub">${dailyAvgMins}m daily avg · Peak: ${peakDayName} (${peakDayMins}m)</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${taskStats.completionRate}%</span>
        <span class="kpi-icon">🎯</span>
      </div>
      <span class="kpi-lbl">Task Completion Velocity</span>
      <span class="kpi-sub">${taskStats.completed} of ${taskStats.total} tasks completed</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val" style="${taskStats.overdue > 0 ? 'color: var(--sf-coral);' : ''}">${taskStats.overdue}</span>
        <span class="kpi-icon">⏳</span>
      </div>
      <span class="kpi-lbl">Overdue Pressure</span>
      <span class="kpi-sub">${taskStats.overdue === 0 ? 'Clean queue · zero overdue deadlines' : 'Tasks requiring urgent attention'}</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${streak}d</span>
        <span class="kpi-icon">🔥</span>
      </div>
      <span class="kpi-lbl">Daily Active Streak</span>
      <span class="kpi-sub">${streak > 0 ? 'Consistent daily study rhythm' : 'Start your study session today'}</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${subjectStats.overallPct}%</span>
        <span class="kpi-icon">📚</span>
      </div>
      <span class="kpi-lbl">Syllabus Coverage</span>
      <span class="kpi-sub">${subjectStats.doneTopics} of ${subjectStats.totalTopics} topics mastered</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${mistakeStats.avgScore !== null ? `${mistakeStats.avgScore}%` : '—'}</span>
        <span class="kpi-icon">📝</span>
      </div>
      <span class="kpi-lbl">Mock Test Average</span>
      <span class="kpi-sub">${mistakeStats.totalTests > 0 ? `${mistakeStats.totalTests} tests · Best: ${mistakeStats.bestScore}%` : 'Upload mock papers to gauge score'}</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${mistakeStats.resolutionRate}%</span>
        <span class="kpi-icon">🔍</span>
      </div>
      <span class="kpi-lbl">Mistake Resolution Rate</span>
      <span class="kpi-sub">${mistakeStats.resolvedMistakes} of ${mistakeStats.totalMistakes} logged errors rectified</span>
    </div>
    `,
    `
    <div class="profile-stat-kpi">
      <div class="kpi-top">
        <span class="kpi-val">${totalActiveTracks}</span>
        <span class="kpi-icon">🚀</span>
      </div>
      <span class="kpi-lbl">Active Knowledge Tracks</span>
      <span class="kpi-sub">${subjectsCount} academic subjects · ${skillsCount} extra skills</span>
    </div>
    `
  ].join('');
}

function renderRecommendations({
  taskStats,
  focusData,
  subjectStats,
  mistakeStats
}) {
  if (!recommendationsGrid) return;

  // 1. Priority Recommendation
  let rec1 = {
    type: 'priority',
    tag: 'PRIORITY · IMMEDIATE IMPACT',
    title: 'Maintain Execution Rhythm',
    text: 'Your current study workflow is well-balanced. Keep timeboxing your daily tasks and preserve your morning focus hours.'
  };

  if (taskStats.overdue > 0) {
    rec1 = {
      type: 'priority',
      tag: 'PRIORITY · DEADLINE RESCUE',
      title: `Clear ${taskStats.overdue} Overdue Task${taskStats.overdue > 1 ? 's' : ''} First`,
      text: `You have ${taskStats.overdue} overdue task${taskStats.overdue > 1 ? 's' : ''} lingering in your queue. Context-switching while falling behind builds cognitive drag. Clear or reschedule your oldest deadline before tackling new subjects.`
    };
  } else if (taskStats.total === 0) {
    rec1 = {
      type: 'priority',
      tag: 'PRIORITY · PLANNING SPRINT',
      title: 'Break Upcoming Goals Into Bite-Sized Tasks',
      text: 'You have no open tasks queued up. Plan 3 high-impact, 30-minute tasks for today to give your study sessions a clear target.'
    };
  } else if (taskStats.completionRate < 60) {
    rec1 = {
      type: 'priority',
      tag: 'PRIORITY · FOCUS CALIBRATION',
      title: 'Narrow Your Daily Task Load',
      text: `Your completion rate is currently ${taskStats.completionRate}%. Limit your daily queue to your top 3 must-complete tasks. Finishing fewer items consistently builds stronger momentum than carrying over an unmanageable list.`
    };
  }

  // 2. Exam & Concept Recovery
  let rec2 = {
    type: 'concept',
    tag: 'DIAGNOSTICS · EXAM MASTERY',
    title: 'Upload Mock Test Papers to Diagnose Weak Spots',
    text: 'Testing is the highest-yield learning technique. Upload your handwritten mock test papers or PDFs in the Mock Tests tab to let StudyFlow isolate your weakest topics.'
  };

  if (mistakeStats.totalMistakes > 0) {
    const topCat = mistakeStats.topCategory;
    const weakTopic = mistakeStats.topWeakTopic;
    const catLabel = topCat && topCat.count > 0 ? `${topCat.name} errors (${topCat.pct}%)` : 'recurring mistakes';

    if (weakTopic) {
      rec2 = {
        type: 'concept',
        tag: 'DIAGNOSTICS · RECOVERY DRILL',
        title: `Drill Down on ${weakTopic}`,
        text: `Your mock test logs highlight ${weakTopic} as your primary weak area, predominantly from ${catLabel}. Review the foundational formulas and attempt 5 targeted problem sets today without consulting solutions.`
      };
    } else {
      rec2 = {
        type: 'concept',
        tag: 'DIAGNOSTICS · ACCURACY SPRINT',
        title: `Eliminate ${topCat?.name || 'Calculation'} Mistakes`,
        text: `${topCat?.name || 'Calculation'} errors account for ${topCat?.pct || 30}% of your dropped marks in mock tests. Before solving exam questions, write out intermediate steps explicitly to catch avoidable errors.`
      };
    }
  } else if (mistakeStats.totalTests > 0) {
    rec2 = {
      type: 'concept',
      tag: 'DIAGNOSTICS · LOG ERRORS',
      title: 'Log Specific Question Mistakes',
      text: 'You have uploaded mock tests! Open each test card to log the exact questions and topics where you lost marks so StudyFlow can pinpoint your weakest areas automatically.'
    };
  }

  // 3. Deep Work Rhythm
  let rec3 = {
    type: 'rhythm',
    tag: 'COGNITIVE PACE · DEEP WORK',
    title: 'Protect a 45-Minute Daily Deep Work Block',
    text: 'Short, uninterrupted Pomodoro sessions build retention more reliably than long, unfocused cramming blocks. Protect 45 minutes of distraction-free focus every day.'
  };

  if (focusData.totalWeeklyMinutes < 120) {
    rec3 = {
      type: 'rhythm',
      tag: 'COGNITIVE PACE · TIME RECOVERY',
      title: 'Schedule Two 30-Minute Focus Sprints',
      text: `You have logged ${focusData.totalWeeklyMinutes} minutes of focused study this week. Launch DeepTick Pomodoro today to lock in 60 minutes of deep study and rebuild your rhythm.`
    };
  } else if (focusData.totalWeeklyMinutes >= 420) {
    const hrs = (focusData.totalWeeklyMinutes / 60).toFixed(1);
    rec3 = {
      type: 'rhythm',
      tag: 'COGNITIVE PACE · SUSTAINABILITY',
      title: `Outstanding Focus Cadence (${hrs}h This Week)`,
      text: `You have surpassed 7 hours of deep study this week! Make sure to take full 15-minute restorative breaks away from screens to consolidate memory and avoid burnout.`
    };
  } else {
    rec3 = {
      type: 'rhythm',
      tag: 'COGNITIVE PACE · RHYTHM LOCK',
      title: `Anchor Your Daily Study Slot (${focusData.avgDailyMinutes}m/day)`,
      text: `Your daily average is ${focusData.avgDailyMinutes} minutes across the week. Standardizing your study window (e.g. 8:30 AM or 6:30 PM) will turn active willpower into effortless habit.`
    };
  }

  // 4. Syllabus Pacing
  let rec4 = {
    type: 'pacing',
    tag: 'SYLLABUS STRATEGY · BALANCED COVERAGE',
    title: 'Structure Your Subject Topic Checklists',
    text: 'Add your subjects and syllabus chapters to unlock topic-by-topic completion tracking and automated pacing alerts.'
  };

  if (subjectStats.list.length > 0) {
    const sortedSubjects = [...subjectStats.list].sort((a, b) => a.pct - b.pct);
    const trailing = sortedSubjects[0];

    if (trailing && trailing.pct < 100) {
      rec4 = {
        type: 'pacing',
        tag: 'SYLLABUS STRATEGY · BALANCED COVERAGE',
        title: `Advance ${trailing.name} (${trailing.pct}% Covered)`,
        text: `${trailing.name} is your least covered subject (${trailing.done}/${trailing.total} topics complete). Dedicate your next study session specifically to finishing its next topic to keep your exam preparation balanced.`
      };
    } else {
      rec4 = {
        type: 'pacing',
        tag: 'SYLLABUS STRATEGY · REVISION MODE',
        title: 'Syllabus Fully Mastered — Begin Revision Cycles',
        text: 'All your subject topics are 100% completed! Transition from initial topic reading into spaced repetition, flashcard drills, and timed full-length mock papers.'
      };
    }
  }

  recommendationsGrid.innerHTML = [rec1, rec2, rec3, rec4].map(r => `
    <article class="profile-rec-card ${r.type}">
      <span class="rec-tag">${r.tag}</span>
      <h4 class="rec-title">${escapeHtml(r.title)}</h4>
      <p class="rec-text">${escapeHtml(r.text)}</p>
    </article>
  `).join('');
}

async function loadProfile() {
  let user = { name: 'Student Scholar', email: 'Active Workspace (Local Storage)' };
  let serverStats = null;

  try {
    const account = await getJson('/me');
    if (account && account.user) user = account.user;
  } catch {
    try {
      const stored = localStorage.getItem('studyflow_user');
      if (stored) user = JSON.parse(stored);
    } catch {}
  }

  try {
    serverStats = await getJson('/statistics');
  } catch {
    // Graceful fallback: purely computed from local db
  }

  if (profileName) profileName.textContent = user.name || 'Student Scholar';
  if (profileEmail) profileEmail.textContent = user.email || 'Active Workspace';
  if (profileAvatar) profileAvatar.textContent = initials(user.name);
  if (sidebarName) sidebarName.textContent = user.name || 'Student Scholar';
  if (sidebarEmail) sidebarEmail.textContent = user.email || 'Active Workspace';

  const localDb = getLocalDb(user.id);
  const pomodoroSessions = getPomodoroSessions();

  const taskStats = computeTaskMetrics(localDb.tasks, serverStats?.tasks);
  const focusData = computeWeeklyFocus(localDb, pomodoroSessions);
  const subjectStats = computeSubjectProgress(localDb.subjects);
  const mistakeStats = computeMockTestAndMistakeAnalytics(localDb.mockTests, localDb.mistakes);

  let streak = serverStats?.streak ?? 0;
  if (!streak) {
    try {
      const streakData = JSON.parse(localStorage.getItem('deeptick_streak_v1') || '{}');
      streak = streakData.currentStreak || 0;
    } catch {}
  }

  const { healthScore, scholarTier } = computeHealthAndTier(taskStats, focusData.totalWeeklyMinutes, streak, mistakeStats);

  if (badgesCluster) {
    badgesCluster.innerHTML = `
      <div class="profile-badge-pill badge-streak" title="Continuous daily study consistency">
        <span>🔥</span><span>${streak}d Streak</span>
      </div>
      <div class="profile-badge-pill badge-level" title="Calculated from your comprehensive performance metrics">
        <span>🎓</span><span>${scholarTier}</span>
      </div>
      <div class="profile-badge-pill badge-health" title="Composite study health out of 100 based on velocity, focus, and error resolution">
        <span>⚡</span><span>Health Score: ${healthScore}/100</span>
      </div>
    `;
  }

  const weeklyFocusFormatted = focusData.totalWeeklyMinutes >= 60
    ? `${(focusData.totalWeeklyMinutes / 60).toFixed(1)}h`
    : `${focusData.totalWeeklyMinutes}m`;

  renderKpiCards({
    weeklyFocusFormatted,
    dailyAvgMins: focusData.avgDailyMinutes,
    peakDayName: focusData.peakDay.dayName,
    peakDayMins: focusData.peakDay.minutes,
    taskStats,
    streak,
    subjectStats,
    mistakeStats,
    skillsCount: (localDb.skills || []).length,
    subjectsCount: (localDb.subjects || []).length
  });

  renderWeeklyChart(focusData);
  renderSubjectProgress(subjectStats);
  renderMistakeBreakdown(mistakeStats);
  renderTaskPipeline(taskStats);

  renderRecommendations({
    taskStats,
    focusData,
    subjectStats,
    mistakeStats
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    const oldText = refreshBtn.textContent;
    refreshBtn.textContent = 'Refreshing…';
    await loadProfile();
    refreshBtn.textContent = '✓ Updated';
    setTimeout(() => {
      refreshBtn.textContent = oldText;
      refreshBtn.disabled = false;
    }, 1200);
  });
}

if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/auth/sign-out`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Sign out failed.');
      window.location.reload();
    } catch (error) {
      signOutBtn.disabled = false;
      alert(error.message);
    }
  });
}

window.addEventListener('studyflow:authenticated', loadProfile);

document.addEventListener('click', event => {
  if (event.target.closest('[data-view="profile"]') || event.target.closest('[data-go="profile"]')) {
    loadProfile();
  }
});

// Initial load
loadProfile();
