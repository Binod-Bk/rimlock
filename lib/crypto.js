// PIN hashing helpers. The PIN itself is never stored -- only a PBKDF2 digest
// plus a random per-install salt.

const enc = new TextEncoder();

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSalt(length = 16) {
  return toBase64(crypto.getRandomValues(new Uint8Array(length)));
}

export async function deriveHash(secret, saltB64, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toBase64(bits);
}

// Compares two base64 digests without leaking the position of the first
// difference through timing.
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Human-transcribable alphabet: no 0/O, 1/I/L, so a written-down code survives
// being copied by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode(groups = 4, groupSize = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * groupSize));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const out = [];
  for (let i = 0; i < groups; i++) {
    out.push(chars.slice(i * groupSize, (i + 1) * groupSize).join(''));
  }
  return out.join('-');
}

export function normalizeRecoveryCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
