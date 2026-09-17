// functions/lib/pdf.js
// Generates a personalized license PDF as raw bytes.
// Pure JS — no npm packages, no Node APIs. Works in Cloudflare Workers/Pages Functions.
//
// PDF construction rules:
//   - All content is sanitized to printable ASCII before embedding.
//   - String length === byte count (all ASCII), so xref offsets are exact.
//   - Uses Type1 fonts (Helvetica + Helvetica-Bold) — built into every PDF reader.

// ---------------------------------------------------------------------------
// Sanitize a string to safe PDF content (ASCII, special chars escaped)
// ---------------------------------------------------------------------------
function esc(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (e for e-acute, etc.)
    .replace(/[^\x20-\x7E]/g, '')      // drop remaining non-ASCII
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// ---------------------------------------------------------------------------
// Layout: one pass builds a list of text commands with absolute y positions.
// PDF y-axis: 0 = bottom, 792 = top of US Letter page.
// We start at y=720 and move downward.
// ---------------------------------------------------------------------------
function buildLines({ clientName, brand, tier, orderId, date }) {
  const tierLabel = tier === 'custom' ? 'Custom by Noah' : 'AI Express';
  const licensee  = [clientName, brand && brand !== 'TBD' ? brand : '']
    .filter(Boolean).join(' / ');

  const items = [];
  let y = 720;

  function line(text, size, bold, drop = size + 6) {
    items.push({ text: esc(text), x: 72, y, size, bold });
    y -= drop;
  }
  function gap(n = 12) { y -= n; }
  function rule() {
    // Horizontal rule as a series of dashes — no graphics needed
    items.push({ text: esc('─'.repeat(72)), x: 72, y, size: 8, bold: false });
    y -= 14;
  }

  line('ADWAVE MUSIC',                          18, true,  26);
  line('COMMERCIAL LICENSE AGREEMENT',          11, false, 18);
  rule();
  gap(4);
  line(`Order ID  : #${orderId}`,               10, false, 15);
  line(`Date      : ${date}`,                   10, false, 15);
  line(`Tier      : ${tierLabel}`,              10, false, 15);
  gap(16);

  line('PARTIES',                               11, true,  18);
  line(`Licensor : AdWave Music`,               10, false, 15);
  line(`Licensee : ${licensee}`,                10, false, 15);
  gap(16);

  line('GRANTED RIGHTS',                        11, true,  18);
  line('Worldwide, non-exclusive, perpetual commercial license.',  10, false, 15);
  line('Permitted: digital ads, social media, broadcast,',        10, false, 15);
  line('corporate video, online campaigns.',                       10, false, 15);
  line('No attribution required. No royalty payments required.',  10, false, 15);
  line('License transfers to end client when ad runs under their brand.', 10, false, 15);
  gap(16);

  line('RESTRICTIONS',                          11, true,  18);
  line('No resale as stock music.',              10, false, 15);
  line('No submission to third-party music libraries.',           10, false, 15);
  line('No sub-licensing.',                      10, false, 15);
  gap(16);

  line('TERMS',                                 11, true,  18);
  line('This license is effective upon full payment confirmation.', 10, false, 15);
  line('Governed by applicable copyright law.',  10, false, 15);
  gap(24);

  rule();
  line('AdWave Music',                          10, true,  15);
  line('adwavemusic.com',                       9,  false, 14);

  return items;
}

// ---------------------------------------------------------------------------
// Build the PDF binary (returns Uint8Array)
// ---------------------------------------------------------------------------
export function generateLicensePdf(opts) {
  const lines = buildLines(opts);

  // Content stream: one BT...ET block per text item
  let stream = '';
  for (const { text, x, y, size, bold } of lines) {
    stream += `BT /${bold ? 'Fb' : 'Fr'} ${size} Tf ${x} ${y} Td (${text}) Tj ET\n`;
  }

  // All strings below are ASCII — string.length === byte count, offsets are correct.
  const streamLen = stream.length;

  const o1 = `1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`;
  const o2 = `2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n`;
  const o3 = `3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</Fr 5 0 R/Fb 6 0 R>>>>>>\nendobj\n`;
  const o4 = `4 0 obj\n<</Length ${streamLen}>>\nstream\n${stream}\nendstream\nendobj\n`;
  const o5 = `5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>\nendobj\n`;
  const o6 = `6 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>\nendobj\n`;

  const header = '%PDF-1.4\n';

  // Byte offsets for xref — each section appended in order
  const off1 = header.length;
  const off2 = off1 + o1.length;
  const off3 = off2 + o2.length;
  const off4 = off3 + o3.length;
  const off5 = off4 + o4.length;
  const off6 = off5 + o5.length;
  const xrefOffset = off6 + o6.length;

  const pad = n => String(n).padStart(10, '0');

  const xref = [
    'xref\n0 7\n',
    '0000000000 65535 f \n',
    `${pad(off1)} 00000 n \n`,
    `${pad(off2)} 00000 n \n`,
    `${pad(off3)} 00000 n \n`,
    `${pad(off4)} 00000 n \n`,
    `${pad(off5)} 00000 n \n`,
    `${pad(off6)} 00000 n \n`,
  ].join('');

  const trailer = `trailer\n<</Size 7/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const full = header + o1 + o2 + o3 + o4 + o5 + o6 + xref + trailer;
  return new TextEncoder().encode(full);
}
