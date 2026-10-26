// D1210 (#3176) — Calendar part 5: the month grid (CAL1), the week time grid
// (CAL2, CAL20 dark), the agenda (CAL3), the Kinds filter (CAL6) with ?kinds=,
// ?needs=1 and ?date=, the day popover (CAL12), the Explorer (CAL14), and the
// states (CAL15–CAL17). Keyboard movement in the grids, screen-reader day
// labels, no zero for a missing count, and the dark-mode tokens.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_grids_d1210.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CalendarPage from '../src/pages/CalendarPage.jsx';
import {
  HOURS, anchorOf, byDay, cellItems, dayKey, dayLabel, familiesFor, familyCounts, isAllDay, kindsFrom, layoutDay, monthCells,
  moveFocus, needsFrom, needsMe, nowLine, parseDay, quickKinds, shiftAnchor, weekDays, withDate, withKinds, withNeeds,
} from '../src/pages/calendarGrid.js';
import { FAMILIES, windowFor } from '../src/pages/calendarViews.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const at = (d, hh, mm = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString();

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the month: six Monday-first weeks, the month and today marked; a day names itself and its count, never a 0 for an unread list', () => {
  // Mutation checked: Sunday-first (`getDay()` without the +6) → the first cell is not a Monday; the count left in for an unread list.
  const nov = new Date(2026, 10, 1);
  const cells = monthCells(nov, new Date(2026, 10, 12));
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-10-26', 'the Monday before 1 November');
  assert.equal(cells[0].date.getDay(), 1);
  assert.deepEqual(cells.filter((c) => c.inMonth).length, 30);
  assert.deepEqual(cells.filter((c) => c.isToday).map((c) => c.key), ['2026-11-12']);
  assert.equal(dayLabel(new Date(2026, 10, 12), 3), 'Thursday 12 November, 3 items');
  assert.equal(dayLabel(new Date(2026, 10, 12), 1), 'Thursday 12 November, 1 item');
  assert.equal(dayLabel(new Date(2026, 10, 12), 0), 'Thursday 12 November, no items');
  assert.equal(dayLabel(new Date(2026, 10, 12), null), 'Thursday 12 November', 'no count when the list was not read');
  assert.deepEqual(weekDays(new Date(2026, 10, 12)).map(dayKey), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  const c = cellItems([1, 2, 3, 4, 5]);
  assert.deepEqual([c.shown, c.more], [[1, 2, 3], 2], 'three, then +2 more');
});

test('keyboard: arrows move a day, up and down a week, Home and End the week\'s ends, never out of the grid', () => {
  // Mutation checked: ArrowDown as +1 → a day, not a week; the clamp dropped → off the grid.
  assert.equal(moveFocus(10, 'ArrowRight', 42), 11);
  assert.equal(moveFocus(10, 'ArrowLeft', 42), 9);
  assert.equal(moveFocus(10, 'ArrowDown', 42), 17);
  assert.equal(moveFocus(10, 'ArrowUp', 42), 3);
  assert.equal(moveFocus(10, 'Home', 42), 7);
  assert.equal(moveFocus(10, 'End', 42), 13);
  assert.equal(moveFocus(0, 'ArrowLeft', 42), 0);
  assert.equal(moveFocus(40, 'ArrowDown', 42), 41);
  assert.equal(moveFocus(3, 'a', 42), null, 'any other key does not move');
});

