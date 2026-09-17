// POST /api/auth/verify   { email, code }
//
// Second step of magic-link auth. Validates the code against the most
// recent unused, unexpired auth_codes row for the email, upserts a
// clients row, and mints a 90-day client_token that
// functions/api/client-profile.js (and the future /api/portal/* routes)
// will require. Returns { token, name, email } — name may be null for a
// first-time client with no order on file yet.

import { hashCode, signClientToken } from '../../lib/clientAuth.js';

// Matches auth/request.js's CODE_TTL_SECONDS — an attempt window the same
// length as the code's own lifetime means "attempts within the window"
// and "attempts against a single code" line up.
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 8;

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AUTH_SECRET) {
    return Response.json({ error: 'Auth not configured (AUTH_SECRET missing).' }, { status: 503 });
  }
  if (!env.DB) {
    return Response.json({ error: 'Storage not configured.' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const code = (body.code || '').toString().trim();

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return Response.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 });
  }

  // ── Brute-force guard ─────────────────────────────────────────────────
  // Caps failed attempts per email within a rolling window so the
  // 1,000,000-combination code space can't be scripted through in the
  // 15 minutes a code stays valid.
  let attemptRow = null;
  let windowExpired = true;
  try {
    attemptRow = await env.DB.prepare(
      `SELECT attempts, window_started_at FROM auth_attempts WHERE email = ?`
    ).bind(email).first();
    windowExpired = !attemptRow ||
      (Date.now() - new Date(attemptRow.window_started_at).getTime()) > ATTEMPT_WINDOW_SECONDS * 1000;
  } catch (err) {
    console.error('auth/verify: attempt lookup failed:', err);
    // Fail open on infra errors — a rate-limit bug shouldn't block sign-in.
  }

  if (attemptRow && !windowExpired && attemptRow.attempts >= MAX_ATTEMPTS) {
    return Response.json(
      { error: 'Too many attempts. Request a new code and try again in a few minutes.' },
      { status: 429 }
    );
  }

  const codeHash = await hashCode(code, env.AUTH_SECRET);

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT id FROM auth_codes
       WHERE email = ? AND code_hash = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`
    ).bind(email, codeHash).first();
  } catch (err) {
    console.error('auth/verify: lookup failed:', err);
    return Response.json({ error: 'Could not verify code. Try again.' }, { status: 500 });
  }

  if (!row) {
    try {
      if (windowExpired) {
        await env.DB.prepare(
          `INSERT INTO auth_attempts (email, attempts, window_started_at)
           VALUES (?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(email) DO UPDATE SET attempts = 1, window_started_at = CURRENT_TIMESTAMP`
        ).bind(email).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO auth_attempts (email, attempts, window_started_at)
           VALUES (?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(email) DO UPDATE SET attempts = attempts + 1`
        ).bind(email).run();
      }
    } catch (err) {
      console.error('auth/verify: failed to record attempt:', err);
    }
    return Response.json({ error: 'That code is invalid or has expired.' }, { status: 400 });
  }

  // Successful verify — clear this email's failed-attempt count.
  try {
    await env.DB.prepare(`DELETE FROM auth_attempts WHERE email = ?`).bind(email).run();
  } catch (err) {
    console.error('auth/verify: failed to reset attempt counter:', err);
  }

  try {
    await env.DB.prepare(`UPDATE auth_codes SET used = 1 WHERE id = ?`).bind(row.id).run();
  } catch (err) {
    // Non-fatal: worst case a used code could theoretically be replayed
    // within its remaining TTL if this update fails, but the row lookup
    // above already confirmed it and we proceed with issuing the token —
    // log it so it can be investigated, don't fail the login over it.
    console.error('auth/verify: failed to mark code used:', err);
  }

  let clientName = null;
  try {
    await env.DB.prepare(
      `INSERT INTO clients (email, last_seen) VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`
    ).bind(email).run();

    // Fill in / refresh clients.name from their most recent order, if any —
    // keeps the clients table useful on its own without duplicating logic
    // client-profile.js already has for picking "best" order info.
    const lastOrder = await env.DB.prepare(
      `SELECT client_name FROM orders WHERE email = ? AND client_name IS NOT NULL
       ORDER BY (payment_status = 'paid') DESC, created_at DESC LIMIT 1`
    ).bind(email).first();

    if (lastOrder?.client_name) {
      clientName = lastOrder.client_name;
      await env.DB.prepare(`UPDATE clients SET name = ? WHERE email = ?`).bind(clientName, email).run();
    } else {
      const existing = await env.DB.prepare(`SELECT name FROM clients WHERE email = ?`).bind(email).first();
      clientName = existing?.name || null;
    }
  } catch (err) {
    console.error('auth/verify: clients upsert failed:', err);
    // Non-fatal — the client identity (email) is still valid even if we
    // couldn't persist a clients row this time.
  }

  const token = await signClientToken({ email }, env.AUTH_SECRET);

  return Response.json({ token, email, name: clientName });
}
