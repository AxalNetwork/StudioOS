/**
 * D933 (#2717) — Admin › Community, the page complete on parts 1 and 2: the
 * period control, every tile and its delta, the weekly chart and its table,
 * the funnel and events by type, who takes part, wellbeing, the waits in
 * Needs a decision, and Recent activity.
 *
 * Every new block is checked in each of its states (ready, loading,
 * unreadable, and unrecorded where a store records nothing): first on the
 * pure model with fixtures worked out by hand, then mounted on a stubbed
 * `fetch`, so the reads go through the real client to a URL.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_community_d933.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  CHECKINS_WITHHELD, COMMUNITY_PATH, DEFAULT_WEEKS,
  biggestChange, blockOf, buildActivity, buildConsoles, buildEventsFunnel, buildNeeds, buildTiles, buildWellbeing, buildWho,
  deltaText, oldestWait, searchWithWeeks, waitText, weeksFrom,
} from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (hours) => new Date(NOW + hours * 3_600_000).toISOString();
const ok = (data) => ({ status: 'ready', data });
const bad = { status: 'error', data: null };
const loading = { status: 'loading', data: null };
const gone = (what) => ({ available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` });

// ---------------------------------------------------------------- fixtures

const WEEKS4 = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];

/** D931's answer for four weeks, worked out by hand. */
function overview(over = {}) {
  const blocks = {
    queue: {
      events: { available: true, count: 2, oldest_since: at(-100), oldest_hours: 100, overdue: 1, overdue_after_hours: 72, waiting_from_created_at: 0 },
      jobs: { available: true, pending: 2, overdue: 0, wait_not_recorded: 1, oldest_submitted_at: at(-30), oldest_wait_hours: 30 },
      overdue_hours: 72,
    },
    events: {
      weekly: {
        available: true,
        registrations: { window: 60, previous: 40 },
        weekly: [
          { week: '2026-09-28', registrations: 10, checkins: 4, to_date: false },
          { week: '2026-10-05', registrations: 20, checkins: 8, to_date: false },
          { week: '2026-10-12', registrations: 25, checkins: 9, to_date: false },
          { week: '2026-10-19', registrations: 5, checkins: 1, to_date: true },
        ],
      },
      show_up: { available: true, events: 3, seats_taken: 80, attended: 52, rate: 0.65 },
      by_type: { available: true, counts: { workshop: 4, office_hours: 2, networking: 0, other: 1 } },
      waitlisted: { available: true, registrations: 9, events: 2 },
    },
    jobs: {
      available: true,
      applications: { window: 12, previous: 12 },
      weekly: [
        { week: '2026-09-28', count: 3, to_date: false },
        { week: '2026-10-05', count: 3, to_date: false },
        { week: '2026-10-12', count: 4, to_date: false },
        { week: '2026-10-19', count: 2, to_date: true },
      ],
      by_status: {}, top: [], days_open: { recorded: false, reason: 'No store records when a posting was published.' },
    },
    participation_by_role: {
      events: { available: true, by_role: { founder: 30, investor: 10, advisor: 5, operating_partner: 0, explorer: 3, guest: 2, other: 0 }, not_recorded: 4 },
      jobs: { available: true, by_role: { founder: 2, investor: 0, advisor: 0, operating_partner: 1, explorer: 6, guest: 3, other: 0 } },
    },
    circles: { available: true },
    network: { available: true },
    wellbeing: {
      experts: { available: true, verified: 9, unverified: 3, hidden: 1, inactive: 2 },
      bookings: { available: true, window: 7, previous: 2, weekly: [
        { week: '2026-09-28', count: 1, to_date: false }, { week: '2026-10-05', count: 2, to_date: false },
        { week: '2026-10-12', count: 3, to_date: false }, { week: '2026-10-19', count: 1, to_date: true },
      ] },
      checkins: { available: true, withheld: false, min_cohort: 7, band: { at_least: 10, under: 15 } },
    },
    active_members: { recorded: false, reason: 'Nothing records who took part in Community.' },
    circle_discussions: { recorded: false, reason: 'Circles have no discussion store.' },
  };
  const merge = (t, o) => { for (const [k, v] of Object.entries(o)) t[k] = v && typeof v === 'object' && !Array.isArray(v) && !('available' in v) && t[k] ? merge({ ...t[k] }, v) : v; return t; };
  return { weeks: 4, week_starts: WEEKS4, current_week: '2026-10-19', as_of: at(0), blocks: merge(blocks, over) };
}

