// GET /api/portal/orders/:id/files
// Auth: X-Client-Token / Bearer client_token (see functions/lib/clientAuth.js).
//
// Ownership check matters here in a way it doesn't for /api/portal/orders:
// an order id is a small sequential integer (see schema.sql —
// AUTOINCREMENT), so it's guessable/enumerable. This endpoint always
// verifies the order's email matches the token's email before returning
// anything, and returns the same 404 whether the order doesn't exist or
// belongs to someone else — never a distinguishing 403 — so this can't be
// used to probe which order ids exist.
//
// Each file gets a signed delivery token (functions/lib/delivery.js) —
// the SAME kind of token already emailed to buyers on delivery — so the
// portal doesn't need a separate download mechanism. play_url is the
// identical URL with ?inline=1 appended (see download/[token].js), which
// asks the browser to play it inline via <audio> instead of prompting a
// save dialog.

import { verifyClientToken, getClientTokenFromRequest } from '../../../../lib/clientAuth.js';
import { signDeliveryToken } from '../../../../lib/delivery.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!env.AUTH_SECRET || !env.DB) {
    return Response.json({ error: 'Not configured.' }, { status: 503 });
  }

  const token = getClientTokenFromRequest(request);
  const payload = await verifyClientToken(token, env.AUTH_SECRET);
  if (!payload) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const orderId = parseInt(params.id, 10);
  if (!orderId || isNaN(orderId)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const order = await env.DB.prepare(`SELECT id, email FROM orders WHERE id = ?`).bind(orderId).first();
  if (!order || order.email !== payload.email) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!env.ACCESS_SECRET) {
    return Response.json({ error: 'Downloads not configured.' }, { status: 503 });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, label, filename, uploaded_at FROM order_files WHERE order_id = ? ORDER BY uploaded_at ASC`
    ).bind(orderId).all();

    const origin = new URL(request.url).origin;
    const files = await Promise.all(
      results.map(async (f) => {
        const dtoken = await signDeliveryToken({ orderId, fileId: f.id }, env.ACCESS_SECRET);
        const downloadUrl = `${origin}/api/download/${dtoken}`;
        return { ...f, download_url: downloadUrl, play_url: `${downloadUrl}?inline=1` };
      })
    );

    return Response.json({ files });
  } catch (err) {
    console.error('portal/orders/:id/files failed:', err);
    return Response.json({ error: 'Could not load files.' }, { status: 500 });
  }
}
