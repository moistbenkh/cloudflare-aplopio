// POST /api/admin/generate-cover   (application/json: { sample_id })
//
// Generates a small, text-only cover image for a sample that doesn't have
// real artwork yet, so its card on the public storefront isn't blank.
// It's an SVG (not a photo) showing just the track name over a brand-color
// gradient — cheap to make, no image-generation service required, and it
// slots into the exact same R2 + cover_image_r2_key pipeline as a manually
// uploaded cover (see functions/api/admin/upload.js's "cover" branch and
// functions/api/cover/[id].js), so nothing on the public front-end needs
// to change to display it.
//
// Auth: X-Admin-Key header — same as the other admin routes.

function isAuthed(request, env) {
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Kept intentionally small and simple — this is a placeholder, not a
// finished piece of cover art, so it shouldn't try to look like one.
const WIDTH = 640;
const HEIGHT = 280;

function buildCoverSvg(title) {
  const safeTitle = escapeXml(title || 'Untitled');
  // Rough auto-shrink so long titles don't run off the edge — not exact
  // text measurement, just a step down at a couple of length thresholds.
  const fontSize = safeTitle.length > 28 ? 30 : safeTitle.length > 18 ? 36 : 44;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1A1D21"/>
      <stop offset="100%" stop-color="#121417"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="${WIDTH - 60}" cy="60" r="120" fill="#FF8A3D" opacity="0.12"/>
  <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="#ECEAE4">${safeTitle}</text>
  <text x="50%" y="64%" text-anchor="middle" dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="600"
        letter-spacing="2" font-size="13" fill="#FF8A3D">ΑΠΛΟ AUDIO</text>
</svg>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });
  if (!env.SAMPLES_BUCKET) return Response.json({ error: 'R2 bucket not bound.' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sampleId = (body.sample_id || '').toString().trim();
  if (!sampleId) return Response.json({ error: 'sample_id is required.' }, { status: 400 });

  const row = await env.DB.prepare(`SELECT id, title FROM samples WHERE id = ?`).bind(sampleId).first();
  if (!row) return Response.json({ error: 'Sample not found.' }, { status: 404 });

  const svg = buildCoverSvg(row.title);
  const r2Key = `covers/${sampleId}-generated-${Date.now()}.svg`;

  try {
    await env.SAMPLES_BUCKET.put(r2Key, svg, { httpMetadata: { contentType: 'image/svg+xml' } });
  } catch (err) {
    console.error('R2 generated-cover upload failed:', err);
    return Response.json({ error: 'Cover generation failed writing to R2.' }, { status: 500 });
  }

  try {
    await env.DB.prepare(`UPDATE samples SET cover_image_r2_key = ? WHERE id = ?`).bind(r2Key, sampleId).run();
  } catch (err) {
    console.error('D1 generated-cover update failed:', err);
    return Response.json({ error: 'Cover generated but DB update failed.' }, { status: 500 });
  }

  return Response.json({ ok: true, r2_key: r2Key });
}
