/**
 * D947 (#2752) — the Spin-Out Lab's Overview (SL1) and Cohorts (SL5, SL6),
 * drawn from D944's overview read.
 *
 * Two layers:
 *   - the pure model (`labOverviewModel.js`) on the shared synthetic read
 *     (`_lab_overview_fixture.mjs`), each block in its four states;
 *   - the page mounted on a stubbed `fetch`: every read goes through the real
 *     client to a URL, each one can fail alone, and controls are driven
 *     through their React props.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_lab_overview_d947.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { overviewFixture, NOT_INTERVIEWED } from './_lab_overview_fixture.mjs';
import {
  NOT_RECORDED, UNREADABLE, blockOf, buildApplicants, buildByCohort, buildCohortList, buildCohortPage,
  buildFunnel, buildHeat, buildPerWeek, buildTimeline, cohortOf, cohortPath, metricOf, settingsOf,
} from '../src/pages/admin/lab/labOverviewModel.js';
import { LAB_PATH, tabOf } from '../src/pages/admin/lab/labModel.js';
import AdminLab from '../src/pages/admin/lab/AdminLab.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const ok = (data) => ({ status: 'ready', data });
const bad = { status: 'error', data: null };
const READ = ok(overviewFixture());
const APPS = ok({ settings: { min: 1, max: 25 }, settings_unreadable: false, cycles: [] });
const POOLS_DOWN = { available: false, reason: 'Cohort pool counts could not be read.' };

/** The fixture with one cohort's metrics replaced. */
function withCohort(key, patch) {
  const d = overviewFixture();
  d.blocks.cohorts.items = d.blocks.cohorts.items.map((c) => (c.cohort === key ? { ...c, ...patch } : c));
  return ok(d);
}
/** The fixture with one block replaced. */
function withBlock(name, b) {
  const d = overviewFixture();
  d.blocks[name] = b;
  return ok(d);
}

// ---------------------------------------------------------------- the model

test('addresses: each cohort has its own, and only a real month opens one', () => {
  assert.equal(cohortPath('2026-11'), '/admin/programs/spinout-lab/cohorts/2026-11');
  assert.equal(cohortOf(`${LAB_PATH}/cohorts/2026-11`), '2026-11');
  assert.equal(cohortOf(`${LAB_PATH}/cohorts/2026-11/`), '2026-11');
  assert.equal(cohortOf(`${LAB_PATH}/cohorts/2026-13`), null);
  assert.equal(cohortOf(`${LAB_PATH}/cohorts`), null);
  assert.equal(cohortOf('/admin/other/cohorts/2026-11'), null, 'another page’s address is not a cohort');
  assert.equal(tabOf(`${LAB_PATH}/cohorts/2026-11`), 'cohorts');
  assert.equal(tabOf(`${LAB_PATH}/cohorts/nope`), null);
});

test('a block is loading, unreadable with its reason, or ready; a metric is its number, Not recorded or Unreadable', () => {
  assert.deepEqual(blockOf({ status: 'loading' }, 'cohorts'), { state: 'loading' });
  assert.equal(blockOf(bad, 'cohorts').state, 'unreadable');
  assert.deepEqual(blockOf(withBlock('cohorts', { available: false, reason: 'Cycles down.' }), 'cohorts'), { state: 'unreadable', reason: 'Cycles down.' });
  assert.equal(blockOf(READ, 'cohorts').state, 'ready');
  assert.deepEqual(metricOf({ available: true, value: 0 }), { kind: 'value', value: 0, text: '0' }, 'a read zero is a zero');
  assert.deepEqual(metricOf({ recorded: false, reason: 'r' }), { kind: 'not_recorded', text: NOT_RECORDED, reason: 'r' });
  assert.deepEqual(metricOf(POOLS_DOWN), { kind: 'unreadable', text: UNREADABLE, reason: POOLS_DOWN.reason });
  assert.equal(metricOf(undefined).kind, 'unreadable');
  assert.equal(metricOf({ decided: false }).text, 'Not decided yet');
  assert.deepEqual(settingsOf(APPS), { min: 1, places: 25 });
  assert.equal(settingsOf(bad), null);
  assert.equal(settingsOf(ok({ settings: null })), null);
});

