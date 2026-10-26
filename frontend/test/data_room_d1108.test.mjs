// D1108 (#2988) — Data room part 7: Activity (DR10, DR11, DR22c), Checklist
// (DR12), Preview (DR13, DR13e) and Eadwyn's proposals (DR14), drawn from
// D1105's and D1103's reads.
//
// What it proves: a link issued is never drawn as a read, and a refusal never
// as an open; zeros from the log are real and a failed read is Unreadable;
// the filters and the period reach the read; Export asks for the same rows
// and says when there are too many; the checklist's states and reasons are
// the Worker's, with what to do next; Preview names no file the grant cannot
// open and counts what it withholds; an ended grant names nothing; the
// proposals block offers nothing to accept, and no tab writes anything.
//
// Every investor, file and figure here is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_d1108.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  dailyChart, eventWords, investorRows, logCount, logRows, periodQuery, phoneDays, totalsLine,
} from '../src/pages/raise/dataroom/activityModel.js';
import { PROPOSALS_WAIT, areasOf, fileChips, itemView, opensLine, summaryLine } from '../src/pages/raise/dataroom/checklistModel.js';
import { previewView, viewAsOptions } from '../src/pages/raise/dataroom/previewModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([JSON.stringify(body)]),
});

const NOW = Date.parse('2026-10-25T12:00:00Z');
const FAR = '2099-01-01';

// The founder's room read (routes/data_room.ts GET /:projectUid): it holds names the preview must never show.
const ROOM = {
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  folders: [
    { id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'open' },
    { id: 2, uid: 'f2', name: 'Secret Board Folder', parent_id: null, visibility: 'nda' },
  ],
  files: [
    { id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'open', access_tier: 'invited' },
    { id: 12, uid: 'a2', name: 'Private Cap Notes.pdf', folder_id: null, visibility: 'open', access_tier: 'nobody' },
    { id: 13, uid: 'a3', name: 'Board Minutes Secret.pdf', folder_id: 2, visibility: 'nda', access_tier: 'invited' },
  ],
  grants: [
    { uid: 'g2', status: 'active', created_at: '2026-09-01 09:00:00', expires_at: '2026-10-01', investor_email: 'b@harbor.example', investor_name: 'Harbor Seed Fund', nda_signed: false, committed: 0 },
    { uid: 'g1', status: 'active', created_at: '2026-10-01 09:00:00', expires_at: FAR, investor_email: 'a@bluefern.example', investor_name: 'Bluefern Capital', nda_signed: false, committed: 1 },
  ],
  report_shares: [],
  recent_access: [],
  week: { opened: 0, downloaded: 0, blocked: 0 },
};
const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const MODULE = { module: { slug: 'data-room', name: 'Data room', records_title: 'Files' }, card: { state: 'empty', reason: 'No files yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

// D1105's activity read.
const ACTIVITY = {
  period: { from: '2026-09-26', to: '2026-10-25', days: 30 },
  previous_period: { from: '2026-08-27', to: '2026-09-25' },
  filters: { investor: null, action: null },
  daily: Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.parse('2026-09-26T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
    opened: i === 29 ? 2 : i % 7 === 0 ? 1 : 0, downloaded: i === 28 ? 3 : 0, blocked: i === 27 ? 1 : 0,
  })),
  totals: { opened: 7, downloaded: 3, blocked: 1 },
  previous: { opened: 4, downloaded: 0, blocked: 2 },
  investors: [
    { grant_uid: 'g1', name: 'Bluefern Capital', email: 'a@bluefern.example', last_at: '2026-10-25 10:00:00', opened: 5, downloaded: 3, blocked: 1 },
    { grant_uid: null, name: null, email: null, last_at: '2026-10-20 10:00:00', opened: 2, downloaded: 0, blocked: 0 },
    { grant_uid: 'g9', name: 'Pinecone Fund', email: 'p@pinecone.example', last_at: '', opened: 0, downloaded: 0, blocked: 0 },
  ],
  log: {
    total: 65, page: 1, page_size: 50, pages: 2,
    rows: [
      { at: '2026-10-25 10:00:00', action: 'open_room', investor: { grant_uid: 'g1', name: 'Bluefern Capital', email: 'a@bluefern.example' }, file: null },
      { at: '2026-10-24 16:42:00', action: 'download', investor: { grant_uid: 'g1', name: 'Bluefern Capital', email: 'a@bluefern.example' }, file: { uid: 'a1', name: 'Model.xlsx' } },
      { at: '2026-10-23 15:20:00', action: 'blocked', investor: { grant_uid: 'g1', name: 'Bluefern Capital', email: 'a@bluefern.example' }, file: { uid: 'a3', name: 'Board Minutes Secret.pdf' } },
      { at: '2026-10-20 10:00:00', action: 'open_room', investor: { grant_uid: null, name: null, email: null }, file: null },
    ],
  },
};

