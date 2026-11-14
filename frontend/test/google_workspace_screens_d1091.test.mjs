// D1091 (#2956), the screens D1314 gives it: Google Workspace's connector-page
// section (GW1, GW2, GW8), the shared From Google section (GW3's frame, GW7's
// four states) and Map columns (GW4). Mounted on a stubbed fetch and a stubbed
// picker: no test reaches Google. Every name and figure is made up.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_workspace_screens_d1091.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import GoogleWorkspaceFiles from '../src/pages/account/GoogleWorkspaceFiles.jsx';
import FromGoogle from '../src/pages/cycles/FromGoogle.jsx';
import MapColumnsDialog, { guessMapping } from '../src/pages/cycles/MapColumnsDialog.jsx';
import {
  deleteRowCopy, filesLine, mappingProblems, modulePath, partlyLine, problemCopy, sourceLine, statePill, stopCopy, unreadableCopy, workspaceRefusal,
} from '../src/lib/googleWorkspaceWords.js';
import { pageAction } from '../src/pages/account/connectorPageModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const FILES = [
  { uid: 'f1', project_id: 7, module: 'product_roadmap', kind: 'sheet', name: 'Roadmap 2027', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', venture_name: 'Harbor Field', mapping: null },
  { uid: 'f2', project_id: 7, module: 'demand_signals', kind: 'form', name: 'Waitlist survey', status: 'active', last_synced_at: null, venture_name: 'Harbor Field', mapping: null },
];
const PROJECTS = { projects: [
  { id: 7, name: 'Harbor Field', my_seat: 'owner', company_id: 3, company_name: 'Harbor Ledger' },
  { id: 8, name: 'Loose venture', my_seat: 'owner', company_id: null, company_name: null },
] };

