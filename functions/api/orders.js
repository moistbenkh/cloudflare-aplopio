// GET /api/orders
// Admin endpoint — requires X-Admin-Key header.
// Set ADMIN_KEY as a Secret in Cloudflare Pages > Settings > Environment Variables.
// Fails closed: if ADMIN_KEY is not set, every request is rejected.

export async function onRequestGet(context) {
  const { request, env } = context;

  const providedKey = request.headers.get('X-Admin-Key') || '';

  if (!env.ADMIN_KEY || providedKey !== env.ADMIN_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, tier, client_name, email, brand_name, vibe_notes,
              payment_status, paid_at, delivered_at, created_at
       FROM orders ORDER BY id DESC`
    ).all();

    // Pulled in one extra query and grouped in JS rather than N queries
    // per order — order counts stay small enough that this is simpler
    // than a join, and the admin panel needs the full file list per order
    // (not just a count) to render "remove" buttons without a second
    // round-trip.
    const { results: fileRows } = await env.DB.prepare(
      `SELECT id, order_id, label, filename, size_bytes FROM order_files ORDER BY uploaded_at ASC`
    ).all();
    const filesByOrder = {};
    for (const f of fileRows) {
      (filesByOrder[f.order_id] ||= []).push({
        id: f.id, label: f.label, filename: f.filename, size_bytes: f.size_bytes,
      });
    }

    // One extra query, same "pull it all and group in JS" pattern as
    // fileRows above — lets the admin panel show a license badge / the
    // right button label per order without an extra round-trip.
    const { results: licenseRows } = await env.DB.prepare(
      `SELECT order_id, id, license_number, issued_at FROM licenses ORDER BY issued_at DESC`
    ).all();
    const licenseByOrder = {};
    for (const l of licenseRows) {
      if (!(l.order_id in licenseByOrder)) {
        licenseByOrder[l.order_id] = { id: l.id, license_number: l.license_number, issued_at: l.issued_at };
      }
    }

    const orders = results.map((r) => ({
      id:             r.id,
      tier:           r.tier,
      name:           r.client_name,
      email:          r.email,
      brand:          r.brand_name,
      vibe:           r.vibe_notes,
      payment_status: r.payment_status,
      paid_at:        r.paid_at,
      delivered_at:   r.delivered_at,
      created_at:     r.created_at,
      files:          filesByOrder[r.id] || [],
      license:        licenseByOrder[r.id] || null,
    }));

    return Response.json({ orders });
  } catch (err) {
    console.error('DB query failed:', err);
    return Response.json({ error: 'Could not load orders.' }, { status: 500 });
  }
}
