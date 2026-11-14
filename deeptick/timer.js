/* ==========================================================================
   DeepTick Pomodoro - High-Precision Timestamp Timer Engine
   ========================================================================== */

import { state } from './state.js';
import { taskManager } from './tasks.js';
import { soundManager } from './audio.js';
import { notifier } from './notifications.js';

function syncCompletedSessionToStudyFlow(durationSeconds) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const mins = Math.max(1, Math.round(durationSeconds / 60));

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
        try {
          const raw = localStorage.getItem(k);
          const sfDb = raw ? JSON.parse(raw) : { focus: { minutes: {}, sessions: 0 }, tasks: [] };
          sfDb.focus = sfDb.focus || { minutes: {}, sessions: 0 };
          sfDb.focus.minutes = sfDb.focus.minutes || {};
          sfDb.focus.minutes[today] = (sfDb.focus.minutes[today] || 0) + mins;
          sfDb.focus.sessions = (sfDb.focus.sessions || 0) + 1;
          localStorage.setItem(k, JSON.stringify(sfDb));
        } catch {}
      }
    }

    const focusTodayEl = document.getElementById('focus-today');
    if (focusTodayEl) {
      const cur = parseInt(focusTodayEl.textContent, 10) || 0;
      focusTodayEl.textContent = cur + mins;
    }

    window.dispatchEvent(new CustomEvent('studyflow:focus-recorded', {
      detail: { minutes: mins, date: today }
    }));
  } catch (e) {
    console.warn('Failed to sync session with StudyFlow:', e);
  }
}

