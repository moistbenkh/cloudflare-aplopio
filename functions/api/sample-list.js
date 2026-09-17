// GET /api/sample-list
// Header: X-Sample-Token (issued by /api/sample-access after payment
// verification) — OR X-Admin-Key for the admin panel's own
// "Sample Library" tab, which needs to see the full catalog without going
// through the buyer unlock flow. Returns the browsable sample catalog —
// deliberately excludes r2_key; the browser only ever gets an opaque id,
// title, genre, bpm, cover_url. The actual file location in R2 is never
// sent to the client.

import { verifyAccessToken, getTokenFromRequest } from '../lib/access.js';

function isAdmin(request, env) {
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

function attachCoverUrls(results, requestUrl) {
  const origin = new URL(requestUrl).origin;
  return results.map((s) => {
    const cover_url = s.cover_image_r2_key ? `${origin}/api/cover/${s.id}` : null;
    const { cover_image_r2_key: _, ...rest } = s;
    return { ...rest, cover_url };
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const adminRequest = isAdmin(request, env);

  let payload = null;
  if (!adminRequest) {
    if (!env.ACCESS_SECRET) {
      console.error('ACCESS_SECRET env var not set — refusing all sample-list requests.');
      return Response.json({ error: 'Access system not configured.' }, { status: 503 });
    }
    const token = getTokenFromRequest(request);
    payload = await verifyAccessToken(token, env.ACCESS_SECRET);
    if (!payload) {
      return Response.json(
        { error: 'locked', message: 'A paid order is required to view the sample library.' },
        { status: 401 }
      );
    }
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, genre, bpm, revisable, cover_image_r2_key FROM samples ORDER BY created_at DESC`
    ).all();

    const samples = attachCoverUrls(results, request.url);

    if (adminRequest) {
      return Response.json({ samples });
    }

    let claimedSampleIds = [];
    if (payload.tier === 'custom') {
      const { results: claimRows } = await env.DB.prepare(
        `SELECT sample_id FROM sample_claims WHERE order_id = ?`
      ).bind(payload.oid).all();
      claimedSampleIds = claimRows.map((r) => r.sample_id);
    }

    return Response.json({
      samples,
      tier: payload.tier,
      free_claims_total: payload.tier === 'custom' ? 2 : 0,
      free_claims_used: claimedSampleIds.length,
      claimed_sample_ids: claimedSampleIds,
    });
  } catch (err) {
    console.error('Sample list query failed:', err);
    return Response.json({ error: 'Could not load samples.' }, { status: 500 });
  }
}