test('the calendar: the cohorts around today, each lane its windows, weeks, Week 4 flag and tooltips, in ET', () => {
  const tl = buildTimeline(READ, NOW);
  assert.deepEqual(tl.lanes.map((l) => l.key), ['2026-09', '2026-10', '2026-11', '2026-12'], 'from the one before the cohort running');
  assert.deepEqual(tl.months.map((m) => m.label), ['Aug 2026', 'Sep', 'Oct', 'Nov', 'Dec']);
  const oct = tl.lanes[1];
  assert.equal(oct.now, true);
  assert.equal(tl.lanes.filter((l) => l.now).length, 1);
  assert.equal(oct.href, `${LAB_PATH}/cohorts/2026-10`);
  assert.deepEqual(oct.weeks.map((w) => w.n), [1, 2, 3, 4]);
  assert.equal(oct.week4, Date.parse('2026-10-29T04:00:00Z'));
  assert.deepEqual(oct.tips.map((t) => t.part), ['open', 'review', 'w1', 'w2', 'w3', 'w4', 'deadline']);
  assert.equal(oct.tips[0].text, 'Oct 2026 · Applications open 1 Sep 00:00 ET, close 24 Sep 23:59 ET');
  assert.equal(oct.tips[1].text, 'Oct 2026 · In review · pool frozen until 1 Oct 00:00 ET');
  assert.equal(oct.tips[5].text, 'Oct 2026 · Week 4 · opens 22 Oct 00:00 ET · deadline 29 Oct 00:00 ET');
  assert.equal(tl.lanes[3].tips[1].text, 'Dec 2026 · In review · pool frozen until 1 Dec 00:00 ET', 'December is EST');
  assert.equal(tl.lanes[2].weeksMissing, true);
  assert.match(tl.alt, /Sep 2026 to Dec 2026: Sep 2026 finished; Oct 2026 running/);
  assert.deepEqual(buildTimeline(READ, NOW, 'twelve').lanes.map((l) => l.key), ['2026-10', '2026-11', '2026-12'], 'SL5 starts at the running cohort');
  const unread = buildTimeline(withCohort('2026-10', { weeks: POOLS_DOWN }), NOW).lanes[1];
  assert.equal(unread.weeksUnreadable, true);
  assert.deepEqual(unread.weeks, []);
  assert.equal(buildTimeline(withBlock('cohorts', { available: true, items: [] }), NOW).state, 'empty');
  assert.equal(buildTimeline(bad, NOW).state, 'unreadable');
  assert.equal(buildTimeline({ status: 'loading' }, NOW).state, 'loading');
});

test('Applications by cohort: a stacked column per opened cohort, the current one so far, Places and the minimum as lines', () => {
  const b = buildByCohort(READ, APPS, NOW);
  assert.deepEqual(b.chart.rows.map((r) => [r.key, r.value, r.text]),
    [['2026-08', 20, '20'], ['2026-09', 24, '24'], ['2026-10', 30, '30'], ['2026-11', 24, '24 so far']], 'December has not opened');
  assert.deepEqual(b.chart.rows[3].parts.map((p) => [p.key, p.value]),
    [['approved', 9], ['waitlisted', 3], ['undecided', 7], ['declined_withdrawn', 5], ['carried_forward', 0]]);
  assert.deepEqual(b.chart.references, [{ value: 25, label: 'Places 25' }, { value: 1, label: 'Minimum 1', dashed: true }]);
  assert.deepEqual(b.table.rows[1], ['Sep 2026', '18', '2', '0', '4', '0', '24']);
  assert.equal(b.foot, '2 of Sep 2026’s were carried from the cohort before.');
  assert.equal(b.settingsUnreadable, false);
  const noSettings = buildByCohort(READ, bad, NOW);
  assert.deepEqual([noSettings.chart.references, noSettings.settingsUnreadable], [[], true], 'no line is drawn from an unread setting');
  const one = buildByCohort(withCohort('2026-09', { declined: POOLS_DOWN }), APPS, NOW);
  assert.deepEqual(one.chart.rows[1], { key: '2026-09', label: 'Sep', cohort: 'Sep 2026', value: 0, open: true, text: UNREADABLE, unreadable: true });
  assert.equal(one.unreadCohorts, 1);
  assert.equal(one.table.rows[1][1], UNREADABLE, 'an unreadable column is never a zero in the table');
  assert.doesNotMatch(one.alt, /Sep 2026 \d/, 'the alt text gives no number for it');
  assert.equal(buildByCohort(READ, APPS, Date.parse('2026-01-01T00:00:00Z')).state, 'empty');
  assert.equal(buildByCohort(bad, APPS, NOW).state, 'unreadable');
});

