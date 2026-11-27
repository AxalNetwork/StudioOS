/**
 * Signals — frontend honesty invariants.
 *
 * The signals store may serve a labeled example corpus until live ingestion
 * runs. These tests pin the two halves that outlived the /signals page
 * (retired by D670, with its illustrative banner, KPI strip and chip meta):
 *
 *   1. the FastAPI dev router exists and is registered — the original 404,
 *   2. the worker refresh persists, and holds a thesis below the evidence bar.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/signals_honesty.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readRepo = (rel) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

test('the FastAPI dev router exists and is registered (the original 404)', () => {
  const routerSrc = readRepo('backend/app/api/routes/signals.py');
  // The two reads Research still makes; the page-only routes left the Worker
  // with the page (D670) and the dev router need not keep them.
  for (const route of ['/signals', '/signals/sources']) {
    assert.ok(routerSrc.includes(`"${route}"`), `dev router missing ${route}`);
  }
  assert.ok(routerSrc.includes('"illustrative"'), 'dev responses must carry the provenance label');
  const mainSrc = readRepo('backend/app/main.py');
  assert.ok(/import signals as _signals/.test(mainSrc), 'router not imported in main.py');
  assert.ok(/_signals\.router/.test(mainSrc), 'router not registered in main.py');
});

test('the worker refresh actually persists (no return to the throwaway warm-up)', () => {
  const engine = readRepo('cloudflare-worker/src/services/signals/engine.ts');
  assert.ok(engine.includes('runIngestion'), 'runRefresh must delegate to the persisting ingestion');
  const ingest = readRepo('cloudflare-worker/src/services/signals/ingest.ts');
  assert.ok(ingest.includes('INSERT INTO signal_evidence'), 'evidence must be written to D1');
  assert.ok(ingest.includes("'needs_evidence'"), 'below-threshold theses must be held, not shown');
});
