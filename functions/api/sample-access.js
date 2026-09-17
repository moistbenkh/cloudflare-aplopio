// POST /api/sample-access
// Body: { email, order_id? }
//
// The gate in front of the whole sample library. Verifies the email (and,
// if given, order_id) belongs to a payment_status='paid' order in D1, then
// mints a signed access token (see functions/lib/access.js) the browser
// stores and sends on every /api/sample-list, /api/samples/:id, and
// /api/claim-sample request. No token is ever issued without a real DB
// hit confirming payment — the tier on the token always comes from the
// orders row, never from anything the client claims.

import { signAccessToken } from '../lib/access.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ACCESS_SECRET) {
    console.error('ACCESS_SECRET env var not set — refusing to issue tokens.');
    return Response.json({ error: 'Access system not configured.' }, { status: 503 });
  }
  if (!env.DB) {
    return Response.json({ error: 'DB unavailable.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const email = (body.email || '').trim().toLowerCase();
  const orderId = (body.order_id || '').toString().trim();

  if (!email) {
    return Response.json({ access: false, error: 'Email is required.' }, { status: 400 });
  }

  try {
    let row;
    if (orderId) {
      row = await env.DB.prepare(`
        SELECT id, tier FROM orders
        WHERE id = ? AND lower(email) = ? AND payment_status = 'paid'
        LIMIT 1
      `).bind(orderId, email).first();
    } else {
      row = await env.DB.prepare(`
        SELECT id, tier FROM orders
        WHERE lower(email) = ? AND payment_status = 'paid'
        ORDER BY paid_at DESC
        LIMIT 1
      `).bind(email).first();
    }

    if (!row) {
      return Response.json(
        { access: false, error: "We couldn't find a paid order for that email. Check the address you checked out with, or your order ID." },
        { status: 403 }
      );
    }

    const token = await signAccessToken({ orderId: row.id, tier: row.tier }, env.ACCESS_SECRET);

    let claimedSampleIds = [];
    if (row.tier === 'custom') {
      const { results } = await env.DB.prepare(
        `SELECT sample_id FROM sample_claims WHERE order_id = ?`
      ).bind(row.id).all();
      claimedSampleIds = results.map((r) => r.sample_id);
    }

    return Response.json({
      access: true,
      token,
      tier: row.tier,
      order_id: row.id,
      free_claims_total: row.tier === 'custom' ? 2 : 0,
      free_claims_used: claimedSampleIds.length,
      claimed_sample_ids: claimedSampleIds,
    });
  } catch (err) {
    console.error('sample-access lookup failed:', err);
    return Response.json({ error: 'Lookup failed.' }, { status: 500 });
  }
}
