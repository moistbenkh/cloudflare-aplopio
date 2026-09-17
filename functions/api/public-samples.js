// GET /api/public-samples
// Public — no token, no admin key. Powers the public instrumentals
// storefront (instrumentals.html) so a non-buyer can browse the catalog.
//
// Returns: id, title, genre, bpm, cover_url (proxy URL or null).
// cover_url points to /api/cover/:id which serves the image from R2.

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, genre, bpm, cover_image_r2_key FROM samples ORDER BY created_at DESC`
    ).all();

    const origin = new URL(request.url).origin;
    const samples = results.map((s) => {
      const cover_url = s.cover_image_r2_key ? `${origin}/api/cover/${s.id}` : null;
      const { cover_image_r2_key: _, ...rest } = s;
      return { ...rest, cover_url };
    });

    return Response.json({ samples }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('public-samples query failed:', err);
    return Response.json({ error: 'Could not load catalog.' }, { status: 500 });
  }
}