test('the week: items on 07:00–21:00, overlaps side by side, a missing end said, outside hours clipped; the now line only today', () => {
  // Mutation checked: lanes not reset per cluster → a later lone item drawn half width; `of` from the whole day.
  const d = new Date(2026, 10, 11);
  const placed = layoutDay([
    { id: 'a', start_at: at(d, 12), end_at: at(d, 13) },
    { id: 'b', start_at: at(d, 12, 30), end_at: at(d, 13, 30) },
    { id: 'c', start_at: at(d, 16), end_at: at(d, 17) },
    { id: 'd', start_at: at(d, 9), end_at: null },
    { id: 'e', start_at: at(d, 6), end_at: at(d, 8) },
    { id: 'f', start_at: at(d, 22), end_at: at(d, 23) },
    { id: 'g', start_at: at(d, 0), end_at: new Date(d.getTime() + 86_400_000).toISOString() },
  ]);
  const by = Object.fromEntries(placed.map((p) => [p.ev.id, p]));
  assert.deepEqual([by.a.lane, by.a.of, by.b.lane, by.b.of], [0, 2, 1, 2], 'two overlapping bookings side by side');
  assert.deepEqual([by.c.lane, by.c.of], [0, 1], 'a later item alone has the whole width');
  assert.equal(by.d.noEnd, true);
  assert.equal(by.e.clipped, true);
  assert.equal(by.e.top, 0);
  assert.equal(by.f.hidden, true, 'after 21:00 is outside the hours');
  assert.equal(by.g, undefined, 'an all-day item is not on the hours');
  assert.equal(isAllDay({ start_at: at(d, 0), end_at: new Date(d.getTime() + 86_400_000).toISOString() }), true);
  assert.equal(by.a.top, ((12 - HOURS.from) * 60 / ((HOURS.to - HOURS.from) * 60)) * 100);
  assert.equal(nowLine(d, new Date(2026, 10, 11, 14, 0)), (7 * 60 / (14 * 60)) * 100);
  assert.equal(nowLine(d, new Date(2026, 10, 12, 14, 0)), null, 'another day draws no line');
  assert.equal(nowLine(d, new Date(2026, 10, 11, 22, 0)), null, 'outside the hours draws no line');
  const grouped = byDay([{ id: 'x', start_at: 'not a date' }, { id: 'y', start_at: at(d, 9) }]);
  assert.equal(grouped.unplaced, 1, 'an item with no readable start is counted, not dropped silently');
});

test('the address: ?date= anchors the view and steps a month or a week; ?kinds= and ?needs=1 narrow it; unknown words are ignored', () => {
  // Mutation checked: an invalid day accepted (31 Feb) → the anchor rolls over; an unknown kind kept in ?kinds=.
  assert.equal(dayKey(anchorOf('?date=2026-11-12')), '2026-11-12');
  assert.equal(parseDay('2026-02-31'), null, 'not a real day');
  assert.equal(dayKey(anchorOf('?date=nope', new Date(2026, 10, 3, 15))), '2026-11-03', 'today otherwise');
  assert.equal(dayKey(shiftAnchor('month', new Date(2026, 10, 12), 1)), '2026-12-01');
  assert.equal(dayKey(shiftAnchor('week', new Date(2026, 10, 12), -1)), '2026-11-05');
  assert.equal(windowFor('month', new Date(2026, 10, 12)).from.getMonth(), 10, 'the window follows the anchor');
  const today = new Date(2026, 10, 3);
  assert.equal(withDate('?kinds=ic_meeting', new Date(2026, 11, 1), today), '?kinds=ic_meeting&date=2026-12-01');
  assert.equal(withDate('?date=2026-12-01', today, today), '', 'today drops the date');
  const allowed = FAMILIES.flatMap((f) => f.kinds);
  assert.deepEqual([...kindsFrom('?kinds=ic_meeting,bogus', allowed)], ['ic_meeting']);
  assert.equal(kindsFrom('?kinds=bogus', allowed), null, 'nothing known left is everything');
  assert.equal(kindsFrom('', allowed), null);
  assert.equal(withKinds('?date=2026-12-01', new Set(allowed), allowed), '?date=2026-12-01', 'every kind is no parameter');
  assert.equal(withKinds('', new Set(['event_ticket', 'ic_meeting']), allowed), `?kinds=${encodeURIComponent('event_ticket,ic_meeting')}`);
  assert.equal(needsFrom('?needs=1'), true);
  assert.equal(withNeeds('?needs=1', false), '');
  assert.equal(quickKinds('everything', allowed), null);
  assert.equal(quickKinds('no-deadlines', allowed).size, allowed.length, 'Deadlines carry no kind yet');
});

