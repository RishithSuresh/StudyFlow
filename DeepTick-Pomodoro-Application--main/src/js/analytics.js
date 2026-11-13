/* ==========================================================================
   DeepTick Pomodoro - Analytics & Data Export/Import
   ========================================================================== */

import { state } from './state.js';

class AnalyticsEngine {
  getWeeklyStats() {
    const days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayName = d.toLocaleDateString([], { weekday: 'short' });

      const daySessions = state.sessions.filter(s => s.startedAt.startsWith(dateStr));
      const pomodoros = daySessions.filter(s => s.type === 'pomodoro' && s.completed).length;
      const focusSecs = daySessions
        .filter(s => s.type === 'pomodoro')
        .reduce((acc, s) => acc + (s.actualDurationSeconds || 0), 0);

      days.push({
        date: dateStr,
        dayName,
        pomodoros,
        focusMinutes: Math.round(focusSecs / 60),
        focusHours: (focusSecs / 3600).toFixed(1)
      });
    }

    const totalWeeklyPomos = days.reduce((acc, d) => acc + d.pomodoros, 0);
    const totalWeeklyMinutes = days.reduce((acc, d) => acc + d.focusMinutes, 0);

    return {
      days,
      totalWeeklyPomos,
      totalWeeklyHours: (totalWeeklyMinutes / 60).toFixed(1)
    };
  }

  getTaskBreakdown() {
    const taskMap = {};

    state.sessions
      .filter(s => s.type === 'pomodoro' && s.completed)
      .forEach(s => {
        const title = s.taskTitle || 'Unassigned Focus';
        if (!taskMap[title]) {
          taskMap[title] = { count: 0, seconds: 0 };
        }
        taskMap[title].count += 1;
        taskMap[title].seconds += (s.actualDurationSeconds || 0);
      });

    return Object.entries(taskMap).map(([title, data]) => ({
      title,
      count: data.count,
      minutes: Math.round(data.seconds / 60)
    })).sort((a, b) => b.minutes - a.minutes);
  }

  exportDataAsJSON() {
    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      tasks: state.tasks,
      sessions: state.sessions,
      streak: state.streak
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deeptick-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportSessionsAsCSV() {
    const headers = ['Date', 'Time', 'Session Type', 'Task', 'Duration (min)', 'Status'];
    const rows = state.sessions.map(s => [
      s.startedAt.slice(0, 10),
      new Date(s.startedAt).toLocaleTimeString(),
      s.type,
      `"${(s.taskTitle || 'Unassigned').replace(/"/g, '""')}"`,
      Math.round((s.actualDurationSeconds || 0) / 60),
      s.completed ? 'Completed' : 'Skipped'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deeptick-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importDataFromJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) state.updateSettings(data.settings);
      if (data.tasks) state.updateTasks(data.tasks);
      if (data.sessions) {
        state.sessions = data.sessions;
        state.save('deeptick_sessions_v1', state.sessions);
      }
      if (data.streak) {
        state.streak = data.streak;
        state.save('deeptick_streak_v1', state.streak);
      }
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  }
}

export const analytics = new AnalyticsEngine();
