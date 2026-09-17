// POST /api/admin/orders/:id/upload   (multipart/form-data)
// Fields: file (File) OR r2_key (string — manual fallback for a file
// already uploaded to R2 via wrangler, same pattern as admin/samples.js
// for files too big for this HTTP path), label? (e.g. "Final Mix", "Stems")
// Auth: X-Admin-Key header — same as the other admin routes.
//
// What happens on a successful call:
//   1. File bytes land in R2 (or the given r2_key is trusted as already
//      there) and a row is added to order_files.
//   2. EVERY file currently attached to this order (not just the new one)
//      gets a signed download link minted via functions/lib/delivery.js.
//   3. One email goes out to the order's email with the full, current set
//      of download links — so uploading a later revision re-sends one
//      complete email rather than the client accumulating a pile of
//      partial ones.
//   4. orders.delivered_at is stamped, same field the manual "Mark
//      Delivered" button in the admin panel sets — this endpoint is really
//      just a more useful way to trigger that state.
//
// Body-size note: Cloudflare Pages Functions cap request bodies (roughly
// 100MB on most plans) — same constraint as admin/upload.js. For masters
// bigger than that, upload to R2 with wrangler and pass r2_key instead.

import { randomId } from '../../../../lib/id.js';
import { signDeliveryToken } from '../../../../lib/delivery.js';
import { sendDeliveryEmail } from '../../../../lib/deliveryEmail.js';

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

function extOf(filename) {
  const m = /\.[a-zA-Z0-9]+$/.exec(filename || '');
  return m ? m[0].toLowerCase() : '';
}

function slugify(str) {
  return (
    (str || 'file')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'file'
  );
}

const MAX_BYTES = 90 * 1024 * 1024; // ~90MB, under Cloudflare Pages' request body cap

export async function onRequestPost(context) {
  const { request, env, params } = context;

  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });
  if (!env.ACCESS_SECRET) {
    return Response.json({ error: 'ACCESS_SECRET not set — required to sign download links.' }, { status: 503 });
  }
  if (!env.SAMPLES_BUCKET) return Response.json({ error: 'R2 bucket not bound.' }, { status: 503 });

  const orderId = parseInt(params.id, 10);
  if (!orderId || isNaN(orderId)) {
    return Response.json({ error: 'Invalid order ID.' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT id, email, client_name, tier FROM orders WHERE id = ?`
  ).bind(orderId).first();
  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  const manualKey = (form.get('r2_key') || '').toString().trim();
  const label = (form.get('label') || '').toString().trim();

  if (!(file instanceof File) && !manualKey) {
    return Response.json(
      { error: 'Choose a file to upload, or enter an R2 key for a file already in the bucket.' },
      { status: 400 }
    );
  }

  let r2Key, filename, sizeBytes;

  if (file instanceof File) {
    if (file.size > MAX_BYTES) {
      return Response.json(
        {
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB max via this uploader. For bigger masters, upload to R2 via wrangler and enter the R2 key instead.`,
        },
        { status: 400 }
      );
    }
    const ext = extOf(file.name);
    r2Key = `deliverables/${orderId}/${Date.now()}-${slugify(label || file.name)}${ext}`;
    filename = file.name || `${label || 'file'}${ext}`;
    sizeBytes = file.size;
    try {
      await env.SAMPLES_BUCKET.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
    } catch (err) {
      console.error('R2 upload failed:', err);
      return Response.json({ error: 'Upload to R2 failed.' }, { status: 500 });
    }
  } else {
    r2Key = manualKey;
    filename = manualKey.split('/').pop() || manualKey;
    sizeBytes = null;
  }

  const fileId = randomId();
  try {
    await env.DB.prepare(
      `INSERT INTO order_files (id, order_id, label, filename, r2_key, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(fileId, orderId, label || null, filename, r2Key, sizeBytes).run();
  } catch (err) {
    console.error('D1 insert failed after R2 upload — orphaned key:', r2Key, err);
    return Response.json({ error: `File uploaded but registration failed. R2 key: ${r2Key}` }, { status: 500 });
  }

  // Pull every file on this order — not just the one just added — so the
  // email always reflects the complete, current set of deliverables.
  const { results: allFiles } = await env.DB.prepare(
    `SELECT id, label, filename FROM order_files WHERE order_id = ? ORDER BY uploaded_at ASC`
  ).bind(orderId).all();

  // If a license has already been generated for this order (see
  // generate-license.js), it rides along in the same email as one more
  // item, right next to the audio files.
  const license = await env.DB.prepare(
    `SELECT id, license_number FROM licenses WHERE order_id = ? ORDER BY issued_at DESC LIMIT 1`
  ).bind(orderId).first();

  let emailResult = { ok: false, error: 'No email on file for this order.' };
  if (order.email) {
    const origin = new URL(request.url).origin;
    const items = await Promise.all(
      allFiles.map(async (f) => {
        const token = await signDeliveryToken({ orderId, fileId: f.id }, env.ACCESS_SECRET);
        return { label: f.label || f.filename, url: `${origin}/api/download/${token}` };
      })
    );
    if (license) {
      items.push({
        label: `Commercial License (${license.license_number})`,
        url: `${origin}/api/license/${license.id}`,
        cta: 'View License',
      });
    }
    emailResult = await sendDeliveryEmail({ order, items, env });
  }

  if (emailResult.ok) {
    try {
      await env.DB.prepare(`UPDATE orders SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(orderId).run();
    } catch (err) {
      console.error('Failed to set delivered_at:', err);
    }
  }

  return Response.json({
    ok: true,
    file: { id: fileId, label: label || null, filename, r2_key: r2Key },
    files: allFiles,
    emailed: emailResult.ok,
    email_error: emailResult.ok ? undefined : emailResult.error,
  });
}
