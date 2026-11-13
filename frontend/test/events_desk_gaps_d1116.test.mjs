/**
 * D1116 (#2996) — the Events desk boards S1's check found no builder for:
 * Type and Format on All events and the Calendar (EV6, EV8), All events'
 * per-row ⋯ menu (EV6, EV17d), Review's Agenda fact (EV3) and the desk's
 * dialogs as bottom sheets on a phone (EV17f, EV9a).
 *
 * The models are pure; the tabs are mounted under AdminEventsPage, as the
 * desk runs, against the Worker's shapes (D918's paged list, R5's agenda,
 * D918's summary). Every event here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/events_desk_gaps_d1116.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import {
  CSV_COLUMNS, FORMATS, TYPES, filterCount, formatKey, formatLabel, matchesFilters, readQuery, typeLabel, writeQuery,
} from '../src/pages/admin/events/allEventsModel.js';
import { rowActions } from '../src/pages/admin/events/RowActions.jsx';
import { agendaFact } from '../src/pages/admin/events/reviewModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = Date.parse('2099-01-05T12:00:00Z');

const ev = (id, o = {}) => ({
  id, slug: `ev-${id}`, title: `Synthetic event ${id}`, type: 'meetup', location_kind: 'virtual', starts_at: '2099-01-12T17:30:00Z', ends_at: null,
  timezone: 'UTC', status: 'published', visibility: 'public', capacity: 40, featured: false, price_cents: 0, currency: 'usd',
  created_at: '2098-12-01 09:00:00', seats_taken: 6, attended: 0, waitlisted: 2, host: { name: 'Dana Ruiz', role: 'founder' }, venture: null,
  clash: false, waiting_hours: null, ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Type and Format: the address, the count, the match and the words; an unknown one is "Not recorded" and matches no filter', () => {
  assert.equal(TYPES.length, 12, 'the twelve stored types');
  assert.deepEqual(FORMATS.map((f) => f.key), ['online', 'in_person', 'hybrid']);
  const q = readQuery('?type=workshop&format=in_person&status=published');
  assert.deepEqual([q.type, q.format], ['workshop', 'in_person']);
  assert.deepEqual([readQuery('?type=nope&format=moon').type, readQuery('?type=nope&format=moon').format], [null, null], 'an unknown value is ignored');
  assert.equal(filterCount(q), 3);
  assert.equal(writeQuery('', { type: 'workshop', format: 'hybrid' }), '?type=workshop&format=hybrid');
  assert.equal(formatKey({ location_kind: 'virtual' }), 'online');
  assert.equal(formatKey({ location_kind: 'physical' }), 'in_person', 'the legacy value is in person');
  assert.equal(formatKey({ location_kind: 'in_person' }), 'in_person');
  assert.equal(formatKey({ location_kind: 'moon' }), null);
  assert.equal(typeLabel(ev(1, { type: 'lp_briefing' })), 'LP Briefing');
  assert.equal(typeLabel(ev(1, { type: 'nope' })), 'Not recorded');
  assert.equal(formatLabel(ev(1, { location_kind: null })), 'Not recorded');
  const f = (search) => readQuery(search);
  assert.equal(matchesFilters(ev(1, { type: 'workshop' }), f('?type=workshop'), NOW), true);
  assert.equal(matchesFilters(ev(1), f('?type=workshop'), NOW), false);
  assert.equal(matchesFilters(ev(1, { location_kind: 'hybrid' }), f('?format=hybrid'), NOW), true);
  assert.equal(matchesFilters(ev(1, { location_kind: 'physical' }), f('?format=in_person'), NOW), true);
  assert.equal(matchesFilters(ev(1, { location_kind: null }), f('?format=online'), NOW), false, 'a format not stored matches none');
  assert.deepEqual(CSV_COLUMNS.slice(0, 8), ['Event', 'Featured', 'Type', 'Starts', 'Time zone', 'Status', 'Visibility', 'Format']);
});

test('the row menu: the canvas\'s items, by the event page\'s rules', () => {
  const keys = (o) => rowActions(ev(1, o)).map((a) => a.key);
  assert.deepEqual(keys({}), ['open', 'feature', 'capacity', 'unpublish', 'cancel', 'host']);
  assert.deepEqual(keys({ status: 'draft' }), ['open', 'feature', 'capacity', 'cancel', 'host'], 'Unpublish only for a published event');
  assert.deepEqual(keys({ status: 'cancelled' }), ['open', 'feature', 'capacity', 'host'], 'no Cancel for one cancelled already');
  assert.equal(rowActions(ev(1, { featured: true }))[1].label, 'Stop featuring');
  assert.equal(rowActions(ev(1))[1].label, 'Feature');
});

test('the Agenda fact: items and distinct speakers, none, reading, and a failed read that is never "none"', () => {
  const ok = (agenda) => agendaFact({ status: 'ready', data: { agenda } }, ev(1));
  const items = [
    { id: 1, title: 'Welcome', speaker_name: 'Ana', starts_at: '2099-01-12T17:30:00Z', display_order: 1 },
    { id: 2, title: 'Panel', speaker_name: ' ana ', starts_at: '2099-01-12T18:00:00Z', display_order: 2 },
    { id: 3, title: 'Q&A', speaker_name: 'Bo', starts_at: '2099-01-12T18:30:00Z', display_order: 3 },
    { id: 4, title: 'Drinks', speaker_name: null, starts_at: '2099-01-12T19:00:00Z', display_order: 4 },
  ];
  const f = ok(items);
  assert.equal(f.value, '4 items · 2 speakers', 'the same name once, and no name adds none');
  assert.deepEqual(f.items.map((i) => i.title), ['Welcome', 'Panel', 'Q&A', 'Drinks']);
  assert.equal(ok([items[0]]).value, '1 item · 1 speaker');
  assert.equal(ok([]).value, 'No agenda items');
  assert.equal(agendaFact({ status: 'loading' }, ev(1)).value, 'Reading…');
  const failed = agendaFact({ status: 'error' }, ev(1));
  assert.equal(failed.unrecorded.text, 'Could not be read');
  assert.equal(failed.failed, true);
  assert.equal(agendaFact({ status: 'ready', data: {} }, ev(1)).failed, true, 'an answer with no agenda is not "none"');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mounted(url, { items = [], queue = [], agenda = () => json({ agenda: [] }), summary = () => json({}), phone = false } = {}) {
  const old = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input), 'http://local.test');
    requests.push({ path: u.pathname, search: u.search, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (options.method === 'POST') return json({ ok: true, promoted: 0 });
    if (u.pathname === '/api/admin/events') {
      const rows = u.searchParams.get('status') === 'pending_review' ? queue : items;
      const offset = Number(u.searchParams.get('offset') || 0);
      return json({ events: rows.slice(offset, offset + 200), total: rows.length });
    }
    if (/\/api\/events\/\d+\/agenda$/.test(u.pathname)) return agenda(u);
    if (/\/api\/admin\/events\/\d+\/summary$/.test(u.pathname)) return summary(u);
    if (/\/api\/admin\/events\/\d+\/(history|comp-preview)$/.test(u.pathname)) return json({ history: { items: [] }, preview: null });
    return json({});
  };
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin' }));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminEventsPage))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await flush(); };
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)), node: byId,
    all: () => text(container),
    click: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    async close() { await act(async () => root.unmount()); restore(); Object.assign(globalThis, old); },
  };
}

test('mounted All events: Type and Format columns and filters, which narrow the rows read from every page', async () => {
  const items = [ev(1, { type: 'workshop', location_kind: 'physical' }), ev(2, { type: 'meetup', location_kind: 'virtual' }), ev(3, { type: 'nope', location_kind: null })];
  let m = await mounted('/admin/events/all', { items });
  try {
    assert.equal(m.textOf('events-all-type-1'), 'Workshop');
    assert.equal(m.textOf('events-all-format-1'), 'In person');
    assert.equal(m.textOf('events-all-format-2'), 'Online');
    assert.equal(m.textOf('events-all-type-3'), 'Not recorded');
    assert.equal(m.textOf('events-all-format-3'), 'Not recorded');
    assert.ok(m.has('events-filter-type') && m.has('events-filter-format'));
  } finally { await m.close(); }
  m = await mounted('/admin/events/all?type=workshop', { items });
  try {
    assert.ok(m.has('events-all-row-1') && !m.has('events-all-row-2') && !m.has('events-all-row-3'));
    assert.equal(m.props('events-filter-type').value, 'workshop');
  } finally { await m.close(); }
  m = await mounted('/admin/events/all?format=online', { items });
  try {
    assert.ok(!m.has('events-all-row-1') && m.has('events-all-row-2') && !m.has('events-all-row-3'));
  } finally { await m.close(); }
});

test('mounted ⋯ menu: each item opens its dialog, which writes only on confirm and says what it did', async () => {
  const items = [ev(7, { title: 'Founder Breakfast', capacity: 40, seats_taken: 6, waitlisted: 2 })];
  const m = await mounted('/admin/events/all', { items, summary: () => json({ payments: { available: true, paid: { count: 0 } } }) });
  try {
    await m.click('events-all-menu-7');
    assert.ok(m.has('events-all-menu-7-list'));
    assert.match(m.textOf('events-all-menu-7-list'), /^Open.*Feature.*Change capacity.*Unpublish.*Cancel event.*Open as host$/s);
    assert.equal(m.props('events-all-menu-7-open').href, '/admin/events/7');
    assert.equal(m.props('events-all-menu-7-host').href, '/events/7/manage');

    await m.click('events-all-menu-7-capacity');
    assert.ok(m.has('events-capacity-dialog'), 'Change capacity opens its dialog');
    assert.match(m.all(), /Now: 40 seats · 6 taken · 2 waiting\./, 'counted from the row');
    assert.equal(m.requests.filter((r) => r.method === 'POST').length, 0, 'nothing is written by opening it');
    await m.click('events-capacity-go');
    const cap = m.requests.find((r) => r.method === 'POST' && r.path === '/api/admin/events/7/capacity');
    assert.deepEqual(cap.body, { capacity: 40 });
    assert.ok(!m.has('events-capacity-dialog'));
    assert.ok(m.has('events-all-done'), 'the page says what it did');

    await m.click('events-all-menu-7');
    await m.click('events-all-menu-7-feature');
    assert.ok(m.has('events-feature-dialog'));
    await m.click('events-feature-go');
    assert.deepEqual(m.requests.find((r) => r.path === '/api/admin/events/7/feature').body, { featured: true });
    assert.match(m.textOf('events-all-done'), /Founder Breakfast is featured\./);

    await m.click('events-all-menu-7');
    await m.click('events-all-menu-7-unpublish');
    assert.ok(m.has('events-unpublish-dialog'));
    await m.click('events-unpublish-go');
    assert.ok(m.requests.some((r) => r.path === '/api/admin/events/7/unpublish'));

    await m.click('events-all-menu-7');
    await m.click('events-all-menu-7-cancel');
    assert.ok(m.has('events-cancel-dialog'));
    assert.ok(m.requests.some((r) => r.path === '/api/admin/events/7/summary'), 'Cancel reads that event\'s payments');
    await m.click('events-cancel-go');
    assert.ok(m.requests.some((r) => r.method === 'POST' && r.path === '/api/admin/events/7/cancel'));
    const reads = m.requests.filter((r) => r.path === '/api/admin/events' && !r.search.includes('pending_review')).length;
    assert.ok(reads >= 5, 'each write reads the list again');
  } finally { await m.close(); }
});

test('mounted ⋯ menu: a cancelled event offers no Unpublish or Cancel; a refused write stays in its dialog', async () => {
  const m = await mounted('/admin/events/all', { items: [ev(8, { status: 'cancelled' })] });
  try {
    await m.click('events-all-menu-8');
    assert.ok(!m.has('events-all-menu-8-unpublish') && !m.has('events-all-menu-8-cancel'));
  } finally { await m.close(); }
  const refusing = await mounted('/admin/events/all', { items: [ev(9)] });
  const post = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => (options.method === 'POST' ? json({ error: 'not_published' }, 409) : post(input, options));
  try {
    await refusing.click('events-all-menu-9');
    await refusing.click('events-all-menu-9-unpublish');
    await refusing.click('events-unpublish-go');
    assert.ok(refusing.has('events-unpublish-dialog'), 'a refusal keeps the dialog open');
    assert.match(refusing.textOf('events-unpublish-dialog'), /This event is no longer published\./);
    assert.ok(!refusing.has('events-all-done'));
  } finally { await refusing.close(); }
});

test('mounted on a phone: each card has its ⋯, and its dialog is a bottom sheet (EV17f)', async () => {
  const m = await mounted('/admin/events/all', { items: [ev(5)], phone: true });
  try {
    assert.ok(m.has('events-all-card-menu-5'));
    await m.click('events-all-card-menu-5');
    await m.click('events-all-card-menu-5-capacity');
    assert.equal(m.props('events-capacity-dialog-layer')['data-phone'], 'sheet');
  } finally { await m.close(); }
  const src = read('frontend/src/pages/admin/events/EventDialogs.jsx');
  assert.equal((src.match(/<Lightbox phone="sheet" label=/g) || []).length, 6, 'every desk dialog is a sheet on a phone');
  assert.equal((src.match(/<Lightbox label=/g) || []).length, 0);
});

test('mounted Calendar: the Type and Format filters, and the chip card names both', async () => {
  const items = [ev(4, { type: 'networking', location_kind: 'hybrid' })];
  const m = await mounted('/admin/events/calendar?month=2099-01&view=month', { items });
  try {
    assert.ok(m.has('events-filter-type') && m.has('events-filter-format'));
    await m.click('events-cal-chip-4');
    assert.equal(m.textOf('events-cal-card-kind'), 'Networking · Hybrid');
  } finally { await m.close(); }
  const none = await mounted('/admin/events/calendar?month=2099-01&view=month&format=online', { items });
  try {
    assert.ok(!none.has('events-cal-chip-4'), 'the filter narrows the calendar too');
  } finally { await none.close(); }
});

test('mounted Review: the Agenda fact counts items and speakers and expands; a failed read says so with Try again', async () => {
  const queue = [ev(11, { status: 'pending_review', submitted_at: '2099-01-04T09:00:00Z', waiting_hours: 27 })];
  const agenda = [
    { id: 1, title: 'Welcome', speaker_name: 'Ana', starts_at: '2099-01-12T17:30:00Z', display_order: 1 },
    { id: 2, title: 'Panel', speaker_name: 'Bo', starts_at: '2099-01-12T18:00:00Z', display_order: 2 },
  ];
  let m = await mounted('/admin/events/review', { queue, items: queue, agenda: () => json({ agenda }) });
  try {
    assert.match(m.textOf('events-fact-agenda'), /Agenda.*2 items · 2 speakers/s);
    assert.ok(!m.has('events-fact-agenda-list'));
    await m.click('events-fact-agenda-toggle');
    assert.match(m.textOf('events-fact-agenda-list'), /Welcome.*Ana.*Panel.*Bo/s);
  } finally { await m.close(); }
  let fail = true;
  m = await mounted('/admin/events/review', { queue, items: queue, agenda: () => (fail ? json({}, 503) : json({ agenda })) });
  try {
    assert.match(m.textOf('events-fact-agenda'), /Could not be read/);
    assert.ok(!/No agenda items/.test(m.textOf('events-fact-agenda')), 'never "none"');
    fail = false;
    await m.click('events-fact-agenda-retry');
    assert.match(m.textOf('events-fact-agenda'), /2 items · 2 speakers/);
  } finally { await m.close(); }
});

test('the sources: the menu runs the event page\'s own writes and dialogs, and the tabs read through the desk', () => {
  const rows = read('frontend/src/pages/admin/events/RowActions.jsx');
  for (const call of ['adminEvents.setCapacity(ev.id, value)', 'adminEvents.feature(ev.id, next)', 'adminEvents.unpublish(ev.id, note)', 'adminEvents.cancel(ev.id, note)']) {
    assert.ok(rows.includes(call), call);
    assert.ok(read('frontend/src/pages/admin/events/EventPage.jsx').includes(call), `the event page makes the same ${call}`);
  }
  assert.doesNotMatch(rows, /window\.confirm|window\.alert|\bconfirm\(/, 'never a browser pop-up');
  const hook = read('frontend/src/pages/admin/events/useEventsDesk.js');
  assert.match(hook, /const agenda = useRead\('agenda', `agenda:\$\{id\}`, tick, on, \(\) => eventsApi\.agenda\(id\)\);/);
});
