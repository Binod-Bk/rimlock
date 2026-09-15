# Hardening

These are Windows policy settings for Brave. They are legitimate on a machine you own,
but they are **system-level changes** — read the `.reg` files before running them, and
take a registry backup first (`regedit` → File → Export).

## Apply

1. Right-click `brave-harden.reg` → **Merge**, approve the UAC prompt.
2. Fully quit Brave (check Task Manager — Brave keeps a background process) and reopen.
3. Confirm at `brave://policy` that the policies are listed.

## Reverse

Right-click `brave-unharden.reg` → **Merge**, restart Brave. Everything goes back.

## What each one closes

| Policy | Closes |
| --- | --- |
| `URLBlocklist` on the extensions pages | The main hole — someone switching the extension off. An extension cannot protect itself; only the browser can. |
| `IncognitoModeAvailability` | `Ctrl+Shift+N`, which opens a window the extension can't see, with an address bar that still autocompletes your normal history. |
| `BrowserGuestModeEnabled` / `BrowserAddPersonEnabled` | Guest and new profiles, which carry no extensions at all. |
| `DeveloperToolsAvailability` | Inspecting or editing the extension's storage through DevTools. |

## Read this before applying

- **It blocks your own access too.** While active, you cannot reach `brave://extensions`,
  so you cannot reload Rimlock after changing its code, and F12 is dead. Run the
  unharden file while you are still developing, and apply the hardening when you're done.
- **It does not stop the folder being deleted.** Rimlock is loaded *unpacked* from
  a folder. Delete or rename that folder and the extension is gone, policies or not. This
  is the standard bypass for every lock extension. Moving the folder somewhere a standard
  user cannot write (e.g. under `C:\Program Files\`) helps only if the other person is
  using a non-admin Windows account.
- **`ExtensionInstallForcelist` will not work here.** Force-install needs a Web Store ID or
  a self-hosted update URL; it cannot pin an unpacked local extension. Blocking the
  extensions page is the workable substitute.
- **Policies are machine-wide** (`HKEY_LOCAL_MACHINE`) and apply to every Windows user on
  this PC, not just you.

## The honest summary

These policies turn the extension from "a speed bump" into "a real nuisance to get past"
for someone casual. They do not make it secure against someone who knows Windows. If that
is the threat, a separate Windows user account is the correct answer and costs nothing.
