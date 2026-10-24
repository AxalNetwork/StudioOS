/**
 * D919 (#2702) — the Events desk, part 4: the Calendar tab (EV8 month, EV8w
 * week, EV17e list) and All events made complete (EV6, EV17d).
 *
 * What this file holds the desk to:
 *   · the month runs Monday to Sunday, three chips a day and "+n more"; an
 *     event sits on the day it happens where it happens;
 *   · D915 §2's clash rule: neither cancelled, times overlap, no end = one
 *     hour; a day's "[n] overlap"; the week puts overlaps side by side;
 *   · the chips and their legend, the chip card's seats under Guard G, and the
 *     address keeping the month, the view and the filters;
 *   · All events' filters, views, sorts and page sizes, worked out in the
 *     browser and never guessing a count Guard G cannot trust;
 *   · the CSV: the rows on screen, counts only, the table's own words, made in
 *     the browser, safe to open in a spreadsheet;
 *   · mounted against a stubbed Worker: the tab, the chip card, the day,
 *     the views, the filters, the CSV and the phone cards.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_events_calendar_d919.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import { DAY_MS, NOT_HELD, NOT_IN_READ, analyticsJoin, statusWord } from '../src/pages/admin/events/eventsDeskModel.js';
import {
  CALENDAR_PATH, CHIPS_PER_DAY, LEGEND, blockBox, calendarSearch, calendarState, chipStyle, clashMap, laneOut, mondayOf,
  monthGrid, monthList, placeOf, seatsLine, todayKey, unplacedLine, weekGrid,
} from '../src/pages/admin/events/calendarModel.js';
import {
  ATTENTION_NOTE, COUNTS_NEEDED, CSV_COLUMNS, attentionReasons, csvCell, csvFor, csvName, filterCount, filteredRows,
  isFull, isLowSignups, matchesFilters, priceMatches, readQuery, whenMatches, writeQuery,
} from '../src/pages/admin/events/allEventsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

// shapeEvent(row, { includePrivate: true }) — `eventsCommon.ts`
const ev = (id, o = {}) => ({
  id, slug: `ev-${id}`, title: `Event ${id}`, type: 'meetup', starts_at: '2027-03-10T18:00:00Z', ends_at: null, timezone: 'UTC',
  capacity: 40, waitlist_enabled: true, visibility: 'public', status: 'published', featured: false, price_cents: 0, currency: 'usd',
  created_at: '2026-10-01 09:00:00', admin_published: true, audience_rules: {}, ...o,
});
// GET /api/admin/events/analytics — one per-event row
const row = (id, registrations, attended = 0, waitlisted = 0) => ({ id, registrations, attended, waitlisted, cancelled: 0, conversion: 0 });
const ready = (data) => ({ status: 'ready', data });
const joined = (rows, known = rows.length) => analyticsJoin(ready({ events: rows }), known);

/* ------------------------------------------------------------------ *
 * The month
 * ------------------------------------------------------------------ */

test('the month runs Monday to Sunday, from the Monday before the 1st to the Sunday after the last day', () => {
  const g = monthGrid([], '2026-11', Date.parse('2026-11-10T12:00:00Z'));
  assert.equal(g.label, 'November 2026');
  assert.equal(g.weeks[0][0].key, '2026-10-26', 'the 1st is a Sunday, so the grid opens on the Monday before');
  assert.equal(g.weeks.at(-1)[6].key, '2026-12-06');
  assert.equal(g.weeks.length, 6);
  for (const w of g.weeks) assert.equal(w.length, 7);
  assert.equal(g.weeks[0][0].inMonth, false);
  assert.equal(g.weeks[0][6].inMonth, true, '1 November');
  const feb = monthGrid([], '2027-02', 0);
  assert.equal(feb.weeks[0][0].key, '2027-02-01', 'February 2027 starts on a Monday');
  assert.equal(feb.weeks.length, 4, 'and fits four weeks exactly');
});

test('a day shows three chips in start order, then "+n more"; today is marked', () => {
  const day = (h, id, o = {}) => ev(id, { starts_at: `2027-03-10T${h}:00:00Z`, ...o });
  const list = [day('15', 1), day('09', 2), day('12', 3), day('18', 4), day('20', 5)];
  const d = monthGrid(list, '2027-03', Date.parse('2027-03-10T08:00:00')).weeks.flat().find((x) => x.key === '2027-03-10');
  assert.deepEqual(d.chips.map((c) => c.id), ['2', '3', '1'], `${CHIPS_PER_DAY} chips, soonest first`);
  assert.equal(d.more, 2);
  assert.equal(d.events.length, 5, '"+n more" opens all of them');
  assert.equal(d.today, true, "the viewer's own date");
  assert.equal(d.chips[0].time, '09:00');
});

