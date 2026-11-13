const API_BASE = (window.STUDYFLOW_API_URL || 'http://localhost:3000') + '/api';
const gate = document.querySelector('#auth-gate');
const form = document.querySelector('#auth-form');
const nameField = document.querySelector('#auth-name-field');
const nameInput = document.querySelector('#auth-name');
const modeButtons = [...document.querySelectorAll('[data-auth-mode]')];
const submit = document.querySelector('.auth-submit');
const error = document.querySelector('#auth-error');
const status = document.querySelector('#auth-status');
let mode = 'signin';

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function setMode(nextMode) {
  mode = nextMode;
  const signup = mode === 'signup';
  nameField.hidden = !signup;
  nameInput.required = signup;
  document.querySelector('#auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  error.hidden = true;
  modeButtons.forEach(button => button.classList.toggle('active', button.dataset.authMode === mode));
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || 'The request could not be completed.');
  return payload;
}

function showApp() {
  document.body.classList.remove('auth-pending', 'auth-required');
  gate.hidden = true;
}

function announceAuthentication(user) {
  showApp();
  window.dispatchEvent(new CustomEvent('studyflow:authenticated', { detail: { user } }));
}

function showGate(message) {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-required');
  gate.hidden = false;
  if (message) showError(message);
}

modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.authMode)));

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.hidden = true;
  submit.disabled = true;
  status.textContent = mode === 'signup' ? 'Creating your private workspace…' : 'Signing you in…';
  try {
    await request(mode === 'signup' ? '/auth/sign-up/email' : '/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email: document.querySelector('#auth-email').value.trim(),
        password: document.querySelector('#auth-password').value
      })
    });
    const session = await request('/auth/get-session');
    announceAuthentication(session.user);
  } catch (requestError) {
    showError(requestError.message);
    status.textContent = 'Your data is private to your account.';
  } finally {
    submit.disabled = false;
  }
});

async function bootstrap() {
  try {
    const session = await request('/auth/get-session');
    if (session?.user) announceAuthentication(session.user);
    else showGate();
  } catch (requestError) {
    showGate('Connect the StudyFlow server to continue.');
    status.textContent = requestError.message;
  }
}

setMode(mode);
bootstrap();