test('the Kinds panel counts: a family sums its kinds, says how many are unread, and has no count when the list was not read', () => {
  // Mutation checked: an unread kind summed as 0 into the total without saying so; a total of 0 for an unread list.
  const fams = familyCounts(FAMILIES, { event_ticket: 2, event_hosted: 1, ic_meeting: '—', founder_checkin: 3, investor_meeting: 0 });
  const by = Object.fromEntries(fams.map((f) => [f.key, f]));
  assert.equal(by.events.total, 3);
  assert.deepEqual([by.meetings.total, by.meetings.unread], [3, ['ic_meeting']]);
  assert.equal(by.deadlines.total, null, 'a family with no kinds has no count');
  assert.ok(familyCounts(FAMILIES, {}).every((f) => f.total === null), 'no list, no count');
});

test('the Explorer: Events and From other calendars only; "needs me" is an invitation you have not answered', () => {
  assert.deepEqual(familiesFor('exploring').map((f) => f.key), ['events', 'other']);
  assert.equal(familiesFor('founder').length, 5);
  const ev = { attendees: [{ email: 'f@example.com', rsvp: 'invited' }, { email: 'g@example.com', rsvp: 'accepted' }] };
  assert.equal(needsMe(ev, 'f@example.com'), true);
  assert.equal(needsMe(ev, 'g@example.com'), false);
  assert.equal(needsMe(ev, 'h@example.com'), false);
  assert.equal(needsMe(ev, null), false);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const KINDS9 = ['ic_meeting', 'founder_checkin', 'advisor_booking', 'partner_office_hour', 'calendly_event', 'expert_booking', 'event_ticket', 'event_hosted', 'investor_meeting'];
const ok = (fail = []) => KINDS9.map((kind) => ({ kind, ok: !fail.includes(kind), error: fail.includes(kind) ? 'down' : null }));
const EV = (id, kind, start, end, o = {}) => ({ id: `${kind}:${id}`, source_id: id, kind, title: `${kind} ${id}`, start_at: start, end_at: end, ...o });
const ITEMS = [
  EV(1, 'ic_meeting', at(TODAY, 12), at(TODAY, 13), { attendees: [{ email: 'f@example.com', rsvp: 'invited' }] }),
  EV(2, 'founder_checkin', at(TODAY, 12, 30), at(TODAY, 13, 30)),
  EV(3, 'event_ticket', at(TODAY, 15), at(TODAY, 16)),
  EV(4, 'calendly_event', at(TODAY, 17), null),
  EV(5, 'advisor_booking', at(TODAY, 18), at(TODAY, 19)),
];

async function mounted(url, { events = { items: ITEMS, sources: ok() }, role = 'founder', fail = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    if (path.startsWith('/calendar/events')) return fail ? response({ detail: 'down' }, 503) : response(events);
    return response({ configured: false, connected: false });
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify({ id: 3, role, name: 'F', email: 'f@example.com' }));
  const seen = { location: null };
  const Spy = () => { seen.location = useLocation(); return null; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const page = h(React.Fragment, null, h(CalendarPage), h(Spy));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/calendar', element: page }), h(Route, { path: '/calendar/week', element: page }), h(Route, { path: '/calendar/agenda', element: page }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    requests, by, pr, seen, flush,
    has: (id) => Boolean(by(id)),
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onClick?.({ preventDefault() {} })); await flush(); },
    async change(id, checked) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onChange?.({ target: { checked } })); await flush(); },
    async key(id, k) { const n = by(id); await act(async () => pr(n).onKeyDown?.({ key: k, preventDefault() {} })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

const TK = dayKey(TODAY);

test('Month (CAL1): today ringed and named with its count; three items, then "+N more", which opens the day popover (CAL12)', async () => {
  // Mutation checked: the popover listing three, not every item; the cell label without its count.
  const v = await mounted('/calendar');
  try {
    assert.ok(v.has('cal-month') && !v.has('cal-week'));
    assert.equal(v.pr(v.by(`cal-mday-${TK}`))['aria-label'], dayLabel(TODAY, 5));
    assert.equal(v.pr(v.by(`cal-mday-${TK}`))['aria-current'], 'date');
    assert.equal(v.text(`cal-more-${TK}`).replace('+ ', '+'), '+2 more');
    assert.equal(v.ids().filter((id) => id.startsWith('cal-gchip-')).length, 3, 'three chips in the cell');
    await v.click(`cal-more-${TK}`);
    assert.ok(v.has('cal-day-popover'));
    assert.equal(v.ids().filter((id) => id.startsWith('cal-pop-')).length, 5, 'every item that day');
    assert.equal(v.pr(v.by('cal-gchip-ic_meeting:1')).href, '/calendar/item/ic_meeting/1', 'each opens its drawer');
  } finally { await v.close(); }
});

test('the month grid moves with the keyboard: one tab stop, arrows move it', async () => {
  // Mutation checked: the tab stop starting on the 1st when today is in the month (the first try's bug, caught here).
  const v = await mounted('/calendar');
  try {
    const stops = v.ids().filter((id) => id.startsWith('cal-mday-') && v.pr(v.by(id)).tabIndex === 0);
    assert.deepEqual(stops, [`cal-mday-${TK}`], 'one tab stop, on today');
    await v.key(`cal-mday-${TK}`, 'ArrowRight');
    const next = dayKey(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 1));
    const after = v.ids().filter((id) => id.startsWith('cal-mday-') && v.pr(v.by(id)).tabIndex === 0);
    // The next day may sit in the following month, outside this grid's cells only when today is the grid's last cell.
    assert.ok(after.length === 1 && after[0] !== `cal-mday-${TK}`, 'the tab stop moved');
    if (v.has(`cal-mday-${next}`)) assert.deepEqual(after, [`cal-mday-${next}`]);
  } finally { await v.close(); }
});

test('Week (CAL2): the all-day row, two overlapping bookings side by side, the now line today, and day headers with counts', async () => {
  const allDay = EV(9, 'event_hosted', new Date(TODAY).toISOString(), new Date(TODAY.getTime() + 86_400_000).toISOString());
  const v = await mounted('/calendar/week', { events: { items: [...ITEMS, allDay], sources: ok() } });
  try {
    assert.ok(v.has('cal-week') && !v.has('cal-month'));
    assert.ok(v.text('cal-allday').includes('event_hosted 9'));
    const a = v.pr(v.by('cal-wev-ic_meeting:1')).style; const b = v.pr(v.by('cal-wev-founder_checkin:2')).style;
    assert.deepEqual([a.width, a.left, b.width, b.left], ['50%', '0%', '50%', '50%']);
    assert.equal(v.pr(v.by('cal-wev-event_ticket:3')).style.width, '100%');
    assert.ok(v.text('cal-wev-calendly_event:4').includes('End not recorded'));
    assert.equal(v.pr(v.by(`cal-wday-${TK}`))['aria-label'], dayLabel(TODAY, 6));
    const hour = new Date().getHours();
    if (hour >= 7 && hour < 21) assert.ok(v.has('cal-now'), 'the now line, today, within the hours');
  } finally { await v.close(); }
});

test('the Kinds filter (CAL6): families with counts, a dash and why for a source that did not answer; Show N items writes ?kinds=', async () => {
  // Mutation checked: the panel counting the pool (narrowed) instead of the one list.
  const v = await mounted('/calendar?date=' + TK, { events: { items: ITEMS, sources: ok(['partner_office_hour']) } });
  try {
    assert.equal(v.text('cal-kinds'), 'Kinds 9 on');
    await v.click('cal-kinds');
    assert.ok(v.text('cal-fam-meetings').startsWith('Meetings 2'));
    assert.ok(v.text('cal-fam-sessions').includes('and 1 unread'));
    assert.ok(v.text('cal-fam-sessions').includes('— · Could not be read'));
    await v.change('cal-fam-box-sessions', false);
    await v.change('cal-fam-box-other', false);
    assert.equal(v.text('cal-kinds-show'), 'Show 3 items');
    await v.click('cal-kinds-show');
    const q = new URLSearchParams(v.seen.location.search);
    assert.deepEqual(q.get('kinds').split(','), ['event_ticket', 'event_hosted', 'ic_meeting', 'founder_checkin', 'investor_meeting']);
    assert.equal(q.get('date'), TK, 'the date stays');
    assert.equal(v.text('cal-kinds'), 'Kinds 5 on');
    assert.ok(!v.has('cal-gchip-calendly_event:4') && !v.has('cal-gchip-advisor_booking:5'));
    assert.ok(v.has('cal-kinds-clear'));
  } finally { await v.close(); }
});

test('?needs=1 shows only what waits on your answer; filtered to nothing says so and offers Show everything (CAL15 B)', async () => {
  let v = await mounted('/calendar/agenda?needs=1');
  try {
    assert.equal(v.text('cal-kinds'), 'Kinds needs me');
    assert.ok(v.text().includes('ic_meeting 1') && !v.text().includes('event_ticket 3'));
  } finally { await v.close(); }
  v = await mounted('/calendar?kinds=expert_booking');
  try {
    assert.ok(v.text('cal-empty-filtered').includes('None of the kinds you chose'));
    assert.ok(v.text('cal-empty-filtered').includes('5 items of other kinds'));
  } finally { await v.close(); }
});

test('the states (CAL16, CAL17): nothing answered shows no grid and no count; Agenda is the day list (CAL3)', async () => {
  let v = await mounted('/calendar', { fail: true });
  try {
    assert.ok(!v.has('cal-month'), 'no grid of empty days for a calendar that was not read');
    assert.equal(v.text('cal-kinds'), 'Kinds 9 on');
    await v.click('cal-kinds');
    assert.ok(!/\b0\b/.test(v.text('cal-kinds-panel').replace(/\?kinds=…/, '')), 'no zero in the panel for an unread list');
    assert.equal(v.text('cal-kinds-show'), 'Show these kinds');
  } finally { await v.close(); }
  v = await mounted('/calendar/agenda');
  try { assert.ok(!v.has('cal-month') && !v.has('cal-week') && v.text().includes('ic_meeting 1')); } finally { await v.close(); }
});

test('the Explorer (CAL14): reaches the calendar, sees Events and From other calendars, and no New', async () => {
  const v = await mounted('/calendar', { role: 'exploring', events: { items: [ITEMS[2], ITEMS[3]], sources: ok() } });
  try {
    assert.ok(!v.has('cal-new-menu') && !v.ids().some((id) => id.startsWith('cal-new')), 'no New');
    await v.click('cal-kinds');
    assert.deepEqual(v.ids().filter((id) => /^cal-fam-[a-z]+$/.test(id)), ['cal-fam-events', 'cal-fam-other']);
    assert.equal(v.text('cal-kinds'), 'Kinds 3 on');
  } finally { await v.close(); }
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  for (const p of ['/calendar', '/calendar/week', '/calendar/agenda', '/calendar/item/:kind/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CalendarPage />)} />`), p);
  }
  assert.match(app, /const calendarCurrent = \/\^\\\/calendar\(\\\/\|\$\)\/\.test\(accountPath\);/);
  assert.match(app, /data-testid="account-calendar-current">Current</);
});

test('dark (CAL20): every colour the grids use is a token, so `.dark .cal` gives the dark one', () => {
  const css = readFileSync('frontend/src/pages/calendarPage.css', 'utf8');
  const mine = css.slice(css.lastIndexOf('/*', css.indexOf('D1210 (#3176)')));
  assert.ok(mine.length > 200);
  const rules = mine.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules.replace(/rgba\(24, 24, 27, \.18\)/, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'a colour outside the tokens');
  assert.match(rules, /\.cal-now \{[^}]*var\(--cal-accent\)/, 'the now line is the accent token (#a78bfa in the dark)');
  const darkBlock = css.slice(css.indexOf('.dark .cal {'), css.indexOf('}', css.indexOf('.dark .cal {')));
  assert.match(darkBlock, /--cal-accent: #a78bfa/i, 'violet becomes #a78bfa in the dark (CAL20)');
});