test('an event sits on the day and at the time it happens where it happens', () => {
  // 23:30 UTC on 14 March is 08:30 on 15 March in Tokyo.
  const tokyo = ev(1, { starts_at: '2027-03-14T23:30:00Z', timezone: 'Asia/Tokyo' });
  assert.deepEqual([placeOf(tokyo).day, placeOf(tokyo).startMinute], ['2027-03-15', 8 * 60 + 30]);
  // A zone Intl does not know is drawn in UTC, as the rest of the desk does.
  assert.equal(placeOf(ev(2, { starts_at: '2027-03-14T23:30:00Z', timezone: 'Mars/Olympus' })).day, '2027-03-14');
  assert.equal(placeOf(ev(3, { starts_at: null })), null);
  const g = monthGrid([tokyo, ev(3, { starts_at: null })], '2027-03', 0);
  assert.equal(g.unplaced, 1);
  assert.equal(unplacedLine(1), 'One event has no start date, so it is not on the calendar.');
  assert.equal(unplacedLine(3), '3 events have no start date, so they are not on the calendar.');
  assert.equal(unplacedLine(0), null);
});

/* ------------------------------------------------------------------ *
 * The clash rule (D915 §2)
 * ------------------------------------------------------------------ */

test('two events clash when neither is cancelled and their times overlap; no end is one hour', () => {
  const at = (id, start, end = null, o = {}) => ev(id, { starts_at: `2027-03-10T${start}:00Z`, ends_at: end ? `2027-03-10T${end}:00Z` : null, ...o });
  const pairs = (list) => [...clashMap(list)].map(([k, v]) => [k, [...v].sort()]).sort();
  assert.deepEqual(pairs([at(1, '18:00', '20:00'), at(2, '19:30', '21:00')]), [['1', ['2']], ['2', ['1']]]);
  assert.deepEqual(pairs([at(1, '18:00', '19:00'), at(2, '19:00', '20:00')]), [], 'one ends as the other starts: no clash');
  assert.deepEqual(pairs([at(1, '18:00'), at(2, '19:00')]), [], 'no end lasts one hour, so 18:00 and 19:00 do not clash');
  assert.deepEqual(pairs([at(1, '18:00'), at(2, '18:59')]), [['1', ['2']], ['2', ['1']]], 'but 18:59 does');
  assert.deepEqual(pairs([at(1, '18:00', '20:00'), at(2, '19:00', '20:00', { status: 'cancelled' })]), [], 'a cancelled event clashes with nothing');
  assert.deepEqual(pairs([at(1, '18:00', '20:00', { status: 'draft' }), at(2, '19:00', '20:00', { status: 'rejected' })]).length, 2, 'drafts and sent-back events still clash');
  // 18:00 in Lisbon (UTC+0 in March) and 19:00 in Berlin (UTC+1) are the same instant.
  const lisbon = ev(3, { starts_at: '2027-03-10T18:00:00Z', timezone: 'Europe/Lisbon' });
  const berlin = ev(4, { starts_at: '2027-03-10T18:00:00Z', timezone: 'Europe/Berlin' });
  assert.equal(clashMap([lisbon, berlin]).get('3').has('4'), true, 'compared by the stored instants, not the local hours');
});

test('a day with a clash counts its overlapping events; the list says so on each of them', () => {
  const list = [
    ev(1, { starts_at: '2027-03-14T18:00:00Z', ends_at: '2027-03-14T20:00:00Z' }),
    ev(2, { starts_at: '2027-03-14T18:30:00Z', ends_at: '2027-03-14T20:30:00Z' }),
    ev(3, { starts_at: '2027-03-14T09:00:00Z' }),
    ev(4, { starts_at: '2027-03-14T19:00:00Z', status: 'cancelled' }),
  ];
  const d = monthGrid(list, '2027-03', 0).weeks.flat().find((x) => x.key === '2027-03-14');
  assert.equal(d.overlap, 2, 'the two that overlap; not the morning one or the cancelled one');
  const rows = monthList(list, '2027-03').rows;
  assert.deepEqual(rows.map((r) => r.line), ['09:00', '18:00 · 2 overlap', '18:30 · 2 overlap', '19:00']);
  assert.deepEqual(rows[0].day, { m: 'MAR', d: '14', w: 'SUN' });
  assert.equal(monthList(list, '2027-04').rows.length, 0, 'the list holds its own month only');
});

