import {
  generateSalt,
  deriveHash,
  constantTimeEqual,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from './lib/crypto.js';
import { pinProblem } from './lib/pin.js';

const LOCK_PAGE = chrome.runtime.getURL('pages/lock.html');
const BLOCK_RULE_ID = 1;   // persistent dynamic rule: redirect everything to the lock page
const ALLOW_RULE_ID = 1;   // session rule: higher priority pass-through while unlocked
// Raised from 310k. Each vault records the count it was built with, so existing
// PINs keep verifying with their own value and only new ones pay the extra cost.
const ITERATIONS = 600000;
// Bump whenever the block rule's definition changes, so a stale persisted rule
// from an older version gets replaced instead of silently kept.
const RULE_VERSION = 2;
const SWEEP_ALARM = 'rimlock-sweep';

const DEFAULT_SETTINGS = {
  lockOnStartup: true,
  lockOnIdle: false,
  idleMinutes: 10,
};

/* ------------------------------------------------------------------ state */

async function getVault() {
  const { vault } = await chrome.storage.local.get('vault');
  return vault || null;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getGate() {
  const { gate } = await chrome.storage.local.get('gate');
  return { fails: 0, until: 0, ...(gate || {}) };
}

async function setGate(gate) {
  await chrome.storage.local.set({ gate });
}

async function isConfigured() {
  return (await getVault()) !== null;
}

// `unlocked` lives in session storage, which Chrome clears on every browser
// restart. So "no answer" always means locked -- failing closed is the point.
async function isLocked() {
  if (!(await isConfigured())) return false;
  const { unlocked } = await chrome.storage.session.get('unlocked');
  return unlocked !== true;
}

/* -------------------------------------------------------- network blocking */

// The block rule is a *dynamic* rule, so it survives a browser restart and is
// already in force before the first tab loads. The pass-through is a *session*
// rule, which Chrome throws away on restart -- that asymmetry is what makes the
// lock hold during the few hundred milliseconds before onStartup fires.
async function armBlocking() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const present = rules.some((r) => r.id === BLOCK_RULE_ID);
  // Dynamic rules survive an extension reload, so an existing rule may be an OLD
  // definition. Without this version check the rule is never upgraded and the
  // extension silently keeps running last version's behaviour.
  const { ruleVersion } = await chrome.storage.local.get('ruleVersion');
  if (present && ruleVersion === RULE_VERSION) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [BLOCK_RULE_ID],
    addRules: [
      {
        id: BLOCK_RULE_ID,
        priority: 1,
        // `\0` is the whole matched URL: the lock page carries the address it replaced,
        // so a tab can still be restored after its window is closed.
        action: { type: 'redirect', redirect: { regexSubstitution: LOCK_PAGE + '?from=\\0' } },
        condition: { regexFilter: '^https?://.+', resourceTypes: ['main_frame'] },
      },
    ],
  });
  await chrome.storage.local.set({ ruleVersion: RULE_VERSION });
}

async function disarmBlocking() {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [BLOCK_RULE_ID] });
}

async function setPassThrough(on) {
  if (on) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ALLOW_RULE_ID],
      addRules: [
        {
          id: ALLOW_RULE_ID,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: '|http', resourceTypes: ['main_frame'] },
        },
      ],
    });
  } else {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ALLOW_RULE_ID] });
  }
}

/* ------------------------------------------------------------------- tabs */

function isLockPage(url) {
  return typeof url === 'string' && url.startsWith(LOCK_PAGE);
}

const RESTORABLE = /^(https?|file):/i;
// The landing page of a freshly opened window, across Chromium forks.
const NEW_TAB_PAGE = /^(?:[a-z-]+:\/\/(?:newtab|new-tab-page)\/?|about:blank\/?|about:newtab\/?)$/i;

