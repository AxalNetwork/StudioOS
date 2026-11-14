/**
 * D6019 (#6019) — the Export button on Market intelligence, Demand and urgency
 * signals and Experiments and evidence, through the real CycleRoute: a click
 * downloads through `validateExportsApi`, a refusal draws the Worker's
 * sentence, and the evidence export (which names decisions) is not offered to
 * a viewer who may not read decisions. Every venture below is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_exports_6019.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { validateExportsApi } from '../src/lib/api/founderValidateExports.js';
import { installDocument } from './_contracts_dom.mjs';

const tick = () => new Promise((r) => setImmediate(r));

const NAMES = {
  'market-intelligence': ['Market intelligence', 'Competitors tracked'],
  'demand-signals': ['Demand and urgency signals', 'Signals'],
  experiments: ['Experiments and evidence', 'Hypotheses'],
};
const readOf = (slug, canReadDecisions = true) => ({
  module: { slug, name: NAMES[slug][0], records_title: NAMES[slug][1] },
  card: { slug, name: NAMES[slug][0], range: 'All time', caption: '', state: 'empty', series: null, next: null, reason: 'Nothing yet.' },
  records: { cols: [], rows: [], total: 0, page: 1, page_size: 25, filters: [], sorts: [], linkable: true },
  parts: { can_write: true },
  can_read_decisions: canReadDecisions,
});

async function mount(slug, { canReadDecisions = true, fail = null } = {}) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const before = { fetch: globalThis.fetch, module: cyclesApi.module, overview: cyclesApi.overview, ...validateExportsApi };
  const calls = [];
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });
  cyclesApi.module = async (...args) => readOf(args[2], canReadDecisions);
  cyclesApi.overview = async () => readOf(slug, canReadDecisions);
  for (const k of ['competitors', 'signals', 'evidence']) {
    validateExportsApi[k] = async (...args) => {
      calls.push([k, ...args]);
      if (fail) throw new Error(fail);
      return { filename: `${k}.csv`, rows: 0 };
    };
  }
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [`/validate/${slug}?project_id=7`] }, h(Routes, null,
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) })))));
  await act(async () => { await tick(); });
  const button = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label) || null;
  return {
    calls,
    text: () => textOf(container),
    button,
    async click(label) {
      const b = button(label);
      assert.ok(b, `No button: ${label}`);
      await act(async () => { await props(b).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await act(async () => { await tick(); await tick(); });
    },
    async unmount() {
      await act(async () => root.unmount());
      globalThis.fetch = before.fetch;
      cyclesApi.module = before.module; cyclesApi.overview = before.overview;
      for (const k of ['competitors', 'signals', 'evidence']) validateExportsApi[k] = before[k];
      restore();
    },
  };
}

const CASES = [
  ['market-intelligence', 'Export competitors', 'competitors'],
  ['demand-signals', 'Export signals', 'signals'],
  ['experiments', 'Export evidence', 'evidence'],
];

for (const [slug, label, method] of CASES) {
  test(`${slug}: ${label} downloads the venture's CSV`, async () => {
    const v = await mount(slug);
    try {
      await v.click(label);
      assert.deepEqual(v.calls, [[method, 7]]);
    } finally { await v.unmount(); }
  });
}

test('a refused export draws the Worker\'s sentence, and nothing else is called', async () => {
  const sentence = 'The waitlist could not be read, so nothing was exported. Nothing was changed. Try again.';
  const v = await mount('demand-signals', { fail: sentence });
  try {
    await v.click('Export signals');
    assert.ok(v.text().includes(sentence), v.text());
    assert.deepEqual(v.calls, [['signals', 7]]);
  } finally { await v.unmount(); }
});

test('the evidence export is not offered to a viewer who may not read decisions', async () => {
  const v = await mount('experiments', { canReadDecisions: false });
  try {
    assert.ok(v.button('Export evidence') === null, 'a partner was offered an export the Worker refuses them');
  } finally { await v.unmount(); }
});

test('each client method calls its mounted Worker route', () => {
  const src = readFileSync(new URL('../src/lib/api/founderValidateExports.js', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/founder_validate.ts', import.meta.url), 'utf8');
  for (const what of ['competitors', 'signals', 'evidence']) {
    assert.match(src, new RegExp(`/founder/validate/${what}/\\$\\{projectId\\}/export\\.csv`));
    assert.match(route, new RegExp(`founderValidate\\.get\\('/${what}/:projectId/export\\.csv'`));
  }
});
