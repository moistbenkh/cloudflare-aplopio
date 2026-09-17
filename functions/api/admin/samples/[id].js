// PATCH /api/admin/samples/:id — update sample metadata (title, genre, bpm, revisable)
// DELETE /api/admin/samples/:id — delete sample + all its stems from D1 (not R2)
//
// Auth: X-Admin-Key header.

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const id = params.id;
  if (!id) return Response.json({ error: 'Sample id required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { title, genre, bpm, revisable } = body;

  // Build SET clause dynamically from provided fields
  const sets = [];
  const binds = [];

  if (title !== undefined) { sets.push('title = ?'); binds.push(title.trim()); }
  if (genre !== undefined) { sets.push('genre = ?'); binds.push(genre ? genre.trim() : null); }
  if (bpm   !== undefined) { sets.push('bpm = ?');   binds.push(bpm ? parseInt(bpm) : null); }
  if (revisable !== undefined) { sets.push('revisable = ?'); binds.push(revisable ? 1 : 0); }

  if (sets.length === 0) return Response.json({ error: 'No fields to update.' }, { status: 400 });

  binds.push(id);
  await env.DB.prepare(`UPDATE samples SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return Response.json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const id = params.id;
  if (!id) return Response.json({ error: 'Sample id required.' }, { status: 400 });

  // Remove stems first (FK constraint), then the sample
  await env.DB.prepare(`DELETE FROM sample_stems WHERE sample_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM sample_claims WHERE sample_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM samples WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
}