test('Weeks passed: four started cohorts and the next, each cell passed, now with its deadline, not started, or Not recorded; never a share', () => {
  const b = buildHeat(READ, NOW);
  assert.deepEqual(b.rows.map((r) => r.key), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(b.rows[2].cells.map((c) => c.text), ['20 passed', '18 passed', '17 passed', 'Now · 29 Oct']);
  assert.deepEqual(b.rows[2].cells[1], { n: 2, kind: 'counts', passed: 18, failed: 1, grace: 1, pending: 0, text: '18 passed' });
  assert.equal(b.rows[2].cells[3].deadline, '29 Oct 00:00 ET');
  assert.deepEqual(b.rows[3].cells.map((c) => c.kind), ['not_recorded', 'not_recorded', 'not_recorded', 'not_recorded'], 'November has no windows yet');
  assert.match(b.note, /no cell is a share/);
  for (const r of b.rows) for (const c of r.cells) assert.doesNotMatch(c.text, /%/);
  const early = buildHeat(READ, Date.parse('2026-10-10T12:00:00Z'));
  assert.deepEqual(early.rows.find((r) => r.key === '2026-10').cells.map((c) => c.kind), ['counts', 'now', 'not_started', 'not_started']);
  const unread = buildHeat(withCohort('2026-09', { weeks: POOLS_DOWN }), NOW);
  assert.deepEqual(unread.rows[1].cells.map((c) => c.text), [UNREADABLE, UNREADABLE, UNREADABLE, UNREADABLE]);
  const july = overviewFixture();
  for (const month of [7, 6]) july.blocks.cohorts.items.unshift({ ...july.blocks.cohorts.items[0], id: month, month, cohort: `2026-0${month}`, start_at: `2026-0${month}-01 04:00:00` });
  assert.deepEqual(buildHeat(ok(july), NOW).rows.map((r) => r.key), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], 'the last four that started, so June drops off');
  assert.equal(buildHeat(READ, Date.parse('2026-07-01T00:00:00Z')).state, 'empty');
  assert.equal(buildHeat(bad, NOW).state, 'unreadable');
});

