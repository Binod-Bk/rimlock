# Rimlock

A Chromium extension (Chrome, Edge, Brave, Opera) that puts a PIN screen in front of your
browser. On every browser start, every tab is replaced by a lock screen until the correct
PIN is entered. Nothing loads and nothing is browsable. Your windows are hidden rather than
closed, so the session comes back exactly as you left it — same tabs, same history, same
scroll position.

## Installing it

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. A setup tab opens. Choose a 6–12 digit PIN and **save the recovery code it shows you.**
5. In Settings, act on the **"Incognito is not covered"** card if it appears.

That is the whole install. The first real test: close the browser completely, reopen it.
You should land on the lock screen.

## Using it

| Action | How |
| --- | --- |
| Lock right now | Toolbar icon → **Lock now**, or `Ctrl+Shift+L` |
| Change PIN / settings | Toolbar icon → **Settings** |
| Forgot the PIN | On the lock screen: **Forgot your PIN?** → recovery code |

Settings let you toggle lock-on-startup, turn on lock-after-idle (with a minute count), change
the PIN, regenerate the recovery code, or remove protection entirely.

## How the lock actually holds

Four layers, because any single one has a gap:

0. **The lock screen gets its own window, of type `popup`.** This is the layer that matters
   most and it is not obvious. Chromium renders popup windows with a read-only URL display and
   no omnibox. A normal window keeps its address bar live even when every tab shows the lock
   page — and typing in that address bar pops the autocomplete dropdown, which lists history,
   bookmarks and open tabs straight from your profile. No extension API can disable the omnibox
   or filter its suggestions. So the lock opens a fullscreen popup and every other window is
   minimised out of the way; if one is ever surfaced from the taskbar it is put straight back
   down and focus returns to the lock screen.

   **Windows are hidden, never closed.** This is deliberate and was learned the hard way. An
   earlier version closed them and rebuilt the session from a snapshot on unlock — but a rebuild
   can never be faithful. `chrome.windows.create()` cannot reproduce tab history (the back
   button), scroll position, form state or a tab's unloaded status, and any tab whose URL was
   not recoverable simply vanished. Minimising costs nothing and loses nothing: Brave's own
   session is left completely untouched, so the browser comes back exactly as it was.


1. **A declarativeNetRequest redirect rule.** Every top-level `http`/`https` navigation is
   redirected to the lock page at the network layer, before a request goes out. The block rule
   is a *dynamic* rule, so it survives a browser restart and is already in force before the
   first tab loads. The pass-through that cancels it is a *session* rule, which Chrome discards
   on restart. That asymmetry is the whole trick — the browser reopens blocked by default, with
   no window where the startup handler hasn't run yet.
   The redirect carries the address it replaced (`lock.html?from=<original>`), which is how a
   tab finds its way back on unlock.

   Dynamic rules survive an extension reload, so the rule is versioned (`RULE_VERSION`). Without
   that check, `armBlocking()` sees *a* rule with the right id, assumes it is current and returns
   — leaving an old version's rule in force with no visible sign. Bump `RULE_VERSION` whenever the
   rule definition changes.

2. **Tab listeners.** `tabs.onCreated` and `tabs.onUpdated` redirect anything the network rule
   can't touch — `file://` pages, `chrome://` pages.

   **Unloaded tabs are left alone.** Brave restores a session with only the active tab loaded;
   the rest sit in the tab strip with nothing in memory until clicked. Redirecting one would
   force it to load, which is why an earlier version made all 20 tabs reload on every unlock.
   An unloaded tab renders nothing, so there is nothing to hide — and the moment anyone opens
   it, the network rule redirects it like any other navigation. Only genuinely loaded tabs get
   swapped for the lock page.
3. **A one-minute alarm sweep** that re-asserts both of the above, in case the service worker
   was evicted and something slipped through.

The PIN is never stored. What's stored is a PBKDF2-SHA256 digest (600,000 iterations) over a
random 16-byte per-install salt, in `chrome.storage.local`. Verification happens in the service
worker, never in the page. Wrong guesses escalate: attempts 1–2 are free, then a delay that
doubles from 30 seconds up to 15 minutes. The failure counter lives in `local` storage, so
restarting the browser does not reset it.

The recovery code is 16 characters from a no-look-alikes alphabet (no `0`/`O`, no `1`/`I`/`L`),
hashed the same way. Using it unlocks the browser and immediately forces a PIN reset.

### Why the PIN minimum is 6

The stored digest is a file on disk. Someone who copies it can guess offline, with no
lockout to slow them down — so PIN length is the only thing standing between them and your
hash. A 4-digit PIN is 10,000 guesses, minutes of work. Each extra digit multiplies that by
ten, which is why setup nudges toward 8. `lib/pin.js` holds the rules (shared by the worker
and every page so they cannot drift) and also rejects runs like `123456` and repeats like
`121212`, which any attacker tries first.

