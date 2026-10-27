// D1095 (#2960), Google Workspace part 6 — From Google on Grow's two modules
// (`pages/cycles/GrowFromGoogle.jsx`), mounted on a stubbed fetch: Revenue and
// traction draws the metrics Sheet's figures in the shared section, maps the
// Sheet's columns to the five allowed fields only (saved as column letters),
// syncs and deletes; Durable company-building draws the tagged Calendar
// events, each Accept or Dismiss through a dialog. No test reaches Google or
// the Worker.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_from_google_d1095.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  COLUMNS, DurableFromGoogle, RevenueFromGoogle, SHEET_FIELDS, calendarSentence, decodeMapping, encodeMapping, growRefusal, rowsOf, sheetsSentence,
} from '../src/pages/cycles/GrowFromGoogle.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(element, routes = {}) {
  const restore = installDocument();
  const previous = globalThis.fetch;
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
    seen, writes: () => seen.filter((s) => !s.key.startsWith('GET ')),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n).replace(/\s+/g, ' ').trim(); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length,
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v } }),
    clickNth: async (id, i) => { const n = all(id)[i]; assert.ok(n, `no ${id}[${i}]`); await act(async () => { await props(n).onClick(); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const SHEET = { uid: 's1', module: 'revenue_traction', kind: 'sheet', name: 'Metrics', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', mapping: null };
const files = (items) => ({ 'GET /api/connectors/google-workspace/files': () => response({ items }) });
const FACTS = [{ id: 41, snapshot_date: '2026-10-01', new_users: 120, cac: null, ltv: 900, headcount: 6, nrr_pct: 104 }];
const revenue = (over = {}) => ({ 'GET /api/cycles/grow/google/revenue-and-traction': () => response({ module: 'revenue-and-traction', files: [{ uid: 's1', name: 'Metrics', status: 'active', mapped: false, mine: true }], facts: FACTS, kept_deleted: 1, ...over }) });

test('the words: the five fields and the date, letters both ways, rows with blanks kept blank, sync sentences, refusals', () => {
  assert.deepEqual(SHEET_FIELDS.map((f) => f.key), ['date', 'new_users', 'cac', 'ltv', 'headcount', 'nrr_pct']);
  for (const never of ['mrr', 'arr', 'active_users', 'paying_accounts', 'net_burn', 'cash_balance', 'monthly_churn_pct']) assert.ok(!SHEET_FIELDS.some((f) => f.key === never), never);
  const header = ['Month', 'Signups', 'Skip me', 'Team'];
  const enc = encodeMapping({ Month: 'date', Signups: 'new_users', 'Skip me': '', Team: 'headcount' }, header);
  assert.deepEqual(enc, { date: 'A', new_users: 'B', headcount: 'D' });
  assert.deepEqual(decodeMapping(enc, header), { Month: 'date', Signups: 'new_users', Team: 'headcount' });
  assert.deepEqual(decodeMapping({ date: 'Z', cac: 'b' }, header), {}, 'a letter past the header or not a capital maps nothing');
  assert.deepEqual(rowsOf(FACTS)[0].cells, { date: '2026-10-01', new_users: 120, cac: null, ltv: 900, headcount: 6, nrr_pct: 104 });
  assert.deepEqual(COLUMNS.map((c) => c.label), ['Date', 'New users', 'CAC', 'LTV', 'Headcount', 'NRR (%)']);
  assert.equal(sheetsSentence({ files: 1, written: 3, skipped: [{}], problems: [], partial: false }), '3 days of figures read from Google Sheets. 1 row was skipped: not a date or not a number.');
  assert.equal(sheetsSentence({ files: 0, written: 0, skipped: [], problems: [] }), 'No metrics Sheet is chosen for this venture yet.');
  assert.equal(sheetsSentence({ error: 'mapping_column_not_allowed' }), 'A Sheet never writes a figure Stripe or Mercury records, nor Active users.');
  assert.equal(calendarSentence({ proposed: 2, updated: 0, withdrawn: 1, partial: true }), '2 new events to review, 1 no longer tagged and withdrawn. Google’s read limit was reached: Sync again to carry on.');
  assert.equal(calendarSentence({ proposed: 0, updated: 0, withdrawn: 0, partial: false }), 'No new tagged event in your Google Calendar.');
  assert.equal(growRefusal({ status: 409 }), 'That proposal was already decided.');
  assert.match(growRefusal({ code: 'google_not_connected' }), /Google is not connected yet/);
});

test('Revenue and traction: the figures in the shared section, a blank as “—”, Map columns saving letters, Sync and Delete', async () => {
  const v = await mount(h(RevenueFromGoogle, { projectId: 701 }), {
    ...files([SHEET]), ...revenue(),
    'POST /api/connectors/google-workspace/files/s1/preview': () => response({ rows: [['Month', 'Signups', 'MRR', 'Team'], ['2026-10-01', '120', '1840', '6'], ['October', '9', '1', '6']] }),
    'PUT /api/connectors/google-workspace/files/s1/mapping': () => response({ ok: true }),
    'POST /api/cycles/grow/google/sync': () => response({ ok: true, sheets: { files: 1, written: 2, kept_deleted: 1, partial: false, skipped: [], problems: [] } }),
    'DELETE /api/cycles/grow/google/facts/41': () => response({ ok: true, id: 41 }),
  });
  assert.equal(v.count('from-google-row'), 1);
  assert.match(v.of('from-google-row'), /2026-10-01/);
  assert.match(v.of('from-google-row'), /—/, 'CAC is blank: not recorded, never 0');
  assert.match(v.of('from-google-notes'), /1 row you deleted stays deleted/);
  assert.match(v.of('grow-map'), /Only New users, CAC, LTV, Headcount and NRR \(%\) can be filled from a Sheet/);
  await v.click('grow-map-open');
  assert.ok(v.has('map-columns'));
  const options = v.of('map-columns-field-MRR');
  assert.ok(!/MRR|Active users/.test(options.replace(/^.*?Don’t use/, '')), 'the MRR column can only be Don’t use: no connected field is offered');
  await v.change('map-columns-field-Month', 'date');
  await v.change('map-columns-field-Signups', 'new_users');
  await v.change('map-columns-field-Team', 'headcount');
  assert.match(v.of('map-columns-problem'), /Month column has 1 row that is not a date/);
  await v.click('map-columns-save');
  const put = v.writes().find((w) => w.key === 'PUT /api/connectors/google-workspace/files/s1/mapping');
  assert.deepEqual(put.body, { mapping: { date: 'A', new_users: 'B', headcount: 'D' } }, 'saved as the Worker keeps it: a letter per field, MRR not mapped');
  await v.click('from-google-sync');
  assert.deepEqual(v.writes().find((w) => w.key === 'POST /api/cycles/grow/google/sync').body, { project: 701, part: 'sheets' });
  assert.equal(v.of('grow-sync-note'), '2 days of figures read from Google Sheets.');
  await v.click('from-google-delete-41');
  assert.ok(v.has('from-google-delete-says'), 'Delete asks first');
  await v.click('from-google-delete-confirm');
  assert.ok(v.writes().some((w) => w.key === 'DELETE /api/cycles/grow/google/facts/41' ), 'then deletes that day');
  await v.close();
});

test('Revenue and traction: a reader who did not choose the Sheet sees the figures and no Sync or Map; a failed read is Unreadable; refused draws nothing', async () => {
  const reader = await mount(h(RevenueFromGoogle, { projectId: 701 }), { ...files([SHEET]), ...revenue({ files: [{ uid: 's1', name: 'Metrics', status: 'active', mapped: true, mine: false }] }) });
  assert.equal(reader.count('from-google-row'), 1);
  assert.ok(!reader.has('from-google-sync') && !reader.has('grow-map-open'));
  await reader.close();
  const failed = await mount(h(RevenueFromGoogle, { projectId: 701 }), { 'GET /api/cycles/grow/google/revenue-and-traction': () => response({ error: 'x' }, 503) });
  assert.match(failed.of('grow-from-google'), /Unreadable: the figures from Google Sheets could not be read\. That is not the same as having none\./);
  assert.ok(failed.has('grow-from-google-retry'));
  await failed.close();
  const refused = await mount(h(RevenueFromGoogle, { projectId: 701 }), { 'GET /api/cycles/grow/google/revenue-and-traction': () => response({ error: 'forbidden' }, 403) });
  assert.ok(!refused.has('grow-from-google'));
  await refused.close();
});

test('Durable company-building: tagged events with Accept and Dismiss, each through a dialog that says what it changes', async () => {
  const durable = { 'GET /api/cycles/grow/google/durable-company-building': () => response({ module: 'durable-company-building', files: [], proposals: [
    { id: 7, kind: 'board_meeting', title: 'Q4 board', date: '2026-11-12' }, { id: 8, kind: 'filing_deadline', title: 'Delaware franchise tax', date: '2027-03-01' }], decided: { accepted: 1, dismissed: 2 } }) };
  const v = await mount(h(DurableFromGoogle, { projectId: 701 }), {
    ...durable,
    'POST /api/cycles/grow/google/proposals/7/accept': () => response({ ok: true, id: 7, state: 'accepted', obligation_id: 3 }),
    'POST /api/cycles/grow/google/proposals/8/dismiss': () => response({ error: 'decided' }, 409),
    'POST /api/cycles/grow/google/sync': () => response({ ok: true, calendar: { proposed: 1, updated: 0, withdrawn: 0, decided_kept: 0, partial: false } }),
  });
  assert.equal(v.count('grow-calendar-proposal'), 2);
  assert.match(v.of('grow-calendar-how'), /#board.*#filing/);
  assert.equal(v.of('grow-calendar-decided'), '1 accepted and 2 dismissed before.');
  await v.clickNth('grow-calendar-accept', 0);
  assert.equal(v.writes().length, 0, 'Accept opens a dialog first; nothing is written yet');
  assert.equal(v.of('grow-calendar-decide-says'), 'Board meeting on 2026-11-12 becomes a governance obligation in Durable company-building, due that day. The event in your Google Calendar is not changed.');
  await v.click('grow-calendar-decide-confirm');
  assert.deepEqual(v.writes().map((w) => [w.key, w.body]), [['POST /api/cycles/grow/google/proposals/7/accept', { project: 701 }]]);
  await v.clickNth('grow-calendar-dismiss', 1);
  assert.match(v.of('grow-calendar-decide-says'), /Filing deadline on 2027-03-01 is not proposed again/);
  await v.click('grow-calendar-decide-confirm');
  assert.ok(v.has('grow-calendar-decide'), 'a refusal keeps the dialog open with the Worker’s word');
  assert.match(v.of('grow-calendar-decide'), /That proposal was already decided\./);
  await v.close();
  const sync = await mount(h(DurableFromGoogle, { projectId: 701 }), { ...durable, 'POST /api/cycles/grow/google/sync': () => response({ ok: true, calendar: { error: 'google_not_connected' } }) });
  await sync.click('grow-calendar-sync');
  assert.deepEqual(sync.writes()[0].body, { project: 701, part: 'calendar' });
  assert.match(sync.of('grow-calendar-note'), /Google is not connected yet/);
  await sync.close();
  const reader = await mount(h(DurableFromGoogle, { projectId: 701, canDecide: false }), durable);
  assert.ok(!reader.has('grow-calendar-accept') && !reader.has('grow-calendar-sync'));
  await reader.close();
  const empty = await mount(h(DurableFromGoogle, { projectId: 701 }), { 'GET /api/cycles/grow/google/durable-company-building': () => response({ files: [], proposals: [], decided: { accepted: 0, dismissed: 0 } }) });
  assert.equal(empty.of('grow-calendar-none'), 'No tagged event is waiting for review.');
  assert.ok(!empty.has('grow-calendar-decided'), 'no decided line when nothing was decided');
  await empty.close();
});

test('the wiring: both Grow modules mount their part, the dialog saves the feed’s shape, no browser pop-up', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.ok(route.includes("import { DurableFromGoogle, RevenueFromGoogle } from './GrowFromGoogle';"));
  assert.match(route, /'revenue-and-traction': \(data, ctx\) => \(<>\s*\{fromMercury\('revenue-and-traction', data, ctx\)\}\s*<RevenueFromGoogle projectId=\{ctx\.projectId\} \/>/);
  assert.match(route, /<DurableFromGoogle projectId=\{ctx\.projectId\} \/>\s*<\/>\),/);
  const dialog = read('frontend/src/pages/cycles/MapColumnsDialog.jsx');
  assert.ok(dialog.includes('const saved = encode(mapping, header); await googleWorkspace.mapping(file.uid, saved);'));
  const src = read('frontend/src/pages/cycles/GrowFromGoogle.jsx');
  assert.ok(!/\b(window\.)?(alert|confirm|prompt)\(/.test(src));
  assert.ok(!/fetch\(/.test(src));
});