const GLANCE = { approvals: { lanes: [{ key: 'events', count: 2 }, { key: 'jobs', count: 2 }] } };
const READS = (o = overview()) => ({ glance: ok(GLANCE), events: ok([]), analytics: ok({ events: [], unreadable: [] }), jobs: ok([]), circles: ok([]), roster: ok([]), overview: ok(o) });
const tile = (tiles, key) => tiles.find((t) => t.key === key);

// ---------------------------------------------------------------- the period

test('the period is in the URL: 4, 12 or 52 weeks, 12 when absent or anything else', () => {
  assert.equal(DEFAULT_WEEKS, 12);
  assert.equal(weeksFrom(''), 12);
  assert.equal(weeksFrom('?weeks=4'), 4);
  assert.equal(weeksFrom('?weeks=52&open=jobs'), 52);
  for (const bad of ['?weeks=13', '?weeks=4.0', '?weeks=', '?weeks=abc']) assert.equal(weeksFrom(bad), 12, bad);
  assert.equal(searchWithWeeks('?open=jobs&weeks=12', 52), '?open=jobs&weeks=52', 'another parameter was lost');
});

// ---------------------------------------------------------------- tiles

test('deltas compare with the same weeks before, and never invent a percentage from none', () => {
  assert.equal(deltaText(60, 40, 4), '+50% on the 4 weeks before');
  assert.equal(deltaText(30, 40, 12), '−25% on the 12 weeks before');
  assert.equal(deltaText(12, 12, 4), 'same as the 4 weeks before');
  assert.equal(deltaText(5, 0, 4), 'none in the 4 weeks before');
  assert.equal(deltaText(0, 0, 4), 'none in this period or the 4 weeks before');
});

test('the period tiles: registrations and applications with deltas, show-up, and verified experts', () => {
  const tiles = buildTiles(READS(), NOW);
  assert.deepEqual([tile(tiles, 'registrations').value, tile(tiles, 'registrations').sub], ['60', '+50% on the 4 weeks before']);
  assert.deepEqual([tile(tiles, 'applications').value, tile(tiles, 'applications').sub], ['12', 'same as the 4 weeks before']);
  assert.deepEqual([tile(tiles, 'show-up').value, tile(tiles, 'show-up').sub], ['65%', '52 of 80 seats · 3 events ended']);
  // "[v] verified of [n]": n is the listed experts. Hidden and inactive are named, and samples are never counted.
  assert.equal(tile(tiles, 'experts').value, '9 verified of 12');
  assert.match(tile(tiles, 'experts').sub, /1 hidden · 2 inactive not listed/);
});

test('show-up is a dash with its reason when no event ended or no seat was taken, never 0%', () => {
  const none = buildTiles(READS(overview({ events: { show_up: { available: true, events: 0, seats_taken: 0, attended: 0, rate: null } } })), NOW);
  assert.deepEqual([tile(none, 'show-up').value, tile(none, 'show-up').sub], ['—', 'No event ended in these 4 weeks.']);
  const empty = buildTiles(READS(overview({ events: { show_up: { available: true, events: 2, seats_taken: 0, attended: 0, rate: null } } })), NOW);
  assert.deepEqual([tile(empty, 'show-up').value, tile(empty, 'show-up').sub], ['—', 'No seat was taken on the 2 events that ended.']);
});

