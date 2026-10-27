/**
 * D987 (#2778) — Program grants, the HQ page complete: the grid from D982's
 * read with its tiles and two charts (GR1), one studio at its own address
 * (GR3) with the grant lightbox (GR4), the Requests (GR5/5d) and Default terms
 * (GR6) tabs, the reason dialogs (GR10) and the states (GR11–14). Mounted on
 * a stubbed fetch; each block that fails reads Unreadable with Try again.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_grants_d987.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ProgramGrants from '../src/pages/admin/grants/ProgramGrants.jsx';
import {
  NOT_RECORDED, cellOf, changedKeys, defaultsCards, gridRows, holdingChart, holdingRows, liveSentence, monthsChart,
  inUseOf, requestRow, studioCsv, studioRows, termInput, termsPayload, tilesOf, viewOf,
} from '../src/pages/admin/grants/grantsModel.js';
import { PROGRAMS } from '../src/lib/programGrants.js';
import { stripFor, stripItemFor } from '../src/lib/hqStrips.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-21T12:00:00Z');
const pin = (t) => t.mock.timers.enable({ apis: ['Date'], now: NOW });

// ---------------------------------------------------------------- fixtures (invented)

const COMMON = { playbook: 'as_written', brand: 'axal', reporting: null, requires_signed_schedule: 1, ends_with_licence: 1, fee_cents: 200000, currency: 'EUR' };
const BASE_APPLIES = ['starts_on', 'ends_on', 'ends_with_licence', 'fee_cents', 'currency', 'playbook', 'brand', 'reporting', 'requires_signed_schedule'];
const DEF = {
  'spinout-lab': { cohorts_per_year: 12, capacity_cap: 60, capacity_uncapped: 0, hq_share_bps: 1000, hq_approves_each_cohort: 0 },
  'mentor-cohorts': { cohorts_per_year: 12, capacity_cap: 8, capacity_uncapped: 0, hq_approves_each_cohort: 0 },
  'referral-partners': { hq_share_bps: 1000, hq_approval_above_cents: 1000000 },
  'refer-and-earn': { credits_per_quarter: 300, hq_share_bps: 1000 },
  perks: { credits_per_quarter: 300, hq_share_bps: 1000 },
  learning: { capacity_cap: 60, capacity_uncapped: 0, hq_share_bps: 1000 },
};
const DEFAULTS = PROGRAMS.map((p) => {
  const readiness = p.grant;
  const terms = readiness === 'yes' ? { ...COMMON, ...DEF[p.key] } : {};
  return {
    program_key: p.key, name: p.name, group: p.group, readiness, grantable: readiness === 'yes',
    locked_reason: readiness === 'notready' ? `${p.name} is not ready to grant.` : null,
    terms, applies: readiness === 'yes' ? [...BASE_APPLIES, ...Object.keys(DEF[p.key])] : [],
    updated_by_user_id: null, updated_at: p.key === 'perks' ? '2026-09-01 10:00:00' : null,
  };
});
const grant = (licence, program, over = {}) => ({
  uid: `g-${licence}-${program}`, licence_uid: licence, program_key: program, state: 'granted',
  terms: { ...COMMON, ...DEF[program], starts_on: '2025-02-01' }, effective_end: '2027-10-31', in_force: true, waiting_on: [],
  schedule: { status: 'signed', contract_uid: 'c-1', signed_at: '2026-10-02 09:00:00' }, note: null,
  paused_at: null, ended_at: null, set_by_user_id: 1, set_at: '2026-02-01 10:00:00', ...over,
});
const LICENCES = [
  { uid: 'l1', licence_ref: 'AXL-002', brand_name: 'Studio Lisbon', kind: 'subsidiary', status: 'active', grants: {
    perks: grant('l1', 'perks'),
    'refer-and-earn': grant('l1', 'refer-and-earn', { terms: { ...COMMON, ...DEF['refer-and-earn'], credits_per_quarter: 400, starts_on: '2025-02-01' } }),
    'spinout-lab': grant('l1', 'spinout-lab', { schedule: { status: 'not_sent', contract_uid: null, signed_at: null } }),
  } },
  { uid: 'l2', licence_ref: 'AXL-004', brand_name: 'Northfield Ventures', kind: 'white_label', status: 'active', grants: {} },
  { uid: 'l3', licence_ref: 'AXL-005', brand_name: 'Studio Seoul', kind: 'subsidiary', status: 'suspended', grants: {
    'spinout-lab': grant('l3', 'spinout-lab', { state: 'paused', in_force: false, paused_at: '2026-10-03 08:00:00' }),
  } },
  { uid: 'l4', licence_ref: 'AXL-006', brand_name: 'Studio Bogotá', kind: 'subsidiary', status: 'pending_activation', grants: {
    perks: grant('l4', 'perks', { in_force: false, waiting_on: ['licence_active'] }),
    learning: grant('l4', 'learning', { state: 'draft', in_force: false, terms: { capacity_cap: 30 } }),
  } },
];
const GRID = {
  programs: DEFAULTS, licences: LICENCES,
  tiles: { in_force: 3, granted: 5, paused: 1, requests_waiting: 1, requests_waiting_reason: null, ending_in_90_days: null, fees_a_year: [], fees_not_recorded: 0 },
  series: {
    holding: [],
    requests_by_month: [
      { month: '2026-09', so_far: false, waiting: 0, approved: 1, declined: 0, withdrawn: 0 },
      { month: '2026-10', so_far: true, waiting: 1, approved: 0, declined: 1, withdrawn: 0 },
    ],
    requests_by_month_reason: null,
  },
};
const lic = (uid) => { const l = LICENCES.find((x) => x.uid === uid); return { uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, status: l.status }; };
const REQUESTS = { complete: true, items: [
  { uid: 'r1', kind: 'program_grant', asks_for: 'Grant', program_key: 'learning', program_name: 'Learning', request: { program: 'learning' },
    note: 'Forty founders want the fundraising course in Portuguese.', lane: 'hq', branch_code: null, licence: lic('l1'), raised_by_name: 'A. Example',
    status: 'open', created_at: '2026-10-12 09:00:00', due_at: '2026-10-15 09:00:00', sla: 'past', answer: null, answered_by_name: null, answered_at: null, draft: null },
  { uid: 'r2', kind: 'program_grant', asks_for: 'Grant', program_key: 'mentor-cohorts', program_name: 'Mentor cohort access', request: { program: 'mentor-cohorts' },
    note: null, lane: 'branch', branch_code: 'NB-1', licence: lic('l2'), raised_by_name: 'B. Sample',
    status: 'answered', created_at: '2026-10-08 09:00:00', due_at: null, sla: null, answer: 'Approved for a first year.', answered_by_name: 'HQ', answered_at: '2026-10-09 09:00:00',
    draft: { uid: 'g-draft', state: 'draft', terms: { cohorts_per_year: 6 } } },
  { uid: 'r3', kind: 'program_terms_change', asks_for: 'Change terms', program_key: 'perks', program_name: 'Perks', request: { program: 'perks', term: 'credits_per_quarter', asked: 500 },
    note: null, lane: 'hq', branch_code: null, licence: lic('l1'), raised_by_name: 'A. Example',
    status: 'declined', created_at: '2026-10-02 09:00:00', due_at: null, sla: null, answer: 'Not this quarter.', answered_by_name: 'HQ', answered_at: '2026-10-03 09:00:00', draft: null },
] };
const STUDIO = {
  licence: { ...lic('l1'), kind: 'subsidiary', renews_on: '2027-10-31' },
  grants: Object.values(LICENCES[0].grants),
  history: [
    { id: 2, action: 'terms_changed', program_key: 'refer-and-earn', changed: [{ key: 'credits_per_quarter', before: 300, after: 400 }], reason: 'Referral volume doubled.', actor_user_id: 1, actor_name: 'HQ Admin', at: '2026-10-14 10:00:00' },
    { id: 1, action: 'granted', program_key: 'perks', changed: [], reason: 'Year one plan.', actor_user_id: 1, actor_name: 'HQ Admin', at: '2025-02-01 10:00:00' },
  ],
};
// D1281: D1156's in-use read for Studio Lisbon: Perks reported, Refer & Earn not yet.
const USAGE = { licence_uid: 'l1', programs: [
  { program_key: 'perks', state: 'reported', period: '2026-10', reported_at: '2026-10-25T03:00:00.000Z', age_seconds: 3600, stale: false,
    counts: { people: { value: 9, state: 'recorded', reason: null }, cohorts: { value: null, state: 'not_recorded', reason: 'x' },
      referrals: { value: null, state: 'not_recorded', reason: 'x' }, claims: { value: 1204, state: 'recorded', reason: null } } },
  { program_key: 'refer-and-earn', state: 'not_reported', reason: 'This studio has not reported program figures yet.', period: null, reported_at: null, counts: null },
] };
const DEALS = { licence: lic('l1'), catalogue: [{ type: 'referral', label: 'Referral' }, { type: 'revenue_share', label: 'Revenue share' }], recorded: false, types: null, reason: 'HQ has not recorded a list, so every type stays open.', history: [] };

// ---------------------------------------------------------------- the model

test('the addresses: the grid, its two tabs and one studio', () => {
  assert.deepEqual(viewOf('/admin/licences/programs'), { view: 'grid' });
  assert.deepEqual(viewOf('/admin/licences/programs/requests'), { view: 'requests' });
  assert.deepEqual(viewOf('/admin/licences/programs/defaults/'), { view: 'defaults' });
  assert.deepEqual(viewOf('/admin/licences/programs/studio/l%201'), { view: 'studio', uid: 'l 1' });
  for (const p of ['/admin/licences/programs/requests', '/admin/licences/programs/studio/l1']) {
    assert.equal(stripFor(p), 'Licences');
    assert.equal(stripItemFor(p), '/admin/licences/programs');
  }
});

test('a cell says what the store holds: default, own terms, waiting, draft, paused, requested, and the fixed facts', () => {
  const rows = gridRows(GRID, REQUESTS.items);
  const cell = (ref, key) => rows.find((r) => r.ref === ref).cells.find((c) => c.program.key === key);
  assert.equal(cell('AXL-002', 'perks').kind, 'granted');
  assert.equal(cell('AXL-002', 'perks').sub, 'to 31 Oct 2027');
  assert.equal(cell('AXL-002', 'refer-and-earn').kind, 'own');
  assert.match(cell('AXL-002', 'refer-and-earn').tip, /Credits a quarter 300 → 400/);
  assert.equal(cell('AXL-002', 'learning').kind, 'requested');
  assert.equal(cell('AXL-002', 'learning').pill, '◷ Requested 12 Oct');
  assert.equal(cell('AXL-005', 'spinout-lab').pill, '‖ Paused 3 Oct');
  assert.equal(cell('AXL-005', 'perks').canGrant, false, 'a suspended licence offered Grant');
  assert.equal(cell('AXL-004', 'perks').canGrant, true);
  assert.match(cell('AXL-006', 'perks').sub, /waiting on the licence to be active/);
  assert.equal(cell('AXL-006', 'learning').pill, '✎ Draft');
  assert.equal(cell('AXL-002', 'product-testing').pill, '⌂ HQ only');
  assert.equal(cell('AXL-002', 'investor-cohorts').kind, 'notready');
  const off = cellOf({ program: PROGRAMS.find((p) => p.key === 'perks'), defaults: { grantable: false }, studio: 'S' });
  assert.equal(off.canGrant, false, 'a switched-off default offered Grant');
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ['b']);
});

test('the tiles: an unread figure is Unreadable or Not recorded, never 0', () => {
  const tiles = tilesOf(GRID, { status: 'ready', data: REQUESTS }, NOW);
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  assert.equal(by.studios.value, 4);
  assert.equal(by.studios.sub, '2 active · 1 suspended · 1 pending activation');
  assert.equal(by['in-force'].value, 3);
  assert.match(by['in-force'].sub, /1 on their own terms/);
  assert.equal(by.requests.sub, 'oldest 9 days');
  assert.equal(by.requests.flag, 'Past response time');
  assert.equal(by.ending.value, null, 'an unknown count became a number');
  const lost = tilesOf({ ...GRID, tiles: { ...GRID.tiles, requests_waiting: null, requests_waiting_reason: 'Program requests could not be read.' } }, { status: 'error' }, NOW);
  assert.equal(lost.find((t) => t.key === 'requests').unreadable, true);
});

test('the charts: who holds each program, and requests by month (null when unread)', () => {
  const rows = holdingRows(GRID, REQUESTS.items);
  const perks = rows.find((r) => r.key === 'perks');
  assert.deepEqual([perks.granted, perks.own, perks.requested, perks.paused, perks.of], [2, 0, 0, 0, 4]);
  const learning = rows.find((r) => r.key === 'learning');
  assert.equal(learning.requested, 1, 'an open request was not counted');
  assert.equal(rows.find((r) => r.key === 'refer-and-earn').own, 1);
  assert.equal(rows.find((r) => r.key === 'spinout-lab').paused, 1);
  assert.match(holdingChart(rows).alt, /Studios holding each program, of 4/);
  const months = monthsChart(GRID.series.requests_by_month);
  assert.deepEqual(months.rows.map((r) => [r.label, r.values, r.toDate]), [['Sep', [1, 0, 0, 0], false], ['Oct', [0, 1, 0, 1], true]]);
  assert.equal(monthsChart(null), null);
});

test('terms: typed in units, sent as cents and basis points, only what changed', () => {
  assert.equal(termInput('fee_cents', '2000'), 200000);
  assert.equal(termInput('hq_share_bps', '12.5'), 1250);
  assert.equal(termInput('capacity_uncapped', '1'), 1);
  assert.equal(termInput('reporting', ''), null);
  assert.deepEqual(termsPayload(['fee_cents', 'credits_per_quarter'], { fee_cents: '2000', credits_per_quarter: '400' }, { fee_cents: 200000, credits_per_quarter: 300 }), { credits_per_quarter: 400 });
  const s = liveSentence({ studio: 'Studio Lisbon', program: 'Perks', terms: { ...COMMON, starts_on: '2026-11-01' }, licence: { status: 'pending_activation' } });
  assert.equal(s, 'Studio Lisbon may run Perks from 1 Nov 2026 to the end of its licence, paying HQ €2,000 a year. It starts when the licence is active. It starts when the program schedule is signed.');
});

test('one studio\'s rows: In use from the studio\'s reports (D1281), a frozen licence disables writes, the CSV is safe', () => {
  // Mutation checked: the unconditional wait restored; a missing report drawn as a zero; the report date dropped.
  const rows = studioRows(STUDIO, DEFAULTS, REQUESTS.items, { status: 'ready', data: USAGE });
  const r = (k) => rows.find((x) => x.program.key === k);
  assert.equal(rows.length, 9);
  assert.deepEqual([r('perks').inUse.text, r('perks').inUse.reason], ['People 9 · Claims 1,204', 'Reported 25 Oct 2026 for 2026-10.']);
  assert.deepEqual([r('refer-and-earn').inUse.text, r('refer-and-earn').inUse.reason],
    [NOT_RECORDED, 'This studio has not reported this program yet. Its last report was on 25 Oct 2026.']);
  assert.ok(rows.every((x) => !x.inUse || !/program figures yet/.test(x.inUse.reason)), 'D1281: the unconditional wait is gone');
  assert.equal(r('perks').schedule, 'Signed 2 Oct');
  assert.equal(r('spinout-lab').schedule, 'Not sent');
  assert.ok(r('spinout-lab').actions.some((a) => a.key === 'schedule'));
  assert.ok(!r('perks').actions.some((a) => a.key === 'schedule'), 'a signed schedule offered Send');
  assert.equal(r('refer-and-earn').grantWord, '✓ Granted, own terms');
  assert.equal(r('learning').actions[0].key, 'answer');
  const frozen = studioRows({ ...STUDIO, licence: { ...STUDIO.licence, status: 'suspended' } }, DEFAULTS, []);
  assert.equal(frozen.find((x) => x.program.key === 'refer-and-earn').actions.find((a) => a.key === 'change').disabled, true);
  assert.equal(frozen.find((x) => x.program.key === 'refer-and-earn').actions.find((a) => a.key === 'pause').disabled, undefined, 'pause stays open on a frozen licence');
  const csv = studioCsv([{ ...rows[0], program: { ...rows[0].program, name: '=HYPERLINK("x")' } }]);
  assert.match(csv, /^"Program","Group"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, 'a formula reached the CSV');
});

test('a request row: waiting and its response time while open; Finish grant for an approved draft', () => {
  const [open, answered, declined] = REQUESTS.items.map((x) => requestRow(x, NOW));
  assert.deepEqual([open.waiting, open.slaWord, open.action, open.status], ['9 days', 'Past response time', 'Answer', '◷ Waiting']);
  assert.deepEqual([answered.waiting, answered.action, answered.studio], ['—', 'Finish grant', 'Northfield Ventures']);
  assert.equal(declined.note, 'Credits a quarter to 500');
  assert.equal(declined.action, 'Open');
  assert.equal(requestRow({ ...REQUESTS.items[0], licence: null }, NOW).studio, 'Licence not found in the ledger');
});

test('a defaults card: its terms in words, its grant count, a not-ready card locked', () => {
  const cards = defaultsCards(DEFAULTS, GRID);
  const perks = cards.find((c) => c.key === 'perks');
  assert.equal(perks.foot, 'Granted to 2 studios');
  assert.ok(perks.rows.some((r) => r.label === 'Reporting' && r.text === NOT_RECORDED));
  assert.ok(perks.rows.some((r) => r.label === 'Program fee a year' && r.text === '€2,000'));
  assert.equal(perks.updated, 'Changed 1 Sep 2026');
  assert.equal(cards.find((c) => c.key === 'spinout-lab').foot, 'Granted to 1 studio · 1 paused');
  assert.equal(cards.find((c) => c.key === 'investor-cohorts').kind, 'notready');
  assert.equal(cards.find((c) => c.key === 'product-testing').foot, 'Runs in HQ › Platform.');
});

// ---------------------------------------------------------------- mounted

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The Worker, stubbed. `fail` names reads that 503; `writes` answers a write by "METHOD path". */
function worker({ fail = [], writes = {}, grid = GRID, requests = REQUESTS, usage = USAGE } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    const key = `${method} ${u.pathname}`;
    seen.push({ key, body: init.body ? JSON.parse(init.body) : null });
    if (fail.includes(key)) return json({ error: 'down', message: 'down' }, 503);
    if (writes[key]) return writes[key]();
    if (method !== 'GET') return json({ ok: true });
    if (u.pathname === '/api/admin/program-grants') return json(grid);
    if (u.pathname === '/api/admin/program-grants/requests') return json(requests);
    if (u.pathname === '/api/admin/program-grants/defaults') return json({ programs: DEFAULTS });
    if (u.pathname === '/api/admin/program-grants/licences/l1') return json(STUDIO);
    if (u.pathname === '/api/admin/program-grants/licences/l1/in-use') return json(usage);
    if (u.pathname.startsWith('/api/admin/program-grants/licences/')) return json({ error: 'not_found', message: 'There is no such licence.' }, 404);
    if (u.pathname === '/api/admin/partner-deal-types/licences/l1') return json(DEALS);
    return json({});
  };
  return seen;
}