The *entry* minimum stays at 4 (`MIN_PIN_ENTRY`) on purpose: raising it would lock out
anyone still holding a PIN created under the old rules. Only PIN **creation** requires 6.

Each vault records the iteration count it was built with, so raising `ITERATIONS` never
breaks an existing PIN — old ones keep verifying with their own value.

## What this does not stop

Worth being straight with you, because the gap matters for the threat you described:

- **Anyone who can reach `chrome://extensions` can disable or remove the extension.** The tab
  listeners redirect that page away, but there is a brief moment as it loads where a fast,
  determined person could click Remove. An extension cannot protect itself from the browser's
  own extension manager. See hardening below.
- **Incognito windows — turn this on.** Extensions are disabled in incognito by default, so
  `Ctrl+Shift+N` opens a window this extension never sees: a live omnibox whose autocomplete
  still suggests your normal-profile history. Switch on *Allow in Incognito* on the extension's
  details page and incognito windows get handled like any other window while locked. Better
  still, disable incognito outright (hardening below).
- **Other Chrome profiles and Guest mode.** The extension is installed per profile. A new
  profile or a Guest window is not covered.
- **A different browser.** If Firefox is also installed, this does nothing about it.
- **Someone who already has your Windows account open.** This is a browser lock, not a computer
  lock.

If the goal is genuinely "nobody else sees my activity," the strongest version of this is a
separate Windows user account — that is what Windows user accounts are for, and it covers all
five gaps above at once. This extension is the right tool for a casual barrier: a family member
or colleague who sits down at an already-logged-in machine.

## Hardening it (optional)

Ready-to-run policy files live in [`hardening/`](hardening/) — `brave-harden.reg` to apply,
`brave-unharden.reg` to reverse, and a README explaining each setting and what it costs you.
They block the extensions page, incognito, guest mode and DevTools.

Two things worth knowing before you run them: they block **your** access to those pages too
(so reload the extension before applying), and `ExtensionInstallForcelist` is deliberately not
used — it cannot pin an unpacked local extension, so blocking the extensions page is the
workable substitute.

### Two Chromium quirks worth knowing

Both cost real debugging time, and both fail *silently* — the API call succeeds and simply
doesn't do what it says:

- **`chrome.windows.remove()` does not reliably close a multi-tab window.** With "warn me before
  closing multiple tabs" enabled (Brave's default), it raises a *Close all tabs?* confirmation
  and waits for a human to click it. The promise resolves, no error is thrown, and the window
  stays open. Closing the tabs instead (`chrome.tabs.remove(ids)`) closes the window without
  asking, so every close in this extension goes through `closeWindow()`.
- **`state` passed to `chrome.windows.create()` is advisory.** Brave accepts
  `{ type: 'popup', state: 'fullscreen' }` without complaint and hands back a small popup, so a
  try/catch fallback never fires. Setting the state afterwards with `chrome.windows.update()`
  works, and its return value reports the state actually applied — that is what `fillScreen()`
  checks before falling back to `maximized`.

## Unlock, step by step

1. **Revive in place.** Every lock page is navigated back to the address it carries (`?from=`).
   The tabs are the same tab objects throughout, so their history and state survive.
2. **Un-minimise** each window to the state it had before the lock.
3. **Rebuild from the snapshot only if nothing is left** — a genuine last resort, since a rebuild
   loses tab history and scroll position. In normal operation this never runs.
4. **Close the lock popup** last, once something else is on screen. Never the final window, which
   would quit the browser.

## If you lock yourself out

The extension cannot be unlocked without the PIN or the recovery code — that is the point. If
both are gone, the escape hatch is to remove the extension:

- Start the browser with extensions off: `chrome.exe --disable-extensions`, then open
  `chrome://extensions` and remove it.
- Or delete the profile's extension data directly.

If you applied the force-install policy above, delete that registry value first.

## Layout

```
manifest.json         MV3 manifest: permissions, background worker, commands
background.js         The lock engine — state, DNR rules, tab guarding, PIN verification
lib/crypto.js         PBKDF2 hashing, constant-time compare, recovery codes
pages/lock.html|css|js  The lock screen: keypad, PIN dots, lockout countdown, recovery
pages/setup.html|js   First-run: choose PIN, save recovery code
pages/options.html|js Settings, change PIN, regenerate code, remove protection
pages/popup.html|js   Toolbar popup: status + Lock now
icons/                Generated padlock icons (16/32/48/128)
```

State lives in two places, deliberately:

- `chrome.storage.local` — PIN digest, settings, failure counter, and the saved session
  (`restore`). All of these must survive a restart. The session snapshot is here rather than in
  session storage precisely because windows get closed: if the browser crashed while locked and
  the snapshot lived in session storage, those tabs would be gone. It is written only when
  nothing is already waiting to be restored, so locking twice can't overwrite the real session.
- `chrome.storage.session` — the `unlocked` flag and the lock window's id. These must *not*
  survive a restart; that is what makes the browser come back locked.