test('each period tile answers alone: loading, a block that failed, and the whole read failing', () => {
  const load = buildTiles({ ...READS(), overview: loading }, NOW);
  for (const k of ['registrations', 'applications', 'show-up', 'experts']) assert.equal(tile(load, k).state, 'loading', k);
  const whole = buildTiles({ ...READS(), overview: bad }, NOW);
  for (const k of ['registrations', 'applications', 'show-up', 'experts']) {
    assert.equal(tile(whole, k).state, 'unreadable', k);
    assert.equal(tile(whole, k).value, undefined, `${k} drew a value from a failed read`);
  }
  const one = buildTiles(READS(overview({ jobs: gone('The job board') })), NOW);
  assert.equal(tile(one, 'applications').state, 'unreadable');
  assert.match(tile(one, 'applications').reason, /The job board could not be read.*not the same as none/);
  assert.equal(tile(one, 'registrations').state, 'ready', 'a failed jobs block cost the events tile');
  // A block that is absent is unreadable, never zero.
  assert.equal(blockOf(ok({ blocks: {} }), 'events.weekly').state, 'unreadable');
  assert.equal(blockOf(ok({ blocks: { active_members: { recorded: false, reason: 'x' } } }), 'active_members').state, 'unrecorded');
});

test('Waiting on you gains the oldest wait, and the amber dot past 72 hours', () => {
  const t = tile(buildTiles(READS(), NOW), 'waiting');
  assert.equal(t.sub, '2 events · 2 jobs · oldest 4 days', 'the oldest of both queues, 100 hours, whole days');
  assert.equal(t.overdue, true);
  assert.match(t.note, /1 jobs were submitted before waits were recorded, so they are not dated or marked overdue/);
  const calm = oldestWait(ok(overview({ queue: {
    events: { available: true, count: 1, oldest_hours: 50, overdue: 0, waiting_from_created_at: 1 },
    jobs: { available: true, pending: 0, overdue: 0, wait_not_recorded: 0, oldest_wait_hours: null },
  } })));
  assert.deepEqual([calm.text, calm.overdue], ['2 days', false]);
  assert.match(calm.note, /1 events wait from when they were created/);
  const half = oldestWait(ok(overview({ queue: { jobs: gone('The job board queue') } })));
  assert.deepEqual([half.text, half.overdue], ['4 days', true]);
  assert.match(half.note, /How long jobs have waited could not be read/);
  assert.deepEqual(oldestWait(bad).text, null);
  assert.deepEqual(oldestWait(loading), { text: null, overdue: false, note: null });
  assert.equal(waitText(0.4), 'under an hour');
  assert.equal(waitText(71.9), '2 days');
  assert.equal(waitText(5), '5 hours');
});

// ---------------------------------------------------------------- the weekly chart and CM7

test('activity by week: three series on the read\'s weeks, the current week hollow, and a missing week breaks the line', () => {
  const a = buildActivity(READS());
  assert.equal(a.state, 'ready');
  assert.deepEqual(a.chart.series.map((s) => [s.label, s.tone, s.values]), [
    ['Event registrations', 'violet', [10, 20, 25, 5]],
    ['Job applications', 'sky', [3, 3, 4, 2]],
    ['Expert bookings', 'amber', [1, 2, 3, 1]],
  ]);
  assert.deepEqual(a.chart.labels, ['28 Sept', '5 Oct', '12 Oct', '19 Oct']);
  assert.equal(a.chart.currentIndex, 3);
  const gap = buildActivity(READS(overview({ wellbeing: { bookings: { available: true, window: 1, previous: 0, weekly: [{ week: '2026-10-05', count: 1 }] } } })));
  assert.deepEqual(gap.chart.series[2].values, [null, 1, null, null], 'a week with no value was drawn as zero');
});

test('activity by week: a series that failed is named and left out; all failing is unreadable', () => {
  const a = buildActivity(READS(overview({ jobs: gone('The job board') })));
  assert.deepEqual(a.chart.series.map((s) => s.label), ['Event registrations', 'Expert bookings']);
  assert.match(a.missing, /Job applications could not be read, so it is not drawn\. That is not the same as none\./);
  const none = buildActivity(READS(overview({ events: { weekly: gone('x') }, jobs: gone('y'), wellbeing: { bookings: gone('z') } })));
  assert.equal(none.state, 'unreadable');
  assert.equal(buildActivity({ overview: bad }).state, 'unreadable');
  assert.equal(buildActivity({ overview: loading }).state, 'loading');
});

