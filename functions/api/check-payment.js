// GET /api/check-payment?email=xxx&order_id=yyy
// Matches by order_id (preferred) or email as fallback.
// Only returns paid:true for orders that are BOTH matched AND pending→paid
// in this session — prevents a past paid order from auto-confirming a new one.

export async function onRequestGet(context) {
  const { request, env } = context;

  const url     = new URL(request.url);
  const email   = (url.searchParams.get('email')    || '').trim().toLowerCase();
  const orderId = (url.searchParams.get('order_id') || '').trim();

  if (!email) {
    return Response.json({ paid: false, error: 'No email provided.' }, { status: 400 });
  }

  if (!env.DB) {
    return Response.json({ paid: false, error: 'DB unavailable.' }, { status: 503 });
  }

  try {
    let row;

    if (orderId) {
      // Preferred: match the exact order created in this session
      row = await env.DB.prepare(`
        SELECT id, payment_status, tier, paid_at
        FROM orders
        WHERE id = ?
          AND lower(email) = ?
          AND payment_status = 'paid'
        LIMIT 1
      `).bind(orderId, email).first();
    } else {
      // Fallback (older sessions without order_id stored): match the most
      // recent paid order for this email — only used when order_id is missing.
      row = await env.DB.prepare(`
        SELECT id, payment_status, tier, paid_at
        FROM orders
        WHERE lower(email) = ?
          AND payment_status = 'paid'
        ORDER BY paid_at DESC
        LIMIT 1
      `).bind(email).first();
    }

    return Response.json({
      paid:     !!row,
      order_id: row?.id   ?? null,
      tier:     row?.tier ?? null,
    });
  } catch (err) {
    console.error('check-payment DB error:', err);
    return Response.json({ paid: false, error: 'DB error.' }, { status: 500 });
  }
}
