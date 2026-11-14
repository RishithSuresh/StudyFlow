/* ==========================================================================
   DeepTick Pomodoro - UI Renderer & Interaction Controller
   ========================================================================== */

import { state } from './state.js';
import { timer } from './timer.js';
import { taskManager } from './tasks.js';
import { soundManager } from './audio.js';
import { calculateEstimatedFinishTime } from './calculator.js';
import { analytics } from './analytics.js';
import { notifier } from './notifications.js';

class UIManager {
  constructor() {
    this.confettiParticles = [];
    this.confettiAnimationId = null;
    this.chooseTaskSearchQuery = '';
    this.chooseTaskScopeFilter = 'all';
  }

  init() {
    this.bindEvents();
    this.renderAll();
    this.initConfettiCanvas();
  }

  syncModeColors() {
    const { mode } = state.timerState;
    const timerBox = document.querySelector('.timer-box');
    if (timerBox) {
      timerBox.classList.remove('mode-pomodoro', 'mode-short_break', 'mode-long_break');
      timerBox.classList.add(`mode-${mode}`);
    }

    const topBar = document.getElementById('top-progress-bar');
    if (topBar) {
      if (mode === 'short_break') topBar.style.backgroundColor = '#276e3b';
      else if (mode === 'long_break') topBar.style.backgroundColor = '#2b5c7f';
      else topBar.style.backgroundColor = 'var(--sf-coral)';
    }

    document.querySelectorAll('.mode-pill').forEach(btn => {
      const isCurrent = btn.dataset.mode === mode;
      btn.classList.toggle('active', isCurrent);
      btn.setAttribute('aria-selected', String(isCurrent));
    });
  }

