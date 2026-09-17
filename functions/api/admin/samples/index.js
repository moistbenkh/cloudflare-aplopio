// POST /api/admin/samples/index  — register a sample already uploaded to R2
// (Renamed from /api/admin/samples to avoid conflict with /api/admin/samples/[id].js)
// Kept for backwards compatibility; the admin panel now uses this path for new registrations.
export { onRequestPost, onRequestDelete } from '../samples.js';
