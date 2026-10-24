/**
 * D930 (#2367) — Admin › Community at /admin/community, the integration of the
 * owner's "Community overview" canvas (CM1–CM13): the address and its moved
 * notice, the shell, and the blocks whose reads exist, each drawn truthfully.
 *
 * Three layers:
 *   - the pure model (`communityModel.js`) on fixtures worked out by hand;
 *   - the page mounted on a stubbed `fetch`, so every read goes through the
 *     real client to a URL, and each one can fail alone;
 *   - the source: the routes, and the reads the page must never make.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_community_d930.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  COMMUNITY_PATH, MOVED_KEY, MOVED_NOTICE, NOT_YET, PAGE_UNREADABLE,
  buildCircles, buildConsoles, buildJobs, buildNeeds, buildNextUp, buildTiles,
  isEmptyCommunity, pageFailed, readAllPages, seatsRead, seatsText, upcomingEvents,
} from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';
import HeldCommunityRedirect from '../src/pages/admin/community/HeldCommunityRedirect.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (days) => new Date(NOW + days * 86_400_000).toISOString();
const ok = (data) => ({ status: 'ready', data });
const bad = { status: 'error', data: null };

// ---------------------------------------------------------------- fixtures

const GLANCE = { approvals: { kind: 'ready', lanes: [{ key: 'events', count: 4 }, { key: 'jobs', count: 3 }, { key: 'lp', count: 9 }] } };
const EVENTS = [
  { id: 1, title: 'Founder Breakfast', status: 'published', starts_at: at(2), capacity: 60, timezone: 'UTC', created_at: at(-20) },
  { id: 2, title: 'Open Lab', status: 'published', starts_at: at(10), capacity: null, timezone: 'UTC', created_at: at(-10) },
  { id: 3, title: 'Pricing Clinic', status: 'pending_review', starts_at: at(5), capacity: 20, timezone: 'UTC', created_at: at(-3) },
  { id: 4, title: 'Far Away Summit', status: 'published', starts_at: at(45), capacity: 100, timezone: 'UTC', created_at: at(-30) },
  { id: 5, title: 'Last Week Social', status: 'published', starts_at: at(-7), capacity: 30, timezone: 'UTC', created_at: at(-40) },
  // A draft and a cancelled event inside the window: neither counts as upcoming.
  { id: 6, title: 'Draft Dinner', status: 'draft', starts_at: at(3), capacity: 10, timezone: 'UTC', created_at: at(-2) },
  { id: 7, title: 'Cancelled Talk', status: 'cancelled', starts_at: at(4), capacity: 10, timezone: 'UTC', created_at: at(-2) },
];
const ANALYTICS = { summary: null, unreadable: [], events: [
  { id: 1, registrations: 42 }, { id: 2, registrations: 12 }, { id: 3, registrations: 5 }, { id: 4, registrations: 7 }, { id: 5, registrations: 30 },
] };
const JOBS = [
  { id: 11, title: 'Backend Engineer', project_name: 'Northwind Labs', status: 'published', application_count: 14, created_at: at(-21) },
  { id: 12, title: 'Head of Growth', project_name: 'Bluefern Health', status: 'published', application_count: 11, created_at: at(-18) },
  { id: 13, title: 'Founding Engineer', project_name: 'Northwind Labs', status: 'pending_review', application_count: 0, created_at: at(-4) },
  { id: 14, title: 'Finance Lead', project_name: null, status: 'pending_review', application_count: 0, created_at: at(-1) },
  { id: 15, title: 'Old Role', project_name: 'Harbor', status: 'closed', application_count: 2, created_at: at(-90) },
  { id: 16, title: 'Draft Role', project_name: 'Harbor', status: 'draft', application_count: 0, created_at: at(-2) },
];
const CIRCLES = [
  { id: 1, type: 'founder', published: true, featured: true, members: 120 },
  { id: 2, type: 'founder', published: true, featured: false, members: 80 },
  { id: 3, type: 'city', published: false, featured: false, members: 0 },
  { id: 4, type: 'topic', published: true, featured: true, members: 12 },
];
const ROSTER = [
  { kind: 'advisor', is_active: true }, { kind: 'mentor', is_active: true }, { kind: 'advisor', is_active: false },
  { kind: 'partner', is_active: true }, { kind: 'investor', is_active: false },
];
const ALL = { glance: ok(GLANCE), events: ok(EVENTS), analytics: ok(ANALYTICS), jobs: ok(JOBS), circles: ok(CIRCLES), roster: ok(ROSTER) };
const tile = (tiles, key) => tiles.find((t) => t.key === key);

// ---------------------------------------------------------------- the model

test('Waiting on you adds the glance\'s events and jobs lanes, and never claims how long they waited', () => {
  const t = tile(buildTiles(ALL, NOW), 'waiting');
  assert.equal(t.state, 'ready');
  assert.equal(t.value, '7');
  assert.equal(t.sub, '4 events · 3 jobs');
  assert.match(t.note, /not recorded yet/);
  // A lane that failed is a missing total, never a partial sum.
  const failedLane = { ...ALL, glance: ok({ approvals: { lanes: [{ key: 'events', count: null }, { key: 'jobs', count: 3 }] } }) };
  assert.equal(tile(buildTiles(failedLane, NOW), 'waiting').state, 'unreadable');
  assert.equal(tile(buildTiles({ ...ALL, glance: bad }, NOW), 'waiting').state, 'unreadable');
});

test('next 30 days is published or waiting, from now on, the Events desk\'s rule (D915)', () => {
  assert.deepEqual(upcomingEvents(EVENTS, NOW).map((e) => e.id), [1, 3, 2]);
  const t = tile(buildTiles(ALL, NOW), 'upcoming');
  assert.equal(t.value, '3');
  assert.equal(t.sub, 'next 30 days · 59 registered');
});

test('Guard G: seats are drawn only when the analytics rows can be trusted, and a missing event is not a zero', () => {
  assert.equal(seatsRead(ok({ events: null, unreadable: ['events'] }), EVENTS).state, 'unreadable');
  assert.equal(seatsRead(ok({ events: [], unreadable: [] }), EVENTS).state, 'unreadable', 'events but no rows is the old zero shape');
  assert.equal(seatsRead(bad, EVENTS).state, 'unreadable');
  assert.equal(seatsRead(ok({ events: [], unreadable: [] }), []).state, 'ready', 'no events and no rows is a real empty');
  const seats = seatsRead(ok({ events: [{ id: 1, registrations: 42 }], unreadable: [] }), EVENTS);
  assert.equal(seatsText(seats, EVENTS[1]).text, 'Not in this read');
  assert.equal(seatsText(seats, EVENTS[0]).text, '42 / 60');
  assert.equal(seatsText(seatsRead(ok(ANALYTICS), EVENTS), EVENTS[1]).text, 'No cap · 12 registered');
  const tiles = buildTiles({ ...ALL, analytics: ok({ events: [{ id: 1, registrations: 42 }], unreadable: [] }) }, NOW);
  assert.equal(tile(tiles, 'upcoming').sub, 'next 30 days · registered: not in this read');
  assert.equal(tile(buildTiles({ ...ALL, analytics: bad }, NOW), 'upcoming').sub, 'next 30 days · registered: could not be read');
});

test('Next up is the three soonest published events, each with its seats', () => {
  const n = buildNextUp(ALL, NOW);
  assert.deepEqual(n.rows.map((r) => [r.title, r.seats.text]), [['Founder Breakfast', '42 / 60'], ['Open Lab', 'No cap · 12 registered']]);
});

test('the figures with no read yet say so, never a zero', () => {
  const tiles = buildTiles(ALL, NOW);
  for (const key of ['registrations', 'applications', 'show-up', 'experts']) {
    assert.equal(tile(tiles, key).state, 'notyet', key);
    assert.ok(tile(tiles, key).reason.length > 20, key);
    assert.equal(tile(tiles, key).value, undefined, key);
  }
  assert.equal(buildConsoles(ALL).wellbeing.state, 'notyet');
});

test('Jobs: postings by status in the canvas\'s order, and the five with most applications', () => {
  const j = buildJobs(ALL);
  assert.deepEqual(j.parts.map((p) => [p.label, p.value]), [['Published', 2], ['Pending review', 2], ['Draft', 1], ['Closed', 1], ['Rejected', 0]]);
  assert.deepEqual(j.most.map((m) => [m.title, m.applications]), [['Backend Engineer', 14], ['Head of Growth', 11], ['Old Role', 2]]);
  assert.equal(buildJobs({ ...ALL, jobs: bad }).state, 'unreadable');
});

test('Circles count as stored, members are as entered, and a legacy mentor is an Advisor', () => {
  const c = buildCircles(ALL);
  assert.deepEqual(c.circles.byType, [{ label: 'Founder', value: 2 }, { label: 'City', value: 1 }, { label: 'Topic', value: 1 }]);
  assert.deepEqual([c.circles.published, c.circles.draft, c.circles.featured, c.circles.membersEntered], [3, 1, 2, 212]);
  assert.deepEqual(c.roster.rows, [
    { label: 'Advisor', active: 2, inactive: 1 }, { label: 'Partner', active: 1, inactive: 0 }, { label: 'Investor', active: 0, inactive: 1 },
  ]);
  assert.equal(tile(buildTiles(ALL, NOW), 'circles').value, '3 of 4');
  assert.equal(tile(buildTiles(ALL, NOW), 'roster').value, '3');
});

test('Needs a decision: waiting events and jobs, oldest created first, and a half that failed says so', () => {
  const n = buildNeeds(ALL);
  assert.deepEqual(n.rows.map((r) => `${r.kind} ${r.title}`), ['Job Founding Engineer', 'Event Pricing Clinic', 'Job Finance Lead']);
  assert.equal(n.total, 3);
  const half = buildNeeds({ ...ALL, jobs: bad });
  assert.deepEqual(half.rows.map((r) => r.title), ['Pricing Clinic']);
  assert.match(half.partial, /job board could not be read/);
  assert.equal(buildNeeds({ ...ALL, jobs: bad, events: bad }).state, 'unreadable');
});

test('the whole page fails only when every read failed; an empty studio is real zeros', () => {
  const none = Object.fromEntries(Object.keys(ALL).map((k) => [k, bad]));
  assert.equal(pageFailed(none), true);
  assert.equal(pageFailed({ ...none, circles: ok([]) }), false);
  const noRows = ok({ events: [], unreadable: [] });
  assert.equal(isEmptyCommunity({ ...ALL, analytics: noRows, events: ok([]), jobs: ok([]), circles: ok([]) }), true);
  assert.equal(isEmptyCommunity({ ...ALL, events: ok([]), jobs: ok([]), circles: ok([]) }), false, 'drafts or cancelled events in the analytics rows are not an empty studio');
  assert.equal(isEmptyCommunity({ ...ALL, events: ok([]), jobs: bad, circles: ok([]) }), false, 'a failed read is not an empty studio');
});

test('every page of a list is read, and a list too long to count is refused', async () => {
  const pages = [];
  const rows = await readAllPages(async (offset) => { pages.push(offset); return { jobs: Array.from({ length: offset === 0 ? 200 : 3 }, (_, i) => i) }; }, 'jobs');
  assert.deepEqual(pages, [0, 200]);
  assert.equal(rows.length, 203);
  await assert.rejects(readAllPages(async () => ({ jobs: Array(200).fill(0) }), 'jobs', { maxPages: 2 }), /not counted here/);
  await assert.rejects(readAllPages(async () => ({}), 'jobs'), /not returned/);
});

// ---------------------------------------------------------------- the page, mounted

const ROSTER_ROWS = [
  { id: 1, name: 'Secret Roster Name', kind: 'advisor', is_active: 1, company: 'Hidden Co' },
  { id: 2, name: 'Another Hidden Person', kind: 'mentor', is_active: 0 },
];

/** A stubbed Worker. `fail` names reads that answer 503. */
function worker(fail = []) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    const p = u.pathname;
    const down = (name) => fail.includes(name);
    if (p === '/api/admin/studio/glance') return down('glance') ? json({ detail: 'down' }, 503) : json({ tier: 'hq', approvals: { label: 'HQ', lanes: [{ key: 'events', label: 'Events', count: 1 }, { key: 'jobs', label: 'Jobs', count: 1 }], pending_total: 2 } });
    if (p === '/api/admin/events/analytics') return down('analytics') ? json({ detail: 'down' }, 503) : json(ANALYTICS);
    if (p === '/api/admin/events') {
      if (down('events')) return json({ detail: 'down' }, 503);
      const status = u.searchParams.get('status');
      return json({ events: EVENTS.filter((e) => e.status === status) });
    }
    if (p === '/api/admin/jobs') return down('jobs') ? json({ detail: 'down' }, 503) : json({ jobs: JOBS });
    if (p === '/api/admin/circles') return down('circles') ? json({ detail: 'down' }, 503) : json({ circles: CIRCLES });
    if (p === '/api/admin/network-profiles') return down('roster') ? json({ detail: 'down' }, 503) : json({ profiles: ROSTER_ROWS, count: 2 });
    return json({});
  };
  return seen;
}

