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
  COMMUNITY_PATH, MOVED_KEY, MOVED_NOTICE, PAGE_UNREADABLE,
  buildCircles, buildConsoles, buildJobs, buildNeeds, buildNextUp, buildTiles,
  clockOf, isEmptyCommunity, pageFailed, readAllPages, rosterOf, seatsText,
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

// #4717 package 2: the page's one read. Every figure and every row behind one
// is the Community overview's, under its `as_of`; these blocks hold what the
// glance, events, jobs and circles lists used to be counted into.
const NETWORK = {
  available: true, archived: 4,
  by_kind_state: { advisor: { active: 1, hidden: 1 }, mentor: { active: 1, hidden: 0 }, partner: { active: 1, hidden: 0 }, investor: { active: 0, hidden: 1 } },
};
const FULL = {
  weeks: 4, as_of: new Date(NOW).toISOString(),
  blocks: {
    queue: {
      overdue_hours: 72,
      events: { available: true, count: 4, overdue: 1, oldest_hours: 100, waiting_from_created_at: 0 },
      event_rows: { available: true, total: 4, rows: [
        { event_id: 3, title: 'Pricing Clinic', waiting_since: at(-3), from_created: false, waiting_hours: 72, overdue: false },
        { event_id: 8, title: 'Old Queue', waiting_since: at(-5), from_created: true, waiting_hours: 120, overdue: true },
      ] },
      jobs: { available: true, pending: 3, overdue: 0, wait_not_recorded: 2, oldest_wait_hours: 20, review: [
        { posting_id: 17, title: 'Ops Lead', company: 'Harbor', waiting_since: at(-0.5), waiting_hours: 12, overdue: false },
        { posting_id: 13, title: 'Founding Engineer', company: 'Northwind Labs', waiting_since: null, waiting_hours: null, overdue: false },
        { posting_id: 14, title: 'Finance Lead', company: null, waiting_since: null, waiting_hours: null, overdue: false },
      ] },
    },
    events: {
      upcoming: { available: true, events: 3, seats_taken: 59, full: 0 },
      next_up: { available: true, total: 3, rows: [
        { event_id: 1, title: 'Founder Breakfast', status: 'published', starts_at: at(2), timezone: 'UTC', capacity: 60, seats_taken: 42 },
        { event_id: 3, title: 'Pricing Clinic', status: 'pending_review', starts_at: at(5), timezone: 'UTC', capacity: 20, seats_taken: 5 },
        { event_id: 2, title: 'Open Lab', status: 'published', starts_at: at(10), timezone: 'UTC', capacity: null, seats_taken: 12 },
      ] },
      by_status: { available: true, counts: { draft: 1, pending_review: 1, published: 4, rejected: 0, cancelled: 1, other: 0 } },
    },
    jobs: {
      available: true,
      applications: { window: 9, previous: 6 },
      by_status: { draft: 1, pending_review: 2, published: 2, closed: 1, rejected: 0, other: 0 },
      most_applied: [
        { posting_id: 11, title: 'Backend Engineer', company: 'Northwind Labs', status: 'published', applications: 14, days_open: 21 },
        { posting_id: 12, title: 'Head of Growth', company: 'Bluefern Health', status: 'published', applications: 11, days_open: { recorded: false, reason: 'x' } },
        { posting_id: 15, title: 'Old Role', company: 'Harbor', status: 'closed', applications: 2, days_open: null },
      ],
    },
    circles: {
      available: true, total: 4, published: 3, draft: 1, featured: 2,
      by_type: { founder: 2, city: 1, topic: 1 }, by_access: { public: 4 }, members_entered: { value: 212, typed: true },
    },
    network: NETWORK,
  },
};
const ROSTER_OVERVIEW = FULL;
const ALL = { overview: ok(FULL) };
/** The overview with one block replaced (`path` like 'queue.jobs'). */
function withBlock(path, value) {
  const copy = structuredClone(FULL);
  const keys = path.split('.');
  let o = copy.blocks;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
  return { overview: ok(copy) };
}
const UNREAD = { available: false, unreadable: true, reason: 'This could not be read on this database. That is not the same as none.' };
const tile = (tiles, key) => tiles.find((t) => t.key === key);

