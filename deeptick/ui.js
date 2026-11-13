/* ==========================================================================
   DeepTick Pomodoro - UI Renderer & Interaction Controller (Minimalist)
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
  }

  init() {
    this.applyTheme(state.settings.theme || 'navy');
    this.bindEvents();
    this.renderAll();
    this.initConfettiCanvas();
  }

  applyTheme(themeName) {
    const activeTheme = ['navy', 'sand', 'midnight'].includes(themeName) ? themeName : 'navy';
    document.documentElement.setAttribute('data-theme', activeTheme);
    const themeIconEl = document.getElementById('theme-btn-icon');
    if (themeIconEl) {
      if (activeTheme === 'sand') themeIconEl.textContent = '◇';
      else if (activeTheme === 'midnight') themeIconEl.textContent = '◆';
      else themeIconEl.textContent = '◈';
    }
    this.syncModeColors();
  }

  syncModeColors() {
    const { mode } = state.timerState;
    const root = document.documentElement;

    if (mode === 'short_break') {
      root.style.setProperty('--theme-bg', 'var(--color-short-bg)');
      root.style.setProperty('--theme-card', 'var(--color-short-card)');
      root.style.setProperty('--theme-card-hover', 'var(--color-short-card-hover)');
      root.style.setProperty('--theme-btn-text', 'var(--color-short-btn-text)');
      root.style.setProperty('--theme-accent', 'var(--color-short-accent)');
    } else if (mode === 'long_break') {
      root.style.setProperty('--theme-bg', 'var(--color-long-bg)');
      root.style.setProperty('--theme-card', 'var(--color-long-card)');
      root.style.setProperty('--theme-card-hover', 'var(--color-long-card-hover)');
      root.style.setProperty('--theme-btn-text', 'var(--color-long-btn-text)');
      root.style.setProperty('--theme-accent', 'var(--color-long-accent)');
    } else {
      root.style.setProperty('--theme-bg', 'var(--color-pomo-bg)');
      root.style.setProperty('--theme-card', 'var(--color-pomo-card)');
      root.style.setProperty('--theme-card-hover', 'var(--color-pomo-card-hover)');
      root.style.setProperty('--theme-btn-text', 'var(--color-pomo-btn-text)');
      root.style.setProperty('--theme-accent', 'var(--color-pomo-accent)');
    }

    const currentBg = getComputedStyle(root).getPropertyValue('--theme-bg').trim();
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor && currentBg) {
      metaThemeColor.setAttribute('content', currentBg);
    }
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

    const modeLabel = mode === 'pomodoro' ? 'Time to focus!' : mode === 'short_break' ? 'Time for a break!' : 'Time for a long rest!';
    const taskTitle = activeTask ? ` - ${activeTask.title}` : '';
    document.title = `${status === 'running' ? '▶ ' : ''}${timeFormatted} - ${modeLabel}${taskTitle}`;

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

    // Start / Pause Big Button
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
      activeTaskName.textContent = activeTask ? activeTask.title : 'General Focus Session';
    }

    const cycleInfo = document.getElementById('header-cycle-count');
    const interval = settings.longBreakInterval || 4;
    if (cycleInfo) {
      cycleInfo.textContent = `#${cycleCount} of ${interval} focus sessions`;
    }

    // Streak
    const streakEl = document.getElementById('header-streak-count');
    if (streakEl) streakEl.textContent = `${state.streak.currentStreak}d`;
  }

  // 2. Tasks Render
  renderTasks() {
    const listContainer = document.getElementById('tasks-list');
    if (!listContainer) return;

    const tasks = taskManager.getTasks();
    const activeTaskId = state.timerState.activeTaskId;

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div class="tasks-empty-state">
          No tasks added yet. Click <strong>+ Add Task</strong> to get started!
        </div>
      `;
      return;
    }

    listContainer.innerHTML = tasks.map(task => {
      const isActive = task.id === activeTaskId;
      const isOver = task.completedPomodoros > task.estimatedPomodoros;
      const excessCount = task.completedPomodoros - task.estimatedPomodoros;

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
            <span class="task-pomos-badge">${task.completedPomodoros} / ${task.estimatedPomodoros}</span>
            ${isOver ? `<span class="task-excess-pill">+${excessCount}</span>` : ''}
            <div class="task-actions-group">
              <button class="task-action-btn task-edit-btn" data-action="edit-task" data-task-id="${task.id}" title="Edit Task" aria-label="Edit Task">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="task-action-btn task-delete-btn" data-action="delete-task" data-task-id="${task.id}" title="Delete Task" aria-label="Delete Task">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. Stats & Estimated Finish Time Render
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

  // 4. Settings Form Population
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

    this.setInputValue('setting-theme', settings.theme);
  }

  setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
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
      if (streakEl) streakEl.textContent = `${state.streak.currentStreak}d`;
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
      });
    });

    // Primary Controls
    const btnToggle = document.getElementById('btn-timer-toggle');
    if (btnToggle) btnToggle.addEventListener('click', () => timer.toggle());

    const btnReset = document.getElementById('btn-timer-reset');
    if (btnReset) btnReset.addEventListener('click', () => timer.reset());

    const btnSkip = document.getElementById('btn-timer-skip');
    if (btnSkip) btnSkip.addEventListener('click', () => timer.skip());

    // +/- Quick adjustments
    document.querySelectorAll('.adjust-btn, .adjust-side-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const delta = parseInt(e.currentTarget.dataset.adjust, 10);
        timer.adjustTime(delta);
      });
    });

    // Task List Click Events
    const taskList = document.getElementById('tasks-list');
    if (taskList) {
      taskList.addEventListener('click', (e) => {
        const target = e.target;
        const taskItem = target.closest('.task-item');
        if (!taskItem) return;
        const taskId = taskItem.dataset.taskId;

        if (target.classList.contains('task-check-circle') || target.dataset.action === 'toggle-complete') {
          e.stopPropagation();
          taskManager.toggleComplete(taskId);
          return;
        }

        const editBtn = target.closest('[data-action="edit-task"]');
        if (editBtn) {
          e.stopPropagation();
          this.openTaskModal(taskId);
          return;
        }

        const deleteBtn = target.closest('[data-action="delete-task"]');
        if (deleteBtn) {
          e.stopPropagation();
          this.handleDeleteTask(taskId);
          return;
        }

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
          notifier.notify('Info', 'No tasks to clear.');
          return;
        }

        if (state.settings.confirmDelete) {
          const confirmed = window.confirm('Are you sure you want to clear all tasks from the queue?');
          if (!confirmed) return;
        }

        const count = taskManager.clearAllTasks();
        notifier.notify('All Tasks Cleared', `${count} task${count > 1 ? 's' : ''} removed from queue.`, { type: 'warn' });
      });
    }

    // Modal Triggers
    this.bindModalTriggers();
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

    // Quick Header Theme Toggle Button
    const btnToggleTheme = document.getElementById('btn-toggle-theme');
    if (btnToggleTheme) {
      btnToggleTheme.addEventListener('click', () => {
        const current = state.settings.theme || 'navy';
        const themes = ['navy', 'sand', 'midnight'];
        const nextIndex = (themes.indexOf(current) + 1) % themes.length;
        const nextTheme = themes[nextIndex];
        state.updateSettings({ theme: nextTheme });
        this.applyTheme(nextTheme);
        const nameMap = { navy: 'Navy & Coral', sand: 'Warm Sand', midnight: 'Deep Midnight' };
        notifier.notify('Theme Switched', nameMap[nextTheme] || nextTheme);
      });
    }

    // Theme selector inside settings modal
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        const selected = e.currentTarget.value;
        state.updateSettings({ theme: selected });
        this.applyTheme(selected);
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
      if (titleEl) titleEl.textContent = 'What are you working on?';
      if (btnDeleteModal) btnDeleteModal.style.display = 'none';
      document.getElementById('task-input-priority').value = 'medium';
      document.getElementById('task-input-pomos').value = '2';
      document.getElementById('task-input-mins').value = 2 * pomoDuration;
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
      notifier.notify('Task Updated', `"${title}" has been updated.`);
    } else {
      taskManager.createTask({
        title,
        description,
        priority,
        estimatedPomodoros,
        estimatedMinutes
      });
      notifier.notify('Task Created', `"${title}" added to queue.`, { type: 'success' });
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
    const theme = document.getElementById('setting-theme').value;

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
      repeatCount,
      theme
    });

    this.applyTheme(theme);
    notifier.notify('Settings Saved', 'Your timer preferences have been updated.', { type: 'success' });
  }

  renderAnalyticsModal() {
    const weekly = analytics.getWeeklyStats();
    const taskBreakdown = analytics.getTaskBreakdown();

    const totalPomosEl = document.getElementById('analytics-total-pomos');
    if (totalPomosEl) totalPomosEl.textContent = weekly.totalWeeklyPomos;

    const totalHoursEl = document.getElementById('analytics-total-hours');
    if (totalHoursEl) totalHoursEl.textContent = `${weekly.totalWeeklyHours}h`;

    const streakValEl = document.getElementById('analytics-streak-val');
    if (streakValEl) streakValEl.textContent = `${state.streak.currentStreak}d`;

    // 7-day Bar Chart
    const barContainer = document.getElementById('analytics-weekly-barchart');
    if (barContainer) {
      const maxPomos = Math.max(1, ...weekly.days.map(d => d.pomodoros));
      barContainer.innerHTML = weekly.days.map(d => {
        const heightPercent = Math.max(8, Math.round((d.pomodoros / maxPomos) * 100));
        return `
          <div class="bar-col" title="${d.date}: ${d.pomodoros} Pomodoros (${d.focusMinutes}m)">
            <div class="bar-fill" style="height: ${heightPercent}%;"></div>
            <span class="bar-lbl">${d.dayName}</span>
          </div>
        `;
      }).join('');
    }

    // Task Breakdown
    const breakdownContainer = document.getElementById('analytics-task-breakdown');
    if (breakdownContainer) {
      if (taskBreakdown.length === 0) {
        breakdownContainer.innerHTML = `<div style="color: var(--text-modal-muted); font-size: 0.85rem; padding: 0.5rem 0;">No completed task sessions yet.</div>`;
      } else {
        const totalMinutes = taskBreakdown.reduce((acc, t) => acc + t.minutes, 0) || 1;
        breakdownContainer.innerHTML = taskBreakdown.slice(0, 5).map(t => {
          const pct = Math.round((t.minutes / totalMinutes) * 100);
          return `
            <div style="margin-bottom: 0.65rem;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.2rem;">
                <span>${this.escapeHtml(t.title)}</span>
                <span style="font-family: var(--font-mono); color: var(--text-modal-muted);">${t.count} Pomo (${t.minutes}m)</span>
              </div>
              <div style="height: 5px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: #222222;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }
}

export const ui = new UIManager();