async function mount(element, routes = {}) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    seen.push({ key, search: url.search, body: init.body ? JSON.parse(init.body) : null });
    if (routes[key]) return routes[key]({ url, body: init.body ? JSON.parse(init.body) : null });
    return response({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[name](arg); }); await settle(); };
  return {
    seen, writes: () => seen.filter((s) => !s.key.startsWith('GET ')).map((s) => s.key),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length, prop: (id, k) => props(byId(id))?.[k],
    attr: (id, k) => byId(id)?.getAttribute?.(k) ?? props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const mineOf = (over = {}) => ({ 'GET /api/connectors/google-workspace/mine': () => response({ state: 'ready', account_email: 'ana@example.test', items: FILES, ventures: 1, ...over }) });

// ---------------------------------------------------------------- the words

test('the words: the pill, the line, Stop using, the refusals, never a token', () => {
  assert.deepEqual(statePill('ready', 'ana@example.test'), { tone: 'ok', text: '✓ Connected · ana@example.test' });
  assert.deepEqual(statePill('workspace_not_allowed'), { tone: 'warn', text: 'Files not allowed yet' });
  assert.deepEqual(statePill('google_not_connected'), { tone: 'neutral', text: 'Google not connected' });
  assert.equal(filesLine(5, 1), '5 files · 1 venture');
  assert.equal(filesLine(1, 2), '1 file · 2 ventures');
  assert.equal(modulePath('product_roadmap'), 'Build › Product roadmap');
  const stop = stopCopy(FILES[0], 6);
  assert.deepEqual([stop.title, stop.keeps, stop.google], ['Stop using “Roadmap 2027”?',
    'Product roadmap keeps the 6 rows already read, marked “No longer synced”.', 'Axal VC can no longer open this file. The file in Google is not changed.']);
  assert.equal(stopCopy(FILES[0]).keeps, 'Product roadmap keeps what it already read, marked “No longer synced”.', 'no invented row count');
  assert.match(workspaceRefusal({ code: 'file_not_shared' }), /did not let Axal VC open that file/);
  assert.match(workspaceRefusal({ code: 'something_else' }), /Nothing changed/);
  assert.equal(pageAction({ key: 'google_workspace', auth_type: 'oauth2', status: 'coming_soon', display_name: 'Google Workspace' }).kind, 'none', 'the section owns the action');
});

test('From Google\'s words (GW3, GW7) and the date check (GW4)', () => {
  assert.equal(sourceLine({ file: FILES[0], state: 'ready' }), '“Roadmap 2027” · From Google Sheets, as of 2026-10-21');
  assert.equal(sourceLine({ file: FILES[0], state: 'unreadable' }), '“Roadmap 2027” · last read 2026-10-21');
  assert.equal(sourceLine({ file: null, state: 'empty' }), 'No file chosen');
  assert.equal(partlyLine(4, 6), 'Partly synced: 4 of 6 rows read.');
  assert.equal(unreadableCopy(FILES[0], 6).body, 'Google says the file was moved, or you no longer have access to it. The 6 rows read on 2026-10-21 are kept below.');
  assert.deepEqual(deleteRowCopy({ row: 'Median booking time under 2 minutes', module: 'product_roadmap', file: 'Roadmap 2027' }), {
    title: 'Delete this row?', body: '“Median booking time under 2 minutes” leaves Product roadmap. It stays deleted when you sync again.',
    google: '“Roadmap 2027” in Google is not changed.', button: 'Delete' });
  const header = ['Date', 'MRR', 'Notes'];
  const rows = [['2026-05', '4100', 'a'], ['TBD', '5300', 'b'], ['Q3', 'x', ''], ['', '7000', '']];
  const fields = [{ key: 'month', label: 'Month', type: 'date' }, { key: 'mrr', label: 'MRR (EUR)', type: 'number' }];
  const problems = mappingProblems(header, rows, { Date: 'month', MRR: 'mrr', Notes: '' }, fields);
  assert.deepEqual(problems.map((p) => [p.column, p.rows.map((r) => r.row)]), [['Date', [3, 4, 5]], ['MRR', [4]]]);
  assert.deepEqual(problemCopy(problems[0]), { line: 'Date column has 3 rows that are not dates. They will be skipped.', rows: 'Rows 3, 4 and 5 read “TBD”, “Q3” and a blank cell.' });
  assert.equal(problemCopy(problems[1]).line, 'MRR column has 1 row that is not a number. It will be skipped.');
  assert.deepEqual(guessMapping(['Month', 'Notes'], fields), { Month: 'month', Notes: '' });
});

// ---------------------------------------------------------------- GW1, GW2, GW8

test('GW1: permission, the files with venture, module and last read, and a never-read file said, never blank', async () => {
  const v = await mount(h(GoogleWorkspaceFiles), mineOf());
  try {
    assert.match(v.of('gw-pill'), /✓ Connected · ana@example.test/);
    assert.match(v.of('gw-permission'), /Permission: files you choose.*Only files you pick.*Read only: Axal VC never edits, moves or deletes them/s);
    assert.equal(v.of('gw-files-line'), '2 files · 1 venture');
    assert.equal(v.count('gw-file-row'), 2);
    assert.match(v.of('gw-files-table'), /Roadmap 2027.*Sheet.*Harbor Field.*Build › Product roadmap.*2026-10-21 07:55/s);
    assert.match(v.of('gw-files-table'), /Waitlist survey.*Form.*Validate › Demand and urgency signals.*Not read yet/s);
    assert.equal(v.count('gw-file-item'), 2, 'GW8: the same files as a stacked list on a phone');
    assert.match(String(v.prop('gw-stop-phone-f1', 'className')), /min-h-\[44px\]/, 'a 44 px target');
    assert.deepEqual(v.writes(), [], 'reading changes nothing');
  } finally { await v.close(); }
});

test('GW1: Stop using says what it keeps and that Google is not changed, then stops', async () => {
  const v = await mount(h(GoogleWorkspaceFiles), { ...mineOf(), 'DELETE /api/connectors/google-workspace/files/f1': () => response({ stopped: true, facts_kept: true }) });
  try {
    await v.click('gw-stop-f1');
    assert.equal(v.of('gw-stop-keeps'), 'Product roadmap keeps what it already read, marked “No longer synced”.');
    assert.equal(v.of('gw-stop-google'), 'Axal VC can no longer open this file. The file in Google is not changed.');
    assert.deepEqual(v.writes(), [], 'nothing before the confirm');
    await v.click('gw-stop-confirm');
    assert.deepEqual(v.writes(), ['DELETE /api/connectors/google-workspace/files/f1']);
    assert.match(v.of('gw-done'), /no longer opens “Roadmap 2027”/);
  } finally { await v.close(); }
});

test('GW2: not allowed yet: Allow Google files asks the venture and its company, ticked, then goes to Google\'s consent', async () => {
  const assigned = [];
  const v = await mount(h(GoogleWorkspaceFiles, { assign: (u) => assigned.push(u) }), {
    ...mineOf({ state: 'workspace_not_allowed', items: [], ventures: 0 }),
    'GET /api/account/projects': () => response(PROJECTS),
    'POST /api/calendar/google/workspace-files/connect': () => response({ redirect_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
  });
  try {
    assert.match(v.of('gw-pill'), /Files not allowed yet/);
    assert.ok(!v.has('gw-files') && !v.has('gw-choose-button'));
    await v.click('gw-allow-button');
    assert.match(v.of('gw-allow-venture'), /Harbor Field · Harbor Ledger/);
    assert.doesNotMatch(v.of('gw-allow-venture'), /Loose venture/, 'a venture in no company cannot hold Google files');
    await v.change('gw-allow-venture', '7');
    assert.ok(v.prop('gw-allow-confirm', 'disabled'), 'the company switch is never inferred');
    await v.change('gw-allow-enable', true);
    await v.click('gw-allow-confirm');
    const call = v.seen.find((s) => s.key === 'POST /api/calendar/google/workspace-files/connect');
    assert.deepEqual(call.body, { project: 7, enable_company: true });
    assert.deepEqual(assigned, ['https://accounts.google.com/o/oauth2/v2/auth?x=1']);
  } finally { await v.close(); }
});

test('GW2: a consent answer that is not Google\'s is refused, and a refusal is said in the dialog', async () => {
  const assigned = [];
  const v = await mount(h(GoogleWorkspaceFiles, { assign: (u) => assigned.push(u) }), {
    ...mineOf({ state: 'workspace_not_allowed', items: [], ventures: 0 }),
    'GET /api/account/projects': () => response(PROJECTS),
    'POST /api/calendar/google/workspace-files/connect': () => response({ redirect_url: 'https://evil.example/consent' }),
  });
  try {
    await v.click('gw-allow-button');
    await v.change('gw-allow-venture', '7');
    await v.change('gw-allow-enable', true);
    await v.click('gw-allow-confirm');
    assert.deepEqual(assigned, []);
    assert.match(v.of('gw-allow-refusal'), /did not answer with its consent page/);
  } finally { await v.close(); }
});

test('GW2: no Google sign-in: the Google page, and no Allow', async () => {
  const v = await mount(h(GoogleWorkspaceFiles), mineOf({ state: 'google_not_connected', account_email: null, items: [], ventures: 0 }));
  try {
    assert.match(v.of('gw-no-google'), /Google is not connected yet.*Connect your Google account first/s);
    assert.equal(v.prop('gw-open-google', 'href'), '/account/connectors/google');
    assert.ok(!v.has('gw-allow-button') && !v.has('gw-choose-button'));
  } finally { await v.close(); }
});

test('GW1: Choose files: the venture and the module, Google\'s picker (stubbed), then the Worker confirms; an unset picker says so', async () => {
  const chosen = [];
  const picker = { load: async () => {}, choose: async (config) => { chosen.push(config); return ['drive-id-1']; } };
  let configured = true;
  const v = await mount(h(GoogleWorkspaceFiles, { picker }), {
    ...mineOf(),
    'GET /api/account/projects': () => response(PROJECTS),
    'GET /api/connectors/google-workspace/picker-config': () => response({ state: 'ready', configured, api_key: 'k', app_id: '1', client_id: 'c', scope: 'https://www.googleapis.com/auth/drive.file' }),
    'POST /api/connectors/google-workspace/files': () => response({ added: 1 }, 201),
  });
  try {
    await v.click('gw-choose-button');
    await v.change('gw-choose-venture', '7');
    await v.change('gw-choose-module', 'product_roadmap');
    await v.click('gw-choose-confirm');
    assert.equal(chosen.length, 1);
    const post = v.seen.find((s) => s.key === 'POST /api/connectors/google-workspace/files');
    assert.deepEqual(post.body, { project: 7, module: 'product_roadmap', ids: ['drive-id-1'] });
    assert.match(v.of('gw-done'), /1 file chosen for Build › Product roadmap/);
  } finally { await v.close(); }
  configured = false;
  const w = await mount(h(GoogleWorkspaceFiles, { picker }), {
    ...mineOf(), 'GET /api/account/projects': () => response(PROJECTS),
    'GET /api/connectors/google-workspace/picker-config': () => response({ state: 'ready', configured: false }),
  });
  try {
    await w.click('gw-choose-button');
    await w.change('gw-choose-venture', '7');
    await w.change('gw-choose-module', 'product_roadmap');
    await w.click('gw-choose-confirm');
    assert.match(w.of('gw-choose-refusal'), /file picker is not set up on Axal yet/);
    assert.deepEqual(w.writes(), []);
  } finally { await w.close(); }
});

test('a failed read is Unreadable, never "no files"', async () => {
  const v = await mount(h(GoogleWorkspaceFiles), { 'GET /api/connectors/google-workspace/mine': () => response({ error: 'workspace_unreadable' }, 503) });
  try {
    assert.ok(v.has('gw-unreadable'));
    assert.ok(!v.has('gw-files-none'));
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- From Google (GW3, GW7)

const filesOf = (items) => ({ 'GET /api/connectors/google-workspace/files': () => response({ items }) });
const COLS = [{ key: 'o', label: 'Objective' }, { key: 'k', label: 'Key result' }, { key: 'p', label: 'Progress' }];
const ROWS = [{ id: 'r1', label: '40% booked in the app', cells: { o: 'Crews book without calling', k: '40% booked in the app', p: '35%' } },
  { id: 'r2', label: 'Works offline', cells: { o: 'Ship offline mode', k: 'Works offline', p: '' } }];

test('GW7 Loading and Empty: "Reading…", then no file with Choose from Google Drive', async () => {
  let v = await mount(h(FromGoogle, { project: 7, module: 'product_roadmap', columns: COLS, rows: null }), filesOf([FILES[0]]));
  try { assert.equal(v.of('from-google-loading'), 'Reading…', 'a chosen file whose feed has not read yet'); } finally { await v.close(); }
  v = await mount(h(FromGoogle, { project: 7, module: 'pitch_deck', columns: COLS, rows: [] }), filesOf(FILES));
  try {
    assert.equal(v.attr('from-google', 'data-state'), 'empty');
    assert.match(v.of('from-google-empty'), /No Google files chosen for this module yet\..*Axal VC opens only the files you choose\..*Choose from Google Drive/s);
    assert.equal(v.of('from-google-source'), 'No file chosen');
  } finally { await v.close(); }
});

test('GW3: the rows with an empty cell as "—" and its reason, never 0; the notes; Delete says it first', async () => {
  const deleted = [];
  const v = await mount(h(FromGoogle, { project: 7, module: 'product_roadmap', columns: COLS, rows: ROWS, deleted: 2, onDeleteRow: async (r) => deleted.push(r.id), onSync: async () => {} }), filesOf([FILES[0]]));
  try {
    assert.equal(v.attr('from-google', 'data-state'), 'ready');
    assert.equal(v.of('from-google-source'), '“Roadmap 2027” · From Google Sheets, as of 2026-10-21');
    assert.equal(v.count('from-google-row'), 2);
    assert.match(v.of('from-google-rows'), /Works offline.*—/s);
    assert.doesNotMatch(v.of('from-google-rows'), /\b0%?\b(?!\d)/, 'no zero for an empty cell');
    assert.match(v.of('from-google-notes'), /2 rows you deleted stay deleted\. A “—” means the sheet’s cell is empty, so nothing was recorded\./);
    await v.click('from-google-delete-r1');
    assert.equal(v.of('from-google-delete-says'), '“40% booked in the app” leaves Product roadmap. It stays deleted when you sync again.');
    assert.equal(v.of('from-google-delete-google'), '“Roadmap 2027” in Google is not changed.');
    assert.deepEqual(deleted, [], 'nothing before the confirm');
    await v.click('from-google-delete-confirm');
    assert.deepEqual(deleted, ['r1']);
  } finally { await v.close(); }
});

test('GW7 Unreadable keeps the rows read before; Partly synced says how many and offers Sync again', async () => {
  let v = await mount(h(FromGoogle, { project: 7, module: 'product_roadmap', columns: COLS, rows: ROWS }), filesOf([{ ...FILES[0], status: 'unreadable', last_error: 'google_unreadable' }]));
  try {
    assert.equal(v.attr('from-google', 'data-state'), 'unreadable');
    assert.match(v.of('from-google-unreadable'), /We could not read “Roadmap 2027”\..*The 2 rows read on 2026-10-21 are kept below\..*Choose again/s);
    assert.equal(v.count('from-google-row'), 2, 'the rows read before stay');
  } finally { await v.close(); }
  const synced = [];
  v = await mount(h(FromGoogle, { project: 7, module: 'product_roadmap', columns: COLS, rows: ROWS, partly: { read: 4, total: 6, reason: 'Rows 9 and 12 have an empty Objective cell, so they were not read.' }, onSync: async () => synced.push(1) }), filesOf([FILES[0]]));
  try {
    assert.match(v.of('from-google-partly'), /Partly synced: 4 of 6 rows read\..*Rows 9 and 12.*Sync again/s);
    await v.click('from-google-sync-again');
    assert.deepEqual(synced, [1]);
  } finally { await v.close(); }
});

test('From Google: a failed read is Unreadable, never Empty', async () => {
  const v = await mount(h(FromGoogle, { project: 7, module: 'product_roadmap', columns: COLS, rows: ROWS }), { 'GET /api/connectors/google-workspace/files': () => response({ error: 'workspace_unreadable' }, 503) });
  try {
    assert.equal(v.attr('from-google', 'data-state'), 'error');
    assert.ok(!v.has('from-google-empty'));
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- Map columns (GW4)

test('GW4: the preview, a field per column, the rows a date field cannot take named and marked Skipped, saved as a draft', async () => {
  const fields = [{ key: 'month', label: 'Month', type: 'date' }, { key: 'mrr', label: 'MRR (EUR)', type: 'number' }, { key: 'users', label: 'Active users' }];
  const saved = [];
  const v = await mount(h(MapColumnsDialog, { file: { ...FILES[0], module: 'revenue_traction', name: 'Metrics' }, fields, onClose: () => {}, onSaved: (m) => saved.push(m) }), {
    'POST /api/connectors/google-workspace/files/f1/preview': () => response({ rows: [['Month', 'MRR', 'Active users', 'Notes'], ['2026-05', '4100', '128', ''], ['TBD', '5300', '151', ''], ['2026-07', '6800', '190', 'x'], ['2026-08', '8200', '214', '']], stored: false }),
    'PUT /api/connectors/google-workspace/files/f1/mapping': () => response({ saved: true }),
  });
  try {
    assert.match(v.of('map-columns'), /Map “Metrics” to Revenue and traction/);
    assert.equal(v.count('map-columns-row'), 4);
    assert.equal(v.prop('map-columns-field-Month', 'value'), 'month', 'a column named as a field is guessed');
    assert.equal(v.prop('map-columns-field-Notes', 'value'), '', 'anything else is Don’t use');
    await v.change('map-columns-field-MRR', 'mrr');
    assert.match(v.of('map-columns-problem'), /Month column has 1 row that is not a date\. It will be skipped\..*Row 3 read “TBD”\./s);
    assert.equal(v.count('map-columns-skipped'), 1);
    assert.match(v.of('map-columns'), /Axal VC reads this sheet\. It never changes it\./);
    await v.change('map-columns-field-Notes', 'mrr');
    assert.ok(v.has('map-columns-twice'));
    assert.ok(v.prop('map-columns-save', 'disabled'), 'one field from two columns is refused');
    await v.change('map-columns-field-Notes', '');
    await v.click('map-columns-save');
    assert.deepEqual(saved, [{ Month: 'month', MRR: 'mrr', 'Active users': 'users', Notes: '' }]);
    assert.deepEqual(v.writes().filter((w) => w.startsWith('PUT')), ['PUT /api/connectors/google-workspace/files/f1/mapping']);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- the boundary

test('no screen writes to Google: every Google call is the Worker\'s or the picker\'s, and no token is sent to Axal', () => {
  for (const p of ['../src/pages/account/GoogleWorkspaceFiles.jsx', '../src/pages/cycles/FromGoogle.jsx', '../src/pages/cycles/MapColumnsDialog.jsx', '../src/lib/googleWorkspaceWords.js']) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /googleapis\.com|access_token|refresh_token/, p);
  }
});
