/**
 * D948 (#2753) — the Lab's Applications tab (SL2), one application (SL3) and
 * SL4's seven dialogs, drawn from D944's reads and D948's one-application read.
 *
 *   - the pure model (`applicationsModel.js`) on rows shaped as the Worker
 *     sends them, worked out by hand;
 *   - the tab mounted on a stubbed `fetch`: the cohort switch, the chips and
 *     their counts, the capacity bar and its callout, the filters and pages as
 *     the query the Worker gets, a failed read, the drawer, and each dialog's
 *     write and refusal;
 *   - the source: no browser pop-up and no "dev backend" line left.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lab_applications_d948.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LabApplications from '../src/pages/admin/lab/LabApplications.jsx';
import { tabOf } from '../src/pages/admin/lab/labModel.js';
import {
  APPLICATIONS_PATH, applicationOf, applicationRow, approveCopy, bulkResult, cannotAct, capacityOf, closedLine, cohortSwitch, countQuery,
  declineCopy, decidedLine, etToUtc, founderSees, historyOf, interviewOf, listQuery, EMPTY_FILTERS, openCohorts, waitlistCopy, waitedText,
} from '../src/pages/admin/lab/applicationsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-11-10T15:00:00Z');

/** Three cohorts as D944's overview sends them: November running, December open, January not open yet. */
const COHORTS = [
  { id: 11, cohort: '2026-11', year: 2026, month: 11, status: 'active', app_status: 'active', start_at: '2026-11-01T04:00:00Z', end_at: '2026-11-29T05:00:00Z', applications_open_at: null, applications_close_at: null, force_proceed: 0, approved: { available: true, value: 9 } },
  { id: 12, cohort: '2026-12', year: 2026, month: 12, status: 'scheduled', app_status: 'open', start_at: '2026-12-01T05:00:00Z', end_at: '2026-12-29T05:00:00Z', applications_open_at: '2026-11-01 04:00:00', applications_close_at: '2026-11-25 05:00:00', force_proceed: 0, approved: { available: true, value: 1 } },
  { id: 13, cohort: '2027-01', year: 2027, month: 1, status: 'scheduled', app_status: 'open', start_at: '2027-01-01T05:00:00Z', end_at: '2027-01-29T05:00:00Z', applications_open_at: '2026-12-01 05:00:00', applications_close_at: '2026-12-25 05:00:00', force_proceed: 0, approved: { available: true, value: 0 } },
];
const OVERVIEW = (o = {}) => ({ blocks: { cohorts: { available: true, items: COHORTS }, settings: { available: true, min: 3, places: 25 }, ...o } });
const ready = (data) => ({ status: 'ready', data, error: null });

/** One row as D944's `GET /applications/list` sends it. */
const ROW = (o = {}) => ({
  id: 21, application_id: 1, user_id: 41, cohort_cycle_id: 12, cohort: '2026-12', status: 'pending', display_status: 'interview_set',
  rolled_from_cycle_id: 11, pool_created_at: '2026-11-01 04:00:00', decided_at: null, decision_reason: null, applied_at: '2026-10-20 12:00:00',
  company_name: 'Northwind Labs', idea: 'Reconciliation models', stage: 'Prototype in progress', incorporated: 'no', jurisdiction: 'de',
  name: 'Ada Founder', email: 'fixture-41@example.test', role: 'founder', origin: 'university', tech_transfer: 'negotiating', institution: 'Fixture University',
  team_size: 3, waiting_since: '2026-11-07 12:00:00', interview_id: 2, interview_status: 'scheduled', interview_at: '2026-11-18 20:00:00',
  interview_duration_min: 30, interview_location: 'Fixture link',
  answers: { origin: 'university', institution: 'Fixture University', tto_status: 'negotiating', team_size: 3, ip: [] }, answers_recorded: true, answers_status: 'ready', ...o,
});
const PAGE = (items, o = {}) => ({ available: true, items, total: items.length, limit: 25, offset: 0, sort: 'waiting_longest', ...o });
const DETAIL = (o = {}) => ({
  available: true, item: ROW(),
  founder: { available: true, withdrawn_at: null, applicant_note: null, applicant_note_at: null, applicant_asks: [] },
  interview: { available: true, latest: { id: 2, scheduled_at: '2026-11-18 20:00:00', duration_min: 30, location: 'Fixture link', note: 'We will walk through the IP.', status: 'scheduled', reschedule_requested_at: '2026-11-09 10:00:00', reschedule_reason: 'I teach on Wednesdays.' } },
  cohort: { available: true, own: { id: 12, cohort: '2026-12', start_at: '2026-12-01T05:00:00Z', app_status: 'open' }, next: { id: 13, cohort: '2027-01' }, carried_from: { id: 11, cohort: '2026-11' } },
  week1_plan: { available: true, plan: { rule: 'negotiating', label: 'Licence under negotiation', steps: ['project_created', 'icp_defined'], computed_by: 'system', updated_at: '2026-11-01 04:00:00' } },
  ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the address and the tab: /applications/:id opens over Applications; ids are digits', () => {
  assert.equal(applicationOf(`${APPLICATIONS_PATH}/21`), '21');
  assert.equal(applicationOf(APPLICATIONS_PATH), null);
  assert.equal(applicationOf(`${APPLICATIONS_PATH}/list`), null);
  assert.equal(tabOf(`${APPLICATIONS_PATH}/21`), 'applications');
  assert.equal(tabOf(APPLICATIONS_PATH), 'applications');
});

