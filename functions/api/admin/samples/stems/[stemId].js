// DELETE /api/admin/samples/stems/:stemId — remove a stem from D1 (not R2)
// Auth: X-Admin-Key header.

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const stemId = params.stemId;
  if (!stemId) return Response.json({ error: 'stemId required.' }, { status: 400 });

  await env.DB.prepare(`DELETE FROM sample_stems WHERE id = ?`).bind(stemId).run();
  return Response.json({ ok: true });
}