// ---------------------------------------------------------------- the model

test('#4717 Waiting on you adds the Community read\'s two queues, and a queue it could not read is no total', () => {
  const t = tile(buildTiles(ALL, NOW), 'waiting');
  assert.equal(t.state, 'ready');
  assert.equal(t.value, '7');
  assert.equal(t.sub, '4 events · 3 jobs · oldest 4 days');
  assert.equal(t.overdue, true);
  // A queue that failed is a missing total, never a partial sum; a count that is not a whole number is not read as one.
  assert.equal(tile(buildTiles(withBlock('queue.events', UNREAD), NOW), 'waiting').state, 'unreadable');
  assert.equal(tile(buildTiles(withBlock('queue.jobs', { ...FULL.blocks.queue.jobs, pending: '3' }), NOW), 'waiting').state, 'unreadable');
  assert.equal(tile(buildTiles({ overview: bad }, NOW), 'waiting').state, 'unreadable');
  assert.equal(tile(buildTiles({ overview: { status: 'loading', data: null } }, NOW), 'waiting').state, 'loading');
});

// D1121: the Upcoming tile reads D918's next 30 days through the Community read
// (`events.upcoming`, counts only), and Next up D918's list rows' own seats
// taken (`GET /api/admin/events`); neither reads the analytics rows.
const OVERVIEW = ok({ weeks: 12, blocks: { events: {
  upcoming: { available: true, events: 3, seats_taken: 59, full: 0 },
} } });

test('Upcoming events is D918\'s next 30 days and its seats, from the Community read (D1121)', () => {
  // Mutation checked: the tile back on the events list and analytics rows → 59 is not the seats; a failed block drawn as 0 → the unreadable check fails.
  const t = tile(buildTiles({ ...ALL, overview: OVERVIEW }, NOW), 'upcoming');
  assert.deepEqual([t.state, t.value, t.sub], ['ready', '3', 'next 30 days · 59 registered']);
  assert.equal(tile(buildTiles({ ...ALL, overview: bad }, NOW), 'upcoming').state, 'unreadable', 'a failed Community read is drawn as a count');
  assert.equal(tile(buildTiles({ ...ALL, overview: ok({ blocks: { events: { upcoming: { available: false, unreadable: true, reason: 'x' } } } }) }, NOW), 'upcoming').state, 'unreadable');
});

test('seats text: a cap is taken of capacity, no cap says so, and a missing count is never 0', () => {
  assert.equal(seatsText({ capacity: 60, seats_taken: 42 }).text, '42 / 60');
  assert.equal(seatsText({ capacity: null, seats_taken: 12 }).text, 'No cap · 12 registered');
  assert.equal(seatsText({ capacity: 60 }).text, 'Seats not recorded');
});

test('#4717 Next up is the events Upcoming counts: the soonest three, a waiting one marked, each with its own seats', () => {
  const n = buildNextUp(ALL);
  assert.deepEqual(n.rows.map((r) => [r.title, r.seats.text, r.waiting]), [
    ['Founder Breakfast', '42 / 60', false], ['Pricing Clinic', '5 / 20', true], ['Open Lab', 'No cap · 12 registered', false],
  ]);
  assert.equal(buildNextUp(withBlock('events.next_up', UNREAD)).state, 'unreadable');
  assert.equal(buildNextUp({ overview: bad }).state, 'unreadable');
  const without = buildNextUp(withBlock('events.next_up', { available: true, total: 1, rows: [{ ...FULL.blocks.events.next_up.rows[0], seats_taken: undefined }] }));
  assert.equal(without.rows[0].seats.text, 'Seats not recorded', 'a row with no count is drawn as 0');
});

test('the period figures wait for the Community read, and are never a zero before it answers (D933 draws them)', () => {
  const before = { ...ALL, overview: undefined }; // the Community read has not answered
  const tiles = buildTiles(before, NOW);
  for (const key of ['registrations', 'applications', 'show-up', 'experts', 'roster']) {
    assert.equal(tile(tiles, key).state, 'loading', key);
    assert.equal(tile(tiles, key).value, undefined, key);
  }
  assert.equal(buildConsoles(before).wellbeing.state, 'loading');
  assert.equal(buildConsoles(before).roster.state, 'loading');
});

