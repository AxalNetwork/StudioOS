/**
 * D4820 (#4820) part 5 — the Activity lightbox (CM08): kind chips with the
 * read's own counts (`by_kind`, shown only while the dates and search match),
 * and rows grouped by UTC day with the time first and an Open › link. No
 * member is named. Every record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_activity_box_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { full } from './_community_overview_fixture.mjs';
import { COMMUNITY_PATH } from '../src/pages/admin/community/communityModel.js';
import { activityKindCounts, activityPage, dayHeading, groupsOf } from '../src/pages/admin/community/lightboxModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const row = (o) => ({ kind: 'events', actor: 'admin', icon: '◆', sentence: 'An admin published “Demo Night”.', title: 'Demo Night', href: '/admin/events', at: '2026-11-09T11:42:00.000Z', ...o });
const ROWS = [
  row({}),
  row({ kind: 'jobs', sentence: '“Ops Lead” was closed.', href: '/admin/jobs', at: '2026-11-09T08:05:00.000Z', dated_by: 'last_change' }),
  row({ icon: '#', sentence: '3 registrations for “Demo Night” on 2026-11-08.', at: '2026-11-08T00:00:00.000Z', count: 3 }),
  row({ kind: 'circles', sentence: 'An admin published “Climate Founders”.', href: '/admin/circles', at: '2026-11-02T10:00:00.000Z' }),
];
const answer = (o = {}) => ({ rows: ROWS, total: 4, limit: 25, offset: 0, sources: [], unreadable: [], by_kind: { events: 2, jobs: 1, circles: 1, wellbeing: 0 }, ...o });

// ---------------------------------------------------------------- the model

test('D4820 part 5: the chips\' counts are the read\'s own, and nothing the Worker did not send', () => {
  assert.deepEqual(activityKindCounts(answer()), { all: 4, events: 2, jobs: 1, circles: 1, wellbeing: 0, admin: null });
  // A chosen kind's answer carries no by_kind: no count at all, never zeros.
  // Mutation checked: `all` read from total without by_kind → 4 here and this fails.
  assert.deepEqual(activityKindCounts(answer({ by_kind: undefined })), { all: null, events: null, jobs: null, circles: null, wellbeing: null, admin: null });
  // A kind whose source failed is null; an odd count is null too.
  assert.equal(activityKindCounts(answer({ by_kind: { events: null, jobs: 1, circles: '1', wellbeing: -1 } })).events, null);
  assert.equal(activityKindCounts(answer({ by_kind: { events: null, jobs: 1, circles: '1', wellbeing: -1 } })).circles, null);
  assert.equal(activityKindCounts(answer({ by_kind: { events: null, jobs: 1, circles: '1', wellbeing: -1 } })).wellbeing, null);
});

test('D4820 part 5: rows group by UTC day, newest first, with the time first; a day\'s count has no time', () => {
  const page = activityPage(answer(), 1);
  assert.deepEqual(page.groups.map((g) => [g.day, g.rows.length]), [['2026-11-09', 2], ['2026-11-08', 1], ['2026-11-02', 1]]);
  // Mutation checked: the count row given its midnight time → '00:00' and this fails.
  assert.deepEqual(page.rows.map((r) => [r.time, r.kind]), [['11:42', 'Event'], ['08:05', 'Job'], ['All day', 'Event'], ['10:00', 'Circle']]);
  assert.deepEqual(['2026-11-09', '2026-11-08', '2026-11-02', null].map((d) => dayHeading(d, NOW)), ['Today', 'Yesterday', 'Mon 2 Nov', 'Date not recorded']);
  // Rows of one day split by another stay in the read's order, never re-sorted.
  assert.deepEqual(groupsOf([{ day: 'a' }, { day: 'b' }, { day: 'a' }]).map((g) => g.day), ['a', 'b', 'a']);
});

// ---------------------------------------------------------------- mounted

async function mount(handle) {
  const restore = installDocument();
  // The lightbox labels days from Date.now(); pin it to the fixture's NOW so "Today" is the fixture's day,
  // whatever day the suite runs on.
  const realNow = Date.now;
  Date.now = () => NOW;
  const original = globalThis.fetch;
  const seen = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    if (u.pathname === '/api/admin/community/overview') return json(full());
    if (u.pathname === '/api/admin/community/activity') return json(handle(u.searchParams));
    return json({});
  };
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    n.querySelector = () => null;
    n.querySelectorAll = () => [];
    return n;
  };
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4&open=activity`] }, h(AdminCommunity))); });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const all = (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = all(id)[0]; assert.ok(n, `no ${id}`); return n; };
  return {
    seen,
    has: (id) => all(id).length > 0,
    of: (id) => textOf(node(id)),
    each: (id) => all(id).map(textOf),
    props: (id) => props(node(id)),
    active: () => props(document.activeElement)?.['data-testid'],
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async key(id, key) { await act(async () => { props(node(id)).onKeyDown({ key, preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { props(node(id)).onChange({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; Date.now = realNow; restore(); },
  };
}

/** The read: `by_kind` only when no kind is chosen, as the Worker sends it. */
const worker = (p) => (p.get('kind') ? answer({ by_kind: undefined, rows: ROWS.filter((r) => r.kind === p.get('kind')), total: 1 }) : answer());