test('the query: only what is set, Waiting first, the page as an offset; a chip counts one row', () => {
  assert.deepEqual(listQuery({ ...EMPTY_FILTERS, cohort: '2026-12' }), { limit: 25, offset: 0, sort: 'waiting_longest', cohort: '2026-12', status: 'waiting' });
  const q = listQuery({ ...EMPTY_FILTERS, cohort: '', status: '', origin: 'corporate', interview: 'none', carried: true, q: '  north ', sort: 'company', page: 3 });
  assert.deepEqual(q, { limit: 25, offset: 50, sort: 'company', origin: 'corporate', interview: 'none', carried_forward: 'yes', q: 'north' });
  assert.deepEqual(countQuery('2026-12', 'approved'), { cohort: '2026-12', status: 'approved', limit: 1, offset: 0 });
  assert.deepEqual(countQuery('', 'waiting'), { status: 'waiting', limit: 1, offset: 0 });
});

test('a row: words for status, origin and transfer, the wait from the last change, 72 hours overdue, the interview in ET', () => {
  const r = applicationRow(ROW(), NOW);
  assert.deepEqual([r.status.word, r.origin, r.tto, r.team, r.applied, r.role], ['Interview set', 'University · Fixture University', 'Negotiating', '3', '20 Oct', 'Founder']);
  assert.deepEqual([r.waited, r.overdue], ['3 days', true]);
  assert.equal(r.interview, '18 Nov 15:00 ET', '20:00 UTC on 18 Nov is 15:00 EST');
  assert.deepEqual([r.decidable, r.movable, r.interviewable, r.hasInterview, r.carried], [true, true, true, true, true]);
  const fresh = applicationRow(ROW({ waiting_since: '2026-11-10 10:00:00' }), NOW);
  assert.deepEqual([fresh.waited, fresh.overdue], ['5 hours', false]);
  assert.equal(waitedText('2026-11-10 14:30:00', NOW), 'under an hour');
  // Answers the Worker could not read, or that were never asked, are said; never a zero team.
  const old = applicationRow(ROW({ answers_status: 'not_recorded', origin: null, tech_transfer: null, team_size: null }), NOW);
  assert.deepEqual([old.origin, old.tto, old.team], ['Not recorded', 'Not recorded', '—']);
  assert.equal(applicationRow(ROW({ answers_status: 'unreadable' }), NOW).origin, 'Unreadable');
  const started = applicationRow(ROW({ status: 'activated', display_status: 'started' }), NOW);
  assert.deepEqual([started.status.word, started.decidable, started.movable], ['Started', false, false]);
  assert.match(cannotAct('approve', started), /Decisions are closed for Northwind Labs: it is started/);
  assert.equal(cannotAct('approve', r), null);
  assert.match(cannotAct('move', applicationRow(ROW({ status: 'rejected', display_status: 'declined' }), NOW)), /cannot move/);
});