// Recovers the address a lock page replaced, whichever route put it there: the
// DNR rule appends the raw URL, guardTab appends an encoded one.
function originalUrlOf(url) {
  const i = url.indexOf('?from=');
  if (i === -1) return null;
  const raw = url.slice(i + 6);
  try {
    const decoded = decodeURIComponent(raw);
    if (RESTORABLE.test(decoded)) return decoded;
  } catch {
    // Not percent-encoded; fall through to the raw form.
  }
  return RESTORABLE.test(raw) ? raw : null;
}

// What this tab should reopen as, or null if it isn't worth restoring.
function tabRecord(tab) {
  const url = tab.url || tab.pendingUrl || '';
  const target = isLockPage(url) ? originalUrlOf(url) : (RESTORABLE.test(url) ? url : null);
  return target ? { url: target, pinned: Boolean(tab.pinned), active: Boolean(tab.active) } : null;
}

// A tab Brave restored but never loaded holds nothing in memory and renders nothing.
function isUnloaded(tab) {
  return tab.discarded === true || tab.status === 'unloaded';
}

async function guardTab(tab) {
  if (!tab || tab.id == null || tab.id === chrome.tabs.TAB_ID_NONE) return;
  const url = tab.url || tab.pendingUrl || '';
  if (isLockPage(url)) return;
  // Nothing to hide on an unloaded tab, and redirecting it would FORCE it to load --
  // destroying exactly the lazy restore that makes a 20-tab session open instantly.
  // Left alone it stays unloaded, and the moment anyone actually opens it the
  // network rule redirects it to the lock page like any other navigation.
  if (isUnloaded(tab)) return;
  const carry = RESTORABLE.test(url) ? '?from=' + encodeURIComponent(url) : '';
  try {
    await chrome.tabs.update(tab.id, { url: LOCK_PAGE + carry });
  } catch {
    // Tab closed mid-flight, or a surface the extension may not navigate.
  }
}

async function redirectOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(guardTab));
}

/* ------------------------------------------------------- session snapshot */

// The snapshot lives in *local* storage, not session: windows are about to be
// closed, so it has to survive a crash or a restart or the tabs are gone.
async function getRestore() {
  const { restore } = await chrome.storage.local.get('restore');
  return restore || null;
}

// Which live windows are already represented in the snapshot. Without this, a window
// captured by snapshotWindows() gets recorded a second time when onCreated absorbs
// it, and the session comes back duplicated.
async function getCaptured() {
  const { capturedWindows } = await chrome.storage.session.get('capturedWindows');
  return new Set(capturedWindows || []);
}

async function markCaptured(windowIds) {
  const captured = await getCaptured();
  for (const id of windowIds) captured.add(id);
  await chrome.storage.session.set({ capturedWindows: [...captured] });
}

// Only snapshots when nothing is already waiting to be restored, so a second
// lock (or a restart while locked) cannot overwrite the real session.
async function snapshotWindows() {
  const wins = await chrome.windows.getAll({ populate: true });

  // A snapshot is already waiting (locked at shutdown, or locked twice). Its contents
  // stand; just mark what is on screen as accounted for so nothing re-records it.
  if (await getRestore()) {
    await markCaptured(wins.filter((w) => w.type === 'normal').map((w) => w.id));
    return;
  }

  const windows = [];
  const ids = [];
  for (const win of wins) {
    if (win.type !== 'normal') continue;
    const tabs = (win.tabs || []).map(tabRecord).filter(Boolean);
    ids.push(win.id);
    if (tabs.length) windows.push({ state: win.state === 'fullscreen' ? 'maximized' : win.state, tabs });
  }
  if (windows.length) await chrome.storage.local.set({ restore: { windows, savedAt: Date.now() } });
  await markCaptured(ids);
}

