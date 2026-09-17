// Signed, long-lived download tokens for paid-order deliverable files.
//
// Different purpose from functions/lib/access.js's sample-library tokens:
// those prove "this browser already verified a paid order" for browsing
// the site interactively. These prove "this specific link, emailed to the
// buyer, is allowed to download this specific file" — there's no browser
// session at all, since the client is clicking this from their inbox,
// possibly weeks later, possibly on a different device entirely. The
// token itself IS the credential.
//
// Reuses env.ACCESS_SECRET (already required/configured for the sample
// library) rather than introducing a second secret to set up. The
// `typ: 'order-file'` field keeps these tokens from being confused with,
// or replayed as, sample-library tokens — verifyDeliveryToken checks it
// explicitly, and verifyAccessToken (access.js) would reject this payload
// shape anyway since it has no `tier` field.

import { toBase64Url, fromBase64Url, hmacKey } from './access.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Deliverables are the paid product itself, not a preview — give links a
// long life so they still work if the client digs the email up months
// later looking for their files.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

export async function signDeliveryToken({ orderId, fileId, ttlSeconds = DEFAULT_TTL_SECONDS }, secret) {
  const payload = {
    typ: 'order-file',
    oid: orderId,
    fid: fileId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

// Returns the decoded { oid, fid, exp } payload if validly signed,
// unexpired, and correctly typed, or null otherwise. Never throws.
export async function verifyDeliveryToken(token, secret) {
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
    if (!payload || payload.typ !== 'order-file' || !payload.oid || !payload.fid || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