test('the biggest change is written from the numbers', () => {
  assert.equal(buildActivity(READS()).sentence,
    'Event registrations moved most: 60 in these 4 weeks, this week so far, up from 40 in the 4 weeks before.');
  assert.equal(biggestChange([{ noun: 'job applications', window: 3, previous: 9 }, { noun: 'expert bookings', window: 4, previous: 2 }], 12),
    'Job applications moved most: 3 in these 12 weeks, this week so far, down from 9 in the 12 weeks before.');
  assert.equal(biggestChange([{ noun: 'a', window: 4, previous: 4 }], 4), 'Nothing changed against the 4 weeks before: each count is the same.');
  assert.equal(biggestChange([{ noun: 'a', window: 0, previous: 0 }], 4), 'Nothing was recorded in these 4 weeks or the 4 weeks before.');
});

// ---------------------------------------------------------------- the Events card

test('the funnel: registered then attended for the events that ended, Confirmed not counted on its own, waitlisted beside it', () => {
  const ev = buildEventsFunnel(READS());
  assert.deepEqual(ev.funnel.steps.map((s) => [s.key, s.value, s.share ?? null]), [['registered', 80, 100], ['confirmed', null, null], ['attended', 52, 65]]);
  assert.match(ev.funnel.steps[1].note, /Not counted on its own/);
  assert.deepEqual([ev.waitlisted.value, ev.waitlisted.events], [9, 2]);
  const failed = buildEventsFunnel(READS(overview({ events: { show_up: gone('Show-up'), waitlisted: gone('The waitlists') } })));
  assert.equal(failed.funnel.state, 'unreadable');
  assert.equal(failed.waitlisted.state, 'unreadable');
  assert.equal(failed.byType.state, 'ready', 'a failed show-up cost events by type');
});

test('events by type: the types with events first, the ones with none behind Show all', () => {
  const { byType } = buildEventsFunnel(READS());
  assert.deepEqual(byType.shown.map((r) => [r.label, r.value]), [['Workshop', 4], ['Office Hours', 2], ['Other', 1]]);
  assert.equal(byType.none.length, 9, 'the twelve stored types, less the three with events');
  assert.ok(byType.none.every((r) => r.value === 0));
  assert.equal(buildEventsFunnel({ overview: loading }).byType.state, 'loading');
});

// ---------------------------------------------------------------- who takes part

test('who takes part: registrations and applications stacked by profile, with a sentence', () => {
  const w = buildWho(READS());
  assert.deepEqual(w.rows.map((r) => [r.label, r.parts.map((p) => p.value)]), [
    ['Founder', [30, 2]], ['Investor', [10, 0]], ['Advisor', [5, 0]], ['Operating partner', [0, 1]], ['Explorer', [3, 6]], ['Guest', [2, 3]],
  ]);
  assert.equal(w.sentence, 'Founders took the largest share: 32 of 62 event registrations and job applications (52%).');
  assert.match(w.gone, /4 registrations are from accounts that are gone/);
  const half = buildWho(READS(overview({ participation_by_role: { jobs: gone('Job applications by role') } })));
  assert.deepEqual(half.parts.map((p) => p.key), ['events']);
  assert.match(half.missing, /Job applications could not be read/);
  assert.equal(buildWho(READS(overview({ participation_by_role: { jobs: gone('a'), events: gone('b') } }))).state, 'unreadable');
  assert.equal(buildWho({ overview: loading }).state, 'loading');
});

// ---------------------------------------------------------------- wellbeing

test('wellbeing: experts by state, bookings by week, and the check-in band as a range', () => {
  const wb = buildWellbeing(READS());
  assert.deepEqual(wb.experts.parts.map((p) => [p.label, p.value]), [['Verified', 9], ['Unverified', 3], ['Inactive', 2], ['Hidden', 1]]);
  assert.equal(wb.experts.total, 15);
  assert.deepEqual(wb.bookings.rows.map((r) => [r.label, r.text, r.toDate]), [['28 Sept', '1', false], ['5 Oct', '2', false], ['12 Oct', '3', false], ['19 Oct', '1', true]]);
  assert.equal(wb.checkins.text, '10 to 14 founders checked in');
});