async function restoreWindows(alreadyOpen = new Set()) {
  const restore = await getRestore();
  const windows = (restore && restore.windows) || [];

  // Last line of defence against duplicates: two entries holding the same tabs in
  // the same order are the same window recorded twice, whatever produced them.
  // Seeded with windows revived in place, so those are not rebuilt a second time.
  const seen = new Set(alreadyOpen);
  const unique = [];
  for (const entry of windows) {
    if (!entry.tabs || !entry.tabs.length) continue;
    const signature = entry.tabs.map((t) => t.url).join('\n');
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(entry);
  }

  for (const entry of unique) {
    try {
      const created = await chrome.windows.create({
        url: entry.tabs.map((t) => t.url),
        focused: true,
        state: entry.state === 'minimized' ? 'normal' : entry.state || 'normal',
      });

      const tabs = created.tabs || [];
      let activeIndex = entry.tabs.findIndex((t) => t.active);
      if (activeIndex < 0 || activeIndex >= tabs.length) activeIndex = 0;

      tabs.forEach((tab, i) => {
        if (entry.tabs[i] && entry.tabs[i].pinned) {
          chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
        }
      });
      if (tabs[activeIndex]) {
        chrome.tabs.update(tabs[activeIndex].id, { active: true }).catch(() => {});
      }
      // Deliberately no chrome.tabs.discard() here: discarding a tab that is still
      // loading leaves it stranded on about:blank.
    } catch {
      // One bad window must not strand the rest of the session.
    }
  }

  // Only conjure an empty window if the unlock would otherwise leave nothing.
  if (!unique.length && !alreadyOpen.size) {
    try { await chrome.windows.create({}); } catch {}
  }
  await chrome.storage.local.remove('restore');
  await chrome.storage.session.remove('capturedWindows');
}

/* ------------------------------------------------------------ lock/unlock */

