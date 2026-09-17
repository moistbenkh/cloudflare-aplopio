// POST /api/track
// Public, unauthenticated, fire-and-forget analytics beacon — called via
// navigator.sendBeacon (falls back to fetch/keepalive) from js/main.js,
// js/samples.js and js/instrumentals.js. See schema.sql's analytics_events
// comment for the event_type contract this endpoint accepts.
//
// Design constraints, since this is open to the public internet with no
// auth:
//   - Never throws/500s in a way that could surface to the visitor — a
//     tracking beacon failing should never break the page. Always 204.
//   - No PII is accepted or stored: no email, no IP, no persistent
//     identifier. session_id is a random client-minted UUID good for one
//     browser tab session (see js/main.js), not a tracking cookie.
//   - Every field is length-clamped and type-checked before insert; this
//     endpoint has no rate limiting, so it's write-only into a table
//     that's cheap to insert into and only ever read in aggregate.

const ALLOWED_EVENTS = new Set(['pageview', 'play_start', 'play_progress']);
const BOT_UA_RE = /bot|crawler|spider|crawling|headless|monitor|pingdom|uptimerobot|facebookexternalhit|slurp/i;

function clampStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Fail silently and cheaply if analytics storage isn't configured —
  // never let a missing DB binding turn into a visible error for a
  // beacon call the page doesn't even wait on.
  if (!env.DB) return new Response(null, { status: 204 });

  const ua = request.headers.get('User-Agent') || '';
  if (BOT_UA_RE.test(ua)) return new Response(null, { status: 204 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const eventType = clampStr(body.event_type, 32);
  if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
    return new Response(null, { status: 204 });
  }

  const path = clampStr(body.path, 300);
  const referrer = clampStr(body.referrer, 300);
  const sampleId = clampStr(body.sample_id, 64);
  const sampleTitle = clampStr(body.sample_title, 200);
  const secondsPlayed = body.seconds_played != null ? clampNum(body.seconds_played, 0, 36000) : null;
  const trackDuration = body.track_duration_seconds != null ? clampNum(body.track_duration_seconds, 0, 36000) : null;
  const sessionId = clampStr(body.session_id, 64);

  try {
    await env.DB.prepare(
      `INSERT INTO analytics_events
        (event_type, path, referrer, sample_id, sample_title, seconds_played, track_duration_seconds, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventType, path, referrer, sampleId, sampleTitle, secondsPlayed, trackDuration, sessionId).run();
  } catch (err) {
    // Swallow — a lost analytics row is never worth surfacing to the visitor.
  }

  return new Response(null, { status: 204 });
}

// Any other method: no-op, same cheap response.
export async function onRequest() {
  return new Response(null, { status: 204 });
}