test('wellbeing: under seven founders the band is withheld with the canvas\'s sentence, and each part fails alone', () => {
  const few = buildWellbeing(READS(overview({ wellbeing: { checkins: { available: true, withheld: true, min_cohort: 7, band: null } } })));
  assert.equal(few.checkins.text, CHECKINS_WITHHELD);
  // Withheld wins even if a band travels with it: the floor is the Worker's, and the page never draws past it.
  const both = buildWellbeing(READS(overview({ wellbeing: { checkins: { available: true, withheld: true, min_cohort: 7, band: { at_least: 5, under: 10 } } } })));
  assert.equal(both.checkins.text, CHECKINS_WITHHELD);
  assert.equal(CHECKINS_WITHHELD, 'Too few check-ins to show. We show this only when seven or more founders check in.');
  const one = buildWellbeing(READS(overview({ wellbeing: { experts: gone('Wellbeing experts') } })));
  assert.equal(one.experts.state, 'unreadable');
  assert.equal(one.bookings.state, 'ready');
  assert.equal(buildWellbeing({ overview: bad }).checkins.state, 'unreadable');
  assert.equal(buildConsoles(READS()).wellbeing.text, '3 to verify');
});

// ---------------------------------------------------------------- Needs a decision

test('Needs a decision: each row says how long it waited, and is Overdue past 72 hours', () => {
  const reads = {
    events: ok([
      { id: 1, title: 'Pricing Clinic', status: 'pending_review', submitted_at: at(-80), created_at: at(-200) },
      { id: 2, title: 'Legacy Talk', status: 'pending_review', submitted_at: null, created_at: at(-10) },
    ]),
    jobs: ok([
      { id: 3, title: 'Backend Engineer', status: 'pending_review', submitted_at: at(-72), created_at: at(-300) },
      { id: 4, title: 'Old Posting', status: 'pending_review', submitted_at: null, created_at: at(-500) },
    ]),
  };
  const n = buildNeeds(reads, NOW);
  assert.deepEqual(n.rows.map((r) => [r.title, r.wait, r.overdue]), [
    ['Pricing Clinic', 'waiting 3 days', true],
    ['Backend Engineer', 'waiting 3 days', false],
    ['Legacy Talk', 'waiting 10 hours · since created', false],
    ['Old Posting', 'wait not recorded', false],
  ], 'exactly 72 hours is not overdue, and a job with no submission stamp is never dated');
  assert.equal(n.overdue, 1);
});

// ---------------------------------------------------------------- the page, mounted

const ACTIVITY = {
  rows: [
    { kind: 'events', actor: 'admin', icon: '◆', sentence: 'An admin published Founder Breakfast', title: 'Founder Breakfast', href: '/admin/events', at: '2026-10-24 10:00:00' },
    { kind: 'jobs', actor: 'member', icon: '●', sentence: '3 applications to Backend Engineer', title: 'Backend Engineer', href: '/admin/jobs', at: '2026-10-23 09:00:00', count: 3 },
  ],
  total: 2, limit: 10, offset: 0, filters: {}, sources: [], unreadable: [],
};

function worker({ fail = [], answer = overview, pin = false } = {}) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    const p = u.pathname;
    const down = (name) => fail.includes(name);
    if (p === '/api/admin/community/overview') {
      if (down('overview')) return json({ detail: 'down' }, 503);
      const weeks = Number(u.searchParams.get('weeks'));
      return json(pin ? answer() : { ...answer(), weeks });
    }
    if (p === '/api/admin/community/activity') {
      if (down('activity')) return json({ detail: 'down' }, 503);
      const kind = u.searchParams.get('kind');
      return json({ ...ACTIVITY, rows: ACTIVITY.rows.filter((r) => !kind || r.kind === kind) });
    }
    if (p === '/api/admin/studio/glance') return json({ tier: 'hq', approvals: { label: 'HQ', lanes: [{ key: 'events', label: 'Events', count: 2 }, { key: 'jobs', label: 'Jobs', count: 2 }], pending_total: 4 } });
    if (p === '/api/admin/events/analytics') return json({ events: [], unreadable: [] });
    if (p === '/api/admin/events') return json({ events: u.searchParams.get('status') === 'pending_review' ? [{ id: 9, title: 'Pricing Clinic', status: 'pending_review', submitted_at: new Date(Date.now() - 100 * 3_600_000).toISOString(), created_at: '2026-01-01 00:00:00' }] : [] });
    if (p === '/api/admin/jobs') return json({ jobs: [] });
    if (p === '/api/admin/circles') return json({ circles: [] });
    if (p === '/api/admin/network-profiles') return json({ profiles: [] });
    return json({});
  };
  return seen;
}

