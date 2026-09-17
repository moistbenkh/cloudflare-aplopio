// GET /api/client-profile
// Auth: X-Client-Token header or Bearer Authorization — a token minted by
// POST /api/auth/verify. The email comes from the verified token payload,
// never from a query string — see functions/lib/clientAuth.js for why an
// email-gated version of this endpoint was only ever an interim step.
//
// Looks up the client's most recent order (preferring a paid one, falling
// back to any order) and returns just enough to auto-fill the checkout
// form: name, brand, tier. No new table needed for this part — the
// `orders` table already has everything.
//
// Fails soft: a missing/invalid/expired token, or no matching order,
// returns { found: false } rather than an error, since the checkout page
// treats "no returning-client data" as the normal case for a first-time
// buyer, not a failure state.

import { verifyClientToken, getClientTokenFromRequest } from '../lib/clientAuth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.AUTH_SECRET || !env.DB) {
    return Response.json({ found: false });
  }

  const token = getClientTokenFromRequest(request);
  const payload = await verifyClientToken(token, env.AUTH_SECRET);
  if (!payload) {
    return Response.json({ found: false });
  }

  try {
    const order = await env.DB.prepare(
      `SELECT client_name, brand_name, tier FROM orders
       WHERE email = ?
       ORDER BY (payment_status = 'paid') DESC, created_at DESC
       LIMIT 1`
    ).bind(payload.email).first();

    if (!order) {
      return Response.json({ found: false });
    }

    return Response.json({
      found: true,
      name: order.client_name || null,
      brand: order.brand_name || null,
      tier: order.tier || null,
    });
  } catch (err) {
    console.error('client-profile lookup failed:', err);
    return Response.json({ found: false });
  }
}
