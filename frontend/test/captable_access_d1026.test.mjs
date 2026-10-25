// D1026 (#2863) — Cap table part 11: Access (CT13) and Import and export
// (CT14) on the founder's tool, and the reads for an Advisor, an Operating
// Partner, an Admin and the Super Admin (CT17, CT18), plus the venture link.
// Fixtures follow the Worker's own shapes (routes/captable_access.ts,
// routes/captable.ts, services/capTableRecord.ts), worked out by hand.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/captable_access_d1026.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { CapTableReadPage, VentureSharePage } from '../src/pages/raise/captable/SharedCapTable.jsx';
import {
  ATTESTED, LEVELS, grantRows, levelRows, linkBody, linkProblems, linkRows, logRows, logWhat, sharedLine, sharedView, supportProblem,
} from '../src/pages/raise/captable/capTableAccess.js';
import {
  TEMPLATE_CSV, counts, guessMap, importBody, parseCsv, preview, proposeLabel, readDate, readMoney, readShares,
} from '../src/pages/raise/captable/capTableImport.js';
import { TABS } from '../src/pages/raise/captable/capTableModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// routes/captable_access.ts LEVEL_SCOPE, as the grants read sends it.
const SCOPE = {
  own_position: { label: 'Own position', sees: 'Their shares, instruments and documents, and the group split.' },
  summary: { label: 'Summary', sees: '% by group and number of rounds. No names, no counts.' },
  investor: { label: 'Investor', sees: 'Every investor and founder position, rounds and pricing, the pool as one line, the waterfall. Not who holds options.' },
  full: { label: 'Full', sees: 'Everything the founder sees.' },
};
const GRANTS = (canChange) => ({ can_change: canChange, levels: SCOPE, grants: [
  { id: 11, user_uid: 'u-inv', name: 'Bluefern Capital', role: 'investor', holder_ref: 'Bluefern Capital', level: 'investor', source: 'side_letter', since: '2026-06-04 10:00:00', granted_by: 'Ada Founder', last_viewed: '2026-10-09 16:02:00' },
  { id: 12, user_uid: null, name: null, role: null, holder_ref: 'Harbor Seed Fund', level: 'own_position', source: 'founder', since: '2026-06-04 10:00:00', granted_by: 'Ada Founder', last_viewed: null },
] });
const LINKS = { items: [
  { id: 5, label: 'Seed data room', level: 'investor', expires_at: '2026-12-31T00:00:00Z', view_limit: 25, view_count: 3, last_viewed_at: '2026-10-09 16:02:00', revoked_at: null, holders_attested_at: '2026-10-01T00:00:00Z' },
  { id: 6, label: null, level: 'summary', expires_at: '2026-11-30T00:00:00Z', view_limit: 10, view_count: 0, last_viewed_at: null, revoked_at: '2026-10-20 00:00:00', holders_attested_at: null },
] };
const LOG = { items: [
  { id: 30, via: 'member', level: 'full', reason: null, opened_at: '2026-10-12 09:14:00', who: 'Founder B', link_label: null },
  { id: 29, via: 'link', level: 'investor', reason: null, opened_at: '2026-10-09 16:02:00', who: 'Seed data room', link_label: 'Seed data room' },
  { id: 28, via: 'support', level: 'full', reason: 'Founder asked us to check the pool', opened_at: '2026-10-08 11:40:00', who: 'Sam Admin', link_label: null },
], next_before: 28, note: 'No IP address is kept.' };
const COMPARE = { canonical: { uid: 'm1', result: { founding: [{ holder: 'Ada Founder', type: 'founder', shares: 8000, pct: 80 }, { holder: 'Option pool', type: 'option_pool', shares: 2000, pct: 20 }], rounds: [] } }, variants: [] };
// services/capTableRecord.ts readRecord, for a Common class and a pool, with Ada holding 4,400,000 Common.
const RECORD = {
  project_id: 3, currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: [{ uid: 'c-common', name: 'Common', kind: 'common' }, { uid: 'c-pool', name: '2026 Plan', kind: 'option_pool' }] },
  by_holder: { available: true, reason: null, rows: [{ holder_id: 101, name: 'Founder A', shares: 4400000, options: 0, by_class: [{ class_uid: 'c-common', shares: 4400000 }] },
    { holder_id: null, name: 'Founder B', shares: 3600000, options: 0, by_class: [{ class_uid: 'c-common', shares: 3600000 }] }] },
  by_class: { available: true, rows: [] }, outstanding: { available: true }, fully_diluted: { available: true },
  instruments: { available: true, rows: [] }, issuances: { available: true, rows: [] }, proposals: { available: true, rows: [] },
};
const LIVE = (o = {}) => ({ scope: { kind: 'venture', project_id: 3 }, connected: false, carta_project_id: null, carta_is_record: false, issuer_name: null, last_synced_at: null, last_error: null, holders: [], securities: [], ...o });
const MODULE = { module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' }, card: { state: 'empty', reason: 'No holders yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function founderHandler({ canChange = true, grants = 200, live = LIVE() } = {}) {
  return (url, opts = {}) => {
    const m = (opts.method || 'GET').toUpperCase();
    if (url.includes('/captable/access/3/grants') && m === 'GET') return grants === 200 ? response(GRANTS(canChange)) : response({ error: 'team_only', message: 'Only the venture\'s founders read who sees its cap table.' }, grants);
    if (url.includes('/captable/access/3/grants') && m === 'PUT') return response({ grant: { id: 13 } }, 201);
    if (url.includes('/captable/access/3/links') && m === 'POST') return response({ id: 7, token: 'tok', level: 'investor', label: null, expires_at: 'x', view_limit: 25, share_path: '/share/captable/venture/tok' }, 201);
    if (url.includes('/captable/access/3/links')) return response(LINKS);
    if (url.includes('/captable/access/3/log')) return response(LOG);
    if (url.includes('/captable/scenarios/by-project/') && url.includes('/compare')) return response(COMPARE);
    if (url.includes('/captable/record/3/proposals/import')) return response({ proposed: 2, uids: ['a', 'b'] }, 201);
    if (url.includes('/captable/record/3')) return response(RECORD);
    if (url.includes('/captable/live')) return response(live);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};

async function mounted(url, handle, routes) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: (options.method || 'GET').toUpperCase(), body: options.body ? JSON.parse(options.body) : null }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, ...routes))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, flush, text: () => text(document.body), ids,
    count: (id) => byId(id).length,
    textOf: (id) => byId(id).map(text).join(' | '),
    async click(id, i = 0) { const n = byId(id)[i]; assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => props(n).onClick?.({ preventDefault() {} })); await flush(); },
    disabled: (id, i = 0) => !!props(byId(id)[i] || {}).disabled,
    async change(id, value, i = 0) { const n = byId(id)[i]; assert.ok(n, `no ${id}`); await act(async () => props(n).onChange?.({ target: { value, checked: value, type: typeof value === 'boolean' ? 'checkbox' : 'text', files: value?.files } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const tool = (tab, handle) => mounted(`/raise/cap-table/${tab}?project_id=3`, handle, [
  h(Route, { key: 'm', path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  h(Route, { key: 'r', path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
]);
const readPage = (handle) => mounted('/cap-tables/3', handle, [h(Route, { key: 'c', path: '/cap-tables/:projectId', element: h(CapTableReadPage) })]);

/* ---------------------------------------------------------------- the model */

test('levels, grants, links and the log in CT13’s words, the Worker’s sentences first', () => {
  assert.deepEqual(LEVELS, ['none', 'own_position', 'summary', 'investor', 'full']);
  const rows = levelRows(SCOPE);
  assert.deepEqual(rows.map((r) => r.label), ['None', 'Own position', 'Summary', 'Investor', 'Full']);
  assert.equal(rows[0].sees, 'Sees nothing.');
  assert.equal(rows[3].sees, SCOPE.investor.sees, 'the Worker’s sentence, not a copy');
  assert.equal(levelRows(null)[2].sees, 'Not recorded', 'no read is no claim');
  const g = grantRows(GRANTS(true));
  assert.deepEqual(g.map((x) => [x.who, x.role, x.levelLabel, x.lastViewed]), [['Bluefern Capital', 'Investor', 'Investor', '9 Oct 2026'], ['Harbor Seed Fund', 'Holder', 'Own position', 'Never']]);
  assert.equal(g[0].rights, 'Rights: from a signed side letter · Investor level');
  assert.equal(g[1].rights, null);
  const l = linkRows(LINKS);
  assert.deepEqual(l.map((x) => [x.label, x.level, x.expires, x.views, x.live]), [['Seed data room', 'Investor', '31 Dec 2026', '3 of 25', true], ['Untitled link', 'Summary', 'Revoked', '0 of 10', false]]);
  assert.deepEqual(logRows(LOG).map((x) => x.what), ['Opened the cap table', 'Opened the Seed data room link · Investor', 'Opened for support: ‘Founder asked us to check the pool’']);
  assert.equal(logRows(LOG)[0].when, '12 Oct 2026 09:14');
  assert.equal(logWhat({ via: 'grant', level: 'own_position' }), 'Viewed their own position');
});

test('New link’s checks: a level, bounds, and the attestation only where holders are named', () => {
  assert.deepEqual([...ATTESTED].sort(), ['full', 'investor']);
  const ok = { level: 'summary', hours: 168, views: 25, agreed: false };
  assert.deepEqual(linkProblems(ok), []);
  assert.deepEqual(linkBody(ok), { level: 'summary', expires_in_hours: 168, view_limit: 25 }, 'a Summary link sends no attestation');
  assert.equal(linkProblems({ ...ok, level: 'investor' }).length, 1);
  assert.deepEqual(linkProblems({ ...ok, level: 'full', agreed: true }), []);
  assert.deepEqual(linkBody({ ...ok, level: 'full', agreed: true, label: '  Board pack  ' }), { level: 'full', label: 'Board pack', expires_in_hours: 168, view_limit: 25, holders_agreed: true });
  for (const bad of [{ hours: 0 }, { hours: 2161 }, { views: 0 }, { views: 501 }, { level: 'own_position' }]) assert.equal(linkProblems({ ...ok, ...bad }).length, 1, JSON.stringify(bad));
  assert.match(supportProblem('too short'), /at least 10/);
  assert.equal(supportProblem('Founder asked us to check the pool'), null);
  assert.match(supportProblem('x'.repeat(501)), /500/);
});

test('the views at each level, and the line each reader is shown', () => {
  const summary = sharedView({ view: { audience: 'summary', rounds_completed: 2, summary: [{ group: 'Founders', pct: 61.5 }, { group: 'Investors', pct: 38.5 }] } });
  assert.deepEqual([summary.kind, summary.rounds, summary.split.map((s) => s.pct)], ['summary', 2, ['61.50%', '38.50%']]);
  const inv = sharedView({ view: { audience: 'investor', rounds: [{ name: 'Seed', price_per_share: 1.03, ledger: [{ holder: 'Founder A', type: 'founder', shares: 4400000, pct: 44 }, { holder: 'Option Pool', type: 'option_pool', shares: 1500000, pct: 15 }] }] } });
  assert.deepEqual(inv.rows.map((r) => [r.holder, r.group, r.shares]), [['Founder A', 'Founder', '4,400,000'], ['Option Pool', 'Option pool', '1,500,000']]);
  assert.deepEqual(inv.rounds, [{ name: 'Seed', price: '$1.03 a share' }]);
  assert.equal(sharedView({ view: { audience: 'full', founding: [], rounds: [] } }).kind, 'full');
  const own = sharedView({ view: { level: 'own_position', holder: 'Harbor', position: [{ holder: 'Harbor', type: 'preferred', shares: 10, pct: null }], instruments: [], documents: [], summary: [] } });
  assert.deepEqual([own.kind, own.rows[0].pct], ['own', 'Not recorded'], 'a missing % is Not recorded, never 0%');
  assert.deepEqual(sharedView({ view: { recorded: false, reason: 'No cap table is saved for this venture yet.' } }), { kind: 'none', reason: 'No cap table is saved for this venture yet.' });
  assert.match(sharedLine({ via: 'grant', level: 'summary' }), /Shared with you at Summary level/);
  assert.match(sharedLine({ via: 'studio', level: 'summary' }, 'Acme'), /group summary\. You see your studio’s companies only/);
  assert.match(sharedLine({ via: 'hq', level: 'full' }), /edits none/);
});

const SHEET = [
  'Name,Share class,Shares,Issued,Type',
  'Founder A,Common,"4,400,000",2025-01-03,',
  'Founder B,Common,3700000,3 Jan 2025,Founding shares',
  'Cy Engineer,2026 Plan,,2026-09-01,',
  'Di Engineer,2026 Plan,25000,2026-09-01,Option grant',
  'Early Angel,,,,SAFE',
  'Late Angel,,,,SAFE',
  'Fund One,Series A,1000,2026-04-01,Priced round shares',
].join('\r\n').replace('Late Angel,,,,SAFE', 'Late Angel,,,,Convertible note');

test('the spreadsheet: parse, map, and every check of the preview against the record', () => {
  const parsed = parseCsv(`﻿${SHEET}\r\n`);
  assert.deepEqual(parsed.headers, ['Name', 'Share class', 'Shares', 'Issued', 'Type']);
  assert.equal(parsed.rows.length, 7);
  assert.equal(parsed.rows[0][2], '4,400,000', 'a quoted comma stays in its cell');
  assert.deepEqual(parseCsv('a,b\n"x ""y""",2\n\n').rows, [['x "y"', '2']]);
  const map = guessMap(parsed.headers);
  assert.deepEqual(map, { holder: 0, type: 4, class: 1, shares: 2, amount: null, price: null, date: 3 });
  const rows = preview(parsed, map, RECORD);
  assert.deepEqual(rows.map((r) => [r.row, r.tone]), [[1, 'green'], [2, 'amber'], [3, 'red'], [4, 'plain'], [5, 'red'], [6, 'red'], [7, 'red']]);
  assert.match(rows[0].check, /Matches the record/);
  assert.match(rows[1].check, /Changes Founder B’s recorded shares \(Common: 3,600,000 on record\)/);
  assert.equal(rows[2].check, 'Shares missing');
  assert.equal(rows[3].check, 'New option grant');
  assert.equal(rows[4].check, 'Amount missing');
  assert.equal(rows[6].check, 'Class not on the record: Series A');
  assert.deepEqual(rows[1].body, { row: 2, kind: 'founding', holder_name: 'Founder B', class_uid: 'c-common', shares: 3700000, issued_on: '2025-01-03' });
  assert.deepEqual(counts(rows), { all: 7, errors: 4, changes: 1, propose: 2 });
  assert.deepEqual(importBody(rows, 'f'.repeat(64)), { file_ref: 'f'.repeat(64), rows: [rows[1].body, rows[3].body] }, 'only the rows that propose; a match is never sent');
  assert.equal(proposeLabel(1), 'Propose 1 row');
  // A SAFE with its amount proposes money, never shares.
  const safe = preview(parseCsv('Holder,Type,Amount\nAngel,SAFE,"$25,000.50"'), guessMap(['Holder', 'Type', 'Amount']), RECORD)[0];
  assert.deepEqual(safe.body, { row: 1, kind: 'safe', holder_name: 'Angel', amount_cents: 2500050 });
  assert.equal(preview(parsed, map, null).filter((r) => r.propose).length, 0, 'without the record nothing can be checked, so nothing is proposed');
  assert.deepEqual([readDate('2026-02-30'), readDate('3 Jan 2025'), readDate('1/2/2025')], [null, '2025-01-03', null], 'an ambiguous date is never guessed');
  assert.deepEqual([readShares('1.5').bad, readShares('').empty, readShares('0').bad, readMoney('€1,000').value], [true, true, true, 100000]);
  assert.deepEqual(parseCsv(TEMPLATE_CSV).headers, ['Holder', 'Type', 'Class', 'Shares', 'Amount', 'Price per share', 'Date']);
  assert.deepEqual(guessMap(parseCsv(TEMPLATE_CSV).headers), { holder: 0, type: 1, class: 2, shares: 3, amount: 4, price: 5, date: 6 }, 'the template maps itself');
});

/* ---------------------------------------------------------------- mounted */

test('Access, as the owner: change a level, revoke, and make a link, each in a dialog', async () => {
  const p = await tool('access', founderHandler());
  try {
    assert.ok(p.count('captable-tab-access') === 1 && p.count('captable-tab-import-export') === 1);
    assert.equal(p.count('captable-access-readonly'), 0);
    assert.equal(p.count('captable-who-row'), 2);
    assert.match(p.textOf('captable-who-rights'), /signed side letter/);
    assert.equal(p.count('captable-level-row'), 5);
    assert.equal(p.count('captable-access-log-row'), 3);
    assert.match(p.text(), /No IP address is kept/);
    // Change Harbor's level.
    await p.click('captable-who-level', 1);
    assert.equal(p.count('captable-level-dialog'), 1);
    assert.equal(p.disabled('captable-level-dialog-go'), true, 'the same level is no change');
    await p.change('captable-level-summary', true);
    await p.click('captable-level-dialog-go');
    const put = p.requests.find((r) => r.method === 'PUT');
    assert.deepEqual(put.body, { holder_ref: 'Harbor Seed Fund', level: 'summary' });
    // An Investor link waits for the attestation.
    await p.click('captable-link-new');
    assert.equal(p.count('captable-link-problems'), 1);
    assert.equal(p.disabled('captable-link-dialog-go'), true, 'no Investor link without the attestation');
    await p.change('captable-link-agreed', true);
    assert.equal(p.count('captable-link-problems'), 0);
    await p.click('captable-link-dialog-go');
    const post = p.requests.find((r) => r.method === 'POST' && r.url.includes('/links'));
    assert.deepEqual(post.body, { level: 'investor', expires_in_hours: 168, view_limit: 25, holders_agreed: true });
    assert.match(p.textOf('captable-link-url'), /\/share\/captable\/venture\/tok$/);
    assert.ok(!/alert\(|confirm\(/.test(read('frontend/src/pages/raise/captable/AccessTab.jsx')), 'dialogs, never pop-ups');
  } finally { await p.close(); }
});

test('Access, as a co-founder: everything reads, no control is drawn, and the line says why', async () => {
  const p = await tool('access', founderHandler({ canChange: false }));
  try {
    assert.equal(p.count('captable-access-readonly'), 1);
    for (const id of ['captable-grant-new', 'captable-link-new', 'captable-who-revoke', 'captable-who-level', 'captable-link-revoke']) assert.equal(p.count(id), 0, id);
    assert.equal(p.count('captable-who-level-text'), 2);
    assert.equal(p.count('captable-link-row'), 2);
  } finally { await p.close(); }
  const refused = await tool('access', founderHandler({ grants: 403 }));
  try {
    assert.equal(refused.count('captable-who-refused'), 1, 'a refusal is said, never drawn as nobody');
    assert.equal(refused.count('captable-who-none'), 0);
  } finally { await refused.close(); }
});

test('Import and export: Carta’s state, the file to proposals, and the exports', async () => {
  const p = await tool('import-export', founderHandler());
  try {
    assert.equal(p.count('captable-carta-off'), 1);
    for (const id of ['captable-export-csv', 'captable-export-history', 'captable-export-snapshot', 'captable-sheet-template']) assert.equal(p.count(id), 1, id);
    await p.change('captable-sheet-input', { files: [{ name: 'cap.csv', text: async () => SHEET }] });
    assert.match(p.textOf('captable-sheet-file'), /cap\.csv · 7 rows read/);
    assert.equal(p.count('captable-sheet-row-red'), 4);
    assert.equal(p.count('captable-sheet-row-amber'), 1);
    assert.match(p.textOf('captable-sheet-propose'), /Propose 2 rows/);
    await p.click('captable-sheet-filter-errors');
    assert.equal(p.count('captable-sheet-row-amber'), 0);
    await p.click('captable-sheet-propose');
    assert.equal(p.count('captable-sheet-dialog'), 1);
    await p.click('captable-sheet-dialog-go');
    const imp = p.requests.find((r) => r.url.includes('/proposals/import'));
    assert.equal(imp.method, 'POST');
    assert.equal(imp.body.rows.length, 2);
    assert.match(imp.body.file_ref, /^[0-9a-f]{64}$/);
    assert.match(p.textOf('captable-sheet-done'), /Proposed 2 rows\. Each waits for the owner’s Accept/);
  } finally { await p.close(); }
  const bound = await tool('import-export', founderHandler({ live: LIVE({ connected: true, carta_project_id: 3, carta_is_record: true, last_synced_at: '2026-10-24 08:00:00' }) }));
  try {
    assert.equal(bound.count('captable-carta-record'), 1);
    assert.equal(bound.count('captable-carta-bind'), 0);
  } finally { await bound.close(); }
  const other = await tool('import-export', founderHandler({ live: LIVE({ connected: true, carta_project_id: 9 }) }));
  try {
    assert.match(other.textOf('captable-carta-unbound'), /another of your ventures/);
    await other.click('captable-carta-bind');
    await other.click('captable-carta-dialog-go');
    assert.deepEqual(other.requests.find((r) => r.url.includes('/captable/carta/venture')).body, { project_id: 3 });
  } finally { await other.close(); }
});

const VIEW = (via, level, view, extra = {}) => ({ project_id: 3, level, via, read_only: true, source: 'model', source_note: 'These figures come from the venture\'s saved model, not from a record of what was issued.', view, ...extra });
const SUMMARY = { audience: 'summary', scenario_name: 'Main', rounds_completed: 1, summary: [{ group: 'Founders', pct: 80 }, { group: 'Option pool', pct: 20 }] };
const FULL = { audience: 'full', scenario_name: 'Main', rounds_completed: 0, founding: [{ holder: 'Ada Founder', type: 'founder', shares: 8000, pct: 80 }], rounds: [] };

test('CT17: an Advisor at Summary and an Operating Partner at their level read only', async () => {
  const advisor = await readPage((url) => (url.includes('/captable/access/3') ? response(VIEW('member', 'summary', SUMMARY)) : response({})));
  try {
    assert.equal(advisor.count('captable-read-view-summary'), 1);
    assert.match(advisor.textOf('captable-read-view-rounds'), /1 round raised/);
    assert.equal(advisor.count('captable-read-view-positions'), 0, 'Summary names nobody');
    assert.equal(advisor.count('captable-support-open'), 0);
    assert.equal(advisor.count('captable-read-only'), 1);
    assert.equal(advisor.count('captable-hq-log'), 0, 'the log across companies is HQ’s');
    assert.equal(advisor.requests.some((r) => r.url.includes('/captable/access/log')), false);
  } finally { await advisor.close(); }
  const partner = await readPage((url) => (url.includes('/captable/access/3') ? response(VIEW('grant', 'full', FULL)) : response({})));
  try {
    assert.equal(partner.count('captable-read-view-full'), 1);
    assert.match(partner.textOf('captable-read-line'), /Shared with you at Full level\. You can read it; you cannot change it/);
    assert.equal(partner.count('captable-read-scenarios'), 1);
  } finally { await partner.close(); }
  const nobody = await readPage(() => response({ error: 'not_shared', message: 'The founder has not shared the cap table with you.' }, 403));
  try { assert.match(nobody.textOf('captable-read-refused'), /has not shared the cap table with you/); } finally { await nobody.close(); }
});

test('CT18: an Admin opens for support with a reason the founder sees; the Super Admin reads the log across companies', async () => {
  const admin = await readPage((url, opts) => {
    if (url.includes('/support')) return response(VIEW('support', 'full', FULL, { reason: JSON.parse(opts.body).reason }));
    if (url.includes('/captable/access/3')) return response(VIEW('studio', 'summary', SUMMARY, { support: 'Open for support asks for a reason first. The founder sees it.' }));
    return response({});
  });
  try {
    assert.equal(admin.count('captable-read-view-summary'), 1);
    assert.match(admin.textOf('captable-read-line'), /group summary/);
    await admin.click('captable-support-open');
    await admin.change('captable-support-reason', 'short');
    assert.match(admin.textOf('captable-support-problem'), /at least 10/);
    await admin.change('captable-support-reason', 'Founder asked us to check the pool');
    await admin.click('captable-support-dialog-go');
    assert.deepEqual(admin.requests.find((r) => r.url.includes('/support')).body, { reason: 'Founder asked us to check the pool' });
    assert.equal(admin.count('captable-read-view-full'), 1);
    assert.match(admin.textOf('captable-support-line'), /‘Founder asked us to check the pool’\. The founder sees why/);
    assert.equal(admin.count('captable-support-open'), 0, 'opened once');
  } finally { await admin.close(); }
  const hq = await readPage((url) => {
    if (url.includes('/captable/access/log')) return response({ items: [{ id: 1, project_id: 3, venture: 'Acme', via: 'support', level: 'full', reason: 'Check a pool top-up', opened_at: '2026-10-11 17:20:00', who: 'Sam Admin' }], next_before: null });
    if (url.includes('/captable/access/3')) return response(VIEW('hq', 'full', FULL));
    return response({});
  });
  try {
    assert.equal(hq.count('captable-read-view-full'), 1);
    assert.equal(hq.count('captable-hq-log-row'), 1);
    assert.match(hq.textOf('captable-hq-log-table'), /Acme/);
    assert.equal(hq.count('captable-support-open'), 0, 'HQ reads and opens nothing for support');
  } finally { await hq.close(); }
});

test('the venture link: the view at its level, and a spent link said plainly', async () => {
  const route = [h(Route, { key: 'v', path: '/share/captable/venture/:token', element: h(VentureSharePage) })];
  const ok = await mounted('/share/captable/venture/tok', (url) => (url.includes('/captable/access/shared/tok') ? response({ level: 'summary', source_note: 'saved model', view: SUMMARY }) : response({})), route);
  try {
    assert.equal(ok.count('captable-venture-share-view-summary'), 1);
    assert.match(ok.textOf('captable-venture-share-line'), /Shared by link at Summary level/);
  } finally { await ok.close(); }
  const spent = await mounted('/share/captable/venture/old', () => response({ error: 'link_spent', message: 'This link has been used its maximum number of times, or has expired.' }, 410), route);
  try { assert.match(spent.textOf('captable-venture-share-refused'), /maximum number of times/); } finally { await spent.close(); }
});

test('the wiring: the tabs, the routes, the clients, and the import and export on the Worker', () => {
  assert.deepEqual(TABS.slice(-2).map((t) => t.path), ['/access', '/import-export']);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/cap-tables\/:projectId" element=\{guard\(\['admin', 'advisor', 'partner'\], <CapTableReadPage \/>\)\}/);
  assert.ok(app.indexOf('path="/share/captable/venture/:token"') < app.indexOf('path="/share/captable/:token"'));
  const api = read('frontend/src/lib/api.js');
  for (const m of ['capTableAccess', 'capTableRecord', 'capTableRegister']) assert.match(api, new RegExp(`export \\* from './api/${m}\\.js';`));
  const worker = read('cloudflare-worker/src/routes/captable.ts');
  assert.match(worker, /captable\.post\('\/record\/:projectId\/proposals\/import'/);
  assert.match(worker, /captable\.get\('\/record\/:projectId\/export\.csv'/);
  assert.ok(!/alert\(|window\.confirm|confirm\(/.test(read('frontend/src/pages/raise/captable/ImportExportTab.jsx') + read('frontend/src/pages/raise/captable/SharedCapTable.jsx')));
});