test('Jobs: postings by status in the canvas\'s order, and the five with most applications, from the Community read', () => {
  const j = buildJobs(ALL);
  assert.equal(j.total, 6);
  assert.deepEqual(j.parts.map((p) => [p.label, p.value]), [['Published', 2], ['Pending review', 2], ['Draft', 1], ['Closed', 1], ['Rejected', 0]]);
  assert.deepEqual(j.most.map((m) => [m.title, m.applications, m.daysOpen]), [
    ['Backend Engineer', 14, '21 days open'], ['Head of Growth', 11, 'Days open not recorded'], ['Old Role', 2, null],
  ]);
  assert.equal(buildJobs(withBlock('jobs', UNREAD)).state, 'unreadable');
  // #4717: a block without its applications figures is an unreadable tile, never 0 and never a crash.
  assert.equal(tile(buildTiles(withBlock('jobs', { ...FULL.blocks.jobs, applications: undefined }), NOW), 'applications').state, 'unreadable');
  // #4717: a status count that is not a whole number is unreadable, never drawn as 0.
  assert.equal(buildJobs(withBlock('jobs', { ...FULL.blocks.jobs, by_status: { ...FULL.blocks.jobs.by_status, published: null } })).state, 'unreadable');
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

test('#4717 the roster is the server\'s count: archived rows out, and a missing or odd count is unreadable, never 0', () => {
  // 600 profiles on the roster: counted in full, whatever a list endpoint would cap at.
  const big = { ...ALL, overview: ok({ ...ROSTER_OVERVIEW, blocks: { network: { available: true, archived: 9, by_kind_state: { advisor: { active: 501, hidden: 99 } } } } }) };
  assert.equal(tile(buildTiles(big, NOW), 'roster').value, '501');
  assert.equal(rosterOf(big).rows[0].inactive, 99, 'the 9 archived rows are in neither column');
  for (const bad of [{ advisor: { active: '3', hidden: 0 } }, { advisor: { active: 2 } }, { advisor: { active: -1, hidden: 0 } }, null]) {
    const r = rosterOf({ ...ALL, overview: ok({ ...ROSTER_OVERVIEW, blocks: { network: { available: true, by_kind_state: bad } } }) });
    assert.equal(r.state, 'unreadable', `${JSON.stringify(bad)} read as a count`);
  }
  assert.equal(rosterOf({ ...ALL, overview: { status: 'error', data: null } }).state, 'unreadable');
  assert.equal(rosterOf({ ...ALL, overview: { status: 'loading', data: null } }).state, 'loading');
});

test('#4717 the clock is the read\'s as_of: a Refresh that brings a later as_of moves every time-relative figure', () => {
  const at = (iso) => ({ ...ALL, overview: ok({ ...ROSTER_OVERVIEW, as_of: iso }) });
  assert.equal(clockOf(at('2026-10-24T12:00:00Z'), null), Date.parse('2026-10-24T12:00:00Z'));
  assert.equal(clockOf(at('2026-10-31T12:00:00Z'), null), Date.parse('2026-10-31T12:00:00Z'));
  // Before the read answers, the moment the page's reads settled; never a stamp frozen at mount.
  assert.equal(clockOf({ ...ALL, overview: { status: 'loading', data: null } }, 123), 123);
  assert.equal(clockOf(at('not a time'), 456), 456);
  const page = read('frontend/src/pages/admin/community/AdminCommunity.jsx');
  assert.doesNotMatch(page, /const \[now\] = useState\(/, 'the clock is frozen at mount again');
  assert.match(page, /const now = useMemo\(\(\) => clockOf\(reads, asOf\), \[reads, asOf\]\);/);
});

test('#4717 Needs a decision: the queues\' oldest rows, oldest first, their counts the queues\' own, and a half that failed says so', () => {
  const n = buildNeeds(ALL);
  // Undated jobs (submitted before migration 550) list after every dated row.
  assert.deepEqual(n.rows.map((r) => `${r.kind} ${r.title}`), [
    'Event Old Queue', 'Event Pricing Clinic', 'Job Ops Lead', 'Job Founding Engineer', 'Job Finance Lead',
  ]);
  assert.deepEqual(n.rows.map((r) => r.wait), ['waiting 5 days · since created', 'waiting 3 days', 'waiting 12 hours', 'wait not recorded', 'wait not recorded']);
  assert.deepEqual(n.rows.map((r) => r.overdue), [true, false, false, false, false]);
  // The total is the queues' counts (4 events + 3 jobs), not the rows listed.
  assert.equal(n.total, 7);
  assert.equal(n.overdue, 1);
  const half = buildNeeds(withBlock('queue.jobs', UNREAD));
  assert.deepEqual(half.rows.map((r) => r.title), ['Old Queue', 'Pricing Clinic']);
  assert.match(half.partial, /job board could not be read/);
  const neither = withBlock('queue.jobs', UNREAD);
  neither.overview.data.blocks.queue.events = UNREAD;
  assert.equal(buildNeeds(neither).state, 'unreadable');
});

test('#4717 the page fails when its one read fails; an empty studio is the read\'s own zeros', () => {
  assert.equal(pageFailed({ overview: bad }), true);
  assert.equal(pageFailed(ALL), false);
  const zeros = structuredClone(FULL);
  zeros.blocks.events.by_status.counts = { draft: 0, pending_review: 0, published: 0, rejected: 0, cancelled: 0, other: 0 };
  zeros.blocks.jobs.by_status = { draft: 0, pending_review: 0, published: 0, closed: 0, rejected: 0, other: 0 };
  zeros.blocks.circles = { ...zeros.blocks.circles, total: 0, published: 0, featured: 0, by_type: {}, members_entered: { value: 0, typed: true } };
  assert.equal(isEmptyCommunity({ overview: ok(zeros) }), true);
  const oneDraft = structuredClone(zeros);
  oneDraft.blocks.events.by_status.counts.draft = 1;
  assert.equal(isEmptyCommunity({ overview: ok(oneDraft) }), false, 'a draft or cancelled event is not an empty studio');
  const unread = structuredClone(zeros);
  unread.blocks.jobs = UNREAD;
  assert.equal(isEmptyCommunity({ overview: ok(unread) }), false, 'a failed block is not an empty studio');
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
    // #4717 package 2: the page's one read. `fail: ['jobs']` makes its jobs blocks unreadable, as the server would.
    if (p === '/api/admin/community/overview') {
      if (down('overview')) return json({ detail: 'down' }, 503);
      const body = structuredClone(FULL);
      body.weeks = Number(u.searchParams.get('weeks') || 12);
      if (down('jobs')) { body.blocks.jobs = UNREAD; body.blocks.queue.jobs = UNREAD; }
      return json(body);
    }
    // The raw lists the page no longer reads: answered, so a regression that reads them again is seen in `seen`.
    if (p === '/api/admin/studio/glance' || p === '/api/admin/events/analytics' || p === '/api/admin/events'
      || p === '/api/admin/jobs' || p === '/api/admin/circles') return json({});
    if (p === '/api/admin/network-profiles') return json({ profiles: ROSTER_ROWS, count: 2 });
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
    assert.match(m.of('community-tile-waiting'), /7.*4 events · 3 jobs.*Open Approvals/s);
    assert.match(m.of('community-tile-circles'), /3 of 4/);
    assert.match(m.of('community-tile-roster'), /3.*active on the roster/s);
    // This fixture carries no weekly registrations, so that figure says it could not be read.
    assert.match(m.of('community-tile-registrations'), /Unreadable/);
    assert.match(m.of('community-card-jobs'), /Backend Engineer.*14 applications/s);
    assert.match(m.of('community-circle-counts'), /3 published · 1 draft · 2 featured/);
    assert.match(m.of('community-members-entered'), /212.*As entered/s);
    assert.match(m.of('community-needs'), /Founding Engineer/);
    assert.match(m.of('community-unrecorded-active-members'), /Not recorded/);
    assert.doesNotMatch(m.text(), /Secret Roster Name|Another Hidden Person|Hidden Co/, 'a roster name reached the page');
    assert.ok(!m.has('admin-page-moved'));
    // Every read the page made, by path. The wellbeing reads are not among them.
    // The rail makes its own /api/ai* reads; those are its, not the page's.
    const paths = new Set(m.seen.map((s) => s.split('?')[0]).filter((p) => !/^\/api\/ai(-budget)?\//.test(p) && p !== '/api/client-error'));
    assert.ok(!m.seen.some((s) => s.startsWith('/api/wellbeing')), 'the page read a wellbeing route');
    // #4717 package 2: one snapshot. The Community read and Recent activity's own rows; no raw list.
    assert.deepEqual([...paths].sort(), ['/api/admin/community/activity', '/api/admin/community/overview']);
  } finally { await m.unmount(); }
});

test('mounted CM10a: the job board failing costs only its blocks, and says it is not zero', async () => {
  const m = await mount(COMMUNITY_PATH, ['jobs']);
  try {
    // #4717: the server's own sentence for the block it could not read.
    assert.match(m.of('community-card-jobs'), /could not be read on this database\. That is not the same as none\./);
    assert.match(m.of('community-tile-circles'), /3 of 4/, 'another block stopped answering');
    assert.match(m.of('community-card-needs'), /job board could not be read, so only events are listed/);
    assert.ok(!m.has('community-unreadable'));
  } finally { await m.unmount(); }
});

test('mounted CM10b: every read failed — the banner says nothing is a zero, and every console door still works', async () => {
  const m = await mount(COMMUNITY_PATH, ['overview']);
  try {
    assert.match(m.of('community-unreadable'), new RegExp(PAGE_UNREADABLE.replace('.', '\\.')));
    assert.ok(!m.has('community-tiles'), 'tiles drawn under a page that could not be read');
    for (const to of ['/admin/events', '/admin/jobs', '/admin/circles', '/admin/advisors-partners', '/admin/wellbeing', '/admin/partner-invitations']) {
      assert.ok(m.links().includes(to), `the consoles strip lost ${to}`);
    }
  } finally { await m.unmount(); }
});

test('mounted CM13: the moved notice shows only after the redirect', async () => {
  const m = await mount(`${COMMUNITY_PATH}?moved=${MOVED_KEY}`);
  try { assert.match(m.of('admin-page-moved'), new RegExp(MOVED_NOTICE.replace('.', '\\.'))); } finally { await m.unmount(); }
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

test('D938: the page draws the shared AdminPageHeader with its title, line and moved notice, and no h1 of its own', () => {
  const page = read('frontend/src/pages/admin/community/AdminCommunity.jsx');
  assert.match(page, /import \{[^}]*\bAdminPageHeader\b[^}]*\} from '\.\.\/\.\.\/\.\.\/ui'/);
  assert.match(page, /<AdminPageHeader\s+title="Community"\s+line=\{PAGE_LINE\}\s+notice=\{\{ text: moved \? MOVED_NOTICE : null, onDismiss: dismissMoved \}\}/);
  assert.doesNotMatch(page, /<h1/);
  assert.match(page, /<Link to="\/admin\/wellbeing"/);
  assert.doesNotMatch(page, /\?tab=wellbeing/);
});

test('the routes, the row and the reads the page must never make', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/community" element=\{guard\(\['admin'\], <AdminCommunity \/>\)\} \/>/);
  assert.doesNotMatch(app, /<Route path="\/admin\/held\/community" element=\{<HeldCommunityRedirect \/>\} \/>/);
  assert.match(read('frontend/src/sidebarConfig.js'), /\{ to: '\/admin\/community', icon: Network, label: 'Community'/);
  const page = read('frontend/src/pages/admin/community/AdminCommunity.jsx');
  // The aggregate decrypts members' answers to average them; the experts read caps at 50 and counts samples (D930 §2).
  assert.doesNotMatch(page, /wellbeingAggregate|wellbeingExperts|\/wellbeing\//, 'the page reads a wellbeing route');
  // #4717: the roster is counted on the server; the page reads no profile list, so no name can reach it.
  assert.doesNotMatch(page, /adminNetworkProfiles|network-profiles/);
  assert.match(read('frontend/src/pages/admin/community/communityModel.js'), /blockOf\(reads\.overview, 'network', ROSTER_UNREAD\)/);
  // The analytics summary is all time; nothing here reads it.
  assert.doesNotMatch(read('frontend/src/pages/admin/community/communityModel.js'), /\.summary\b/);
});
