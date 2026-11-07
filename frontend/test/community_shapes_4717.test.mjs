/**
 * #4717 package 3 — the Community read's shape is checked, never patched. Every
 * figure the page draws comes from a block of `GET /api/admin/community/overview`;
 * a count in it that is missing, a string, negative or fractional, a map without
 * a key the card draws, or a row without its title, makes that block unreadable.
 * It used to read `Number(x) || 0`, so each of them drew a zero that looked real.
 *
 * Every field below is broken four ways in turn, against an answer that draws
 * whole; each break must leave its own part unreadable and the others drawn.
 * Every record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_shapes_4717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { EVENT_TYPES } from '../src/lib/eventTypes.js';
import {
  COMMUNITY_PATH, buildActivity, buildConsoles, buildEventsFunnel, buildJobs, buildNeeds, buildNextUp, buildTiles,
  buildWellbeing, buildWho, isEmptyCommunity,
} from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (hours) => new Date(NOW + hours * 3_600_000).toISOString();
const WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const TYPES = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, 0]));
const ROLES = { founder: 0, investor: 0, advisor: 0, operating_partner: 0, explorer: 0, guest: 0, other: 0 };

/** A whole answer, in the worker's shape (D931 with D918's events blocks), that draws every part. */
function full() {
  return {
    weeks: 4, week_starts: WEEKS, current_week: WEEKS[3], as_of: at(0),
    blocks: {
      queue: {
        events: { available: true, count: 2, oldest_since: at(-100), oldest_hours: 100, overdue: 1, overdue_after_hours: 72, waiting_from_created_at: 1 },
        event_rows: { available: true, total: 2, rows: [
          { event_id: 9, title: 'Pricing Clinic', waiting_since: at(-100), from_created: false, waiting_hours: 100, overdue: true },
        ] },
        jobs: { available: true, pending: 2, overdue: 0, wait_not_recorded: 1, oldest_wait_hours: 30, review: [
          { posting_id: 3, title: 'Backend Engineer', company: 'Acme', waiting_since: at(-30), waiting_hours: 30, overdue: false },
        ] },
      },
      events: {
        weekly: { available: true, registrations: { window: 60, previous: 40 }, weekly: WEEKS.map((w, i) => ({ week: w, registrations: 15, checkins: 2, to_date: i === 3 })) },
        show_up: { available: true, events: 3, seats_taken: 80, confirmed: 64, attended: 52, rate: 0.65 },
        upcoming: { available: true, events: 3, seats_taken: 59, full: 0 },
        next_up: { available: true, total: 3, rows: [
          { event_id: 1, title: 'Demo Day', status: 'published', starts_at: at(48), timezone: 'UTC', capacity: 60, seats_taken: 42 },
        ] },
        by_type: { available: true, counts: { ...TYPES, workshop: 4, office_hours: 2 } },
        waitlisted: { available: true, registrations: 9, events: 2 },
        by_status: { available: true, counts: { published: 3, pending_review: 2 } },
      },
      jobs: {
        available: true,
        applications: { window: 12, previous: 10 },
        weekly: WEEKS.map((w, i) => ({ week: w, count: 3, to_date: i === 3 })),
        by_status: { draft: 1, pending_review: 2, published: 3, rejected: 0, closed: 0, other: 0 },
        most_applied: [{ posting_id: 3, title: 'Backend Engineer', company: 'Acme', status: 'published', applications: 4, days_open: 10 }],
      },
      participation_by_role: {
        events: { available: true, by_role: { ...ROLES, founder: 30, investor: 10 }, not_recorded: 4 },
        jobs: { available: true, by_role: { ...ROLES, founder: 2, explorer: 6 } },
      },
      circles: { available: true, total: 4, published: 3, featured: 1, members_entered: { value: 40 }, by_type: { founder: 2, city: 2 } },
      network: { available: true, by_kind_state: { advisor: { active: 3, hidden: 1 } } },
      wellbeing: {
        experts: { available: true, verified: 9, unverified: 3, hidden: 1, inactive: 2 },
        bookings: { available: true, window: 7, previous: 2, weekly: WEEKS.map((w, i) => ({ week: w, count: 2, to_date: i === 3 })) },
        checkins: { available: true, withheld: false, min_cohort: 7, band: { at_least: 10, under: 15 } },
      },
    },
  };
}