test('the funnel: the Worker’s cohort by default, any opened cohort on choice, interviews beside the steps', () => {
  const f = buildFunnel(READ);
  assert.equal(f.cohort, '2026-10');
  assert.deepEqual(f.rows.map((r) => [r.key, r.text, r.pct]), [
    ['applied', '30', 100], ['approved', '22', 73], ['started_week_1', '22', 73],
    ['passed_week_4', 'Not decided yet', null], ['incorporated', '0', 0], ['certificate_issued', '0', 0],
  ], 'Week 4 running is not decided, not a zero');
  assert.deepEqual(f.options.map((o) => o.key), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(f.interviewed.kind, 'not_recorded');
  assert.equal(f.foot, `Interviewed: Not recorded (${NOT_INTERVIEWED}). Interviews are optional, so they sit beside the steps, not in them.`);
  const aug = buildFunnel(READ, '2026-08');
  assert.deepEqual(aug.rows.map((r) => r.text), ['20', '15', '15', '11', '9', '8']);
  assert.deepEqual(aug.rows.map((r) => r.pct), [100, 75, 75, 55, 45, 40]);
  assert.equal(buildFunnel(READ, '2026-09').rows[4].pct, 21, '5 of 24 rounds to 21%');
  const down = buildFunnel(withCohort('2026-10', { incorporated: { recorded: false, reason: 'Ambiguous.' }, certificates_issued: POOLS_DOWN }));
  assert.deepEqual(down.rows.slice(4).map((r) => [r.kind, r.pct]), [['not_recorded', null], ['unreadable', null]]);
  assert.equal(buildFunnel(READ, '2030-01').state, 'unreadable');
  assert.equal(buildFunnel(bad).state, 'unreadable');
  assert.equal(buildFunnel(withBlock('cohorts', { available: true, items: [] })).state, 'empty');
});

test('Applications per week: each Monday week in ET, a read zero is a zero, the current week so far', () => {
  const b = buildPerWeek(READ);
  assert.deepEqual(b.chart.values, [4, 0, 6]);
  assert.deepEqual(b.table.rows, [['5 Oct', '4'], ['12 Oct', '0'], ['19 Oct (so far)', '6']]);
  assert.match(b.alt, /3 weeks: between 0 and 6/);
  assert.deepEqual(buildPerWeek(withBlock('applications_per_week', { available: false, reason: 'Weekly down.' })), { state: 'unreadable', reason: 'Weekly down.' });
  assert.equal(buildPerWeek(withBlock('applications_per_week', { available: true, items: [] })).state, 'empty');
});

test('SL5 list: every cohort, searched, filtered by status and sorted by start; a cohort not open yet says so', () => {
  const l = buildCohortList(READ, {}, NOW);
  assert.deepEqual(l.rows.map((r) => r.key), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  const oct = l.rows[2];
  assert.deepEqual([oct.word, oct.pool, oct.started, oct.graduated, oct.week4, oct.starts], ['Running', '30 · 22 · 3 · 0', '22', '0', '29 Oct 00:00 ET', '1 Oct 00:00 ET']);
  assert.deepEqual([l.rows[3].pool, l.rows[3].started, l.rows[3].week4], ['24 · 9 · 3 · 5', '—', NOT_RECORDED]);
  assert.equal(l.rows[4].pool, 'Not open yet');
  assert.deepEqual(buildCohortList(READ, { q: 'sep' }, NOW).rows.map((r) => r.key), ['2026-09']);
  assert.deepEqual(buildCohortList(READ, { status: 'Finished' }, NOW).rows.map((r) => r.key), ['2026-08', '2026-09']);
  assert.deepEqual(buildCohortList(READ, { sort: 'starts_desc' }, NOW).rows[0].key, '2026-12');
  assert.equal(buildCohortList(withCohort('2026-10', { weeks: POOLS_DOWN }), {}, NOW).rows[2].week4, UNREADABLE);
  assert.equal(buildCohortList(bad, {}, NOW).state, 'unreadable');
});

test('SL6: one cohort’s line, tiles, pool, capacity and weeks; messages and history are not read here', () => {
  const p = buildCohortPage(READ, APPS, '2026-10', NOW);
  assert.equal(p.title, 'Oct 2026 cohort');
  assert.equal(p.line, 'Applications 1 Sep 00:00 ET → 24 Sep 23:59 ET · started 1 Oct 00:00 ET · Week 4 deadline 29 Oct 00:00 ET');
  assert.deepEqual(p.tiles.map((t) => t.text), ['30', '22', '22', '20']);
  assert.equal(p.tiles[3].sub, 'of 22 started');
  assert.equal(p.pool.alt, 'Pool of 30: 22 started, 3 waitlisted, 0 waiting, 4 declined, 1 withdrawn, 0 carried forward.');
  assert.deepEqual([p.capacity.text, p.capacity.approved, p.capacity.met], ['Minimum 1 · Places 25', '22 approved of 25 places', true]);
  assert.deepEqual(p.weeks.rows.map((w) => [w.label, w.passed, w.failed, w.grace, w.waiting]), [
    ['Week 1', '20', '2', '0', '0'], ['Week 2', '18', '1', '1', '0'], ['Week 3', '17', '0', '1', '0'], ['Week 4 · now', '—', '—', '0', '17'],
  ]);
  assert.deepEqual([p.messages.state, p.history.state], ['not_read', 'not_read']);
  const nov = buildCohortPage(READ, APPS, '2026-11', NOW);
  assert.deepEqual(nov.tiles.map((t) => t.text), ['24', '9', 'Not started', 'Not decided yet']);
  assert.equal(nov.pool.alt, 'Pool of 24: 9 approved, 3 waitlisted, 7 waiting, 5 declined, 0 withdrawn, 0 carried forward.');
  assert.equal(nov.weeks.state, 'empty');
  assert.equal(buildCohortPage(READ, APPS, '2031-01', NOW).state, 'missing');
  assert.equal(buildCohortPage(READ, bad, '2026-10', NOW).capacity.state, 'unreadable', 'no cohort is judged against an unread setting');
  const short = buildCohortPage(READ, ok({ settings: { min: 30, max: 40 } }), '2026-10', NOW);
  assert.equal(short.capacity.met, false);
  const poolDown = buildCohortPage(withCohort('2026-10', { waitlisted: POOLS_DOWN }), APPS, '2026-10', NOW);
  assert.deepEqual(poolDown.pool, { state: 'unreadable', reason: POOLS_DOWN.reason });
  const weeksDown = buildCohortPage(withCohort('2026-10', { weeks: POOLS_DOWN }), APPS, '2026-10', NOW);
  assert.deepEqual([weeksDown.weeks.state, weeksDown.tiles[3].text], ['unreadable', UNREADABLE]);
});

test('SL6 applicants: a page of rows, an empty cohort, or Unreadable', () => {
  const b = buildApplicants(ok({ available: true, total: 41, offset: 25, limit: 25, items: [
    { id: 1, company_name: 'Synthetic Co', name: 'Founder One', display_status: 'interview_set', applied_at: '2026-10-03 15:00:00' },
    { id: 2, company_name: null, name: 'Founder Two', display_status: 'waiting', applied_at: null },
  ] }));
  assert.deepEqual(b.rows.map((r) => [r.company, r.founder, r.status, r.applied]),
    [['Synthetic Co', 'Founder One', 'Interview set', '3 Oct'], [NOT_RECORDED, 'Founder Two', 'Waiting', NOT_RECORDED]]);
  assert.deepEqual([b.total, b.offset, b.limit], [41, 25, 25]);
  assert.equal(buildApplicants(ok({ available: true, total: 0, items: [] })).state, 'empty');
  assert.equal(buildApplicants(ok({ available: false, reason: 'List down.' })).reason, 'List down.');
  assert.equal(buildApplicants(bad).state, 'unreadable');
});

// ---------------------------------------------------------------- the page, mounted

const APPLICANTS = { available: true, total: 1, offset: 0, limit: 25, items: [{ id: 7, company_name: 'Synthetic Labs', name: 'Synthetic Founder', display_status: 'approved', applied_at: '2026-09-04 14:00:00' }] };

/** A stubbed Worker. `fail` names reads that answer 503; `overview` replaces the overview answer; `hold` never answers it. */
function worker(fail = [], overview = overviewFixture(), hold = false) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    const p = u.pathname;
    const down = (name) => fail.includes(name);
    if (p === '/api/admin/cohort/overview' && hold) return new Promise(() => {});
    if (p === '/api/admin/cohort/overview') return down('overview') ? json({ detail: 'down' }, 503) : json(overview);
    if (p === '/api/admin/cohort/applications/list') return down('list') ? json({ detail: 'down' }, 503) : json(APPLICANTS);
    if (p === '/api/admin/cohort/applications') return down('applications') ? json({ detail: 'down' }, 503) : json({ settings: { min: 1, max: 25 }, settings_unreadable: false, cycles: [] });
    if (p === '/api/admin/cohort/timeline') return json({ cycles: [], server_time: '2026-10-24T12:00:00.000Z' });
    if (p === '/api/admin/cohort/review') return json({ at_risk: [], review: [] });
    if (p === '/api/admin/studio/glance') return json({ tier: 'hq', approvals: { lanes: [] } });
    if (p === '/api/admin/lab-hosts') return json({ items: [], counts: { pending: 0 } });
    if (p === '/api/spinout-lab/certificates') return json({ certificates: [], awaiting: [], eligible_total: 0, unavailable: {} });
    return json({});
  };
  return seen;
}

