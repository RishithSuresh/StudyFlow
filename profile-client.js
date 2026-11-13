const API_BASE = window.STUDYFLOW_API_URL
  || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');
const profileName = document.querySelector('#profile-name');
const profileEmail = document.querySelector('#profile-email');
const profileAvatar = document.querySelector('#profile-avatar');
const sidebarName = document.querySelector('#sidebar-user-name');
const sidebarEmail = document.querySelector('#sidebar-user-email');
const statsContainer = document.querySelector('#profile-stats');
const guidanceTitle = document.querySelector('#profile-guidance-title');
const guidanceCopy = document.querySelector('#profile-guidance-copy');

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Statistics could not be loaded.');
  return response.json();
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'SF';
}

function statCard(value, label, detail = '') {
  return `<div class="profile-stat panel"><strong>${value}</strong><span>${label}</span>${detail ? `<small>${detail}</small>` : ''}</div>`;
}

function renderStatistics(stats) {
  statsContainer.innerHTML = [
    statCard(`${stats.tasks.completionRate}%`, 'Task completion', `${stats.tasks.completed} of ${stats.tasks.total} tasks complete`),
    statCard(`${stats.focus.weeklyMinutes}m`, 'Focus this week', `${stats.focus.completedSessions} completed sessions overall`),
    statCard(`${stats.streak}d`, 'Current streak', stats.streak ? 'Keep the rhythm going' : 'Start a session today'),
    statCard(stats.tasks.overdue, 'Overdue tasks', stats.tasks.overdue ? 'Clear one before adding more' : 'You are on top of deadlines'),
    statCard(stats.subjects, 'Subjects', 'Active study areas'),
    statCard(stats.skills, 'Skills', 'Learning goals tracked')
  ].join('');

  if (stats.tasks.overdue > 0) {
    guidanceTitle.textContent = 'Clear overdue work first.';
    guidanceCopy.textContent = `You have ${stats.tasks.overdue} overdue task${stats.tasks.overdue === 1 ? '' : 's'}. Finish or reschedule one before planning new work.`;
  } else if (stats.focus.weeklyMinutes < 120) {
    guidanceTitle.textContent = 'Protect two focused hours this week.';
    guidanceCopy.textContent = 'Short, completed sessions build momentum more reliably than occasional long study blocks.';
  } else if (stats.tasks.completionRate < 70) {
    guidanceTitle.textContent = 'Plan fewer tasks and finish more.';
    guidanceCopy.textContent = 'Your completion rate is below 70%. Reduce daily commitments until your planned work matches your available time.';
  } else {
    guidanceTitle.textContent = 'Your rhythm is working.';
    guidanceCopy.textContent = 'Keep your task list realistic and protect the focus blocks that are driving this progress.';
  }
}

async function loadProfile() {
  try {
    const [account, stats] = await Promise.all([getJson('/me'), getJson('/statistics')]);
    const user = account.user;
    profileName.textContent = user.name;
    profileEmail.textContent = user.email;
    profileAvatar.textContent = initials(user.name);
    sidebarName.textContent = user.name;
    sidebarEmail.textContent = user.email;
    renderStatistics(stats);
  } catch (error) {
    statsContainer.innerHTML = `<div class="panel empty-state">${error.message}</div>`;
  }
}

document.querySelector('#profile-sign-out').addEventListener('click', async () => {
  const button = document.querySelector('#profile-sign-out');
  button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/auth/sign-out`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Sign out failed.');
    window.location.reload();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
});

window.addEventListener('studyflow:authenticated', loadProfile);
document.querySelector('#nav').addEventListener('click', event => {
  if (event.target.closest('[data-view="profile"]')) loadProfile();
});
