// Shared email sender — Brevo (formerly Sendinblue) transactional API.
//
// Required Cloudflare env vars:
//   BREVO_API_KEY  — from Brevo dashboard > Settings > API Keys
//   FROM_EMAIL     — sender address (any address, no domain verification needed)
//                    e.g. "APLO Audio <hello@gmail.com>"

export async function sendEmail({ to, subject, html, text }, env) {
  if (!env.BREVO_API_KEY) {
    console.error('BREVO_API_KEY not set — cannot send email.');
    return { ok: false, error: 'Email not configured (BREVO_API_KEY missing).' };
  }

  const fromRaw     = env.FROM_EMAIL || 'APLO Audio <hello@gmail.com>';
  const fromMatch   = fromRaw.match(/^(.*?)\s*<([^>]+)>$/);
  const fromPayload = fromMatch
    ? { name: fromMatch[1].trim(), email: fromMatch[2].trim() }
    : { email: fromRaw.trim() };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key':      env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender:       fromPayload,
        to:           [{ email: to }],
        subject,
        htmlContent:  html,
        textContent:  text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Brevo error:', res.status, errBody);
      return { ok: false, error: `Brevo API error (${res.status})` };
    }

    return { ok: true };
  } catch (err) {
    console.error('Email send failed:', err);
    return { ok: false, error: String(err) };
  }
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
