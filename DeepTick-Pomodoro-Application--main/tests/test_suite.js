/* ==========================================================================
   DeepTick Pomodoro - Automated Logic & Calculation Test Suite
   ========================================================================== */

import assert from 'node:assert';

// Mock browser globals for Node.js environment
globalThis.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; }
};

globalThis.window = {
  confirm: () => true,
  addEventListener: () => {},
  innerWidth: 1024,
  innerHeight: 768
};

globalThis.document = {
  documentElement: {
    setAttribute: () => {},
    style: { setProperty: () => {} }
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {}
};

// Import modules
const { state } = await import('../src/js/state.js');
const { taskManager } = await import('../src/js/tasks.js');
const { calculateEstimatedFinishTime } = await import('../src/js/calculator.js');
const { analytics } = await import('../src/js/analytics.js');
const { timer } = await import('../src/js/timer.js');

console.log('🧪 Running DeepTick Test Suite...\n');

// 1. Test Task Dual Estimation
console.log('Test 1: Task Creation with Dual Estimation (Pomodoro <-> Minutes)');
state.updateSettings({ pomodoroDuration: 30, shortBreakDuration: 5, longBreakDuration: 15, longBreakInterval: 4 });

const task1 = taskManager.createTask({
  title: 'Study Machine Learning',
  description: 'Read gradient descent chapter',
  priority: 'high',
  estimatedPomodoros: 3
});

assert.strictEqual(task1.estimatedPomodoros, 3);
assert.strictEqual(task1.estimatedMinutes, 90, '3 Pomodoros at 30 min duration should equal 90 minutes');
console.log('  ✓ 3 Pomodoros correctly calculated as 90 minutes');

// Test 2: Task Update from Minutes -> Pomodoros
console.log('\nTest 2: Task Update from Minutes to Pomodoros');
taskManager.updateTask(task1.id, { estimatedMinutes: 120 });
const updatedTask1 = taskManager.getTask(task1.id);
assert.strictEqual(updatedTask1.estimatedMinutes, 120);
assert.strictEqual(updatedTask1.estimatedPomodoros, 4, '120 minutes at 30 min should convert to 4 Pomodoros');
console.log('  ✓ 120 minutes converted to 4 Pomodoros');

// Test 3: Non-Destructive Task Completion & Excess Pomodoros
console.log('\nTest 3: Non-Destructive Task Focus & Excess Pomodoros');
// Record 5 completed Pomodoros on a task with 4 planned
for (let i = 0; i < 5; i++) {
  taskManager.recordPomodoroSession(task1.id, 1800);
}
const taskWithExcess = taskManager.getTask(task1.id);
assert.strictEqual(taskWithExcess.completedPomodoros, 5);
assert.strictEqual(taskWithExcess.estimatedPomodoros, 4);
assert.strictEqual(taskWithExcess.isCompleted, false, 'Physical task must not be automatically closed');
console.log('  ✓ 5/4 Pomodoros recorded gracefully (+1 excess) without locking task');

// Test 4: Estimated Finish Time Calculation
console.log('\nTest 4: Estimated Finish Time Engine');
state.updateTimerState({
  mode: 'pomodoro',
  status: 'idle',
  targetSeconds: 1800,
  remainingSeconds: 1800,
  cycleCount: 1
});

const finishInfo = calculateEstimatedFinishTime();
assert.ok(finishInfo.finishTimeFormatted, 'Should produce formatted finish time string');
assert.ok(finishInfo.totalSeconds > 0, 'Total seconds must be positive');
console.log(`  ✓ Estimated finish time calculated successfully: ${finishInfo.finishTimeFormatted} (${finishInfo.breakdownText})`);

// Test 5: Temporary Time Adjustments
console.log('\nTest 5: Temporary Timer Adjustments');
const initialRemaining = state.timerState.remainingSeconds;
timer.adjustTime(300); // +5 min
assert.strictEqual(state.timerState.remainingSeconds, initialRemaining + 300, 'Remaining time should increase by 300s');
assert.strictEqual(state.settings.pomodoroDuration, 30, 'Permanent default settings must NOT be changed by temporary adjustment');
console.log('  ✓ +5 min temporary adjustment applied without mutating permanent settings');

// Test 6: Analytics and Sessions Tracking
console.log('\nTest 6: Analytics & Session Aggregation');
state.addSession({
  id: 'sess-test-1',
  taskId: task1.id,
  taskTitle: task1.title,
  type: 'pomodoro',
  plannedDurationSeconds: 1800,
  actualDurationSeconds: 1800,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  completed: true
});

const weekly = analytics.getWeeklyStats();
assert.ok(weekly.totalWeeklyPomos >= 1, 'Should track at least 1 weekly completed Pomodoro');
const breakdown = analytics.getTaskBreakdown();
assert.ok(breakdown.some(t => t.title === 'Study Machine Learning'), 'Should track focus distribution by task');
console.log(`  ✓ Analytics successfully recorded session (Weekly Pomodoros: ${weekly.totalWeeklyPomos})`);

// Test 7: Task Deletion & Active Task Management
console.log('\nTest 7: Task Deletion & Active Task Reassignment');
const taskToDelete = taskManager.createTask({
  title: 'Task to be deleted',
  description: 'Testing delete capability',
  estimatedPomodoros: 2
});
assert.ok(taskManager.getTask(taskToDelete.id), 'Task should exist before deletion');
taskManager.deleteTask(taskToDelete.id);
assert.strictEqual(taskManager.getTask(taskToDelete.id), null, 'Task should be removed after deletion');
console.log('  ✓ Task successfully deleted from state store');

// Test 8: Clear Finished Tasks
console.log('\nTest 8: Clear Finished Tasks');
const tFinished = taskManager.createTask({ title: 'Completed Task', estimatedPomodoros: 1 });
const tActive = taskManager.createTask({ title: 'Unfinished Task', estimatedPomodoros: 2 });
taskManager.toggleComplete(tFinished.id);
assert.strictEqual(taskManager.getTask(tFinished.id).isCompleted, true);

const clearedCount = taskManager.clearFinishedTasks();
assert.ok(clearedCount >= 1, 'Should clear at least 1 finished task');
assert.strictEqual(taskManager.getTask(tFinished.id), null, 'Finished task should no longer exist');
assert.ok(taskManager.getTask(tActive.id) !== null, 'Active task should still exist');
console.log(`  ✓ Cleared ${clearedCount} finished tasks while preserving active tasks`);

// Test 9: Clear All Tasks
console.log('\nTest 9: Clear All Tasks');
const clearedAllCount = taskManager.clearAllTasks();
assert.ok(clearedAllCount >= 1, 'Should clear all remaining tasks');
assert.strictEqual(state.tasks.length, 0, 'Tasks array must be empty');
assert.strictEqual(state.timerState.activeTaskId, null, 'Active task must be reset to null');
console.log('  ✓ All tasks cleared and active task state reset');

console.log('\n🎉 ALL 9 AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY!');