/* ------------------------------------------------------------------ *
 * The week
 * ------------------------------------------------------------------ */

test('the week sets overlapping events side by side, and a lone event takes the whole column', () => {
  const list = [
    ev(1, { starts_at: '2027-03-13T18:00:00Z', ends_at: '2027-03-13T20:00:00Z' }),
    ev(2, { starts_at: '2027-03-13T18:30:00Z', ends_at: '2027-03-13T20:30:00Z' }),
    ev(3, { starts_at: '2027-03-13T18:30:00Z', ends_at: '2027-03-13T21:00:00Z', status: 'pending_review' }),
    ev(4, { starts_at: '2027-03-09T17:00:00Z', ends_at: '2027-03-09T18:00:00Z' }),
    ev(5, { starts_at: '2027-03-13T21:00:00Z' }),
  ];
  const g = weekGrid(list, '2027-03-08', 0);
  assert.equal(g.label, 'Week of 8 Mar');
  assert.deepEqual(g.cols.map((c) => c.label), ['Mon 8', 'Tue 9', 'Wed 10', 'Thu 11', 'Fri 12', 'Sat 13', 'Sun 14']);
  const sat = Object.fromEntries(g.cols[5].events.map((e) => [e.id, [e.lane, e.lanes]]));
  assert.deepEqual(sat, { 1: [0, 3], 2: [1, 3], 3: [2, 3], 5: [0, 1] }, 'three side by side; the later one alone');
  assert.deepEqual(Object.fromEntries(g.cols[1].events.map((e) => [e.id, [e.lane, e.lanes]])), { 4: [0, 1] });
  assert.equal(g.cols[5].overlap, 3);
  assert.deepEqual([g.from, g.to], [8 * 60, 22 * 60], '08:00 at least, and to the hour after the latest end');
  const b = blockBox(g.cols[5].events.find((e) => e.id === '2'), g);
  assert.deepEqual([Math.round(b.left), Math.round(b.width)], [33, 33]);
  assert.ok(b.top > 0 && b.height > 0);
  // A freed lane is reused: A 18–19, B 18–20, C 19–20 → C takes A's lane.
  const lanes = laneOut([
    { id: 'A', place: { startMinute: 1080, endMinute: 1140 } }, { id: 'B', place: { startMinute: 1080, endMinute: 1200 } }, { id: 'C', place: { startMinute: 1140, endMinute: 1200 } },
  ]);
  assert.deepEqual(lanes.map((e) => [e.id, e.lane, e.lanes]), [['A', 0, 2], ['B', 1, 2], ['C', 0, 2]]);
});

/* ------------------------------------------------------------------ *
 * Chips, the card, the address
 * ------------------------------------------------------------------ */

test('the chips: Published plain, Waiting dashed with "Review", Draft and Sent back muted with the word, Cancelled struck', () => {
  assert.deepEqual(chipStyle('published'), { tone: 'plain', word: '' });
  assert.deepEqual(chipStyle('pending_review'), { tone: 'review', word: 'Review' });
  assert.deepEqual(chipStyle('draft'), { tone: 'muted', word: 'Draft' });
  assert.deepEqual(chipStyle('rejected'), { tone: 'muted', word: 'Sent back' }, 'the stored rejected reads Sent back');
  assert.deepEqual(chipStyle('cancelled'), { tone: 'cancelled', word: 'Cancelled' });
  assert.deepEqual(LEGEND.map((l) => l.label), ['Published', 'Waiting for review', 'Draft or Sent back', 'Cancelled']);
  const src = read('frontend/src/pages/admin/events/EventsCalendar.jsx');
  assert.match(src, /review: 'border border-dashed border-amber-400/, 'Waiting for review is dashed amber');
  assert.match(src, /cancelled: '[^']*line-through/, 'Cancelled is struck through');
});

test('the chip card\'s seats follow Guard G: never 0 for a count that could not be read', () => {
  assert.equal(seatsLine(ev(1), joined([row(1, 12)])), 'Seats 12 / 40');
  assert.equal(seatsLine(ev(1, { capacity: null }), joined([row(1, 9)])), '9 taken · No cap');
  assert.equal(seatsLine(ev(1), joined([row(2, 3)], 2)), `Seats taken: ${NOT_IN_READ.toLowerCase()}`);
  assert.equal(seatsLine(ev(1), joined([], 1)), 'Seats taken: could not be read', 'an empty analytics read with events known is Guard G (a)');
  assert.equal(seatsLine(ev(1), analyticsJoin({ status: 'error' }, 1)), 'Seats taken: could not be read');
});

