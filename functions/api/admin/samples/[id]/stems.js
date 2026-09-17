// GET /api/admin/samples/:id/stems — list all stems for a sample
// Auth: X-Admin-Key header.

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const id = params.id;
  const { results } = await env.DB.prepare(
    `SELECT id, label, filename, size_bytes, uploaded_at FROM sample_stems WHERE sample_id = ? ORDER BY uploaded_at ASC`
  ).bind(id).all();

  return Response.json({ stems: results });
}
