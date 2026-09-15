// One home for the PIN rules, imported by the service worker and by every page,
// so the validation a user sees always matches the validation that is enforced.

export const MIN_PIN = 6;
export const MAX_PIN = 12;

// PINs created before the minimum went up are still valid to type. Raising this
// would lock out anyone holding an older, shorter PIN.
export const MIN_PIN_ENTRY = 4;

// Runs like 123456 or 987654 are among the first things anyone tries.
function isRun(pin) {
  const step = Number(pin[1]) - Number(pin[0]);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i++) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
}

// Short repeating cells: 121212, 123123, 112233.
function isRepeatingBlock(pin) {
  for (const size of [1, 2, 3]) {
    if (pin.length % size !== 0 || pin.length / size < 2) continue;
    const cell = pin.slice(0, size);
    if (pin.split('').every((_, i) => pin[i] === cell[i % size])) return true;
  }
  return /^(\d)\1(\d)\2(\d)\3$/.test(pin); // 112233
}

// Returns a human-readable problem, or null when the PIN is acceptable.
export function pinProblem(pin) {
  const value = String(pin || '');
  if (!/^\d+$/.test(value)) return 'Numbers only, no letters or spaces.';
  if (value.length < MIN_PIN) return `Use at least ${MIN_PIN} digits.`;
  if (value.length > MAX_PIN) return `Use at most ${MAX_PIN} digits.`;
  if (isRun(value)) return 'Straight runs like 123456 are guessed first.';
  if (isRepeatingBlock(value)) return 'Repeating patterns like 121212 are guessed early.';
  return null;
}

// A plain-language read on how well a PIN of this length resists someone who has
// copied the stored hash and is guessing offline. Digits only buy so much: each
// extra digit is 10x the work, which is why 8 is worth the effort over 6.
export function pinStrength(length) {
  if (length < MIN_PIN) return { label: '', tone: '' };
  if (length === 6) return { label: 'Fine for keeping people out. Weakest against an offline attack.', tone: 'ok' };
  if (length === 7) return { label: 'Better — 10x harder to crack than 6 digits.', tone: 'ok' };
  return { label: 'Strong — 100x or more harder to crack than 6 digits.', tone: 'good' };
}