async function mount(url, fail) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = worker(fail);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminCommunity))); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  // React writes a lone text child as the element's own textContent, so read that when there are no child nodes.
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen,
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    links: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n)?.href),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted: each block is drawn from its own read, and no roster name reaches the page', async () => {
  const m = await mount(COMMUNITY_PATH);
  try {
    assert.match(m.of('community-tile-waiting'), /2.*1 events · 1 jobs.*Open Approvals/s);
    assert.match(m.of('community-tile-circles'), /3 of 4/);
    assert.match(m.of('community-tile-roster'), /1.*active on the roster/s);
    assert.match(m.of('community-tile-registrations'), new RegExp(NOT_YET));
    assert.match(m.of('community-card-jobs'), /Backend Engineer.*14 applications/s);
    assert.match(m.of('community-circle-counts'), /3 published · 1 draft · 2 featured/);
    assert.match(m.of('community-members-entered'), /212.*As entered/s);
    assert.match(m.of('community-needs'), /Founding Engineer/);
    assert.match(m.of('community-unrecorded-active-members'), /Not recorded/);
    assert.doesNotMatch(m.text(), /Secret Roster Name|Another Hidden Person|Hidden Co/, 'a roster name reached the page');
    assert.ok(!m.has('community-moved'));
    // Every read the page made, by path. The wellbeing reads are not among them.
    // The rail makes its own /api/ai* reads; those are its, not the page's.
    const paths = new Set(m.seen.map((s) => s.split('?')[0]).filter((p) => !/^\/api\/ai(-budget)?\//.test(p)));
    assert.ok(!m.seen.some((s) => s.startsWith('/api/wellbeing')), 'the page read a wellbeing route');
    assert.deepEqual([...paths].sort(), ['/api/admin/circles', '/api/admin/events', '/api/admin/events/analytics', '/api/admin/jobs', '/api/admin/network-profiles', '/api/admin/studio/glance']);
    assert.ok(m.seen.includes('/api/admin/events?status=published&limit=200&offset=0'));
    assert.ok(m.seen.includes('/api/admin/events?status=pending_review&limit=200&offset=0'));
  } finally { await m.unmount(); }
});