const DELETE = Symbol('delete');
/** A copy of `answer` with the field at `path` (dots, numeric indices) set to `value`, or removed. */
function broken(answer, path, value) {
  const o = structuredClone(answer);
  const keys = path.split('.');
  let t = o;
  for (const k of keys.slice(0, -1)) t = t[k];
  const last = keys.at(-1);
  if (value === DELETE) delete t[last]; else t[last] = value;
  return o;
}
const readsOf = (data) => ({ overview: { status: 'ready', data } });
const tileState = (key) => (r) => buildTiles(r).find((t) => t.key === key).state;

// The part each field feeds, read as its state. `ok` lists values the field may lawfully hold
// (null for a wait nothing records); every other break must be unreadable.
const BAD = [DELETE, '3', -1, 1.5];
const FIELDS = [
  // Waiting on you, the two queues and their waits.
  ['blocks.queue.events.count', tileState('waiting')],
  ['blocks.queue.events.overdue', tileState('waiting')],
  ['blocks.queue.events.waiting_from_created_at', tileState('waiting')],
  ['blocks.queue.events.oldest_hours', tileState('waiting'), [null]],
  ['blocks.queue.jobs.pending', tileState('waiting')],
  ['blocks.queue.jobs.overdue', tileState('waiting')],
  ['blocks.queue.jobs.wait_not_recorded', tileState('waiting')],
  ['blocks.queue.jobs.oldest_wait_hours', tileState('waiting'), [null]],
  // Upcoming, show-up and the funnel beneath it.
  ['blocks.events.upcoming.events', tileState('upcoming')],
  ['blocks.events.upcoming.seats_taken', tileState('upcoming')],
  ['blocks.events.show_up.events', tileState('show-up')],
  ['blocks.events.show_up.seats_taken', tileState('show-up')],
  ['blocks.events.show_up.attended', (r) => buildEventsFunnel(r).funnel.state],
  ['blocks.events.show_up.confirmed', (r) => buildEventsFunnel(r).funnel.state, [DELETE, null]],
  // Next up, the waitlists and events by type.
  ['blocks.events.next_up.total', (r) => buildNextUp(r).state],
  ['blocks.events.waitlisted.registrations', (r) => buildEventsFunnel(r).waitlisted.state],
  ['blocks.events.waitlisted.events', (r) => buildEventsFunnel(r).waitlisted.state],
  ['blocks.events.by_type.counts.workshop', (r) => buildEventsFunnel(r).byType.state],
  ['blocks.events.by_type.counts.social', (r) => buildEventsFunnel(r).byType.state],
  // The period tiles and the activity chart.
  ['blocks.events.weekly.registrations.window', tileState('registrations')],
  ['blocks.jobs.applications.previous', tileState('applications')],
  // The Jobs card.
  ['blocks.jobs.by_status.published', (r) => buildJobs(r).state],
  ['blocks.jobs.most_applied.0.applications', (r) => buildJobs(r).state],
  // The wellbeing experts, as the tile, the card and the consoles strip read them.
  ['blocks.wellbeing.experts.verified', tileState('experts')],
  ['blocks.wellbeing.experts.hidden', (r) => buildWellbeing(r).experts.state],
  ['blocks.wellbeing.experts.unverified', (r) => buildConsoles(r).wellbeing.state],
  ['blocks.wellbeing.bookings.window', (r) => buildWellbeing(r).bookings.state],
  ['blocks.wellbeing.bookings.weekly.1.count', (r) => buildWellbeing(r).bookings.state],
  ['blocks.wellbeing.checkins.band.at_least', (r) => buildWellbeing(r).checkins.state],
  ['blocks.wellbeing.checkins.band.under', (r) => buildWellbeing(r).checkins.state],
];