function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, l.pathname); }

async function mount(url, opts = {}) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: !!opts.phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const seen = worker(opts);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(ProgramGrants), h(Where))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byTestId(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen,
    writes: () => seen.filter((s) => !s.key.startsWith('GET ') && !s.key.includes('/api/ai')),
    reads: () => [...new Set(seen.filter((s) => s.key.startsWith('GET ') && !s.key.includes('/api/ai')).map((s) => s.key))],
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    prop: (id, k) => props(byTestId(id))?.[k],
    text: () => textOf(document.body),
    click: (id) => fire(id, 'onClick'),
    change: (id, value) => fire(id, 'onChange', { target: { value } }),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; globalThis.matchMedia = media; restore(); },
  };
}

test('mounted grid: the tabs at their addresses, the tiles, both charts and a cell for every program', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs');
  try {
    assert.match(m.of('grants-header'), /Program grants.*HQ only.*Grid.*Requests.*1.*Default terms/s);
    assert.equal(m.prop('grants-tab-requests', 'href'), '/admin/licences/programs/requests');
    assert.equal(m.prop('grants-tab-defaults', 'href'), '/admin/licences/programs/defaults');
    assert.match(m.of('grants-tile-studios'), /4.*2 active · 1 suspended · 1 pending activation/s);
    assert.match(m.of('grants-tile-requests'), /1.*Past response time.*oldest 9 days/s);
    assert.match(m.of('grants-tile-ending'), /Not recorded/);
    assert.match(m.of('grants-chart-holding'), /Perks/);
    assert.match(m.of('grants-chart-months'), /Still waiting/);
    assert.match(m.of('grants-cell-AXL-002-learning'), /Requested 12 Oct/);
    assert.match(m.of('grants-cell-AXL-006-perks'), /Granted.*waiting on the licence to be active/s);
    assert.match(m.of('grants-row-AXL-005'), /frozen until HQ lifts the suspension/);
    assert.ok(!m.has('grants-grant-AXL-005-perks'), 'a frozen studio offered Grant');
    assert.deepEqual(m.reads().sort(), ['GET /api/admin/program-grants', 'GET /api/admin/program-grants/requests']);
    await m.click('grants-chart-holding-table');
    assert.match(m.of('grants-chart-holding'), /Perks.*2 of 4/s);
  } finally { await m.unmount(); }
});

