#!/usr/bin/env node
/** D6651: fails on a put or delete of a `record` R2 prefix outside `cloudflare-worker/src/services/recordStore.ts` (writes) and `cloudflare-worker/src/services/recordErasure.ts` (deletes); baseline `record-writes-baseline.json` started empty. */
/**
 * D6651 (#6651) — record files are write-once: no direct write or delete of a `record` prefix outside its helper.
 *
 *   node scripts/check-record-writes.mjs     # test:guards
 *
 * R2 keeps no previous versions, so an overwrite or a delete of a `record` object cannot be undone
 * from the bucket. Every R2 mutation the D6650 inventory classes as touching a `record` prefix
 * (`documentation/operations/R2_INVENTORY.json`) must sit in one of two files:
 *
 *   - `cloudflare-worker/src/services/recordStore.ts` — the write-once puts (the only writer);
 *   - `cloudflare-worker/src/services/recordErasure.ts` — the one audited delete path (#6652 A, #6654).
 *
 * A `.put(`, multipart write or `.delete(` of a record prefix anywhere else fails, naming the file,
 * line, operation and key. `scripts/record-writes-baseline.json` lists sites allowed to remain while
 * they move; it started empty and an entry whose site no longer exists also fails. Replaceable media
 * and logs are out of scope. Reads source only (the same typed scan as the inventory); no bucket is
 * contacted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanR2, bucketDeclarations, classifyCalls } from './build-r2-inventory.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const RECORD_WRITER = 'cloudflare-worker/src/services/recordStore.ts';
export const RECORD_ERASER = 'cloudflare-worker/src/services/recordErasure.ts';
export const BASELINE = 'scripts/record-writes-baseline.json';

const site = (c) => [c.file, c.scope, c.method, c.key].join(' | ');

/**
 * The classified call sites that touch a `record` class outside the file allowed to: writes outside
 * `writer`, deletes outside `eraser`. A site listed in `baseline` is tolerated; a baseline entry with
 * no live site is reported as stale.
 */
export function recordViolations(sites, registry, { writer = RECORD_WRITER, eraser = RECORD_ERASER, baseline = [] } = {}) {
  const records = new Set(registry.classes.filter((c) => c.class === 'record').map((c) => c.id));
  const allowed = new Set(baseline);
  const violations = [];
  const seen = new Set();
  for (const c of sites) {
    const touched = c.classes.filter((id) => records.has(id));
    if (!touched.length) continue;
    const home = c.method === 'delete' ? eraser : writer;
    if (c.file === home) continue;
    seen.add(site(c));
    if (allowed.has(site(c))) continue;
    const via = c.method === 'delete' ? 'eraseRecordObjects (recordErasure.ts)' : 'putRecord (recordStore.ts)';
    violations.push(`${c.file}:${c.line}: ${c.method} of a record prefix (${touched.join(', ')}) with key ${c.key}; use ${via}`);
  }
  const stale = baseline.filter((s) => !seen.has(s));
  return { violations, stale };
}

/** Scan `root` and apply the rule. Exported for the synthetic fixtures in the test. */
export function checkRecordWrites(root = ROOT, { configPaths, registry, baseline, writer, eraser } = {}) {
  const reg = registry ?? JSON.parse(readFileSync(resolve(root, 'documentation/operations/R2_INVENTORY.json'), 'utf8'));
  const base = baseline ?? JSON.parse(readFileSync(resolve(root, BASELINE), 'utf8')).sites;
  const sites = classifyCalls(configPaths ? scanR2(root, configPaths) : scanR2(root), reg, bucketDeclarations(root));
  return { ...recordViolations(sites, reg, { writer, eraser, baseline: base }), sites: sites.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { violations, stale, sites } = checkRecordWrites();
    for (const s of stale) violations.push(`${BASELINE}: "${s}" no longer exists; remove it (the baseline only shrinks)`);
    if (violations.length) {
      console.error(`Record files are write-once (D6651). ${violations.length} problem(s):\n${violations.map((v) => `  ${v}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`Record writes: ${sites} R2 mutator sites; every record put is in recordStore.ts and every record delete in recordErasure.ts.`);
    }
  } catch (error) {
    console.error(`Record-write check refused: ${error.message}`);
    process.exitCode = 1;
  }
}