async function mount(url, opts) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = worker(opts);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let loc = null;
  function Spy() { const l = useLocation(); loc = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminCommunity), h(Spy))); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen,
    loc: () => loc,
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props(byTestId(id)),
    async click(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted: the period control reads 12 weeks by default, and a choice goes in the URL and reads again', async () => {
  const m = await mount(COMMUNITY_PATH);
  try {
    assert.ok(m.seen.includes('/api/admin/community/overview?weeks=12'));
    assert.equal(m.props('community-period-12')['aria-checked'], true);
    assert.equal(m.props('community-period-4')['aria-checked'], false);
    await m.click('community-period-52');
    assert.equal(m.loc(), `${COMMUNITY_PATH}?weeks=52`);
    assert.ok(m.seen.includes('/api/admin/community/overview?weeks=52'), 'the new period was not read');
    assert.equal(m.props('community-period-52')['aria-checked'], true);
    assert.match(m.of('community-period-line'), /last 52 weeks/);
    assert.match(m.of('community-tile-registrations'), /60.*\+50% on the 52 weeks before/s);
  } finally { await m.unmount(); }
});

test('mounted CM9: every new block is drawn from the Community read', async () => {
  const m = await mount(`${COMMUNITY_PATH}?weeks=4`);
  try {
    assert.ok(m.seen.includes('/api/admin/community/overview?weeks=4'));
    assert.match(m.of('community-tile-waiting'), /4.*2 events · 2 jobs · oldest 4 days/s);
    assert.ok(m.has('community-tile-waiting-overdue'), 'no amber dot past 72 hours');
    assert.match(m.props('community-tile-waiting-overdue')['aria-label'], /more than 72 hours/);
    assert.match(m.of('community-tile-show-up'), /65%/);
    assert.match(m.of('community-tile-experts'), /9 verified of 12/);
    assert.match(m.of('community-activity-sentence'), /Event registrations moved most/);
    assert.match(m.of('community-funnel-confirmed'), /Not counted on its own/);
    assert.match(m.of('community-waitlisted'), /9.*on 2 upcoming events · not a step/s);
    assert.match(m.of('community-by-type-all'), /Show all · 9 types with none/);
    assert.match(m.of('community-who-sentence'), /Founders took the largest share/);
    assert.match(m.of('community-checkins'), /10 to 14 founders checked in/);
    assert.match(m.of('community-need-wait-event-9'), /Overdue.*waiting 4 days/s);
    assert.match(m.of('community-recent'), /An admin published Founder Breakfast.*3 applications to Backend Engineer/s);
    assert.doesNotMatch(m.text(), /Not read here yet/, 'a retired sentence is still drawn');
    assert.doesNotMatch(m.text(), /\b(mood|stress)\b[^.]*\d/i, 'a mood or stress figure reached the page');
  } finally { await m.unmount(); }
});

test('mounted: the activity table is CM7, the current week marked so far', async () => {
  const m = await mount(`${COMMUNITY_PATH}?weeks=4`);
  try {
    assert.ok(!m.has('community-activity-table'));
    await m.click('community-activity-toggle');
    assert.match(m.of('community-activity-table'), /19 Oct \(so far\).*5.*2.*1/s);
  } finally { await m.unmount(); }
});

