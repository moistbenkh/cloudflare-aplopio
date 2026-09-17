// GET /api/portal/orders
// Auth: X-Client-Token header or Bearer — minted by POST /api/auth/verify.
//
// Returns all orders for this client, newest first, with their delivered
// files (signed download + inline play URLs), license link, and revision
// requests attached in a single response — so the Android app (and any
// future portal page) needs one request, not N+1.
//
// Row-level security is enforced in application code: every query filters
// by the email extracted from the verified token. A client can never reach
// another client's data, even with a valid token and a guessed order ID.

import { verifyClientToken, getClientTokenFromRequest } from '../../lib/clientAuth.js';
import { signDeliveryToken } from '../../lib/delivery.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!env.AUTH_SECRET || !env.DB) {
    return Response.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  const token   = getClientTokenFromRequest(request);
  const payload = await verifyClientToken(token, env.AUTH_SECRET);
  if (!payload) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const email = payload.email;

  // ── Orders (this client only) ──────────────────────────────────────────────
  let orders;
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, tier, brand_name, vibe_notes, ad_length,
             payment_status, paid_at, delivered_at, created_at
      FROM   orders
      WHERE  email = ?
      ORDER  BY created_at DESC
    `).bind(email).all();
    orders = results;
  } catch (err) {
    console.error('portal/orders: order fetch failed:', err);
    return Response.json({ error: 'Could not load your orders.' }, { status: 500 });
  }

  if (!orders.length) return Response.json({ orders: [] });

  const orderIds     = orders.map((o) => o.id);
  const placeholders = orderIds.map(() => '?').join(',');

  // ── Batch-fetch related rows ───────────────────────────────────────────────
  let allFiles = [], allLicenses = [], allRevisions = [];
  try {
    const [filesRes, licensesRes, revisionsRes] = await Promise.all([
      env.DB.prepare(`
        SELECT id, order_id, label, filename, uploaded_at
        FROM   order_files
        WHERE  order_id IN (${placeholders})
        ORDER  BY uploaded_at ASC
      `).bind(...orderIds).all(),

      env.DB.prepare(`
        SELECT id, order_id, license_number
        FROM   licenses
        WHERE  order_id IN (${placeholders})
        ORDER  BY issued_at DESC
      `).bind(...orderIds).all(),

      env.DB.prepare(`
        SELECT id, order_id, notes, status, created_at
        FROM   revision_requests
        WHERE  order_id IN (${placeholders})
        ORDER  BY created_at DESC
      `).bind(...orderIds).all(),
    ]);

    allFiles     = filesRes.results     || [];
    allLicenses  = licensesRes.results  || [];
    allRevisions = revisionsRes.results || [];
  } catch (err) {
    console.error('portal/orders: related-data fetch failed:', err);
    // Soft-fail — return orders with empty arrays rather than 500.
  }

  // ── Sign download + play URLs ──────────────────────────────────────────────
  const origin = new URL(request.url).origin;

  const signFile = async (f) => {
    if (!env.ACCESS_SECRET) return { ...f, download_url: null, play_url: null };
    try {
      const tok = await signDeliveryToken(
        { orderId: f.order_id, fileId: f.id },
        env.ACCESS_SECRET
      );
      const downloadUrl = `${origin}/api/download/${tok}`;
      return { ...f, download_url: downloadUrl, play_url: `${downloadUrl}?inline=1` };
    } catch {
      return { ...f, download_url: null, play_url: null };
    }
  };

  const signedFiles = await Promise.all(allFiles.map(signFile));

  // ── Group by order_id ──────────────────────────────────────────────────────
  const byOrder = (arr) =>
    arr.reduce((acc, row) => {
      (acc[row.order_id] = acc[row.order_id] || []).push(row);
      return acc;
    }, {});

  const filesByOrder     = byOrder(signedFiles);
  const licensesByOrder  = byOrder(allLicenses);
  const revisionsByOrder = byOrder(allRevisions);

  const enriched = orders.map((order) => {
    const latestLicense = (licensesByOrder[order.id] || [])[0] || null;
    return {
      ...order,
      files: (filesByOrder[order.id] || []).map(
        ({ order_id: _, ...f }) => f
      ),
      license: latestLicense
        ? {
            id:             latestLicense.id,
            license_number: latestLicense.license_number,
            url:            `${origin}/api/license/${latestLicense.id}`,
          }
        : null,
      revisions: (revisionsByOrder[order.id] || []).map(
        ({ order_id: _, ...r }) => r
      ),
    };
  });

  return Response.json({ orders: enriched });
}