test('the cohort switch: what is open, reviewing or running, then All; the open cohort is chosen; a failed calendar offers only All', () => {
  const sw = cohortSwitch(ready(OVERVIEW()), NOW);
  assert.deepEqual(sw.options.map((o) => o.label), ['Nov 2026 · Running', 'Dec 2026 · Open · closes in 15 days', 'Jan 2027 · opens 1 Dec', 'All cohorts']);
  assert.equal(sw.fallback, '2026-12', 'January is open in name only: its window has not opened');
  const down = cohortSwitch({ status: 'error', data: null, error: new Error('x') }, NOW);
  assert.deepEqual([down.options, down.fallback, down.unreadable], [[{ value: '', label: 'All cohorts' }], '', true]);
  assert.deepEqual(openCohorts(ready(OVERVIEW()), NOW, '2026-12').map((c) => c.label), ['Jan 2027 · opens 1 Dec · closes 24 Dec 23:59 ET']);
  assert.equal(openCohorts({ status: 'error', data: null }, NOW), null);
});

test('capacity: approved of places, the minimum met or not, the callout and Run it anyway, and Unreadable for an unread minimum', () => {
  const dec = capacityOf(ready(OVERVIEW()), '2026-12', NOW);
  assert.deepEqual([dec.text, dec.minimum.met, dec.canRun], ['1 approved of 25 places', false, true]);
  assert.equal(dec.callout, 'Below the minimum: 1 of 3 approved. Dec 2026 moves to Jan 2027 about 12 hours before it starts, unless you run it anyway.');
  assert.equal(dec.pct, 4);
  const nov = capacityOf(ready(OVERVIEW()), '2026-11', NOW);
  assert.deepEqual([nov.minimum.text, nov.callout, nov.canRun], ['Minimum 3 met', null, false]);
  const forced = capacityOf(ready({ blocks: { ...OVERVIEW().blocks, cohorts: { available: true, items: COHORTS.map((c) => (c.id === 12 ? { ...c, force_proceed: 1 } : c)) } } }), '2026-12', NOW);
  assert.deepEqual([forced.callout, forced.forced, forced.canRun], [null, 'Dec 2026 is set to run below the minimum.', false]);
  const unread = capacityOf(ready(OVERVIEW({ settings: { available: false, reason: 'Minimum and places could not be read, so no cohort is judged against them.' } })), '2026-12', NOW);
  assert.deepEqual([unread.state, unread.minimum, unread.callout], ['unreadable', undefined, undefined]);
  assert.equal(capacityOf(ready(OVERVIEW()), '', NOW), null, 'All cohorts draws no bar');
});

test('the dialogs\' words: approve with the places after it and over them, waitlist and decline name the next cohort', () => {
  const row = applicationRow(ROW(), NOW);
  const cap = capacityOf(ready(OVERVIEW()), '2026-12', NOW);
  const a = approveCopy(row, cap);
  assert.deepEqual([a.title, a.sub, a.after, a.over], ['Approve Northwind Labs for Dec 2026?', 'The founder is told now. Their workspace opens on 1 Dec at 00:00 ET, at Week 1.', '2 of 25 places after this.', false]);
  const full = approveCopy(row, { ...cap, approved: 25 });
  assert.deepEqual([full.after, full.over, full.overLine], ['26 of 25 places after this.', true, 'This is over the 25 places set in Settings.']);
  assert.match(approveCopy(row, { state: 'unreadable' }).unread, /The Worker still checks them/);
  const next = { cohort: '2027-01' };
  assert.equal(waitlistCopy(row, next).sub, 'They stay in the Dec 2026 pool. If still undecided at the start, they move to Jan 2027.');
  assert.equal(declineCopy(row, next).sub, 'They can apply again for Jan 2027.');
  assert.equal(decidedLine('rejected', { emailed: true, applicant_note_saved: false }, row), 'Northwind Labs is declined. The decision was saved, but the note to the founder was not. Open the application and send it again.');
});

