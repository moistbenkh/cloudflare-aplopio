// Shared delivery email — "your files are ready" — sent to the client
// whenever the set of deliverables on their order changes. Originally
// lived only in functions/api/admin/orders/[id]/upload.js; pulled out
// here so functions/api/admin/orders/[id]/generate-license.js can send
// the exact same email (now including the license as one more item)
// without duplicating the template.
//
// `items` is the full current list of things the client can download —
// order files AND, if one exists, the license — not just whatever just
// changed, so re-triggering this (upload another file, generate a
// license) always re-sends one complete email rather than the client
// accumulating a pile of partial ones.

import { sendEmail, escapeHtml } from './email.js';

export async function sendDeliveryEmail({ order, items, env }) {
  const clientName = order.client_name || 'there';
  const isCustom = order.tier === 'custom';
  const tierLabel = isCustom ? 'Custom by the Producer' : 'AI Express';

  const itemRows = items
    .map(
      (item) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #1e1e1e;">
      <div style="font-size:14px;color:#f5f5f3;font-weight:600;">${escapeHtml(item.label)}</div>
      <a href="${item.url}" style="display:inline-block;margin-top:8px;padding:8px 16px;border-radius:6px;background:#e05c1a;color:#fff;font-size:13px;text-decoration:none;font-weight:600;">${escapeHtml(item.cta || 'Download')}</a>
    </td></tr>`
    )
    .join('');

  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="background:#111;padding:32px 40px 24px;border-bottom:1px solid #222;">
          <p style="margin:0;font-size:13px;letter-spacing:0.12em;color:#e05c1a;font-weight:600;">APLO AUDIO</p>
          <h1 style="margin:10px 0 0;font-size:26px;font-weight:700;color:#f5f5f3;line-height:1.2;">Your files are ready.</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 18px;font-size:15px;color:#999;line-height:1.6;">Hey ${escapeHtml(clientName)},</p>
          <p style="margin:0 0 18px;font-size:15px;color:#999;line-height:1.6;">
            Your ${escapeHtml(tierLabel)} order is done — grab everything below.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
          <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.6;">
            Links stay active for a year. If anything sounds off or you need a revision, just reply to this email.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #1e1e1e;">
          <p style="margin:0;font-size:12px;color:#444;line-height:1.6;">
            This is a delivery notice for your APLO Audio order. Questions? Reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const emailText =
    `Hey ${clientName},\n\nYour ${tierLabel} order is done. Grab everything here:\n\n` +
    items.map((item) => `${item.label}: ${item.url}`).join('\n') +
    `\n\nLinks stay active for a year. Reply here if anything needs a revision.\n\n— APLO AUDIO`;

  return sendEmail(
    { to: order.email, subject: 'Your files are ready — APLO Audio', html: emailHtml, text: emailText },
    env
  );
}