let where = null;
function Where() { where = useLocation().pathname; return null; }

async function mount(url, { fail = [], overview, hold = false } = {}) {
  const original = globalThis.fetch;
  const realNow = Date.now;
  Date.now = () => NOW;
  const seen = worker(fail, overview, hold);
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminLab), h(Where))); });
  const flush = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, props, flush, byTestId,
    within: (id) => walk(byTestId(id)),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    async fire(id, name, arg) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await flush(4); },
    async press(id, word) {
      const b = walk(byTestId(id)).find((n) => n.tagName === 'BUTTON' && textOf(n) === word);
      assert.ok(b, `no ${word} in ${id}`);
      await act(async () => { props(b).onClick(); });
      await flush(4);
    },
    async unmount() { await act(async () => root.unmount()); restore(); globalThis.fetch = original; Date.now = realNow; },
  };
}

test('mounted Overview: every SL1 block drawn from the overview read, its table, its lane links and the funnel’s cohort', async () => {
  const m = await mount(LAB_PATH);
  try {
    assert.match(m.of('lab-calendar'), /Applications open.*In review · pool frozen.*Weeks 1 to 4.*Today/s);
    for (const k of ['2026-09', '2026-10', '2026-11', '2026-12']) assert.ok(m.has(`lab-lane-${k}`), k);
    assert.equal(m.props(m.byTestId('lab-lane-link-2026-11')).href, `${LAB_PATH}/cohorts/2026-11`);
    assert.equal(m.of('lab-seg-2026-10-review'), 'Oct 2026 · In review · pool frozen until 1 Oct 00:00 ET', 'a segment names itself');
    assert.equal(m.props(m.byTestId('lab-seg-2026-10-w3')).tabIndex, 0, 'a segment can be focused');
    assert.ok(m.has('lab-seg-2026-10-deadline'));
    assert.match(m.of('lab-by-cohort'), /Approved or started.*Carried forward.*2 of Sep 2026’s were carried/s);
    assert.match(m.of('lab-weeks'), /Week 1.*Week 4/s);
    assert.match(m.of('lab-heat-2026-10'), /Oct 2026.*20 passed.*2 failed.*18 passed.*1 grace.*Now · 29 Oct/s);
    assert.equal(m.of('lab-funnel-applied'), '30 · 100%');
    assert.equal(m.of('lab-funnel-passed_week_4'), 'Not decided yet');
    assert.match(m.of('lab-funnel'), /Interviewed: Not recorded/);
    assert.match(m.of('lab-per-week'), /hollow point is the current week/);

    await m.fire('lab-funnel-cohort', 'onChange', { target: { value: '2026-08' } });
    assert.equal(m.of('lab-funnel-passed_week_4'), '11 · 55%', 'the cohort switch redraws the funnel');

    await m.press('lab-weeks-view', 'Table');
    assert.match(m.of('lab-weeks'), /Oct 2026.*20 passed · 2 failed · 0 grace.*Now · 29 Oct/s);
    await m.press('lab-calendar-view', 'Table');
    assert.match(m.of('lab-calendar'), /Oct 2026.*Running.*open 1 Sep 00:00 ET, close 24 Sep 23:59 ET.*1 Oct 00:00 ET.*29 Oct 00:00 ET/s);
    assert.ok(!m.has('lab-timeline'), 'the table replaces the drawing');
    await m.press('lab-per-week-view', 'Table');
    assert.match(m.of('lab-per-week'), /19 Oct \(so far\)6/);
    await m.press('lab-by-cohort-view', 'Table');
    assert.match(m.of('lab-by-cohort'), /Nov 2026.*24 so far/s);

    await m.press('lab-calendar-view', 'Chart');
    await act(async () => { m.props(m.byTestId('lab-lane-2026-11')).onClick(); });
    await m.flush(6);
    assert.equal(where, `${LAB_PATH}/cohorts/2026-11`, 'a click on the lane opens its cohort');
    assert.ok(m.has('lab-cohort-page'));
  } finally { await m.unmount(); }
});

