// D1166 (#2449) — Account › Usage › Storage, Usage's fourth page: its address
// (D1171, #3084, draws the page complete; its blocks are pinned in
// storage_page_d1171.test.mjs, and the "Not read here yet" pins left here)
// and navigation, today's one read (D642's /usage/storage) drawn by place,
// "Not read here yet" with its reason where no read exists (the allowance, by
// kind, by company, largest files), never a figure from the owner's table;
// the Overview's Storage card and #storage forward (STG17); and Cost no longer
// holding storage.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/storage_page_d1166.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import StoragePage from '../src/pages/account/StoragePage.jsx';
import UsageOverview, { StorageOverview } from '../src/pages/account/UsageOverview.jsx';
import { USAGE_PAGES, usagePageFor } from '../src/pages/account/limitsModel.js';
import { DOES_NOT_COUNT, STORAGE_PAGE } from '../src/pages/account/storagePageModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const area = (key, files, bytes) => ({ key, recorded: true, files, bytes, unknown_size_files: 0 });
const STORAGE = {
  total_bytes: 3 * 1024 ** 3, files: 42, unknown_size_files: 0,
  areas: [area('data_room', 20, 2 * 1024 ** 3), area('diligence_files', 2, 1024 ** 2), area('research_library', 10, 512 * 1024 ** 2),
    area('message_attachments', 8, 256 * 1024 ** 2), area('interview_recordings', 2, 255 * 1024 ** 2),
    ...['data_room_versions', 'session_audio', 'deck_reviews', 'validate_evidence', 'build_proofs', 'grow_minutes', 'brand_files', 'csv_imports'].map((k) => area(k, 0, 0)),],
};

async function mounted(url, element, path) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u).replace(/^.*\/api/, '')); return /\/usage\/storage/.test(String(u)) ? response(STORAGE) : response({}); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] },
    h(Routes, null, h(Route, { path, element }), h(Route, { path: '*', element: null })), h(Probe))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    requests, at, by,
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Storage is Usage\'s fourth page, at /account/usage/storage', () => {
  assert.deepEqual(USAGE_PAGES.map((p) => [p.id, p.label, p.path]).at(-1), ['storage', 'Storage', '/account/usage/storage']);
  assert.equal(usagePageFor('/account/usage/storage'), 'storage');
  assert.equal(usagePageFor('/settings/usage/storage/'), 'storage');
  assert.equal(usagePageFor('/account/usage/storage/x'), 'overview');
});

// D1171 (#3084): the blocks D1166 drew as "Not read here yet" now draw D1169's
// read (`storage_page_d1171`). What stays D1166's: What counts, byte for byte.
test('What counts is the canvas\'s, byte for byte', () => {
  assert.deepEqual([...DOES_NOT_COUNT], ['Identity documents', 'Signed legal copies', 'Fund documents', 'Anything Axal VC publishes']);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('the page: the header and one storage read, beside the public plans read (D1171)', async () => {
  const v = await mounted('/account/usage/storage', h(StoragePage, { role: 'founder' }), '/account/usage/storage');
  try {
    assert.ok(v.by('usage-storage-page'));
    assert.ok(v.text().includes(STORAGE_PAGE.sub));
    assert.equal(v.text('storage-does-not-count'), DOES_NOT_COUNT.map((r) => `• ${r}`).join(' '));
    assert.deepEqual(v.requests.filter((r) => r === '/usage/storage'), ['/usage/storage'], 'one storage read, D642\'s as D1169 grew it');
  } finally { await v.close(); }
});

// D1171: the Overview card draws X of Y from the plan; storage_page_d1171 pins it.
test('Overview: a Storage card with a door to the page, and a missing total never drawn as a size', () => {
  const ready = { status: 'ready', data: STORAGE, reload() {} };
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(StorageOverview, { storage: ready })));
  assert.match(out, /href="\/account\/usage\/storage"/);
  const partial = renderToStaticMarkup(h(MemoryRouter, null, h(StorageOverview, { storage: { ...ready, data: { ...STORAGE, total_bytes: null, measured_bytes: null } } })));
  assert.match(partial, /Not recorded/);
  assert.doesNotMatch(partial, /0 B|overview-storage-total/, 'a missing total is never drawn as a size');
});

test('an old #storage link on Overview opens the Storage page; the other anchors still open Cost', async () => {
  let v = await mounted('/account/usage#storage', h(UsageOverview, { role: 'founder' }), '/account/usage');
  try { assert.equal(v.at.path, '/account/usage/storage'); } finally { await v.close(); }
  v = await mounted('/account/usage#days', h(UsageOverview, { role: 'founder' }), '/account/usage');
  try { assert.equal(v.at.path, '/account/usage/cost'); } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the pane opens the page, Cost no longer holds storage, and the canvas is in incoming', () => {
  assert.match(read('frontend/src/pages/SettingsPage.jsx'), /usagePage === 'storage' \? <StoragePage role=\{role\} \/>/);
  const cost = read('frontend/src/pages/account/CostPage.jsx');
  assert.ok(cost.includes('rate card and last run</summary>') && cost.includes('{COST_STORAGE_NOTE}'));
  assert.ok(!/<StorageCard/.test(read('frontend/src/pages/account/AccountUsage.jsx').split('export default function UsageSection')[1]), 'the desktop Cost details draw no storage card');
  for (const f of ['Account Storage Page.dc.html', 'Storage · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Storage · Boards.dc.html').includes('Account Storage Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1166.md'));
  assert.ok(existsSync('documentation/audits/STORAGE_MAP_2026-10-25.md'));
});
