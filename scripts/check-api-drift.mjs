#!/usr/bin/env node
/**
 * T1 — API ↔ Worker drift smoke test.
 *
 * Statically analyses `frontend/src/lib/api.js` and `cloudflare-worker/src/index.ts`
 * to ensure every `/api/...` path the SPA calls is mounted on a real Hono
 * router in the production worker.
 *
 * Why static and not curl-based?
 * - The production worker runs on Cloudflare; we don't always have a deployed
 *   preview URL inside CI.
 * - The dev FastAPI is NOT canonical; matching against it would hide real prod
 *   drift (audit's whole point).
 * - Static analysis is deterministic and runs in <1s with no secrets.
 *
 * Exits 0 on clean, 1 on drift (any path called by the SPA but not mounted by
 * the worker, excluding the known-broken allowlist below).
 *
 * SCOPE / LIMITATION (Phase 1):
 * This is a PREFIX-level checker. It catches "frontend calls /api/foo when no
 * /api/foo router is mounted" (the gross drift class). It does NOT catch
 * sub-route drift like "/api/foo IS mounted but /api/foo/bar
 * isn't actually defined inside foo.ts". Sub-route enumeration requires
 * crawling each cloudflare-worker/src/routes/*.ts and is added in T11–T15
 * when those routers are ported from FastAPI.
 *
 * Allowlist policy: every entry MUST cite a TODO/issue/audit-task id. We want
 * the list to shrink, never grow.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

const API_FILE    = resolve(ROOT, 'frontend/src/lib/api.js');
const WORKER_FILE = resolve(ROOT, 'cloudflare-worker/src/index.ts');

// ---------------------------------------------------------------------------
// Known-broken endpoints that the SPA calls but the worker does not (yet)
// mount. Each entry must reference a tracking task. The drift checker EXITS
// CLEAN when only these are missing — but flags any NEW drift loudly.
// ---------------------------------------------------------------------------
const KNOWN_DRIFT_ALLOWLIST = new Set([
  // T10 — calendar (incl. Google + Microsoft sync) shipped on worker.
  // T11 — financials port pending
  '/financials/model',
  '/financials/runway',
  '/financials/breakeven',
  // T12 — wellbeing / compliance port pending
  '/wellbeing/checkin',
  '/wellbeing/resources',
  '/wellbeing/aggregates',
  '/compliance/events',
  // T13 — captable port pending (advisors/partner-office-hours/cofounder shipped)
  '/captable/scenarios',
  '/captable/waterfall',
  // T14 — references audio recording / transcribe / summarize stubbed (501)
  '/references/transcripts',
]);

// ---------------------------------------------------------------------------
// Extract every literal path the SPA hits via the `request()` helper.
//
// The helper's contract: every call lands at `${BASE}${path}` where
// BASE = '/api'. We extract `path` from string literals and template strings
// passed to request(). Dynamic segments (e.g. `/projects/${id}`) are
// normalised to a `:param` placeholder so we can compare against the
// worker's Hono routes.
// ---------------------------------------------------------------------------
function extractClientPaths(src) {
  const paths = new Set();
  // Match request('...'), request(`...`), and the convenience verbs (get/post/put/patch/del).
  // Captures the first string/template argument.
  const callRe = /\b(?:request|api\.\w+)\s*\(\s*(['"`])([^'"`$\n]+)\1/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    let p = m[2];
    if (!p.startsWith('/')) continue;
    paths.add(p);
  }
  // Also pick up template-literal paths: request(`/projects/${id}/...`)
  const tplRe = /\b(?:request|api\.\w+)\s*\(\s*`([^`]+)`/g;
  while ((m = tplRe.exec(src)) !== null) {
    let p = m[1];
    if (!p.startsWith('/')) continue;
    // Replace `${...}` with :param
    p = p.replace(/\$\{[^}]+\}/g, ':param');
    paths.add(p);
  }
  return [...paths];
}

// ---------------------------------------------------------------------------
// Extract every prefix the worker mounts via `app.route('/api/<prefix>', ...)`.
// We do NOT try to enumerate sub-routes per router — that would require
// crawling each routes/*.ts. Instead: a SPA path matches if its prefix is
// mounted. False negatives (router mounted but sub-route missing) are caught
// at runtime by the SPA's existing 404 handling; this checker is for the
// gross prefix-level drift only.
// ---------------------------------------------------------------------------
function extractWorkerMounts(src) {
  const prefixes = new Set();
  const re = /app\.route\(\s*['"`](\/api[^'"`]*)['"`]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    prefixes.add(m[1]);
  }
  return [...prefixes].sort((a, b) => b.length - a.length);
}

function isCovered(path, mountPrefixes) {
  // path is the SPA-side string AFTER the '/api' base — i.e. starts with '/'.
  const fullPath = '/api' + path;
  return mountPrefixes.some((pfx) => fullPath === pfx || fullPath.startsWith(pfx + '/'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const apiSrc    = readFileSync(API_FILE, 'utf8');
const workerSrc = readFileSync(WORKER_FILE, 'utf8');

const clientPaths   = extractClientPaths(apiSrc);
const workerPrefixes = extractWorkerMounts(workerSrc);

const drift = [];
const expectedDrift = [];
for (const p of clientPaths) {
  if (isCovered(p, workerPrefixes)) continue;
  // Allowlist match — exact OR prefix
  const allowed = [...KNOWN_DRIFT_ALLOWLIST].some(
    (a) => p === a || p.startsWith(a + '/'),
  );
  (allowed ? expectedDrift : drift).push(p);
}

console.log(`[drift] SPA paths examined:   ${clientPaths.length}`);
console.log(`[drift] Worker mount prefixes: ${workerPrefixes.length}`);
console.log(`[drift] Known-pending (allowlisted): ${expectedDrift.length}`);

if (drift.length > 0) {
  console.error('\n❌ NEW API DRIFT — these SPA calls have no worker mount and no allowlist entry:\n');
  for (const p of drift.sort()) console.error(`   - ${p}`);
  console.error(
    '\nFix one of:\n' +
    '  1. Mount the route in cloudflare-worker/src/index.ts (preferred — production parity).\n' +
    '  2. Remove the call from frontend/src/lib/api.js (if dead code).\n' +
    '  3. Add to KNOWN_DRIFT_ALLOWLIST in this script with a tracking task id.\n'
  );
  process.exit(1);
}

console.log('\n✅ No new API ↔ Worker drift detected.');
process.exit(0);
