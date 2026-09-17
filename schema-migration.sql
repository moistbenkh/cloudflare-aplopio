-- Run this against your existing D1 database once:
--   wrangler d1 execute adwave-db --file=schema-migration.sql
-- Or paste into Cloudflare Dashboard > D1 > adwave-db > Console

CREATE TABLE IF NOT EXISTS deliveries (
  id          TEXT PRIMARY KEY,           -- UUID, used in download links
  order_id    INTEGER REFERENCES orders(id),
  audio_url   TEXT NOT NULL,              -- signed R2 URL for the zip
  license_url TEXT NOT NULL,              -- signed R2 URL for the license PDF
  expires_at  TIMESTAMP NOT NULL,
  downloaded  INTEGER DEFAULT 0,          -- bump on each successful download
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for webhook lookups (email → latest pending order)
CREATE INDEX IF NOT EXISTS idx_orders_email
  ON orders(email, payment_status);