test('mounted D4820 part 5: the chips carry the read\'s counts, Admin actions none, and choosing one keeps them', async () => {
  const m = await mount(worker);
  try {
    assert.equal(m.of('community-box-activity-chip-all-count'), '4');
    assert.equal(m.of('community-box-activity-chip-events-count'), '2');
    assert.equal(m.of('community-box-activity-chip-wellbeing-count'), '0', 'a counted zero is drawn');
    assert.ok(!m.has('community-box-activity-chip-admin-count'), 'Admin actions is not counted by the read');
    assert.equal(m.props('community-box-activity-chip-all')['aria-checked'], true);
    await m.click('community-box-activity-chip-jobs');
    assert.match(m.seen.at(-1), /kind=jobs/);
    // The jobs read sends no by_kind; the counts stay those of the same dates and search.
    assert.equal(m.of('community-box-activity-chip-events-count'), '2');
    assert.equal(m.props('community-box-activity-chip-jobs')['aria-checked'], true);
  } finally { await m.unmount(); }
});

test('mounted D4820 part 5: a new search with a kind chosen hides the counts rather than show stale ones', async () => {
  const m = await mount(worker);
  try {
    await m.click('community-box-activity-chip-jobs');
    await m.change('community-box-activity-search', 'Ops');
    await new Promise((r) => setTimeout(r, 450));
    await m.click('community-box-activity-chip-jobs');
    // Mutation checked: showing `counts.n` whatever its scope → the old '2' stays and this fails.
    assert.ok(!m.has('community-box-activity-chip-events-count'), 'a count for other dates or search is drawn');
  } finally { await m.unmount(); }
});

test('mounted D4820 part 5: rows are grouped by day, time first, each with Open ›, and no member is named', async () => {
  const m = await mount(worker);
  try {
    assert.deepEqual(m.each('community-box-activity-day').map((t) => t.split(/\d{2}:\d{2}|All day/)[0]), ['Today', 'Yesterday', 'Mon 2 Nov']);
    const rows = m.each('community-box-activity-row');
    assert.match(rows[0], /^11:42.*Event.*An admin published “Demo Night”\..*Open ›/s);
    assert.match(rows[1], /^08:05.*Job.*“Ops Lead” was closed\..*Last change.*Open ›/s);
    assert.match(rows[2], /^All day.*3 registrations/s);
    assert.doesNotMatch(rows.join('\n'), /\bmember\b/);
  } finally { await m.unmount(); }
});

test('mounted D4820 part 5: the chips are a radio group with arrow keys that wrap and take focus', async () => {
  const m = await mount(worker);
  try {
    // Mutation checked: no wrap on ArrowLeft → the read stays on All and this fails.
    await m.key('community-box-activity-chips', 'ArrowLeft');
    assert.equal(m.props('community-box-activity-chip-admin')['aria-checked'], true);
    assert.equal(m.active(), 'community-box-activity-chip-admin');
    assert.match(m.seen.at(-1), /kind=admin/);
    await m.key('community-box-activity-chips', 'Home');
    assert.equal(m.props('community-box-activity-chip-all')['aria-checked'], true);
  } finally { await m.unmount(); }
});
