// POST /api/admin/orders/:id/generate-license
// Auth: X-Admin-Key header — same as the other admin routes.
//
// What happens on a successful call:
//   1. If this order already has a license row, it's returned as-is —
//      clicking "Generate License" again is idempotent, not a way to mint
//      a second license for the same order.
//   2. Otherwise a license is rendered (functions/lib/license.js),
//      snapshotted into the `licenses` table, and a license_number is
//      assigned.
//   3. The client is re-sent the delivery email — same template as
//      functions/api/admin/orders/[id]/upload.js — now containing every
//      order_file AND the license as one more item in that list, so
//      generating a license after files were already delivered doesn't
//      require re-uploading anything to get the client a fresh email.

import { randomId } from '../../../../lib/id.js';
import { signDeliveryToken } from '../../../../lib/delivery.js';
import { sendDeliveryEmail } from '../../../../lib/deliveryEmail.js';
import { licenseNumber, licenseDateStr, renderLicenseText, renderLicensePage } from '../../../../lib/license.js';

function isAuthed(request, env) {
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const orderId = parseInt(params.id, 10);
  if (!orderId || isNaN(orderId)) {
    return Response.json({ error: 'Invalid order ID.' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT id, email, client_name, brand_name, tier, payment_status FROM orders WHERE id = ?`
  ).bind(orderId).first();
  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 });

  if (order.payment_status !== 'paid') {
    return Response.json({ error: 'Order is not marked paid — mark it paid before issuing a license.' }, { status: 400 });
  }

  let license = await env.DB.prepare(
    `SELECT id, license_number, issued_at FROM licenses WHERE order_id = ? ORDER BY issued_at DESC LIMIT 1`
  ).bind(orderId).first();

  if (!license) {
    const licenseNum = licenseNumber(order.id);
    const dateStr = licenseDateStr();
    const html = renderLicensePage({ order, licenseNum, dateStr });
    const text = renderLicenseText({ order, licenseNum, dateStr });
    const id = randomId();

    try {
      await env.DB.prepare(
        `INSERT INTO licenses (id, order_id, license_number, tier, client_name, brand_name, html, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, orderId, licenseNum, order.tier, order.client_name, order.brand_name || null, html, text).run();
    } catch (err) {
      console.error('D1 insert failed for license:', err);
      return Response.json({ error: 'Could not save license.' }, { status: 500 });
    }

    license = { id, license_number: licenseNum, issued_at: new Date().toISOString() };
  }

  // Re-send the delivery email with the full current set of items —
  // existing order files plus the license — same as upload.js.
  let emailResult = { ok: false, error: 'No email on file for this order.' };
  if (order.email && env.ACCESS_SECRET) {
    const { results: allFiles } = await env.DB.prepare(
      `SELECT id, label, filename FROM order_files WHERE order_id = ? ORDER BY uploaded_at ASC`
    ).bind(orderId).all();

    const origin = new URL(request.url).origin;
    const items = await Promise.all(
      allFiles.map(async (f) => {
        const token = await signDeliveryToken({ orderId, fileId: f.id }, env.ACCESS_SECRET);
        return { label: f.label || f.filename, url: `${origin}/api/download/${token}` };
      })
    );
    items.push({
      label: `Commercial License (${license.license_number})`,
      url: `${origin}/api/license/${license.id}`,
      cta: 'View License',
    });

    emailResult = await sendDeliveryEmail({ order, items, env });
  }

  return Response.json({
    ok: true,
    license,
    emailed: emailResult.ok,
    email_error: emailResult.ok ? undefined : emailResult.error,
  });
}
