/* ==========================================================================
   DeepTick Pomodoro - Task Management Engine
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

  createTask({ title, description = '', priority = 'medium', estimatedPomodoros = 1, estimatedMinutes = null }) {
    const pomodoroDuration = state.settings.pomodoroDuration || 30;
    
    let pomos = parseInt(estimatedPomodoros, 10);
    let mins = estimatedMinutes !== null ? parseInt(estimatedMinutes, 10) : pomos * pomodoroDuration;

    if (isNaN(pomos) || pomos < 1) pomos = 1;
    if (isNaN(mins) || mins < 1) mins = pomos * pomodoroDuration;

    const newTask = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
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

    // If no active task currently, make this active
    if (!state.timerState.activeTaskId) {
      this.setActiveTask(newTask.id);
    }

    return newTask;
  }

  updateTask(id, updates) {
    const pomodoroDuration = state.settings.pomodoroDuration || 30;
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        const modified = { ...t, ...updates };
        
        // Recalculate mins/pomos if one changed
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
  }

  toggleComplete(id) {
    const updatedTasks = state.tasks.map(t => {
      if (t.id === id) {
        const isCompleted = !t.isCompleted;
        return {
          ...t,
          isCompleted,
          completedAt: isCompleted ? new Date().toISOString() : null
        };
      }
      return t;
    });

    state.updateTasks(updatedTasks);
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
          completedPomodoros: t.completedPomodoros + 1,
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
        const remaining = Math.max(0, t.estimatedPomodoros - t.completedPomodoros);
        return acc + remaining;
      }, 0);
  }

  calculateTotalPlannedPomodoros() {
    return state.tasks.reduce((acc, t) => acc + t.estimatedPomodoros, 0);
  }

  calculateTotalCompletedPomodoros() {
    return state.tasks.reduce((acc, t) => acc + t.completedPomodoros, 0);
  }
}

export const taskManager = new TaskManager();
