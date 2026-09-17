// POST /api/orders/:id/status
// Body: { "status": "paid" | "delivered" | "pending" }
// Requires X-Admin-Key header. Same key as /api/orders.

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const providedKey = request.headers.get('X-Admin-Key') || '';
  if (!env.ADMIN_KEY || providedKey !== env.ADMIN_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orderId = parseInt(params.id, 10);
  if (!orderId || isNaN(orderId)) {
    return Response.json({ error: 'Invalid order ID.' }, { status: 400 });
  }

  let data;
  try { data = await request.json(); } catch { data = {}; }

  const status = data.status;
  if (!['pending', 'paid', 'delivered'].includes(status)) {
    return Response.json({ error: 'status must be pending, paid, or delivered' }, { status: 400 });
  }

  try {
    if (status === 'paid') {
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(orderId).run();
    } else if (status === 'delivered') {
      await env.DB.prepare(
        `UPDATE orders SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(orderId).run();
    } else {
      await env.DB.prepare(
        `UPDATE orders SET payment_status = 'pending', paid_at = NULL, delivered_at = NULL WHERE id = ?`
      ).bind(orderId).run();
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Order status update failed:', err);
    return Response.json({ error: 'Could not update order.' }, { status: 500 });
  }
}
