/**
 * D4820 (#4820) — Admin › Community v2, part 1, built to the "Community v2"
 * canvas (CM01–CM12e): four authoritative KPIs, Needs your attention directly
 * under them (one line when Approvals is clear), the empty-Community rule
 * (unreadable is never empty), modules that collapse instead of drawing zero
 * charts, Manage Community's six rows and one Additional insights row.
 *
 * Two layers: the pure model on the worker-shaped fixture
 * (`_community_overview_fixture.mjs`, every record made up), then the page
 * mounted on a stubbed `fetch`, so every read goes through the real client.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_community_v2_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import { communityPageSource } from './_community_source.mjs';
import {
  COMMUNITY_PATH, KPI_KEYS, NEEDS_ROWS, NOT_RECORDED, QUEUE_CLEAR,
  activityEmpty, bookingsEmpty, buildActivity, buildCircles, buildEventsFunnel, buildJobs, buildKpis, buildNeeds,
  buildNextUp, buildWellbeing, eventsEmpty, insightsLabel, isEmptyCommunity, jobsEmpty, rosterEmpty,
} from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const ok = (data) => ({ status: 'ready', data });
const UNREAD = { available: false, unreadable: true, reason: 'This could not be read on this database. That is not the same as none.' };
const UNRECORDED = { recorded: false, reason: 'No store records this.' };

/** Set `path` (dot-separated, from the answer's root) in a copy of `answer`. */
function put(answer, path, value) {
  const o = structuredClone(answer);
  const keys = path.split('.');
  let n = o;
  for (const k of keys.slice(0, -1)) n = n[k];
  n[keys.at(-1)] = value;
  return o;
}

/** Nothing waits in either review queue; both were read. */
function clearQueue(o) {
  o.blocks.queue.events = { available: true, count: 0, oldest_since: null, oldest_hours: null, overdue: 0, overdue_after_hours: 72, waiting_from_created_at: 0 };
  o.blocks.queue.event_rows = { available: true, total: 0, rows: [] };
  o.blocks.queue.jobs = { available: true, pending: 0, overdue: 0, wait_not_recorded: 0, oldest_wait_hours: null, review: [] };
  return o;
}

/** First activity: one published event, and every other source read and holding nothing. */
function quiet() {
  const o = clearQueue(full());
  const W = o.week_starts;
  const zeroTypes = Object.fromEntries(Object.keys(o.blocks.events.by_type.counts).map((k) => [k, 0]));
  const zeroRoles = Object.fromEntries(Object.keys(o.blocks.participation_by_role.events.by_role).map((k) => [k, 0]));
  Object.assign(o.blocks.events, {
    weekly: { available: true, registrations: { window: 0, previous: 0 }, weekly: W.map((w, i) => ({ week: w, registrations: 0, checkins: 0, to_date: i === 3 })) },
    show_up: { available: true, events: 0, seats_taken: 0, confirmed: 0, attended: 0, rate: null },
    upcoming: { available: true, events: 0, seats_taken: 0, full: 0 },
    next_up: { available: true, total: 0, rows: [] },
    by_type: { available: true, counts: zeroTypes },
    waitlisted: { available: true, registrations: 0, events: 0 },
    by_status: { available: true, counts: { published: 1 } },
  });
  o.blocks.jobs = { available: true, applications: { window: 0, previous: 0 }, weekly: W.map((w, i) => ({ week: w, count: 0, to_date: i === 3 })),
    by_status: { draft: 0, pending_review: 0, published: 0, rejected: 0, closed: 0, other: 0 }, most_applied: [] };
  o.blocks.participation_by_role = { events: { available: true, by_role: zeroRoles, not_recorded: 0 }, jobs: { available: true, by_role: zeroRoles } };
  o.blocks.circles = { available: true, total: 0, published: 0, featured: 0, members_entered: { value: 0 }, by_type: {} };
  o.blocks.network = { available: true, by_kind_state: {} };
  o.blocks.wellbeing.experts = { available: true, verified: 0, unverified: 0, hidden: 0, inactive: 0 };
  o.blocks.wellbeing.bookings = { available: true, window: 0, previous: 0, weekly: W.map((w, i) => ({ week: w, count: 0, to_date: i === 3 })) };
  return o;
}

