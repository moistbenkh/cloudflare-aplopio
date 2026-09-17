// GET /api/download/:token
// Public — no admin key, no buyer login, no X-Sample-Token header. This is
// the link clicked straight out of the delivery email, so the signed
// token itself (see functions/lib/delivery.js) is the only credential;
// there is no session to check it against.

import { verifyDeliveryToken } from '../../lib/delivery.js';

export async function onRequestGet(context) {
  const { env, params, request } = context;

  if (!env.ACCESS_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const payload = await verifyDeliveryToken(params.token, env.ACCESS_SECRET);
  if (!payload) {
    return new Response('This download link has expired or is invalid.', { status: 403 });
  }

  const row = await env.DB.prepare(
    `SELECT r2_key, filename FROM order_files WHERE id = ? AND order_id = ?`
  ).bind(payload.fid, payload.oid).first();
  if (!row) return new Response('Not found', { status: 404 });

  const object = await env.SAMPLES_BUCKET.get(row.r2_key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=0, no-store');

  // "attachment" (save-dialog) is the default, since this is normally the
  // link clicked straight out of the delivery email — the client should
  // get the actual purchased file, not an inline player. The portal's
  // audio player (portal.html) appends ?inline=1 to the same signed URL
  // so it can use it directly as an <audio> src without triggering a
  // download prompt; the token and the underlying R2 object are identical
  // either way, this only changes how the browser presents the response.
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  headers.set(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${row.filename.replace(/"/g, '')}"`
  );

  return new Response(object.body, { status: 200, headers });
}