test('mounted grid: a failed grid read is Unreadable with Try again and the requests count still reads; failed requests say so', async (t) => {
  pin(t);
  let m = await mount('/admin/licences/programs', { fail: ['GET /api/admin/program-grants'] });
  try {
    assert.match(m.of('grants-unreadable'), /could not be read. That is not the same as none.*Try again/s);
    assert.match(m.of('grants-tile-0'), /Unreadable/);
    assert.match(m.of('grants-chart-holding'), /could not be read/);
    assert.match(m.of('grants-tab-requests'), /1/);
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs', { fail: ['GET /api/admin/program-grants/requests'] });
  try {
    assert.match(m.of('grants-requests-unread'), /Requests could not be read/);
    assert.match(m.of('grants-cell-AXL-002-perks'), /Granted/);
    assert.equal(m.of('grants-tab-requests'), 'Requests—');
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs', { grid: { ...GRID, licences: [] } });
  try { assert.match(m.of('grants-empty'), /No studio holds a licence yet/); } finally { await m.unmount(); }
});

test('mounted grant (GR4 → GR10a): terms marked Default or Changed, the live sentence, a reason, then one POST', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs');
  try {
    await m.click('grants-grant-AXL-004-perks');
    assert.match(m.of('grant-lightbox'), /Grant Perks to Northfield Ventures/);
    // D1317: one grant's terms open as the shared Sheet, 600 → 640px.
    assert.equal(m.prop('grant-lightbox', 'role'), 'dialog');
    assert.ok(m.prop('grant-lightbox', 'aria-labelledby'));
    assert.equal(m.prop('grant-lightbox', 'data-width'), 640);
    assert.equal(m.of('grant-chip-credits_per_quarter'), 'Default');
    await m.change('grant-input-credits_per_quarter', '450');
    assert.equal(m.of('grant-chip-credits_per_quarter'), 'Changed');
    assert.match(m.of('grant-sentence'), /Northfield Ventures may run Perks.*paying HQ €2,000 a year/);
    assert.equal(m.prop('grant-review', 'disabled'), true, 'Review opened without a reason');
    await m.change('grant-reason', 'Too short');
    assert.equal(m.prop('grant-review', 'disabled'), true);
    await m.change('grant-reason', 'Two venture scouts are ready to start.');
    await m.click('grant-review');
    assert.match(m.of('grant-differ'), /Credits a quarter: 450\. Default: 300\./);
    assert.equal(m.writes().length, 0, 'a write left before Grant');
    await m.click('grant-confirm');
    const [w] = m.writes();
    assert.equal(w.key, 'POST /api/admin/program-grants/licences/l2/perks');
    assert.equal(w.body.terms.credits_per_quarter, 450);
    assert.equal(w.body.terms.fee_cents, 200000);
    assert.equal(w.body.reason, 'Two venture scouts are ready to start.');
    assert.match(m.of('grants-done'), /Perks granted to Northfield Ventures/);
  } finally { await m.unmount(); }
});

test('mounted grant: the Worker\'s refusal is said in the dialog in its words and nothing is claimed', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs', { writes: {
    'POST /api/admin/program-grants/licences/l2/perks': () => json({ error: 'not_grantable', message: 'Perks is switched off in HQ\'s default terms, so it cannot be granted.' }, 422),
  } });
  try {
    await m.click('grants-grant-AXL-004-perks');
    await m.change('grant-reason', 'Two venture scouts are ready to start.');
    await m.click('grant-review');
    await m.click('grant-confirm');
    assert.match(m.of('grant-refusal'), /switched off in HQ's default terms/);
    assert.ok(!m.has('grants-done'));
  } finally { await m.unmount(); }
});

