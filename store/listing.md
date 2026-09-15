# Chrome Web Store listing — copy/paste ready

Everything here is written to survive review. The recurring rejection reason is a mismatch
between the manifest, the dashboard data disclosures, and the privacy policy — reviewers
open all three side by side. These are written to agree with each other and with the code.

---

## Single purpose (dashboard field)

> Rimlock has one purpose: to require a PIN before the browser can be used. While
> locked, it shows a lock screen and prevents pages from loading. It does nothing else.

## Short description (132 char max)

> Locks your browser behind a PIN at startup, after idle, or on demand. Works offline,
> collects nothing, sends nothing.

(117 characters.)

## Detailed description

> Rimlock puts a PIN screen in front of your browser, so someone who sits down at
> your already-signed-in computer can't casually read your tabs, history or accounts.
>
> **How it works**
> • On browser start, a full-screen lock screen appears and your windows are hidden.
> • Enter your PIN and everything comes back exactly as you left it — same tabs, same
>   pinned tabs, same history, nothing reloaded that wasn't already loaded.
> • Lock any time with the toolbar button or Ctrl+Shift+L.
> • Optionally lock automatically after a period of inactivity.
>
> **Your session is never destroyed.** Windows are hidden rather than closed, so nothing
> is rebuilt and nothing is lost. Tabs your browser had left unloaded stay unloaded.
>
> **Privacy**
> No accounts, no servers, no analytics, no network requests at all. Your PIN is never
> stored — only a salted PBKDF2-SHA256 digest of it, kept on your own computer. Repeated
> wrong guesses trigger an increasing delay that survives a restart.
>
> Set a recovery code during setup in case you forget the PIN.
>
> **What this is, honestly**
> This is a deterrent against casual snooping by someone with physical access to your
> unlocked computer — a family member, a flatmate, a colleague. It is not a security
> product. Like every browser extension, it can be switched off by anyone who opens the
> browser's extension settings, and it does not cover other browser profiles, Guest mode,
> or a different browser on the same machine. If you need real protection, use a separate
> operating-system user account.

---

## Permission justifications (dashboard fields)

Each of these must match the privacy policy exactly.

**`declarativeNetRequest`**
> While locked, the extension redirects top-level page loads to its own lock screen so no
> content can be viewed. This is done with a declarative redirect rule, which is removed
> as soon as the user unlocks. No page content is read or modified.

**Host permission `<all_urls>`**
> A declarative redirect rule requires host access to the addresses it redirects. The lock
> must apply to every site, not a fixed list, because its purpose is to block the whole
> browser. The permission is used solely to redirect navigation to the extension's own
> lock page. The extension injects no content scripts and reads no page content.

**`tabs`**
> Needed to read tab addresses. When locking, each loaded tab is sent to the lock screen
> and its address is carried along so the exact same page can be restored on unlock.
> Without this permission tab addresses are unavailable and the user's session could not
> be put back. Addresses never leave the device.

**`storage`**
> Stores the salted digest of the PIN (never the PIN itself), the recovery-code digest,
> the failed-attempt counter, and user settings. All local.

**`alarms`**
> A once-per-minute check that re-applies the lock if the browser has evicted the
> extension's service worker while the browser is still locked.

**`idle`**
> Only used for the optional "lock after inactivity" setting. Reports whether the machine
> is idle; provides no information about what the user is doing.

**Remote code:** No. All code ships inside the package. No `eval`, no remote scripts, no
hosted modules.

---

## Data disclosure answers (dashboard checkboxes)

Answer honestly — these are checked against the code.

| Question | Answer |
| --- | --- |
| Does it collect personally identifiable information? | **No** |
| Health, financial, authentication, personal communications, location? | **No** |
| Web history? | **No** — tab addresses are stored locally for session restore and never transmitted or collected by the developer |
| User activity (clicks, keystrokes)? | **No** |
| Website content? | **No** |
| Is data sold to third parties? | **No** |
| Is data used or transferred for purposes unrelated to the single purpose? | **No** |
| Is data used to determine creditworthiness / lending? | **No** |

Tick all three certification boxes at the bottom; they are truthful for this extension.

---

## Still needed before submitting

- [ ] Privacy policy hosted at a **public URL** (a GitHub Pages page or a gist is fine —
      a file inside the extension does not count).
- [ ] Developer account, one-time 5 USD registration fee.
- [ ] Screenshots: at least one, 1280x800 or 640x400 PNG/JPEG. Show the lock screen and
      the settings page.
- [ ] A ZIP of the extension folder **without** `store/`, `hardening/`, or the README.
- [ ] Expect a slower review. Broad host permissions trigger an in-depth code review.