test('the address keeps the view, the month and the week, and the filters; the phone opens on List', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.deepEqual(calendarState('', now), { view: 'month', month: '2026-10', monday: '2026-10-19', today: todayKey(now) });
  assert.equal(calendarState('', now, true).view, 'list', 'List is the phone\'s default');
  assert.equal(calendarState('?view=month', now, true).view, 'month', 'the address wins over the default');
  assert.deepEqual(calendarState('?view=week&week=2027-03-11', now), { view: 'week', month: '2027-03', monday: '2027-03-08', today: todayKey(now) }, 'any day of a week names its Monday');
  assert.equal(calendarState('?month=2027-13', now).month, '2026-10', 'a month that does not exist is ignored');
  assert.equal(calendarState('?month=2027-03', now).monday, '2027-03-01', 'Week opens on the month\'s first week when today is elsewhere');
  assert.equal(calendarSearch('?status=draft&view=month', { month: '2027-04' }), '?status=draft&view=month&month=2027-04', 'the filters stay');
  assert.equal(calendarSearch('?view=month&month=2027-04', { view: 'week', monday: '2027-04-05' }), '?view=week&month=2027-04&week=2027-04-05');
  assert.equal(calendarSearch('?view=week&month=2027-04&week=2027-04-05', { view: 'list', month: '2027-04' }), '?view=list&month=2027-04', 'the week leaves with Week');
  assert.equal(calendarSearch('?view=week&month=2027-04&week=2027-04-05', { view: 'month' }), '?view=month&month=2027-04', 'even when no month is named');
  assert.equal(mondayOf('2027-03-14'), '2027-03-08');
  assert.equal(CALENDAR_PATH, '/admin/events/calendar');
});

/* ------------------------------------------------------------------ *
 * All events: filters, views, sorts
 * ------------------------------------------------------------------ */

const NOW = Date.parse('2027-03-10T12:00:00Z');
const iso = (days) => new Date(NOW + days * DAY_MS).toISOString();

test('the address: several statuses, the old ?status= door, the defaults left out, and a range only with Dates', () => {
  assert.deepEqual(readQuery('?status=draft,published&status=cancelled').statuses, ['draft', 'published', 'cancelled']);
  assert.deepEqual(readQuery('?status=published').statuses, ['published'], 'the Overview strip\'s door still reads');
  assert.deepEqual(readQuery('?status=nope').statuses, []);
  const q = readQuery('');
  assert.deepEqual([q.sort, q.per, q.view, q.when], ['starts', 25, null, null]);
  assert.equal(readQuery('?per=40').per, 25, 'only 25, 50 or 100');
  assert.equal(readQuery('?per=100').per, 100);
  assert.equal(readQuery('?when=upcoming&from=2027-01-01').from, null, 'a range only with Dates');
  assert.equal(writeQuery('?status=draft', { status: ['draft', 'published'] }), '?status=draft%2Cpublished');
  assert.equal(writeQuery('?sort=fill&per=50', { sort: 'starts', per: 25 }), '', 'the defaults are left out');
  assert.equal(writeQuery('?when=range&from=2027-01-01&to=2027-02-01', { when: 'past' }), '?when=past', 'leaving Dates drops the range');
  assert.equal(writeQuery('?visibility=public', { visibility: null }), '');
  assert.equal(filterCount(readQuery('?status=draft,published&price=paid&sort=fill&view=full')), 2, 'the view and the sort are not filters');
});

