// GET /api/samples/:id
// Header: X-Sample-Token (issued by /api/sample-access after payment
// verification) — required, same as /api/sample-list. Streams a preview
// sample from the private R2 bucket. This is the only path any audio file
// is ever reachable through — the bucket itself has no public access, and
// `id` is a random opaque string (see scripts/import-samples.mjs), not a
// sequential number, so the catalog can't be scraped by looping
// /api/samples/1, /api/samples/2, etc.
//
// Honest limits: this stops casual scraping, hotlinking from other sites,
// search-engine media crawlers, and (now) anyone who hasn't paid. It can't
// stop someone from screen- or audio-recording what plays in their own
// browser — nothing server-side can. The real protection against a ripped
// file being worth anything is the watermark baked into the audio itself
// before upload (see the import script) — that's what makes a stolen copy
// low-value, not this Function.

import { verifyAccessToken, getTokenFromRequest } from '../../lib/access.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (!env.ACCESS_SECRET) {
    console.error('ACCESS_SECRET env var not set — refusing all sample streams.');
    return new Response('Forbidden', { status: 403 });
  }
  const token = getTokenFromRequest(request);
  const payload = await verifyAccessToken(token, env.ACCESS_SECRET);
  if (!payload) {
    return new Response('Forbidden', { status: 403 });
  }

  // Anti-hotlink check: only requests that look like they came from your
  // own site get served. Spoofable by a determined actor with curl, but it
  // stops the common case — other sites embedding your player, or bots
  // crawling for direct media links.
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

  const row = await env.DB.prepare(`SELECT r2_key FROM samples WHERE id = ?`).bind(id).first();
  if (!row) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.SAMPLES_BUCKET.get(row.r2_key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('etag', object.httpEtag);
  // Don't let CDNs/proxies cache and re-serve this outside the Function's
  // own checks.
  headers.set('Cache-Control', 'private, max-age=0, no-store');
  // "inline" (not "attachment") avoids handing the browser a filename to
  // save as — it plays in the <audio> element instead of prompting a save.
  headers.set('Content-Disposition', 'inline');

  return new Response(object.body, { status: 200, headers });
}
