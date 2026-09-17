CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  client_name TEXT NOT NULL,
  email TEXT NOT NULL,
  brand_name TEXT,
  vibe_notes TEXT,
  ad_length TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_status TEXT DEFAULT 'pending',
  payment_provider TEXT,
  payment_amount TEXT,
  paid_at TIMESTAMP,
  delivered_at TIMESTAMP
);

-- Migration: run this if the table already exists from an earlier deploy
-- ALTER TABLE orders ADD COLUMN ip_address TEXT;

-- Sample library manifest. `id` is a random opaque public identifier (never
-- sequential — see functions/lib/id.js) so the 100 samples can't be
-- enumerated by looping sample-1, sample-2, etc. `r2_key` is the private
-- path inside the R2 bucket and is NEVER sent to the browser — only the
-- streaming Function (functions/api/samples/[id].js) ever reads it.
CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  bpm INTEGER,
  r2_key TEXT NOT NULL,
  cover_image_r2_key TEXT,           -- optional cover art stored in R2
  revisable INTEGER NOT NULL DEFAULT 1,  -- 1 = project file available, 0 = stems lost
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration: run in D1 console if table already exists
-- ALTER TABLE samples ADD COLUMN revisable INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE samples ADD COLUMN cover_image_r2_key TEXT;

-- Stems attached to a sample (e.g. drums, melody, bass).
-- Multiple files per sample; each has its own R2 key.
CREATE TABLE IF NOT EXISTS sample_stems (
  id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL,
  label TEXT NOT NULL,               -- e.g. "Drums", "Melody", "Full Mix"
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sample_id) REFERENCES samples(id)
);

-- Tracks which samples a client has claimed as one of their free picks.
-- Only orders with tier='custom' AND payment_status='paid' are allowed to
-- claim, and only up to the free-claim limit (2, enforced in
-- functions/api/claim-sample.js). The (order_id, sample_id) primary key
-- stops the same order claiming the same sample twice; the 2-per-order cap
-- is enforced by an atomic INSERT ... WHERE COUNT(*) < 2 in that same
-- function, not by application code alone, so two simultaneous claim
-- requests can't both slip through.
CREATE TABLE IF NOT EXISTS sample_claims (
  order_id   INTEGER NOT NULL,
  sample_id  TEXT NOT NULL,
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, sample_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (sample_id) REFERENCES samples(id)
);

-- Files delivered to a client for a paid order — the actual finished
-- track/beat, alternate versions, stems, etc. Uploading one here (or
-- registering an existing R2 key for a file too big for the HTTP upload
-- path) immediately emails the order's email a signed, long-lived download
-- link for every file currently on the order — see
-- functions/api/admin/orders/[id]/upload.js and functions/lib/delivery.js.
-- `id` is a random opaque id, same convention as samples.id.
CREATE TABLE IF NOT EXISTS order_files (
  id          TEXT PRIMARY KEY,
  order_id    INTEGER NOT NULL,
  label       TEXT,
  filename    TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  size_bytes  INTEGER,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Magic-link client auth (checkout auto-fill, future client portal).
-- `clients` is a durable identity keyed by email — separate from `orders`,
-- since one client can have many orders and we want one row per person,
-- not per purchase. `name` is best-effort, refreshed from the client's
-- most recent order on each successful login (see
-- functions/api/auth/verify.js) — it's a convenience field, not a source
-- of truth.
CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen   TIMESTAMP
);

-- One row per requested sign-in code. `code_hash` is HMAC(code,
-- AUTH_SECRET) — the raw 6-digit code is never stored, only ever emailed.
-- Rows aren't deleted after use; `used` + `expires_at` make an old row
-- inert rather than needing cleanup. A short-lived row per login attempt
-- is cheap enough that this table doesn't need pruning for the traffic
-- this site sees, but a periodic `DELETE FROM auth_codes WHERE expires_at
-- < CURRENT_TIMESTAMP - <retention>` is safe to add later if it grows.
CREATE TABLE IF NOT EXISTS auth_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  used        INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Caps failed /api/auth/verify attempts per email within a rolling window,
-- so the 1,000,000-value 6-digit code space can't be scripted through
-- during its 15-minute lifetime. One row per email; window_started_at
-- resets whenever the window rolls over or a verify succeeds — see
-- functions/api/auth/verify.js.
CREATE TABLE IF NOT EXISTS auth_attempts (
  email              TEXT PRIMARY KEY,
  attempts           INTEGER NOT NULL DEFAULT 0,
  window_started_at  TIMESTAMP NOT NULL
);