test('mounted Overview: a failed overview read costs its five blocks, each says so and offers Try again, and the tiles stay', async () => {
  const m = await mount(LAB_PATH, { fail: ['overview'] });
  try {
    for (const id of ['calendar', 'by-cohort', 'weeks', 'funnel', 'per-week']) {
      assert.match(m.of(`lab-${id}`), /could not be read\. That is not the same as none\.Try again/, id);
      assert.doesNotMatch(m.of(`lab-${id}`), /\b0\b/, `${id} draws no zero`);
    }
    assert.ok(m.has('lab-tile-next'), 'the tiles are other reads');
    const before = m.seen.filter((s) => s.startsWith('/api/admin/cohort/overview')).length;
    await m.press('lab-calendar', 'Try again');
    assert.ok(m.seen.filter((s) => s.startsWith('/api/admin/cohort/overview')).length > before, 'Try again reads again');
  } finally { await m.unmount(); }
});

test('mounted Overview: one block unavailable inside the read costs only that block; an empty Lab says so', async () => {
  const d = overviewFixture();
  d.blocks.applications_per_week = { available: false, reason: 'Weekly application submissions could not be read.' };
  const m = await mount(LAB_PATH, { overview: d });
  try {
    assert.match(m.of('lab-per-week'), /Weekly application submissions could not be read\.Try again/);
    assert.match(m.of('lab-funnel'), /Applied/, 'the funnel is still drawn');
  } finally { await m.unmount(); }
  const empty = overviewFixture();
  empty.blocks.cohorts.items = [];
  empty.blocks.applications_per_week.items = [];
  const e = await mount(LAB_PATH, { overview: empty });
  try {
    for (const id of ['calendar', 'by-cohort', 'weeks', 'funnel', 'per-week']) assert.ok(e.has(`lab-${id}-empty`), id);
    assert.match(e.of('lab-calendar-empty'), /holds no cohort yet/);
  } finally { await e.unmount(); }
});

