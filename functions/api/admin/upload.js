// POST /api/admin/upload   (multipart/form-data)
// Fields:
//   For sample audio: file, title, genre?, bpm?, revisable ("1" | "0")
//   For cover image:  cover, sample_id  (adds/replaces cover on an existing sample)
//   For a stem:       stem, stem_label, sample_id  (attaches a stem to an existing sample)
//
// Auth: X-Admin-Key header — same as the other admin routes.
//
// This is the ONLY endpoint that writes bytes into R2 from the browser.
// functions/api/admin/samples.js only ever *registers* a file that's
// already sitting in the bucket — it does not accept file bytes. Upload
// path here: browser -> this Function -> R2.put() -> D1 insert.
//
// Body-size note: Cloudflare Pages Functions cap request bodies (roughly
// 100MB on most plans). That's comfortable for watermarked preview mp3s
// but not for large uncompressed masters — for those, keep using
// scripts/import-samples.mjs (wrangler CLI, uploads straight to R2 with no
// HTTP body-size limit).

import { randomId } from '../../lib/id.js';

function isAuthed(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  return env.ADMIN_KEY && headerKey === env.ADMIN_KEY;
}

function extOf(filename) {
  const m = /\.[a-zA-Z0-9]+$/.exec(filename || '');
  return m ? m[0].toLowerCase() : '';
}

function slugify(str) {
  return (
    (str || 'sample')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'sample'
  );
}

const ALLOWED_AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac'];
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10MB

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isAuthed(request, env)) return new Response('Forbidden', { status: 403 });
  if (!env.SAMPLES_BUCKET) return Response.json({ error: 'R2 bucket not bound.' }, { status: 503 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  // ── Cover image upload ────────────────────────────────────────────────────
  const coverFile = form.get('cover');
  if (coverFile instanceof File) {
    const sampleId = (form.get('sample_id') || '').toString().trim();
    if (!sampleId) return Response.json({ error: 'sample_id is required for cover upload.' }, { status: 400 });

    const ext = extOf(coverFile.name);
    if (!ALLOWED_IMAGE_EXT.includes(ext)) {
      return Response.json({ error: `Unsupported image type "${ext}" — allowed: ${ALLOWED_IMAGE_EXT.join(', ')}` }, { status: 400 });
    }
    if (coverFile.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: `Image too large (${(coverFile.size / 1024 / 1024).toFixed(1)}MB) — 10MB max.` }, { status: 400 });
    }

    // Verify sample exists
    const row = await env.DB.prepare(`SELECT id FROM samples WHERE id = ?`).bind(sampleId).first();
    if (!row) return Response.json({ error: 'Sample not found.' }, { status: 404 });

    const r2Key = `covers/${sampleId}-${Date.now()}${ext}`;
    const contentType = coverFile.type || (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
    try {
      await env.SAMPLES_BUCKET.put(r2Key, coverFile.stream(), { httpMetadata: { contentType } });
    } catch (err) {
      console.error('R2 cover upload failed:', err);
      return Response.json({ error: 'Cover upload to R2 failed.' }, { status: 500 });
    }

    try {
      await env.DB.prepare(`UPDATE samples SET cover_image_r2_key = ? WHERE id = ?`).bind(r2Key, sampleId).run();
    } catch (err) {
      console.error('D1 cover update failed:', err);
      return Response.json({ error: 'Cover uploaded but DB update failed.' }, { status: 500 });
    }
    return Response.json({ ok: true, r2_key: r2Key });
  }

  // ── Stem upload ───────────────────────────────────────────────────────────
  const stemFile = form.get('stem');
  if (stemFile instanceof File) {
    const sampleId = (form.get('sample_id') || '').toString().trim();
    const stemLabel = (form.get('stem_label') || '').toString().trim();
    if (!sampleId) return Response.json({ error: 'sample_id is required for stem upload.' }, { status: 400 });
    if (!stemLabel) return Response.json({ error: 'stem_label is required (e.g. "Drums", "Melody").' }, { status: 400 });

    const ext = extOf(stemFile.name);
    if (!ALLOWED_AUDIO_EXT.includes(ext)) {
      return Response.json({ error: `Unsupported stem type "${ext}" — allowed: ${ALLOWED_AUDIO_EXT.join(', ')}` }, { status: 400 });
    }
    if (stemFile.size > MAX_AUDIO_BYTES) {
      return Response.json({ error: `Stem too large (${(stemFile.size / 1024 / 1024).toFixed(1)}MB) — 100MB max.` }, { status: 400 });
    }

    const row = await env.DB.prepare(`SELECT id FROM samples WHERE id = ?`).bind(sampleId).first();
    if (!row) return Response.json({ error: 'Sample not found.' }, { status: 404 });

    const r2Key = `stems/${sampleId}/${slugify(stemLabel)}-${Date.now()}${ext}`;
    try {
      await env.SAMPLES_BUCKET.put(r2Key, stemFile.stream(), {
        httpMetadata: { contentType: stemFile.type || 'audio/mpeg' },
      });
    } catch (err) {
      console.error('R2 stem upload failed:', err);
      return Response.json({ error: 'Stem upload to R2 failed.' }, { status: 500 });
    }

    const stemId = randomId();
    try {
      await env.DB.prepare(
        `INSERT INTO sample_stems (id, sample_id, label, filename, r2_key, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(stemId, sampleId, stemLabel, stemFile.name, r2Key, stemFile.size).run();
    } catch (err) {
      console.error('D1 stem insert failed — orphaned R2 key:', r2Key, err);
      return Response.json({ error: `Stem uploaded but registration failed. R2 key: ${r2Key}` }, { status: 500 });
    }

    // Mark sample as revisable now that it has stems
    await env.DB.prepare(`UPDATE samples SET revisable = 1 WHERE id = ?`).bind(sampleId).run().catch(() => {});
    return Response.json({ ok: true, id: stemId, r2_key: r2Key });
  }

  // ── Sample audio upload ───────────────────────────────────────────────────
  const file = form.get('file');
  const title = (form.get('title') || '').toString().trim();
  const genre = (form.get('genre') || '').toString().trim();
  const bpmRaw = (form.get('bpm') || '').toString().trim();
  const revisable = form.get('revisable') === '1';

  if (!(file instanceof File)) return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  if (!title) return Response.json({ error: 'Title is required.' }, { status: 400 });

  const ext = extOf(file.name);
  if (!ALLOWED_AUDIO_EXT.includes(ext)) {
    return Response.json(
      { error: `Unsupported file type "${ext || '(none)'}". Allowed: ${ALLOWED_AUDIO_EXT.join(', ')}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — 100MB max via this uploader. Use scripts/import-samples.mjs for bigger files.` },
      { status: 400 }
    );
  }

  const r2Key = `audio/${slugify(genre || 'misc')}/${slugify(title)}-${Date.now()}${ext}`;

  try {
    await env.SAMPLES_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || 'audio/mpeg' },
    });
  } catch (err) {
    console.error('R2 upload failed:', err);
    return Response.json({ error: 'Upload to R2 failed.' }, { status: 500 });
  }

  const id = randomId();
  try {
    await env.DB.prepare(
      `INSERT INTO samples (id, title, genre, bpm, r2_key, revisable) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, title, genre || null, bpmRaw ? parseInt(bpmRaw) : null, r2Key, revisable ? 1 : 0).run();
  } catch (err) {
    console.error('D1 insert failed after R2 upload — orphaned key:', r2Key, err);
    return Response.json(
      { error: `File uploaded but registration failed. Register it manually with R2 key: ${r2Key}` },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, id, r2_key: r2Key });
}
