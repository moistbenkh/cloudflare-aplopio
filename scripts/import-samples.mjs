#!/usr/bin/env node
// Run locally (not deployed) to bulk-import sample files.
//
// Usage:
//   node scripts/import-samples.mjs ./raw-samples
//   node scripts/import-samples.mjs ./raw-samples --local   (test against local dev DB/bucket)
//
// Expects a folder structure like:
//   raw-samples/
//     drill/dark-trap-01.mp3
//     drill/dark-trap-02.mp3
//     afrobeat/golden-hour.mp3
// The subfolder name becomes the "genre" tag; the filename (minus
// extension, dashes → spaces) becomes the title.
//
// IMPORTANT: only run this on files that already have your watermark baked
// in. This script does not add one — it just uploads and registers whatever
// you point it at.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.argv[2] || './raw-samples';
const LOCAL = process.argv.includes('--local');
// Must match [[r2_buckets]].bucket_name in wrangler.toml — it was
// previously hardcoded to 'aplo-samples' here while wrangler.toml declares
// 'samples-bucket', so every import silently wrote to the wrong bucket. If
// your wrangler.toml uses a different bucket_name, update this to match.
const BUCKET = 'samples-bucket';
const DB_NAME = 'aplo-db';

function randomId() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, URL-safe
}

function titleFromFilename(name) {
  return name.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
}

function walk(dir, genre = null) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, entry); // one level deep: subfolder name = genre
    } else if (['.mp3', '.wav', '.m4a'].includes(extname(entry).toLowerCase())) {
      importFile(full, genre, entry);
    }
  }
}

function importFile(filePath, genre, filename) {
  const id = randomId();
  const r2Key = `samples/${id}${extname(filename)}`;
  const title = titleFromFilename(filename);

  console.log(`Importing: ${filePath}  ->  id=${id}  genre=${genre || '(none)'}`);

  const r2Args = ['r2', 'object', 'put', `${BUCKET}/${r2Key}`, `--file=${filePath}`];
  if (LOCAL) r2Args.push('--local'); else r2Args.push('--remote');
  execFileSync('npx', ['wrangler', ...r2Args], { stdio: 'inherit' });

  const escapedTitle = title.replace(/'/g, "''");
  const escapedGenre = (genre || '').replace(/'/g, "''");
  const insertSql = `INSERT INTO samples (id, title, genre, r2_key) VALUES ('${id}', '${escapedTitle}', '${escapedGenre}', '${r2Key}');`;
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB_NAME,
    LOCAL ? '--local' : '--remote',
    '--command', insertSql,
  ], { stdio: 'inherit' });
}

console.log(`Scanning ${ROOT} ...`);
walk(ROOT);
console.log('Done.');