test('the filters: Status (several), Visibility, When, Price and Featured', () => {
  const list = [
    ev(1, { starts_at: iso(2) }),
    ev(2, { starts_at: iso(-3), status: 'draft', visibility: 'private' }),
    ev(3, { starts_at: iso(40), price_cents: 2500, featured: true }),
    ev(4, { starts_at: null, price_cents: null }),
    ev(5, { starts_at: iso(1), status: 'cancelled' }),
    ev(6, { starts_at: '2027-03-15T09:00:00Z', visibility: 'unlisted' }),
  ];
  const ids = (search, q = '') => filteredRows(list, { q, query: readQuery(search), join: joined([]), now: NOW }).map((e) => e.id);
  assert.deepEqual(ids('?status=draft,cancelled'), [5, 2]);
  assert.deepEqual(ids('?visibility=private'), [2]);
  assert.deepEqual(ids('?when=upcoming'), [5, 1, 6, 3]);
  assert.deepEqual(ids('?when=past'), [2]);
  assert.deepEqual(ids('?when=week'), [5, 1], 'Monday 8 to Sunday 14 March: the 7th is the Sunday before, the 15th the Monday after');
  assert.deepEqual(ids('?when=month'), [5, 1, 6, 2]);
  assert.deepEqual(ids('?when=range&from=2027-04-01&to=2027-04-30'), [3]);
  assert.deepEqual(ids('?price=paid'), [3]);
  assert.deepEqual(ids('?price=free'), [5, 1, 6, 2], 'a price never stored is neither free nor paid');
  assert.deepEqual(ids('?featured=yes'), [3]);
  assert.deepEqual(ids('?featured=no').includes(3), false);
  assert.deepEqual(ids('', 'event 4'), [4], 'search by title');
  assert.equal(whenMatches(list[3], 'upcoming', {}, NOW), false, 'no start matches no When');
  assert.equal(priceMatches(list[3], 'free'), false);
  assert.equal(matchesFilters(list[0], readQuery(''), NOW), true);
});

test('the views: This week, Full (never guessed), and Needs attention with the reasons the page can work out', () => {
  const list = [
    ev(1, { starts_at: iso(2), capacity: 10 }),                                   // full
    ev(2, { starts_at: iso(3), capacity: 40 }),                                   // low sign-ups: 5 of 40
    ev(3, { starts_at: iso(20), ends_at: iso(20.1) }),                            // clashes with 4
    ev(4, { starts_at: iso(20.05) }),
    ev(5, { starts_at: iso(-5), capacity: 10 }),                                  // full, but past
    ev(6, { starts_at: iso(2), capacity: 10, status: 'cancelled' }),
    ev(7, { starts_at: iso(30), capacity: null }),
  ];
  const join = joined([row(1, 10), row(2, 5), row(3, 30), row(4, 1), row(5, 10), row(6, 10), row(7, 3)]);
  const ids = (search, j = join) => filteredRows(list, { query: readQuery(search), join: j, now: NOW }).map((e) => e.id);
  assert.deepEqual(ids('?view=full'), [1, 5], 'full events, cancelled ones never');
  assert.deepEqual(ids('?view=full', joined([], list.length)), [], 'counts that cannot be read make no event Full');
  assert.equal(isFull(list[0], joined([], list.length), NOW), null, 'not known, rather than false');
  assert.deepEqual(ids('?view=attention'), [1, 2, 3, 4]);
  const clashes = clashMap(list);
  const why = (e) => attentionReasons(e, { join, clashes, now: NOW }).map((r) => r.word);
  assert.deepEqual(why(list[0]), ['Full']);
  assert.deepEqual(why(list[1]), ['Low sign-ups'], 'a quarter of 40 is 10; 5 is fewer');
  assert.deepEqual(why(list[2]), ['Clash']);
  assert.deepEqual(why(list[4]), [], 'past events need no attention');
  assert.deepEqual(why(list[5]), [], 'nor cancelled ones');
  assert.equal(isLowSignups(list[1], join, NOW), true);
  assert.equal(isLowSignups(ev(9, { starts_at: iso(8), capacity: 40 }), joined([row(9, 1)]), NOW), false, 'more than 7 days out');
  assert.deepEqual(ids('?view=attention', joined([], list.length)), [3, 4], 'without counts, only clashes');
  assert.match(ATTENTION_NOTE, /Overdue reviews wait for the submission time/);
  assert.match(COUNTS_NEEDED, /only clashes are listed/);
  assert.deepEqual(ids('?view=week'), [1, 6, 2], 'Monday 8 to Sunday 14 March; the 5th is the week before');
});

test('the sorts: Starts (the canvas\'s order), Created, then Seats taken, Fill and Show-up highest first, unknown last', () => {
  const list = [
    ev(1, { starts_at: iso(5), created_at: '2027-01-01 09:00:00', capacity: 10 }),
    ev(2, { starts_at: iso(2), created_at: '2027-02-01 09:00:00', capacity: 100 }),
    ev(3, { starts_at: iso(-10), ends_at: iso(-9.9), created_at: '2026-12-01 09:00:00', capacity: null }),
    ev(4, { starts_at: iso(-20), ends_at: iso(-19.9), created_at: '2026-11-01 09:00:00', capacity: 20 }),
  ];
  const join = joined([row(1, 8), row(2, 30), row(3, 10, 7), row(4, 10, 9)], 4);
  const ids = (sort, j = join) => filteredRows(list, { query: readQuery(`?sort=${sort}`), join: j, now: NOW }).map((e) => e.id);
  assert.deepEqual(ids('starts'), [2, 1, 3, 4]);
  assert.deepEqual(ids('created'), [2, 1, 3, 4]);
  assert.deepEqual(ids('taken'), [2, 3, 4, 1]);
  assert.deepEqual(ids('fill'), [1, 4, 2, 3], '80%, 50%, 30%, then No cap last');
  assert.deepEqual(ids('showup'), [4, 3, 2, 1], '90%, 70%, then the events not held yet, in the default order');
  const partial = joined([row(2, 30)], 4);
  assert.deepEqual(ids('taken', partial), [2, 1, 3, 4], 'events not in R2\'s rows go last, never as 0');
});

