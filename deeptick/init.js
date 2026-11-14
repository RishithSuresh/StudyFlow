/* DeepTick Pomodoro — StudyFlow Integration Entry Point */
import { state } from './state.js';
import { timer } from './timer.js';
import { ui } from './ui.js';
import { taskManager } from './tasks.js';
import { soundManager } from './audio.js';
import { notifier } from './notifications.js';
import { setupKeyboardShortcuts } from './shortcuts.js';

function boot() {
  // Sync tasks from StudyFlow workspace first
  taskManager.syncFromStudyFlow();

  // Initialize UI components and bind event listeners
  ui.init();

  // Setup Keyboard Shortcuts
  setupKeyboardShortcuts({
    onToggleTimer: () => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      soundManager.initContext();
      timer.toggle();
    },
    onSkipTimer: () => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      timer.skip();
    },
    onResetTimer: () => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      timer.reset();
    },
    onAdjustTime: (deltaSecs) => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      timer.adjustTime(deltaSecs);
    },
    onNewTask: () => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      ui.openTaskModal(null);
    },
    onSwitchMode: (mode) => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      timer.setMode(mode);
    },
    onToggleHelp: () => {
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
      const modal = document.getElementById('modal-shortcuts');
      if (modal) { if (modal.open) modal.close(); else modal.showModal(); }
    }
  });

  // Handle visibility changes accurately using timestamps
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.timerState.status === 'running') {
      const now = Date.now();
      if (state.timerState.endTimestamp) {
        const remaining = Math.round((state.timerState.endTimestamp - now) / 1000);
        if (remaining <= 0) {
          timer.onTimerCompleted();
        } else {
          state.updateTimerState({ remainingSeconds: remaining });
        }
      }
    }
  });

  // Re-sync tasks and render whenever user switches to the focus view
  window.addEventListener('studyflow:view-changed', (e) => {
    if (e.detail?.view === 'focus') {
      taskManager.syncFromStudyFlow();
      ui.renderAll();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-view="focus"]') || e.target.closest('[data-go="focus"]')) {
      setTimeout(() => {
        taskManager.syncFromStudyFlow();
        ui.renderAll();
      }, 50);
    }
  });

  // Sync focus minutes with StudyFlow's overview stat
  const syncFocusStats = () => {
    const daily = state.getDailyStats();
    const el = document.getElementById('focus-today');
    if (el) el.textContent = daily.focusMinutes;
  };
  state.on('sessions:updated', syncFocusStats);
  syncFocusStats();

  console.log('🍅 DeepTick Pomodoro integrated into StudyFlow.');
}

// Execute immediately if DOM already loaded (ES modules in Vite), or on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