test('mounted Overview: while the read is out every block says Reading…', async () => {
  const m = await mount(LAB_PATH, { hold: true });
  try {
    for (const id of ['calendar', 'by-cohort', 'weeks', 'funnel', 'per-week']) assert.match(m.of(`lab-${id}`), /Reading…/, id);
  } finally { await m.unmount(); }
});

test('mounted SL5: Settings, the next twelve cohorts as a calendar, then the list searched and filtered', async () => {
  const m = await mount(`${LAB_PATH}/cohorts`);
  try {
    assert.equal(m.of('lab-settings-chip'), 'Minimum 1 · Places 25');
    assert.match(m.of('lab-cohort-calendar'), /Next twelve cohorts/);
    assert.deepEqual(['2026-10', '2026-11', '2026-12'].map((k) => m.has(`lab-lane-${k}`)), [true, true, true]);
    assert.ok(!m.has('lab-lane-2026-09'));
    await m.press('lab-cohorts-view', 'Table');
    assert.ok(m.has('lab-cohort-list'));
    assert.match(m.of('lab-cohort-row-2026-12'), /Dec 2026.*Open for applications.*Not open yet/s);
    assert.match(m.of('lab-cohort-list'), /5 cohorts/);
    const open = m.within('lab-cohort-row-2026-10').find((n) => n.tagName === 'A');
    assert.equal(m.props(open).href, `${LAB_PATH}/cohorts/2026-10`);
    await m.fire('lab-cohort-status', 'onChange', { target: { value: 'Finished' } });
    assert.match(m.of('lab-cohort-list'), /2 of 5 cohorts/);
    assert.ok(!m.has('lab-cohort-row-2026-10'));
    await m.fire('lab-cohort-search', 'onChange', { target: { value: 'aug' } });
    assert.match(m.of('lab-cohort-list'), /1 of 5 cohorts/);
  } finally { await m.unmount(); }
  const s = await mount(`${LAB_PATH}/cohorts`, { fail: ['applications', 'overview'] });
  try {
    assert.equal(s.of('lab-settings-chip'), 'Minimum and places could not be read');
    assert.match(s.of('lab-cohort-calendar'), /could not be read.*Try again/s);
  } finally { await s.unmount(); }
});

