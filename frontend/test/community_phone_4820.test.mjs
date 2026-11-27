/**
 * D4820 (#4820) part 2 — Admin › Community on a phone (CM09) and the
 * lightboxes' Manage action (CM05, CM10a), built to the "Community v2" canvas.
 *
 * Two layers: the pure phone model (`model/phone.js`) on the worker-shaped
 * fixture (`_community_overview_fixture.mjs`, every record made up), then the
 * page mounted on a stubbed `fetch` with `matchMedia` answering phone or not.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_phone_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import {
  COMMUNITY_PATH, PHONE_NEEDS_ROWS, activitySummary, buildCircles, buildEventsFunnel, buildJobs, buildTiles, buildWellbeing,
  buildWho, moreRows, needsOnPhone, shortDelta,
} from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const ok = (data) => ({ status: 'ready', data });
const UNREAD = { available: false, unreadable: true, reason: 'This could not be read on this database. That is not the same as none.' };

function put(answer, path, value) {
  const o = structuredClone(answer);
  const keys = path.split('.');
  let n = o;
  for (const k of keys.slice(0, -1)) n = n[k];
  n[keys.at(-1)] = value;
  return o;
}

/** The page's own builders on one answer, as AdminCommunity hands them to the phone. */
function built(answer) {
  const reads = { overview: ok(answer) };
  const fig = Object.fromEntries(buildTiles(reads).map((t) => [t.key, t]));
  const circ = buildCircles(reads);
  return {
    ev: buildEventsFunnel(reads), showUp: fig['show-up'], who: buildWho(reads), jobs: buildJobs(reads), applications: fig.applications,
    circles: circ.circles, roster: circ.roster, wb: buildWellbeing(reads), weeks: answer.weeks,
  };
}
const lines = (answer) => Object.fromEntries(moreRows(built(answer)).map((r) => [r.key, [r.state, r.line]]));

// ---------------------------------------------------------------- the model

