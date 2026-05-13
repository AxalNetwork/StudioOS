#!/usr/bin/env node
/**
 * Task #5 (CH) — writeRouter coverage CI.
 *
 * Asserts that every advisor question id in the worker banks is
 * EITHER:
 *   (a) handled by `cloudflare-worker/src/services/advisor/writeRouter.ts`
 *       (colMap/map/partnerMap/special-case branch), so its answer
 *       updates a typed domain column; OR
 *   (b) explicitly listed (by id or id-prefix pattern) in
 *       `cloudflare-worker/src/services/advisor/no_write_allowlist.json`,
 *       acknowledging that the answer intentionally only persists in
 *       `advisor_answers` (and optionally `advisor_extras_json`).
 *
 * Adding a new bank id without doing one of the two above fails CI,
 * preventing silent drops of answers.
 *
 * Wired into `scripts/check-advisor-bank-drift.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = resolve(HERE, '../cloudflare-worker/src/services/advisor');

const manifest = JSON.parse(readFileSync(resolve(WORKER_SRC, 'banks.manifest.json'), 'utf8'));
const writeRouter = readFileSync(resolve(WORKER_SRC, 'writeRouter.ts'), 'utf8');
const allowlist = JSON.parse(readFileSync(resolve(WORKER_SRC, 'no_write_allowlist.json'), 'utf8'));

// Extract every advisor question id REFERENCED by writeRouter.ts.
// We pull every string-literal id-shaped token that appears after
// `questionId === 'X'`, inside `colMap`/`map`/`partnerMap` Record
// initialisers, and inside `Set<string>([...])` literals.
function extractRouterIds(src) {
  const ids = new Set();
  // (1) `questionId === 'foo.bar.baz'` direct equality checks.
  const eqRe = /questionId\s*===\s*['"]([a-z_][\w.]+)['"]/g;
  let m;
  while ((m = eqRe.exec(src)) !== null) ids.add(m[1]);
  // (2) Map/Record entries: `'foo.bar': ...,` (excluding column-name
  //     values which never contain dots in our schema).
  const recRe = /['"]([a-z_]+(?:\.[a-z_]+){2,})['"]\s*:/g;
  while ((m = recRe.exec(src)) !== null) ids.add(m[1]);
  // (3) Set initialisers: `'foo.bar.baz',`
  const setRe = /['"]([a-z_]+(?:\.[a-z_]+){2,})['"]\s*,/g;
  while ((m = setRe.exec(src)) !== null) ids.add(m[1]);
  return ids;
}

const routerIds = extractRouterIds(writeRouter);
const allowPatterns = (allowlist.patterns || []).map((p) => new RegExp(p));
const allowIds = new Set(allowlist.ids || []);

function isAllowed(id) {
  if (allowIds.has(id)) return true;
  for (const re of allowPatterns) if (re.test(id)) return true;
  return false;
}

const orphans = [];
let total = 0;
for (const [bank, rows] of Object.entries(manifest.banks)) {
  if (bank === 'roleDetector') continue; // handled by routeIfRoleDetector branch
  for (const r of rows) {
    total++;
    if (routerIds.has(r.id)) continue;
    if (isAllowed(r.id)) continue;
    orphans.push(`${bank}/${r.id}`);
  }
}

if (orphans.length) {
  console.error(`[write-router-coverage] FAIL — ${orphans.length} bank ids are neither routed nor allowlisted:`);
  for (const o of orphans.slice(0, 20)) console.error(`  ${o}`);
  if (orphans.length > 20) console.error(`  ... (+${orphans.length - 20} more)`);
  console.error('');
  console.error('  fix: either add the id to writeRouter.ts (colMap / map / partnerMap)');
  console.error('       or list the id (or a prefix pattern) in cloudflare-worker/src/services/advisor/no_write_allowlist.json');
  process.exit(1);
}

console.log(`[write-router-coverage] OK — ${total} bank ids, ${routerIds.size} routed, rest allowlisted.`);