async function paintBadge(locked) {
  try {
    await chrome.action.setBadgeText({ text: locked ? 'LOCK' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#c2352b' });
  } catch {
    // Badge is cosmetic; never let it break the lock.
  }
}

/* ------------------------------------------------------------ lock window */

// A `popup` window has no editable address bar, so there is no omnibox to type
// into and no autocomplete dropdown leaking history. That is the whole reason the
// lock screen gets its own window instead of just taking over tabs.
let creatingLockWindow = false;

// Passing `state` to windows.create() is advisory -- Brave accepts it without error
// and still hands back a small popup. Setting it afterwards actually takes effect,
// and the result says whether it did, so a refusal can fall through to maximized.
async function fillScreen(windowId) {
  for (const state of ['fullscreen', 'maximized']) {
    try {
      const win = await chrome.windows.update(windowId, { state });
      if (win && win.state === state) return;
    } catch {
      // This state is unsupported here; try the next one.
    }
  }
}

async function getLockWindowId() {
  const { lockWindowId } = await chrome.storage.session.get('lockWindowId');
  return lockWindowId == null ? null : lockWindowId;
}

async function ensureLockWindow() {
  const existing = await getLockWindowId();
  if (existing != null) {
    try {
      await chrome.windows.get(existing);
      await chrome.windows.update(existing, { focused: true });
      // It may have been minimised or restored down since it was created.
      await fillScreen(existing);
      return existing;
    } catch {
      await chrome.storage.session.remove('lockWindowId');
    }
  }

  creatingLockWindow = true;
  try {
    const win = await chrome.windows.create({ url: LOCK_PAGE, type: 'popup', focused: true });
    await chrome.storage.session.set({ lockWindowId: win.id });
    await fillScreen(win.id);
    return win.id;
  } catch {
    return null;
  } finally {
    creatingLockWindow = false;
  }
}

async function isLockWindow(windowId) {
  return windowId != null && windowId === (await getLockWindowId());
}

// Closing a multi-tab window with chrome.windows.remove() makes Brave/Chrome raise
// its "Close all tabs?" confirmation and wait for a human to click it, so the window
// just sits there. Removing the tabs closes the window without asking.
async function closeWindow(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const ids = tabs.map((t) => t.id).filter((id) => id != null);
    if (ids.length) {
      await chrome.tabs.remove(ids);
      return;
    }
  } catch {
    // Fall through to the window-level close.
  }
  try { await chrome.windows.remove(windowId); } catch {}
}

// Windows are hidden, never closed. Brave's own session -- tab history, pinned
// state, scroll position, the lot -- stays intact, because nothing about it is
// destroyed and nothing has to be rebuilt. The tabs are pointed at the lock page
// so no content shows if a window is ever surfaced; the address each tab came from
// rides along in ?from= and is put back on unlock.
async function hideWindow(win) {
  const tabs = win.tabs || (await chrome.tabs.query({ windowId: win.id }));
  for (const tab of tabs) await guardTab(tab);
  try {
    await chrome.windows.update(win.id, { state: 'minimized' });
  } catch {
    // Window vanished mid-flight.
  }
}

// Remembers how each window looked before it was minimised, so unlock can put it
// back the way it was rather than flattening everything to a default window.
async function hideNonLockWindows() {
  const lockWindowId = await getLockWindowId();
  const wins = await chrome.windows.getAll({ populate: true });
  const { windowStates } = await chrome.storage.session.get('windowStates');
  const states = { ...(windowStates || {}) };

  for (const win of wins) {
    if (win.id === lockWindowId || win.type !== 'normal') continue;
    if (states[win.id] == null) {
      states[win.id] = win.state === 'minimized' ? 'normal' : win.state || 'normal';
    }
    await hideWindow(win);
  }
  await chrome.storage.session.set({ windowStates: states });
}

async function unhideWindows(lockWindowId) {
  const { windowStates } = await chrome.storage.session.get('windowStates');
  const states = windowStates || {};
  const wins = await chrome.windows.getAll({});
  for (const win of wins) {
    if (win.id === lockWindowId || win.type !== 'normal') continue;
    try {
      await chrome.windows.update(win.id, { state: states[win.id] || 'normal', focused: true });
    } catch {
      // Window gone; nothing to restore.
    }
  }
  await chrome.storage.session.remove('windowStates');
}

// Points every lock page back at the address it replaced. Windows are never closed
// here -- a tab that cannot be recovered is dropped on its own, so one dead tab
// cannot take a whole window of live ones with it.
async function reviveLockWindows(lockWindowId) {
  const signatures = new Set();
  const doomed = [];
  const wins = await chrome.windows.getAll({ populate: true });

  for (const win of wins) {
    if (win.id === lockWindowId) continue;
    const tabs = win.tabs || [];
    const lockTabs = tabs.filter((t) => isLockPage(t.url || t.pendingUrl || ''));
    if (!lockTabs.length) continue;

    const revivable = lockTabs
      .map((tab) => ({ tab, url: originalUrlOf(tab.url || tab.pendingUrl || '') }))
      .filter((entry) => entry.url);

    // Nothing in this window can be put back -- it holds only dead lock pages, so
    // keeping it would just park a useless tab on screen AND suppress the snapshot
    // fallback. Let it go and let the snapshot rebuild what was there.
    if (!revivable.length && lockTabs.length === tabs.length) {
      doomed.push(win.id);
      continue;
    }

    const recovered = [];
    for (const { tab, url } of revivable) {
      try {
        await chrome.tabs.update(tab.id, { url });
        recovered.push(url);
      } catch {
        // Tab already gone.
      }
    }
    // Drop the unrecoverable strays; a revived tab is keeping the window alive.
    for (const tab of lockTabs) {
      if (revivable.some((entry) => entry.tab.id === tab.id)) continue;
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
    if (recovered.length) signatures.add(recovered.join('\n'));
  }
  return { signatures, doomed };
}

// Closes windows, but never the last one -- that would quit the browser.
async function closeWindowsSafely(ids) {
  if (!ids.length) return;
  const all = await chrome.windows.getAll({});
  const survivors = all.filter((w) => !ids.includes(w.id));
  const closable = survivors.length ? ids : ids.slice(1);
  for (const id of closable) {
    await closeWindow(id);
  }
}

async function enforceLockSurface() {
  await ensureLockWindow();
  await hideNonLockWindows();
}

async function lock() {
  if (!(await isConfigured())) return;
  await chrome.storage.session.set({ unlocked: false });
  // Block first so nothing keeps loading behind the lock screen, then take the
  // address bars away. hideNonLockWindows() does the redirecting, per window, so
  // each window is blanked and minimised together rather than in two sweeps.
  await armBlocking();
  await setPassThrough(false);
  // A record of what was open, purely as a fallback if windows disappear anyway
  // (a crash, a stray close). The normal unlock path never reads it.
  await snapshotWindows();
  await ensureLockWindow();
  await hideNonLockWindows();
  await paintBadge(true);
}

async function unlock() {
  await chrome.storage.session.set({ unlocked: true });
  const settings = await getSettings();
  // Keep the redirect rule staged for the next restart only if it is wanted.
  if (settings.lockOnStartup && (await isConfigured())) {
    await armBlocking();
  } else {
    await disarmBlocking();
  }
  await setPassThrough(true);

  const lockWindowId = await getLockWindowId();
  // Point every lock page back where it came from, then bring the windows back up.
  const { signatures, doomed } = await reviveLockWindows(lockWindowId);
  await unhideWindows(lockWindowId);

  // Anything left on screen once the dead windows are discounted?
  const live = (await chrome.windows.getAll({}))
    .filter((w) => w.type === 'normal' && w.id !== lockWindowId && !doomed.includes(w.id));

  // Rebuilding from the snapshot is a last resort: it loses tab history and scroll
  // position, so it only runs when there is genuinely nothing left to revive. It
  // runs BEFORE the dead windows are closed -- closeWindowsSafely() refuses to close
  // the last window, so something real has to exist first or nothing would close.
  if (live.length) {
    await chrome.storage.local.remove('restore');
    await chrome.storage.session.remove('capturedWindows');
  } else {
    await restoreWindows(signatures);
  }

  // Dead windows and the lock popup go last, once something else is on screen.
  await closeWindowsSafely(doomed);
  await closeWindowsSafely(lockWindowId != null ? [lockWindowId] : []);
  await chrome.storage.session.remove('lockWindowId');
  await paintBadge(false);
}

/* ------------------------------------------------------------ credentials */

async function createVault(pin) {
  const salt = generateSalt();
  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();
  const vault = {
    salt,
    iterations: ITERATIONS,
    pinHash: await deriveHash(pin, salt, ITERATIONS),
    recoverySalt,
    recoveryHash: await deriveHash(normalizeRecoveryCode(recoveryCode), recoverySalt, ITERATIONS),
    createdAt: Date.now(),
  };
  await chrome.storage.local.set({ vault });
  await setGate({ fails: 0, until: 0 });
  return recoveryCode;
}

async function checkPin(pin) {
  const vault = await getVault();
  if (!vault) return false;
  const hash = await deriveHash(pin, vault.salt, vault.iterations);
  return constantTimeEqual(hash, vault.pinHash);
}

async function checkRecovery(code) {
  const vault = await getVault();
  if (!vault || !vault.recoveryHash) return false;
  const hash = await deriveHash(normalizeRecoveryCode(code), vault.recoverySalt, vault.iterations);
  return constantTimeEqual(hash, vault.recoveryHash);
}

// Wrong guesses get progressively more expensive, and the counter lives in
// local storage so restarting the browser does not reset it.
function nextLockout(fails) {
  if (fails < 3) return 0;
  return Date.now() + Math.min(30000 * 2 ** (fails - 3), 900000);
}

async function attemptUnlock({ pin, recoveryCode }) {
  if (!(await isConfigured())) return { ok: false, reason: 'not-configured' };

  const gate = await getGate();
  if (gate.until > Date.now()) {
    return { ok: false, reason: 'lockout', until: gate.until, fails: gate.fails };
  }

  const good = recoveryCode ? await checkRecovery(recoveryCode) : await checkPin(pin);
  if (good) {
    await setGate({ fails: 0, until: 0 });
    if (recoveryCode) await chrome.storage.session.set({ recoveryUsed: true });
    await unlock();
    if (recoveryCode) {
      // A used recovery code is spent -- force the user straight into a reset.
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html#reset') });
    }
    return { ok: true, viaRecovery: Boolean(recoveryCode) };
  }

  const fails = gate.fails + 1;
  const until = nextLockout(fails);
  await setGate({ fails, until });
  return { ok: false, reason: recoveryCode ? 'bad-code' : 'bad-pin', fails, until };
}

/* --------------------------------------------------------------- settings */

async function applySettings(settings) {
  await chrome.storage.local.set({ settings });
  try {
    chrome.idle.setDetectionInterval(Math.max(15, Math.round(settings.idleMinutes * 60)));
  } catch {
    // Older builds clamp this differently; not worth failing over.
  }
  if (!(await isLocked())) {
    if (settings.lockOnStartup && (await isConfigured())) await armBlocking();
    else await disarmBlocking();
  }
}

/* --------------------------------------------------------------- messages */

const handlers = {
  async state() {
    // Extensions are off in incognito by default, which leaves Ctrl+Shift+N as an
    // unguarded window with a live omnibox. Only the user can grant this, so the
    // settings page has to ask for it.
    let incognitoAllowed = false;
    try {
      incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
    } catch {
      // API unavailable on this build; report it as not granted.
    }
    return {
      configured: await isConfigured(),
      locked: await isLocked(),
      settings: await getSettings(),
      gate: await getGate(),
      incognitoAllowed,
    };
  },

  async setup({ pin }) {
    if (await isConfigured()) return { ok: false, reason: 'already-configured' };
    const problem = pinProblem(pin);
    if (problem) return { ok: false, reason: 'bad-pin-format', problem };
    const recoveryCode = await createVault(pin);
    await applySettings(await getSettings());
    await unlock();
    return { ok: true, recoveryCode };
  },

  async unlock(payload) {
    return attemptUnlock(payload || {});
  },

  async lockNow() {
    await lock();
    return { ok: true };
  },

  async changePin({ currentPin, newPin }) {
    if (!(await checkPin(currentPin))) return { ok: false, reason: 'bad-pin' };
    const problem = pinProblem(newPin);
    if (problem) return { ok: false, reason: 'bad-pin-format', problem };
    const vault = await getVault();
    const salt = generateSalt();
    await chrome.storage.local.set({
      vault: { ...vault, salt, iterations: ITERATIONS, pinHash: await deriveHash(newPin, salt, ITERATIONS) },
    });
    await setGate({ fails: 0, until: 0 });
    return { ok: true };
  },

  async resetPin({ newPin }) {
    // Only reachable straight after a successful recovery-code unlock.
    if (await isLocked()) return { ok: false, reason: 'locked' };
    const { recoveryUsed } = await chrome.storage.session.get('recoveryUsed');
    if (!recoveryUsed) return { ok: false, reason: 'not-allowed' };
    const problem = pinProblem(newPin);
    if (problem) return { ok: false, reason: 'bad-pin-format', problem };
    const vault = await getVault();
    const salt = generateSalt();
    await chrome.storage.local.set({
      vault: { ...vault, salt, iterations: ITERATIONS, pinHash: await deriveHash(newPin, salt, ITERATIONS) },
    });
    await chrome.storage.session.remove('recoveryUsed');
    await setGate({ fails: 0, until: 0 });
    return { ok: true };
  },

  async saveSettings({ settings }) {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    merged.idleMinutes = Math.min(240, Math.max(1, Number(merged.idleMinutes) || 10));
    await applySettings(merged);
    return { ok: true, settings: merged };
  },

  async newRecoveryCode({ currentPin }) {
    if (!(await checkPin(currentPin))) return { ok: false, reason: 'bad-pin' };
    const vault = await getVault();
    const recoveryCode = generateRecoveryCode();
    const recoverySalt = generateSalt();
    await chrome.storage.local.set({
      vault: {
        ...vault,
        recoverySalt,
        recoveryHash: await deriveHash(normalizeRecoveryCode(recoveryCode), recoverySalt, ITERATIONS),
      },
    });
    return { ok: true, recoveryCode };
  },

  async removeProtection({ currentPin }) {
    if (!(await checkPin(currentPin))) return { ok: false, reason: 'bad-pin' };
    await disarmBlocking();
    await setPassThrough(true);
    await chrome.storage.local.remove(['vault', 'gate']);
    await chrome.storage.session.set({ unlocked: true });
    await paintBadge(false);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, reason: 'error', message: String(err) }));
  return true; // keep the port open for the async reply
});

