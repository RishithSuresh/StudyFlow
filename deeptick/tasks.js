/* ==========================================================================
   DeepTick Pomodoro - Task Management Engine & StudyFlow Synchronizer
   ========================================================================== */

import { state } from './state.js';

class TaskManager {
  constructor() {
    this.activeFilter = 'all'; // 'all' | 'active' | 'completed'
  }

  getTasks() {
    return state.tasks;
  }

  getFilteredTasks() {
    const tasks = state.tasks;
    if (this.activeFilter === 'active') {
      return tasks.filter(t => !t.isCompleted);
    }
    if (this.activeFilter === 'completed') {
      return tasks.filter(t => t.isCompleted);
    }
    return tasks;
  }

  getTask(id) {
    return state.tasks.find(t => t.id === id) || null;
  }

  getActiveTask() {
    const activeId = state.timerState.activeTaskId;
    return activeId ? this.getTask(activeId) : null;
  }

  setActiveTask(id) {
    state.updateTimerState({ activeTaskId: id });
  }

  syncFromStudyFlow() {
    try {
      let sfDb = null;
      let targetKey = null;

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.tasks)) {
                sfDb = parsed;
                targetKey = k;
                break;
              }
            } catch {}
          }
        }
      }

      if (!sfDb || !Array.isArray(sfDb.tasks) || sfDb.tasks.length === 0) {
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const pomoDuration = state.settings.pomodoroDuration || 30;
      const existingMap = new Map(state.tasks.map(t => [t.id, t]));

      const syncedTasks = sfDb.tasks.map(t => {
        const existing = existingMap.get(t.id);
        const isToday = t.due === today || t.scope === 'daily';
        return {
          id: t.id,
          title: t.title || 'Untitled Task',
          description: t.note || (t.subject ? `Subject: ${t.subject}` : ''),
          priority: isToday ? 'high' : 'medium',
          estimatedPomodoros: existing?.estimatedPomodoros || 2,
          estimatedMinutes: (existing?.estimatedPomodoros || 2) * pomoDuration,
          completedPomodoros: existing?.completedPomodoros || 0,
          actualFocusedSeconds: existing?.actualFocusedSeconds || 0,
          isCompleted: Boolean(t.done),
          createdAt: existing?.createdAt || new Date().toISOString(),
          completedAt: t.done ? (existing?.completedAt || new Date().toISOString()) : null,
          source: 'studyflow'
        };
      });

      // Filter out old sample mock tasks if user has real StudyFlow tasks
      const sfIds = new Set(sfDb.tasks.map(t => t.id));
      const focusOnly = state.tasks.filter(t => !sfIds.has(t.id) && !t.id.startsWith('task-sample-'));

      state.updateTasks([...syncedTasks, ...focusOnly]);

      const activeTask = this.getActiveTask();
      if (!activeTask || activeTask.isCompleted) {
        const nextActive = syncedTasks.find(t => !t.isCompleted) || focusOnly.find(t => !t.isCompleted);
        if (nextActive) this.setActiveTask(nextActive.id);
      }
    } catch (e) {
      console.warn('Failed to sync tasks from StudyFlow:', e);
    }
  }

  createTask({ title, description = '', priority = 'medium', estimatedPomodoros = 1, estimatedMinutes = null }) {
    const pomodoroDuration = state.settings.pomodoroDuration || 30;

    let pomos = parseInt(estimatedPomodoros, 10);
    let mins = estimatedMinutes !== null ? parseInt(estimatedMinutes, 10) : pomos * pomodoroDuration;

    if (isNaN(pomos) || pomos < 1) pomos = 1;
    if (isNaN(mins) || mins < 1) mins = pomos * pomodoroDuration;

    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newTask = {
      id: taskId,
      title: title.trim() || 'Untitled Task',
      description: description.trim(),
      priority,
      estimatedPomodoros: pomos,
      estimatedMinutes: mins,
      completedPomodoros: 0,
      actualFocusedSeconds: 0,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    };

    const updatedTasks = [newTask, ...state.tasks];
    state.updateTasks(updatedTasks);

    if (!state.timerState.activeTaskId) {
      this.setActiveTask(newTask.id);
    }

    // Sync to StudyFlow's tasks
    this.createTaskInStudyFlow({
      id: newTask.id,
      title: newTask.title,
      note: newTask.description,
      type: 'Study',
      scope: 'daily',
      due: new Date().toISOString().slice(0, 10),
      done: false
    });

    return newTask;
  }

  createTaskInStudyFlow(task) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tasks)) {
              parsed.tasks.push(task);
              localStorage.setItem(k, JSON.stringify(parsed));
              window.dispatchEvent(new CustomEvent('studyflow:tasks-updated'));
            }
          }
        }
      }
    } catch {}
  }

  updateTask(id, updates) {
    const pomodoroDuration = state.settings.pomodoroDuration || 30;
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        const modified = { ...t, ...updates };

        if (updates.estimatedPomodoros !== undefined && updates.estimatedMinutes === undefined) {
          modified.estimatedMinutes = modified.estimatedPomodoros * pomodoroDuration;
        } else if (updates.estimatedMinutes !== undefined && updates.estimatedPomodoros === undefined) {
          modified.estimatedPomodoros = Math.max(1, Math.round(modified.estimatedMinutes / pomodoroDuration));
        }

        return modified;
      }
      return t;
    });

    state.updateTasks(updatedTasks);

    // Update title/note in StudyFlow if present
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tasks)) {
              const target = parsed.tasks.find(x => x.id === id);
              if (target) {
                if (updates.title) target.title = updates.title;
                if (updates.description !== undefined) target.note = updates.description;
                localStorage.setItem(k, JSON.stringify(parsed));
              }
            }
          }
        }
      }
    } catch {}
  }

  toggleComplete(id) {
    let nowDone = false;
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        const isCompleted = !t.isCompleted;
        nowDone = isCompleted;
        return {
          ...t,
          isCompleted,
          completedAt: isCompleted ? new Date().toISOString() : null
        };
      }
      return t;
    });

    state.updateTasks(updatedTasks);
    this.syncTaskCompletionToStudyFlow(id, nowDone);
  }

  syncTaskCompletionToStudyFlow(id, isDone) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tasks)) {
              const target = parsed.tasks.find(t => t.id === id);
              if (target) {
                target.done = isDone;
                localStorage.setItem(k, JSON.stringify(parsed));
                window.dispatchEvent(new CustomEvent('studyflow:tasks-updated'));
              }
            }
          }
        }
      }
    } catch {}
  }

  addPomodoroToTask(id, count = 1) {
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        const pomodoroDuration = state.settings.pomodoroDuration || 30;
        const newEstimated = t.estimatedPomodoros + count;
        return {
          ...t,
          estimatedPomodoros: newEstimated,
          estimatedMinutes: newEstimated * pomodoroDuration
        };
      }
      return t;
    });

    state.updateTasks(updatedTasks);
  }

  recordPomodoroSession(id, actualDurationSeconds) {
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        return {
          ...t,
          completedPomodoros: (t.completedPomodoros || 0) + 1,
          actualFocusedSeconds: (t.actualFocusedSeconds || 0) + actualDurationSeconds
        };
      }
      return t;
    });

    state.updateTasks(updatedTasks);
  }

  deleteTask(id) {
    const updatedTasks = state.tasks.filter(t => t.id !== id);
    state.updateTasks(updatedTasks);

    if (state.timerState.activeTaskId === id) {
      const nextActive = updatedTasks.length > 0 ? updatedTasks[0].id : null;
      this.setActiveTask(nextActive);
    }
  }

  clearFinishedTasks() {
    const finishedCount = state.tasks.filter(t => t.isCompleted).length;
    if (finishedCount === 0) return 0;

    const remainingTasks = state.tasks.filter(t => !t.isCompleted);
    state.updateTasks(remainingTasks);

    const activeTask = this.getActiveTask();
    if (activeTask && activeTask.isCompleted) {
      const nextActive = remainingTasks.length > 0 ? remainingTasks[0].id : null;
      this.setActiveTask(nextActive);
    }
    return finishedCount;
  }

  clearAllTasks() {
    const totalCount = state.tasks.length;
    if (totalCount === 0) return 0;

    state.updateTasks([]);
    this.setActiveTask(null);
    return totalCount;
  }

  calculateTotalRemainingPomodoros() {
    return state.tasks
      .filter(t => !t.isCompleted)
      .reduce((acc, t) => {
        const remaining = Math.max(0, t.estimatedPomodoros - (t.completedPomodoros || 0));
        return acc + remaining;
      }, 0);
  }

  calculateTotalPlannedPomodoros() {
    return state.tasks.reduce((acc, t) => acc + t.estimatedPomodoros, 0);
  }

  calculateTotalCompletedPomodoros() {
    return state.tasks.reduce((acc, t) => acc + (t.completedPomodoros || 0), 0);
  }
}

export const taskManager = new TaskManager();