async function postSessionToServer(mode, durationSeconds, taskId) {
  try {
    const apiBase = window.STUDYFLOW_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');
    await fetch(`${apiBase}/study-sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        durationSeconds,
        taskId: taskId || null,
        startedAt: new Date(Date.now() - durationSeconds * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        completed: true
      })
    });
  } catch {}
}

class TimerEngine {
  constructor() {
    this.intervalId = null;
    this.init();
  }

  init() {
    if (state.timerState.status === 'running' && state.timerState.endTimestamp) {
      const now = Date.now();
      if (now >= state.timerState.endTimestamp) {
        this.onTimerCompleted();
      } else {
        const remaining = Math.round((state.timerState.endTimestamp - now) / 1000);
        state.updateTimerState({ remainingSeconds: remaining });
        this.startTickInterval();
      }
    } else if (state.timerState.status === 'idle') {
      this.syncModeDuration(state.timerState.mode);
    }
  }

  getModeDuration(mode) {
    const { settings } = state;
    if (mode === 'short_break') return (settings.shortBreakDuration || 5) * 60;
    if (mode === 'long_break') return (settings.longBreakDuration || 15) * 60;
    return (settings.pomodoroDuration || 30) * 60;
  }

  syncModeDuration(mode) {
    const baseSeconds = this.getModeDuration(mode);
    const target = baseSeconds + (mode === 'pomodoro' ? (state.timerState.tempAdjustmentSeconds || 0) : 0);
    state.updateTimerState({
      mode,
      targetSeconds: Math.max(30, target),
      remainingSeconds: Math.max(30, target),
      status: 'idle',
      startTimestamp: null,
      endTimestamp: null,
      pauseTimestamp: null
    });
  }

  setMode(newMode) {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    state.updateTimerState({ tempAdjustmentSeconds: 0 });
    this.syncModeDuration(newMode);
  }

  start() {
    soundManager.initContext();
    const now = Date.now();
    const remaining = state.timerState.remainingSeconds > 0 ? state.timerState.remainingSeconds : state.timerState.targetSeconds;
    const endTimestamp = now + remaining * 1000;

    state.updateTimerState({
      status: 'running',
      startTimestamp: state.timerState.startTimestamp || now,
      endTimestamp,
      pauseTimestamp: null,
      remainingSeconds: remaining
    });

    this.startTickInterval();
    state.emit('timer:started', state.timerState);
  }

  pause() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const now = Date.now();
    const remaining = state.timerState.endTimestamp
      ? Math.max(0, Math.round((state.timerState.endTimestamp - now) / 1000))
      : state.timerState.remainingSeconds;

    state.updateTimerState({
      status: 'paused',
      pauseTimestamp: now,
      remainingSeconds: remaining
    });

    state.emit('timer:paused', state.timerState);
  }

  toggle() {
    if (state.timerState.status === 'running') {
      this.pause();
    } else {
      this.start();
    }
  }

  reset(force = false) {
    const elapsed = state.timerState.targetSeconds - state.timerState.remainingSeconds;
    if (!force && state.timerState.status !== 'idle' && elapsed > 30 && state.settings.confirmDelete) {
      const confirmReset = window.confirm('Are you sure you want to reset the current active timer? Progress on this session will not be counted.');
      if (!confirmReset) return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    state.updateTimerState({ tempAdjustmentSeconds: 0 });
    this.syncModeDuration(state.timerState.mode);
    state.emit('timer:reset', state.timerState);
  }

  skip() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const elapsed = state.timerState.targetSeconds - state.timerState.remainingSeconds;
    if (elapsed > 10) {
      const activeTask = taskManager.getActiveTask();
      state.addSession({
        id: 'sess_' + Date.now(),
        taskId: activeTask ? activeTask.id : null,
        taskTitle: activeTask ? activeTask.title : 'Unassigned',
        type: state.timerState.mode,
        plannedDurationSeconds: state.timerState.targetSeconds,
        actualDurationSeconds: elapsed,
        startedAt: new Date(state.timerState.startTimestamp || (Date.now() - elapsed * 1000)).toISOString(),
        endedAt: new Date().toISOString(),
        completed: false
      });
    }

    this.advanceCycle(false);
  }

  adjustTime(deltaSeconds) {
    const minSeconds = 30;
    let newRemaining = state.timerState.remainingSeconds + deltaSeconds;
    let newTarget = state.timerState.targetSeconds + deltaSeconds;

    if (newRemaining < minSeconds) newRemaining = minSeconds;
    if (newTarget < minSeconds) newTarget = minSeconds;

    const newTempAdj = (state.timerState.tempAdjustmentSeconds || 0) + deltaSeconds;
    let newEndTimestamp = state.timerState.endTimestamp;

    if (state.timerState.status === 'running') {
      newEndTimestamp = Date.now() + newRemaining * 1000;
    }

    state.updateTimerState({
      remainingSeconds: newRemaining,
      targetSeconds: newTarget,
      tempAdjustmentSeconds: newTempAdj,
      endTimestamp: newEndTimestamp
    });

    state.emit('timer:adjusted', { deltaSeconds, remaining: newRemaining });
  }

  startTickInterval() {
    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(() => {
      const now = Date.now();
      const remaining = Math.round((state.timerState.endTimestamp - now) / 1000);

      if (remaining <= 0) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        state.updateTimerState({ remainingSeconds: 0 });
        this.onTimerCompleted();
      } else {
        state.updateTimerState({ remainingSeconds: remaining });
      }
    }, 500);
  }

  onTimerCompleted() {
    const { mode, targetSeconds, activeTaskId } = state.timerState;
    const { settings } = state;
    const activeTask = taskManager.getActiveTask();

    // 1. Play sound
    if (settings.soundEnabled) {
      const soundType = mode === 'pomodoro' ? settings.completionSound : settings.breakSound;
      soundManager.play(soundType, settings.volume, settings.repeatSound ? settings.repeatCount : 1);
    }

    // 2. Record Session
    const sessionRecord = {
      id: 'sess_' + Date.now(),
      taskId: activeTask ? activeTask.id : null,
      taskTitle: activeTask ? activeTask.title : 'General Focus',
      type: mode,
      plannedDurationSeconds: targetSeconds,
      actualDurationSeconds: targetSeconds,
      startedAt: new Date(state.timerState.startTimestamp || (Date.now() - targetSeconds * 1000)).toISOString(),
      endedAt: new Date().toISOString(),
      completed: true
    };
    state.addSession(sessionRecord);

    // 3. If Pomodoro mode, sync with StudyFlow and update task
    if (mode === 'pomodoro') {
      if (activeTaskId) {
        taskManager.recordPomodoroSession(activeTaskId, targetSeconds);
      }

      // Sync focus minutes to StudyFlow local db & server
      syncCompletedSessionToStudyFlow(targetSeconds);
      postSessionToServer('pomodoro', targetSeconds, activeTaskId);

      const updatedTask = activeTaskId ? taskManager.getTask(activeTaskId) : null;
      let taskMsg = 'Great job staying focused!';
      if (updatedTask) {
        taskMsg = `"${updatedTask.title}" (${updatedTask.completedPomodoros || 1}/${updatedTask.estimatedPomodoros} Pomodoros)`;
      }

      notifier.notify('🎉 Pomodoro Complete!', `${taskMsg} Take a well-deserved break.`, {
        type: 'success',
        icon: '🎯'
      });

      const daily = state.getDailyStats();
      if (daily.pomodorosCompleted >= settings.dailyPomodoroGoal) {
        state.emit('celebration:goal_reached', daily);
      }
    } else {
      notifier.notify('☕ Break Completed!', 'Ready to dive into your next focus session?', {
        type: 'break',
        icon: '⚡'
      });
    }

    // 4. Advance Cycle
    this.advanceCycle(true);
  }

  advanceCycle(completedNaturally = true) {
    const { mode, cycleCount } = state.timerState;
    const { settings } = state;
    const interval = settings.longBreakInterval || 4;

    let nextMode = 'pomodoro';
    let nextCycle = cycleCount;
    let autoStart = false;

    if (mode === 'pomodoro') {
      if (cycleCount >= interval) {
        nextMode = 'long_break';
        nextCycle = interval;
      } else {
        nextMode = 'short_break';
        nextCycle = cycleCount + (completedNaturally ? 1 : 0);
      }
      autoStart = settings.autoStartBreaks;
    } else {
      nextMode = 'pomodoro';
      nextCycle = (mode === 'long_break') ? 1 : cycleCount;
      autoStart = settings.autoStartPomodoros;
    }

    state.updateTimerState({
      cycleCount: nextCycle,
      tempAdjustmentSeconds: 0
    });

    this.syncModeDuration(nextMode);

    if (autoStart) {
      setTimeout(() => this.start(), 800);
    }
  }
}

export const timer = new TimerEngine();