test('mounted SL6: its own address draws one cohort, its applicants and today’s overrides; a failed read in each block', async () => {
  const m = await mount(`${LAB_PATH}/cohorts/2026-10`);
  try {
    assert.equal(m.of('lab-cohort-title'), 'Oct 2026 cohort');
    assert.match(m.of('lab-cohort-line'), /started 1 Oct 00:00 ET · Week 4 deadline 29 Oct 00:00 ET/);
    assert.match(m.of('lab-cohort-tile-passed_w1'), /Passed Week 1.*20.*of 22 started/s);
    assert.match(m.of('lab-cohort-capacity'), /22 approved of 25 places.*Minimum 1 met/s);
    assert.match(m.of('lab-cohort-week-4'), /Week 4 · now/);
    assert.match(m.of('lab-cohort-messages'), /Not read here yet/);
    assert.match(m.of('lab-cohort-history'), /Not read here yet/);
    assert.match(m.of('lab-cohort-applicants'), /Synthetic Labs.*Synthetic Founder.*Approved.*4 Sep/s);
    assert.match(m.of('lab-applicants-pager'), /1–1 of 1/);
    assert.ok(m.seen.includes('/api/admin/cohort/applications/list?cohort=2026-10&limit=25&offset=0'), 'one page of this cohort’s applicants');
    assert.ok(m.within('lab-cohort-grace').some((n) => m.props(n)?.['data-testid'] === 'admin-cohort-timing'), 'today’s grace and override console is mounted');
    assert.equal(m.props(m.byTestId('lab-cohort-back')).href, `${LAB_PATH}/cohorts`);
  } finally { await m.unmount(); }
  const missing = await mount(`${LAB_PATH}/cohorts/2031-01`);
  try { assert.match(missing.of('lab-cohort-missing'), /holds no 2031-01 cohort/); } finally { await missing.unmount(); }
  const down = await mount(`${LAB_PATH}/cohorts/2026-10`, { fail: ['list', 'applications'] });
  try {
    assert.match(down.of('lab-cohort-applicants'), /could not be read\. That is not the same as none\.Try again/);
    assert.match(down.of('lab-cohort-capacity'), /Minimum and places could not be read.*Try again/s);
    assert.match(down.of('lab-cohort-tile-applied'), /30/, 'the cohort itself is still drawn');
  } finally { await down.unmount(); }
  const gone = await mount(`${LAB_PATH}/cohorts/2026-10`, { fail: ['overview'] });
  try { assert.match(gone.of('lab-cohort-page'), /could not be read.*Try again/s); } finally { await gone.unmount(); }
});
