/* ==========================================================================
   DeepTick Pomodoro - Keyboard Shortcuts Manager
   ========================================================================== */

export function setupKeyboardShortcuts({ onToggleTimer, onSkipTimer, onResetTimer, onAdjustTime, onNewTask, onSwitchMode, onToggleHelp }) {
  window.addEventListener('keydown', (e) => {
    // Avoid triggering when focused inside inputs or textareas
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      if (e.key === 'Escape') {
        activeEl.blur();
      }
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        onToggleTimer();
        break;

      case 's':
      case 'S':
        e.preventDefault();
        onSkipTimer();
        break;

      case 'r':
      case 'R':
        e.preventDefault();
        onResetTimer();
        break;

      case '+':
      case '=':
        e.preventDefault();
        onAdjustTime(300); // +5 min
        break;

      case '-':
      case '_':
        e.preventDefault();
        onAdjustTime(-300); // -5 min
        break;

      case 'n':
      case 'N':
        e.preventDefault();
        onNewTask();
        break;

      case '1':
        e.preventDefault();
        onSwitchMode('pomodoro');
        break;

      case '2':
        e.preventDefault();
        onSwitchMode('short_break');
        break;

      case '3':
        e.preventDefault();
        onSwitchMode('long_break');
        break;

      case '?':
        e.preventDefault();
        onToggleHelp();
        break;

      case 'Escape':
        // Close any open modals
        const openDialogs = document.querySelectorAll('dialog[open]');
        openDialogs.forEach(d => d.close());
        break;
    }
  });
}
