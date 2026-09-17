#!/usr/bin/env node
// Generates and emails a commercial license for a paid order.
// Wire this into gumroad-ping.js for automatic issuance, or run manually:
//
//   npm run send-license -- --order 42
//   npm run send-license -- --order 42 --dry-run
//
// Required env vars (same as Cloudflare Pages uses):
//   BREVO_API_KEY, FROM_EMAIL

import { execFileSync } from 'node:child_process';
import { sendEmail } from '../functions/lib/email.js';
import {
  licenseCopy, licenseNumber, licenseDateStr, tierLabel,
  renderLicenseText, renderLicensePage,
} from '../functions/lib/license.js';

const DB_NAME = 'aplo-db';
const args    = process.argv.slice(2);
const LOCAL   = args.includes('--local');
const DRY_RUN = args.includes('--dry-run');

function getFlag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const orderId = getFlag('--order');
if (!orderId) {
  console.error('Usage: npm run send-license -- --order <id> [--local] [--dry-run]');
  process.exit(1);
}

function d1Query(sql) {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB_NAME,
    LOCAL ? '--local' : '--remote',
    '--json', '--command', sql,
  ], { encoding: 'utf8' });
  return JSON.parse(out)?.[0]?.results || [];
}

async function main() {
  const rows = d1Query(
    `SELECT id, tier, client_name, email, brand_name, payment_status, paid_at
     FROM orders WHERE id = ${Number(orderId)};`
  );

  if (!rows.length) {
    console.error(`No order found with id ${orderId}.`);
    process.exit(1);
  }

  const order = rows[0];

  if (order.payment_status !== 'paid') {
    console.error(
      `Order ${orderId} is not marked paid (status: ${order.payment_status}). ` +
      `Mark it paid before issuing a license.`
    );
    process.exit(1);
  }

  const licenseNum = licenseNumber(order.id);
  const dateStr    = licenseDateStr(order.paid_at ? new Date(order.paid_at) : new Date());
  const label      = tierLabel(order.tier);

  const text = renderLicenseText({ order, licenseNum, dateStr });
  const html = renderLicensePage({ order, licenseNum, dateStr });

  const subject = `Your APLO Audio commercial license — ${licenseNum}`;

  if (DRY_RUN) {
    console.log('─── DRY RUN — email not sent ───────────────────────');
    console.log(`To:      ${order.email}`);
    console.log(`Subject: ${subject}`);
    console.log('');
    console.log(text);
    return;
  }

  const result = await sendEmail(
    { to: order.email, subject, html, text },
    process.env
  );

  if (!result.ok) {
    console.error('Failed to send license email:', result.error);
    process.exit(1);
  }

  console.log(`License ${licenseNum} sent to ${order.email} for order #${order.id}.`);
}

main().catch((err) => {
  console.error('send-license failed:', err);
  process.exit(1);
});