/* ------------------------------------------------------------------ *
 * The CSV
 * ------------------------------------------------------------------ */

test('the CSV: the rows given, the table\'s own words, counts only, safe in a spreadsheet', () => {
  const list = [
    ev(1, { title: 'Breakfast, Lisbon', starts_at: iso(4), capacity: 10 }),
    ev(2, { title: '=HYPERLINK("x")', starts_at: iso(-10), ends_at: iso(-9.9), capacity: null }),
    ev(3, { title: 'Supper', starts_at: iso(4) }),
  ];
  const csv = csvFor(list, joined([row(1, 6, 0, 2), row(2, 5, 4)], 3), NOW, { statusWord });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4, 'a header and the rows given');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.deepEqual(CSV_COLUMNS, ['Event', 'Featured', 'Starts', 'Time zone', 'Status', 'Visibility', 'Capacity', 'Taken', 'Waitlisted', 'Attended', 'Fill', 'Show-up', 'Price']);
  assert.equal(lines[1], `"Breakfast, Lisbon",No,14 Mar 2027 12:00,UTC,Published,Public,10,6,2,${NOT_HELD},60%,${NOT_HELD},Free`);
  assert.match(lines[2], /^"'=HYPERLINK\(""x""\)",/, 'a formula is defused and quoted');
  assert.match(lines[2], /,No cap,5,0,4,No cap,80%,Free$/);
  assert.match(lines[3], new RegExp(`,${NOT_IN_READ},${NOT_IN_READ},`), 'an event not in R2 says so, never 0');
  assert.doesNotMatch(csv, /@|email|roster/i, 'no names or emails');
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvName(Date.parse('2027-03-10T12:00:00')), 'events-2027-03-10.csv');
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the new files read nothing new, upload nothing and draw no chart', () => {
  const files = ['EventsCalendar.jsx', 'EventFilters.jsx', 'EventsAll.jsx', 'calendarModel.js', 'allEventsModel.js'].map((f) => `frontend/src/pages/admin/events/${f}`);
  const src = files.map((f) => codeOnly(read(f))).join('\n');
  for (const control of ['type="file"', '.draft(', 'dd.generateReport(']) assert.ok(!src.includes(control), `rail_options_admin_d774 lists ${control}`);
  assert.doesNotMatch(src, /lib\/api|fetch\(|roster|\.summary\b|conversion/, 'no read beyond D915\'s R1 and R2');
  assert.doesNotMatch(src, /<svg|recharts|location_kind|\bev\.type\b/, 'no chart, no type or format until part 1');
  assert.doesNotMatch(src, /host_user_id|Hosted by|Studio team|Cancelled with paid tickets/, 'the host and the paid-tickets view wait for part 3');
  assert.match(read('frontend/src/pages/admin/AdminEventsPage.jsx'), /<DeskTab to="\/admin\/events\/calendar" testId="events-tab-calendar">Calendar<\/DeskTab>/, 'a literal door for the reachability walk');
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /`\/admin\/events\/calendar`/);
  assert.match(read('frontend/src/pages/admin/events/README.md'), /EventsCalendar\.jsx/);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

function worker({ list = [], analytics = { events: [] } } = {}) {
  return (url) => {
    if (url.includes('/api/admin/events/analytics')) return response(analytics);
    if (/\/api\/admin\/events\?/.test(url)) {
      const q = new URLSearchParams(url.split('?')[1]);
      const source = q.get('status') === 'pending_review' ? [] : list;
      const offset = Number(q.get('offset'));
      return response({ events: source.slice(offset, offset + Number(q.get('limit'))) });
    }
    return response({});
  };
}

let where = '';
function Where() { where = useLocation().search; return null; }