// D1105's checklist read: one item in each state.
const CHECKLIST = {
  grants_in_force: 1,
  totals: { items: 4, answered: 2, openable: 1 },
  items: [
    { key: 'incorporation', area: 'Company', label: 'Certificate of incorporation', state: 'open', reason: null,
      files: [{ uid: 'a1', name: 'Certificate.pdf', visibility: 'open', access_tier: 'invited', source: { kind: 'document', ref: null }, grants_that_open: 1 }] },
    { key: 'board_consents', area: 'Company', label: 'Bylaws and board consents', state: 'no_file', reason: 'No file in the room answers it yet.', files: [] },
    { key: 'financial_statements', area: 'Financials', label: 'Financial statements', state: 'no_one_can_open',
      reason: 'Only files private to you answer it, so no investor can open them.',
      files: [{ uid: 'a4', name: 'Mercury statement 2026-09.pdf', visibility: 'nda', access_tier: 'nobody', source: { kind: 'connector', ref: 'mercury' }, grants_that_open: 0 }] },
    { key: 'financial_model', area: 'Financials', label: 'Financial model', state: 'no_file', reason: 'No file in the room answers it yet.', files: [] },
  ],
};

// D1103's preview read for g1: the investor filter already applied.
const PREVIEW = {
  grant_uid: 'g1', open: true, project: { uid: 'p3uid', name: 'Harbor Ledger' }, nda_signed: false,
  folders: [{ uid: 'f1', name: 'Financials', parent_id: null, visibility: 'open', display_order: 0 }],
  files: [{ uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'open', folder_uid: 'f1' }],
  withheld_behind_nda: 1, hidden_from_grant: 1,
};
const ENDED = { grant_uid: 'g2', open: false, reason: 'This grant is revoked or has ended, so it opens nothing.' };

function handler(url) {
  if (/\/data-room\/p3uid\/activity\.csv/.test(url)) return response({ detail: 'too many', error: 'too_many_rows' }, 413);
  if (/\/data-room\/p3uid\/activity\?/.test(url)) return response(ACTIVITY);
  if (/\/data-room\/p3uid\/checklist$/.test(url)) return response(CHECKLIST);
  if (/\/data-room\/p3uid\/preview\?grant=g1$/.test(url)) return response(PREVIEW);
  if (/\/data-room\/p3uid\/preview\?grant=g2$/.test(url)) return response(ENDED);
  if (/\/data-room\/p3uid(\?|$)/.test(url)) return response(ROOM);
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  if (url.includes('/cycles/raise/modules/')) return response(MODULE);
  return response({});
}

