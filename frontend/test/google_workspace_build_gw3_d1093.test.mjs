// D1093 (#2958), part two — From Google on Build (GW3) and the roadmap Sheet's
// Map columns (GW4), mounted on the Worker side part one built
// (`routes/build_google.ts`). Stubbed fetch: no test reaches Google. Every
// name and figure is made up.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_workspace_build_gw3_d1093.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  DESIGN_COLUMNS, REQUIRED, ROADMAP_COLUMNS, ROADMAP_FIELDS, RoadmapFromGoogle, SolutionDesignFromGoogle,
  decodeRoadmap, designRows, encodeRoadmap, missingFields, roadmapRows, syncSentence,
} from '../src/pages/cycles/BuildFromGoogle.jsx';
import { BUILD_PARTS, builtParts } from '../src/pages/cycles/buildParts.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DOC = { uid: 'd1', project_id: 7, module: 'solution_design', kind: 'doc', name: 'Architecture spec', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', mapping: null };
const SHEET = { uid: 's1', project_id: 7, module: 'product_roadmap', kind: 'sheet', name: 'Roadmap 2027', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', mapping: null };
const READ = (over = {}) => ({
  files: [{ uid: 'd1', module: 'solution_design', kind: 'doc', name: 'Architecture spec', mapped: null, status: 'active' }, { uid: 's1', module: 'product_roadmap', kind: 'sheet', name: 'Roadmap 2027', mapped: true, status: 'active' }],
  proposals: [{ id: 12, file_id: 'g-doc-1', title: 'Architecture spec', headings: ['Overview', 'Data model', 'Risks'] }],
  roadmap: [
    { id: 3, objective: 'Launch the pilot', quarter: '2026-Q4', lane: 'now', key_result: 'Two paying pilots', progress: 40 },
    { id: 4, objective: 'Hire a designer', quarter: null, lane: 'next', key_result: null, progress: null },
  ],
  ...over,
});

async function mount(element, routes = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, alert: globalThis.alert, confirm: globalThis.confirm, open: globalThis.open };
  const popups = [];
  globalThis.alert = (...a) => popups.push(a); globalThis.confirm = (...a) => { popups.push(a); return true; }; globalThis.open = (...a) => { popups.push(a); return null; };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ key, search: url.search, body });
    if (routes[key]) return routes[key]({ url, body });
    return response({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[name](arg); }); await settle(); };
  return {
    seen, popups, writes: () => seen.filter((s) => !s.key.startsWith('GET ')),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), all: () => textOf(document.body),
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const filesRoute = (items) => ({ 'GET /api/connectors/google-workspace/files': () => response({ items }) });

// ---------------------------------------------------------------- the rules

test('the mapping in the Worker\'s shape: each field\'s column letter, from the header order; and back for the first guess', () => {
  const header = ['Goal', 'KR', 'When', 'State', 'Done %'];
  const m = { Goal: 'objective', KR: 'key_result', When: 'quarter', State: 'status', 'Done %': 'progress' };
  assert.deepEqual(encodeRoadmap(m, header), { header_row: 1, columns: { objective: 'A', key_result: 'B', quarter: 'C', status: 'D', progress: 'E' } });
  assert.deepEqual(encodeRoadmap({ Goal: 'objective', KR: '', When: 'quarter' }, header), { header_row: 1, columns: { objective: 'A', quarter: 'C' } }, 'Don’t use sends nothing');
  assert.deepEqual(decodeRoadmap({ header_row: 1, columns: { objective: 'A', status: 'D', quarter: 'Z' } }, header), { Goal: 'objective', State: 'status' }, 'a letter past the header is dropped');
  assert.equal(decodeRoadmap(null, header), null);
  assert.equal(decodeRoadmap({ Goal: 'objective' }, header), null, 'the dialog’s own shape is not the Worker’s');
  assert.deepEqual(missingFields({ columns: { objective: 'A' } }), ['quarter', 'status']);
  assert.deepEqual(missingFields(encodeRoadmap(m, header)), []);
  assert.deepEqual(REQUIRED, ['objective', 'quarter', 'status']);
  // The fields are the Worker's own names (services/google/buildFeeds.ts MAPPED_FIELDS).
  const feeds = read('cloudflare-worker/src/services/google/buildFeeds.ts');
  for (const f of ROADMAP_FIELDS) assert.ok(feeds.includes(`'${f.key}'`), f.key);
});

