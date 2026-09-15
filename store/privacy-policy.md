# Privacy Policy — Rimlock

**Last updated:** 15 September 2026

## The short version

Rimlock collects nothing, transmits nothing, and contains no analytics, no
tracking and no remote code. It has no servers. Everything it stores stays inside your
own browser profile on your own computer.

## What is stored, and where

All of it lives in `chrome.storage.local` (on your machine) or `chrome.storage.session`
(wiped every time the browser closes). None of it ever leaves your device.

| Stored | Where | Why |
| --- | --- | --- |
| A PBKDF2-SHA256 digest of your PIN, plus a random salt | local | To check the PIN you type. **Your PIN itself is never stored** and cannot be recovered from the digest. |
| A digest of your recovery code, plus a random salt | local | Same, for the "Forgot your PIN?" route. |
| Failed-attempt count and lockout time | local | To slow down repeated guessing. Must survive a restart, or restarting would reset it. |
| Your settings (lock on startup, idle timeout) | local | To remember your preferences. |
| A list of open tab URLs (`restore`) | local | A fallback used only if browser windows disappear while locked, so your session can be rebuilt. It is deleted on every unlock. |
| Whether the browser is currently unlocked, and window state | session | Cleared automatically when the browser closes — this is what makes the browser come back locked. |

## What is NOT done

- No data is sent anywhere. The extension makes no network requests of any kind.
- No analytics, telemetry, crash reporting or advertising.
- No selling or sharing of data, because none is collected.
- No remote code. All code is contained in the extension package.
- Your browsing history is never read, indexed or uploaded. The extension has no
  `history` permission.

## Permissions, and why each is needed

- **`declarativeNetRequest` + access to all sites (`<all_urls>`)** — While locked, the
  extension redirects page loads to its own lock screen. Redirect rules require access
  to the addresses being redirected. It is used **only** to send navigation to the lock
  page; it never reads, records or modifies page content, and the rules are removed when
  you unlock.
- **`tabs`** — To read tab addresses so a tab can be sent to the lock screen and put back
  exactly where it was on unlock. Addresses stay on your device.
- **`storage`** — To save the PIN digest and settings described above.
- **`alarms`** — A once-a-minute check that re-applies the lock if the browser has shut
  down the extension's background worker.
- **`idle`** — Only used if you switch on "lock after a period of inactivity". It reports
  whether the computer is idle; it cannot see what you are doing.

## Deleting your data

Removing the extension deletes everything it stored. You can also use
**Settings → Remove protection**, which deletes the stored PIN digest and recovery code.

## What this extension does not protect against

Stated plainly so nobody relies on it for more than it can do: a browser extension cannot
prevent someone from disabling or removing it through the browser's own extension
settings, and it does not cover other browser profiles, Guest mode, or a different
browser installed on the same computer. It is a deterrent against casual access to an
already-signed-in browser, not a security product.

## Contact

Questions about this policy: open an issue at
<https://github.com/Binod-Bk/rimlock/issues>

<!-- The Chrome Web Store dashboard also asks for a contact email during submission.
     That is entered in the dashboard, not here, so it need not be published. -->

