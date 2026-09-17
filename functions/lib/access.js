// Signed, stateless access tokens for the sample library.
//
// Why a signed token instead of just checking D1 on every request: the
// browser needs to prove "I already verified I have a paid order" on every
// /api/sample-list and /api/samples/:id call without asking for the email
// again each time. Rather than invent a session/cookie system, we issue a
// short JSON payload {oid, tier, exp} signed with HMAC-SHA256 using a
// server-only secret (env.ACCESS_SECRET). The browser can read the payload
// but can't forge or alter it without the secret, so it can't grant itself
// a fake "paid" tier or a fake order id.
//
// This is NOT a substitute for the D1 check at issuance time — the token is
// only ever minted in functions/api/sample-access.js, and only after a real
// `SELECT ... WHERE payment_status = 'paid'` lookup. Endpoints that consume
// the token (sample-list, samples/[id], claim-sample) trust the signature,
// not the client. claim-sample.js additionally re-checks D1 before writing,
// since a claim is a real allocation of a limited free item, not just a
// read.
//
// Requires ACCESS_SECRET to be set as a Cloudflare Pages Secret. If it's
// missing, every caller of these helpers fails closed (see the callers).

const encoder = new TextEncoder();

// Exported so functions/lib/delivery.js (order-file download tokens) can
// reuse the same base64url/HMAC plumbing instead of duplicating it — the
// token *shape* differs (see delivery.js's `typ` field) but the encoding
// and signing primitives are identical.
export function toBase64Url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const str = atob(b64 + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

export async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export async function signAccessToken({ orderId, tier, ttlSeconds = DEFAULT_TTL_SECONDS }, secret) {
  const payload = {
    oid: orderId,
    tier,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

// Returns the decoded { oid, tier, exp } payload if the token is validly
// signed and unexpired, or null otherwise. Never throws.
export async function verifyAccessToken(token, secret) {
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

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (!payload || !payload.oid || !payload.tier || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Reads the token from either the X-Sample-Token header or a Bearer
// Authorization header, whichever the client sent.
export function getTokenFromRequest(request) {
  const header = request.headers.get('X-Sample-Token');
  if (header) return header;
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
