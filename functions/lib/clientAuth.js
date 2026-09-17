// Signed client identity tokens — proves "this browser completed magic-link
// auth for this email" across orders and devices, for the returning-client
// auto-fill on checkout and (later) the client portal.
//
// Different purpose from functions/lib/access.js's sample-library tokens
// (which are scoped to a single order + tier) and from
// functions/lib/delivery.js's download tokens (scoped to a single file).
// This token is scoped to an *email* with no order tied to it at all — a
// client with zero, one, or ten orders gets exactly one identity token.
//
// Reuses the base64url + HMAC primitives from access.js (toBase64Url,
// fromBase64Url, hmacKey) rather than duplicating them, same pattern as
// delivery.js. Signed with env.AUTH_SECRET — a *separate* secret from
// env.ACCESS_SECRET, so that leaking or rotating one never affects the
// other. The `typ: 'client'` field keeps these from being confused with
// any other token shape that happens to verify against the same secret.

import { toBase64Url, fromBase64Url, hmacKey } from './access.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export async function signClientToken({ email, ttlSeconds = DEFAULT_TTL_SECONDS }, secret) {
  const payload = {
    typ: 'client',
    email: email.toLowerCase().trim(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

// Returns the decoded { email, exp } payload if validly signed, unexpired,
// and correctly typed, or null otherwise. Never throws.
export async function verifyClientToken(token, secret) {
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  let sigBytes;
  try {
    sigBytes = fromBase64Url(sigB64);
  } catch {
    return null;
  }

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadB64));
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(fromBase64Url(payloadB64)));
    if (!payload || payload.typ !== 'client' || !payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Reads a client token from either the X-Client-Token header or a Bearer
// Authorization header, whichever the browser sent. Mirrors
// access.js's getTokenFromRequest so the two token families stay
// symmetrical, but kept as a separate function since a caller that
// accidentally imports the wrong one would otherwise silently accept the
// wrong token type.
export function getClientTokenFromRequest(request) {
  const header = request.headers.get('X-Client-Token');
  if (header) return header;
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Generates a random 6-digit numeric code as a zero-padded string.
export function randomSixDigitCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

// HMAC-hashes a submitted code the same way a stored code_hash was
// produced, so auth/verify.js can compare hashes instead of ever storing
// or comparing the raw code. Uses the same AUTH_SECRET as the token
// signing above — one secret to configure, two unrelated uses of it (code
// hashing vs token signing) so a compromise of one doesn't chain into
// forging the other's output format.
export async function hashCode(code, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`code:${code}`));
  return toBase64Url(new Uint8Array(sig));
}