async function mounted(url, handle) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    n.click = function click() { (globalThis.__clicked ||= []).push(this); };
    n.remove = function remove() { this.parentNode?.removeChild(this); };
    return n;
  };
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const requests = [];
  const blobs = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:csv'; };
  URL.revokeObjectURL = () => {};
  globalThis.__clicked = [];
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminEventsPage), h(Where))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, blobs, flush,
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(id, target) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target }); }); await flush(); },
    async close() { await act(async () => reactRoot.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke; restore(); },
  };
}

const MARCH = [
  ev(11, { title: 'Breakfast', starts_at: '2027-03-12T08:30:00Z', capacity: 20 }),
  ev(12, { title: 'Roundtable', starts_at: '2027-03-13T18:00:00Z', ends_at: '2027-03-13T20:00:00Z' }),
  ev(13, { title: 'Briefing', starts_at: '2027-03-13T18:30:00Z', status: 'pending_review', admin_published: false }),
  ev(14, { title: 'Social', starts_at: '2027-03-13T21:00:00Z', status: 'cancelled' }),
  ev(15, { title: 'Clinic', starts_at: '2027-03-13T22:00:00Z', status: 'draft' }),
  ev(16, { title: 'Undated', starts_at: null }),
];

test('Calendar: the tab, the month with its chips, "+n more", the overlap, and the chip card', async () => {
  const view = await mounted('/admin/events/calendar?month=2027-03', worker({ list: MARCH, analytics: { events: [row(11, 12)] } }));
  try {
    assert.ok(view.has('events-calendar'));
    assert.match(String(view.props('events-tab-calendar').className), /border-axal-violet/, 'Calendar is the lit tab');
    assert.equal(view.textOf('events-cal-title'), 'March 2027');
    assert.ok(view.requests.some((u) => u === '/api/admin/events?limit=200&offset=0'), 'R1');
    assert.ok(view.requests.some((u) => u === '/api/admin/events/analytics'), 'R2, for the card\'s seats');
    assert.equal(view.textOf('events-cal-chip-11'), '08:30 Breakfast');
    assert.equal(view.textOf('events-cal-chip-13'), '18:30 Briefing · Review');
    assert.equal(view.textOf('events-cal-overlap-2027-03-13'), '●2 overlap', 'Roundtable and Briefing; the cancelled Social clashes with nothing');
    assert.equal(view.has('events-cal-chip-15'), false, 'the fourth event of the 13th waits behind "+n more"');
    assert.equal(view.textOf('events-cal-more-2027-03-13'), '+1 more');
    assert.equal(view.textOf('events-cal-unplaced'), 'One event has no start date, so it is not on the calendar.');
    await view.click('events-cal-more-2027-03-13');
    assert.match(view.textOf('events-cal-dayview'), /^4 events on 2027-03-13/);
    await view.click('events-cal-chip-15');
    assert.match(view.textOf('events-cal-card'), /Clinic/);
    await view.click('events-cal-chip-11');
    assert.equal(view.textOf('events-cal-card-seats'), 'Seats 12 / 20');
    assert.equal(view.props('events-cal-card-open').href, '/admin/events/11');
    await view.click('events-cal-chip-12');
    assert.equal(view.textOf('events-cal-card-seats'), `Seats taken: ${NOT_IN_READ.toLowerCase()}`, 'Guard G: missing from R2, never 0');
    assert.equal(view.textOf('events-cal-card-clash'), 'Overlaps one other event.');
    await view.click('events-cal-close');
    assert.equal(view.has('events-cal-card'), false);
    await view.click('events-cal-next');
    assert.equal(view.textOf('events-cal-title'), 'April 2027');
    assert.equal(new URLSearchParams(where).get('month'), '2027-04', 'the address keeps the month');
  } finally { await view.close(); }
});

test('Calendar: Week sets overlaps side by side, List links each event, and the filters narrow both', async () => {
  const view = await mounted('/admin/events/calendar?view=week&week=2027-03-10', worker({ list: MARCH }));
  try {
    assert.equal(view.textOf('events-cal-title'), 'Week of 8 Mar');
    const style = (id) => view.props(`events-cal-chip-${id}`).style;
    assert.equal(style(12).width, 'calc(50% - 4px)', 'Roundtable and Briefing side by side');
    assert.equal(style(13).left, 'calc(50% + 2px)');
    assert.equal(style(11).width, 'calc(100% - 4px)', 'a lone event takes the column');
    await view.click('events-cal-view-list');
    assert.equal(new URLSearchParams(where).get('view'), 'list');
    assert.equal(new URLSearchParams(where).get('week'), null);
    assert.equal(view.props('events-cal-row-12').href, '/admin/events/12');
    assert.match(view.textOf('events-cal-row-13'), /18:30 · 2 overlap/);
    assert.match(view.textOf('events-cal-row-14'), /Cancelled/);
    await view.click('events-filter-status');
    await view.change('events-filter-status-pending_review', { checked: true });
    assert.equal(new URLSearchParams(where).get('status'), 'pending_review');
    assert.deepEqual(view.testIds().filter((t) => /^events-cal-row-/.test(t)), ['events-cal-row-13']);
    assert.equal(new URLSearchParams(where).get('view'), 'list', 'the view stays with the filter');
  } finally { await view.close(); }
});