test('the whole answer draws every part, so each break below is the only thing wrong', () => {
  const r = readsOf(full());
  for (const t of buildTiles(r)) assert.equal(t.state, 'ready', t.key);
  const f = buildEventsFunnel(r);
  assert.deepEqual([f.funnel.state, f.waitlisted.state, f.byType.state], ['ready', 'ready', 'ready']);
  assert.equal(buildNextUp(r).state, 'ready');
  assert.equal(buildJobs(r).state, 'ready');
  assert.equal(buildNeeds(r).partial, null);
  const a = buildActivity(r);
  assert.equal(a.state, 'ready');
  assert.equal(a.missing, null);
  assert.equal(buildWho(r).missing, null);
  const wb = buildWellbeing(r);
  assert.deepEqual([wb.experts.state, wb.bookings.state, wb.checkins.state], ['ready', 'ready', 'ready']);
  assert.equal(wb.checkins.text, '10 to 14 founders checked in');
  assert.equal(buildConsoles(r).wellbeing.state, 'ready');
});

test('a count that is missing, a string, negative or fractional makes its part unreadable, never 0', () => {
  // Mutation checked: `Number(x) || 0` back in any of these builders fails the row for that field.
  for (const [path, stateOf, lawful = []] of FIELDS) {
    for (const value of BAD) {
      if (lawful.includes(value)) continue;
      const r = readsOf(broken(full(), path, value));
      const label = `${path} = ${value === DELETE ? '(missing)' : JSON.stringify(value)}`;
      assert.equal(stateOf(r), 'unreadable', label);
    }
    for (const value of lawful) assert.equal(stateOf(readsOf(broken(full(), path, value))), 'ready', `${path} may be ${String(value)}`);
  }
});

test('a share outside 0 to 1, more attended than seats, or more Overdue than waiting is unreadable', () => {
  // Mutation checked: dropping the range checks draws 150% or "3 of 2" as if the read said so.
  for (const rate of [1.5, -0.1, '0.6']) {
    assert.equal(tileState('show-up')(readsOf(broken(full(), 'blocks.events.show_up.rate', rate))), 'unreadable', `rate ${rate}`);
  }
  assert.equal(tileState('show-up')(readsOf(broken(full(), 'blocks.events.show_up.attended', 81))), 'unreadable', 'attended past the seats');
  assert.equal(tileState('waiting')(readsOf(broken(full(), 'blocks.queue.events.overdue', 3))), 'unreadable', 'more Overdue than waiting');
  assert.equal(tileState('waiting')(readsOf(broken(full(), 'blocks.queue.jobs.wait_not_recorded', 5))), 'unreadable');
  // Show-up is worked out from the checked counts, so it always agrees with "x of y seats".
  const t = buildTiles(readsOf(full())).find((x) => x.key === 'show-up');
  assert.deepEqual([t.value, t.sub], ['65%', '52 of 80 seats · 3 events ended']);
});

