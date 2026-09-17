// Shared commercial-license copy + rendering.
//
// Used by:
//  - functions/api/admin/orders/[id]/generate-license.js (admin panel
//    "Generate License" button — creates the row snapshotted into `licenses`)
//  - functions/api/license/[id].js (public page served to the client)
//  - scripts/send-license.mjs (manual CLI issuance)
//
// Licenses are snapshotted at issue time into licenses.html / licenses.text —
// a later wording change here never rewrites a license already in a client's
// hands. Render once, store, serve from the snapshot.

import { escapeHtml } from './email.js';

// ─── Tier detection ───────────────────────────────────────────────────────────
// 'custom'  → Custom by the Producer (brief submitted, human-produced)
// 'express' → AI Express (producer-directed, no client brief)
// 'sample'  → Sample library instrumental (non-exclusive, multi-buyer)
// Anything unrecognised falls through to the non-exclusive block.

function isCustomTier(tier) {
  return tier === 'custom';
}

function isSampleTier(tier) {
  return tier === 'sample' || tier === 'jingle';
}

// ─── License copy ─────────────────────────────────────────────────────────────
export function licenseCopy(tier) {

  // ── Royalty waiver — appears on every license ──────────────────────────────
  const royaltyWaiver =
    `APLO Audio irrevocably waives all rights to claim future performance royalties, ` +
    `mechanical royalties, sync fees, or any other royalty interest in this composition. ` +
    `No royalty payments to APLO Audio are required at any point, now or in the future.`;

  // ── Lease grant — scope differs by tier ────────────────────────────────────
  const leaseGrant = isCustomTier(tier)
    ? `The licensee is granted a perpetual, worldwide, exclusive unlimited-use lease on ` +
      `this composition. There is no expiry date and no renewal required. ` +
      `This work will not be sold, licensed, or distributed to any other party — ` +
      `the licensee holds the sole commercial right to this composition.`
    : isSampleTier(tier)
    ? `The licensee is granted a perpetual, worldwide, non-exclusive unlimited-use lease on ` +
      `this composition. There is no expiry date and no renewal required. ` +
      `This instrumental is available for purchase by other buyers — ` +
      `you do not hold exclusive rights to this composition, and others may license it independently.`
    : /* AI Express */
      `The licensee is granted a perpetual, worldwide, non-exclusive unlimited-use lease on ` +
      `this composition. There is no expiry date and no renewal required.`;

  // ── Permitted uses ─────────────────────────────────────────────────────────
  const permittedUses =
    `Permitted uses include: digital advertisements, social media campaigns, ` +
    `broadcast and streaming content, corporate videos, presentations, ` +
    `and any other commercial or non-commercial media.`;

  // ── Brand transfer clause ──────────────────────────────────────────────────
  const brandTransfer =
    `This license transfers to the licensee's client's brand once the work is ` +
    `used under that brand's name — no separate sign-off from APLO Audio is required.`;

  // ── Copyright-claim assurance ──────────────────────────────────────────────
  const claimAssurance =
    `Every composition is either produced from scratch or built on cleared, ` +
    `original source material. This work will not generate copyright claims ` +
    `or takedowns on any platform.`;

  return { royaltyWaiver, leaseGrant, permittedUses, brandTransfer, claimAssurance };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function licenseNumber(orderId) {
  return `APLO-${String(orderId).padStart(6, '0')}`;
}

export function licenseDateStr(date = new Date()) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function tierLabel(tier) {
  if (tier === 'custom')  return 'Custom by the Producer';
  if (tier === 'sample')  return 'Sample Library Instrumental';
  if (tier === 'jingle')  return 'Jingle Factory';
  return 'AI Express';
}

// ─── Plain-text render (stored in licenses.text) ─────────────────────────────
export function renderLicenseText({ order, licenseNum, dateStr }) {
  const { royaltyWaiver, leaseGrant, permittedUses, brandTransfer, claimAssurance } =
    licenseCopy(order.tier);
  const label = tierLabel(order.tier);
  const clientLine = order.client_name +
    (order.brand_name ? ` (${order.brand_name})` : '');

  return [
    `APLO AUDIO — COMMERCIAL LICENSE`,
    ``,
    `License:    ${licenseNum}`,
    `Order:      #${order.id}`,
    `Client:     ${clientLine}`,
    `Tier:       ${label}`,
    `Issued:     ${dateStr}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `ROYALTY WAIVER`,
    royaltyWaiver,
    ``,
    `LEASE GRANT`,
    leaseGrant,
    ``,
    `PERMITTED USES`,
    permittedUses,
    ``,
    `BRAND TRANSFER`,
    brandTransfer,
    ``,
    `COPYRIGHT ASSURANCE`,
    claimAssurance,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Questions about usage rights? Reply to your order confirmation email.`,
    ``,
    `— APLO AUDIO`,
  ].join('\n');
}

// ─── HTML fragment (embedded in delivery emails) ──────────────────────────────
export function renderLicenseHtmlFragment({ order, licenseNum, dateStr }) {
  const { royaltyWaiver, leaseGrant, permittedUses, brandTransfer, claimAssurance } =
    licenseCopy(order.tier);
  const label   = tierLabel(order.tier);
  const clientLine = escapeHtml(order.client_name) +
    (order.brand_name ? ` (${escapeHtml(order.brand_name)})` : '');

  const section = (heading, body) =>
    `<div style="margin-bottom:18px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.1em;font-weight:700;
                text-transform:uppercase;color:#e05c1a;">${heading}</p>
      <p style="margin:0;font-size:14px;line-height:1.65;color:#ccc;">${escapeHtml(body)}</p>
    </div>`;

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#f5f5f3;background:#111;
                border-radius:12px;padding:36px 40px;max-width:560px;">
      <p style="margin:0 0 2px;font-size:12px;letter-spacing:0.14em;font-weight:700;color:#e05c1a;">
        APLO AUDIO
      </p>
      <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#f5f5f3;">
        Commercial License
      </h2>
      <p style="margin:0 0 28px;font-size:13px;color:#666;">
        ${escapeHtml(licenseNum)} &nbsp;·&nbsp; Order #${escapeHtml(String(order.id))}
        &nbsp;·&nbsp; ${escapeHtml(label)} &nbsp;·&nbsp; ${escapeHtml(dateStr)}
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#999;">
        Issued to: <strong style="color:#f5f5f3;">${clientLine}</strong>
      </p>
      <hr style="border:none;border-top:1px solid #222;margin:0 0 24px;">
      ${section('Royalty Waiver', royaltyWaiver)}
      ${section('Lease Grant', leaseGrant)}
      ${section('Permitted Uses', permittedUses)}
      ${section('Brand Transfer', brandTransfer)}
      ${section('Copyright Assurance', claimAssurance)}
      <hr style="border:none;border-top:1px solid #222;margin:24px 0 18px;">
      <p style="margin:0;font-size:13px;color:#555;">
        Questions about usage rights? Reply to your order confirmation email.
      </p>
    </div>`;
}

// ─── Full standalone page (snapshotted into licenses.html, served publicly) ───
export function renderLicensePage({ order, licenseNum, dateStr }) {
  const label    = tierLabel(order.tier);
  const fragment = renderLicenseHtmlFragment({ order, licenseNum, dateStr });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(licenseNum)} — APLO Audio Commercial License</title>
  <style>
    *{ box-sizing:border-box; }
    body{ margin:0; background:#0a0a0a; font-family:'Helvetica Neue',Arial,sans-serif;
          padding:48px 20px; }
    .wrap{ max-width:620px; margin:0 auto; }
    .print-note{ text-align:center; font-size:12px; color:#444; margin-top:16px; }
    @media print{
      body{ background:#fff; padding:0; }
      .print-note{ display:none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${fragment}
    <p class="print-note">Save this page as a PDF (Ctrl/Cmd + P) for your records.</p>
  </div>
</body>
</html>`;
}
