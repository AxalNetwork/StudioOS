/**
 * D934 (#2718) — Admin › Community's four lightboxes, CM3 to CM6, and their
 * phone pages (CM12). Each is mounted on the real page over a stubbed `fetch`,
 * so every read goes through the real client to a URL and can fail alone.
 *
 * For each: search, each filter and sort, paging, the row's console link, Esc,
 * and a read that failed. Then the address (`?open=`), Close, focus going back
 * to the opener, and the phone page with its back link.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_lightboxes_d934.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';
import {
  ACTIVITY_CAP, EVENTS, JOBS, activityPage, activityQuery, eventsPage, eventsQuery, initialState, listView, openFrom, pageOf, searchWith,
} from '../src/pages/admin/community/lightboxModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DAY = 86_400_000;
const NOW = Date.now();
const at = (days) => new Date(NOW + days * DAY).toISOString();

// ---------------------------------------------------------------- fixtures

const ev = (id, title, o = {}) => ({ id, title, status: 'draft', type: 'other', starts_at: at(40 + id), capacity: 10, timezone: 'UTC', featured: false, created_at: at(-id), ...o });
const EVENTS_ROWS = [
  ev(1, 'Demo Night', { status: 'published', type: 'workshop', starts_at: at(2), capacity: 60, featured: true }),
  ev(2, 'Open Lab', { status: 'published', type: 'meetup', starts_at: at(10), capacity: null }),
  ev(3, 'Pricing Clinic', { status: 'pending_review', type: 'workshop', starts_at: at(5), capacity: 20 }),
  ev(4, 'Last Week Social', { status: 'published', type: 'social', starts_at: at(-7), capacity: 30 }),
  ev(5, 'Old Summit', { status: 'cancelled', type: 'conference', starts_at: at(-20), capacity: 100 }),
  ...Array.from({ length: 26 }, (_, i) => ev(6 + i, `Filler ${String(6 + i).padStart(2, '0')}`)),
];
// Old Summit (5) is not among the analytics rows: it reads "Not in this read".
const ANALYTICS = { summary: { never: 'read' }, unreadable: [], events: [
  { id: 1, registrations: 42, attended: 0, waitlisted: 3 },
  { id: 2, registrations: 12, attended: 0, waitlisted: 0 },
  { id: 3, registrations: 5, attended: 0, waitlisted: 0 },
  { id: 4, registrations: 30, attended: 24, waitlisted: 0 },
  ...Array.from({ length: 26 }, (_, i) => ({ id: 6 + i, registrations: 0, attended: 0, waitlisted: 0 })),
] };

const job = (id, title, o = {}) => ({ id, title, project_name: 'Filler Co', status: 'draft', remote: false, seniority: 'mid', application_count: 0, created_at: at(-id), ...o });
const JOBS_ROWS = [
  job(1, 'Backend Engineer', { project_name: 'Northwind Labs', status: 'published', remote: true, seniority: 'senior', application_count: 14 }),
  job(2, 'Head of Growth', { project_name: 'Bluefern Health', status: 'published', seniority: 'lead', application_count: 11 }),
  job(3, 'Founding Engineer', { project_name: 'Northwind Labs', status: 'pending_review', remote: true, seniority: 'senior' }),
  job(4, 'Ops Lead', { project_name: 'Harbor Robotics', status: 'closed', seniority: 'lead', application_count: 5 }),
  ...Array.from({ length: 24 }, (_, i) => job(5 + i, `Filler Role ${String(5 + i).padStart(2, '0')}`)),
];

const circle = (id, name, o = {}) => ({ id, name, type: 'topic', access: 'public', published: false, featured: false, members: 0, activity: 'new', ...o });
const CIRCLES_ROWS = [
  circle(1, 'Climate Founders', { type: 'founder', published: true, members: 64, activity: 'active' }),
  circle(2, 'Lisbon Founders', { type: 'city', published: true, featured: true, members: 96, activity: 'growing' }),
  circle(3, 'Seed Investors', { type: 'investor', access: 'private', published: true, featured: true, members: 38, activity: 'quiet' }),
  ...Array.from({ length: 24 }, (_, i) => circle(4 + i, `Zeta Circle ${String(4 + i).padStart(2, '0')}`)),
];

const activityRow = (i, o = {}) => ({ kind: 'events', actor: 'admin', icon: '◆', sentence: `An admin published “Event ${i}”.`, title: `Event ${i}`, href: '/admin/events', at: at(-i / 10), ...o });

// ---------------------------------------------------------------- the stubbed Worker

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The overview's reads and the lightboxes'. `opt.fail` names reads that answer 503; `opt.analytics` replaces its body. */
function worker(opt = {}) {
  const fail = opt.fail || [];
  return (url) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname;
    const down = (n) => fail.includes(n);
    const limit = Number(u.searchParams.get('limit') || 50);
    const offset = Number(u.searchParams.get('offset') || 0);
    if (p === '/api/admin/studio/glance') return json({ tier: 'hq', approvals: { lanes: [{ key: 'events', count: 1 }, { key: 'jobs', count: 1 }] } });
    if (p === '/api/admin/events/analytics') return down('analytics') ? json({ detail: 'down' }, 503) : json(opt.analytics || ANALYTICS);
    if (p === '/api/admin/events') {
      if (down('events')) return json({ detail: 'down' }, 503);
      // D918's list: its own counts on each row, filtered, sorted and paged in the Worker, with a total.
      const qp = u.searchParams;
      const counts = new Map(ANALYTICS.events.map((r) => [r.id, r]));
      let rows = EVENTS_ROWS.map((e) => ({ ...e, seats_taken: counts.get(e.id)?.registrations ?? 0, attended: counts.get(e.id)?.attended ?? 0, waitlisted: counts.get(e.id)?.waitlisted ?? 0, host: { name: 'Secret Host Person', role: 'founder' } }));
      if (qp.get('status')) rows = rows.filter((e) => qp.get('status').split(',').includes(e.status));
      if (qp.get('when') === 'upcoming') rows = rows.filter((e) => Date.parse(e.starts_at) > NOW);
      if (qp.get('when') === 'ended') rows = rows.filter((e) => Date.parse(e.starts_at) + DAY < NOW);
      if (qp.get('q')) rows = rows.filter((e) => e.title.toLowerCase().includes(qp.get('q').toLowerCase()));
      const sort = qp.get('sort');
      if (sort === 'starts') rows.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      if (sort === 'seats_taken') rows.sort((a, b) => b.seats_taken - a.seats_taken);
      return json({ events: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
    }
    if (p === '/api/admin/jobs') return down('jobs') ? json({ detail: 'down' }, 503) : json({ jobs: JOBS_ROWS.slice(offset, offset + limit) });
    if (p === '/api/admin/circles') return down('circles') ? json({ detail: 'down' }, 503) : json({ circles: CIRCLES_ROWS });
    if (p === '/api/admin/network-profiles') return json({ profiles: [] });
    if (p === '/api/admin/community/activity') {
      if (down('activity')) return json({ detail: 'down' }, 503);
      const total = opt.activityTotal ?? 60;
      const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => activityRow(offset + i + 1, offset + i === 0 ? { kind: 'jobs', actor: 'member', icon: '▲', sentence: '“Ops Lead” was closed.', href: '/admin/jobs', dated_by: 'last_change' } : {}));
      return json({ rows, total, limit, offset, filters: {}, sources: ['events'], unreadable: opt.activityUnreadable || [], definition: '' });
    }
    return json({});
  };
}