test('mounted: a filter chip reads Recent activity again for its kind only', async () => {
  const m = await mount(COMMUNITY_PATH);
  try {
    assert.ok(m.seen.includes('/api/admin/community/activity?limit=10'));
    await m.click('community-recent-chip-jobs');
    assert.ok(m.seen.includes('/api/admin/community/activity?limit=10&kind=jobs'));
    assert.equal(m.props('community-recent-chip-jobs')['aria-pressed'], true);
    assert.doesNotMatch(m.of('community-recent'), /Founder Breakfast/);
    assert.ok(m.has('community-open-activity'), 'See all activity is gone');
  } finally { await m.unmount(); }
});

test('mounted CM10a: the Community read failing costs only its blocks, and none is drawn as zero', async () => {
  const m = await mount(COMMUNITY_PATH, { fail: ['overview', 'activity'] });
  try {
    assert.match(m.of('community-tile-registrations'), /Unreadable.*Community read could not be read/s);
    assert.match(m.of('community-card-activity'), /could not be read\. That is not the same as no activity\./);
    assert.match(m.of('community-card-recent'), /Community activity could not be read\. That is not the same as nothing happening\./);
    assert.match(m.of('community-card-wellbeing'), /could not be read/);
    assert.match(m.of('community-tile-waiting'), /4.*2 events · 2 jobs/s, 'the glance stopped answering');
    assert.ok(!m.has('community-unreadable'), 'the page banner needs every read to fail');
  } finally { await m.unmount(); }
});

test('mounted: an answer for another period is refused, never drawn as this one', async () => {
  const m = await mount(`${COMMUNITY_PATH}?weeks=52`, { answer: () => ({ ...overview(), weeks: 4 }), pin: true });
  try {
    assert.match(m.of('community-tile-registrations'), /Unreadable/);
    assert.doesNotMatch(m.of('community-tile-registrations'), /60/);
  } finally { await m.unmount(); }
});

test('mounted: nothing waits past 72 hours, so no amber dot', async () => {
  const m = await mount(COMMUNITY_PATH, { answer: () => overview({ queue: {
    events: { available: true, count: 1, oldest_hours: 5, overdue: 0, waiting_from_created_at: 0 },
    jobs: { available: true, pending: 0, overdue: 0, wait_not_recorded: 0, oldest_wait_hours: null },
  } }) });
  try {
    assert.match(m.of('community-tile-waiting'), /oldest 5 hours/);
    assert.ok(!m.has('community-tile-waiting-overdue'));
  } finally { await m.unmount(); }
});

test('mounted: under seven founders the band is withheld with the canvas\'s sentence', async () => {
  const m = await mount(COMMUNITY_PATH, { answer: () => overview({ wellbeing: { checkins: { available: true, withheld: true, min_cohort: 7, band: null } } }) });
  try { assert.equal(m.of('community-checkins'), CHECKINS_WITHHELD); } finally { await m.unmount(); }
});

// ---------------------------------------------------------------- the source

test('the source: one palette, no second chart library, no wellbeing answers, and the waits retired', () => {
  const page = read('frontend/src/pages/admin/community/AdminCommunity.jsx');
  const model = read('frontend/src/pages/admin/community/communityModel.js');
  assert.match(page, /from '\.\.\/\.\.\/\.\.\/ui'/, 'the charts are D893\'s, from ui/');
  assert.doesNotMatch(page, /recharts|chart\.js|d3/i);
  assert.doesNotMatch(page + model, /wellbeingAggregate|\/wellbeing\/aggregate/);
  assert.doesNotMatch(model, /\bWAITS\b|Not read here yet|PERIOD_WAITS/);
  assert.doesNotMatch(page, /\bWAITS\b|NotYet|WaitCard/);
  // Only violet changes in dark; the other tones stay the palette's.
  const tones = [...(page + model).matchAll(/tone: '([a-z]+)'/g)].map((x) => x[1]);
  // `hollow` is the legend's mark for the current week, not a colour.
  assert.ok(tones.every((t) => ['violet', 'sky', 'amber', 'emerald', 'muted', 'hollow'].includes(t)), `a tone outside the palette: ${tones}`);
});
