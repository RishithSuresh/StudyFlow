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

  getStudyFlowTasksFromStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tasks)) {
              return parsed.tasks;
            }
          }
        }
      }
    } catch {}
    return [];
  }

  syncFromStudyFlow() {
    try {
      const sfTasks = window.getStudyFlowTasks ? window.getStudyFlowTasks() : this.getStudyFlowTasksFromStorage();
      if (!Array.isArray(sfTasks) || sfTasks.length === 0) return;

      const sfMap = new Map(sfTasks.map(t => [t.id, t]));
      let changed = false;

      const updated = state.tasks.map(task => {
        const sfTask = sfMap.get(task.id);
        if (sfTask && Boolean(sfTask.done) !== Boolean(task.isCompleted)) {
          changed = true;
          return {
            ...task,
            isCompleted: Boolean(sfTask.done),
            completedAt: sfTask.done ? (task.completedAt || new Date().toISOString()) : null
          };
        }
        return task;
      });

      if (changed) {
        state.updateTasks(updated);
      }
    } catch (e) {
      console.warn('Failed to sync tasks from StudyFlow:', e);
    }
  }

  getAvailableStudyFlowTasks(searchQuery = '', scopeFilter = 'all') {
    const sfTasks = window.getStudyFlowTasks ? window.getStudyFlowTasks() : this.getStudyFlowTasksFromStorage();
    if (!Array.isArray(sfTasks)) return [];

    const inFocusIds = new Set(state.tasks.map(t => t.id));
    const today = new Date().toISOString().slice(0, 10);

    return sfTasks.filter(t => {
      if (t.done) return false;
      const isDaily = t.scope === 'daily' || t.due === today;
      if (scopeFilter === 'daily' && !isDaily) return false;
      if (scopeFilter === 'overall' && isDaily) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (t.title || '').toLowerCase().includes(q);
        const matchSubj = (t.subject || '').toLowerCase().includes(q);
        const matchNote = (t.note || '').toLowerCase().includes(q);
        if (!matchTitle && !matchSubj && !matchNote) return false;
      }
      return true;
    }).map(t => ({
      ...t,
      isInFocus: inFocusIds.has(t.id)
    }));
  }

  addExistingTaskToFocus(sfTaskId) {
    const sfTasks = window.getStudyFlowTasks ? window.getStudyFlowTasks() : this.getStudyFlowTasksFromStorage();
    const sfTask = sfTasks.find(t => t.id === sfTaskId);
    if (!sfTask) return null;

    const existing = state.tasks.find(t => t.id === sfTaskId);
    if (existing) {
      this.setActiveTask(existing.id);
      return existing;
    }

    const pomoDuration = state.settings.pomodoroDuration || 30;
    const newTask = {
      id: sfTask.id,
      title: sfTask.title || 'Untitled Task',
      description: sfTask.note || (sfTask.subject ? `Subject: ${sfTask.subject}` : ''),
      priority: sfTask.scope === 'daily' ? 'high' : 'medium',
      estimatedPomodoros: 1,
      estimatedMinutes: pomoDuration,
      completedPomodoros: 0,
      actualFocusedSeconds: 0,
      isCompleted: Boolean(sfTask.done),
      createdAt: new Date().toISOString(),
      completedAt: null,
      source: 'studyflow'
    };

    const updatedTasks = [newTask, ...state.tasks];
    state.updateTasks(updatedTasks);
    this.setActiveTask(newTask.id);
    return newTask;
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
      completedAt: null,
      source: 'focus'
    };

    const updatedTasks = [newTask, ...state.tasks];
    state.updateTasks(updatedTasks);

    if (!state.timerState.activeTaskId) {
      this.setActiveTask(newTask.id);
    }

    // Sync to StudyFlow workspace tasks
    const sfTaskObj = {
      id: newTask.id,
      title: newTask.title,
      note: newTask.description,
      type: 'Study',
      scope: 'daily',
      due: new Date().toISOString().slice(0, 10),
      done: false
    };

    if (window.addStudyFlowTask) {
      window.addStudyFlowTask(sfTaskObj);
    } else {
      this.createTaskInStudyFlow(sfTaskObj);
    }

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

    if (window.updateStudyFlowTask) {
      window.updateStudyFlowTask(id, {
        ...(updates.title ? { title: updates.title } : {}),
        ...(updates.description !== undefined ? { note: updates.description } : {})
      });
    } else {
      this.updateTaskInStudyFlow(id, updates);
    }
  }

  updateTaskInStudyFlow(id, updates) {
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

    if (window.updateStudyFlowTask) {
      window.updateStudyFlowTask(id, { done: nowDone });
    } else {
      this.syncTaskCompletionToStudyFlow(id, nowDone);
    }
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

  removeTaskFromFocus(id) {
    const updatedTasks = state.tasks.filter(t => t.id !== id);
    state.updateTasks(updatedTasks);

    if (state.timerState.activeTaskId === id) {
      const nextActive = updatedTasks.length > 0 ? updatedTasks[0].id : null;
      this.setActiveTask(nextActive);
    }
  }

  deleteTask(id) {
    const updatedTasks = state.tasks.filter(t => t.id !== id);
    state.updateTasks(updatedTasks);

    if (state.timerState.activeTaskId === id) {
      const nextActive = updatedTasks.length > 0 ? updatedTasks[0].id : null;
      this.setActiveTask(nextActive);
    }

    if (window.deleteStudyFlowTask) {
      window.deleteStudyFlowTask(id);
    } else {
      this.deleteTaskInStudyFlow(id);
    }
  }

  deleteTaskInStudyFlow(id) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'studyflow-v1' || k?.startsWith('studyflow-v1:')) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.tasks)) {
              parsed.tasks = parsed.tasks.filter(t => t.id !== id);
              localStorage.setItem(k, JSON.stringify(parsed));
              window.dispatchEvent(new CustomEvent('studyflow:tasks-updated'));
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