test('mounted CM10a: the job board failing costs only its blocks, and says it is not zero', async () => {
  const m = await mount(COMMUNITY_PATH, ['jobs']);
  try {
    assert.match(m.of('community-card-jobs'), /The job board could not be read\. That is not the same as no jobs\./);
    assert.match(m.of('community-tile-circles'), /3 of 4/, 'another block stopped answering');
    assert.match(m.of('community-card-needs'), /job board could not be read, so only events are listed/);
    assert.ok(!m.has('community-unreadable'));
  } finally { await m.unmount(); }
});

test('mounted CM10b: every read failed — the banner says nothing is a zero, and every console door still works', async () => {
  const m = await mount(COMMUNITY_PATH, ['glance', 'events', 'analytics', 'jobs', 'circles', 'roster']);
  try {
    assert.match(m.of('community-unreadable'), new RegExp(PAGE_UNREADABLE.replace('.', '\\.')));
    assert.ok(!m.has('community-tiles'), 'tiles drawn under a page that could not be read');
    for (const to of ['/admin/events', '/admin/jobs', '/admin/circles', '/admin?tab=network-profiles', '/admin?tab=wellbeing']) {
      assert.ok(m.links().includes(to), `the consoles strip lost ${to}`);
    }
  } finally { await m.unmount(); }
});