/** A genuinely empty Community: `quiet()` without its one event. */
function empty() {
  return put(quiet(), 'blocks.events.by_status.counts', { draft: 0, pending_review: 0, published: 0, rejected: 0, cancelled: 0, other: 0 });
}

// ---------------------------------------------------------------- the empty rule

test('D4820 the empty rule: every source read and holding nothing is an empty Community', () => {
  // Mutation checked: dropping the roster, experts or bookings clause from isEmptyCommunity → their "not empty" asserts fail.
  assert.equal(isEmptyCommunity({ overview: ok(empty()) }), true);
  for (const [path, value, why] of [
    ['blocks.events.by_status.counts.draft', 1, 'a draft event'],
    ['blocks.events.by_status.counts.cancelled', 1, 'a cancelled event'],
    ['blocks.jobs.by_status.closed', 1, 'a closed posting'],
    ['blocks.circles', { available: true, total: 1, published: 0, featured: 0, members_entered: { value: 0 }, by_type: { city: 1 } }, 'a draft circle'],
    ['blocks.network.by_kind_state', { partner: { active: 1, hidden: 0 } }, 'an active partner'],
    ['blocks.network.by_kind_state', { advisor: { active: 0, hidden: 1 } }, 'a hidden advisor'],
    ['blocks.wellbeing.experts.unverified', 1, 'an expert waiting for verification'],
    ['blocks.wellbeing.bookings.window', 1, 'a booking this period'],
    ['blocks.wellbeing.bookings.previous', 1, 'a booking in the period before'],
  ]) {
    assert.equal(isEmptyCommunity({ overview: ok(put(empty(), path, value)) }), false, `${why} was taken for an empty Community`);
  }
});

test('D4820 the empty rule: unreadable is never empty — a source that could not be read, or is not recorded, never makes Community empty', () => {
  // Mutation checked: isEmptyCommunity reading an unreadable block as zero (dropping the state check) → every assert here fails.
  for (const path of ['blocks.events.by_status', 'blocks.jobs', 'blocks.circles', 'blocks.network', 'blocks.wellbeing.experts', 'blocks.wellbeing.bookings']) {
    assert.equal(isEmptyCommunity({ overview: ok(put(empty(), path, UNREAD)) }), false, `${path} unreadable was taken for empty`);
    assert.equal(isEmptyCommunity({ overview: ok(put(empty(), path, UNRECORDED)) }), false, `${path} not recorded was taken for empty`);
  }
  // A count that is not a whole number is unreadable, so not empty.
  assert.equal(isEmptyCommunity({ overview: ok(put(empty(), 'blocks.wellbeing.bookings.window', '0')) }), false);
  assert.equal(isEmptyCommunity({ overview: ok(put(empty(), 'blocks.network.by_kind_state', { advisor: { active: 0 } })) }), false);
  assert.equal(isEmptyCommunity({ overview: { status: 'error', data: null } }), false, 'a failed read is an empty Community');
  assert.equal(isEmptyCommunity({ overview: { status: 'loading', data: null } }), false, 'a read not yet answered is an empty Community');
  assert.equal(isEmptyCommunity({}), false);
});

// ---------------------------------------------------------------- the four KPIs