test('mounted one studio (GR3): its tiles, In use waiting, its deal types, history, and Send schedule with a reason', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs/studio/l1');
  try {
    assert.match(m.of('studio-header'), /Studio Lisbon.*Licence AXL-002 · renews 31 Oct 2027/s);
    assert.match(m.of('studio-tile-granted'), /3.*of 6 HQ can grant/s);
    assert.match(m.of('studio-tile-own'), /1.*Refer & Earn/s);
    assert.match(m.of('studio-tile-fees'), /€6,000/);
    assert.match(m.of('studio-inuse-perks'), /People 9 · Claims 1,204.*Reported 25 Oct 2026 for 2026-10\./s);
    assert.match(m.of('studio-inuse-refer-and-earn'), /Not recorded.*has not reported this program yet/s);
    assert.ok(m.reads().includes('GET /api/admin/program-grants/licences/l1/in-use'));
    assert.match(m.of('studio-row-refer-and-earn'), /Granted, own terms.*400 credits a quarter.*Changed/s);
    assert.match(m.of('studio-deal-types'), /every type stays open.*Referral.*Revenue share/s);
    assert.match(m.of('studio-history'), /Refer & Earn: terms changed · Credits a quarter 300 → 400.*Reason: Referral volume doubled/s);
    assert.match(m.of('studio-requests'), /Learning · Grant.*past response time/s);
    await m.click('studio-act-spinout-lab-schedule');
    assert.match(m.of('studio-schedule-dialog'), /Send Spin-Out Lab’s schedule to Studio Lisbon/);
    await m.change('studio-schedule-dialog-reason', 'Too short');
    assert.equal(m.prop('studio-schedule-dialog-confirm', 'disabled'), true, 'a reason under 10 characters was taken');
    await m.change('studio-schedule-dialog-reason', 'The grant is ready to be signed.');
    await m.click('studio-schedule-dialog-confirm');
    const [w] = m.writes();
    assert.equal(w.key, 'POST /api/admin/program-grants/licences/l1/spinout-lab/schedule/send');
    assert.deepEqual(w.body, { reason: 'The grant is ready to be signed.' });
    assert.match(m.of('studio-done'), /schedule is sent for signature/);
    await m.click('studio-act-perks-history');
    assert.doesNotMatch(m.of('studio-history'), /Refer & Earn/);
  } finally { await m.unmount(); }
});

