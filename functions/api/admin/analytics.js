// GET /api/admin/analytics?days=30
// Auth: X-Admin-Key header, same as the other admin endpoints.
//
// Aggregates functions/api/track.js's raw analytics_events rows into the
// shapes the admin dashboard renders. Everything here is a read-only
// aggregate query — no row-level event data is ever returned to the
// client, only counts/sums/averages, since there's nothing per-visitor
// worth exposing (no PII was ever stored in the first place).

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });
  if (!env.DB) return Response.json({ error: 'Not configured.' }, { status: 503 });

  const url = new URL(request.url);
  let days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!Number.isFinite(days) || days <= 0) days = 30;
  days = Math.min(days, 365);

  const since = `-${days} days`;

  try {
    const [
      pageviewsTotal,
      uniqueSessions,
      topPages,
      topReferrers,
      viewsByDay,
      playsTotal,
      topInstrumentals,
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM analytics_events
         WHERE event_type = 'pageview' AND created_at >= datetime('now', ?)`
      ).bind(since).first(),

      env.DB.prepare(
        `SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events
         WHERE event_type = 'pageview' AND session_id IS NOT NULL AND created_at >= datetime('now', ?)`
      ).bind(since).first(),

      env.DB.prepare(
        `SELECT path, COUNT(*) AS views FROM analytics_events
         WHERE event_type = 'pageview' AND created_at >= datetime('now', ?) AND path IS NOT NULL
         GROUP BY path ORDER BY views DESC LIMIT 10`
      ).bind(since).all(),

      env.DB.prepare(
        `SELECT
           CASE
             WHEN referrer IS NULL OR referrer = '' THEN 'Direct / none'
             ELSE referrer
           END AS referrer,
           COUNT(*) AS n
         FROM analytics_events
         WHERE event_type = 'pageview' AND created_at >= datetime('now', ?)
         GROUP BY referrer ORDER BY n DESC LIMIT 8`
      ).bind(since).all(),

      env.DB.prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS views FROM analytics_events
         WHERE event_type = 'pageview' AND created_at >= datetime('now', ?)
         GROUP BY day ORDER BY day ASC`
      ).bind(since).all(),

      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM analytics_events
         WHERE event_type = 'play_start' AND created_at >= datetime('now', ?)`
      ).bind(since).first(),

      // One row per sample: play count from play_start, avg/most seconds
      // listened + completion rate from play_progress (progress rows are
      // matched to the same sample_id/sample_title, not a strict 1:1 join
      // to a specific play_start — good enough for "which tracks hold
      // attention", not meant to be a per-listen funnel).
      env.DB.prepare(
        `SELECT
           s.sample_id,
           s.sample_title,
           s.plays,
           p.avg_seconds,
           p.max_duration
         FROM
           (SELECT sample_id, sample_title, COUNT(*) AS plays
            FROM analytics_events
            WHERE event_type = 'play_start' AND created_at >= datetime('now', ?) AND sample_id IS NOT NULL
            GROUP BY sample_id) s
         LEFT JOIN
           (SELECT sample_id, AVG(seconds_played) AS avg_seconds, MAX(track_duration_seconds) AS max_duration
            FROM analytics_events
            WHERE event_type = 'play_progress' AND created_at >= datetime('now', ?) AND sample_id IS NOT NULL
            GROUP BY sample_id) p
           ON p.sample_id = s.sample_id
         ORDER BY s.plays DESC LIMIT 10`
      ).bind(since, since).all(),
    ]);

    const instrumentals = (topInstrumentals.results || []).map((r) => {
      const avgSeconds = r.avg_seconds != null ? Math.round(r.avg_seconds) : null;
      const duration = r.max_duration != null ? Math.round(r.max_duration) : null;
      const completionRate = avgSeconds != null && duration ? Math.min(1, avgSeconds / duration) : null;
      return {
        sample_id: r.sample_id,
        sample_title: r.sample_title,
        plays: r.plays,
        avg_seconds_played: avgSeconds,
        track_duration_seconds: duration,
        completion_rate: completionRate,
      };
    });

    return Response.json({
      days,
      pageviews_total: pageviewsTotal?.n || 0,
      unique_sessions: uniqueSessions?.n || 0,
      plays_total: playsTotal?.n || 0,
      top_pages: topPages.results || [],
      top_referrers: topReferrers.results || [],
      views_by_day: viewsByDay.results || [],
      top_instrumentals: instrumentals,
    });
  } catch (err) {
    return Response.json({ error: 'Failed to load analytics.' }, { status: 500 });
  }
}