test('D4820 the KPI row is four authoritative measures, in the canvas\'s order, and never Active members', () => {
  // Mutation checked: show-up put back in KPI_KEYS → the deepEqual fails.
  assert.deepEqual(KPI_KEYS, ['waiting', 'upcoming', 'registrations', 'applications']);
  const kpis = buildKpis({ overview: ok(full()) });
  assert.deepEqual(kpis.map((k) => k.label), ['Waiting on you', 'Upcoming events', 'Event registrations', 'Job applications']);
  assert.deepEqual(kpis.map((k) => [k.state, k.value]), [['ready', '4'], ['ready', '3'], ['ready', '60'], ['ready', '12']]);
  // Each still answers alone: one failed block costs only its KPI.
  const noJobs = buildKpis({ overview: ok(put(full(), 'blocks.jobs', UNREAD)) });
  assert.deepEqual(noJobs.map((k) => k.state), ['ready', 'ready', 'ready', 'unreadable']);
  assert.ok(!NOT_RECORDED.some((n) => KPI_KEYS.includes(n.key)), 'a figure no store records is a KPI');
});

// ---------------------------------------------------------------- Needs your attention

test('D4820 Needs your attention: Overdue first, at most five rows, the rest counted, and each row\'s Approvals reference', () => {
  const o = full();
  o.blocks.queue.event_rows.rows = [{ event_id: 21, title: 'Older Event', waiting_since: at(-60), from_created: false, waiting_hours: 60, overdue: false }];
  o.blocks.queue.jobs.review = [{ posting_id: 7, title: 'Overdue Posting', company: 'Example Co', waiting_since: at(-30), waiting_hours: 30, overdue: true }];
  o.blocks.queue.jobs.overdue = 1;
  const n = buildNeeds({ overview: ok(o) });
  // Mutation checked: the sort back to oldest first → Older Event leads and this fails.
  assert.deepEqual(n.rows.map((r) => [r.title, r.overdue]), [['Overdue Posting', true], ['Older Event', false]]);
  assert.deepEqual(n.rows.map((r) => [r.kind, r.ref]), [['Job', 7], ['Event', 21]]);
  assert.equal(n.more, 2, 'four wait in the queues and two are listed');
  assert.equal(n.clear, false);
  const many = full();
  many.blocks.queue.event_rows.rows = Array.from({ length: 8 }, (_, i) => ({ event_id: 100 + i, title: `Event ${i}`, waiting_since: at(-10 - i), from_created: false, waiting_hours: 10 + i, overdue: false }));
  many.blocks.queue.events.count = 8;
  many.blocks.queue.event_rows.total = 8;
  const m = buildNeeds({ overview: ok(many) });
  assert.equal(NEEDS_ROWS, 5);
  assert.equal(m.rows.length, 5);
  assert.equal(m.more, 10 - 5);
});

test('D4820 Needs your attention is clear only when both queues were read and count none', () => {
  // Mutation checked: `clear` without the evOk && jbOk guard → the unreadable-queue asserts fail.
  assert.equal(buildNeeds({ overview: ok(clearQueue(full())) }).clear, true);
  assert.equal(buildNeeds({ overview: ok(full()) }).clear, false);
  const half = clearQueue(full());
  half.blocks.queue.jobs = UNREAD;
  assert.equal(buildNeeds({ overview: ok(half) }).clear, false, 'a queue that could not be read was called clear');
  const rowsGone = clearQueue(full());
  rowsGone.blocks.queue.event_rows = UNREAD;
  assert.equal(buildNeeds({ overview: ok(rowsGone) }).clear, false);
});

// ---------------------------------------------------------------- the zero-data collapses, in the model

