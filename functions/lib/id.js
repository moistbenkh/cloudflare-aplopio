// Shared opaque-ID generator. Used anywhere a new sample row is created
// (admin/samples.js registration, admin/upload.js direct upload) so IDs are
// generated the same way everywhere — random, URL-safe, non-sequential
// (see schema.sql's note on why sequential IDs would let the catalog be
// scraped by looping /api/samples/1, /api/samples/2, etc).

export function randomId(byteLength = 9) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
