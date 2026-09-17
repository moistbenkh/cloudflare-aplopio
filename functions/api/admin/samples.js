// POST /api/admin/samples — register a sample already uploaded to R2
// DELETE /api/admin/samples?id=xxx — remove a sample from D1 (not from R2)
//
// Body (POST, JSON):
//   { title, genre, bpm, r2_key, revisable }
//   r2_key: the path inside your R2 bucket, e.g. "audio/ai/golden-hour.mp3"
//   revisable: true/false — whether project file exists for revisions
//
// Auth: X-Admin-Key header must match ADMIN_KEY env var.
//
// Note: this only REGISTERS a file that's already sitting in R2 (see the
// head() check below). To actually upload bytes from the browser, use
// POST /api/admin/upload instead — this endpoint stays around for
// registering files placed in the bucket via wrangler / the import script.

import { randomId } from '../../lib/id.js';

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { title, genre, bpm, r2_key, revisable } = body;
  if (!title || !r2_key) return Response.json({ error: 'title and r2_key are required' }, { status: 400 });

  // Verify the file actually exists in R2 before registering it
  if (env.SAMPLES_BUCKET) {
    const obj = await env.SAMPLES_BUCKET.head(r2_key);
    if (!obj) return Response.json({ error: `File not found in R2: ${r2_key}` }, { status: 404 });
  }

  const id = randomId();
  await env.DB.prepare(
    `INSERT INTO samples (id, title, genre, bpm, r2_key, revisable) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, title.trim(), genre?.trim() || null, bpm ? parseInt(bpm) : null, r2_key.trim(), revisable ? 1 : 0).run();

  return Response.json({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });

  const url = new URL(request.url);
  const id  = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  await env.DB.prepare(`DELETE FROM samples WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
}