test('D4820 CM09 the phone queue is three rows, and the rest are counted from the queues\' own totals', () => {
  const rows = [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}` }));
  // Mutation checked: `more` left at the desktop's (total − 5) → 2 instead of 4, and this fails.
  const p = needsOnPhone({ state: 'ready', total: 7, rows, more: 2 });
  assert.equal(PHONE_NEEDS_ROWS, 3);
  assert.deepEqual(p.rows.map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.equal(p.more, 4);
  // Fewer rows than three: nothing is cut, and the rest is still the total less what is listed.
  assert.deepEqual(needsOnPhone({ state: 'ready', total: 4, rows: rows.slice(0, 2), more: 2 }).more, 2);
  // A queue that is not ready passes through untouched: it is never cut into a clear one.
  const unread = { state: 'unreadable', reason: 'x' };
  assert.equal(needsOnPhone(unread), unread);
});

test('D4820 CM09 shortDelta never invents a share from a zero', () => {
  assert.equal(shortDelta(60, 40), '+50%');
  assert.equal(shortDelta(9, 10), '−10%');
  assert.equal(shortDelta(5, 5), 'Same');
  // Mutation checked: dividing by a zero previous → "+Infinity%" and this fails.
  assert.equal(shortDelta(5, 0), 'None before');
  assert.equal(shortDelta(0, 0), 'None either period');
  assert.equal(shortDelta(Number.NaN, 1), null);
});

test('D4820 CM09 the activity summary: each series\' total and change, a missing week as n/r, an unreadable series as Unreadable', () => {
  assert.deepEqual(activitySummary({ overview: ok(full()) }).map((s) => [s.label, s.state, s.value, s.sub]), [
    ['Registrations', 'ready', '60', '+50%'],
    ['Applications', 'ready', '12', '+20%'],
    ['Bookings', 'ready', '7', '+250%'],
  ]);
  // A week the bookings block does not carry is a gap, said so, never a zero.
  const gap = full();
  gap.blocks.wellbeing.bookings.weekly = gap.blocks.wellbeing.bookings.weekly.filter((_, i) => i !== 1);
  // Mutation checked: dropping the gaps count from `sub` → "+250%" alone and this fails.
  assert.equal(activitySummary({ overview: ok(gap) })[2].sub, '+250% · 1 week n/r');
  // One unreadable source costs only its own series.
  const noJobs = activitySummary({ overview: ok(put(full(), 'blocks.jobs', UNREAD)) });
  assert.deepEqual(noJobs.map((s) => s.state), ['ready', 'unreadable', 'ready']);
  assert.equal(noJobs[1].value, undefined, 'an unreadable series has a value');
  // A total that is not a whole number is unreadable, never 0.
  assert.equal(activitySummary({ overview: ok(put(full(), 'blocks.events.weekly.registrations.window', '60')) })[0].state, 'unreadable');
  assert.deepEqual(activitySummary({ overview: { status: 'loading', data: null } }).map((s) => s.state), ['loading', 'loading', 'loading']);
});

test('D4820 CM09 More analytics: each row\'s line is written from the figures its card draws', () => {
  // Mutation checked: Who takes part over registrations only (parts[0]) → "Founders 75% of event registrations" and this fails.
  assert.deepEqual(lines(full()), {
    events: ['ready', '65% show-up · 9 waitlisted'],
    who: ['ready', 'Founders 67% of participation'],
    jobs: ['ready', '3 open jobs · 12 applications'],
    network: ['ready', '3 published circles · 3 active advisors & partners'],
    wellbeing: ['ready', '9 verified experts · 7 bookings'],
  });
  assert.deepEqual(moreRows(built(full())).map((r) => r.title), ['Events participation', 'Who takes part', 'Opportunities', 'Network', 'Wellbeing']);
});

test('D4820 CM09 More analytics: unreadable is never zero, and a half that could not be read says so', () => {
  const noJobs = lines(put(full(), 'blocks.jobs', UNREAD));
  // Mutation checked: notReady returning a zero line ("0 open jobs") → this fails.
  assert.deepEqual(noJobs.jobs, ['unreadable', 'Unreadable']);
  const noCircles = lines(put(full(), 'blocks.circles', UNREAD));
  assert.deepEqual(noCircles.network, ['ready', 'circles unreadable · 3 active advisors & partners']);
  const noBookings = lines(put(full(), 'blocks.wellbeing.bookings', UNREAD));
  assert.deepEqual(noBookings.wellbeing, ['ready', '9 verified experts · bookings unreadable']);
  const neither = lines(put(put(full(), 'blocks.wellbeing.bookings', UNREAD), 'blocks.wellbeing.experts', UNREAD));
  assert.deepEqual(neither.wellbeing, ['unreadable', 'Unreadable']);
  const noShowUp = lines(put(full(), 'blocks.events.show_up', UNREAD));
  assert.deepEqual(noShowUp.events, ['unreadable', 'Unreadable']);
  const noWait = lines(put(full(), 'blocks.events.waitlisted', UNREAD));
  assert.deepEqual(noWait.events, ['ready', '65% show-up · waitlist unreadable']);
});

test('D4820 CM09 More analytics: a module that holds nothing says so in words, not zeros', () => {
  const o = full();
  o.blocks.events.show_up = { available: true, events: 0, seats_taken: 0, confirmed: 0, attended: 0, rate: null };
  o.blocks.jobs.by_status = { draft: 0, pending_review: 0, published: 0, rejected: 0, closed: 0, other: 0 };
  o.blocks.jobs.most_applied = [];
  o.blocks.circles = { available: true, total: 0, published: 0, featured: 0, members_entered: { value: 0 }, by_type: {} };
  o.blocks.network = { available: true, by_kind_state: {} };
  o.blocks.wellbeing.experts = { available: true, verified: 0, unverified: 0, hidden: 0, inactive: 0 };
  o.blocks.wellbeing.bookings = { available: true, window: 0, previous: 0, weekly: o.week_starts.map((w) => ({ week: w, count: 0 })) };
  const l = lines(o);
  assert.deepEqual(l.events, ['ready', 'No event ended in these 4 weeks']);
  assert.deepEqual(l.jobs, ['ready', 'No job postings yet']);
  assert.deepEqual(l.network, ['ready', 'No circles, advisors or partners yet']);
  assert.deepEqual(l.wellbeing, ['ready', 'No wellbeing experts or bookings yet']);
});

// ---------------------------------------------------------------- mounted

async function mount(answer, { phone }) {
  const restore = installDocument();
  const original = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json({ rows: [], as_of: at(0) });
    return json({});
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
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
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    within: (outer, id) => Boolean(byTestId(id, node(outer))),
    props: (id) => props(node(id)),
    ids: (outer) => walk(node(outer)).map((n) => props(n)?.['data-testid']).filter(Boolean),
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original.fetch; globalThis.matchMedia = original.matchMedia; restore(); },
  };
}

test('mounted D4820 CM09: a phone has its own hierarchy, in the canvas\'s order', async () => {
  const m = await mount(full(), { phone: true });
  try {
    assert.ok(m.has('community-phone'));
    const ids = m.ids('admin-community-page');
    const order = ['community-tiles', 'community-card-needs', 'community-phone-next', 'community-card-activity', 'community-phone-more',
      'community-card-recent', 'community-manage', 'community-additional-insights'];
    // Mutation checked: Additional insights left above Manage Community on a phone → the order fails.
    assert.deepEqual(order.map((id) => ids.indexOf(id)), [...order.map((id) => ids.indexOf(id))].sort((a, b) => a - b), 'the phone order');
    assert.ok(order.every((id) => ids.includes(id)), `missing ${order.filter((id) => !ids.includes(id))}`);
    // The desktop's secondary cards are not drawn until their row is opened.
    for (const id of ['community-card-events', 'community-card-who', 'community-card-jobs', 'community-card-network', 'community-card-wellbeing']) {
      assert.ok(!m.has(id), `${id} is drawn on a closed phone dashboard`);
    }
    assert.deepEqual(m.ids('community-tiles').filter((id) => id.startsWith('community-tile-') && !id.endsWith('-overdue')),
      ['community-tile-waiting', 'community-tile-upcoming', 'community-tile-registrations', 'community-tile-applications']);
    // The next event, with View details and Manage events →.
    assert.match(m.of('community-phone-next-row'), /^Demo Day/);
    assert.match(m.of('community-phone-next'), /3 upcoming · next 30 days/);
    assert.ok(m.within('community-phone-next', 'community-open-events'));
  } finally { await m.unmount(); }
});

test('mounted D4820 CM09: the activity summary in place of the chart, and View chart opens it', async () => {
  const m = await mount(full(), { phone: true });
  try {
    assert.match(m.of('community-phone-activity-registrations'), /Registrations60\+50%/);
    // Mutation checked: drawing the chart on a closed summary → this fails.
    assert.ok(!m.has('community-activity-chart'), 'the chart is drawn before View chart');
    assert.equal(m.props('community-phone-view-chart')['aria-expanded'], false);
    await m.click('community-phone-view-chart');
    assert.ok(m.has('community-activity-chart'));
    assert.equal(m.props('community-phone-view-chart')['aria-expanded'], true);
    assert.equal(m.of('community-phone-view-chart'), 'Hide chart');
  } finally { await m.unmount(); }
});

test('mounted D4820 CM09: More analytics rows open their card, one at a time or together', async () => {
  const m = await mount(full(), { phone: true });
  try {
    assert.equal(m.of('community-more-who-line'), 'Founders 67% of participation');
    assert.equal(m.props('community-more-who')['aria-expanded'], false);
    await m.click('community-more-who');
    assert.equal(m.props('community-more-who')['aria-expanded'], true);
    assert.ok(m.within('community-phone-more', 'community-card-who'));
    await m.click('community-more-events');
    assert.ok(m.within('community-phone-more', 'community-funnel'), 'Events participation opened no funnel');
    assert.ok(m.has('community-card-who'), 'opening one row closed another');
  } finally { await m.unmount(); }
});

test('mounted D4820 CM09: phone controls are 44px', async () => {
  const m = await mount(full(), { phone: true });
  try {
    // Mutation checked: removing max-md:min-h-[44px] from the period buttons → this fails.
    for (const id of ['community-period-4', 'community-period-12', 'community-period-52', 'community-more-who', 'community-phone-view-chart', 'community-insights-toggle']) {
      assert.match(m.props(id).className, /(max-md:min-h-\[44px\]|min-h-\[4[48]px\])/, `${id} is under 44px on a phone`);
    }
    assert.match(m.props('community-refresh').className, /max-md:h-11/);
  } finally { await m.unmount(); }
});

test('mounted D4820: a desktop is not the phone hierarchy', async () => {
  const m = await mount(full(), { phone: false });
  try {
    assert.ok(!m.has('community-phone'));
    assert.ok(m.has('community-card-events') && m.has('community-card-network'));
    const ids = m.ids('admin-community-page');
    assert.ok(ids.indexOf('community-additional-insights') < ids.indexOf('community-manage'), 'CM01 puts Additional insights above Manage Community');
  } finally { await m.unmount(); }
});