test('the rows: an empty value stays empty, so the section draws "—" with its reason; never 0', () => {
  const rows = roadmapRows(READ().roadmap);
  assert.deepEqual(rows[0].cells, { objective: 'Launch the pilot', key_result: 'Two paying pilots', quarter: '2026-Q4', progress: '40%' });
  assert.deepEqual(rows[1].cells, { objective: 'Hire a designer', key_result: null, quarter: null, progress: null });
  assert.deepEqual(roadmapRows([{ id: 1, objective: 'x', progress: 0 }])[0].cells.progress, '0%', 'a recorded 0 is a 0');
  assert.deepEqual(ROADMAP_COLUMNS.map((c) => c.label), ['Objective', 'Key result', 'Quarter', 'Progress']);
  assert.deepEqual(designRows(READ().proposals)[0].cells, { title: 'Architecture spec', headings: '3 headings' });
  assert.equal(designRows([{ id: 1, title: 't', headings: [] }])[0].cells.headings, 'No headings in the Doc');
  assert.deepEqual(DESIGN_COLUMNS.map((c) => c.label), ['Spec Doc', 'Headings']);
});

test('a sync in one sentence: counts only', () => {
  assert.equal(syncSentence({ proposed: 1, created: 2, updated: 1, held: 1, deleted_kept: 1, blank: 2, repeated: 1, unreadable: 1 }),
    '1 spec Doc proposed, 2 roadmap items added, 1 roadmap item updated. 1 item is held: another tool also feeds it. 1 item you deleted stays deleted. 2 rows have no objective. 1 objective is repeated in the Sheet and was not added. 1 file could not be read.');
  assert.equal(syncSentence({}), 'Nothing new in your Google files.');
  assert.match(syncSentence({ needs_mapping: 1 }), /needs its columns mapped first/);
  assert.equal(syncSentence(null), '');
});

