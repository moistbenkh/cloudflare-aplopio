// GET /api/license/:id
// Public — no auth. The license `id` is a random opaque id (see
// functions/lib/id.js), same convention as samples/order_files, and is
// the only thing needed to view it: there's no sensitive file behind
// this, just the license text that was already emailed to the client.
//
// Serves the exact `html` snapshotted into the licenses table at issue
// time (see generate-license.js) rather than re-rendering from
// functions/lib/license.js, so this page never changes retroactively.

export async function onRequestGet(context) {
  const { env, params } = context;

  const id = params.id;
  if (!id) return new Response('Not found.', { status: 404 });

  const license = await env.DB.prepare(
    `SELECT html FROM licenses WHERE id = ?`
  ).bind(id).first();

  if (!license) return new Response('License not found.', { status: 404 });

  return new Response(license.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