test('ET to UTC across both offsets, and the bulk answer line by line', () => {
  assert.equal(etToUtc('2026-11-18', '15:00'), '2026-11-18T20:00:00.000Z', 'EST is UTC−5');
  assert.equal(etToUtc('2026-10-20', '15:00'), '2026-10-20T19:00:00.000Z', 'EDT is UTC−4');
  assert.equal(etToUtc('2026-11-18', ''), null);
  const rows = [applicationRow(ROW(), NOW), applicationRow(ROW({ id: 22, company_name: 'Second Lab' }), NOW)];
  const r = bulkResult({ results: [{ applicant_id: 21, ok: true }, { applicant_id: 22, ok: false, error: 'over_places', message: 'x' }] }, rows);
  assert.equal(r.line, '1 application was saved.');
  assert.deepEqual(r.refused, ['Second Lab: This is over the places set in Settings. Confirm approving past the places to continue.']);
});

test('one application: what the founder sees is their own screen\'s lede; the history holds only dated steps; closed states say why', () => {
  assert.equal(founderSees(DETAIL(), NOW), 'Your application is at the partner interview. We contact every applicant with a decision, including a no. Their interview is on 18 Nov 15:00 ET.');
  const declined = DETAIL({ item: ROW({ status: 'rejected', display_status: 'declined' }), founder: { available: true, applicant_note: 'Thank you for applying.' } });
  assert.equal(founderSees(declined, NOW), 'The team has decided on your application. Your note: ‘Thank you for applying.’');
  assert.deepEqual(historyOf(DETAIL(), NOW).map((x) => [x.text, x.at]), [['Applied for Nov 2026', '20 Oct'], ['Carried forward from Nov 2026', '1 Nov'], ['Interview set by an admin', null]]);
  assert.equal(closedLine(DETAIL(), NOW), null);
  assert.equal(closedLine(DETAIL({ item: ROW({ status: 'activated', cohort: '2026-11' }), cohort: { available: true, own: { start_at: '2026-11-01T04:00:00Z' } } }), NOW), 'Nov 2026 started on 1 Nov. Decisions are closed.');
  assert.equal(closedLine(DETAIL({ item: ROW({ status: 'withdrawn' }), founder: { available: true, withdrawn_at: '2026-11-06 15:00:00' } }), NOW), 'The founder withdrew on 6 Nov.');
  const iv = interviewOf(DETAIL(), NOW, 'Europe/London');
  assert.deepEqual([iv.line, iv.yours, iv.ask], ['18 Nov 15:00 ET · 30 min · Fixture link', 'Your time 20:00', 'The founder asked to move it: ‘I teach on Wednesdays.’']);
  assert.equal(interviewOf(DETAIL(), NOW, 'America/New_York').yours, null, 'on ET there is no second clock');
  assert.equal(interviewOf(DETAIL({ interview: { available: false, reason: 'x' } }), NOW).state, 'unreadable');
});