/* ----------------------------------------------------------------- events */

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  if (!(await isConfigured())) {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') });
    return;
  }
  await applySettings(await getSettings());
  if (await isLocked()) await lock();
  else await unlock();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  if (!(await isConfigured())) return;
  const settings = await getSettings();
  await applySettings(settings);
  if (settings.lockOnStartup) await lock();
  else await unlock();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (await isLocked()) await guardTab(tab);
});

chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (!info.url && info.status !== 'loading') return;
  if (await isLocked()) await guardTab(tab);
});

chrome.windows.onCreated.addListener(async (win) => {
  if (creatingLockWindow) return;
  if (!(await isLocked())) return;
  if (await isLockWindow(win.id)) return;

  // A window the user just opened (Ctrl+N) already reports its one blank tab, and
  // holds nothing worth saving -- close it at once so its address bar is never
  // usable. Only wait when there might be real tabs to rescue: a session-restore
  // window arrives before Chrome has filled its URLs in.
  let tabs = [];
  try { tabs = await chrome.tabs.query({ windowId: win.id }); } catch { return; }
  // Strictly one empty tab -- anything else might be a window worth rescuing.
  const blank = tabs.length === 1 && NEW_TAB_PAGE.test(tabs[0].url || tabs[0].pendingUrl || '');

  if (!blank) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!(await isLocked())) return;
    if (await isLockWindow(win.id)) return;
  }

  await ensureLockWindow();
  if (blank) {
    // Nothing in it to lose, and its address bar must not stay on screen.
    await closeWindow(win.id);
  } else {
    // A real window (session restore landing late) -- hide it, never destroy it.
    await hideWindow(win);
  }
});

