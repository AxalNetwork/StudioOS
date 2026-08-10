/**
 * Signals — frontend honesty invariants.
 *
 * The /signals surface may serve a labeled example corpus until live
 * ingestion runs. These tests pin the disclosure contract so it cannot
 * silently regress back to "examples dressed as live data":
 *
 *   1. the page renders the illustrative banner off `data_state`,
 *   2. the KPI strip never fabricates a refresh time when none exists,
 *   3. the new live-pipeline evidence kinds render with real meta (no
 *      HelpCircle fallback chips on live data),
 *   4. the FastAPI dev router exists and is registered — the original 404.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/signals_honesty.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EVIDENCE_KIND_META, evidenceKindMeta } from '../src/lib/signalsMeta.js';
import SignalKPIStrip from '../src/components/signals/SignalKPIStrip.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRepo = (rel) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

test('SignalsPage renders the illustrative-data disclosure off data_state', () => {
  const src = read('src/pages/SignalsPage.jsx');
  assert.ok(src.includes("data_state === 'illustrative'"), 'page must branch on the provenance flag');
  assert.ok(src.includes('signals-illustrative-banner'), 'banner testid missing');
  assert.match(src, /Illustrative examples/i, 'the label must say what the data is');
});

test('KPI strip: null last_refreshed_at renders "not yet run", never a fake time', () => {
  const kpis = {
    active_signals: 4, avg_confidence: 60,
    top_regions: [{ region: 'Europe', count: 2 }],
    top_sectors: [{ sector: 'Technology', count: 2 }],
    freshest_updated_at: '2026-08-01T00:00:00Z',
    last_refreshed_at: null,
  };
  const html = renderToStaticMarkup(React.createElement(SignalKPIStrip, { kpis }));
  assert.match(html, /Live ingestion not yet run/);
  assert.ok(!/Refreshed just now/.test(html));

  const live = renderToStaticMarkup(React.createElement(SignalKPIStrip, {
    kpis: { ...kpis, last_refreshed_at: new Date().toISOString() },
  }));
  assert.match(live, /Refreshed/);
});

test('live-pipeline evidence kinds have real chip meta', () => {
  for (const kind of ['discussion', 'developer']) {
    assert.ok(EVIDENCE_KIND_META[kind], `${kind} missing from EVIDENCE_KIND_META`);
    const meta = evidenceKindMeta(kind);
    assert.ok(meta.label && meta.icon, `${kind} must not fall back to the unknown-kind chip`);
  }
});

test('the FastAPI dev router exists and is registered (the original 404)', () => {
  const routerSrc = readRepo('backend/app/api/routes/signals.py');
  for (const route of ['/signals', '/signals/filters', '/signals/kpis', '/signals/sources', '/signals/meta', '/signals/refresh', '/signals/{signal_id}']) {
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