/* ------------------------------------------------------------------ *
 * Mounted on a stubbed Worker
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function worker({ overview = OVERVIEW(), page = PAGE([ROW(), ROW({ id: 22, company_name: 'Second Lab', interview_status: null, display_status: 'waiting', waiting_since: '2026-11-10 10:00:00', rolled_from_cycle_id: null })]), count = null, detail = DETAIL(), writes = {}, users = null } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = String(init.method || 'GET').toUpperCase();
    seen.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null });
    const p = u.pathname;
    if (p === '/api/admin/cohort/overview') return typeof overview === 'function' ? overview(u) : json(overview);
    if (p === '/api/admin/cohort/applications/list') {
      if (u.searchParams.get('limit') === '1') return count ? count(u) : json({ available: true, items: [], total: { waiting: 7, interview_set: 2, approved: 1, waitlisted: 3, declined: 5, withdrawn: 1, carried_forward: 3 }[u.searchParams.get('status')] ?? 0 });
      return typeof page === 'function' ? page(u) : json(page);
    }
    if (/^\/api\/admin\/cohort\/applications\/\d+$/.test(p) && method === 'GET') return typeof detail === 'function' ? detail(u) : json(detail);
    if (/\/decide$/.test(p)) return writes.decide ? writes.decide(JSON.parse(init.body)) : json({ ok: true, status: 'approved', emailed: true, applicant_note_saved: true });
    if (/\/move$/.test(p)) return writes.move ? writes.move() : json({ ok: true, founder_told: true });
    if (/\/interview$/.test(p)) return json({ ok: true, interview_id: 3 }, 201);
    if (/\/interview\/cancel$/.test(p)) return json({ ok: true });
    if (/\/force-proceed$/.test(p)) return json({ ok: true });
    if (p === '/api/admin/cohort/applications/bulk-decide') return writes.bulk ? writes.bulk() : json({ ok: true, results: [] });
    if (p === '/api/admin/cohort/applications/admit') return json({ ok: true }, 201);
    if (p === '/api/admin/users') return json(users || { results: [{ id: 77, name: 'Cy Founder', email: 'fixture-77@example.test', role: 'founder' }, { id: 1, name: 'An Admin', email: 'fixture-admin@example.test', role: 'admin' }], total: 2 });
    return json({});
  };
  return seen;
}

async function mount(url, w) {
  const restore = installDocument();
  const seen = worker(w);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname + l.search; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(LabApplications, { now: NOW }), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, at, flush,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)) || {},
    async click(id) { const p = props(byId(id)); assert.ok(p?.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p?.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value, checked: value } }); }); await flush(); },
    async submit(id) { const n = byId(id); const form = (function up(x) { return !x ? null : x.tagName === 'FORM' ? x : up(x.parentNode); })(n); await act(async () => { props(form).onSubmit({ preventDefault() {} }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const lists = (seen) => seen.filter((s) => s.path === '/api/admin/cohort/applications/list' && s.query.limit !== '1');
const writesTo = (seen, re) => seen.filter((s) => s.method === 'POST' && re.test(s.path));

test('mounted SL2: December is chosen, Waiting first; the chips carry the Worker\'s totals; the bar and its callout; the rows', async () => {
  const m = await mount(APPLICATIONS_PATH);
  try {
    assert.equal(m.props('lab-app-cohort-2026-12')['aria-pressed'], true);
    const q = lists(m.seen).at(-1).query;
    assert.deepEqual([q.cohort, q.status, q.sort, q.limit, q.offset], ['2026-12', 'waiting', 'waiting_longest', '25', '0']);
    const counts = m.seen.filter((s) => s.query.limit === '1' && s.query.cohort === '2026-12');
    assert.equal(counts.length, 7, 'one count read per chip');
    assert.equal(m.of('lab-app-chip-waiting-n'), '7');
    assert.equal(m.of('lab-app-chip-carried_forward-n'), '3');
    assert.equal(m.of('lab-app-capacity-text'), '1 approved of 25 places');
    assert.match(m.of('lab-app-below'), /Below the minimum: 1 of 3 approved/);
    assert.match(m.of('lab-app-row-21'), /Northwind Labs.*Reconciliation models.*Carried forward.*Ada Founder.*Founder.*University · Fixture University.*Negotiating.*3.*20 Oct.*● 3 days.*18 Nov 15:00 ET.*Interview set/s);
    assert.equal(m.props('lab-app-open-21').href, `${APPLICATIONS_PATH}/21`);
    assert.equal(m.of('lab-app-range'), '1–2 of 2');
    await m.click('lab-app-cohort-all');
    assert.equal(lists(m.seen).at(-1).query.cohort, undefined, 'All cohorts sends no cohort');
    assert.ok(!m.has('lab-app-capacity'), 'All cohorts draws no capacity bar');
    await m.click('lab-app-chip-waiting');
    assert.equal(lists(m.seen).at(-1).query.status, undefined, 'clicking the chosen chip again shows every status');
  } finally { await m.unmount(); }
});

test('mounted SL2: filters, search on submit, sort and pages are the Worker\'s; a failed read draws no table and no zero', async () => {
  const many = PAGE(Array.from({ length: 25 }, (_, i) => ROW({ id: 100 + i })), { total: 30 });
  const m = await mount(APPLICATIONS_PATH, { page: many });
  try {
    await m.type('lab-app-origin', 'corporate');
    await m.type('lab-app-interview', 'none');
    await m.click('lab-app-carried');
    await m.type('lab-app-sort', 'team_size');
    let q = lists(m.seen).at(-1).query;
    assert.deepEqual([q.origin, q.interview, q.carried_forward, q.sort], ['corporate', 'none', 'yes', 'team_size']);
    await m.type('lab-app-search', 'north');
    assert.notEqual(lists(m.seen).at(-1).query.q, 'north', 'typing alone does not read');
    await m.submit('lab-app-search');
    assert.equal(lists(m.seen).at(-1).query.q, 'north');
    assert.equal(m.of('lab-app-range'), '1–25 of 30');
    await m.click('lab-app-next');
    q = lists(m.seen).at(-1).query;
    assert.deepEqual([q.offset, q.q, q.origin], ['25', 'north', 'corporate'], 'the next page keeps every filter');
  } finally { await m.unmount(); }
  const down = await mount(APPLICATIONS_PATH, { page: () => json({ available: false, reason: 'Applications could not be read. The total and filtered page are unknown.', items: null, total: null }) });
  try {
    assert.ok(down.has('lab-app-read-unreadable'));
    assert.ok(!down.has('lab-app-table') && !down.has('lab-app-range'), 'no table and no "of 0" for a failed read');
  } finally { await down.unmount(); }
  const counts = await mount(APPLICATIONS_PATH, { count: (u) => (u.searchParams.get('status') === 'approved' ? json({ error: 'boom' }, 500) : json({ available: true, items: [], total: 4 })) });
  try {
    assert.equal(counts.of('lab-app-chip-approved-n'), '–', 'a count that failed is a dash');
    assert.equal(counts.of('lab-app-chip-waiting-n'), '4');
    assert.match(counts.of('lab-app-chips-unread'), /not a zero/);
  } finally { await counts.unmount(); }
  const cal = await mount(APPLICATIONS_PATH, { overview: () => json({ error: 'boom' }, 500) });
  try {
    assert.ok(cal.has('lab-app-cohorts-unread'));
    assert.equal(lists(cal.seen).at(-1).query.cohort, undefined, 'with no calendar the queue reads every cohort');
    assert.ok(cal.has('lab-app-table'), 'the queue still answers');
  } finally { await cal.unmount(); }
});

test('mounted SL3: /applications/:id opens the drawer — the idea, facts, plan, interview with the founder\'s ask, what they see, history', async () => {
  const m = await mount(`${APPLICATIONS_PATH}/21`);
  try {
    assert.ok(m.seen.some((s) => s.path === '/api/admin/cohort/applications/21'));
    assert.match(m.of('lab-app-drawer-pills'), /Interview set.*Dec 2026.*Carried from Nov 2026/s);
    assert.match(m.of('lab-app-facts'), /Incorporated.*Not yet.*Stage.*Prototype in progress.*Origin.*University spin-out/s);
    assert.match(m.of('lab-app-plan'), /Licence under negotiation/);
    assert.match(m.of('lab-app-interview-block'), /18 Nov 15:00 ET · 30 min · Fixture link.*We will walk through the IP/s);
    assert.match(m.of('lab-app-interview-ask'), /I teach on Wednesdays/);
    assert.match(m.of('lab-app-sees'), /Your application is at the partner interview/);
    assert.match(m.of('lab-app-history'), /Applied for Nov 2026.*Carried forward from Nov 2026/s);
    await m.click('lab-app-drawer-cancel');
    await m.click('lab-app-cancel-go');
    assert.equal(writesTo(m.seen, /\/applications\/21\/interview\/cancel$/).length, 1);
  } finally { await m.unmount(); }
  const gone = await mount(`${APPLICATIONS_PATH}/999`, { detail: () => json({ error: 'applicant_not_found' }, 404) });
  try { assert.ok(gone.has('lab-app-drawer-missing')); } finally { await gone.unmount(); }
  const down = await mount(`${APPLICATIONS_PATH}/21`, { detail: () => json({ available: false, reason: 'This application could not be read.' }) });
  try { assert.ok(down.has('lab-app-drawer-read-unreadable') && !down.has('lab-app-facts')); } finally { await down.unmount(); }
  const plan = await mount(`${APPLICATIONS_PATH}/21`, { detail: DETAIL({ week1_plan: { available: false, reason: 'x' } }) });
  try { assert.match(plan.of('lab-app-plan-unread'), /That is not the same as none.*Try again/s); } finally { await plan.unmount(); }
  const closed = await mount(`${APPLICATIONS_PATH}/21`, { detail: DETAIL({ item: ROW({ status: 'activated', display_status: 'started', cohort: '2026-11' }) }) });
  try {
    assert.match(closed.of('lab-app-drawer-closed'), /Decisions are closed/);
    assert.ok(!closed.has('lab-app-drawer-approve'), 'a closed application has no decision buttons');
  } finally { await closed.unmount(); }
});

test('dialog A, Approve: a reason is required; the places line; over the places the Worker refuses until the admin confirms', async () => {
  let refused = false;
  const m = await mount(APPLICATIONS_PATH, { writes: { decide: (b) => (b.confirm_over_places === true || refused ? json({ ok: true, emailed: true }) : (refused = true, json({ error: 'over_places', message: 'This approval would exceed the 25 cohort places.' }, 409))) } });
  try {
    await m.click('lab-app-menu-21');
    await m.click('lab-app-approve-21');
    assert.match(m.of('lab-app-approve'), /Approve Northwind Labs for Dec 2026\?.*The founder is told now\. Their workspace opens on 1 Dec at 00:00 ET/s);
    assert.equal(m.of('lab-app-approve-after'), '2 of 25 places after this.');
    assert.equal(m.props('lab-app-approve-go').disabled, true, 'no reason, no approval');
    await m.type('lab-app-approve-reason', 'Clear IP route');
    await m.click('lab-app-approve-go');
    const first = writesTo(m.seen, /\/applications\/21\/decide$/)[0].body;
    assert.deepEqual(first, { status: 'approved', reason: 'Clear IP route', confirm_over_places: false });
    assert.match(m.of('lab-app-approve-refusal'), /over the places/);
    assert.ok(m.has('lab-app-approve-over'), 'the refusal brings the confirmation');
    assert.equal(m.props('lab-app-approve-go').disabled, true, 'not until it is ticked');
    await m.type('lab-app-approve-over-check', true);
    await m.click('lab-app-approve-go');
    assert.equal(writesTo(m.seen, /\/decide$/).at(-1).body.confirm_over_places, true);
    assert.match(m.of('lab-app-approve-result'), /Northwind Labs is approved/);
  } finally { await m.unmount(); }
});

test('dialogs B and C: waitlist with a reason; decline keeps the internal reason, the founder\'s note and the asks apart', async () => {
  const m = await mount(APPLICATIONS_PATH, { writes: { decide: () => json({ ok: true, emailed: true, applicant_note_saved: false }) } });
  try {
    await m.click('lab-app-menu-21');
    await m.click('lab-app-waitlist-21');
    assert.match(m.of('lab-app-waitlist'), /If still undecided at the start, they move to Jan 2027/);
    await m.type('lab-app-waitlist-reason', 'Strong, needs a lead');
    await m.click('lab-app-waitlist-go');
    assert.deepEqual(writesTo(m.seen, /\/decide$/).at(-1).body, { status: 'waitlisted', reason: 'Strong, needs a lead' });
    await m.click('lab-app-waitlist-done');
    await m.click('lab-app-menu-21');
    await m.click('lab-app-decline-21');
    assert.match(m.of('lab-app-decline'), /They can apply again for Jan 2027/);
    await m.type('lab-app-decline-reason', 'No commercial lead');
    await m.type('lab-app-decline-note', 'Thank you for applying.');
    await m.type('lab-app-decline-ask-0', 'Find a commercial co-founder.');
    await m.click('lab-app-decline-add');
    await m.type('lab-app-decline-ask-1', '  ');
    await m.click('lab-app-decline-go');
    assert.deepEqual(writesTo(m.seen, /\/decide$/).at(-1).body, { status: 'rejected', reason: 'No commercial lead', applicant_note: 'Thank you for applying.', applicant_asks: ['Find a commercial co-founder.'] });
    assert.match(m.of('lab-app-decline-result'), /the note to the founder was not/);
  } finally { await m.unmount(); }
});

test('dialogs D, E, F: move to an open cohort, schedule in ET, run below the minimum', async () => {
  const m = await mount(APPLICATIONS_PATH);
  try {
    await m.click('lab-app-menu-21');
    await m.click('lab-app-move-21');
    assert.match(m.of('lab-app-move-to'), /Jan 2027 · opens 1 Dec · closes 24 Dec 23:59 ET/);
    assert.ok(!m.of('lab-app-move-to').includes('Dec 2026'), 'not its own cohort');
    await m.type('lab-app-move-to-13', true);
    assert.equal(m.props('lab-app-move-go').disabled, true, 'a reason is required');
    await m.type('lab-app-move-reason', 'Better fit in January');
    await m.click('lab-app-move-go');
    assert.deepEqual(writesTo(m.seen, /\/applications\/21\/move$/)[0].body, { cycle_id: 13, reason: 'Better fit in January', confirm_over_places: false });
    assert.match(m.of('lab-app-move-result'), /moved to Jan 2027\. The founder is told/);
    await m.click('lab-app-move-done');
    await m.click('lab-app-menu-22');
    await m.click('lab-app-interview-22');
    await m.type('lab-app-interview-date', '2026-11-19');
    await m.type('lab-app-interview-time', '10:00');
    await m.click('lab-app-interview-45');
    await m.type('lab-app-interview-place', 'Fixture link');
    await m.click('lab-app-interview-go');
    assert.deepEqual(writesTo(m.seen, /\/applications\/22\/interview$/)[0].body, { scheduled_at: '2026-11-19T15:00:00.000Z', duration_min: 45, location: 'Fixture link' });
    await m.click('lab-app-interview-done');
    await m.click('lab-app-run-open');
    assert.match(m.of('lab-app-run'), /Run Dec 2026 below the minimum\?.*1 approved, minimum 3\. Without this, the cohort moves to Jan 2027/s);
    await m.type('lab-app-run-reason', 'Two more are in interview');
    await m.click('lab-app-run-go');
    assert.deepEqual(writesTo(m.seen, /\/cycles\/12\/force-proceed$/)[0].body, { reason: 'Two more are in interview' });
  } finally { await m.unmount(); }
});

test('dialog G and the bulk bar: admit a founder found by name into an open cohort; one reason for every selected application', async () => {
  const m = await mount(APPLICATIONS_PATH, { writes: { bulk: () => json({ ok: true, results: [{ applicant_id: 21, ok: true }, { applicant_id: 22, ok: false, error: 'decision_conflict', message: 'x' }] }) } });
  try {
    await m.click('lab-app-admit-open');
    await m.type('lab-app-admit-q', 'Cy');
    await m.submit('lab-app-admit-q');
    assert.equal(m.seen.find((s) => s.path === '/api/admin/users').query.q, 'Cy');
    assert.ok(!m.of('lab-app-admit-who').includes('An Admin'), 'an admin is never offered');
    await m.type('lab-app-admit-who-77', true);
    await m.type('lab-app-admit-cohort', '12');
    await m.type('lab-app-admit-reason', 'Referred by the TTO');
    await m.click('lab-app-admit-go');
    assert.deepEqual(writesTo(m.seen, /\/applications\/admit$/)[0].body, { user_id: 77, cycle_id: 12, reason: 'Referred by the TTO', confirm_over_places: false });
    await m.click('lab-app-admit-done');
    await m.type('lab-app-pick-21', true);
    await m.type('lab-app-pick-22', true);
    assert.equal(m.of('lab-app-bulk-n'), '2 selected');
    await m.click('lab-app-bulk-approve');
    await m.type('lab-app-bulk-reason', 'Strong pair');
    await m.click('lab-app-bulk-go');
    assert.deepEqual(writesTo(m.seen, /bulk-decide$/)[0].body, { applicant_ids: [21, 22], status: 'approved', reason: 'Strong pair', confirm_over_places: false });
    assert.match(m.of('lab-app-bulk-result'), /1 application was saved/);
    assert.match(m.of('lab-app-bulk-refused'), /Second Lab: This application changed while you were deciding it/);
  } finally { await m.unmount(); }
});

test('the source: no browser pop-up and no "dev backend" in Applications, its model or the console it shrank', () => {
  for (const f of ['frontend/src/pages/admin/lab/LabApplications.jsx', 'frontend/src/pages/admin/lab/applicationsModel.js', 'frontend/src/pages/admin/AdminCohortApplications.jsx']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /window\.(prompt|alert|confirm)\s*\(/, f);
    assert.doesNotMatch(src, /dev backend/, f);
  }
  assert.match(read('frontend/src/App.jsx'), /path="\/admin\/programs\/spinout-lab\/applications\/:id"/);
});