test('mounted CM13: the moved notice shows only after the redirect', async () => {
  const m = await mount(`${COMMUNITY_PATH}?moved=${MOVED_KEY}`);
  try { assert.match(m.of('community-moved'), new RegExp(MOVED_NOTICE.replace('.', '\\.'))); } finally { await m.unmount(); }
});

test('the old address keeps its query and hash and adds the moved key', async () => {
  const restore = installDocument();
  let landed = null;
  function Spy() { const l = useLocation(); landed = `${l.pathname}${l.search}${l.hash}`; return null; }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/admin/held/community?x=1#top'] },
      h(Routes, null,
        h(Route, { path: '/admin/held/community', element: h(HeldCommunityRedirect) }),
        h(Route, { path: '/admin/community', element: h(Spy) }))));
  });
  await act(async () => root.unmount());
  restore();
  assert.equal(landed, `/admin/community?x=1&moved=${MOVED_KEY}#top`);
});

// ---------------------------------------------------------------- the source

test('the routes, the row and the reads the page must never make', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/community" element=\{guard\(\['admin'\], <AdminCommunity \/>\)\} \/>/);
  assert.match(app, /<Route path="\/admin\/held\/community" element=\{<HeldCommunityRedirect \/>\} \/>/);
  assert.match(read('frontend/src/sidebarConfig.js'), /\{ to: '\/admin\/community', icon: Network, label: 'Community'/);
  const page = read('frontend/src/pages/admin/community/AdminCommunity.jsx');
  // The aggregate decrypts members' answers to average them; the experts read caps at 50 and counts samples (D930 §2).
  assert.doesNotMatch(page, /wellbeingAggregate|wellbeingExperts|\/wellbeing\//, 'the page reads a wellbeing route');
  // The roster read keeps the kind and whether a row is active, and nothing else: no name leaves it.
  assert.match(page, /a\.profiles\.map\(\(p\) => \(\{ kind: p\.kind, is_active: Boolean\(p\.is_active\) \}\)\)/);
  // The analytics summary is all time; nothing here reads it.
  assert.doesNotMatch(read('frontend/src/pages/admin/community/communityModel.js'), /\.summary\b/);
});