// Windows survive the lock now, so one could be brought back from the taskbar --
// which would hand over an address bar. Put it straight back down and return focus
// to the lock screen.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (!(await isLocked())) return;
  if (await isLockWindow(windowId)) return;

  let win;
  try { win = await chrome.windows.get(windowId, { populate: true }); } catch { return; }
  if (win.type !== 'normal') return;

  await hideWindow(win);
  await ensureLockWindow();
});

// If the lock window is gone while still locked, forget it. It is deliberately not
// recreated here: closing the last window should still quit the browser, and the
// next start locks again anyway.
chrome.windows.onRemoved.addListener(async (windowId) => {
  if (await isLockWindow(windowId)) await chrome.storage.session.remove('lockWindowId');
});

chrome.idle.onStateChanged.addListener(async (state) => {
  const settings = await getSettings();
  if (!settings.lockOnIdle) return;
  if (state === 'idle' || state === 'locked') await lock();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SWEEP_ALARM) return;
  if (!(await isLocked())) return;
  // Re-assert everything in case a rule, a redirect or a window was missed.
  await armBlocking();
  await setPassThrough(false);
  await redirectOpenTabs();
  await enforceLockSurface();
  await paintBadge(true);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'lock-now') await lock();
});

// Runs on every service-worker wake-up, including the first one after a crash.
(async () => {
  if (!(await isConfigured())) return;
  const settings = await getSettings();
  try {
    chrome.idle.setDetectionInterval(Math.max(15, Math.round(settings.idleMinutes * 60)));
  } catch {}
  const locked = await isLocked();
  await paintBadge(locked);
  if (locked) {
    await armBlocking();
    await setPassThrough(false);
    await redirectOpenTabs();
    await enforceLockSurface();
  }
})();
