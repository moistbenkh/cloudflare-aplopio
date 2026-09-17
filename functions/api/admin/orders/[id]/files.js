// DELETE /api/admin/orders/:id/files?file=<fileId>
// Removes an order file's D1 record only — the R2 object is left in place,
// same "unregister without deleting bytes" convention as
// functions/api/admin/samples.js. Does not un-send an email already sent;
// this just stops the file appearing in future delivery emails and in the
// admin panel's file list for this order.

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;

  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const orderId = parseInt(params.id, 10);
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file') || '';

  if (!orderId || isNaN(orderId) || !fileId) {
    return Response.json({ error: 'order id and file are required.' }, { status: 400 });
  }

  try {
    await env.DB.prepare(`DELETE FROM order_files WHERE id = ? AND order_id = ?`).bind(fileId, orderId).run();
    return Response.json({ ok: true });
  } catch (err) {
    console.error('order_files delete failed:', err);
    return Response.json({ error: 'Delete failed.' }, { status: 500 });
  }
}
