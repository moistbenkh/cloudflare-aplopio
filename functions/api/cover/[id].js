// GET /api/cover/:id
// Public — no auth needed. Serves the cover image for a sample directly
// from R2. Cached at the edge for 24h so it's fast after first load.
//
// R2 bindings don't support createSignedUrl in Workers — this endpoint
// is the correct way to serve R2 images through Cloudflare Pages Functions.

// Extension -> MIME map. Preferred over the R2 object's stored httpMetadata
// because the extension is baked into the key at write time by upload.js /
// generate-cover.js and can never drift, whereas httpMetadata has been seen
// missing on some objects (falling back to image/jpeg for what is actually
// an SVG) — which desktop browsers quietly correct for by sniffing the
// bytes, but mobile browsers do not, because this site sends
// X-Content-Type-Options: nosniff. That mismatch is why generated covers
// were invisible on mobile and only sometimes visible on desktop.
const EXT_CONTENT_TYPES = {
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
};

function contentTypeForKey(key, storedType) {
  const match = /\.[a-z0-9]+$/i.exec(key || '');
  const ext = match ? match[0].toLowerCase() : '';
  return EXT_CONTENT_TYPES[ext] || storedType || 'image/jpeg';
}

export async function onRequestGet(context) {
  const { env, params } = context;

  const sampleId = params.id;
  if (!sampleId) return new Response('Not found', { status: 404 });

  if (!env.DB || !env.SAMPLES_BUCKET) {
    return new Response('Storage not configured', { status: 503 });
  }

  try {
    const row = await env.DB.prepare(
      `SELECT cover_image_r2_key FROM samples WHERE id = ?`
    ).bind(sampleId).first();

    if (!row?.cover_image_r2_key) {
      return new Response('Not found', { status: 404 });
    }

    const object = await env.SAMPLES_BUCKET.get(row.cover_image_r2_key);
    if (!object) return new Response('Not found', { status: 404 });

    const contentType = contentTypeForKey(row.cover_image_r2_key, object.httpMetadata?.contentType);

    return new Response(object.body, {
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=86400',
        'ETag':          object.etag,
      },
    });
  } catch (err) {
    console.error('Cover fetch failed:', err);
    return new Response('Error', { status: 500 });
  }
}
