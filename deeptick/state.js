/* ==========================================================================
   DeepTick Pomodoro - Central State Store & Persistence
   ========================================================================== */

const STORAGE_KEYS = {
  SETTINGS: 'deeptick_settings_v1',
  TASKS: 'deeptick_tasks_v2',
  SESSIONS: 'deeptick_sessions_v1',
  TIMER_STATE: 'deeptick_timer_state_v1',
  STREAK: 'deeptick_streak_v1'
};

function getLocalDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEFAULT_SETTINGS = {
  pomodoroDuration: 30,       // minutes
  shortBreakDuration: 5,      // minutes
  longBreakDuration: 15,      // minutes
  longBreakInterval: 4,       // pomodoros before long break
  autoStartBreaks: false,
  autoStartPomodoros: false,
  dailyPomodoroGoal: 4,
  dailyFocusGoalHours: 2,
  primaryGoalType: 'both',    // 'pomodoros' | 'time' | 'both'
  soundEnabled: true,
  completionSound: 'bell',     // 'bell', 'digital', 'marimba', 'gong', 'chime', 'kitchen'
  breakSound: 'marimba',
  volume: 75,                 // 0 - 100
  repeatSound: false,
  repeatCount: 2,
  theme: 'navy',
  showCompletedTasks: true,
  autoArchiveCompleted: false,
  confirmDelete: true
};

const DEFAULT_TASKS = [];