test('mounted one studio: a refusal stays in the dialog; a failed read is Unreadable; an unknown licence says so', async (t) => {
  pin(t);
  let m = await mount('/admin/licences/programs/studio/l1', { writes: {
    'POST /api/admin/program-grants/licences/l1/perks/pause': () => json({ error: 'wrong_state', message: 'This grant changed while you were pausing it. Read it again.' }, 409),
  } });
  try {
    await m.click('studio-act-perks-pause');
    await m.change('studio-pause-dialog-reason', 'Sign-ups wait for the new playbook.');
    await m.click('studio-pause-dialog-confirm');
    assert.match(m.of('studio-pause-dialog-refusal'), /changed while you were pausing it/);
    assert.ok(!m.has('studio-done'));
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs/studio/l1', { fail: ['GET /api/admin/program-grants/licences/l1', 'GET /api/admin/partner-deal-types/licences/l1'] });
  try {
    assert.match(m.of('studio-unreadable'), /could not be read. That is not the same as none.*Try again/s);
    assert.ok(!m.has('studio-tiles'));
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs/studio/l1', { fail: ['GET /api/admin/partner-deal-types/licences/l1'] });
  try {
    assert.match(m.of('studio-deal-types-unreadable'), /could not be read.*Try again/s);
    assert.match(m.of('studio-row-perks'), /Granted/, 'one failed block blanked the page');
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs/studio/nope');
  try { assert.match(m.of('studio-missing'), /No licence has this reference/); } finally { await m.unmount(); }
});

test('mounted Requests (GR5/5d): waiting longest first, Answer → decline with a note, Finish grant from the draft', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs/requests');
  try {
    assert.match(m.of('requests-row-r1'), /Studio Lisbon.*AXL-002.*Learning.*Grant.*12 Oct.*9 days.*Past response time.*Forty founders.*Waiting.*Answer/s);
    assert.match(m.of('requests-row-r2'), /From a branch · NB-1.*Answered.*Finish grant/s);
    assert.match(m.of('requests-row-r3'), /Declined.*Open/s);
    await m.change('requests-search', 'northfield');
    assert.ok(!m.has('requests-row-r1') && m.has('requests-row-r2'));
    await m.change('requests-search', '');
    await m.click('requests-answer-r1');
    await m.change('answer-decline');
    await m.change('answer-reason', 'Learning waits for the Portuguese course.');
    await m.click('answer-confirm');
    let [w] = m.writes();
    assert.equal(w.key, 'POST /api/admin/program-grants/requests/r1/decline');
    assert.deepEqual(w.body, { reason: 'Learning waits for the Portuguese course.' });
    assert.match(m.of('requests-done'), /Declined/);
    await m.click('requests-finish-r2');
    assert.match(m.of('grant-lightbox'), /Grant Mentor cohort access to Northfield Ventures/);
    assert.equal(m.prop('grant-input-cohorts_per_year', 'value'), '6', 'the draft\'s terms were not the start');
    assert.equal(m.of('grant-chip-cohorts_per_year'), 'Changed');
    await m.change('grant-reason', 'Finishing the approved request.');
    await m.click('grant-review');
    await m.click('grant-confirm');
    w = m.writes()[1];
    assert.equal(w.key, 'POST /api/admin/program-grants/licences/l2/mentor-cohorts');
    assert.equal(w.body.terms.cohorts_per_year, 6);
  } finally { await m.unmount(); }
});

test('mounted Requests: a failed read is Unreadable, none is said as none', async (t) => {
  pin(t);
  let m = await mount('/admin/licences/programs/requests', { fail: ['GET /api/admin/program-grants/requests'] });
  try {
    assert.match(m.of('requests-unreadable'), /could not be read. That is not the same as none.*Try again/s);
    assert.ok(!m.has('requests-empty'));
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs/requests', { requests: { items: [], complete: true } });
  try { assert.match(m.of('requests-empty'), /No requests are waiting/); } finally { await m.unmount(); }
});

test('mounted Default terms (GR6): cards in words, the switch and Edit defaults each PUT with a reason', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs/defaults');
  try {
    assert.match(m.of('defaults-card-perks'), /Rewards.*Perks.*Can be granted.*Credits a quarter.*300.*Reporting.*Not recorded.*Edit defaults.*Granted to 2 studios/s);
    assert.equal(m.prop('defaults-switch-investor-cohorts', 'disabled'), true);
    assert.equal(m.prop('defaults-switch-product-testing', 'disabled'), true);
    assert.ok(!m.has('defaults-edit-product-testing'));
    await m.click('defaults-switch-perks');
    assert.match(m.of('defaults-switch-dialog'), /Stop granting Perks/);
    await m.change('defaults-switch-dialog-reason', 'Perks pauses for the catalogue review.');
    await m.click('defaults-switch-dialog-confirm');
    let [w] = m.writes();
    assert.equal(w.key, 'PUT /api/admin/program-grants/defaults/perks');
    assert.deepEqual(w.body, { grantable: false, reason: 'Perks pauses for the catalogue review.' });
    await m.click('defaults-edit-learning');
    assert.equal(m.prop('defaults-dialog-confirm', 'disabled'), true, 'Save opened with nothing changed');
    await m.change('defaults-input-fee_cents', '2500');
    await m.change('defaults-dialog-reason', 'The course costs more to run.');
    await m.click('defaults-dialog-confirm');
    w = m.writes()[1];
    assert.equal(w.key, 'PUT /api/admin/program-grants/defaults/learning');
    assert.deepEqual(w.body, { terms: { fee_cents: 250000 }, reason: 'The course costs more to run.' });
    assert.match(m.of('defaults-done'), /Learning’s default terms are saved/);
  } finally { await m.unmount(); }
  const bad = await mount('/admin/licences/programs/defaults', { fail: ['GET /api/admin/program-grants'] });
  try { assert.match(bad.of('defaults-unreadable'), /Default terms could not be read.*Try again/s); } finally { await bad.unmount(); }
});

test('mounted on a phone (GR15): the grid is a list of studios, one studio a list of cards', async (t) => {
  pin(t);
  let m = await mount('/admin/licences/programs', { phone: true });
  try {
    assert.match(m.of('grants-card-AXL-002'), /Studio Lisbon.*AXL-002.*Spin-Out Lab.*Refer & Earn.*Perks.*Learning/s);
    assert.ok(!m.has('grants-row-AXL-002'));
  } finally { await m.unmount(); }
  m = await mount('/admin/licences/programs/studio/l1', { phone: true });
  try {
    assert.match(m.of('studio-card-perks'), /Perks.*Granted/s);
    assert.ok(!m.has('studio-csv'), 'the phone header carried buttons');
  } finally { await m.unmount(); }
});

// ---------------------------------------------------------------- the source

test('the routes, the guard, the literal tabs, and every write behind a dialog', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/licences/programs', '/admin/licences/programs/requests', '/admin/licences/programs/defaults', '/admin/licences/programs/studio/:uid']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], hqOnly(<ProgramGrants />))} />`), p);
  }
  const page = read('frontend/src/pages/admin/grants/ProgramGrants.jsx');
  for (const to of ['"/admin/licences/programs"', '"/admin/licences/programs/requests"', '"/admin/licences/programs/defaults"']) assert.ok(page.includes(`<HeaderTab to=${to}`), to);
  const dir = 'frontend/src/pages/admin/grants/';
  const all = ['ProgramGrants.jsx', 'GridView.jsx', 'StudioView.jsx', 'RequestsView.jsx', 'DefaultsView.jsx', 'GrantDialogs.jsx'].map((f) => read(dir + f)).join('\n');
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(/, 'a browser pop-up');
  assert.doesNotMatch(all, /\bcredits?\b(?! a quarter)/i, 'say "AI tokens", never credits');
  // Every write the page makes is in a dialog file that asks for a reason.
  const writers = ['GridView.jsx', 'StudioView.jsx', 'RequestsView.jsx', 'DefaultsView.jsx'].map((f) => [f, read(dir + f)]);
  for (const [f, src] of writers) {
    for (const m of src.matchAll(/programGrantsApi\.(\w+)\(/g)) {
      if (['grid', 'requests', 'licence', 'defaults'].includes(m[1])) continue;
      assert.match(src, /run=\{\(reason\) =>/, `${f} writes ${m[1]} outside a reason dialog`);
    }
  }
});

// ---------------------------------------------------------------- D1281: In use

test('D1281 In use, the model: no report, a stale report, a program with no recorded measure, an unreadable figure, a failed read', () => {
  // Mutation checked: a stale report not said; an unreadable figure dropped; a failed read drawn as Not recorded; Reading drawn as a figure.
  const one = (program) => ({ status: 'ready', data: { licence_uid: 'l1', programs: [program] } });
  assert.deepEqual(inUseOf('perks', one({ program_key: 'perks', state: 'not_reported', reported_at: null })),
    { text: NOT_RECORDED, reason: 'This studio has not reported this program yet.', state: 'not_reported' }, 'no last report: no date invented');
  assert.equal(inUseOf('learning', one({ program_key: 'perks', state: 'not_reported' })).text, NOT_RECORDED, 'a program missing from the read is not reported');
  const stale = inUseOf('perks', one({ ...USAGE.programs[0], stale: true }));
  assert.equal(stale.reason, 'Reported 25 Oct 2026 for 2026-10 · more than two days old.');
  const none = inUseOf('perks', one({ ...USAGE.programs[0], counts: { people: { value: null, state: 'not_recorded' } } }));
  assert.deepEqual([none.text, none.reason], [NOT_RECORDED, 'This studio has no recorded measure for this program. Reported 25 Oct 2026 for 2026-10.']);
  const bad = inUseOf('perks', one({ ...USAGE.programs[0], counts: { people: { value: 3, state: 'recorded' }, claims: { value: null, state: 'unreadable' } } }));
  assert.equal(bad.text, 'People 3 · Claims unreadable');
  assert.deepEqual(inUseOf('perks', { status: 'error' }), { text: 'Unreadable', reason: 'Program figures could not be read.', state: 'unreadable' });
  assert.equal(inUseOf('perks', { status: 'loading' }).state, 'loading');
  assert.ok(!/\b0\b/.test(inUseOf('perks', one({ program_key: 'perks', state: 'not_reported' })).text), 'never a zero for a missing report');
});

test('D1281 In use, mounted: a failed read is Unreadable with Try again and the rest of the studio still draws', async (t) => {
  pin(t);
  const m = await mount('/admin/licences/programs/studio/l1', { fail: ['GET /api/admin/program-grants/licences/l1/in-use'] });
  try {
    assert.match(m.of('studio-inuse-perks'), /Unreadable.*Program figures could not be read\./s);
    assert.match(m.of('studio-inuse-unreadable'), /program figures could not be read.*Try again/s);
    assert.match(m.of('studio-row-refer-and-earn'), /Granted, own terms/, 'the rest of the view still draws');
    assert.match(m.of('studio-history'), /Refer & Earn: terms changed/);
  } finally { await m.unmount(); }
});
