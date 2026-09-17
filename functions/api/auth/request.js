// POST /api/auth/request   { email }
//
// First step of magic-link auth. Always responds { sent: true } regardless
// of whether the email has ever placed an order — the point of client
// auth is to *identify* a returning client, but revealing "no account
// found" here would let anyone enumerate real client emails against this
// endpoint. If the email is unknown, the code still gets generated and
// "sent" (see sendEmail below) and verify.js will simply find no matching
// order later — that's fine, it just means an empty profile.
//
// Codes are single-use, 15-minute-lived, and stored as an HMAC hash
// (functions/lib/clientAuth.js#hashCode) — never the raw code — so a
// leaked D1 export doesn't hand out working codes.

import { randomSixDigitCode, hashCode } from '../../lib/clientAuth.js';
import { sendEmail, escapeHtml } from '../../lib/email.js';

const CODE_TTL_SECONDS = 15 * 60;

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
  if (!isValidEmail(email)) {
    return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const code = randomSixDigitCode();
  const codeHash = await hashCode(code, env.AUTH_SECRET);
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO auth_codes (email, code_hash, expires_at) VALUES (?, ?, ?)`
    ).bind(email, codeHash, expiresAt).run();
  } catch (err) {
    console.error('auth/request: failed to store code:', err);
    return Response.json({ error: 'Could not send code. Try again.' }, { status: 500 });
  }

  // Best-effort send — never reveal success/failure of the underlying
  // email provider to the caller, since that alone would leak whether the
  // address is real/deliverable. Errors are logged server-side only.
  //
  // IMPORTANT: this is wrapped in context.waitUntil(), not just called
  // un-awaited. Cloudflare Pages Functions run on the Workers runtime,
  // which is free to tear down the execution context as soon as the
  // Response below is returned — any promise not registered with
  // waitUntil() can get cut off mid-flight (this is exactly what caused
  // codes to never arrive in testing: the fetch() to Brevo was started
  // but killed before it completed). waitUntil() keeps the worker alive
  // until the promise settles, without making the caller wait for it.
  context.waitUntil(
    sendCodeEmail({ email, code, env }).catch((err) => {
      console.error('auth/request: email send failed:', err);
    })
  );

  return Response.json({ sent: true });
}

async function sendCodeEmail({ email, code, env }) {
  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
        <tr><td style="background:#111;padding:32px 40px 24px;border-bottom:1px solid #222;">
          <p style="margin:0;font-size:13px;letter-spacing:0.12em;color:#e05c1a;font-weight:600;">APLO AUDIO</p>
          <h1 style="margin:10px 0 0;font-size:24px;font-weight:700;color:#f5f5f3;line-height:1.2;">Your sign-in code</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 20px;font-size:15px;color:#999;line-height:1.6;">
            Enter this code to continue your order:
          </p>
          <p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:0.15em;color:#f5f5f3;text-align:center;">
            ${escapeHtml(code)}
          </p>
          <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
            This code expires in 15 minutes. If you didn't request this, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const emailText = `Your APLO Audio sign-in code: ${code}\n\nExpires in 15 minutes. If you didn't request this, ignore this email.`;

  return sendEmail(
    { to: email, subject: `${code} is your APLO Audio code`, html: emailHtml, text: emailText },
    env
  );
}
