#!/usr/bin/env node
/**
 * Task #10 (AP) — Runtime drift probe.
 *
 * Companion to the static checker (`scripts/check-api-drift.mjs`).
 * Probes a deployed Worker (preview or prod) for every `/api/...` path
 * the SPA derives in `frontend/src/lib/api.js`, asserting each returns
 * a non-404 status. Auth-protected routes are expected to return 401
 * (which we treat as "route exists"); only 404 is a drift failure.
 *
 * Usage (manual or from CI's playwright-smoke job):
 *   PLAYWRIGHT_BASE_URL=https://preview.example.workers.dev \
 *     node cloudflare-worker/scripts/drift-runtime-probe.mjs
 *
 * Exits non-zero on first 404. Prints a one-line summary on success.
 *
 * Why a separate script instead of a `wrangler dev` test?
 * - Probing a deployed env is the same drift signal with zero cold-start
 *   flake and no D1-binding race.
 * - When run from the playwright-smoke job (which already has
 *   PLAYWRIGHT_BASE_URL configured), it costs one extra network round
 *   per route — well under a minute total — and runs immediately before
 *   the browser specs so a 404 fails fast.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const API_FILE = resolve(REPO_ROOT, 'frontend', 'src', 'lib', 'api.js');

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
if (!baseUrl) {
  console.log('drift-runtime-probe: PLAYWRIGHT_BASE_URL not set — skipping (preview env not provisioned).');
  process.exit(0);
}

// Parse derived paths from api.js. Same regex shape the static checker
// uses (string + template-literal forms of `/api/...`).
const src = readFileSync(API_FILE, 'utf8');
const paths = new Set();
const reStr = /['"`](\/api\/[^'"`?\s${]+)/g;
for (const m of src.matchAll(reStr)) {
  // Normalise template segments and trailing punctuation.
  const p = m[1].replace(/\/+$/, '');
  if (p.length > 4) paths.add(p);
}

const probe = async (path) => {
  const url = baseUrl.replace(/\/$/, '') + path;
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual' });
    return { path, status: r.status };
  } catch (e) {
    return { path, status: 0, error: String(e?.message || e) };
  }
};

const sample = [...paths];
console.log(`drift-runtime-probe: probing ${sample.length} routes against ${baseUrl} …`);

const results = [];
const concurrency = 8;
for (let i = 0; i < sample.length; i += concurrency) {
  const batch = await Promise.all(sample.slice(i, i + concurrency).map(probe));
  results.push(...batch);
}

const drifted = results.filter(r => r.status === 404);
const errored = results.filter(r => r.status === 0);

if (drifted.length || errored.length) {
  if (drifted.length) {
    console.error(`\nDRIFT — ${drifted.length} route(s) returned 404:`);
    for (const r of drifted) console.error(`  ${r.path}`);
  }
  if (errored.length) {
    console.error(`\nNETWORK — ${errored.length} route(s) failed to fetch:`);
    for (const r of errored) console.error(`  ${r.path}: ${r.error}`);
  }
  process.exit(1);
}

console.log(`drift-runtime-probe: OK — ${results.length} routes, no 404s.`);