  formatTime(totalSeconds) {
    const secs = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  renderAll() {
    this.syncModeColors();
    this.renderTimer();
    this.renderSessionDiffPresets();
    this.renderTasks();
    this.renderStats();
    this.renderSettingsForm();
  }

  // 1. Timer Render
  renderTimer() {
    const { mode, status, remainingSeconds, targetSeconds, cycleCount } = state.timerState;
    const { settings } = state;
    const activeTask = taskManager.getActiveTask();

    this.syncModeColors();

    // Digits & Document Title
    const timeFormatted = this.formatTime(remainingSeconds);
    const timerDigitsEl = document.getElementById('timer-digits');
    if (timerDigitsEl) timerDigitsEl.textContent = timeFormatted;

    const modeLabel = mode === 'pomodoro' ? 'Focus Session' : mode === 'short_break' ? 'Short Break' : 'Long Break';
    const taskTitle = activeTask ? ` · ${activeTask.title}` : '';
    document.title = `${status === 'running' ? '▶ ' : ''}${timeFormatted} — ${modeLabel}${taskTitle}`;

    // Top progress line
    const topBar = document.getElementById('top-progress-bar');
    if (topBar) {
      const progress = targetSeconds > 0 ? (1 - (remainingSeconds / targetSeconds)) * 100 : 0;
      topBar.style.width = `${progress}%`;
    }

    // Mode Switcher Pills
    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Start / Pause Button
    const playBtn = document.getElementById('btn-timer-toggle');
    if (playBtn) {
      if (status === 'running') {
        playBtn.textContent = 'PAUSE';
        playBtn.classList.add('is-active-running');
      } else {
        playBtn.textContent = status === 'paused' ? 'RESUME' : 'START';
        playBtn.classList.remove('is-active-running');
      }
    }

    // Active Task Banner
    const activeTaskName = document.getElementById('active-task-name-text');
    if (activeTaskName) {
      if (activeTask) {
        activeTaskName.textContent = `🎯 ${activeTask.title}`;
      } else {
        activeTaskName.textContent = 'General Focus Session (No task selected)';
      }
    }

    const cycleInfo = document.getElementById('header-cycle-count');
    const interval = settings.longBreakInterval || 4;
    if (cycleInfo) {
      if (mode === 'pomodoro') {
        cycleInfo.textContent = `#${cycleCount} of ${interval} focus sessions`;
      } else if (mode === 'short_break') {
        cycleInfo.textContent = `☕ Short Break (after session #${cycleCount})`;
      } else {
        cycleInfo.textContent = `🌴 Long Break (${interval} sessions completed!)`;
      }
    }

    // Streak
    const streakEl = document.getElementById('header-streak-count');
    if (streakEl) streakEl.textContent = `${state.streak.currentStreak}d Streak`;
  }

  // 2. Session Differentiation Presets Render
  renderSessionDiffPresets() {
    const currentMins = state.settings.pomodoroDuration || 30;
    const isPomo = state.timerState.mode === 'pomodoro';
    document.querySelectorAll('.session-diff-chip').forEach(chip => {
      const mins = parseInt(chip.dataset.diffMins, 10);
      chip.classList.toggle('active', isPomo && mins === currentMins);
    });
  }

  // 3. Tasks List Render
  renderTasks() {
    const listContainer = document.getElementById('dt-tasks-list');
    if (!listContainer) return;

    const tasks = taskManager.getTasks();
    const activeTaskId = state.timerState.activeTaskId;

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div class="tasks-empty-state-card">
          <div class="tasks-empty-icon">🎯</div>
          <div class="tasks-empty-title">No focus tasks selected</div>
          <p class="tasks-empty-desc">Choose from your existing StudyFlow tasks or add an extra task for this focus session.</p>
          <div class="tasks-empty-actions">
            <button type="button" class="btn btn-primary btn-sm btn-action-choose-existing">
              📋 Choose Existing Task
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-action-add-new">
              ➕ Add Extra Task
            </button>
          </div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = tasks.map(task => {
      const isActive = task.id === activeTaskId;
      const isOver = task.completedPomodoros > task.estimatedPomodoros;
      const excessCount = task.completedPomodoros - task.estimatedPomodoros;
      const mins = task.estimatedMinutes || (task.estimatedPomodoros * (state.settings.pomodoroDuration || 30));

      return `
        <div class="task-item ${isActive ? 'is-active-task' : ''} ${task.isCompleted ? 'is-completed' : ''}" data-task-id="${task.id}">
          <div class="task-left-wrap" data-action="select-task" data-task-id="${task.id}">
            <button class="task-check-circle ${task.isCompleted ? 'checked' : ''}" data-action="toggle-complete" data-task-id="${task.id}" aria-label="Toggle completion"></button>
            <div class="task-info-col">
              <span class="task-title-text">${this.escapeHtml(task.title)}</span>
              ${task.description ? `<span class="task-desc-text">${this.escapeHtml(task.description)}</span>` : ''}
            </div>
          </div>

          <div class="task-right-wrap">
            <button type="button" class="task-duration-pill" data-action="set-task-duration" data-mins="${mins}" title="Click to set timer to this task's duration (${mins} min)">
              ⏱️ ${mins}m
            </button>
            <span class="task-pomos-badge" title="Completed pomos">${task.completedPomodoros} / ${task.estimatedPomodoros}</span>
            ${isOver ? `<span class="task-excess-pill">+${excessCount}</span>` : ''}
            <div class="task-actions-group">
              <button class="task-action-btn task-focus-btn" data-action="set-task-duration" data-mins="${mins}" title="Focus on this task and set timer" aria-label="Focus on this task">
                🎯
              </button>
              <button class="task-action-btn task-edit-btn" data-action="edit-task" data-task-id="${task.id}" title="Edit Task" aria-label="Edit Task">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="task-action-btn task-remove-btn" data-action="remove-focus" data-task-id="${task.id}" title="Remove from this focus session" aria-label="Remove from session">
                ✕
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 4. Choose Existing Tasks Modal Render
  renderChooseTaskModal() {
    const listContainer = document.getElementById('choose-task-list');
    const searchInput = document.getElementById('choose-task-search');
    const hintEl = document.getElementById('choose-task-count-hint');
    if (!listContainer) return;

    const query = searchInput ? searchInput.value.trim() : this.chooseTaskSearchQuery;
    const scope = this.chooseTaskScopeFilter || 'all';

    const tasks = taskManager.getAvailableStudyFlowTasks(query, scope);

    if (hintEl) {
      hintEl.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'} available in workspace`;
    }

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div class="choose-task-empty">
          <div style="font-size: 26px; margin-bottom: 8px;">📋</div>
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: var(--sf-navy);">
            ${query ? 'No matching tasks found.' : 'No open tasks found in your workspace.'}
          </p>
          <p style="margin: 4px 0 0; font-size: 12px; color: var(--sf-navy-soft);">
            You can add new tasks directly using "+ Add Extra Task".
          </p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = tasks.map(t => {
      const isDaily = t.scope === 'daily' || t.due === new Date().toISOString().slice(0, 10);
      return `
        <div class="choose-task-item ${t.isInFocus ? 'already-in-focus' : ''}" data-task-id="${t.id}">
          <div class="choose-task-main">
            <div class="choose-task-title-row">
              <span class="choose-scope-tag ${isDaily ? 'scope-daily' : 'scope-overall'}">
                ${isDaily ? '☀️ Daily' : '📋 Overall'}
              </span>
              <span class="choose-task-title">${this.escapeHtml(t.title || 'Untitled')}</span>
            </div>
            <div class="choose-task-meta">
              ${t.subject ? `<span class="meta-tag">📚 ${this.escapeHtml(t.subject)}</span>` : ''}
              ${t.due ? `<span class="meta-tag">📅 Due ${this.escapeHtml(t.due)}</span>` : ''}
              ${t.note ? `<span class="meta-desc">${this.escapeHtml(t.note)}</span>` : ''}
            </div>
          </div>
          <div class="choose-task-btn-wrap">
            ${t.isInFocus ? `
              <button type="button" class="btn btn-secondary btn-sm" disabled style="opacity: 0.65; cursor: default;">
                ✓ Added
              </button>
            ` : `
              <button type="button" class="btn btn-primary btn-sm" data-choose-add-id="${t.id}">
                + Add to Focus
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  // 5. Stats & Estimated Finish Time Render
  renderStats() {
    const daily = state.getDailyStats();
    const { settings } = state;

    // Daily Goals
    const goalPomos = settings.dailyPomodoroGoal || 4;
    const dailyPomoVal = document.getElementById('metric-daily-pomos');
    if (dailyPomoVal) dailyPomoVal.textContent = `${daily.pomodorosCompleted} / ${goalPomos}`;

    const dailyFocusVal = document.getElementById('metric-daily-focus');
    if (dailyFocusVal) {
      const hours = Math.floor(daily.focusSeconds / 3600);
      const mins = Math.floor((daily.focusSeconds % 3600) / 60);
      dailyFocusVal.textContent = `${hours}h ${mins}m`;
    }

    // Estimated Finish Time
    const estimation = calculateEstimatedFinishTime();
    const finishTimeEl = document.getElementById('estimated-finish-time');
    if (finishTimeEl) finishTimeEl.textContent = estimation.finishTimeFormatted;
  }

  // 6. Settings Form Population
  renderSettingsForm() {
    const { settings } = state;
    this.setInputValue('setting-pomodoro-duration', settings.pomodoroDuration);
    this.setInputValue('setting-short-break', settings.shortBreakDuration);
    this.setInputValue('setting-long-break', settings.longBreakDuration);
    this.setInputValue('setting-long-interval', settings.longBreakInterval);

    this.setCheckboxValue('setting-auto-breaks', settings.autoStartBreaks);
    this.setCheckboxValue('setting-auto-pomos', settings.autoStartPomodoros);

    this.setInputValue('setting-daily-pomos', settings.dailyPomodoroGoal);
    this.setInputValue('setting-daily-hours', settings.dailyFocusGoalHours);
    this.setInputValue('setting-goal-type', settings.primaryGoalType);

    this.setCheckboxValue('setting-show-completed', settings.showCompletedTasks);
    this.setCheckboxValue('setting-confirm-delete', settings.confirmDelete);

    this.setCheckboxValue('setting-sound-enabled', settings.soundEnabled);
    this.setInputValue('setting-pomo-sound', settings.completionSound);
    this.setInputValue('setting-break-sound', settings.breakSound);
    this.setInputValue('setting-volume', settings.volume);
    const volumeValEl = document.getElementById('volume-display-val');
    if (volumeValEl) volumeValEl.textContent = `${settings.volume}%`;

    this.setCheckboxValue('setting-repeat-sound', settings.repeatSound);
    this.setInputValue('setting-repeat-count', settings.repeatCount);
  }

  setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  }

  setCheckboxValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  initConfettiCanvas() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  triggerConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = ['#ffffff', '#ffeb3b', '#ff5722', '#4caf50', '#00bcd4', '#e91e63'];

    this.confettiParticles = [];
    for (let i = 0; i < 90; i++) {
      this.confettiParticles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        r: Math.random() * 6 + 4,
        d: Math.random() * 90,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.8) * 16,
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngle: 0,
        tiltAngleInc: (Math.random() * 0.07) + 0.05,
        alpha: 1
      });
    }

    if (this.confettiAnimationId) cancelAnimationFrame(this.confettiAnimationId);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let stillActive = false;

      this.confettiParticles.forEach(p => {
        p.tiltAngle += p.tiltAngleInc;
        p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2 + p.vy * 0.5;
        p.x += Math.sin(p.d) * 2 + p.vx * 0.5;
        p.vy += 0.25;
        p.tilt = Math.sin(p.tiltAngle - (p.r / 3)) * 15;
        p.alpha -= 0.008;

        if (p.alpha > 0) {
          stillActive = true;
          ctx.beginPath();
          ctx.lineWidth = p.r / 2;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.moveTo(p.x + p.tilt + (p.r / 4), p.y);
          ctx.lineTo(p.x + p.tilt, p.y + p.tilt + (p.r / 4));
          ctx.stroke();
        }
      });

      if (stillActive) {
        this.confettiAnimationId = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    animate();
  }

  bindEvents() {
    state.on('timer:updated', () => {
      this.renderTimer();
      this.renderSessionDiffPresets();
      this.renderStats();
    });

    state.on('tasks:updated', () => {
      this.renderTasks();
      this.renderTimer();
      this.renderStats();
    });

    state.on('settings:updated', () => {
      this.renderAll();
    });

    state.on('sessions:updated', () => {
      this.renderStats();
    });

    state.on('streak:updated', () => {
      const streakEl = document.getElementById('header-streak-count');
      if (streakEl) streakEl.textContent = `${state.streak.currentStreak}d Streak`;
    });

    state.on('celebration:goal_reached', () => {
      this.triggerConfetti();
      notifier.notify('🏆 Goal Reached!', 'You completed your daily focus goal!', { type: 'success' });
    });

    // Mode Switch Buttons
    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.dataset.mode;
        timer.setMode(mode);
        this.renderSessionDiffPresets();
      });
    });

    // Session Differentiation Presets
    document.querySelectorAll('.session-diff-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const mins = parseInt(e.currentTarget.dataset.diffMins, 10);
        if (mins) {
          timer.setCustomDuration(mins);
          this.renderSessionDiffPresets();
          notifier.notify('Duration Set', `Timer configured for ${mins} minutes for this session.`);
        }
      });
    });

    // Custom Duration Apply Button
    const btnCustomSession = document.getElementById('btn-apply-custom-session');
    const inputCustomSession = document.getElementById('custom-session-mins');
    if (btnCustomSession && inputCustomSession) {
      btnCustomSession.addEventListener('click', () => {
        const mins = parseInt(inputCustomSession.value, 10);
        if (mins && mins >= 1 && mins <= 240) {
          timer.setCustomDuration(mins);
          this.renderSessionDiffPresets();
          inputCustomSession.value = '';
          notifier.notify('Duration Set', `Timer set to ${mins} minutes.`);
        } else {
          notifier.notify('Invalid Duration', 'Please enter a duration between 1 and 240 minutes.', { type: 'warn' });
        }
      });
      inputCustomSession.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          btnCustomSession.click();
        }
      });
    }

    // Primary Controls
    const btnToggle = document.getElementById('btn-timer-toggle');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        soundManager.initContext();
        timer.toggle();
      });
    }

    const btnReset = document.getElementById('btn-timer-reset');
    if (btnReset) btnReset.addEventListener('click', () => timer.reset());

    const btnSkip = document.getElementById('btn-timer-skip');
    if (btnSkip) btnSkip.addEventListener('click', () => timer.skip());

    // +/- Quick adjustments
    document.querySelectorAll('.adjust-side-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const delta = parseInt(e.currentTarget.dataset.adjust, 10);
        timer.adjustTime(delta);
        this.renderSessionDiffPresets();
      });
    });

    // Task List Click Events
    const taskList = document.getElementById('dt-tasks-list');
    if (taskList) {
      taskList.addEventListener('click', (e) => {
        const target = e.target;

        // Empty state buttons
        if (target.closest('.btn-action-choose-existing')) {
          this.openChooseTaskModal();
          return;
        }
        if (target.closest('.btn-action-add-new')) {
          this.openTaskModal(null);
          return;
        }

        const taskItem = target.closest('.task-item');
        if (!taskItem) return;
        const taskId = taskItem.dataset.taskId;

        // Toggle complete
        if (target.classList.contains('task-check-circle') || target.dataset.action === 'toggle-complete') {
          e.stopPropagation();
          taskManager.toggleComplete(taskId);
          return;
        }

        // Set duration to this task's time
        const durationBtn = target.closest('[data-action="set-task-duration"]');
        if (durationBtn) {
          e.stopPropagation();
          const mins = parseInt(durationBtn.dataset.mins, 10);
          if (mins) {
            timer.setCustomDuration(mins);
            taskManager.setActiveTask(taskId);
            this.renderSessionDiffPresets();
            notifier.notify('Active Task Set', `Timer set to ${mins}m for this task.`);
          }
          return;
        }

        // Remove from session
        const removeBtn = target.closest('[data-action="remove-focus"]');
        if (removeBtn) {
          e.stopPropagation();
          taskManager.removeTaskFromFocus(taskId);
          notifier.notify('Task Removed', 'Removed from this focus session.');
          return;
        }

        // Edit
        const editBtn = target.closest('[data-action="edit-task"]');
        if (editBtn) {
          e.stopPropagation();
          this.openTaskModal(taskId);
          return;
        }

        // Delete permanently
        const deleteBtn = target.closest('[data-action="delete-task"]');
        if (deleteBtn) {
          e.stopPropagation();
          this.handleDeleteTask(taskId);
          return;
        }

        // Click task body -> set as active
        taskManager.setActiveTask(taskId);
      });
    }

    // Task Options Dropdown Menu & Actions
    const btnTasksMenu = document.getElementById('btn-tasks-menu');
    const tasksDropdownMenu = document.getElementById('tasks-dropdown-menu');

    if (btnTasksMenu && tasksDropdownMenu) {
      btnTasksMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = tasksDropdownMenu.classList.toggle('is-open');
        btnTasksMenu.setAttribute('aria-expanded', String(isOpen));
      });

      document.addEventListener('click', (e) => {
        if (!tasksDropdownMenu.contains(e.target) && e.target !== btnTasksMenu) {
          tasksDropdownMenu.classList.remove('is-open');
          btnTasksMenu.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Choose existing tasks buttons
    const btnChooseExisting = document.getElementById('btn-choose-existing-task');
    if (btnChooseExisting) {
      btnChooseExisting.addEventListener('click', () => this.openChooseTaskModal());
    }

    const btnChooseHeader = document.getElementById('btn-choose-existing-header');
    if (btnChooseHeader) {
      btnChooseHeader.addEventListener('click', () => this.openChooseTaskModal());
    }

    const btnChooseMenu = document.getElementById('btn-choose-existing-menu');
    if (btnChooseMenu) {
      btnChooseMenu.addEventListener('click', () => {
        tasksDropdownMenu?.classList.remove('is-open');
        this.openChooseTaskModal();
      });
    }

    // Clear finished tasks button
    const btnClearFinished = document.getElementById('btn-clear-finished-tasks');
    if (btnClearFinished) {
      btnClearFinished.addEventListener('click', () => {
        tasksDropdownMenu?.classList.remove('is-open');
        btnTasksMenu?.setAttribute('aria-expanded', 'false');
        const count = taskManager.clearFinishedTasks();
        if (count > 0) {
          notifier.notify('Tasks Cleared', `${count} completed task${count > 1 ? 's' : ''} removed.`);
        } else {
          notifier.notify('Info', 'No finished tasks to clear.');
        }
      });
    }

    // Clear all tasks button
    const btnClearAll = document.getElementById('btn-clear-all-tasks');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        tasksDropdownMenu?.classList.remove('is-open');
        btnTasksMenu?.setAttribute('aria-expanded', 'false');
        if (state.tasks.length === 0) {
          notifier.notify('Info', 'No focus tasks to clear.');
          return;
        }

        if (state.settings.confirmDelete) {
          const confirmed = window.confirm('Clear all tasks from this focus session? (Original tasks in StudyFlow are preserved)');
          if (!confirmed) return;
        }

        const count = taskManager.clearAllTasks();
        notifier.notify('Session Cleared', `${count} task${count > 1 ? 's' : ''} removed from focus session.`, { type: 'warn' });
      });
    }

    // Modal Triggers
    this.bindModalTriggers();
    this.bindChooseTaskModalEvents();
  }

  bindChooseTaskModalEvents() {
    const searchInput = document.getElementById('choose-task-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.chooseTaskSearchQuery = e.target.value.trim();
        this.renderChooseTaskModal();
      });
    }

    document.querySelectorAll('.choose-filter-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.choose-filter-pill').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.chooseTaskScopeFilter = e.currentTarget.dataset.chooseScope || 'all';
        this.renderChooseTaskModal();
      });
    });

    const chooseList = document.getElementById('choose-task-list');
    if (chooseList) {
      chooseList.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-choose-add-id]');
        if (addBtn) {
          const taskId = addBtn.dataset.chooseAddId;
          const task = taskManager.addExistingTaskToFocus(taskId);
          if (task) {
            notifier.notify('Task Added', `Added "${task.title}" to focus session.`, { type: 'success' });
            this.renderChooseTaskModal();
          }
        }
      });
    }
  }

  openChooseTaskModal() {
    const modal = document.getElementById('modal-choose-existing-task');
    if (!modal) return;
    this.chooseTaskSearchQuery = '';
    const searchInput = document.getElementById('choose-task-search');
    if (searchInput) searchInput.value = '';
    this.renderChooseTaskModal();
    modal.showModal();
    if (searchInput) setTimeout(() => searchInput.focus(), 60);
  }

  bindModalTriggers() {
    const btnNewTask = document.getElementById('btn-new-task');
    if (btnNewTask) {
      btnNewTask.addEventListener('click', () => this.openTaskModal(null));
    }

    const btnDeleteModal = document.getElementById('btn-delete-task-modal');
    if (btnDeleteModal) {
      btnDeleteModal.addEventListener('click', () => {
        const taskId = document.getElementById('task-input-id').value;
        if (taskId) {
          this.handleDeleteTask(taskId);
        }
      });
    }

    const taskForm = document.getElementById('form-task');
    if (taskForm) {
      taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleTaskFormSubmit();
      });
    }

    // Dynamic dual estimation sync in Task Form
    const taskPomoInput = document.getElementById('task-input-pomos');
    const taskMinsInput = document.getElementById('task-input-mins');
    const pomoDuration = state.settings.pomodoroDuration || 30;

    if (taskPomoInput && taskMinsInput) {
      taskPomoInput.addEventListener('input', () => {
        const p = parseInt(taskPomoInput.value, 10) || 1;
        taskMinsInput.value = p * pomoDuration;
      });
      taskMinsInput.addEventListener('input', () => {
        const m = parseInt(taskMinsInput.value, 10) || pomoDuration;
        taskPomoInput.value = Math.max(1, Math.round(m / pomoDuration));
      });
    }

    // Settings Modal
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const modalSettings = document.getElementById('modal-settings');
    if (btnOpenSettings && modalSettings) {
      btnOpenSettings.addEventListener('click', () => {
        this.renderSettingsForm();
        modalSettings.showModal();
      });
    }

    // Volume Slider
    const volumeSlider = document.getElementById('setting-volume');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        const val = e.currentTarget.value;
        const disp = document.getElementById('volume-display-val');
        if (disp) disp.textContent = `${val}%`;
      });
    }

    // Test Sound Button
    const btnTestSound = document.getElementById('btn-test-sound');
    if (btnTestSound) {
      btnTestSound.addEventListener('click', () => {
        const soundType = document.getElementById('setting-pomo-sound')?.value || 'bell';
        const vol = parseInt(document.getElementById('setting-volume')?.value, 10) || 75;
        const rep = document.getElementById('setting-repeat-sound')?.checked;
        const count = parseInt(document.getElementById('setting-repeat-count')?.value, 10) || 1;
        soundManager.play(soundType, vol, rep ? count : 1);
      });
    }

    // Settings Save Form
    const settingsForm = document.getElementById('form-settings');
    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSettingsFormSubmit();
        modalSettings.close();
      });
    }

    // Analytics Modal
    const btnOpenAnalytics = document.getElementById('btn-open-analytics');
    const modalAnalytics = document.getElementById('modal-analytics');
    if (btnOpenAnalytics && modalAnalytics) {
      btnOpenAnalytics.addEventListener('click', () => {
        this.renderAnalyticsModal();
        modalAnalytics.showModal();
      });
    }

    // Export / Import
    const btnExportJson = document.getElementById('btn-export-json');
    if (btnExportJson) btnExportJson.addEventListener('click', () => analytics.exportDataAsJSON());

    const btnExportCsv = document.getElementById('btn-export-csv');
    if (btnExportCsv) btnExportCsv.addEventListener('click', () => analytics.exportSessionsAsCSV());

    const fileImport = document.getElementById('input-import-json');
    if (fileImport) {
      fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const success = analytics.importDataFromJSON(evt.target.result);
            if (success) {
              notifier.notify('Success', 'Data imported successfully!', { type: 'success' });
              this.renderAll();
              modalSettings.close();
            } else {
              notifier.notify('Error', 'Invalid backup file format.', { type: 'warn' });
            }
          };
          reader.readAsText(file);
        }
      });
    }

    // Shortcuts Modal
    const btnShortcuts = document.getElementById('btn-shortcuts-help');
    const modalShortcuts = document.getElementById('modal-shortcuts');
    if (btnShortcuts && modalShortcuts) {
      btnShortcuts.addEventListener('click', () => modalShortcuts.showModal());
    }

    // Generic Modal Close Buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dialog = e.currentTarget.closest('dialog');
        if (dialog) dialog.close();
      });
    });

    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', (e) => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height
          && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
        if (!isInDialog) {
          dialog.close();
        }
      });
    });
  }

  openTaskModal(taskId = null) {
    const modal = document.getElementById('modal-task');
    const form = document.getElementById('form-task');
    const titleEl = document.getElementById('task-modal-title');
    const btnDeleteModal = document.getElementById('btn-delete-task-modal');
    const pomoDuration = state.settings.pomodoroDuration || 30;

    if (!modal || !form) return;

    form.reset();
    document.getElementById('task-input-id').value = taskId || '';

    if (taskId) {
      const task = taskManager.getTask(taskId);
      if (task) {
        if (titleEl) titleEl.textContent = 'Edit Task';
        if (btnDeleteModal) btnDeleteModal.style.display = 'inline-flex';
        document.getElementById('task-input-title').value = task.title;
        document.getElementById('task-input-desc').value = task.description || '';
        document.getElementById('task-input-priority').value = task.priority || 'medium';
        document.getElementById('task-input-pomos').value = task.estimatedPomodoros;
        document.getElementById('task-input-mins').value = task.estimatedMinutes || (task.estimatedPomodoros * pomoDuration);
      }
    } else {
      if (titleEl) titleEl.textContent = 'Add Extra Task for Focus Session';
      if (btnDeleteModal) btnDeleteModal.style.display = 'none';
      document.getElementById('task-input-priority').value = 'medium';
      document.getElementById('task-input-pomos').value = '1';
      document.getElementById('task-input-mins').value = pomoDuration;
    }

    modal.showModal();
    setTimeout(() => document.getElementById('task-input-title')?.focus(), 50);
  }

  handleDeleteTask(taskId) {
    const task = taskManager.getTask(taskId);
    if (!task) return;

    if (state.settings.confirmDelete) {
      const confirmed = window.confirm(`Are you sure you want to delete "${task.title}"?`);
      if (!confirmed) return;
    }

    taskManager.deleteTask(taskId);
    notifier.notify('Task Deleted', `"${task.title}" has been deleted.`, { type: 'warn' });

    const modal = document.getElementById('modal-task');
    if (modal && modal.open) {
      modal.close();
    }
  }

  handleTaskFormSubmit() {
    const id = document.getElementById('task-input-id').value;
    const title = document.getElementById('task-input-title').value;
    const description = document.getElementById('task-input-desc').value;
    const priority = document.getElementById('task-input-priority').value;
    const estimatedPomodoros = parseInt(document.getElementById('task-input-pomos').value, 10) || 1;
    const estimatedMinutes = parseInt(document.getElementById('task-input-mins').value, 10);

    if (id) {
      taskManager.updateTask(id, {
        title,
        description,
        priority,
        estimatedPomodoros,
        estimatedMinutes
      });
      notifier.notify('Task Updated', `"${title}" updated.`);
    } else {
      taskManager.createTask({
        title,
        description,
        priority,
        estimatedPomodoros,
        estimatedMinutes
      });
      notifier.notify('Task Added', `"${title}" added to focus session.`, { type: 'success' });
    }

    document.getElementById('modal-task')?.close();
  }

  handleSettingsFormSubmit() {
    const pomoDur = parseInt(document.getElementById('setting-pomodoro-duration').value, 10) || 30;
    const shortDur = parseInt(document.getElementById('setting-short-break').value, 10) || 5;
    const longDur = parseInt(document.getElementById('setting-long-break').value, 10) || 15;
    const interval = parseInt(document.getElementById('setting-long-interval').value, 10) || 4;

    const autoBreaks = document.getElementById('setting-auto-breaks').checked;
    const autoPomos = document.getElementById('setting-auto-pomos').checked;

    const dailyPomos = parseInt(document.getElementById('setting-daily-pomos').value, 10) || 4;
    const dailyHours = parseFloat(document.getElementById('setting-daily-hours').value) || 2;
    const goalType = document.getElementById('setting-goal-type').value;

    const showComp = document.getElementById('setting-show-completed').checked;
    const confirmDel = document.getElementById('setting-confirm-delete').checked;

    const soundEnabled = document.getElementById('setting-sound-enabled').checked;
    const pomoSound = document.getElementById('setting-pomo-sound').value;
    const breakSound = document.getElementById('setting-break-sound').value;
    const volume = parseInt(document.getElementById('setting-volume').value, 10) || 75;
    const repeatSound = document.getElementById('setting-repeat-sound').checked;
    const repeatCount = parseInt(document.getElementById('setting-repeat-count').value, 10) || 1;

    state.updateSettings({
      pomodoroDuration: Math.max(1, pomoDur),
      shortBreakDuration: Math.max(1, shortDur),
      longBreakDuration: Math.max(1, longDur),
      longBreakInterval: Math.max(1, interval),
      autoStartBreaks: autoBreaks,
      autoStartPomodoros: autoPomos,
      dailyPomodoroGoal: Math.max(1, dailyPomos),
      dailyFocusGoalHours: Math.max(0.5, dailyHours),
      primaryGoalType: goalType,
      showCompletedTasks: showComp,
      confirmDelete: confirmDel,
      soundEnabled,
      completionSound: pomoSound,
      breakSound,
      volume,
      repeatSound,
      repeatCount
    });

    if (state.timerState.status === 'idle') {
      timer.syncModeDuration(state.timerState.mode);
    }
    this.renderSessionDiffPresets();
    notifier.notify('Settings Saved', 'Your timer preferences have been updated.', { type: 'success' });
  }

  renderAnalyticsModal() {
    const weeklyData = analytics.getWeeklySessionCounts();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxVal = Math.max(...weeklyData, 4);

    const barchartEl = document.getElementById('analytics-weekly-barchart');
    if (barchartEl) {
      barchartEl.innerHTML = weeklyData.map((val, idx) => {
        const pct = Math.round((val / maxVal) * 100);
        return `
          <div class="barchart-col">
            <div class="barchart-bar-wrap">
              <div class="barchart-bar" style="height: ${pct}%;" title="${val} Pomos"></div>
            </div>
            <div class="barchart-label">${days[idx]}</div>
          </div>
        `;
      }).join('');
    }

    const totalHoursEl = document.getElementById('analytics-total-hours');
    if (totalHoursEl) totalHoursEl.textContent = `${analytics.getWeeklyFocusHours().toFixed(1)}h`;

    const totalPomosEl = document.getElementById('analytics-total-pomos');
    if (totalPomosEl) totalPomosEl.textContent = analytics.getWeeklyTotalPomodoros();

    const streakValEl = document.getElementById('analytics-streak-val');
    if (streakValEl) streakValEl.textContent = `${state.streak.currentStreak}d`;

    const breakdownEl = document.getElementById('analytics-task-breakdown');
    if (breakdownEl) {
      const breakdown = analytics.getTaskFocusBreakdown();
      if (breakdown.length === 0) {
        breakdownEl.innerHTML = '<p class="subtle" style="padding: 12px 0;">No completed task sessions recorded yet.</p>';
      } else {
        breakdownEl.innerHTML = breakdown.slice(0, 5).map(item => `
          <div class="analytics-task-row">
            <span class="analytics-task-title">${this.escapeHtml(item.title)}</span>
            <span class="analytics-task-time">${Math.round(item.seconds / 60)}m</span>
          </div>
        `).join('');
      }
    }
  }
}

export const ui = new UIManager();
