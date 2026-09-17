// POST /api/gumroad-ping?secret=YOUR_PING_SECRET
//
// IMPORTANT: this Gumroad account is shared with a separate store ("the
// Archive," a book/PDF store on a different site with its own DB). Gumroad
// only supports one account-wide Ping URL, so every sale on the account —
// Archive included — hits this endpoint. Everything below this point must
// positively identify an APLO Audio product before doing anything; the old
// behavior (skip if the name *looks* like a PDF, otherwise assume it's
// music) let unrecognized Archive products fall through and get an APLO
// confirmation email. Now it's the reverse: skip unless we recognize it.
import { randomId } from '../lib/id.js';
import { signDeliveryToken } from '../lib/delivery.js';
import { sendEmail, escapeHtml } from '../lib/email.js';

const INSTRUMENTAL_PRICE_USD = '100.00';

// Product names that mean "this is an APLO Audio license sale."
// Match is case-insensitive substring against Gumroad's product_name field.
// Add to this list (or use APLO_GUMROAD_PERMALINKS below) if you rename or
// add tiers.
const APLO_PRODUCT_NAME_ALLOWLIST = [
  'ai express',
  'custom by the producer',
];

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.PING_SECRET) {
    console.error('PING_SECRET env var not set — rejecting all pings.');
    return new Response('ok', { status: 200 });
  }

  const url = new URL(request.url);
  const providedSecret = url.searchParams.get('secret') || '';
  if (providedSecret !== env.PING_SECRET) {
    console.warn('Ping rejected — invalid secret.');
    return new Response('ok', { status: 200 });
  }

  let email       = null;
  let saleId      = null;
  let productName = null;
  let fullName    = null;
  let permalink   = null;
  let sampleId    = null;
  let sampleName  = null;

  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      email       = (form.get('email')        || '').trim().toLowerCase();
      saleId      = (form.get('sale_id')      || '').trim();
      productName = (form.get('product_name') || '').trim();
      fullName    = (form.get('full_name')    || '').trim();
      permalink   = (form.get('permalink')    || form.get('product_permalink') || '').trim().toLowerCase();
      sampleId   = (form.get('url_params[sample]')      || form.get('sample')      || '').trim();
      sampleName = (form.get('url_params[sample_name]') || form.get('sample_name') || '').trim();
    } else {
      const body = await request.json().catch(() => ({}));
      email       = (body.email        || '').trim().toLowerCase();
      saleId      = (body.sale_id      || '').trim();
      productName = (body.product_name || '').trim();
      fullName    = (body.full_name    || '').trim();
      permalink   = (body.permalink    || body.product_permalink || '').trim().toLowerCase();
      sampleId   = (body.url_params?.sample      || body.sample      || '').trim();
      sampleName = (body.url_params?.sample_name || body.sample_name || '').trim();
    }
  } catch (err) {
    console.error('Ping parse error:', err);
    return new Response('ok', { status: 200 });
  }

  if (!email) return new Response('ok', { status: 200 });

  // ── 1. Single-instrumental purchase (sample library) ────────────────────────
  // Gated on url_params.sample, which only APLO's own instrumentals checkout
  // page ever appends — an Archive sale will never carry this param.
  if (sampleId) {
    return handleInstrumentalPurchase({ env, email, fullName, saleId, sampleId, sampleName });
  }

  // ── 2. Positively identify an APLO Audio license sale ───────────────────────
  // Optional extra allowlist via env var, e.g.
  //   APLO_GUMROAD_PERMALINKS = "abc123,xyz789"
  // Set this to your APLO product permalink(s) for a hard, name-independent
  // check. Recommended once you have the permalinks handy — not required to
  // ship tonight, since the name allowlist below already covers it.
  const allowedPermalinks = (env.APLO_GUMROAD_PERMALINKS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const lowerName = (productName || '').toLowerCase();
  const isRecognizedAploProduct =
    APLO_PRODUCT_NAME_ALLOWLIST.some((k) => lowerName.includes(k)) ||
    (allowedPermalinks.length > 0 && allowedPermalinks.includes(permalink));

  if (!isRecognizedAploProduct) {
    console.log(
      `Ignoring non-APLO sale ("${productName}"${permalink ? `, permalink="${permalink}"` : ''}) from ${email} — not on the APLO product allowlist. (Likely an Archive sale on the shared Gumroad account.)`
    );
    return new Response('ok', { status: 200 });
  }

  // ── 3. Mark Music order paid in D1 ──────────────────────────────────────────
  let orderRow = null;
  try {
    if (env.DB) {
      orderRow = await env.DB.prepare(`
        SELECT id, client_name, tier FROM orders
        WHERE lower(email) = ?
          AND payment_status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(email).first();

      if (orderRow) {
        await env.DB.prepare(`
          UPDATE orders
          SET payment_status   = 'paid',
              payment_provider = 'gumroad',
              payment_amount   = ?,
              paid_at          = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(saleId || 'gumroad', orderRow.id).run();
      }
    }
  } catch (err) {
    console.error('Ping DB update failed:', err);
  }

  // ── 4. Send APLO Audio Music Confirmation Email ────────────────────────────
  if (env.BREVO_API_KEY && email) {
    const clientName = orderRow?.client_name || 'there';
    const tier       = orderRow?.tier        || 'express';
    const isCustom   = tier === 'custom';
    const deliveryTime = isCustom ? '3–5 business days' : '24 hours';
    const tierLabel    = isCustom ? 'Custom by the Producer' : 'AI Express';

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#111;padding:32px 40px 24px;border-bottom:1px solid #222;">
          <p style="margin:0;font-size:13px;letter-spacing:0.12em;color:#e05c1a;font-weight:600;">APLO AUDIO</p>
          <h1 style="margin:10px 0 0;font-size:26px;font-weight:700;color:#f5f5f3;line-height:1.2;">
            Order confirmed.
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 18px;font-size:15px;color:#999;line-height:1.6;">
            Hey ${escapeHtml(clientName)},
          </p>
          <p style="margin:0 0 18px;font-size:15px;color:#999;line-height:1.6;">
            Payment received — you're locked in. Here's what happens next:
          </p>

          <!-- Order summary box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px;margin:0 0 24px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:13px;color:#666;padding-bottom:10px;">Tier</td>
                  <td align="right" style="font-size:13px;color:#f5f5f3;font-weight:600;padding-bottom:10px;">${tierLabel}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#666;padding-bottom:10px;">Delivery</td>
                  <td align="right" style="font-size:13px;color:#f5f5f3;font-weight:600;padding-bottom:10px;">Within ${deliveryTime}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#666;">Reply time</td>
                  <td align="right" style="font-size:13px;color:#e05c1a;font-weight:600;">Under 2 min (working hours)</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <p style="margin:0 0 18px;font-size:15px;color:#999;line-height:1.6;">
            We'll reply to this email to confirm your brief and kick things off.
            If you have additional references or files to share, just reply here.
          </p>
          <p style="margin:0;font-size:15px;color:#999;line-height:1.6;">
            — Thembinkosi<br>
            <span style="color:#666;">APLO AUDIO</span>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid #1e1e1e;">
          <p style="margin:0;font-size:12px;color:#444;line-height:1.6;">
            This is a transaction confirmation for your APLO Audio order.
            Questions? Reply to this email.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const emailText = `Hey ${clientName},\n\nPayment received — you're locked in.\n\nTier: ${tierLabel}\nDelivery: Within ${deliveryTime}\nReply time: Under 2 min during working hours\n\nWe'll reply to this email to confirm your brief and kick things off.\nIf you have additional references or files to share, just reply here.\n\n— Thembinkosi\nAPLO AUDIO`;

    try {
      const result = await sendEmail({
        to:      email,
        subject: `Order confirmed — APLO Audio`,
        html:    emailHtml,
        text:    emailText,
      }, env);
      if (result.ok) {
        console.log('Confirmation email sent to:', email);
      }
    } catch (emailErr) {
      console.error('Email send failed:', emailErr);
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleInstrumentalPurchase({ env, email, fullName, saleId, sampleId, sampleName }) {
  if (!env.DB || !env.ACCESS_SECRET) {
    console.error('Instrumental purchase: DB or ACCESS_SECRET not configured.');
    return new Response('ok', { status: 200 });
  }

  try {
    const sample = await env.DB.prepare(
      `SELECT id, title, r2_key FROM samples WHERE id = ?`
    ).bind(sampleId).first();

    if (!sample) {
      const fallbackTitle = sampleName;
      const fallbackSample = fallbackTitle
        ? await env.DB.prepare(`SELECT id, title, r2_key FROM samples WHERE title = ? LIMIT 1`).bind(fallbackTitle).first()
        : null;

      if (!fallbackSample) {
        console.error(`Instrumental purchase: unknown sample id "${sampleId}"${sampleName ? ` / name "${sampleName}"` : ''} (sale ${saleId}).`);
        return new Response('ok', { status: 200 });
      }
      return handleInstrumentalPurchase({ env, email, fullName, saleId, sampleId: fallbackSample.id, sampleName });
    }

    const clientName = fullName || email;
    const trackTitle = sample.title;

    const orderResult = await env.DB.prepare(`
      INSERT INTO orders
        (tier, client_name, email, payment_status, payment_provider, payment_amount, paid_at)
      VALUES ('instrumental', ?, ?, 'paid', 'gumroad', ?, CURRENT_TIMESTAMP)
    `).bind(clientName, email, saleId || INSTRUMENTAL_PRICE_USD).run();
    const orderId = orderResult.meta.last_row_id;

    const audioExt = (sample.r2_key.match(/\.[a-zA-Z0-9]+$/) || ['.mp3'])[0];
    const audioFileId = randomId();
    await env.DB.prepare(`
      INSERT INTO order_files (id, order_id, label, filename, r2_key)
      VALUES (?, ?, ?, ?, ?)
    `).bind(audioFileId, orderId, `${trackTitle} — Full Mix`, `${trackTitle}${audioExt}`, sample.r2_key).run();

    const { results: stems } = await env.DB.prepare(
      `SELECT id, label, filename, r2_key FROM sample_stems WHERE sample_id = ? ORDER BY uploaded_at ASC`
    ).bind(sample.id).all();

    for (const stem of stems) {
      const stemFileId = randomId();
      await env.DB.prepare(`
        INSERT INTO order_files (id, order_id, label, filename, r2_key)
        VALUES (?, ?, ?, ?, ?)
      `).bind(stemFileId, orderId, `${trackTitle} — ${stem.label}`, stem.filename, stem.r2_key).run();
    }

    await env.DB.prepare(
      `UPDATE orders SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(orderId).run();

    if (env.BREVO_API_KEY) {
      const { results: files } = await env.DB.prepare(
        `SELECT id, label, filename FROM order_files WHERE order_id = ? ORDER BY uploaded_at ASC`
      ).bind(orderId).all();

      const siteUrl = env.SITE_URL || 'https://aploaudio.pages.dev';
      const linksHtml = await Promise.all(files.map(async (f) => {
        const token = await signDeliveryToken({ orderId, fileId: f.id }, env.ACCESS_SECRET);
        const dl = new URL(`/api/download/${token}`, siteUrl).toString();
        return `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #1e1e1e;">
            <span style="font-size:13px;color:#f5f5f3;">${escapeHtml(f.label)}</span><br>
            <a href="${dl}" style="font-size:12px;color:#e05c1a;word-break:break-all;">${dl}</a>
          </td>
        </tr>`;
      }));

      const linksText = (await Promise.all(files.map(async (f) => {
        const token = await signDeliveryToken({ orderId, fileId: f.id }, env.ACCESS_SECRET);
        const dl = new URL(`/api/download/${token}`, siteUrl).toString();
        return `${f.label}\n${dl}`;
      }))).join('\n\n');

      const stemsNote = stems.length > 0
        ? `<p style="font-size:14px;color:#999;margin:0 0 20px;">This includes the full mix plus ${stems.length} stem${stems.length === 1 ? '' : 's'} so you can use each element separately.</p>`
        : '';

      const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
          <p style="margin:0;font-size:13px;letter-spacing:0.12em;color:#e05c1a;font-weight:600;">APLO AUDIO</p>
          <h1 style="margin:10px 0 0;font-size:24px;font-weight:700;color:#f5f5f3;">Your download: ${escapeHtml(trackTitle)}</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#999;">Hey ${escapeHtml(clientName)},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#999;">Thanks for grabbing <strong style="color:#f5f5f3;">${escapeHtml(trackTitle)}</strong>. Your files are ready:</p>
          ${stemsNote}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${linksHtml.join('')}
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#555;">Links are permanent — bookmark them or come back any time.</p>
          <p style="margin:0;font-size:15px;color:#999;">— Thembinkosi<br><span style="color:#666;">APLO AUDIO</span></p>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #1e1e1e;">
          <p style="margin:0;font-size:12px;color:#444;">Questions? Just reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const text = `Hey ${clientName},\n\nThanks for grabbing ${trackTitle}. Your download links:\n\n${linksText}\n\nLinks are permanent.\n\n— Thembinkosi\nAPLO AUDIO`;

      try {
        await sendEmail({ to: email, subject: `Your download: ${trackTitle}`, html, text }, env);
      } catch (emailErr) {
        console.error('Instrumental delivery email failed:', emailErr);
      }
    }
  } catch (err) {
    console.error('Instrumental purchase handling failed:', err);
  }

  return new Response('ok', { status: 200 });
}