class StateStore {
  constructor() {
    this.events = {};
    this.settings = this.load(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const storedTasks = this.load(STORAGE_KEYS.TASKS, DEFAULT_TASKS);
    this.tasks = (Array.isArray(storedTasks) ? storedTasks : []).filter(t => !t.id?.startsWith('task-sample-'));
    this.sessions = this.load(STORAGE_KEYS.SESSIONS, []);
    this.timerState = this.load(STORAGE_KEYS.TIMER_STATE, null);

    // Initialize streak from stored activeDates and historical activity
    const storedStreak = this.load(STORAGE_KEYS.STREAK, null);
    const activeDates = new Set(storedStreak?.activeDates || []);

    for (const s of this.sessions) {
      if (s.completed && s.startedAt) {
        activeDates.add(s.startedAt.slice(0, 10));
      }
    }

    try {
      const sfDb = (typeof window !== 'undefined' && typeof window.getStudyFlowDb === 'function')
        ? window.getStudyFlowDb()
        : null;
      if (sfDb) {
        if (sfDb.focus?.minutes) {
          for (const [d, mins] of Object.entries(sfDb.focus.minutes)) {
            if (Number(mins) > 0) activeDates.add(String(d).slice(0, 10));
          }
        }
        if (Array.isArray(sfDb.tasks)) {
          for (const t of sfDb.tasks) {
            if (t.done || t.completed) {
              const d = t.completedAt || t.due || t.date;
              if (d) activeDates.add(String(d).slice(0, 10));
            }
          }
        }
        if (Array.isArray(sfDb.mockTests)) {
          for (const t of sfDb.mockTests) {
            const d = t.date || t.testedAt || t.createdAt;
            if (d) activeDates.add(String(d).slice(0, 10));
          }
        }
      }
    } catch {}

    const datesArray = Array.from(activeDates);
    const currentStreak = this.calculateStreak(datesArray);

    this.streak = {
      currentStreak,
      lastActiveDate: storedStreak?.lastActiveDate || (datesArray.length ? [...datesArray].sort().reverse()[0] : null),
      activeDates: datesArray
    };
    this.save(STORAGE_KEYS.STREAK, this.streak);

    if (typeof window !== 'undefined') {
      window.addEventListener('studyflow:activity-logged', (e) => {
        const d = e.detail?.date || getLocalDateStr();
        this.recordActiveStudyDate(d);
      });
      window.addEventListener('studyflow:focus-recorded', (e) => {
        const d = e.detail?.date || getLocalDateStr();
        this.recordActiveStudyDate(d);
      });
    }

    // Initialize timer state if not present
    if (!this.timerState) {
      this.timerState = {
        mode: 'pomodoro',
        status: 'idle', // 'idle' | 'running' | 'paused'
        targetSeconds: this.settings.pomodoroDuration * 60,
        remainingSeconds: this.settings.pomodoroDuration * 60,
        startTimestamp: null,
        endTimestamp: null,
        pauseTimestamp: null,
        tempAdjustmentSeconds: 0,
        cycleCount: 1,
        activeTaskId: this.tasks.length > 0 ? this.tasks[0].id : null
      };
    }
  }

  load(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.warn(`Failed to load ${key} from storage:`, e);
      return fallback;
    }
  }

  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`Failed to save ${key} to storage:`, e);
    }
  }

  // Event Pub/Sub
  on(event, handler) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(handler);
  }

  off(event, handler) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(h => h !== handler);
  }

  emit(event, payload) {
    if (this.events[event]) {
      this.events[event].forEach(handler => {
        try {
          handler(payload);
        } catch (e) {
          console.error(`Error in event handler for ${event}:`, e);
        }
      });
    }
  }

  // State Updates
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.save(STORAGE_KEYS.SETTINGS, this.settings);
    this.emit('settings:updated', this.settings);
  }

  updateTasks(tasks) {
    this.tasks = [...tasks];
    this.save(STORAGE_KEYS.TASKS, this.tasks);
    this.emit('tasks:updated', this.tasks);
  }

  updateTimerState(newState) {
    this.timerState = { ...this.timerState, ...newState };
    this.save(STORAGE_KEYS.TIMER_STATE, this.timerState);
    this.emit('timer:updated', this.timerState);
  }

  calculateStreak(activeDates) {
    const dates = new Set(Array.isArray(activeDates) ? activeDates : []);
    const today = new Date();
    const todayStr = getLocalDateStr(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterday);

    let streak = 0;
    let cursor = null;

    if (dates.has(todayStr)) {
      cursor = new Date(today);
    } else if (dates.has(yesterdayStr)) {
      cursor = new Date(yesterday);
    }

    if (cursor) {
      while (dates.has(getLocalDateStr(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }
    return streak;
  }

  recordActiveStudyDate(dateStr) {
    const d = dateStr ? String(dateStr).slice(0, 10) : getLocalDateStr();
    const dates = new Set(this.streak.activeDates || []);
    dates.add(d);
    this.streak.activeDates = Array.from(dates);
    this.streak.lastActiveDate = d;
    this.streak.currentStreak = this.calculateStreak(this.streak.activeDates);
    this.save(STORAGE_KEYS.STREAK, this.streak);
    this.emit('streak:updated', this.streak);

    const streakEl = document.getElementById('header-streak-count');
    if (streakEl) streakEl.textContent = `${this.streak.currentStreak}d Streak`;
    const streakValEl = document.getElementById('analytics-streak-val');
    if (streakValEl) streakValEl.textContent = `${this.streak.currentStreak}d`;
  }

  addSession(session) {
    this.sessions.unshift(session);
    // Keep up to 1000 historical sessions
    if (this.sessions.length > 1000) this.sessions.pop();
    this.save(STORAGE_KEYS.SESSIONS, this.sessions);
    if (session.completed) {
      const sessionDate = session.startedAt ? session.startedAt.slice(0, 10) : getLocalDateStr();
      this.recordActiveStudyDate(sessionDate);
    }
    this.emit('sessions:updated', this.sessions);
  }

  updateStreak() {
    this.streak.currentStreak = this.calculateStreak(this.streak.activeDates);
    this.save(STORAGE_KEYS.STREAK, this.streak);
    this.emit('streak:updated', this.streak);
  }

  getDailyStats() {
    const today = new Date().toISOString().slice(0, 10);
    const todaySessions = this.sessions.filter(s => s.startedAt.startsWith(today));

    const pomodorosCompleted = todaySessions.filter(s => s.type === 'pomodoro' && s.completed).length;
    const focusSeconds = todaySessions
      .filter(s => s.type === 'pomodoro')
      .reduce((acc, s) => acc + (s.actualDurationSeconds || 0), 0);

    return {
      date: today,
      pomodorosCompleted,
      focusSeconds,
      focusMinutes: Math.round(focusSeconds / 60),
      focusHours: (focusSeconds / 3600).toFixed(1)
    };
  }
}

export const state = new StateStore();
