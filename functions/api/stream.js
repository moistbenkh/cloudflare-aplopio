// GET /api/stream?path=audio/ai/filename.mp3
// Streams a file directly from R2 by its bucket path.
// Used by the homepage sample players for the two hero tracks.
// The path must start with audio/ai/ or audio/human/ — nothing else is served.
//
// NOTE: this used to cap playback at ~30 seconds via a server-side R2
// byte-range read (an assumed-bitrate cut that produced glitchy/broken
// audio near the cutoff on non-128kbps files). That cap has been removed
// for now — this streams the full file — until a proper time-based cap
// replaces it.

export async function onRequestGet(context) {
  const { request, env } = context;

  const url      = new URL(request.url);
  const filePath = decodeURIComponent(url.searchParams.get('path') || '');

  // Only allow audio/ prefix — nothing else in the bucket is reachable here
  if (!filePath.startsWith('audio/ai/') && !filePath.startsWith('audio/human/')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Anti-hotlink: same check as /api/samples/:id
  const referer = request.headers.get('Referer') || request.headers.get('Origin');
  if (referer && env.SITE_ORIGIN) {
    try {
      const refHost     = new URL(referer).host;
      const allowedHost = new URL(env.SITE_ORIGIN).host;
      const isLocalDev  = refHost.includes('localhost') || refHost.includes('127.0.0.1');
      if (refHost !== allowedHost && !isLocalDev) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (!env.SAMPLES_BUCKET) {
    return new Response('Storage not configured', { status: 503 });
  }

  const object = await env.SAMPLES_BUCKET.get(filePath);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('Cache-Control', 'private, max-age=0, no-store');
  headers.set('Content-Disposition', 'inline');

  return new Response(object.body, { status: 200, headers });
}