-- Migration: run this if `orders` and `order_files` already exist from an
-- earlier deploy — CREATE TABLE IF NOT EXISTS above is a no-op if these
-- two tables already exist, so nothing else to do for a fresh migration
-- beyond running the two CREATE TABLE statements above against the D1
-- database once.

-- Revision requests filed from the client portal (portal.html). One row
-- per request — a client can file more than one over the life of an
-- order, so this is intentionally not folded into `orders` as a single
-- flag/column. `status` is plain text rather than a constrained enum
-- since D1/SQLite has no native enum type; the admin panel is expected to
-- only ever write 'open' | 'in_progress' | 'done', enforced in
-- application code (functions/api/portal/orders/[id]/revision.js and any
-- future admin endpoint that updates status), not by the schema.
CREATE TABLE IF NOT EXISTS revision_requests (
  id          TEXT PRIMARY KEY,
  order_id    INTEGER NOT NULL,
  notes       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- First-party site analytics. Written to by the public, unauthenticated
-- POST /api/track beacon (functions/api/track.js) — every insert is
-- fire-and-forget from the browser via navigator.sendBeacon, so this
-- table has to tolerate being hit by anyone (no auth) and just stores
-- whatever lands, coarsely validated. Read back only through the
-- admin-key-gated GET /api/admin/analytics (functions/api/admin/analytics.js).
--
-- event_type:
--   'pageview'      — one per page load. path + referrer + session_id set.
--   'play_start'     — instrumental preview/full play started. sample_id +
--                       sample_title set.
--   'play_progress'  — sent on pause/ended/tab-close with how far the
--                       listener actually got (seconds_played) and the
--                       track's total length (track_duration_seconds), so
--                       the dashboard can show avg. listen time AND a
--                       completion rate per track, not just a play count.
--
-- session_id is a random UUID minted client-side into sessionStorage (see
-- js/main.js) — first-party, no cookie, cleared when the tab closes, used
-- only to count unique sessions/visitors and to avoid double counting.
-- No PII, no cross-site identifier, nothing sent to a third party.
-- NOTE: privacy.html currently states the site runs no analytics of any
-- kind — that copy needs updating to describe this first-party, cookie-
-- free tracking once this ships.
CREATE TABLE IF NOT EXISTS analytics_events (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type              TEXT NOT NULL,
  path                    TEXT,
  referrer                TEXT,
  sample_id               TEXT,
  sample_title            TEXT,
  seconds_played          REAL,
  track_duration_seconds  REAL,
  session_id              TEXT,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_type    ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_sample   ON analytics_events(sample_id);

-- Commercial licenses issued for paid orders. One row per license —
-- created by the admin panel's "Generate License" button
-- (functions/api/admin/orders/[id]/generate-license.js) or a manual run of
-- scripts/send-license.mjs. The license wording is rendered once at issue
-- time and snapshotted into `html`/`text` rather than being re-rendered
-- from functions/lib/license.js on every later view — so if the license
-- copy in that file ever changes, licenses already issued still read
-- exactly as they did the day they were sent, not a rewritten version.
-- `id` is a random opaque id (see functions/lib/id.js) and doubles as the
-- license's public URL slug (functions/api/license/[id].js) — there's no
-- sensitive file behind it, just the license text, so the opaque id alone
-- (not signed/expiring like order-file tokens) is enough to make it
-- unguessable without being a real access-control boundary.
CREATE TABLE IF NOT EXISTS licenses (
  id             TEXT PRIMARY KEY,
  order_id       INTEGER NOT NULL,
  license_number TEXT NOT NULL UNIQUE,
  tier           TEXT NOT NULL,
  client_name    TEXT NOT NULL,
  brand_name     TEXT,
  html           TEXT NOT NULL,
  text           TEXT NOT NULL,
  issued_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id);

-- Migration: run in D1 console if this table didn't exist yet —
-- CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS above are both
-- no-ops on a DB that already has them, so re-running this whole file
-- against an existing database is always safe.