test('the wiring: Google\'s two Build lines draw, between GitHub\'s and Notion\'s; one client; no pop-up, no hex', () => {
  assert.deepEqual(builtParts('solution-design').map(([k]) => k), ['github', 'vercel', 'google', 'notion']);
  assert.deepEqual(builtParts('product-roadmap').map(([k]) => k), ['github', 'google', 'notion', 'posthog']);
  assert.ok(BUILD_PARTS['solution-design'].some(([k, r]) => k === 'google' && typeof r === 'function'));
  const src = read('frontend/src/pages/cycles/BuildFromGoogle.jsx');
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(|window\.open/);
  assert.doesNotMatch(src, /(bg|text|border)-\[#/);
  assert.doesNotMatch(src, /console\.|localStorage/);
  assert.match(read('frontend/src/pages/cycles/MapColumnsDialog.jsx'), /encode = same, decode = same/);
});

// ---------------------------------------------------------------- Solution design

test('Solution design: each spec Doc\'s proposal, Accept in a dialog that says what it writes, then the module is read again', async () => {
  let reloaded = 0;
  let decided = false;
  const m = await mount(h(SolutionDesignFromGoogle, { projectId: 7, reload: () => { reloaded += 1; } }), {
    ...filesRoute([DOC]),
    'GET /api/cycles/build/google': () => response(decided ? READ({ proposals: [] }) : READ()),
    'POST /api/cycles/build/google/proposals/12/accept': () => { decided = true; return response({ ok: true, note_id: 5 }); },
  });
  try {
    assert.match(m.of('from-google'), /Architecture spec.*3 headings/s);
    assert.match(m.of('build-google-proposal-12'), /Overview.*Data model.*Risks/s);
    await m.click('build-google-accept-12');
    assert.match(m.of('build-google-accept-says'), /writes one Solution design note from the Doc’s title and headings/);
    assert.equal(m.writes().length, 0, 'nothing written before the confirm');
    await m.click('build-google-accept-confirm');
    assert.deepEqual(m.writes().map((w) => [w.key, w.body]), [['POST /api/cycles/build/google/proposals/12/accept', { project: 7 }]]);
    assert.equal(m.has('build-google-proposals'), false, 'the list is read again');
    assert.equal(reloaded, 1, 'the module re-reads to show the new note');
    assert.deepEqual(m.popups, []);
  } finally { await m.close(); }
});

test('Dismiss is its own dialog; a race already decided says so; a failed read says it is not none, with Try again', async () => {
  const m = await mount(h(SolutionDesignFromGoogle, { projectId: 7 }), {
    ...filesRoute([DOC]),
    'GET /api/cycles/build/google': () => response(READ()),
    'POST /api/cycles/build/google/proposals/12/dismiss': () => response({ code: 'decided' }, 409),
  });
  try {
    await m.click('build-google-dismiss-12');
    assert.match(m.of('build-google-dismiss-says'), /comes back only if the Doc’s title or headings change/);
    await m.click('build-google-dismiss-confirm');
    assert.match(m.of('build-google-dismiss'), /already decided/);
  } finally { await m.close(); }
  let calls = 0;
  const f = await mount(h(SolutionDesignFromGoogle, { projectId: 7 }), {
    'GET /api/cycles/build/google': () => { calls += 1; return calls === 1 ? response({ error: 'x' }, 500) : response(READ()); },
    ...filesRoute([DOC]),
  });
  try {
    assert.match(f.of('build-from-google'), /not the same as having none/);
    await f.click('build-from-google-retry');
    assert.equal(calls, 2);
    assert.ok(f.has('from-google'));
  } finally { await f.close(); }
});

// ---------------------------------------------------------------- Product roadmap

test('Product roadmap: the items this connection owns, "—" for an empty cell, and Sync says what landed', async () => {
  let reloaded = 0;
  const m = await mount(h(RoadmapFromGoogle, { projectId: 7, reload: () => { reloaded += 1; } }), {
    ...filesRoute([{ ...SHEET, mapping: { header_row: 1, columns: { objective: 'A', quarter: 'B', status: 'C' } } }]),
    'GET /api/cycles/build/google': () => response(READ()),
    'POST /api/cycles/build/google/sync': () => response({ files: [], totals: { created: 1, updated: 1, held: 0 } }),
  });
  try {
    const rows = m.of('from-google-rows');
    assert.match(rows, /Launch the pilot.*Two paying pilots.*2026-Q4.*40%/s);
    assert.match(rows, /Hire a designerKey result—Quarter—Progress—/);
    assert.doesNotMatch(rows, /\b0%/);
    assert.equal(m.has('build-google-needs-mapping'), false);
    await m.click('from-google-sync');
    assert.deepEqual(m.writes().map((w) => [w.key, w.body]), [['POST /api/cycles/build/google/sync', { project: 7 }]]);
    assert.equal(m.of('build-google-sync-note'), '1 roadmap item added, 1 roadmap item updated.');
    assert.equal(reloaded, 1);
  } finally { await m.close(); }
});

test('GW4: an unmapped Sheet lands nothing and offers Map columns; the dialog saves the Worker\'s shape and names what is still missing', async () => {
  const m = await mount(h(RoadmapFromGoogle, { projectId: 7 }), {
    ...filesRoute([SHEET]),
    'GET /api/cycles/build/google': () => response(READ({ files: [{ uid: 's1', module: 'product_roadmap', kind: 'sheet', name: 'Roadmap 2027', mapped: false, status: 'active' }], roadmap: [] })),
    'POST /api/connectors/google-workspace/files/s1/preview': () => response({ rows: [['Objective', 'Owner', 'Quarter', 'Status'], ['Launch the pilot', 'Ana', '2026-Q4', 'In progress']] }),
    'PUT /api/connectors/google-workspace/files/s1/mapping': () => response({ ok: true }),
  });
  try {
    assert.match(m.of('build-google-needs-mapping'), /lands nothing until its columns are mapped: Objective, Quarter and Status/);
    assert.equal(m.has('from-google-sync'), false, 'no Sync until it is mapped');
    await m.click('build-google-map');
    assert.ok(m.has('map-columns'));
    await m.change('map-columns-field-Owner', '');
    await m.click('map-columns-save');
    const put = m.writes().find((w) => w.key === 'PUT /api/connectors/google-workspace/files/s1/mapping');
    assert.deepEqual(put.body, { mapping: { header_row: 1, columns: { objective: 'A', quarter: 'C', status: 'D' } } });
    assert.equal(m.of('build-google-sync-note'), 'Saved. Sync from Google to read the Sheet with this mapping.');
    assert.deepEqual(m.popups, []);
  } finally { await m.close(); }
  const p = await mount(h(RoadmapFromGoogle, { projectId: 7 }), {
    ...filesRoute([SHEET]),
    'GET /api/cycles/build/google': () => response(READ({ files: [{ uid: 's1', module: 'product_roadmap', kind: 'sheet', name: 'Roadmap 2027', mapped: false }], roadmap: [] })),
    'POST /api/connectors/google-workspace/files/s1/preview': () => response({ rows: [['Goal', 'When'], ['Launch', 'Q4']] }),
    'PUT /api/connectors/google-workspace/files/s1/mapping': () => response({ ok: true }),
  });
  try {
    await p.click('build-google-map');
    await p.change('map-columns-field-Goal', 'objective');
    await p.click('map-columns-save');
    assert.equal(p.of('build-google-sync-note'), 'Saved. Still to map: Quarter, Status.');
  } finally { await p.close(); }
});

test('a saved mapping is the dialog\'s first guess, decoded from its letters', async () => {
  const m = await mount(h(RoadmapFromGoogle, { projectId: 7 }), {
    ...filesRoute([{ ...SHEET, mapping: { header_row: 1, columns: { objective: 'B', quarter: 'A', status: 'C' } } }]),
    'GET /api/cycles/build/google': () => response(READ()),
    'POST /api/connectors/google-workspace/files/s1/preview': () => response({ rows: [['When', 'What', 'State'], ['Q4', 'Launch', 'Done']] }),
    'PUT /api/connectors/google-workspace/files/s1/mapping': () => response({ ok: true }),
  });
  try {
    await m.click('build-google-remap');
    await m.click('map-columns-save');
    assert.deepEqual(m.writes().find((w) => w.key.startsWith('PUT')).body.mapping.columns, { quarter: 'A', objective: 'B', status: 'C' });
  } finally { await m.close(); }
});
