async function send(msg) {
  try {
    return (await chrome.runtime.sendMessage(msg)) || { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

import { pinProblem, pinStrength } from '../lib/pin.js';

const $ = (id) => document.getElementById(id);

const panePin = $('pane-pin');
const paneCode = $('pane-code');
const paneDone = $('pane-done');
const pinMsg = $('pin-msg');

let recoveryCode = '';

function show(pane) {
  for (const p of [panePin, paneCode, paneDone]) p.hidden = p !== pane;
  $('step1').classList.toggle('on', pane === panePin);
  $('step2').classList.toggle('on', pane !== panePin);
}

function fail(text) {
  pinMsg.textContent = text;
  pinMsg.className = 'msg error';
}

$('create').addEventListener('click', async () => {
  const pin = $('pin').value.trim();
  const confirm = $('pin2').value.trim();

  const problem = pinProblem(pin);
  if (problem) return fail(problem);
  if (pin !== confirm) return fail('The two PINs do not match.');

  pinMsg.textContent = 'Creating...';
  pinMsg.className = 'msg';

  const result = await send({ type: 'setup', pin });
  if (!result || !result.ok) {
    return fail(result && result.reason === 'already-configured'
      ? 'A PIN is already set. Open Settings to change it.'
      : 'Could not save the PIN. Try again.');
  }

  recoveryCode = result.recoveryCode;
  $('code').textContent = recoveryCode;
  show(paneCode);
});

// Live feedback on length, so the cost of a short PIN is visible while choosing.
$('pin').addEventListener('input', (event) => {
  const { label, tone } = pinStrength(event.target.value.length);
  $('pin-hint').textContent = label;
  $('pin-hint').className = 'msg' + (tone === 'good' ? ' ok' : '');
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(recoveryCode);
  $('copy').textContent = 'Copied';
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
});

$('download').addEventListener('click', () => {
  const body = [
    'Rimlock - recovery code',
    '',
    recoveryCode,
    '',
    'Created: ' + new Date().toLocaleString(),
    'Use this on the lock screen via "Forgot your PIN?".',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rimlock-recovery.txt';
  a.click();
  URL.revokeObjectURL(url);
});

$('saved').addEventListener('change', (event) => {
  $('finish').disabled = !event.target.checked;
});

$('finish').addEventListener('click', () => show(paneDone));

$('lock-now').addEventListener('click', () => send({ type: 'lockNow' }));

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

// If a PIN already exists, this page has nothing to offer.
(async () => {
  const state = await send({ type: 'state' });
  if (state && state.configured) {
    show(paneDone);
    $('step2').classList.add('on');
  }
})();
