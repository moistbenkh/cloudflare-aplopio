// POST /api/claim-sample
// Header: X-Sample-Token   Body: { sample_id }
//
// Lets a client claim a sample as one of their 2 free picks. Strictly:
//   - only orders on the 'custom' ($200) tier qualify — checked against the
//     token's tier AND re-checked live against D1 (a token could outlive a
//     refund within its validity window)
//   - the 2-per-order cap and the "not already claimed" check both happen
//     inside one INSERT ... SELECT ... WHERE statement, so it's the SQL
//     engine enforcing the limit atomically, not a read-then-write race in
//     JS that two simultaneous requests could both slip through

import { verifyAccessToken, getTokenFromRequest } from '../lib/access.js';

const FREE_CLAIM_LIMIT = 2;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ACCESS_SECRET) {
    return Response.json({ error: 'Access system not configured.' }, { status: 503 });
  }

  const token = getTokenFromRequest(request);
  const payload = await verifyAccessToken(token, env.ACCESS_SECRET);
  if (!payload) {
    return Response.json({ error: 'locked' }, { status: 401 });
  }

  if (payload.tier !== 'custom') {
    return Response.json(
      { error: 'Free samples are only included with the $200 Custom by the Producer order.' },
      { status: 403 }
    );
  }

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const sampleId = (body.sample_id || '').toString().trim();
  if (!sampleId) return Response.json({ error: 'sample_id required' }, { status: 400 });

  try {
    // Re-confirm live in D1 — never trust the token alone for a write that
    // allocates a limited free item.
    const order = await env.DB.prepare(
      `SELECT id FROM orders WHERE id = ? AND tier = 'custom' AND payment_status = 'paid'`
    ).bind(payload.oid).first();
    if (!order) return Response.json({ error: 'locked' }, { status: 401 });

    const sample = await env.DB.prepare(`SELECT id FROM samples WHERE id = ?`).bind(sampleId).first();
    if (!sample) return Response.json({ error: 'Sample not found.' }, { status: 404 });

    const result = await env.DB.prepare(`
      INSERT INTO sample_claims (order_id, sample_id)
      SELECT ?, ?
      WHERE (SELECT COUNT(*) FROM sample_claims WHERE order_id = ?) < ?
        AND NOT EXISTS (SELECT 1 FROM sample_claims WHERE order_id = ? AND sample_id = ?)
    `).bind(payload.oid, sampleId, payload.oid, FREE_CLAIM_LIMIT, payload.oid, sampleId).run();

    if (result.meta.changes === 0) {
      const { results: existing } = await env.DB.prepare(
        `SELECT sample_id FROM sample_claims WHERE order_id = ?`
      ).bind(payload.oid).all();
      const alreadyClaimedThisOne = existing.some((r) => r.sample_id === sampleId);
      return Response.json(
        {
          error: alreadyClaimedThisOne
            ? 'You already claimed this sample.'
            : `Free sample limit (${FREE_CLAIM_LIMIT}) reached for this order.`,
          claimed_sample_ids: existing.map((r) => r.sample_id),
        },
        { status: 409 }
      );
    }

    const { results: claims } = await env.DB.prepare(
      `SELECT sample_id FROM sample_claims WHERE order_id = ?`
    ).bind(payload.oid).all();

    return Response.json({ ok: true, claimed_sample_ids: claims.map((r) => r.sample_id) });
  } catch (err) {
    console.error('claim-sample failed:', err);
    return Response.json({ error: 'Claim failed.' }, { status: 500 });
  }
}