// ---------------------------------------------------------------- the mount

async function mounted(url, handle, { phone = false } = {}) {
  const restore = installDocument();
  // The test DOM has no focus, no containment, no querySelector and no
  // document events. The Lightbox moves focus and listens for Escape on the
  // document, so each node gets those, and document listeners are kept.
  const make = document.createElement.bind(document);
  const FOCUSABLE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    n.querySelector = function querySelector() {
      const walk = (x) => (x.childNodes || []).flatMap((c) => [c, ...walk(c)]);
      return walk(this).find((c) => FOCUSABLE.has(c.tagName)) || null;
    };
    n.querySelectorAll = function querySelectorAll() { return []; };
    // React moves a keyed row by inserting it again; a real DOM detaches it first, so this one does too.
    const append = n.appendChild.bind(n);
    const insert = n.insertBefore.bind(n);
    const detach = (child) => { if (child.parentNode) child.parentNode.removeChild(child); };
    n.appendChild = (child) => { detach(child); return append(child); };
    n.insertBefore = (child, ref) => { detach(child); return insert(child, ref); };
    return n;
  };
  const listeners = new Map();
  document.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  document.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handle(String(u)); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  let where = null;
  let nav = null;
  function Spy() { const l = useLocation(); nav = useNavigate(); where = `${l.pathname}${l.search}`; return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminCommunity), h(Spy))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const view = {
    requests, flush,
    where: () => where,
    async back() { await act(async () => { nav(-1); }); await flush(); },
    text: () => text(container),
    has: (id) => Boolean(byId(id)),
    textOf: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return text(n); },
    props: (id) => props(byId(id)),
    /** The text of every row a lightbox draws, in order. */
    rows: (box) => nodes().filter((n) => props(n)['data-testid'] === `community-box-${box}-row`).map(text),
    /** Each row's title: the text of its console link. */
    titles: (box) => nodes().filter((n) => props(n)['data-testid'] === `community-box-${box}-row`).map((r) => {
      const walk = (x) => [x, ...(x.childNodes || []).flatMap(walk)];
      return text(walk(r).find((x) => x.tagName === 'A'));
    }),
    hrefs: (scope) => { const n = scope ? byId(scope) : container; const walk = (x) => [x, ...(x.childNodes || []).flatMap(walk)]; return walk(n).filter((x) => x.tagName === 'A').map((x) => props(x).href); },
    focused: () => { for (let n = document.activeElement; n; n = n.parentNode) { const id = props(n)['data-testid']; if (id) return id; } return null; },
    async click(id) {
      const n = byId(id); assert.ok(n, `no ${id}`);
      const p = props(n); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`);
      n.focus();
      await act(async () => { p.onClick({ preventDefault() {}, stopPropagation() {} }); });
      await flush();
    },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id}`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async key(k) { await act(async () => { for (const fn of listeners.get('keydown') || []) fn({ key: k, defaultPrevented: false, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
  return view;
}

const range = (v, box) => v.textOf(`community-box-${box}-range`);

// ---------------------------------------------------------------- the model

test('the address: ?open= names one of four lightboxes, and opening or closing keeps every other key', () => {
  assert.equal(openFrom('?open=events'), 'events');
  assert.equal(openFrom('?open=activity&x=1'), 'activity');
  assert.equal(openFrom('?open=wellbeing'), null, 'not a lightbox');
  assert.equal(openFrom(''), null);
  assert.equal(searchWith('?moved=held-community', 'jobs'), '?moved=held-community&open=jobs');
  assert.equal(searchWith('?open=jobs&x=1', null), '?x=1');
  assert.equal(searchWith('?open=jobs', null), '');
});

test('paging is 25 a page, clamped, and an unknown count sorts after every known one', () => {
  const rows = Array.from({ length: 31 }, (_, i) => i);
  assert.deepEqual({ ...pageOf(rows, 2), rows: undefined }, { rows: undefined, page: 2, pages: 2, from: 26, to: 31, total: 31 });
  assert.equal(pageOf(rows, 9).page, 2, 'clamped to the last page');
  assert.equal(pageOf([], 1).from, 0);
  // A posting whose applications were not recorded is not ranked as 0.
  const out = listView(JOBS, [{ id: 2, title: 'A', application_count: null }, { id: 1, title: 'B', application_count: 0 }], initialState(JOBS));
  assert.deepEqual(out.rows.map((r) => r.id), [1, 2]);
  // D918's list: only what is set travels, and the sort carries its own direction.
  assert.deepEqual(eventsQuery(initialState(EVENTS)), { limit: 25, offset: 0, sort: 'starts', dir: 'asc' });
  assert.deepEqual(eventsQuery({ ...initialState(EVENTS), page: 2, q: ' demo ', sort: 'fill', filters: { status: 'published', when: '', visibility: '', price: 'free', featured: 'no' } }),
    { limit: 25, offset: 25, sort: 'fill', dir: 'desc', status: 'published', price: 'free', featured: false, q: 'demo' });
  assert.equal(eventsPage({ events: [] }, 1), null, 'no total is not a list');
  assert.deepEqual({ ...eventsPage({ events: [1, 2], total: 27 }, 2), rows: undefined }, { rows: undefined, page: 2, pages: 2, from: 26, to: 27, total: 27 });
});

test('the activity query carries only what is set, and its paging stops where the Worker does', () => {
  assert.deepEqual(activityQuery({ page: 1 }), { limit: 25, offset: 0 });
  assert.deepEqual(activityQuery({ page: 3, kind: 'jobs', from: '2026-10-01', to: '2026-10-2', q: '  Ops ' }), { limit: 25, offset: 50, kind: 'jobs', from: '2026-10-01', q: 'Ops' }, 'a half-typed date does not travel');
  assert.deepEqual(activityQuery({ page: 1, from: '2026-1', to: '2026-10-24' }), { limit: 25, offset: 0, to: '2026-10-24' }, 'nor a half-typed start');
  const p = activityPage({ rows: [], total: 4000, unreadable: [] }, 1);
  assert.equal(p.pages, ACTIVITY_CAP / 25);
  assert.match(p.capped, /Pages stop at 1,000 rows/);
  assert.equal(activityPage({ rows: null, total: 3 }, 1).state, 'unreadable');
  // A link that is not a console is not drawn as one.
  assert.equal(activityPage({ rows: [{ sentence: 'x', href: 'https://elsewhere.example' }], total: 1 }, 1).rows[0].href, null);
});

// ---------------------------------------------------------------- CM3 · Events

test('CM3 Events: D918\'s paged list, one page per read, D915\'s words, no analytics read, and the console link', async () => {
  const v = await mounted('/admin/community', worker());
  try {
    const before = v.requests.length;
    await v.click('community-open-events');
    assert.equal(v.where(), '/admin/community?open=events');
    assert.ok(v.has('community-box-events'), 'a Lightbox, centred over the overview');
    assert.ok(v.has('admin-community-page'), 'the overview stays under it');
    const mine = v.requests.slice(before);
    assert.deepEqual(mine, ['/api/admin/events?sort=starts&dir=asc&limit=25&offset=0'], 'one page of D918\'s list, and no analytics read: Guard G is retired');
    assert.equal(range(v, 'events'), '1–25 of 31');
    const rows = v.rows('events');
    assert.match(rows[0], /^Old Summit.*Conference.*Cancelled.*100.*0.*Not held.*0.*0%.*Not held/s, 'the Worker\'s order: start date, earliest first');
    assert.match(rows[1], /^Last Week Social.*Social.*Published.*30.*30.*24.*0.*100%.*80%/s, 'show-up once held');
    assert.match(rows[2], /^Demo Night.*Featured.*Workshop.*Published.*60.*42.*Not held yet.*3.*70%.*Not held yet/s);
    assert.match(rows[4], /^Open Lab.*Meetup.*No cap.*12.*No cap/s, 'no cap: fill reads No cap');
    assert.doesNotMatch(v.textOf('community-box-events'), /Secret Host Person/, 'the host\'s name is never drawn');
    assert.ok(v.hrefs('community-box-events').includes('/admin/events/1'), 'a row opens the event in the Events console');
    assert.equal(v.props('community-box-events-prev').disabled, true);
    await v.click('community-box-events-next');
    assert.equal(v.requests.at(-1), '/api/admin/events?sort=starts&dir=asc&limit=25&offset=25');
    assert.equal(range(v, 'events'), '26–31 of 31');
    assert.equal(v.rows('events').length, 6);
    assert.equal(v.props('community-box-events-next').disabled, true);
  } finally { await v.close(); }
});

test('CM3 Events: the search, each filter and each sort go to the Worker, and each goes back to page 1', async () => {
  const v = await mounted('/admin/community?open=events', worker());
  try {
    const last = () => v.requests.at(-1);
    await v.click('community-box-events-next');
    await v.change('community-box-events-search', 'clinic');
    assert.equal(last(), '/api/admin/events?q=clinic&sort=starts&dir=asc&limit=25&offset=0');
    assert.equal(range(v, 'events'), '1–1 of 1');
    assert.deepEqual(v.titles('events'), ['Pricing Clinic']);
    await v.change('community-box-events-search', 'zzz');
    assert.equal(range(v, 'events'), 'No events');
    assert.ok(v.has('community-box-events-empty'));
    await v.change('community-box-events-search', '');
    await v.change('community-box-events-filter-status', 'published');
    assert.equal(last(), '/api/admin/events?status=published&sort=starts&dir=asc&limit=25&offset=0');
    assert.deepEqual(v.titles('events'), ['Last Week Social', 'Demo Night', 'Open Lab']);
    await v.change('community-box-events-filter-status', '');
    await v.change('community-box-events-filter-when', 'ended');
    assert.match(last(), /[?&]when=ended&/);
    assert.deepEqual(v.titles('events'), ['Old Summit', 'Last Week Social']);
    await v.change('community-box-events-filter-when', '');
    await v.change('community-box-events-filter-visibility', 'unlisted');
    assert.match(last(), /[?&]visibility=unlisted&/);
    await v.change('community-box-events-filter-visibility', '');
    await v.change('community-box-events-filter-price', 'paid');
    assert.match(last(), /[?&]price=paid&/);
    await v.change('community-box-events-filter-price', '');
    await v.change('community-box-events-filter-featured', 'yes');
    assert.match(last(), /[?&]featured=1&/);
    await v.change('community-box-events-filter-featured', 'no');
    assert.match(last(), /[?&]featured=0&/);
    await v.change('community-box-events-filter-featured', '');
    for (const [sort, dir] of [['created', 'desc'], ['fill', 'desc'], ['show_up', 'desc'], ['seats_taken', 'desc']]) {
      await v.change('community-box-events-sort', sort);
      assert.equal(last(), `/api/admin/events?sort=${sort}&dir=${dir}&limit=25&offset=0`);
    }
    assert.deepEqual(v.titles('events').slice(0, 2), ['Demo Night', 'Last Week Social'], 'most registered first, as the Worker sorts');
  } finally { await v.close(); }
});

test('CM3 Events: a failed list, or an answer with no total, is not "no events"; Try again reads again', async () => {
  let v = await mounted('/admin/community?open=events', worker({ fail: ['events'] }));
  try {
    assert.match(v.textOf('community-box-events-unreadable'), /The events could not be read\. That is not the same as no events\./);
    assert.ok(!v.has('community-box-events-rows'));
    const before = v.requests.filter((r) => r.startsWith('/api/admin/events?sort=')).length;
    await v.click('community-box-events-retry');
    assert.equal(v.requests.filter((r) => r.startsWith('/api/admin/events?sort=')).length, before + 1, 'Try again reads again');
  } finally { await v.close(); }
  const base = worker();
  v = await mounted('/admin/community?open=events', (url) => (url.startsWith('/api/admin/events?sort=') ? json({ events: [] }) : base(url)));
  try {
    assert.ok(v.has('community-box-events-unreadable'), 'a list with no total is not drawn as none');
  } finally { await v.close(); }
});

test('CM3 Events: Esc closes it, takes it off the address, and puts focus back on the opener', async () => {
  const v = await mounted('/admin/community?moved=held-community', worker());
  try {
    await v.click('community-open-events');
    assert.equal(v.where(), '/admin/community?moved=held-community&open=events');
    assert.notEqual(v.focused(), 'community-open-events', 'focus moved into the lightbox');
    await v.key('Escape');
    assert.ok(!v.has('community-box-events'));
    assert.equal(v.where(), '/admin/community?moved=held-community');
    assert.equal(v.focused(), 'community-open-events');
    // Closing replaced the lightbox's entry, so Back does not open it again.
    await v.back();
    assert.ok(!v.has('community-box-events'), 'Back reopened a closed lightbox');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CM4 · Jobs

test('CM4 Job postings: every page read, search, each filter and sort, paging, the job board link, Close', async () => {
  const v = await mounted('/admin/community', worker());
  try {
    await v.click('community-open-jobs');
    assert.equal(v.where(), '/admin/community?open=jobs');
    assert.equal(range(v, 'jobs'), '1–25 of 28');
    assert.match(v.rows('jobs')[0], /^Backend Engineer.*Northwind Labs.*Published.*Remote.*Senior.*14/s, 'most applications first');
    assert.match(v.rows('jobs')[1], /^Head of Growth.*On-site.*Lead.*11/s);
    assert.ok(v.hrefs('community-box-jobs').includes('/admin/jobs'), 'a role opens the job board');
    assert.match(v.text(), /days open is not shown/, 'the canvas\'s Days open needs a date no read returns');
    await v.click('community-box-jobs-next');
    assert.equal(range(v, 'jobs'), '26–28 of 28');
    await v.change('community-box-jobs-search', 'northwind');
    assert.equal(range(v, 'jobs'), '1–2 of 2', 'role or company');
    await v.change('community-box-jobs-search', '');
    await v.change('community-box-jobs-filter-status', 'closed');
    assert.deepEqual(v.titles('jobs'), ['Ops Lead']);
    await v.change('community-box-jobs-filter-status', '');
    await v.change('community-box-jobs-filter-place', 'remote');
    assert.equal(range(v, 'jobs'), '1–2 of 2');
    await v.change('community-box-jobs-filter-place', 'onsite');
    assert.equal(range(v, 'jobs'), '1–25 of 26');
    await v.change('community-box-jobs-filter-place', '');
    await v.change('community-box-jobs-filter-seniority', 'lead');
    assert.deepEqual(v.titles('jobs'), ['Head of Growth', 'Ops Lead']);
    await v.change('community-box-jobs-filter-seniority', '');
    await v.change('community-box-jobs-sort', 'title');
    assert.match(v.rows('jobs')[0], /^Backend Engineer/);
    assert.match(v.rows('jobs')[1], /^Filler Role 05/);
    await v.change('community-box-jobs-sort', 'created');
    assert.match(v.rows('jobs')[0], /^Backend Engineer/, 'newest created first');
    assert.match(v.rows('jobs')[1], /^Head of Growth/);
    await v.click('community-box-jobs-done');
    assert.ok(!v.has('community-box-jobs'));
    assert.equal(v.where(), '/admin/community');
    assert.equal(v.focused(), 'community-open-jobs');
  } finally { await v.close(); }
});

test('CM4 Job postings: a failed read says it is not none, and Esc closes it', async () => {
  const v = await mounted('/admin/community?open=jobs', worker({ fail: ['jobs'] }));
  try {
    assert.match(v.textOf('community-box-jobs-unreadable'), /The job board could not be read\. That is not the same as no jobs\./);
    await v.key('Escape');
    assert.ok(!v.has('community-box-jobs'));
    assert.equal(v.where(), '/admin/community');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CM5 · Circles

test('CM5 Circles: As entered on Members and Activity, search, each filter and sort, paging, the circles link', async () => {
  const v = await mounted('/admin/community', worker());
  try {
    await v.click('community-open-circles');
    assert.equal(v.where(), '/admin/community?open=circles');
    assert.equal(range(v, 'circles'), '1–25 of 27');
    const head = v.textOf('community-box-circles-table');
    assert.match(head, /Members As entered/);
    assert.match(head, /Activity As entered/);
    assert.match(v.textOf('community-box-circles-as-entered'), /typed by an admin/);
    assert.match(v.rows('circles')[0], /^Climate Founders.*Founder.*Public.*Yes.*No.*64.*Active/s, 'by name first');
    assert.ok(v.hrefs('community-box-circles').includes('/admin/circles'));
    await v.click('community-box-circles-next');
    assert.equal(range(v, 'circles'), '26–27 of 27');
    await v.change('community-box-circles-search', 'lisbon');
    assert.equal(range(v, 'circles'), '1–1 of 1');
    await v.change('community-box-circles-search', '');
    await v.change('community-box-circles-filter-type', 'investor');
    assert.match(v.rows('circles')[0], /^Seed Investors.*Invite-only/s);
    await v.change('community-box-circles-filter-type', '');
    await v.change('community-box-circles-filter-access', 'private');
    assert.equal(range(v, 'circles'), '1–1 of 1');
    await v.change('community-box-circles-filter-access', '');
    await v.change('community-box-circles-filter-published', 'yes');
    assert.equal(range(v, 'circles'), '1–3 of 3');
    await v.change('community-box-circles-filter-published', 'no');
    assert.equal(range(v, 'circles'), '1–24 of 24');
    await v.change('community-box-circles-filter-published', '');
    await v.change('community-box-circles-filter-featured', 'yes');
    assert.deepEqual(v.titles('circles'), ['Lisbon Founders', 'Seed Investors']);
    await v.change('community-box-circles-filter-featured', '');
    await v.change('community-box-circles-sort', 'members');
    assert.match(v.rows('circles')[0], /^Lisbon Founders.*96/s, 'most members, as entered, first');
    await v.key('Escape');
    assert.ok(!v.has('community-box-circles'));
  } finally { await v.close(); }
});

test('CM5 Circles: a failed read says it is not none', async () => {
  const v = await mounted('/admin/community?open=circles', worker({ fail: ['circles'] }));
  try {
    assert.match(v.textOf('community-box-circles-unreadable'), /The circles could not be read\. That is not the same as no circles\./);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CM6 · Recent activity

test('CM6 Recent activity: D932\'s read, a page at a time, each filter on the address it sends, and no member named', async () => {
  const v = await mounted('/admin/community', worker());
  try {
    await v.click('community-open-activity');
    assert.equal(v.where(), '/admin/community?open=activity');
    const reads = () => v.requests.filter((r) => r.startsWith('/api/admin/community/activity'));
    assert.equal(reads().at(-1), '/api/admin/community/activity?limit=25&offset=0');
    assert.equal(range(v, 'activity'), '1–25 of 60');
    const rows = v.rows('activity');
    assert.equal(rows.length, 25);
    assert.match(rows[0], /“Ops Lead” was closed\..*Last change/s, 'a row dated by its last change says so');
    assert.ok(v.hrefs('community-box-activity').includes('/admin/jobs'), 'a row opens its console');
    assert.doesNotMatch(rows.join('\n'), /\bmember\b/, 'the actor is never drawn');
    await v.click('community-box-activity-next');
    assert.equal(reads().at(-1), '/api/admin/community/activity?limit=25&offset=25');
    assert.equal(range(v, 'activity'), '26–50 of 60');
    await v.change('community-box-activity-filter-kind', 'jobs');
    assert.equal(reads().at(-1), '/api/admin/community/activity?limit=25&offset=0&kind=jobs', 'a filter goes back to page 1');
    await v.change('community-box-activity-from', '2026-10-01');
    await v.change('community-box-activity-to', '2026-10-24');
    assert.equal(reads().at(-1), '/api/admin/community/activity?limit=25&offset=0&kind=jobs&from=2026-10-01&to=2026-10-24');
    await v.change('community-box-activity-search', 'Ops');
    assert.equal(reads().at(-1), '/api/admin/community/activity?limit=25&offset=0&kind=jobs&from=2026-10-01&to=2026-10-24&q=Ops');
    await v.key('Escape');
    assert.ok(!v.has('community-box-activity'));
    assert.equal(v.focused(), 'community-open-activity');
  } finally { await v.close(); }
});

test('CM6 Recent activity: a source that failed is named and not counted; a failed read is not "nothing happened"', async () => {
  let v = await mounted('/admin/community?open=activity', worker({ activityUnreadable: [{ source: 'job_postings', reason: 'D1 error' }] }));
  try {
    assert.match(v.textOf('community-box-activity-partial'), /Could not be read: job postings\. Those rows are not here and not in the count/);
    assert.doesNotMatch(v.text(), /D1 error/, 'the Worker\'s reason is not drawn');
  } finally { await v.close(); }
  v = await mounted('/admin/community?open=activity', worker({ fail: ['activity'] }));
  try {
    assert.match(v.textOf('community-box-activity-unreadable'), /That is not the same as nothing happening\./);
    const before = v.requests.filter((r) => r.startsWith('/api/admin/community/activity')).length;
    await v.click('community-box-activity-retry');
    assert.equal(v.requests.filter((r) => r.startsWith('/api/admin/community/activity')).length, before + 1);
  } finally { await v.close(); }
  v = await mounted('/admin/community?open=activity', worker({ activityTotal: 0 }));
  try {
    assert.equal(range(v, 'activity'), 'No activity');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- CM12 · the phone pages

test('CM12 phone: a lightbox is the page, with a back link to Community, and a list in place of the table', async () => {
  const v = await mounted('/admin/community?open=events', worker(), { phone: true });
  try {
    assert.ok(v.has('community-box-events-page'), 'a page, not a dialog');
    assert.ok(!v.has('admin-community-page'), 'the overview is not drawn under it');
    assert.ok(!v.has('community-box-events-table'));
    assert.match(v.textOf('community-box-events-back'), /‹ Community/);
    assert.match(v.textOf('community-box-events-filters-on'), /Filters · 0/);
    assert.match(v.rows('events')[2], /^Demo Night.*Workshop · Published.*42 \/ 60/s);
    assert.match(v.rows('events')[4], /^Open Lab.*12 · no cap/s);
    await v.change('community-box-events-filter-status', 'published');
    assert.match(v.textOf('community-box-events-filters-on'), /Filters · 1/);
    await v.click('community-box-events-back');
    assert.equal(v.where(), '/admin/community');
    assert.ok(v.has('admin-community-page'));
  } finally { await v.close(); }
  for (const box of ['jobs', 'circles', 'activity']) {
    const p = await mounted(`/admin/community?open=${box}`, worker(), { phone: true });
    try {
      assert.ok(p.has(`community-box-${box}-page`), `${box} is a page on a phone`);
      assert.ok(p.has(`community-box-${box}-back`));
    } finally { await p.close(); }
  }
});

// ---------------------------------------------------------------- the source

test('the source: Lightbox, never a drawer; nothing decided; no roster and no summary read', () => {
  const dir = 'frontend/src/pages/admin/community/';
  const files = ['EventsLightbox.jsx', 'JobsLightbox.jsx', 'CirclesLightbox.jsx', 'ActivityLightbox.jsx', 'CommunityLightbox.jsx', 'lightboxModel.js'].map((f) => read(dir + f)).join('\n');
  assert.match(read(dir + 'CommunityLightbox.jsx'), /<Lightbox [^>]*pageBelow="lg"/);
  assert.doesNotMatch(files, /import[^;]*(Drawer|SidePanel|Sheet)\b/, 'no drawer or side panel is imported');
  assert.doesNotMatch(files, /\.(approve|reject|unpublish|publish|feature|cancel|setCapacity|remove|update|create)\(/, 'a lightbox writes nothing');
  assert.doesNotMatch(files, /\/roster|network-profiles|wellbeing\/aggregate/, 'no read that names members');
  assert.doesNotMatch(files, /\.summary\b|\bconversion\b/, 'D915: the analytics summary and conversion are never read');
});
