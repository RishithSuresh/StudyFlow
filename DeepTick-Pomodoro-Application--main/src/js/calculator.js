/* ==========================================================================
   DeepTick Pomodoro - Estimated Session End Time Calculator
   ========================================================================== */

import { state } from './state.js';
import { taskManager } from './tasks.js';

export function calculateEstimatedFinishTime() {
  const { settings, timerState } = state;
  const now = new Date();

  // 1. Calculate remaining seconds in current active/displayed timer
  let currentRemainingSeconds = 0;
  if (timerState.status === 'running' || timerState.status === 'paused') {
    currentRemainingSeconds = Math.max(0, timerState.remainingSeconds);
  } else {
    // Idle state
    if (timerState.mode === 'pomodoro') {
      currentRemainingSeconds = (settings.pomodoroDuration * 60) + (timerState.tempAdjustmentSeconds || 0);
    } else if (timerState.mode === 'short_break') {
      currentRemainingSeconds = settings.shortBreakDuration * 60;
    } else {
      currentRemainingSeconds = settings.longBreakDuration * 60;
    }
  }

  // 2. Count planned remaining pomodoros
  const remainingTaskPomos = taskManager.calculateTotalRemainingPomodoros();
  const dailyStats = state.getDailyStats();
  const remainingGoalPomos = Math.max(0, settings.dailyPomodoroGoal - dailyStats.pomodorosCompleted);

  // Use task remaining pomodoros if any exist, otherwise use daily goal
  let totalRemainingPomos = remainingTaskPomos > 0 ? remainingTaskPomos : remainingGoalPomos;
  if (totalRemainingPomos <= 0 && timerState.mode === 'pomodoro') {
    totalRemainingPomos = 1; // At least finish the current one
  }

  let futurePomos = totalRemainingPomos;
  if (timerState.mode === 'pomodoro') {
    futurePomos = Math.max(0, totalRemainingPomos - 1);
  }

  // 3. Compute future pomodoros time + breaks time
  let totalFutureSeconds = 0;
  let shortBreaksCount = 0;
  let longBreaksCount = 0;

  const pomoSec = settings.pomodoroDuration * 60;
  const shortBreakSec = settings.shortBreakDuration * 60;
  const longBreakSec = settings.longBreakDuration * 60;
  const interval = settings.longBreakInterval || 4;

  let simCycle = timerState.cycleCount || 1;

  for (let i = 0; i < futurePomos; i++) {
    // Add pomodoro duration
    totalFutureSeconds += pomoSec;

    // Add break after this pomodoro (unless it's the very last planned task)
    if (i < futurePomos - 1 || timerState.mode === 'pomodoro') {
      if (simCycle % interval === 0) {
        totalFutureSeconds += longBreakSec;
        longBreaksCount++;
      } else {
        totalFutureSeconds += shortBreakSec;
        shortBreaksCount++;
      }
      simCycle = (simCycle % interval) + 1;
    }
  }

  const grandTotalSeconds = currentRemainingSeconds + totalFutureSeconds;
  const finishDate = new Date(now.getTime() + grandTotalSeconds * 1000);

  // Format finish time string
  const timeString = finishDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isTomorrow = finishDate.getDate() !== now.getDate();

  return {
    finishTimeFormatted: isTomorrow ? `Tomorrow ${timeString}` : timeString,
    totalSeconds: grandTotalSeconds,
    remainingPomos: totalRemainingPomos,
    shortBreaksCount,
    longBreaksCount,
    breakdownText: `${totalRemainingPomos} Focus • ${shortBreaksCount + (timerState.mode === 'short_break' ? 1 : 0)} Short • ${longBreaksCount + (timerState.mode === 'long_break' ? 1 : 0)} Long`
  };
}
