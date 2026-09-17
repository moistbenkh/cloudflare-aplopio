// POST /api/portal/orders/:id/revision
// Body: { notes: string }
//
// Lets a signed-in client file a revision request against one of their
// own paid, delivered orders. Auth via X-Client-Token / Bearer — the same
// token minted by POST /api/auth/verify.
//
// Row-level security: we verify the order belongs to the authenticated
// client's email before writing anything. A client cannot file a revision
// on someone else's order even if they know the order ID.
//
// Rules enforced here:
//   1. Order must belong to this client (email match).
//   2. Order must be paid — no revisions on unpaid or pending orders.
//   3. `notes` must be present and non-empty (max 2000 chars).
//   4. No hard cap on the number of open revisions per order — the
//      producer reviews and closes them from the admin panel. If you want
//      to add a cap later, count WHERE order_id = ? AND status = 'open'
//      before inserting.
//
// Response: { ok: true, revision: { id, status, created_at } }

import { verifyClientToken, getClientTokenFromRequest } from '../../../../lib/clientAuth.js';
import { randomId } from '../../../../lib/id.js';

const MAX_NOTES_LENGTH = 2000;

export async function onRequestPost(context) {
  const { request, env, params } = context;

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!env.AUTH_SECRET || !env.DB) {
    return Response.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  const token   = getClientTokenFromRequest(request);
  const payload = await verifyClientToken(token, env.AUTH_SECRET);
  if (!payload) {
    return Response.json({ error: 'Unauthorised — please sign in.' }, { status: 401 });
  }

  // ── Validate order ID ──────────────────────────────────────────────────────
  const orderId = parseInt(params.id, 10);
  if (!orderId || isNaN(orderId)) {
    return Response.json({ error: 'Invalid order ID.' }, { status: 400 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const notes = (body.notes || '').toString().trim();
  if (!notes) {
    return Response.json({ error: 'Please describe what you need changed.' }, { status: 400 });
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return Response.json(
      { error: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  // ── Verify order belongs to this client and is paid ───────────────────────
  // This is the row-level security check: we look up by BOTH id AND email,
  // so a client can't reach another client's order just by guessing an id.
  let order;
  try {
    order = await env.DB.prepare(`
      SELECT id, payment_status, tier FROM orders
      WHERE  id = ? AND email = ?
    `).bind(orderId, payload.email).first();
  } catch (err) {
    console.error('portal/revision: order lookup failed:', err);
    return Response.json({ error: 'Could not look up order.' }, { status: 500 });
  }

  if (!order) {
    // Return 404, not 403 — don't confirm whether the order exists at all.
    return Response.json({ error: 'Order not found.' }, { status: 404 });
  }

  if (order.payment_status !== 'paid') {
    return Response.json(
      { error: 'Revisions are only available on paid orders.' },
      { status: 400 }
    );
  }

  // ── Insert revision request ────────────────────────────────────────────────
  const id        = randomId();
  const createdAt = new Date().toISOString();

  try {
    await env.DB.prepare(`
      INSERT INTO revision_requests (id, order_id, notes, status, created_at)
      VALUES (?, ?, ?, 'open', ?)
    `).bind(id, orderId, notes, createdAt).run();
  } catch (err) {
    console.error('portal/revision: insert failed:', err);
    return Response.json({ error: 'Could not submit revision request.' }, { status: 500 });
  }

  return Response.json({
    ok: true,
    revision: { id, status: 'open', created_at: createdAt },
  });
}
