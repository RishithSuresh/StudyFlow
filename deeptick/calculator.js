/* ==========================================================================
   DeepTick Pomodoro - Estimated Session End Time Calculator
   ========================================================================== */

import { state } from './state.js';
import { taskManager } from './tasks.js';

export function calculateEstimatedFinishTime() {
  const { settings, timerState } = state;
  const now = new Date();

  const remainingTaskPomos = taskManager.calculateTotalRemainingPomodoros();
  const hasActiveSession = timerState.status === 'running' || timerState.status === 'paused';

  // If idle and no tasks are queued in the focus session, there is no active session to finish
  if (!hasActiveSession && remainingTaskPomos === 0) {
    return {
      finishTimeFormatted: '--:--',
      totalSeconds: 0,
      remainingPomos: 0
    };
  }

  // 1. Current session remaining seconds
  let currentRemainingSeconds = 0;
  if (hasActiveSession) {
    currentRemainingSeconds = Math.max(0, timerState.remainingSeconds);
  } else {
    // Idle, but user has tasks queued in the focus session
    if (timerState.mode === 'pomodoro') {
      currentRemainingSeconds = (settings.pomodoroDuration || 30) * 60;
    } else if (timerState.mode === 'short_break') {
      currentRemainingSeconds = (settings.shortBreakDuration || 5) * 60;
    } else {
      currentRemainingSeconds = (settings.longBreakDuration || 15) * 60;
    }
  }

  // 2. Count additional pomodoros ONLY from tasks explicitly added to focus queue!
  // NEVER project arbitrary hours from daily goal.
  let additionalPomos = 0;
  if (remainingTaskPomos > 1) {
    additionalPomos = remainingTaskPomos - 1;
  }

  let totalFutureSeconds = 0;
  if (additionalPomos > 0) {
    const pomoSec = (settings.pomodoroDuration || 30) * 60;
    const shortBreakSec = (settings.shortBreakDuration || 5) * 60;
    totalFutureSeconds = additionalPomos * (pomoSec + shortBreakSec);
  }

  const grandTotalSeconds = currentRemainingSeconds + totalFutureSeconds;
  if (grandTotalSeconds <= 0) {
    return {
      finishTimeFormatted: '--:--',
      totalSeconds: 0,
      remainingPomos: 0
    };
  }

  const finishDate = new Date(now.getTime() + grandTotalSeconds * 1000);
  const timeString = finishDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isTomorrow = finishDate.getDate() !== now.getDate();

  return {
    finishTimeFormatted: isTomorrow ? `Tomorrow ${timeString}` : timeString,
    totalSeconds: grandTotalSeconds,
    remainingPomos: Math.max(1, remainingTaskPomos)
  };
}
