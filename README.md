# Rimlock

**A PIN screen in front of your browser.** When the browser starts, Rimlock locks it. Enter
your PIN and your session comes back exactly as you left it — same tabs, same pinned tabs,
same history, nothing reloaded that wasn't already loaded.

For the moment when someone else picks up your laptop and your browser is still signed in to
everything.

> Manifest V3 · Chrome, Edge, Brave, Opera · no network requests, no analytics, no remote code

<!-- SCREENSHOTS — add two PNGs to docs/, then delete this comment block so they render.
     You need both for the Chrome Web Store submission anyway (1280x800 or 640x400).
       docs/lock-screen.png   the lock screen, full screen
       docs/settings.png      the settings page

![The lock screen](docs/lock-screen.png)
-->

---

## What it does

- **Locks on startup**, every time, with no gap to slip through.
- **Locks on demand** — toolbar button or `Ctrl+Shift+L` — and optionally after idle.
- **Never loses your session.** Windows are hidden, not closed, so nothing is rebuilt and
  nothing is lost. Tabs your browser left unloaded stay unloaded.
- **Never stores your PIN.** Only a salted PBKDF2-SHA256 digest, kept locally. Wrong guesses
  trigger an escalating delay that survives a restart.
- **Gives you a recovery code**, shown once at setup, for when you forget the PIN.

## Install

Not on the Chrome Web Store yet. To run it from source:

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. A setup tab opens. Choose a 6–12 digit PIN and **save the recovery code**.
5. In Settings, act on the **"Incognito is not covered"** card if it appears.

Then close the browser completely and reopen it. You should land on the lock screen.

| Action | How |
| --- | --- |
| Lock now | Toolbar icon → **Lock now**, or `Ctrl+Shift+L` |
| Settings / change PIN | Toolbar icon → **Settings** |
| Forgot your PIN | Lock screen → **Forgot your PIN?** → recovery code |

## What this is not

Worth saying plainly, because a lock screen invites more trust than it deserves.

Rimlock is a **deterrent against casual snooping** — a family member, a flatmate, a colleague
picking up an unlocked laptop. It is not a security product, and no browser extension can be
one. An extension cannot:

- **Protect itself.** Anyone who reaches `chrome://extensions` can switch it off. Rimlock
  redirects that page away, but it cannot defend against the browser's own extension manager.
  [`hardening/`](hardening/) has policy files that close this properly.
- **Cover incognito by default.** Extensions are disabled there, so `Ctrl+Shift+N` opens an
  unguarded window with an address bar that still autocompletes your history. Switch on
  *Allow in Incognito* — the settings page prompts you.
- **Cover other profiles, Guest mode, or a different browser** on the same machine.

If you want actual protection rather than a deterrent, use a separate operating-system user
account. It costs nothing and closes all of the above at once.

## How it works, briefly

Four layers, because each one alone has a gap:

0. **The lock screen gets its own `popup`-type window.** Chromium renders those with no
   omnibox. A normal window keeps its address bar live even when every tab shows the lock
   page — and typing there reveals your history through autocomplete. No API can disable that
   dropdown, so the answer is to leave no address bar on screen.
1. **A declarativeNetRequest redirect rule** blocks navigation at the network layer. The block
   rule is *dynamic* (survives a restart); the pass-through that cancels it is a *session* rule
   (cleared on restart). That asymmetry is why the browser always reopens locked.
2. **Tab listeners** catch what the network layer can't — `file://` and `chrome://` pages.
3. **A one-minute alarm sweep** re-asserts everything if the service worker was evicted.

**[→ Full walkthrough in `docs/how-it-works.md`](docs/how-it-works.md)**, including why windows
are hidden rather than closed, and the two Chromium quirks that fail silently and cost the most
debugging time.

## Layout

```
manifest.json     MV3 manifest
background.js     The lock engine — state, rules, window handling, PIN verification
lib/crypto.js     PBKDF2 hashing, constant-time compare, recovery codes
lib/pin.js        PIN rules, shared by the worker and every page so they cannot drift
pages/lock.*      Lock screen: keypad, lockout countdown, recovery code
pages/setup.*     First run: choose a PIN, save the recovery code
pages/options.*   Settings, change PIN, remove protection
pages/popup.*     Toolbar popup
hardening/        Windows policy files to stop the extension being switched off
store/            Privacy policy and Chrome Web Store listing copy
```

## Status

Built and used daily on **Brave / Windows 11**. Not yet tested on Chrome, Edge, macOS or
Linux — window handling is the part most likely to differ, especially fullscreen on macOS.
Reports from other platforms are very welcome.

## Contributing

Issues and pull requests welcome. If you're reporting a bug in the lock itself, **a screenshot
of the locked state is worth more than a description** — nearly every bug found so far was
diagnosed from one.

## License

[MIT](LICENSE)
