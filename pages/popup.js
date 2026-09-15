async function send(msg) {
  try {
    return (await chrome.runtime.sendMessage(msg)) || { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

const $ = (id) => document.getElementById(id);

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

(async () => {
  const state = await send({ type: 'state' });

  if (!state || !state.configured) {
    $('pip').classList.add('locked');
    $('label').textContent = 'Not set up';
    $('detail').textContent = 'No PIN yet';
    $('lock').textContent = 'Set a PIN';
    $('lock').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') });
      window.close();
    });
    return;
  }

  $('pip').classList.toggle('locked', state.locked);
  $('label').textContent = state.locked ? 'Locked' : 'Unlocked';
  $('detail').textContent = state.settings.lockOnStartup
    ? 'Locks on browser startup'
    : 'Startup lock is off';
  $('lock').disabled = state.locked;
  $('lock').addEventListener('click', async () => {
    await send({ type: 'lockNow' });
    window.close();
  });
})();