test('D4820 the zero-data rules collapse only what was read as nothing', () => {
  // Mutation checked: activityEmpty ignoring state → the unreadable assert fails; bookingsEmpty ignoring the weeks → the one-week assert fails.
  const q = { overview: ok(quiet()) };
  const f = { overview: ok(full()) };
  assert.equal(activityEmpty(buildActivity(q)), true);
  assert.equal(activityEmpty(buildActivity(f)), false);
  assert.equal(activityEmpty(buildActivity({ overview: { status: 'error', data: null } })), false);
  assert.equal(eventsEmpty(buildNextUp(q), buildEventsFunnel(q)), true);
  assert.equal(eventsEmpty(buildNextUp(f), buildEventsFunnel(f)), false);
  const qNextUnread = { overview: ok(put(quiet(), 'blocks.events.next_up', UNREAD)) };
  assert.equal(eventsEmpty(buildNextUp(qNextUnread), buildEventsFunnel(qNextUnread)), false, 'an unreadable Next up made Events empty');
  assert.equal(jobsEmpty(buildJobs(q)), true);
  assert.equal(jobsEmpty(buildJobs({ overview: ok(put(quiet(), 'blocks.jobs', UNREAD)) })), false);
  assert.equal(rosterEmpty(buildCircles(q).roster), true);
  assert.equal(rosterEmpty(buildCircles(f).roster), false);
  assert.equal(bookingsEmpty(buildWellbeing(q).bookings), true);
  const oneWeek = put(quiet(), 'blocks.wellbeing.bookings.weekly', quiet().week_starts.map((w, i) => ({ week: w, count: i === 1 ? 1 : 0 })));
  assert.equal(bookingsEmpty(buildWellbeing({ overview: ok(oneWeek) }).bookings), false);
});

// ---------------------------------------------------------------- mounted

function worker(answer) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json({ rows: [], as_of: at(0) });
    return json({});
  };
  return seen;
}

