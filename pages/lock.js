import { MIN_PIN_ENTRY } from '../lib/pin.js';

const screen = document.querySelector('.screen');
const dots = document.getElementById('dots');
const message = document.getElementById('message');
const keypad = document.getElementById('keypad');
const subtitle = document.getElementById('subtitle');
const recoveryForm = document.getElementById('recovery');
const recoveryInput = document.getElementById('recovery-input');
const recoveryToggle = document.getElementById('recovery-toggle');
const recoveryCancel = document.getElementById('recovery-cancel');

const MAX_PIN = 12;
let pin = '';
let busy = false;
let countdownTimer = null;

// Never let a dead service worker leave the keypad disabled -- that would strand
// the user on a lock screen with no way through. Failures come back as data.
async function send(msg) {
  try {
    const result = await chrome.runtime.sendMessage(msg);
    return result || { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/* ------------------------------------------------------------------- view */

function renderDots() {
  dots.textContent = '';
  dots.classList.toggle('empty', pin.length === 0);
  for (let i = 0; i < pin.length; i++) dots.appendChild(document.createElement('i'));
}

function say(text, kind = '') {
  message.textContent = text;
  message.className = 'msg' + (kind ? ' ' + kind : '');
}

function deny(text) {
  say(text, 'error');
  pin = '';
  renderDots();
  screen.classList.add('shake', 'denied');
  setTimeout(() => screen.classList.remove('shake'), 420);
  setTimeout(() => screen.classList.remove('denied'), 900);
}

function setBusy(on) {
  busy = on;
  keypad.querySelectorAll('button').forEach((b) => { b.disabled = on; });
}

/* -------------------------------------------------------------- countdown */

function formatWait(ms) {
  const total = Math.ceil(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function startCountdown(until) {
  clearInterval(countdownTimer);
  setBusy(true);
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      setBusy(false);
      say('You can try again now.');
      return;
    }
    say(`Too many wrong attempts. Try again in ${formatWait(left)}.`, 'error');
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ------------------------------------------------------------------ input */

function press(key) {
  if (busy) return;
  if (key === 'back') {
    pin = pin.slice(0, -1);
    renderDots();
    return;
  }
  if (key === 'enter') {
    submitPin();
    return;
  }
  if (pin.length >= MAX_PIN) return;
  pin += key;
  say('');
  renderDots();
}

async function submitPin() {
  if (busy) return;
  // Deliberately the ENTRY minimum, not the creation minimum: raising this would
  // lock out anyone still holding a PIN made before the minimum went up.
  if (pin.length < MIN_PIN_ENTRY) {
    deny(`A PIN is at least ${MIN_PIN_ENTRY} digits.`);
    return;
  }
  setBusy(true);
  const result = await send({ type: 'unlock', pin });
  setBusy(false);

  if (result && result.ok) {
    say('Unlocked.', 'ok');
    pin = '';
    renderDots();
    return; // the service worker restores this tab
  }

  pin = '';
  renderDots();

  if (result && result.reason === 'unreachable') {
    say('Lost contact with the extension. Reload this page (F5) and try again.', 'error');
  } else if (result && result.reason === 'lockout') {
    startCountdown(result.until);
  } else if (result && result.until) {
    deny('Wrong PIN.');
    startCountdown(result.until);
  } else if (result && result.reason === 'not-configured') {
    say('No PIN is set. Open the extension options to set one.', 'error');
  } else {
    deny('Wrong PIN. Try again.');
  }
}

keypad.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (button) press(button.dataset.key);
});

document.addEventListener('keydown', (event) => {
  if (!recoveryForm.hidden) return; // the recovery field owns the keyboard
  if (event.key >= '0' && event.key <= '9') {
    press(event.key);
    event.preventDefault();
  } else if (event.key === 'Backspace') {
    press('back');
    event.preventDefault();
  } else if (event.key === 'Enter') {
    press('enter');
    event.preventDefault();
  }
});

/* --------------------------------------------------------------- recovery */

function showRecovery(on) {
  recoveryForm.hidden = !on;
  keypad.hidden = on;
  dots.hidden = on;
  recoveryToggle.hidden = on;
  subtitle.textContent = on
    ? 'Enter the recovery code you saved when you set this up.'
    : 'Enter your PIN to continue.';
  say('');
  if (on) recoveryInput.focus();
}

recoveryToggle.addEventListener('click', () => showRecovery(true));
recoveryCancel.addEventListener('click', () => showRecovery(false));

recoveryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = recoveryInput.value.trim();
  if (!code) return;
  say('Checking...');
  const result = await send({ type: 'unlock', recoveryCode: code });
  if (result && result.ok) {
    say('Unlocked. Choose a new PIN in the tab that just opened.', 'ok');
    return;
  }
  recoveryInput.value = '';
  if (result && result.reason === 'unreachable') {
    say('Lost contact with the extension. Reload this page (F5) and try again.', 'error');
  } else if (result && result.reason === 'lockout') {
    say(`Too many attempts. Try again in ${formatWait(result.until - Date.now())}.`, 'error');
  } else {
    say('That recovery code is not correct.', 'error');
  }
});

/* ------------------------------------------------------------------- boot */

(async () => {
  renderDots();
  const state = await send({ type: 'state' });
  if (state.reason === 'unreachable') {
    // The worker is still waking up, or the extension was just reloaded. Leave the
    // keypad live: the unlock attempt itself will report the real problem.
    return;
  }
  if (!state.locked) {
    say('Already unlocked.', 'ok');
    return;
  }
  if (state && state.gate && state.gate.until > Date.now()) {
    startCountdown(state.gate.until);
  }
})();