test('All events: filters, a view, a sort and the page size in the address; the CSV of the rows on screen; phone cards', async () => {
  const live = Date.now();
  const at = (days) => new Date(live + days * DAY_MS).toISOString();
  const list = [
    ...Array.from({ length: 30 }, (_, i) => ev(100 + i, { title: `Talk ${i}`, starts_at: at(10 + i), capacity: 50 })),
    ev(201, { title: 'Full house', starts_at: at(3), capacity: 10 }),
    ev(202, { title: 'Draft one', starts_at: at(5), status: 'draft' }),
  ];
  const view = await mounted('/admin/events/all', worker({ list, analytics: { events: [row(201, 10), ...list.slice(0, 30).map((e) => row(e.id, 20))] } }));
  try {
    assert.equal(view.textOf('events-all-range'), '1–25 of 32');
    await view.change('events-all-per', { value: '50' });
    assert.equal(new URLSearchParams(where).get('per'), '50');
    assert.equal(view.textOf('events-all-range'), '1–32 of 32');
    await view.click('events-all-view-full');
    assert.equal(new URLSearchParams(where).get('view'), 'full');
    assert.deepEqual(view.testIds().filter((t) => /^events-all-row-/.test(t)), ['events-all-row-201']);
    await view.click('events-all-view-full');
    await view.click('events-all-view-attention');
    assert.equal(view.textOf('events-all-attention-note'), ATTENTION_NOTE);
    assert.match(view.textOf('events-all-reasons-201'), /Full/);
    await view.click('events-all-view-attention');
    await view.change('events-filter-visibility', { value: 'public' });
    await view.click('events-filter-status');
    await view.change('events-filter-status-draft', { checked: true });
    assert.equal(where.includes('status=draft'), true);
    assert.equal(where.includes('visibility=public'), true);
    assert.deepEqual(view.testIds().filter((t) => /^events-all-row-/.test(t)), ['events-all-row-202']);
    assert.ok(view.has('events-all-card-202'), 'the phone card for the same row');
    assert.equal(view.props('events-all-card-202').href, '/admin/events/202');
    assert.equal(view.textOf('events-all-filters-toggle'), 'Filters · 2');
    await view.change('events-filter-status-draft', { checked: false });
    await view.change('events-all-sort', { value: 'taken' });
    assert.equal(new URLSearchParams(where).get('sort'), 'taken');
    await view.change('events-all-per', { value: '25' });
    assert.equal(view.textOf('events-all-range'), '1–25 of 32');
    await view.click('events-all-csv');
    assert.equal(view.blobs.length, 1, 'one file, made in the browser');
    const csv = await view.blobs[0].text();
    assert.equal(csv.trim().split('\r\n').length, 1 + 25, 'the header and the 25 rows on screen, not all 32');
    assert.doesNotMatch(csv, /@/);
    assert.equal(globalThis.__clicked.at(-1).download, `events-${todayKey(Date.now())}.csv`);
  } finally { await view.close(); }
});

test('All events on a phone: the cards are 44 px targets and the filters fold behind "Filters · [n]"', () => {
  const src = read('frontend/src/pages/admin/events/EventsAll.jsx');
  assert.match(src, /<ul className="m-0 flex list-none flex-col gap-1\.5 p-0 sm:hidden" data-testid="events-all-cards">/);
  assert.match(src, /className="flex min-h-\[44px\] flex-col/, 'each card is at least 44 px');
  assert.match(src, /max-sm:hidden/, 'the table gives way to the cards');
  assert.match(read('frontend/src/pages/admin/events/EventFilters.jsx'), /export const CONTROL = `\$\{INPUT\} max-sm:min-h-\[44px\]`;/);
  assert.match(read('frontend/src/pages/admin/events/EventsCalendar.jsx'), /flex min-h-\[44px\] items-center gap-3 rounded-\[10px\]/, 'the list rows too');
});
