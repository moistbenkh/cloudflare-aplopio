// POST /api/checkout
// Cloudflare Pages Function — same origin as the static site.
// Rate-limited to 10 submissions per IP per hour via D1.

const TIER_PRICES = {
  express: { label: 'AI Express',              amount: '50.00'  },
  custom:  { label: 'Custom by the Producer',  amount: '200.00' },
};

const GUMROAD_LINKS = {
  express: 'https://nvsgtech.gumroad.com/l/idccwr',
  custom:  'https://nvsgtech.gumroad.com/l/kprswe',
};

const RATE_LIMIT     = 10;   // max submissions
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (env.DB && ip !== 'unknown') {
    try {
      const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const { results } = await env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM orders
         WHERE ip_address = ? AND created_at >= ?`
      ).bind(ip, windowStart).all();

      if (results[0]?.cnt >= RATE_LIMIT) {
        return Response.json(
          { error: 'Too many submissions. Please try again later.' },
          { status: 429, headers: { 'Retry-After': '3600' } }
        );
      }
    } catch (err) {
      // If rate check fails, don't block — log and continue
      console.error('Rate limit check failed:', err);
    }
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let data;
  try { data = await request.json(); } catch { data = {}; }

  let tier = data.tier;
  if (!TIER_PRICES[tier]) tier = 'express';

  const clientName = (data.name  || '').trim();
  const email      = (data.email || '').trim();
  const brandName  = (data.brand || '').trim();
  const vibeNotes  = (data.vibe  || '').trim();

  if (!clientName || !email) {
    return Response.json({ error: 'Name and email are required.' }, { status: 400 });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  // ── Save order (best-effort) ───────────────────────────────────────────────
  let orderId = null;
  try {
    if (env.DB) {
      const result = await env.DB.prepare(
        `INSERT INTO orders
           (tier, client_name, email, brand_name, vibe_notes, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(tier, clientName, email.toLowerCase(), brandName, vibeNotes, ip).run();
      orderId = result.meta.last_row_id;
    }
  } catch (err) {
    console.error('DB insert failed:', err);
    // Don't block — Gumroad link still works without DB
  }

  return Response.json({
    order_id:     orderId,
    tier,
    tier_label:   TIER_PRICES[tier].label,
    amount:       TIER_PRICES[tier].amount,
    redirect_url: GUMROAD_LINKS[tier],
  });
}
