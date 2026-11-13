/* DeepTick Pomodoro — StudyFlow Integration Entry Point */
import { state } from './state.js';
import { timer } from './timer.js';
import { ui } from './ui.js';
import { notifier } from './notifications.js';
import { setupKeyboardShortcuts } from './shortcuts.js';

document.addEventListener('DOMContentLoaded', () => {
  ui.init();

  setupKeyboardShortcuts({
    onToggleTimer: () => {
      // Only fire shortcuts when focus view is active
      if (!document.getElementById('view-focus')?.classList.contains('active')) return;
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

  // Sync focus minutes with StudyFlow's overview stat
  const syncFocusStats = () => {
    const daily = state.getDailyStats();
    const el = document.getElementById('focus-today');
    if (el) el.textContent = daily.focusMinutes;
  };
  state.on('sessions:updated', syncFocusStats);
  syncFocusStats();

  console.log('🍅 DeepTick Pomodoro integrated into StudyFlow.');
});
