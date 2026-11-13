/* ==========================================================================
   DeepTick Pomodoro - Main Application Bootstrap
   ========================================================================== */

import { state } from './state.js';
import { timer } from './timer.js';
import { taskManager } from './tasks.js';
import { ui } from './ui.js';
import { notifier } from './notifications.js';
import { setupKeyboardShortcuts } from './shortcuts.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI and state listeners
  ui.init();

  // Request browser notifications permission on first interaction
  const requestNotifBtn = document.getElementById('btn-request-notifications');
  if (requestNotifBtn) {
    requestNotifBtn.addEventListener('click', async () => {
      const granted = await notifier.requestPermission();
      if (granted) {
        notifier.notify('Notifications Active', 'You will be alerted when focus & break sessions complete!', { type: 'success' });
        requestNotifBtn.style.display = 'none';
      }
    });

    if (notifier.hasPermission) {
      requestNotifBtn.style.display = 'none';
    }
  }

  // Setup Keyboard Shortcuts
  setupKeyboardShortcuts({
    onToggleTimer: () => timer.toggle(),
    onSkipTimer: () => timer.skip(),
    onResetTimer: () => timer.reset(),
    onAdjustTime: (deltaSecs) => timer.adjustTime(deltaSecs),
    onNewTask: () => ui.openTaskModal(null),
    onSwitchMode: (mode) => timer.setMode(mode),
    onToggleHelp: () => {
      const modal = document.getElementById('modal-shortcuts');
      if (modal) {
        if (modal.open) modal.close();
        else modal.showModal();
      }
    }
  });

  // Handle visibility changes to ensure 100% accurate timekeeping
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

  console.log('🚀 DeepTick Pomodoro Application initialized successfully.');
});
