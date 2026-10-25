/**
 * D961 (#2794) — Programs part 8: the catalogue complete, on part 1's
 * catalogue read (`GET /api/admin/programs?weeks=&scope=`, D954 §3).
 *
 * What this file holds the catalogue to:
 *   · the period control: 4, 12 or 52 weeks, 12 by default, sent as `weeks=`;
 *     the tiles and charts follow it, the cards keep their answer meanwhile;
 *   · the four tiles, each in its block's state, never a zero for a figure
 *     that was not read;
 *   · Joins per week, Waiting by program and Credits in and out by month:
 *     each series, row and month in its state, the feet only when true;
 *   · the cards from the registry, Lab applications from `counts.pending`;
 *   · the studio filter for a Super Admin, and no per-studio read while R12
 *     reads;
 *   · each chart's loading and failed state, the phone catalogue, dark mode.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_programs_catalogue_d961.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  AXIS_12, HQ_READS, LAB_PEOPLE, PART4_CLAIMS, PART4_STRATEGIC, catalogueBody, labAppsBody, pendingBlock, unreadable,
} from './_programs_catalogue_fixture.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ProgramsCatalogue from '../src/pages/admin/programs/ProgramsCatalogue.jsx';
import { LINE_ADMIN, LINE_SUPER, NOT_READ_YET, NOT_RECORDED, PRODUCT_TESTING_FOOT, SCOPE_LABEL, SCOPE_TITLE } from '../src/pages/admin/programs/programsModel.js';
import {
  CREDIT_FOOT, DEFAULT_WEEKS, JOIN_SERIES, NOTHING_OVER_72, NOT_PER_STUDIO, PERIODS, REENROLMENT_LINE, WAITING_ROWS, WAIT_BANDS,
  blockState, catalogueCards, catalogueTiles, creditsChart, deltaText, joinsChart, labApplications, waitingChart, weekLabel, weeksFrom, withWeeks,
} from '../src/pages/admin/programs/catalogueModel.js';
import { SCOPE_NOTE } from '../src/pages/admin/insights/insightsModel.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { Columns } from '../src/ui/Charts.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const ready = (data) => ({ status: 'ready', data, error: null, at: Date.now() });
const failed = () => ({ status: 'error', data: null, error: { status: 503 }, at: null });
const loading = () => ({ status: 'loading', data: null, error: null, at: null });
const tile = (r, key) => catalogueTiles(r).find((t) => t.key === key);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the period: 4, 12 and 52 weeks, 12 by default, and only those three from the address', () => {
  assert.deepEqual(PERIODS.map((p) => p.weeks), [4, 12, 52]);
  assert.equal(DEFAULT_WEEKS, 12);
  assert.deepEqual(['', '?weeks=4', '?weeks=52', '?weeks=13', '?weeks=x'].map(weeksFrom), [12, 4, 52, 12, 12]);
  assert.equal(withWeeks('?moved=held', 4), '?moved=held&weeks=4');
  assert.equal(withWeeks('?weeks=4', 12), '', 'the default stays out of the address');
});

test('each block has one of four states, and a read that did not answer fails every block it feeds', () => {
  assert.equal(blockState({ available: true, count: 1 }).state, 'ready');
  assert.deepEqual(blockState(pendingBlock('Why.')), { state: 'pending', reason: 'Why.' });
  assert.deepEqual(blockState({ recorded: false, reason: 'None stored.' }), { state: 'unrecorded', reason: 'None stored.' });
  assert.equal(blockState(unreadable()).state, 'unreadable');
  assert.equal(blockState(undefined).state, 'unreadable', 'a missing block is not a zero');
  assert.equal(tile(failed(), 'running').state, 'unreadable');
  assert.equal(tile(loading(), 'people').state, 'loading');
});

test('Programs running: "[n] of [m]" with what is not offered yet and what is proposed', () => {
  const t = tile(ready(catalogueBody()), 'running');
  assert.equal(t.value, '6 of 9');
  assert.equal(t.sub, '2 not offered yet · 1 proposed', 'nine rows, six live, one proposed');
});

test('People taking part: the count, its delta on the period before, what it covers and the Lab left out by name', () => {
  const t = tile(ready(catalogueBody()), 'people');
  assert.equal(t.value, '312');
  assert.equal(t.delta, '+8%');
  assert.deepEqual(t.extra, ['Counts Mentor cohort access, Learning, Refer & Earn and Perks.', `Spin-Out Lab is left out: ${LAB_PEOPLE}`]);
  assert.equal(deltaText(5, 0), null, 'no period before, no delta');
  assert.equal(deltaText(90, 100), '−10%');
});

test('Waiting for you: the sum with its oldest and an Overdue from 72 hours; Could not be read when any queue fails; strategic left out with its reason', () => {
  const t = tile(ready(catalogueBody()), 'waiting');
  assert.equal(t.value, '7');
  assert.equal(t.sub, 'oldest 3 days');
  assert.equal(t.overdue, true);
  assert.deepEqual(t.extra, [`Strategic referral access: ${NOT_READ_YET}. ${PART4_STRATEGIC}`]);
  const at71 = tile(ready(catalogueBody({ waitingTile: { available: true, count: 2, oldest_hours: 71, left_out: [] } })), 'waiting');
  assert.equal(at71.overdue, false, 'Overdue starts at 72 hours');
  const at72 = tile(ready(catalogueBody({ waitingTile: { available: true, count: 2, oldest_hours: 72, left_out: [] } })), 'waiting');
  assert.equal(at72.overdue, true);
  const down = tile(ready(catalogueBody({ waiting: { perks: unreadable('Perk listings') } })), 'waiting');
  assert.equal(down.state, 'unreadable');
  assert.equal(down.value, undefined, 'no smaller total');
  const none = tile(ready(catalogueBody({ waitingTile: { available: true, count: 0, oldest_hours: null, left_out: [] } })), 'waiting');
  assert.equal(none.value, '0');
  assert.equal(none.sub, 'Nothing is waiting.');
});

test('Credits paid out: "[n] paid out · [m] spent on perks" for HQ; "Not read here yet" with HQ\'s line for an Admin', () => {
  const t = tile(ready(catalogueBody({ superAdmin: true })), 'credits');
  assert.equal(t.value, '3,050 paid out');
  assert.equal(t.sub, '2,600 spent on perks');
  const admin = tile(ready(catalogueBody()), 'credits');
  assert.deepEqual([admin.state, admin.word, admin.reason], ['placeholder', NOT_READ_YET, HQ_READS]);
});

test('Joins per week: four series in their colours, "per week", the current week marked, perks pending, and the referrals foot', () => {
  const c = joinsChart(ready(catalogueBody({ superAdmin: true })), { superAdmin: true });
  assert.deepEqual(JOIN_SERIES.map((s) => [s.key, s.tone]), [['lab', 'violet'], ['referrals', 'sky'], ['learning', 'amber'], ['perks', 'emerald']]);
  assert.equal(c.state, 'ready');
  assert.equal(c.axis, 'per week');
  assert.equal(c.chart.type, 'lines');
  assert.equal(c.chart.currentIndex, AXIS_12.length - 1, 'the current week is drawn hollow');
  assert.deepEqual(c.chart.series.map((s) => s.label), ['Lab applications', 'Referrals submitted', 'Learning enrolments']);
  assert.equal(c.chart.labels[0], '3 Aug');
  assert.deepEqual(c.missing, [{ key: 'perks', label: 'Perk claims', word: NOT_READ_YET, reason: PART4_CLAIMS }]);
  assert.deepEqual(c.lines, [REENROLMENT_LINE]);
  assert.equal(c.foot, 'Referrals rose 21% on the period before.', '121 on 100');
  assert.equal(weekLabel('2026-10-19'), '19 Oct');
});

test('Joins per week: Learning is "in the programs assigned to you" for an Admin; a failed series is named, not drawn; no foot without the period before', () => {
  const admin = joinsChart(ready(catalogueBody()));
  assert.ok(admin.chart.series.some((s) => s.label === 'Learning enrolments in the programs assigned to you'));
  const labDown = joinsChart(ready(catalogueBody({ labWeekly: unreadable('Lab applications') })));
  assert.ok(!labDown.chart.series.some((s) => s.label === 'Lab applications'));
  assert.equal(labDown.missing.find((m) => m.key === 'lab').word, 'Could not be read');
  assert.equal(labDown.state, 'ready', 'the other series stand');
  const noBefore = joinsChart(ready(catalogueBody({ referralsWeekly: { ...catalogueBody().joins_weekly.referrals, previous_total: 0 } })));
  assert.equal(noBefore.foot, null);
  const refDown = joinsChart(ready(catalogueBody({ referralsWeekly: unreadable('Referrals') })));
  assert.equal(refDown.foot, null, 'no foot when the referrals series failed');
  const allDown = joinsChart(ready(catalogueBody({ labWeekly: unreadable(), referralsWeekly: unreadable(), learningWeekly: unreadable() })));
  assert.equal(allDown.state, 'unreadable');
  // A week the series does not answer is a gap, never 0.
  const gap = { ...catalogueBody().joins_weekly.lab, weeks: catalogueBody().joins_weekly.lab.weeks.slice(1) };
  assert.equal(joinsChart(ready(catalogueBody({ labWeekly: gap }))).chart.series[0].values[0], null);
  const studio = joinsChart(ready(catalogueBody()), { perStudio: true });
  assert.deepEqual(studio.missing.find((m) => m.key === 'lab'), { key: 'lab', label: 'Lab applications', word: NOT_READ_YET, reason: NOT_PER_STUDIO });
});

test('Waiting by program: the five queues as rows with literal doors, in three bands; a pending queue is words; the foot only when nothing is 72 hours old', () => {
  assert.deepEqual(WAITING_ROWS.map((r) => [r.key, r.to]), [
    ['cohort', '/admin/spinout-lab'], ['referrals', '/admin/programs/refer-and-earn/queue'], ['strategic', '/admin/programs/refer-and-earn'],
    ['perks', '/admin/programs/perks/queue'], ['hosts', '/admin/spinout-lab']]);
  assert.deepEqual(WAIT_BANDS.map((b) => b.key), ['under_24', 'from_24_to_72', 'over_72']);
  const c = waitingChart(ready(catalogueBody()));
  assert.equal(c.chart.type, 'stackbars');
  assert.deepEqual(c.chart.rows.map((r) => r.key), ['cohort', 'referrals', 'perks', 'hosts'], 'strategic is not a bar');
  const ref = c.rows.find((r) => r.key === 'referrals');
  assert.equal(ref.sub, 'since submitted · oldest 3 days · 1 waiting on the member');
  assert.deepEqual(ref.parts.map((p) => p.value), [1, 1, 1]);
  assert.equal(c.rows.find((r) => r.key === 'perks').sub, 'since last edit · oldest 5 hours');
  assert.deepEqual([c.rows[2].state, c.rows[2].word, c.rows[2].reason], ['pending', NOT_READ_YET, PART4_STRATEGIC]);
  assert.equal(c.foot, null, 'a referral has waited 72 hours');
  const calm = waitingChart(ready(catalogueBody({ waiting: { referrals: { ...catalogueBody().waiting.referrals, bands: { under_24: 3, from_24_to_72: 0, over_72: 0 } } } })));
  assert.equal(calm.foot, NOTHING_OVER_72);
  const perksDown = waitingChart(ready(catalogueBody({ waiting: { perks: unreadable('Perk listings') } })));
  assert.equal(perksDown.rows.find((r) => r.key === 'perks').word, 'Could not be read');
  assert.ok(!perksDown.chart.rows.some((r) => r.key === 'perks'));
});

test('Credits in and out by month: granted above the axis by source, spent below; Referrals "Not recorded"; an Admin\'s "Not read here yet"', () => {
  const c = creditsChart(ready(catalogueBody({ superAdmin: true })));
  assert.equal(c.chart.type, 'columns');
  assert.equal(c.chart.rows.length, 3);
  assert.deepEqual(c.chart.rows[1].parts.map((p) => [p.key, p.value, p.tone]), [['lab', 550, 'violet'], ['bounty', 300, 'sky'], ['manual', 150, 'emerald'], ['other', 20, 'muted']]);
  assert.equal(c.chart.rows[1].below, 850, 'spent sits below the axis');
  assert.equal(c.chart.rows[0].label, 'Aug (part)');
  assert.deepEqual(c.referral, { word: NOT_RECORDED, reason: 'Referral rewards are not paid in perk credits yet.' });
  assert.ok(!c.legend.some((l) => l.label === 'Referrals'), 'no zero bar for a figure no store holds');
  assert.equal(c.chart.table.rows[0][3], NOT_RECORDED, 'the table says Not recorded in the Referrals column');
  assert.equal(c.foot, CREDIT_FOOT);
  assert.equal(CREDIT_FOOT, '1 credit is worth $1 of perk value.');
  assert.match(c.lines[0], /10 deducted · 20 refunded/, 'deducted and refunded named apart');
  const admin = creditsChart(ready(catalogueBody()));
  assert.deepEqual([admin.state, admin.word, admin.reason], ['pending', NOT_READ_YET, HQ_READS]);
  // Charts.jsx: a column with a spend draws under the zero line, on the grants' scale.
  const svg = renderToStaticMarkup(h(Columns, { rows: c.chart.rows }));
  const zero = Number(/<line[^>]*y1="([\d.]+)"[^>]*class="stroke-axal-muted/.exec(svg)[1]);
  const rects = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" class="([^"]+)"/g)].map((m) => ({ y: Number(m[1]), h: Number(m[2]), cls: m[3] }));
  const below = rects.filter((r) => Math.abs(r.y - zero) < 0.01);
  assert.equal(below.length, 3, 'one spend per month');
  for (const r of below) assert.ok(r.cls === 'fill-axal-muted' && r.h > 0, 'each spend starts at the zero axis and runs down');
  assert.ok(rects.filter((r) => !below.includes(r)).every((r) => r.y + r.h <= zero + 0.01), 'grants stay above it');
  assert.ok(!/<rect[^>]*class="fill-axal-muted/.test(renderToStaticMarkup(h(Columns, { rows: [{ label: 'a', value: 2 }] }))), 'no below, no diverging columns');
});

test('the cards: the registry\'s order, status words and figures; the constant stands while it reads, so the doors are always drawn', () => {
  const { cards } = catalogueCards(ready(catalogueBody()));
  assert.equal(cards.length, 9);
  assert.equal(cards.find((c) => c.key === 'referral-partners').status, 'Partly built');
  assert.equal(cards.find((c) => c.key === 'investor-cohorts').status, 'Not built yet');
  assert.equal(cards.find((c) => c.key === 'ai-native-venture').status, 'Proposed');
  assert.equal(cards.find((c) => c.key === 'referral-partners').grant, 'HQ-held', 'the held-mode badges stay');
  assert.equal(catalogueCards(loading()).cards.length, 9);
  assert.equal(catalogueCards(failed()).cards.length, 9);
});

test('Lab applications: counts.pending, exact; a failed read fails that line only; under a studio, "Not read here yet"', () => {
  assert.deepEqual(labApplications(ready(labAppsBody(4))), { state: 'ready', count: 4, text: '4 Lab applications waiting' });
  assert.equal(labApplications(ready({ applications: [], counts: { accepted: 3 } })).text, '0 Lab applications waiting', 'no pending key is a real none');
  assert.equal(labApplications(failed()).state, 'unreadable');
  assert.equal(labApplications(ready({ applications: [] })).state, 'unreadable', 'no counts is not none');
  assert.deepEqual(labApplications(ready(labAppsBody()), { perStudio: true }), { state: 'placeholder', word: NOT_READ_YET, reason: NOT_PER_STUDIO });
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const down = () => response({ error: 'down' }, 503);
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };
const HQ_ONLY = { scopes: [{ code: 'hq', label: 'HQ-held accounts', kind: 'hq' }] };
const WITH_NORTH = { scopes: [{ code: 'hq', label: 'HQ-held accounts', kind: 'hq' }, { code: 'north', label: 'Studio North', kind: 'branch' }] };

function worker({ catalogue = (q) => response(catalogueBody({ weeks: Number(q.get('weeks')) })), labApps = labAppsBody(), scopes = HQ_ONLY, user = null } = {}) {
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url) => {
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path === '/api/admin/programs') return call(catalogue, q);
    if (path === '/api/admin/spinout-applications') return call(labApps);
    if (path === '/api/admin/insights/scopes') return call(scopes);
    return never();
  };
}

async function mounted(url, handle, { user = null, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  const tree = user ? h(AuthProvider, null, h(ProgramsCatalogue), h(Probe)) : [h(ProgramsCatalogue, { key: 'p' }), h(Probe, { key: 'q' })];
  await act(async () => rootEl.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, at, flush,
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async press(label, scope) {
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const node = walk(byId(scope)).find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { await props(node).onClick(event); });
      await flush();
    },
    async close() {
      await act(async () => rootEl.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

const catalogueCalls = (v) => v.requests.filter((u) => u.startsWith('/api/admin/programs'));

test('the catalogue for an Admin: header, period, four tiles, the three charts, and nine cards with their figures, Needs you and doors', async () => {
  const view = await mounted('/admin/programs', worker());
  try {
    assert.equal(view.textOf('programs-catalogue-line'), LINE_ADMIN);
    assert.equal(view.textOf('programs-scope-chip'), SCOPE_LABEL);
    assert.equal(view.props('programs-scope-chip').title, SCOPE_TITLE);
    assert.match(view.textOf('programs-asof'), /^Updated \d\d:\d\d$/);
    assert.deepEqual(catalogueCalls(view), ['/api/admin/programs?weeks=12'], 'no scope for an Admin');
    assert.equal(view.props('programs-period-12').className.includes('bg-'), true);
    assert.equal(view.textOf('programs-tile-running-value'), '6 of 9');
    assert.match(view.textOf('programs-tile-running'), /2 not offered yet · 1 proposed/);
    assert.equal(view.textOf('programs-tile-people-value'), '312');
    assert.equal(view.textOf('programs-tile-people-delta'), '+8%');
    assert.match(view.textOf('programs-tile-people'), /Spin-Out Lab is left out: /);
    assert.equal(view.textOf('programs-tile-waiting-value'), '7');
    assert.ok(view.has('programs-tile-waiting-overdue'));
    assert.match(view.textOf('programs-tile-waiting'), /Strategic referral access: Not read here yet\./);
    assert.equal(view.textOf('programs-tile-credits'), `Credits paid out${NOT_READ_YET}${HQ_READS}`);
    assert.equal(view.textOf('programs-chart-joins-axis'), 'per week');
    assert.ok(view.has('programs-chart-joins-chart'));
    assert.equal(view.textOf('programs-chart-joins-missing-perks'), `Perk claims: ${NOT_READ_YET}. ${PART4_CLAIMS}`);
    assert.equal(view.textOf('programs-chart-joins-foot'), 'Referrals rose 21% on the period before.');
    assert.match(view.textOf('programs-chart-joins'), /A re-enrolment counts again\./);
    assert.equal(view.textOf('programs-waiting-strategic'), `Strategic referral access${NOT_READ_YET}. ${PART4_STRATEGIC}Open`);
    assert.equal(view.textOf('programs-chart-credits-unread'), `${NOT_READ_YET}${HQ_READS}`);
    assert.equal(view.textOf('programs-catalogue-count'), '9 programs');
    assert.equal(view.textOf('programs-card-spinout-lab-figure'), '2 cohort applications waiting');
    assert.equal(view.textOf('programs-card-spinout-lab-applications'), '4 Lab applications waiting');
    assert.equal(view.textOf('programs-card-spinout-lab-needs'), '!Needs you 3');
    assert.equal(view.textOf('programs-card-mentor-cohorts-figure'), '1 mentor · 2 of 4 cohorts coveredCohorts scheduled or running.', 'deactivated accounts are left out (D960), so no line says otherwise');
    assert.equal(view.textOf('programs-card-mentor-cohorts-needs'), '!Needs you 4');
    assert.equal(view.textOf('programs-card-refer-and-earn-figure'), '3 open referralsincluding those waiting on the member');
    assert.equal(view.textOf('programs-card-refer-and-earn-strategic'), `Strategic referral access: ${NOT_READ_YET}${PART4_STRATEGIC}`);
    assert.equal(view.textOf('programs-card-perks-figure'), '5 live');
    assert.equal(view.textOf('programs-card-perks-claims'), `Claims: ${NOT_READ_YET}${PART4_CLAIMS}`);
    assert.equal(view.textOf('programs-card-learning-figure'), '2 published programs · 7 active enrolments in themassigned to you');
    assert.match(view.textOf('programs-card-investor-cohorts-status'), /Not built yet$/);
    assert.equal(view.textOf('programs-card-product-testing-foot'), PRODUCT_TESTING_FOOT);
    assert.ok(!view.has('programs-card-product-testing-figure'));
    assert.equal(view.textOf('programs-card-referral-partners-grant'), '⌂HQ-held');
    const hrefs = view.hrefs();
    for (const d of ['/admin/programs/spinout-lab', '/admin/programs/mentor-cohorts', '/admin/programs/refer-and-earn', '/admin/programs/perks', '/admin/programs/learning',
      '/admin/programs/refer-and-earn/queue', '/admin/programs/perks/queue', '/admin/spinout-lab', '/admin/profiling-trends']) assert.ok(hrefs.includes(d), `no door onto ${d}`);
    assert.ok(!view.has('programs-studio'), 'no studio filter for an Admin');
    assert.ok(!view.requests.some((u) => u.startsWith('/api/admin/insights')), 'R12 is the Super Admin\'s');
    await view.click('programs-group-Access');
    assert.ok(view.has('programs-card-mentor-cohorts') && !view.has('programs-card-perks'));
  } finally { await view.close(); }
});

test('the period sets weeks= on the read; the tiles and charts follow it while the cards keep their answer', async () => {
  let hold = false;
  const view = await mounted('/admin/programs', worker({
    catalogue: (q) => (hold ? never() : response(catalogueBody({ weeks: Number(q.get('weeks')) }))),
  }));
  try {
    hold = true;
    await view.click('programs-period-4');
    assert.equal(view.at.path, '/admin/programs?weeks=4');
    assert.equal(catalogueCalls(view).at(-1), '/api/admin/programs?weeks=4');
    assert.ok(view.has('programs-chart-joins-loading'), 'the chart reads again');
    assert.match(view.textOf('programs-tile-running'), /Reading…/, 'the tiles read again');
    assert.equal(view.textOf('programs-card-perks-figure'), '5 live', 'the cards do not follow the period');
    hold = false;
    await view.click('programs-period-52');
    assert.equal(catalogueCalls(view).at(-1), '/api/admin/programs?weeks=52');
    assert.equal(view.textOf('programs-tile-running-value'), '6 of 9');
    await view.click('programs-period-12');
    assert.equal(view.at.path, '/admin/programs');
  } finally { await view.close(); }
  const deep = await mounted('/admin/programs?weeks=52', worker());
  try { assert.deepEqual(catalogueCalls(deep), ['/api/admin/programs?weeks=52']); } finally { await deep.close(); }
});

test('loading (PG17) and failed (PG18a): each chart in its own skeleton, then Unreadable with Try again; the cards keep their doors', async () => {
  const pending = await mounted('/admin/programs', worker({ catalogue: never }));
  try {
    for (const k of ['joins', 'waiting', 'credits']) assert.match(pending.textOf(`programs-chart-${k}-loading`), /^Reading…/, k);
    assert.equal(pending.textOf('programs-catalogue-count'), '9 programs');
    assert.ok(pending.hrefs().includes('/admin/programs/perks'));
  } finally { await pending.close(); }
  let fail = true;
  const view = await mounted('/admin/programs', worker({ catalogue: () => (fail ? down() : response(catalogueBody())) }));
  try {
    for (const k of ['joins', 'waiting', 'credits']) assert.match(view.textOf(`programs-chart-${k}-unreadable`), /could not be read\. That is not the same as none\.Try again$/, k);
    assert.match(view.textOf('programs-tile-running'), /Could not be read/);
    assert.ok(!view.has('programs-tile-running-value'), 'never a zero');
    assert.equal(view.textOf('programs-card-spinout-lab-applications'), '4 Lab applications waiting', 'Lab applications are their own read');
    fail = false;
    await view.press('Try again', 'programs-chart-joins');
    assert.ok(view.has('programs-chart-joins-chart'));
  } finally { await view.close(); }
});

test('one failed block fails only itself: the Lab series, a queue, a card figure, and Lab applications', async () => {
  const view = await mounted('/admin/programs', worker({
    catalogue: () => response(catalogueBody({ labWeekly: unreadable('Lab applications'), live: unreadable('Live perks') })),
    labApps: down,
  }));
  try {
    assert.equal(view.textOf('programs-chart-joins-missing-lab'), 'Lab applications: Could not be read. Lab applications could not be read on this database. That is not the same as none.');
    assert.ok(view.has('programs-chart-joins-chart'), 'the other series stand');
    assert.match(view.textOf('programs-card-perks-figure').trim(), /^Live perks could not be read\./);
    assert.match(view.textOf('programs-card-spinout-lab-applications').trim(), /^Lab applications could not be read\./);
    assert.equal(view.textOf('programs-card-spinout-lab-figure'), '2 cohort applications waiting');
    assert.equal(view.textOf('programs-tile-waiting-value'), '7');
  } finally { await view.close(); }
  const queue = await mounted('/admin/programs', worker({ catalogue: () => response(catalogueBody({ waiting: { perks: unreadable('Perk listings') } })) }));
  try {
    assert.match(queue.textOf('programs-tile-waiting'), /Could not be read/);
    assert.ok(!queue.has('programs-tile-waiting-value'));
    assert.match(queue.textOf('programs-waiting-perks'), /Could not be read\. Perk listings could not be read/);
    assert.match(queue.textOf('programs-waiting-referrals'), /3 waiting/);
  } finally { await queue.close(); }
});

test('the catalogue for a Super Admin (PG2): HQ\'s line, the credits tile and chart, no Needs-you pills, Product testing\'s figures', async () => {
  const view = await mounted('/admin/programs', worker({ user: SUPER, catalogue: (q) => response(catalogueBody({ superAdmin: true, weeks: Number(q.get('weeks')) })) }), { user: SUPER });
  try {
    assert.equal(view.textOf('programs-catalogue-line'), LINE_SUPER);
    assert.equal(view.textOf('programs-tile-credits-value'), '3,050 paid out');
    assert.ok(view.has('programs-chart-credits-chart'));
    assert.equal(view.textOf('programs-chart-credits-referral'), 'Referrals: Not recorded. Referral rewards are not paid in perk credits yet.');
    assert.equal(view.textOf('programs-chart-credits-foot'), CREDIT_FOOT);
    for (const k of ['spinout-lab', 'mentor-cohorts', 'refer-and-earn', 'perks']) assert.ok(!view.has(`programs-card-${k}-needs`), `${k} draws a Needs-you pill for HQ`);
    assert.equal(view.textOf('programs-card-product-testing-figure'), '2 open · 9 applied, not withdrawn');
    assert.ok(view.hrefs().includes('/admin?tab=product-testing'));
    assert.match(view.textOf('programs-card-learning-who'), /Join: Open or by invitation$/);
    assert.ok(!/in the programs assigned to you/.test(view.textOf('programs-chart-joins')));
    await view.click('programs-chart-credits-as-table');
    assert.match(view.textOf('programs-chart-credits-table'), /Spent on perk claims/);
  } finally { await view.close(); }
});

test('the studio filter: HQ-held alone shows SCOPE_NOTE; a pick sets ?scope= and reads that studio; the Lab reads "Not read here yet" under it', async () => {
  const alone = await mounted('/admin/programs', worker({ user: SUPER }), { user: SUPER });
  try {
    await alone.click('programs-studio');
    assert.equal(alone.textOf('programs-studio-note'), SCOPE_NOTE);
    assert.ok(alone.has('programs-studio-option-hq'));
  } finally { await alone.close(); }
  const view = await mounted('/admin/programs', worker({ user: SUPER, scopes: WITH_NORTH }), { user: SUPER });
  try {
    await view.click('programs-studio');
    assert.ok(!view.has('programs-studio-note'));
    await view.click('programs-studio-option-north');
    assert.equal(view.at.path, '/admin/programs?scope=north');
    assert.equal(catalogueCalls(view).at(-1), '/api/admin/programs?weeks=12&scope=north');
    assert.equal(view.textOf('programs-scope-chip'), 'Studio North · counts read from its own database');
    assert.equal(view.textOf('programs-card-spinout-lab-applications'), `Lab applications: ${NOT_READ_YET}${NOT_PER_STUDIO}`);
    assert.equal(view.textOf('programs-chart-joins-missing-lab'), `Lab applications: ${NOT_READ_YET}. ${NOT_PER_STUDIO}`);
  } finally { await view.close(); }
});

test('no per-studio read while R12 reads, and an Admin\'s ?scope= is not sent', async () => {
  const held = await mounted('/admin/programs?scope=north', worker({ user: SUPER, scopes: never }), { user: SUPER });
  try {
    assert.deepEqual(catalogueCalls(held), [], 'HQ\'s figures never sit under a studio\'s name');
    assert.ok(!held.requests.some((u) => u.startsWith('/api/admin/spinout-applications')));
    assert.ok(held.has('programs-chart-joins-loading'));
  } finally { await held.close(); }
  const admin = await mounted('/admin/programs?scope=north', worker());
  try { assert.deepEqual(catalogueCalls(admin), ['/api/admin/programs?weeks=12']); } finally { await admin.close(); }
});

test('the phone catalogue (PG20a): no header buttons, so no studio filter; Joins stays; Waiting by program and Credits are not drawn; 44px doors', async () => {
  const view = await mounted('/admin/programs', worker({ user: SUPER, scopes: WITH_NORTH }), { user: SUPER, phone: true });
  try {
    assert.ok(!view.has('programs-studio') && !view.has('programs-refresh') && !view.has('programs-asof'));
    assert.ok(view.has('programs-chart-joins-chart'));
    assert.ok(!view.has('programs-chart-waiting') && !view.has('programs-chart-credits'));
    assert.equal(view.textOf('programs-tile-waiting-value'), '7', 'the tile carries the total');
    assert.match(view.props('programs-tiles').className, /^grid gap-3\.5 sm:grid-cols-2/, 'one column below sm');
  } finally { await view.close(); }
  const src = codeOnly(read('frontend/src/pages/admin/programs/ProgramsCatalogue.jsx'));
  assert.match(src, /const OPEN = 'inline-flex min-h-\[44px\]/);
});

test('dark mode: only violet changes, to #a78bfa', () => {
  const charts = read('frontend/src/ui/Charts.jsx');
  for (const m of charts.matchAll(/^\s*(violet|sky|amber|emerald): '([^']+)',?$/gm)) {
    if (m[1] === 'violet') assert.match(m[2], /dark:(fill|stroke|border|bg)-\[#a78bfa\]/, 'violet turns #a78bfa');
    else assert.doesNotMatch(m[2], /dark:/, `${m[1]} keeps its colour in dark mode`);
  }
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/admin/programs/catalogueModel.js')), /#[0-9a-f]{6}/i, 'the model names tones, never colours');
});

test('docs: D961 is recorded, with the phone decision; the client has its Worker route', () => {
  const d = read('documentation/architecture/decisions/D961.md');
  assert.match(d, /#2794/);
  assert.match(d, /Waiting by program and Credits in and out by month are not drawn on a phone/);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/adminPrograms\.js';/);
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/admin\/programs', adminPrograms\)/);
});