async function mounted(url, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET' }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await flush(); };
  return {
    requests, text: () => text(container),
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    count: (id) => nodes().filter((n) => props(n)['data-testid'] === id).length,
    click: (id) => fire(id, 'onClick', { preventDefault() {} }),
    change: (id, value) => fire(id, 'onChange', { target: { value } }),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    buttons: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'BUTTON').map((n) => text(n)),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const writes = (requests) => requests.filter((r) => r.method !== 'GET');

/* ------------------------------------------------------------------ *
 * Activity's model
 * ------------------------------------------------------------------ */

test('activity words: a link issued is never a read, a refusal is never an open', () => {
  const rows = logRows(ACTIVITY);
  assert.deepEqual(rows.map((r) => r.event), [
    'Opened the room',
    'Link issued for Model.xlsx',
    'Blocked: NDA needed for Board Minutes Secret.pdf',
    'Opened the room',
  ]);
  for (const r of rows) assert.doesNotMatch(r.event, /download(ed)?|read |viewed/i, r.event);
  assert.equal(eventWords({ action: 'download', file: null }), 'Link issued for a file no longer in the room');
  assert.equal(rows[0].when, '25 Oct 2026 10:00');
  assert.equal(rows[3].who, 'Someone without access here', 'a reader with no grant is not named');
});

test('activity figures: the chart, its table, the period before, by investor with real zeros, the page count, the phone days', () => {
  const chart = dailyChart(ACTIVITY);
  assert.deepEqual(chart.series.map((s) => [s.label, s.values.reduce((a, b) => a + b, 0)]), [['Room opens', 7], ['Links issued', 3], ['Blocked by the NDA', 1]]);
  assert.deepEqual(chart.labels.slice(0, 2), ['26 Sep', '27 Sep']);
  assert.deepEqual(chart.table.head, ['Day', 'Room opens', 'Links issued', 'Blocked']);
  assert.equal(chart.table.rows.at(-1)[0], '25 Oct · so far');
  assert.equal(totalsLine(ACTIVITY), 'Opened the room 7 (4 in the 30 days before) · Link issued 3 (0 in the 30 days before) · Blocked by the NDA 1 (2 in the 30 days before)');
  const inv = investorRows(ACTIVITY);
  assert.deepEqual(inv.map((r) => [r.who, r.opened, r.downloaded, r.blocked, r.last]), [
    ['Bluefern Capital', '5', '3', '1', '25 Oct'],
    ['Someone without access here', '2', '0', '0', '20 Oct'],
    ['Pinecone Fund', '0', '0', '0', 'No event in this period'],
  ]);
  assert.equal(logCount(ACTIVITY), '1–50 of 65');
  assert.equal(logCount({ log: { total: 65, page: 2, page_size: 50 } }), '51–65 of 65');
  assert.equal(logCount({ log: { total: 0, page: 1 } }), '0 events');
  const days = phoneDays(ACTIVITY);
  assert.equal(days.length, 7);
  assert.equal(days[0].day, '25 Oct · so far');
  assert.equal(days[1].downloaded, '3');
  assert.deepEqual(periodQuery('7', NOW), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(periodQuery('90', NOW), { from: '2026-07-28', to: '2026-10-25' });
  assert.deepEqual(periodQuery('nope', NOW), { from: '2026-09-26', to: '2026-10-25' }, 'an unknown period is the 30 days');
});

/* ------------------------------------------------------------------ *
 * Checklist's model
 * ------------------------------------------------------------------ */

test('checklist: the areas in order with answered of total, each state in words, the Worker\'s reason, and what to do next', () => {
  const areas = areasOf(CHECKLIST);
  assert.deepEqual(areas.map((a) => [a.area, a.meta]), [['Company', '1 of 2'], ['Financials', '1 of 2']]);
  const [open, missing] = areas[0].items;
  const [blocked] = areas[1].items;
  assert.deepEqual([open.pill.label, open.sub, open.next], ['Answered · investors can open it', null, []]);
  assert.deepEqual([missing.pill.label, missing.sub, missing.next], ['Missing', 'No file answers this yet.', ['match', 'upload']]);
  assert.deepEqual([blocked.pill.label, blocked.sub, blocked.next],
    ['Answered · no investor can open it', 'Only files private to you answer it, so no investor can open them.', ['gate']]);
  assert.deepEqual(blocked.files[0].chips, ['NDA', 'Private to you', 'From Mercury']);
  assert.equal(blocked.files[0].opens, 'No investor can open it');
  assert.equal(open.files[0].opens, '1 investor can open it');
  assert.equal(opensLine({ grants_that_open: 3 }), '3 investors can open it');
  assert.equal(opensLine({}), 'Not recorded', 'a missing count is never zero');
  assert.deepEqual(fileChips({ visibility: 'open', access_tier: 'committed', source: { kind: 'document', ref: 'cap_table' } }), ['Open', 'Committed only', 'From the cap table']);
  assert.equal(summaryLine(CHECKLIST), '2 of 4 items answered · 1 an investor can open · 1 investor with access');
  assert.equal(summaryLine({}), 'Not recorded');
  assert.equal(itemView({ state: 'odd' }).pill.label, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * Preview's model
 * ------------------------------------------------------------------ */

test('preview: only what the grant can open is named; what it withholds and hides is counted; an ended grant names nothing', () => {
  const v = previewView(PREVIEW, { who: 'Bluefern Capital', committed: true, roomFolders: ROOM.folders.length });
  const named = JSON.stringify(v);
  assert.ok(named.includes('Model.xlsx'));
  for (const secret of ['Private Cap Notes.pdf', 'Board Minutes Secret.pdf', 'Secret Board Folder']) assert.ok(!named.includes(secret), secret);
  assert.equal(v.banner, 'You have access. 1 file needs your NDA.');
  assert.deepEqual(v.withheld, { title: '1 file needs your NDA', sub: 'Their names show once you sign.' });
  assert.deepEqual(v.groups.map((g) => [g.name, g.count, g.files]), [['Financials', '1 file', ['Model.xlsx']]]);
  assert.deepEqual(v.margin, [
    '1 file is not shown: their tier, end date or folders keep Bluefern Capital out. They are not named.',
    '1 file sits behind the NDA, so its name is not shown to Bluefern Capital.',
    '1 folder is not shown to Bluefern Capital, so it is not named.',
    'Committed only files show because Bluefern Capital is committed.',
  ]);
  assert.equal(previewView({ ...PREVIEW, nda_signed: true, withheld_behind_nda: 0 }, { who: 'X' }).banner, 'You have access.');
  const ended = previewView(ENDED, { who: 'Harbor Seed Fund' });
  assert.deepEqual(ended, { open: false, title: 'The founder has not opened their data room to you.', line: 'This is all Harbor Seed Fund sees. No folder or file is named.' });
  const opts = viewAsOptions(ROOM, NOW);
  assert.deepEqual(opts.map((o) => [o.uid, o.live, o.label]), [['g1', true, 'Bluefern Capital'], ['g2', false, 'Harbor Seed Fund · access ended 1 Oct 2026']], 'in force first');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('mounted Activity: the chart, by investor, the log in its words, and the filters reach the read', async () => {
  const v = await mounted('/raise/data-room/activity?project_id=3');
  try {
    assert.ok(v.has('dataroom-activity-chart'));
    assert.match(v.textOf('dataroom-activity-chart'), /Events by day · 26 Sep to 25 Oct/);
    assert.match(v.textOf('dataroom-activity-chart'), /Opened the room 7 \(4 in the 30 days before\)/);
    assert.equal(v.count('dataroom-activity-investor-row'), 3);
    assert.equal(v.count('dataroom-activity-log-row'), 4);
    const log = v.textOf('dataroom-activity-log');
    assert.match(log, /Link issued for Model\.xlsx/);
    assert.match(log, /Blocked: NDA needed for Board Minutes Secret\.pdf/);
    assert.doesNotMatch(log, /Downloaded/);
    assert.match(log, /Whether it was followed is not recorded\./);
    assert.equal(v.textOf('dataroom-activity-count'), '1–50 of 65');
    // The table view of the chart.
    await v.click('dataroom-activity-astable');
    assert.match(v.textOf('dataroom-activity-chart'), /25 Oct · so far/);
    // The event filter narrows the log and goes back to page 1.
    await v.click('dataroom-activity-next');
    assert.ok(v.requests.some((r) => /activity\?.*page=2/.test(r.url)));
    await v.change('dataroom-activity-action', 'blocked');
    const last = v.requests.filter((r) => /\/activity\?/.test(r.url)).at(-1).url;
    assert.match(last, /action=blocked/);
    assert.doesNotMatch(last, /page=2/, 'a new filter starts at the first page');
    // The investor filter and the period.
    await v.change('dataroom-activity-investor', 'g1');
    assert.match(v.requests.filter((r) => /\/activity\?/.test(r.url)).at(-1).url, /investor=g1/);
    await v.click('dataroom-activity-period-7');
    const seven = v.requests.filter((r) => /\/activity\?/.test(r.url)).at(-1).url;
    const from = new URL(seven, 'http://x').searchParams.get('from');
    const to = new URL(seven, 'http://x').searchParams.get('to');
    assert.equal((Date.parse(to) - Date.parse(from)) / 86400000, 6, 'seven whole days');
    assert.deepEqual(writes(v.requests), [], 'Activity writes nothing');
  } finally { await v.close(); }
});

test('mounted Activity: Export asks for the same rows and says when there are too many; a failed read is Unreadable, never zeros', async () => {
  const v = await mounted('/raise/data-room/activity?project_id=3');
  try {
    await v.change('dataroom-activity-action', 'download');
    await v.click('dataroom-activity-export');
    const csv = v.requests.find((r) => /activity\.csv/.test(r.url));
    assert.ok(csv, 'the CSV route is asked');
    assert.match(csv.url, /action=download/);
    assert.doesNotMatch(csv.url, /page=/, 'the export is every row, not a page');
    assert.match(v.textOf('dataroom-activity-export-refused'), /More than 10,000 rows/);
  } finally { await v.close(); }
  const fail = await mounted('/raise/data-room/activity?project_id=3', { handle: (u) => (/\/activity\?/.test(u) ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    assert.ok(fail.has('dataroom-activity-unreadable'));
    assert.ok(!fail.has('dataroom-activity-investor-row') && !fail.has('dataroom-activity-log-none'));
    assert.match(fail.text(), /This is not a claim that nobody opened the room\./);
  } finally { await fail.close(); }
});

test('mounted Activity on a phone: the last seven days as a table and the investors, newest day first', async () => {
  const v = await mounted('/raise/data-room/activity?project_id=3', { phone: true });
  try {
    assert.ok(v.has('dataroom-activity-phone'));
    assert.equal(v.count('dataroom-activity-day'), 7);
    assert.match(v.textOf('dataroom-activity-days'), /25 Oct · so far/);
    assert.equal(v.count('dataroom-activity-investor-row'), 3);
    assert.ok(!v.has('dataroom-activity-export'));
  } finally { await v.close(); }
});

test('mounted Checklist: each area and item from the read, links to Files and Upload, the proposals wait with nothing to accept, and nothing is written', async () => {
  const v = await mounted('/raise/data-room/checklist?project_id=3');
  try {
    assert.equal(v.count('dataroom-checklist-area'), 2);
    assert.equal(v.count('dataroom-checklist-item'), 4);
    assert.match(v.textOf('dataroom-checklist-summary'), /2 of 4 items answered · 1 an investor can open · 1 investor with access/);
    assert.match(v.text(), /Only files private to you answer it, so no investor can open them\./);
    assert.equal(v.count('dataroom-checklist-match'), 2);
    assert.ok(v.hrefs().includes('/raise/data-room/files?project_id=3'));
    assert.ok(v.hrefs().includes('/raise/data-room/new?project_id=3'));
    assert.ok(v.hrefs().includes('/raise/fundraising-readiness?project_id=3'));
    assert.equal(v.textOf('dataroom-proposals-wait'), PROPOSALS_WAIT);
    assert.ok(!v.buttons().some((b) => /Accept|Dismiss/.test(b)), 'a proposal is never offered for acceptance here');
    assert.deepEqual(writes(v.requests), [], 'the checklist changes nothing');
  } finally { await v.close(); }
  const fail = await mounted('/raise/data-room/checklist?project_id=3', { handle: (u) => (/\/checklist$/.test(u) ? response({}, 500) : handler(u)) });
  try {
    assert.ok(fail.has('dataroom-checklist-unreadable'));
    assert.ok(fail.has('dataroom-proposals'), 'one failed block never blanks the page');
  } finally { await fail.close(); }
});

test('mounted Preview: as the grant in force, nothing the grant cannot open is named; as an ended grant, one sentence; nothing is logged or written', async () => {
  const v = await mounted('/raise/data-room/preview?project_id=3');
  try {
    assert.ok(v.requests.some((r) => /preview\?grant=g1$/.test(r.url)), 'the grant in force first');
    const room = v.textOf('dataroom-preview-room');
    assert.match(room, /Model\.xlsx/);
    for (const secret of ['Private Cap Notes', 'Board Minutes Secret', 'Secret Board Folder']) assert.ok(!v.text().includes(secret), secret);
    assert.match(v.textOf('dataroom-preview-withheld'), /1 file needs your NDA/);
    assert.match(v.textOf('dataroom-preview-info'), /This is what Bluefern Capital sees today\. Nothing here is logged or sent\./);
    assert.match(v.textOf('dataroom-preview-margin'), /Committed only files show because Bluefern Capital is committed\./);
    assert.ok(!v.buttons().some((b) => /^Open$/.test(b)), 'nothing opens from a preview');
    await v.click('dataroom-preview-as-g2');
    assert.ok(v.requests.some((r) => /preview\?grant=g2$/.test(r.url)));
    assert.ok(v.has('dataroom-preview-ended'));
    assert.match(v.textOf('dataroom-preview-ended'), /The founder has not opened their data room to you\./);
    assert.ok(!v.has('dataroom-preview-file'), 'an ended grant names no file');
    assert.deepEqual(writes(v.requests), []);
  } finally { await v.close(); }
  const unshared = await mounted('/raise/data-room/preview?project_id=3', { handle: (u) => (/\/data-room\/p3uid(\?|$)/.test(u) ? response({ ...ROOM, grants: [] }) : handler(u)) });
  try {
    assert.ok(unshared.has('dataroom-preview-none'));
    assert.ok(!unshared.requests.some((r) => /preview\?/.test(r.url)), 'no grant, no preview read');
  } finally { await unshared.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the sources: no browser pop-up, no write, and every read through the data-room client', () => {
  for (const f of ['DataRoomActivity.jsx', 'DataRoomChecklist.jsx', 'DataRoomPreview.jsx']) {
    const src = read(`frontend/src/pages/raise/dataroom/${f}`);
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/, f);
    assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/, f);
    assert.match(src, /dataRoomApi\.(activity|checklist|preview)\(/, f);
  }
});
