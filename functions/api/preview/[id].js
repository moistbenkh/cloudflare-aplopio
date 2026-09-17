// GET /api/preview/:id
// Public — no token, no admin key. Streams the track so a visitor can
// hear it before buying.
//
// NOTE: this used to cap playback at ~30 seconds via a server-side R2
// byte-range read (a proportional-cut estimate that produced glitchy/
// broken audio on some files). That cap has been removed for now — this
// streams the full file — until a proper time-based cap replaces it.

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (!env.DB || !env.SAMPLES_BUCKET) {
    return new Response('Storage not configured', { status: 503 });
  }

  // Anti-hotlink: reject requests from other origins.
  const referer = request.headers.get('Referer') || request.headers.get('Origin');
  if (referer && env.SITE_ORIGIN) {
    try {
      const refHost = new URL(referer).host;
      const allowedHost = new URL(env.SITE_ORIGIN).host;
      const isLocalDev = refHost.includes('localhost') || refHost.includes('127.0.0.1');
      if (refHost !== allowedHost && !isLocalDev) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const row = await env.DB.prepare(
    `SELECT r2_key FROM samples WHERE id = ?`
  ).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  const object = await env.SAMPLES_BUCKET.get(row.r2_key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Content-Disposition', 'inline');

  return new Response(object.body, { status: 200, headers });
}