test('a weekly series with a broken week, or totals that are not whole numbers, is named and not drawn', () => {
  // Mutation checked: onWeeks reading a broken week as a gap draws the series with a hole that looks like a quiet week.
  for (const [path, label] of [
    ['blocks.events.weekly.weekly.2.registrations', 'Event registrations'],
    ['blocks.events.weekly.registrations.previous', 'Event registrations'],
    ['blocks.jobs.weekly.0.count', 'Job applications'],
    ['blocks.jobs.weekly.0.week', 'Job applications'],
    ['blocks.wellbeing.bookings.previous', 'Expert bookings'],
  ]) {
    for (const value of [DELETE, '3', -1]) {
      const a = buildActivity(readsOf(broken(full(), path, value)));
      assert.equal(a.state, 'ready', path);
      assert.ok(!a.chart.series.some((s) => s.label === label), `${path}: ${label} is still drawn`);
      assert.match(a.missing, new RegExp(`${label} could not be read`), path);
    }
  }
  // The weeks themselves: without them there is no axis to draw anything on.
  assert.equal(buildActivity(readsOf(broken(full(), 'week_starts', DELETE))).state, 'unreadable');
  assert.equal(buildActivity(readsOf(broken(full(), 'week_starts', 'x'))).state, 'unreadable');
  assert.equal(buildWellbeing(readsOf(broken(full(), 'week_starts', DELETE))).bookings.state, 'unreadable');
});

test('who takes part: a part without every profile, or with an odd count, is named and the other part drawn', () => {
  for (const path of ['blocks.participation_by_role.events.by_role.founder', 'blocks.participation_by_role.events.by_role.guest', 'blocks.participation_by_role.events.not_recorded']) {
    for (const value of BAD) {
      const w = buildWho(readsOf(broken(full(), path, value)));
      assert.equal(w.state, 'ready', path);
      assert.match(w.missing, /Event registrations could not be read/, path);
      assert.deepEqual(w.parts.map((p) => p.key), ['jobs'], path);
    }
  }
  const w = buildWho(readsOf(broken(full(), 'blocks.participation_by_role.jobs.by_role.explorer', '6')));
  assert.match(w.missing, /Job applications could not be read/);
});

test('rows: a Next up, Needs or most-applied row without its title or with an odd wait is not listed as real', () => {
  assert.equal(buildNextUp(readsOf(broken(full(), 'blocks.events.next_up.rows.0.title', DELETE))).state, 'unreadable');
  assert.equal(buildNextUp(readsOf(broken(full(), 'blocks.events.next_up.rows.0.starts_at', ''))).state, 'unreadable');
  assert.equal(buildNextUp(readsOf(broken(full(), 'blocks.events.next_up.total', 0))).state, 'unreadable', 'more rows than the total');
  // A seat count or cap that is not a whole number says so on the row; it is never "NaN" or "0 / 60".
  const seats = buildNextUp(readsOf(broken(full(), 'blocks.events.next_up.rows.0.capacity', '60'))).rows[0].seats;
  assert.deepEqual([seats.text, seats.missing], ['Seats not recorded', true]);
  assert.equal(buildNextUp(readsOf(broken(full(), 'blocks.events.next_up.rows.0.seats_taken', -2))).rows[0].seats.text, 'Seats not recorded');
  assert.equal(buildJobs(readsOf(broken(full(), 'blocks.jobs.most_applied.0.title', null))).state, 'unreadable');

  // Needs a decision: a broken events row or queue leaves the jobs listed and says so; its total is the jobs' alone.
  for (const [path, value] of [['blocks.queue.event_rows.rows.0.title', DELETE], ['blocks.queue.event_rows.rows.0.waiting_hours', '100'], ['blocks.queue.events.count', '2']]) {
    const n = buildNeeds(readsOf(broken(full(), path, value)));
    assert.equal(n.state, 'ready', path);
    assert.match(n.partial, /events queue could not be read/, path);
    assert.deepEqual(n.rows.map((x) => x.title), ['Backend Engineer'], path);
    assert.equal(n.total, 2, `${path}: the total counted a queue it could not read`);
  }
  const jobsBroken = buildNeeds(readsOf(broken(full(), 'blocks.queue.jobs.overdue', -1)));
  assert.match(jobsBroken.partial, /job board could not be read/);
  assert.deepEqual([jobsBroken.total, jobsBroken.overdue], [2, 1], 'the broken jobs queue was counted as 0 instead of left out');
  // A wait nothing records is lawful, and says so.
  const undated = buildNeeds(readsOf(broken(full(), 'blocks.queue.jobs.review.0.waiting_hours', null)));
  assert.equal(undated.rows.find((x) => x.title === 'Backend Engineer').wait, 'wait not recorded');
});