async function mount(answer) {
  const restore = installDocument();
  const original = globalThis.fetch;
  worker(answer);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4`] }, h(AdminCommunity))); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id, under = container) => walk(under).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    text: () => textOf(container),
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    within: (outer, id) => Boolean(byTestId(id, node(outer))),
    props: (id) => props(node(id)),
    ids: (outer) => walk(node(outer)).map((n) => props(n)?.['data-testid']).filter(Boolean),
    links: (outer) => walk(outer ? node(outer) : container).filter((n) => n.tagName === 'A').map((n) => ({ to: props(n)?.href, text: textOf(n), label: props(n)?.['aria-label'] })),
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted D4820: four KPI tiles, the moved figures in their own cards, and the queue directly under the KPIs', async () => {
  const m = await mount(full());
  try {
    // Mutation checked: rendering `tiles` (all eight) in the KPI row again → this deepEqual fails.
    assert.deepEqual(m.ids('community-tiles').filter((id) => id.startsWith('community-tile-') && !id.endsWith('-overdue')),
      ['community-tile-waiting', 'community-tile-upcoming', 'community-tile-registrations', 'community-tile-applications']);
    assert.doesNotMatch(m.of('community-tiles'), /Active members|Show-up|Published circles|Wellbeing experts/);
    assert.ok(m.within('community-card-events', 'community-figure-show-up'), 'show-up is not in Events');
    assert.ok(m.within('community-card-network', 'community-figure-circles'), 'published circles are not in Network');
    assert.ok(m.within('community-card-network', 'community-figure-roster'), 'the roster is not in Network');
    assert.ok(m.within('community-card-wellbeing', 'community-figure-experts'), 'the experts are not in Wellbeing');
    // Needs your attention, with one Review all, and no "Needs a decision" card later.
    assert.match(m.of('community-card-needs'), /^Needs your attention/);
    assert.match(m.of('community-needs-line'), /4 waiting · overdue first/);
    assert.equal(m.of('community-review-all'), 'Review all 4 in Approvals →');
    assert.doesNotMatch(m.text(), /Needs a decision/);
    const rows = m.links('community-needs').map((l) => l.to);
    assert.deepEqual(rows, ['/admin/approvals/items/events-9', '/admin/approvals/items/jobs-3']);
    assert.match(m.of('community-needs-more'), /\+ 2 more waiting in Approvals/);
  } finally { await m.unmount(); }
});

test('mounted D4820: with nothing waiting, the queue is one line', async () => {
  const m = await mount(clearQueue(full()));
  try {
    // Mutation checked: AttentionCard ignoring `clear` → the full card is drawn and the line is missing.
    assert.equal(m.of('community-queue-clear').replace('✓', ''), QUEUE_CLEAR);
    assert.equal(QUEUE_CLEAR, 'Nothing needs your attention · Approvals are currently clear.');
    assert.ok(!m.has('community-needs'));
    assert.ok(!m.has('community-review-all'));
  } finally { await m.unmount(); }
  const half = clearQueue(full());
  half.blocks.queue.jobs = UNREAD;
  const n = await mount(half);
  try {
    assert.ok(!n.has('community-queue-clear'), 'a queue that could not be read was called clear');
    assert.match(n.of('community-card-needs'), /job board could not be read, so only events and experts are listed/);
  } finally { await n.unmount(); }
});

test('mounted D4820: Manage Community is six destination rows, each one short line and Open', async () => {
  const m = await mount(full());
  try {
    assert.doesNotMatch(m.text(), /Consoles/);
    assert.match(m.text(), /Manage Community/);
    // Mutation checked: dropping the Partner invitations row → the ids and links asserts fail.
    assert.deepEqual(m.ids('community-manage').filter((id) => id.startsWith('community-manage-')), [
      'community-manage-events', 'community-manage-jobs', 'community-manage-circles',
      'community-manage-roster', 'community-manage-wellbeing', 'community-manage-partner-invitations',
    ]);
    assert.deepEqual(m.links('community-manage').map((l) => [l.to, l.text, l.label]), [
      ['/admin/events', 'Open →', 'Open Events'],
      ['/admin/jobs', 'Open →', 'Open Job board'],
      ['/admin/circles', 'Open →', 'Open Circles'],
      ['/admin/advisors-partners', 'Open →', 'Open Advisors & Partners'],
      ['/admin/wellbeing', 'Open →', 'Open Wellbeing'],
      ['/admin/partner-invitations', 'Open →', 'Open Partner invitations'],
    ]);
    assert.match(m.of('community-manage-events'), /Review, publish and run events.*2 to review/s);
    assert.doesNotMatch(m.of('community-manage-partner-invitations'), /\d/, 'a figure was invented for partner invitations');
  } finally { await m.unmount(); }
});

test('mounted D4820: the figures no store records are one Additional insights row that expands', async () => {
  const m = await mount(full());
  try {
    assert.equal(insightsLabel(NOT_RECORDED.length), 'Additional insights · 2 unavailable');
    assert.match(m.of('community-insights-toggle'), /^Additional insights · 2 unavailable/);
    assert.equal(m.props('community-insights-toggle')['aria-expanded'], false);
    // Mutation checked: rendering the list regardless of `open` → these two absent asserts fail.
    assert.ok(!m.has('community-unrecorded-active-members'));
    assert.ok(!m.has('community-unrecorded-circle-discussions'));
    await m.click('community-insights-toggle');
    assert.equal(m.props('community-insights-toggle')['aria-expanded'], true);
    assert.match(m.of('community-unrecorded-active-members'), /Active members.*Not recorded/s);
    assert.match(m.of('community-unrecorded-circle-discussions'), /Circle discussions.*Not recorded/s);
  } finally { await m.unmount(); }
});

test('mounted D4820: every domain has View details and Manage … →, and no See all or Open duplicates', async () => {
  const m = await mount(full());
  try {
    // Mutation checked: putting "See all events" back on the Events card → the doesNotMatch fails.
    assert.doesNotMatch(m.text(), /See all|Open events|Open job board|Open circles|Open wellbeing|Open advisors/);
    assert.match(m.of('community-open-events'), /^View details$/);
    assert.match(m.of('community-open-jobs'), /^View details$/);
    assert.match(m.of('community-open-circles'), /^View details$/);
    assert.match(m.of('community-open-activity'), /^View details$/);
    const manage = m.links().filter((l) => /^Manage .* →$/.test(l.text)).map((l) => [l.text, l.to]);
    assert.deepEqual(manage, [
      ['Manage events →', '/admin/events'],
      ['Manage jobs →', '/admin/jobs'],
      ['Manage circles →', '/admin/circles'],
      ['Manage advisors & partners →', '/admin/advisors-partners'],
      ['Manage wellbeing →', '/admin/wellbeing'],
    ]);
  } finally { await m.unmount(); }
});

test('mounted D4820 CM04a: a genuinely empty Community is Build your community, the clear line, Manage Community and one insights line', async () => {
  const m = await mount(empty());
  try {
    // Mutation checked: isEmptyCommunity always false → community-build is missing and the tiles are drawn.
    assert.match(m.of('community-build'), /Build your community/);
    assert.deepEqual(m.links('community-build').map((l) => [l.text, l.to]), [['Create an event', '/admin/events'], ['Create a circle', '/admin/circles']]);
    assert.ok(m.has('community-queue-clear'));
    assert.ok(m.has('community-manage'));
    assert.match(m.of('community-insights-toggle'), /^Activity analytics will appear once there is enough community activity · Additional insights · 2 unavailable/);
    for (const id of ['community-tiles', 'community-card-activity', 'community-card-events', 'community-card-jobs', 'community-card-network', 'community-card-wellbeing', 'community-card-who', 'community-funnel', 'community-by-type']) {
      assert.ok(!m.has(id), `${id} was drawn on an empty Community`);
    }
  } finally { await m.unmount(); }
  // One unreadable source: never claimed empty; the analytics and its failure are drawn.
  const n = await mount(put(empty(), 'blocks.network', UNREAD));
  try {
    assert.ok(!n.has('community-build'), 'an unreadable roster was taken for an empty Community');
    assert.ok(n.has('community-tiles'));
    assert.match(n.of('community-card-network'), /could not be read/);
  } finally { await n.unmount(); }
});

test('mounted D4820: zero-data modules collapse to one line instead of zero charts, funnels and distributions', async () => {
  const m = await mount(quiet());
  try {
    assert.ok(!m.has('community-build'), 'one published event is not an empty Community');
    // Mutation checked: ActivityCard ignoring activityEmpty → the chart is drawn and community-activity-empty is missing.
    assert.ok(m.has('community-activity-empty'));
    assert.ok(!m.has('community-activity-chart'));
    assert.ok(!m.has('community-activity-toggle'));
    assert.match(m.of('community-events-empty'), /No published or waiting event starts in the next 30 days, and none ended in these 4 weeks\./);
    assert.ok(!m.has('community-funnel'));
    assert.ok(!m.has('community-by-type'));
    assert.doesNotMatch(m.text(), /types with none/);
    assert.equal(m.of('community-jobs-empty'), 'No job postings yet.');
    assert.ok(!m.has('community-jobs-status'));
    assert.equal(m.of('community-network-empty'), 'No circles, advisors or partners have been added yet.');
    assert.ok(!m.has('community-circles-by-type') && !m.has('community-roster'));
    assert.equal(m.of('community-wellbeing-empty'), 'No wellbeing experts or bookings yet.');
    assert.ok(!m.has('community-bookings') && !m.has('community-experts'));
    // Check-ins are still a privacy range, never collapsed into a zero.
    assert.match(m.of('community-checkins'), /10 to 14 founders checked in/);
  } finally { await m.unmount(); }
});

test('the source: no "Show all" for event types, and Manage Community\'s doors are literal links', () => {
  const page = communityPageSource();
  assert.doesNotMatch(page, /types with none/);
  for (const to of ['/admin/events', '/admin/jobs', '/admin/circles', '/admin/advisors-partners', '/admin/wellbeing', '/admin/partner-invitations']) {
    assert.ok(page.includes(`<Link to="${to}"`), `${to} is not a literal Link`);
  }
});
