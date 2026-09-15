async function send(msg) {
  try {
    return (await chrome.runtime.sendMessage(msg)) || { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

import { pinProblem } from '../lib/pin.js';

const $ = (id) => document.getElementById(id);

function note(el, text, kind = '') {
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}



/* ----------------------------------------------------------------- status */

async function refresh() {
  const state = await send({ type: 'state' });
  if (!state) return;

  if (state.reason === 'unreachable') {
    // Never imply the browser is unprotected just because the worker was asleep.
    $('status').textContent = 'Could not reach the extension. Reload this page.';
    return;
  }
  // With no PIN stored there is nothing to change, and every PIN field would just
  // report "wrong" against a vault that does not exist. Offer setup instead.
  const needsPin = document.querySelectorAll('[data-needs-pin]');
  $('setup-card').hidden = state.configured;
  needsPin.forEach((el) => { el.hidden = !state.configured; });

  if (!state.configured) {
    $('status').textContent = 'No PIN is set. Your browser is not protected.';
    return;
  }
  $('status').textContent = state.locked
    ? 'Currently locked.'
    : 'Unlocked. Protection is active.';

  $('incognito-card').hidden = Boolean(state.incognitoAllowed);

  $('opt-startup').checked = state.settings.lockOnStartup;
  $('opt-idle').checked = state.settings.lockOnIdle;
  $('opt-minutes').value = state.settings.idleMinutes;
  $('opt-minutes').disabled = !state.settings.lockOnIdle;
}

$('opt-idle').addEventListener('change', (event) => {
  $('opt-minutes').disabled = !event.target.checked;
});

/* --------------------------------------------------------------- settings */

$('save-settings').addEventListener('click', async () => {
  const settings = {
    lockOnStartup: $('opt-startup').checked,
    lockOnIdle: $('opt-idle').checked,
    idleMinutes: Number($('opt-minutes').value) || 10,
  };
  const result = await send({ type: 'saveSettings', settings });
  if (result && result.ok) {
    $('opt-minutes').value = result.settings.idleMinutes;
    note($('settings-msg'), 'Saved.', 'ok');
  } else {
    note($('settings-msg'), 'Could not save.', 'error');
  }
});

$('lock-now').addEventListener('click', () => send({ type: 'lockNow' }));

/* ------------------------------------------------------------- change pin */

$('change-pin').addEventListener('click', async () => {
  const currentPin = $('cur-pin').value.trim();
  const newPin = $('new-pin').value.trim();
  const confirm = $('new-pin2').value.trim();

  const problem = pinProblem(newPin);
  if (problem) return note($('pin-msg'), problem, 'error');
  if (newPin !== confirm) return note($('pin-msg'), 'The two new PINs do not match.', 'error');

  const result = await send({ type: 'changePin', currentPin, newPin });
  if (result && result.ok) {
    ['cur-pin', 'new-pin', 'new-pin2'].forEach((id) => { $(id).value = ''; });
    note($('pin-msg'), 'PIN changed.', 'ok');
  } else {
    note($('pin-msg'), result && result.reason === 'bad-pin'
      ? 'Current PIN is wrong.' : 'Could not change the PIN.', 'error');
  }
});

/* ---------------------------------------------------------- recovery code */

$('new-code').addEventListener('click', async () => {
  const currentPin = $('code-pin').value.trim();
  const result = await send({ type: 'newRecoveryCode', currentPin });
  if (result && result.ok) {
    $('code-pin').value = '';
    $('code-out').textContent = result.recoveryCode;
    $('code-out').hidden = false;
    note($('code-msg'), 'Write this down now. It will not be shown again.', 'ok');
  } else {
    note($('code-msg'), 'Current PIN is wrong.', 'error');
  }
});

/* --------------------------------------------------------- remove / reset */

$('remove').addEventListener('click', async () => {
  const currentPin = $('remove-pin').value.trim();
  const result = await send({ type: 'removeProtection', currentPin });
  if (result && result.ok) {
    $('remove-pin').value = '';
    note($('remove-msg'), 'Protection removed.', 'ok');
    refresh();
  } else {
    note($('remove-msg'), 'Current PIN is wrong.', 'error');
  }
});

$('reset-save').addEventListener('click', async () => {
  const newPin = $('reset-pin').value.trim();
  const confirm = $('reset-pin2').value.trim();

  const problem = pinProblem(newPin);
  if (problem) return note($('reset-msg'), problem, 'error');
  if (newPin !== confirm) return note($('reset-msg'), 'The two PINs do not match.', 'error');

  const result = await send({ type: 'resetPin', newPin });
  if (result && result.ok) {
    $('reset-pin').value = '';
    $('reset-pin2').value = '';
    note($('reset-msg'), 'New PIN saved. Generate a fresh recovery code below.', 'ok');
    $('reset-card').hidden = true;
  } else {
    note($('reset-msg'), 'Could not set the PIN.', 'error');
  }
});

// The hash can arrive after load -- if this page was already open, Chrome focuses
// the existing tab instead of reloading it -- so react to both cases.
function applyHash() {
  if (location.hash !== '#reset') return;
  $('reset-card').hidden = false;
  $('reset-pin').focus();
}

window.addEventListener('hashchange', applyHash);
applyHash();

$('open-details').addEventListener('click', () => {
  // The extension's own details page, where the incognito toggle lives.
  chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
});

$('go-setup').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') });
});

refresh();