test('check-ins: "too few" only when the read withholds them; a band is shown only when it reaches seven', () => {
  // Mutation checked: `withheld || !band` back → a malformed band reads "Too few check-ins", a statement the read never made.
  const ci = (path, value) => buildWellbeing(readsOf(broken(full(), path, value))).checkins;
  assert.equal(ci('blocks.wellbeing.checkins.withheld', true).withheld, true, 'a withheld read is withheld, whatever its band');
  assert.equal(ci('blocks.wellbeing.checkins.withheld', true).text.startsWith('Too few check-ins'), true);
  assert.equal(ci('blocks.wellbeing.checkins.withheld', DELETE).state, 'unreadable');
  assert.equal(ci('blocks.wellbeing.checkins.withheld', 'false').state, 'unreadable');
  assert.equal(ci('blocks.wellbeing.checkins.band', null).state, 'unreadable', 'not withheld, and no band');
  assert.equal(ci('blocks.wellbeing.checkins.band', { at_least: 0, under: 5 }).state, 'unreadable', 'a band under seven founders');
  assert.equal(ci('blocks.wellbeing.checkins.band', { at_least: 5, under: 10 }).text, '5 to 9 founders checked in', 'seven founders are the band 5 to 9');
  assert.equal(ci('blocks.wellbeing.checkins.band', { at_least: 15, under: 10 }).state, 'unreadable');
});

test('the empty state is never taken from a broken count', () => {
  const zeros = (d) => {
    const o = structuredClone(d);
    o.blocks.events.by_status.counts = { published: 0 };
    o.blocks.jobs.by_status = { draft: 0, pending_review: 0, published: 0, rejected: 0, closed: 0, other: 0 };
    o.blocks.circles = { ...o.blocks.circles, total: 0, published: 0, featured: 0, members_entered: { value: 0 }, by_type: {} };
    return o;
  };
  assert.equal(isEmptyCommunity(readsOf(zeros(full()))), true);
  assert.equal(isEmptyCommunity(readsOf(broken(zeros(full()), 'blocks.jobs.by_status.published', '0'))), false);
  assert.equal(isEmptyCommunity(readsOf(broken(zeros(full()), 'blocks.events.by_status.counts.published', null))), false);
});

test('mounted: a broken count is drawn as Unreadable, never as 0, and the other parts still draw', async () => {
  const answer = broken(broken(broken(full(), 'blocks.events.upcoming.events', '3'), 'blocks.wellbeing.experts.verified', DELETE), 'blocks.events.by_type.counts.social', DELETE);
  const restore = installDocument();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json({ rows: [], as_of: at(0) });
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4`] }, h(AdminCommunity))); });
    for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
    const of = (id) => { const n = walk(container).find((x) => props(x)?.['data-testid'] === id); assert.ok(n, `no ${id}`); return textOf(n); };
    const has = (id) => walk(container).some((x) => props(x)?.['data-testid'] === id);
    assert.match(of('community-tile-upcoming'), /Unreadable/);
    assert.doesNotMatch(of('community-tile-upcoming'), /\b0\b|\b3\b/, 'the string count was drawn');
    assert.match(of('community-tile-experts'), /Unreadable/);
    assert.doesNotMatch(of('community-tile-experts'), /verified of/);
    assert.ok(!has('community-by-type'), 'events by type was drawn without every type');
    assert.ok(!has('community-experts'), 'the experts bar was drawn without its verified count');
    // The parts whose counts are whole still draw.
    assert.match(of('community-tile-registrations'), /60/);
    assert.ok(has('community-funnel'));
    assert.match(of('community-checkins'), /10 to 14 founders checked in/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
    restore();
  }
});
