/**
 * D8732 (#8732) — Advisor Studio's Today: each booked session opens its
 * Calendar item and comes back to the same row (boards SAV00 to SAV09 of
 * `design/incoming/Studio Home Advisor Page.dc.html`; owner's option A on
 * Q1, Q2 and Q3, 2026-11-27).
 *
 *   A. advisorToday: a started session stays until its end; a cancelled one is
 *      kept apart and never counted; the next booking for an empty day.
 *   B. advisorTodayView: the day line, rows led by time and person, status
 *      words, the open slot's own label, read time and Stale after 30 minutes.
 *   C. The tile drawn: one link per booked row with its accessible name and
 *      state, the slot as a group with Manage availability, partial, empty,
 *      unavailable and stale, and the focus order.
 *   D. The Calendar drawer: the dated fallback on 503 and 404, the day link,
 *      "changed since Studio read it", whose notes, Open booking on the card.
 *   E. Focus return, CalendarPage handing it back, Practice's focus target.
 *
 * Synthetic bookings only; times are written in Europe/Berlin. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_today_sessions_8732.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { advisorToday, todayState } from '../src/pages/advisor/advisorToday.js';
import {
  STALE_AFTER_MS, ageWords, cancelLine, returnOf, rowState, todayView, unavailableLine,
} from '../src/pages/advisor/advisorTodayView.js';
import { changedSince, fallbackDayHref, fallbackLine, pageHref } from '../src/pages/calendarItemModel.js';
import { recordTarget } from '../src/pages/advisor/practice/PracticeRecordFocus.jsx';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const ZONE = 'Europe/Berlin';
const NOW = new Date('2026-11-26T08:10:00Z'); // 09:10 in Berlin
const ready = (data) => ({ state: 'ready', data });
const loading = { state: 'loading' };
const failed = { state: 'unavailable', failed: true, message: 'boom' };
const sources = [{ kind: 'advisor_booking', ok: true, error: null }];
const calendarOk = (items) => ready({ items, sources });

const booking = (id, from, to, extra = {}) => ({
  id, status: 'confirmed', topic: 'Founder clinic', client_name: 'Maya Ruiz', notes: 'Pricing test.',
  slot_starts_at: `2026-11-26T${from}:00Z`, slot_ends_at: to ? `2026-11-26T${to}:00Z` : null, ...extra,
});
const copy = (id, from, to, extra = {}) => ({
  id: `advisor_booking:${id}`, kind: 'advisor_booking', source_id: id, title: 'Advisor session — Founder clinic', status: 'confirmed',
  start_at: `2026-11-26T${from}:00Z`, end_at: `2026-11-26T${to}:00Z`, location_uri: null,
  attendees: [{ name: 'Jonas Weber', role: 'advisor' }, { name: 'Copy Founder', role: 'mentee' }], ...extra,
});
const MAYA = booking(41, '09:00', '09:45');
const THEO = booking(44, '13:30', '14:15', { client_name: 'Theo Lindqvist' });
const ANA = booking(43, '11:00', '11:45', { client_name: 'Ana Duarte', status: 'cancelled', cancelled_by: 'client', cancel_reason: 'Travel clash' });
const LENA = booking(45, '10:00', '10:30', { client_name: 'Lena Park', status: 'pending' });
const NOSHOW = booking(46, '12:00', '12:45', { client_name: 'Gone Away', status: 'no_show' });
const LATER = { ...booking(50, '09:00', '09:45'), slot_starts_at: '2026-12-01T09:00:00Z', slot_ends_at: '2026-12-01T09:45:00Z' };
const SLOT = { id: 7, starts_at: '2026-11-26T15:00:00Z', ends_at: '2026-11-26T15:45:00Z', capacity: 1, taken: 0 };

const day = (inputs, now = NOW) => advisorToday({
  bookings: ready([MAYA, THEO]),
  calendar: calendarOk([copy(41, '09:00', '09:45', { location_uri: 'https://meet.example.test/abc' }), copy(44, '13:30', '14:15')]),
  slots: ready([SLOT]),
  ...inputs,
}, now);
const at = (iso) => new Date(iso);

// ── A. advisorToday ──────────────────────────────────────────────────────────

test('Q3 A: a session that has started stays on Today until its end, and is marked in progress', () => {
  const started = day({}, at('2026-11-26T09:20:00Z'));
  assert.deepEqual(started.items.map((i) => i.id), [41, 44], 'the 10:00 session is still there at 10:20');
  assert.ok(started.inProgress.has('advisor_booking:41'));
  assert.ok(!started.inProgress.has('advisor_booking:44'));
  const ended = day({}, at('2026-11-26T09:45:00Z'));
  assert.deepEqual(ended.items.map((i) => i.id), [44], 'it leaves at its end');
  const noEnd = day({ bookings: ready([booking(60, '09:00', null)]), calendar: calendarOk([]) }, at('2026-11-26T09:05:00Z'));
  assert.equal(noEnd.items.length, 0, 'with no recorded end it leaves at its start, as before');
});

test('Q2 A: a cancelled booking today is kept apart, never counted as a session; no-show is still dropped', () => {
  const today = day({ bookings: ready([MAYA, THEO, ANA, NOSHOW]) });
  assert.deepEqual(today.items.map((i) => i.id), [41, 44]);
  assert.deepEqual(today.cancelled.map((i) => i.id), [43]);
  const only = day({ bookings: ready([ANA]), calendar: calendarOk([]), slots: ready([]) });
  assert.equal(todayState(only), 'ready', 'a day holding only a cancelled booking still draws it');
  assert.equal(only.items.length, 0);
});

test('the next booking after today comes from the same bookings read', () => {
  const empty = day({ bookings: ready([LATER]), calendar: calendarOk([]), slots: ready([]) });
  assert.equal(todayState(empty), 'empty');
  assert.equal(empty.nextBooking.id, 50);
  assert.equal(day({ bookings: ready([]), calendar: calendarOk([]), slots: ready([]) }).nextBooking, null);
});

// ── B. advisorTodayView ─────────────────────────────────────────────────────

const view = (today, opts = {}) => todayView(today, { now: NOW, readAt: NOW, zone: ZONE, ...opts });

test('SAV00, SAV04 A: the day line names the date, the start and the zone; rows lead with time and person', () => {
  const v = view(day({}));
  assert.equal(v.day, 'Thu 26 Nov 2026');
  assert.equal(v.from, 'From 09:10');
  assert.equal(v.zone, 'Berlin time (UTC+1)');
  assert.equal(v.note, '2 sessions · 1 open slot');
  assert.deepEqual(v.rows.map((r) => [r.time, r.minutes, r.who, r.detail, r.status.word, r.action]), [
    ['10:00–10:45', 45, 'Maya Ruiz', 'Founder clinic · Advisor session · Video link recorded', 'Confirmed', 'Open session'],
    ['14:30–15:15', 45, 'Theo Lindqvist', 'Founder clinic · Advisor session · No place recorded', 'Confirmed', 'Open session'],
  ]);
  // Two sessions on one day with one topic stay distinct: address, focus key and accessible name.
  assert.deepEqual(v.rows.map((r) => r.href), ['/calendar/item/advisor_booking/41', '/calendar/item/advisor_booking/44']);
  assert.deepEqual(v.rows.map((r) => r.focus), ['today-row-41', 'today-row-44']);
  assert.equal(v.rows[0].label, 'Open session: 10:00 to 10:45, Maya Ruiz, Founder clinic, Confirmed');
  assert.notEqual(v.rows[0].label, v.rows[1].label);
  assert.equal(v.readLine, 'Read 09:10 · bookings, calendar and slots');
  assert.equal(v.stale, null);
});

test('SAV04: status, time and action words for each row kind; the open slot is not a booking', () => {
  const v = view(day({ bookings: ready([MAYA, LENA, ANA]), calendar: calendarOk([]) }, at('2026-11-26T09:20:00Z')), { now: at('2026-11-26T09:20:00Z') });
  assert.deepEqual(v.rows.map((r) => [r.time, r.status.glyph, r.status.word, r.action]), [
    ['10:00–10:45', '◉', 'In progress · until 10:45', 'Open session'],
    ['11:00–11:30', '◷', 'Awaiting your answer', 'Open session'],
    ['12:00–12:45', '✕', 'Cancelled', 'View'],
  ]);
  const cancelled = v.rows[2];
  assert.equal(cancelled.detail, 'Cancelled by the founder · ‘Travel clash’');
  assert.equal(cancelled.href, '/calendar/item/advisor_booking/43');
  assert.equal(cancelled.label, 'View cancelled session: 12:00 to 12:45, Ana Duarte, Founder clinic, Cancelled');
  assert.equal(v.note, '2 sessions · 1 cancelled · 1 open slot', 'a cancelled booking is never counted as a session');
  assert.deepEqual(v.slots.map((s) => [s.time, s.minutes, s.label, s.detail, s.href]), [
    ['16:00–16:45', 45, 'Open slot, 16:00 to 16:45, not booked', 'Date-specific · bookable from your public profile', '/practice/sessions'],
  ]);
  assert.equal(cancelLine({ cancelled_by: 'system', cancel_reason: 'slot_cancelled' }), 'Cancelled with its slot', 'a reason code is not quoted');
  assert.equal(cancelLine({}), 'Cancelled');
});

test('the client by name from the calendar copy when only it answered; a missing end omits the length', () => {
  const v = view(day({ bookings: failed, calendar: calendarOk([copy(41, '09:00', '09:45')]) }));
  assert.equal(v.rows[0].who, 'Copy Founder');
  assert.equal(v.rows[0].topic, 'Founder clinic');
  const noEnd = view(day({ bookings: ready([booking(61, '13:00', null)]), calendar: calendarOk([]) }));
  assert.equal(noEnd.rows[0].time, '14:00');
  assert.equal(noEnd.rows[0].minutes, null);
  assert.equal(noEnd.rows[0].detail, 'Founder clinic · Advisor session', 'no calendar copy, so the place is not claimed');
});

test('SAV06F: Stale after 30 minutes names the age; the read line keeps its time', () => {
  const today = day({});
  assert.equal(view(today, { now: new Date(NOW.getTime() + STALE_AFTER_MS - 60_000) }).stale, null);
  const v = view(today, { now: new Date(NOW.getTime() + 125 * 60_000) });
  assert.deepEqual(v.stale, { ago: '2 h 5 min ago', since: '09:10' });
  assert.equal(v.readLine, 'Read 09:10 · 2 h 5 min ago');
  assert.equal(ageWords(35 * 60_000), '35 min ago');
  assert.equal(ageWords(120 * 60_000), '2 h ago');
});

test('SAV06B, SAV06D, SAV06E: partial notes, the empty day\'s next booking, and unavailable never empty', () => {
  const partial = view(day({ calendar: failed, slots: loading }));
  assert.equal(partial.note, '2 sessions · slots still reading');
  assert.deepEqual(partial.failed, ['calendar']);
  assert.deepEqual(partial.pending, ['slots']);
  const empty = view(day({ bookings: ready([LATER]), calendar: calendarOk([]), slots: ready([]) }));
  assert.equal(empty.nextLine, 'Your next booking is on Tue 1 Dec.');
  assert.equal(unavailableLine(['bookings', 'calendar', 'slots']), 'Today could not be read. Your bookings, calendar and slots all failed. This is not the same as an empty day.');
  assert.match(unavailableLine(['calendar']), /Your calendar could not be read/);
});

test('the state a row carries out, and the return Studio trusts', () => {
  const row = view(day({})).rows[0];
  assert.deepEqual(rowState(row, '/studio', 420), {
    from: '/studio', focus: 'today-row-41', scroll: 420,
    today: { who: 'Maya Ruiz', time: '10:00–10:45', day: 'Thu 26 Nov', date: '2026-11-26', readAt: '09:10', status: 'confirmed', statusWord: 'Confirmed', back: 'Back to Studio' },
  });
  assert.deepEqual(returnOf({ focus: 'today-row-41', scroll: 420 }), { focus: 'today-row-41', scroll: 420 });
  assert.deepEqual(returnOf({ focus: 'today-row-41"] , body', scroll: -1 }), { focus: null, scroll: null }, 'a selector injection is never queried');
  assert.deepEqual(returnOf(null), { focus: null, scroll: null });
});

// ── C. The tile drawn ───────────────────────────────────────────────────────

const tileModule = () => sourceModule(read('frontend/src/pages/advisor/AdvisorTodayTile.jsx'), 'pages/advisor/AdvisorTodayTile.jsx');
const draw = (node) => renderToStaticMarkup(React.createElement(MemoryRouter, null, node));
const tile = async (today, opts = {}) => {
  const { todayTile } = await tileModule();
  return todayTile(today, todayState(today), { now: NOW, readAt: NOW, zone: ZONE, from: '/studio', onRetry() {}, onRefresh() {}, ...opts });
};

test('SAV00, SAV01: each booked row is one link to its drawer with its accessible name; the slot is a group with its own action', async () => {
  const spec = await tile(day({}));
  assert.equal(spec.state, 'ready');
  assert.equal(spec.href, '/calendar');
  assert.equal(spec.openLabel, 'Open calendar');
  assert.equal(spec.note, '2 sessions · 1 open slot');
  const html = draw(spec.body);
  const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
  const links = [...html.matchAll(/<a [^>]*data-today-focus[^>]*>/g)].map(([tag]) => [attr(tag, 'href'), attr(tag, 'aria-label'), attr(tag, 'data-today-focus')]);
  assert.deepEqual(links, [
    ['/calendar/item/advisor_booking/41', 'Open session: 10:00 to 10:45, Maya Ruiz, Founder clinic, Confirmed', 'today-row-41'],
    ['/calendar/item/advisor_booking/44', 'Open session: 14:30 to 15:15, Theo Lindqvist, Founder clinic, Confirmed', 'today-row-44'],
  ]);
  assert.match(html, /<li class="att-row att-row--slot" role="group" aria-label="Open slot, 16:00 to 16:45, not booked"/);
  assert.match(html, /<a class="att-slot-act" data-testid="link-advisor-today-manage-availability" href="\/practice\/sessions"[^>]*>Manage availability<\/a>/);
  assert.doesNotMatch(html, /group-advisor-today-slot-7"[^>]*>[^]*?calendar\/item/, 'the slot opens no booking');
  const text = renderedText(html);
  assert.match(text, /Thu 26 Nov 2026From 09:10 · Berlin time \(UTC\+1\)/);
  assert.match(text, /Read 09:10 · bookings, calendar and slots/);
  // Focus order: row 41, row 44, Manage availability (SAV09).
  const order = [...html.matchAll(/data-testid="(link-today-row-\d+|link-advisor-today-manage-availability)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['link-today-row-41', 'link-today-row-44', 'link-advisor-today-manage-availability']);
});

test('SAV06C: a cancelled booking is struck through with its reason and opens View', async () => {
  const html = draw((await tile(day({ bookings: ready([MAYA, ANA, THEO]) }))).body);
  assert.match(html, /<a class="att-row" data-state="cancelled" aria-label="View cancelled session: 12:00 to 12:45, Ana Duarte, Founder clinic, Cancelled" data-today-focus="today-row-43" data-testid="link-today-row-43" href="\/calendar\/item\/advisor_booking\/43"/);
  assert.match(renderedText(html), /Ana DuarteCancelled by the founder · ‘Travel clash’✕CancelledView ›/);
});

test('SAV06B: partial keeps the bookings that answered, names the gap and offers Retry after the rows', async () => {
  const html = draw((await tile(day({ calendar: failed, slots: loading }))).body);
  assert.match(html, /link-today-row-41/);
  assert.match(html, /link-today-row-44/);
  assert.match(html, /Reading slots…/);
  const text = renderedText(html);
  assert.match(text, /◐PartialCould not read your calendar, so this list may be incomplete\. Still reading slots\.\s*Retry/);
  assert.ok(html.indexOf('link-today-row-44') < html.indexOf('button-retry-advisor-today'), 'Retry comes after the rows');
  assert.match(html, /role="status" data-testid="status-advisor-today-partial"/);
});

test('SAV06F: Stale with Refresh comes before the rows; the rows stay', async () => {
  const later = new Date(NOW.getTime() + 125 * 60_000);
  const html = draw((await tile(day({}, NOW), { now: later })).body);
  assert.match(renderedText(html), /◔Stale · read 2 h 5 min agoBookings may have changed since 09:10\.\s*Refresh/);
  assert.ok(html.indexOf('button-refresh-advisor-today') < html.indexOf('link-today-row-41'), 'Refresh comes before the rows');
  assert.doesNotMatch(draw((await tile(day({}))).body), /status-advisor-today-stale/, 'a fresh read is not stale');
});

test('SAV06D: an empty day still has its day line, the next booking and Open calendar', async () => {
  const spec = await tile(day({ bookings: ready([LATER]), calendar: calendarOk([]), slots: ready([]) }));
  assert.equal(spec.href, '/calendar');
  assert.equal(spec.note, 'Nothing scheduled');
  const text = renderedText(draw(spec.body));
  assert.match(text, /Thu 26 Nov 2026/);
  assert.match(text, /No sessions or open slots are scheduled for today\. Every source answered: bookings, calendar and slots\. Your next booking is on Tue 1 Dec\./);
});

test('SAV06E: every source failed is Unavailable with Try again and the day in Calendar, never an empty day', async () => {
  const spec = await tile(day({ bookings: failed, calendar: failed, slots: failed }));
  assert.equal(spec.href, undefined, 'no Open calendar under it: the dated link is the way on');
  const html = draw(spec.body);
  const text = renderedText(html);
  assert.match(text, /⊘UnavailableToday could not be read\. Your bookings, calendar and slots all failed\. This is not the same as an empty day\./);
  assert.match(html, /href="\/calendar\/agenda\?date=2026-11-26"[^>]*>Open Thu 26 Nov in Calendar ›/);
  assert.match(html, /button-retry-advisor-today/);
  assert.doesNotMatch(text, /No sessions or open slots/);
});

test('a loading Today stays the tile\'s loading state', async () => {
  const spec = await tile(day({ bookings: loading, calendar: loading, slots: loading }));
  assert.equal(spec.state, 'loading');
});

test('keyboard: Enter on a row navigates with the state it carries; a modified click is left to the browser', async () => {
  const { todayTile } = await tileModule();
  const spec = todayTile(day({}), 'ready', { now: NOW, readAt: NOW, zone: ZONE, from: '/studio' });
  const ui = await mountForm(spec.body);
  try {
    const link = ui.by('link-today-row-41');
    assert.equal(link.tagName, 'A', 'a link, so Enter activates it');
    let prevented = false;
    await act(async () => ui.props(link).onClick({ button: 0, preventDefault() { prevented = true; } }));
    assert.ok(prevented, 'the plain activation is routed with its state');
    prevented = false;
    await act(async () => ui.props(link).onClick({ button: 0, metaKey: true, preventDefault() { prevented = true; } }));
    assert.equal(prevented, false, 'a new-tab click keeps the link\'s own behaviour');
    assert.equal(ui.props(link).href, '/calendar/item/advisor_booking/41');
  } finally { await ui.unmount(); }
});

// ── D. The Calendar drawer ──────────────────────────────────────────────────

const FALLBACK = { who: 'Maya Ruiz', time: '10:00–10:45', day: 'Thu 26 Nov', date: '2026-11-26', readAt: '09:10', status: 'confirmed', statusWord: 'Confirmed', back: 'Back to Studio' };
const ITEM = {
  id: 'advisor_booking:41', kind: 'advisor_booking', source_id: 41, title: 'Advisor session — Founder clinic', status: 'confirmed',
  start_at: '2026-11-26T09:00:00Z', end_at: '2026-11-26T09:45:00Z', location_uri: 'https://meet.example.test/abc', notes: 'Two pilot offers are out.',
  href: '/practice/sessions', my_role: { code: 'giving', words: 'You give this session' }, can: { rsvp: false, reschedule: false, cancel: false, copy: true },
  people: [{ name: 'Jonas Weber', profile: 'Advisor', stands: 'Invited', answer: null }, { name: 'Maya Ruiz', profile: 'Founder', stands: 'Invited', answer: null }],
  pushed_to: [], time_zone: null,
};

test('the drawer\'s fallback words, the day link, the change note and Open booking\'s address', () => {
  assert.equal(fallbackLine(FALLBACK), 'From your Today list: Maya Ruiz · 10:00–10:45 · Thu 26 Nov');
  assert.equal(fallbackLine(null), null);
  assert.equal(fallbackDayHref(FALLBACK), '/calendar/agenda?date=2026-11-26');
  assert.equal(fallbackDayHref({ date: '26/11' }), null);
  assert.equal(changedSince({ status: 'cancelled' }, FALLBACK), 'Studio showed this as Confirmed at 09:10. This is the current record.');
  assert.equal(changedSince({ status: 'confirmed' }, FALLBACK), null);
  assert.equal(changedSince({ status: 'cancelled' }, null), null);
  assert.equal(pageHref(ITEM), '/practice/sessions?record=session&id=41');
  assert.equal(pageHref({ ...ITEM, href: '/advisors/abc' }), '/advisors/abc', 'another address is left as sent');
  assert.equal(pageHref({ ...ITEM, kind: 'partner_office_hour' }), '/practice/sessions');
});

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function drawer(props, answer) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => response(...answer);
  const { default: Drawer } = await sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
  const ui = await mountForm(h(Drawer, { kind: 'advisor_booking', id: '41', onClose() {}, ...props }), { modal: true });
  for (let i = 0; i < 5; i += 1) await ui.flush();
  const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');
  const say = (n) => { assert.ok(n, 'no such node'); return spaced(n).replace(/\s+/g, ' ').trim(); };
  return { ...ui, say, async done() { await ui.unmount(); globalThis.fetch = previous; } };
}

test('SAV02: from Today, the drawer links the day, says whose notes they are, and Open booking lands on the card', async () => {
  const ui = await drawer({ fallback: FALLBACK }, [{ item: ITEM }, 200]);
  try {
    assert.equal(ui.props(ui.by('cal-item-day')).href, '/calendar/agenda?date=2026-11-26');
    assert.equal(ui.say(ui.by('cal-item-day')), 'See Thu 26 Nov in Calendar ›');
    assert.equal(ui.say(ui.by('cal-item-notes-whose')), 'What Maya Ruiz wrote when booking. Nothing from their venture is shown here.');
    assert.equal(ui.props(ui.by('cal-item-open')).href, '/practice/sessions?record=session&id=41');
    assert.equal(ui.by('cal-item-changed'), undefined, 'unchanged since Today read it');
    assert.equal(ui.by('cal-item-fallback'), undefined, 'the item read, so no fallback');
  } finally { await ui.done(); }
});

test('SAV05C: a booking cancelled since Studio read it says it changed', async () => {
  const ui = await drawer({ fallback: FALLBACK }, [{ item: { ...ITEM, status: 'cancelled', cancel_reason: 'The pilot slipped a week' } }, 200]);
  try {
    assert.equal(ui.say(ui.by('cal-item-changed')), 'Changed since Studio read it Studio showed this as Confirmed at 09:10. This is the current record.');
    assert.equal(ui.say(ui.by('cal-item-why')), 'No actions on a cancelled meeting.');
  } finally { await ui.done(); }
});

test('SAV05A: a 503 keeps Try again and adds the dated fallback from Today\'s read', async () => {
  const ui = await drawer({ fallback: FALLBACK }, [{ error: 'unreadable', detail: 'This item could not be read.' }, 503]);
  try {
    assert.match(ui.say(ui.by('cal-item-state')), /could not be read/i);
    assert.match(ui.say(ui.by('cal-item-fallback')), /^From your Today list: Maya Ruiz · 10:00–10:45 · Thu 26 Nov What Studio read at 09:10\. The session itself is not shown here\. Open Thu 26 Nov in Calendar › Back to Studio$/);
    assert.equal(ui.props(ui.by('cal-item-fallback-day')).href, '/calendar/agenda?date=2026-11-26');
  } finally { await ui.done(); }
});

test('SAV05B: a 404 keeps the not-party refusal, with the same fallback and Back to Studio', async () => {
  let closed = 0;
  const ui = await drawer({ fallback: FALLBACK, onClose() { closed += 1; } }, [{ error: 'not_party' }, 404]);
  try {
    assert.ok(ui.by('cal-item-not-party'));
    assert.doesNotMatch(ui.say(ui.by('cal-item-refused')), /Back to Calendar/);
    assert.match(ui.say(ui.by('cal-item-fallback')), /From your Today list: Maya Ruiz/);
    await act(async () => ui.props(ui.by('cal-item-fallback-back')).onClick());
    assert.equal(closed, 1);
  } finally { await ui.done(); }
});

test('opened from Calendar itself, the drawer adds nothing of Today\'s', async () => {
  const ui = await drawer({}, [{ error: 'not_party' }, 404]);
  try {
    assert.match(ui.say(ui.by('cal-item-refused')), /Back to Calendar/);
    assert.equal(ui.by('cal-item-fallback'), undefined);
  } finally { await ui.done(); }
  const ok = await drawer({}, [{ item: ITEM }, 200]);
  try {
    assert.equal(ok.by('cal-item-day'), undefined);
    assert.equal(ok.say(ok.by('cal-item-notes-whose')), 'What Maya Ruiz wrote when booking. Nothing from their venture is shown here.', 'the founder from the people list');
  } finally { await ok.done(); }
});

// ── E. Focus return, CalendarPage, Practice ─────────────────────────────────

test('SAV03: back on Studio, scroll and focus return to the row once Today has settled; the heading when the row has gone', async () => {
  const { useTodayReturn } = await tileModule();
  const Probe = ({ state, settled }) => { useTodayReturn(state, settled); return null; };
  const ui = await mountForm(h(Probe, { state: { focus: 'today-row-41', scroll: 420 }, settled: false }));
  const focused = [];
  const scrolled = [];
  const row = { focus: () => focused.push('row'), setAttribute() {} };
  const previousWindow = globalThis.window;
  globalThis.window = { ...(previousWindow || {}), scrollTo: (x, y) => scrolled.push(y) };
  const asked = [];
  ui.doc.querySelector = (selector) => { asked.push(selector); return selector === '[data-today-focus="today-row-41"]' ? row : null; };
  try {
    assert.deepEqual(focused, [], 'nothing before Today settles');
    await ui.render(h(Probe, { state: { focus: 'today-row-41', scroll: 420 }, settled: true }));
    assert.deepEqual(focused, ['row']);
    assert.deepEqual(scrolled, [420]);
    // Today read again (Refresh, Retry): it settles a second time, and focus stays where the advisor put it.
    await ui.render(h(Probe, { state: { focus: 'today-row-41', scroll: 420 }, settled: false }));
    await ui.render(h(Probe, { state: { focus: 'today-row-41', scroll: 420 }, settled: true }));
    assert.deepEqual(focused, ['row'], 'once per mount');
    assert.deepEqual(scrolled, [420]);
  } finally { await ui.unmount(); globalThis.window = previousWindow; }

  const gone = await mountForm(h(Probe, { state: { focus: 'today-row-99' }, settled: false }));
  const heading = { attrs: {}, focus() { focused.push('heading'); }, setAttribute(k, v) { this.attrs[k] = v; } };
  gone.doc.querySelector = (selector) => (selector === '[data-testid="studio-tile-today"] h3' ? heading : null);
  try {
    await gone.render(h(Probe, { state: { focus: 'today-row-99' }, settled: true }));
    assert.deepEqual(focused, ['row', 'heading']);
    assert.equal(heading.attrs.tabindex, '-1');
  } finally { await gone.unmount(); }
});

test('CalendarPage hands the drawer Today\'s read and gives the row back on close', () => {
  const page = codeOnly(read('frontend/src/pages/CalendarPage.jsx'));
  assert.match(page, /fallback=\{location\.state\?\.today \|\| null\}/);
  assert.match(page, /onClose=\{\(\) => navigate\(behind, location\.state\?\.focus \? \{ state: \{ focus: location\.state\.focus, scroll: location\.state\.scroll \} \} : undefined\)\}/);
});

test('AdvisorStudioHome builds Today through the new tile, from its own address, with Refresh and the return', () => {
  const home = codeOnly(read('frontend/src/pages/advisor/AdvisorStudioHome.jsx'));
  assert.match(home, /todayTile\(today, todayKind, \{/);
  assert.match(home, /from: `\$\{location\.pathname\}\$\{location\.search \|\| ''\}`/);
  assert.match(home, /useTodayReturn\(location\.state, todayKind !== 'loading' && bookings\.state !== 'loading'\)/);
  assert.match(home, /onRefresh: clock\.getTime\(\) - readAt\.getTime\(\) >= STALE_AFTER_MS \? refreshToday : null/);
  assert.match(home, /if \(!keeping\.current\) set\(loading\);/, 'Refresh keeps the rows while it reads');
});

test('Practice › Sessions: the focus target is the card SessionActions draws', () => {
  assert.equal(recordTarget('/practice/sessions', '?record=session&id=41'), 'session-card-41');
  assert.match(read('frontend/src/pages/advisor/practice/SessionActions.jsx'), /data-testid=\{`session-card-\$\{b\.id\}`\}/);
});
