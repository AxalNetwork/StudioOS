/**
 * D915 (#2368) — the admin Events desk at /admin/events/*, integrated from the
 * owner's "Events Console" canvas and wired to the reads that already exist.
 *
 * What this file holds the desk to:
 *   · Guard G: R2's per-event counts are drawn only when they can be trusted,
 *     a failed or empty analytics read says "Could not be read", and an event
 *     missing from it says "Not in this read", never 0;
 *   · the words for what is not known (Not held yet, No cap, Not recorded),
 *     show-up only once an event has ended, money in its own currency;
 *   · the dialogs say only what the Worker does, and refusals are one sentence;
 *   · the routes, the guard and the literal tab doors; the frame stays pinned;
 *   · the desk never reads the roster, R2's summary or `conversion`;
 *   · mounted against a stubbed Worker, each tab reads what it draws and no
 *     failed read shows a zero;
 *   · the review's fixes (D915 §7): reads made together, an honest "Updated",
 *     no second write in the re-read's gap, focus kept, the menu a disclosure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import {
  ALL_PATH, COMMUNITY_PATH, DAY_MS, DESK_PATH, FROZEN, GONE, LINE, NOT_HELD, NOT_IN_READ, NO_CAP, QUICK_REASONS, REVIEW_PATH,
  SCOPE_LABEL, STATUSES, SUSPENDED, TABS, TITLE, allRows, analyticsJoin, approveLine3, approveLines, approvedLine,
  attendedText, cancelCopy, capacityPreview, clockLabel, countText, countsFor, eventIdFor, factsOf, featureCopy, fillText, hasEnded,
  isEventId, money, moneyTotals, onPublicCalendar, overviewTiles, pageOf, publishGate, queueFlags, queueRows, rangeText,
  readEveryPage, refusalText, showUpText, statusCounts, statusFromSearch, statusWord, tabFor, unpublishCopy, whenLine,
} from '../src/pages/admin/events/eventsDeskModel.js';
import { SCOPE_LABEL as INSIGHTS_SCOPE_LABEL } from '../src/pages/admin/insights/insightsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY_MS).toISOString();

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

// shapeEvent(row, { includePrivate: true }) — `eventsCommon.ts`
const ev = (id, o = {}) => ({
  id, slug: `ev-${id}`, title: `Event ${id}`, type: 'meetup', summary: null, description: null,
  starts_at: iso(10), ends_at: null, timezone: 'UTC', location_kind: 'virtual', location_text: null,
  capacity: 40, waitlist_enabled: true, approval_required: false, visibility: 'public', status: 'published',
  featured: false, price_cents: 0, currency: 'usd', created_at: '2026-10-01 09:00:00', admin_published: true, audience_rules: {},
  ...o,
});
// GET /api/admin/events/analytics — one per-event row
const row = (id, registrations, attended = 0, waitlisted = 0) => ({ id, slug: `ev-${id}`, title: `Event ${id}`, status: 'published', starts_at: iso(10), featured: false, capacity: 40, registrations, attended, waitlisted, cancelled: 0, capacity_util: null, conversion: 0 });
const ready = (data) => ({ status: 'ready', data });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs and addresses: three tabs, one page per event, and no Calendar until part 4', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [['Overview', DESK_PATH], ['Review', REVIEW_PATH], ['All events', ALL_PATH]]);
  assert.equal(tabFor('/admin/events'), 'overview');
  assert.equal(tabFor('/admin/events/'), 'overview');
  assert.equal(tabFor('/admin/events/review'), 'review');
  assert.equal(tabFor('/admin/events/all'), 'all');
  assert.equal(tabFor('/admin/events/12'), 'event');
  assert.equal(eventIdFor('/admin/events/12'), '12');
  assert.equal(eventIdFor('/admin/events/review'), null, 'a tab word is never read as an event');
  assert.equal(eventIdFor('/admin/events'), null);
  assert.equal(isEventId('12'), true);
  for (const bad of ['0', '-1', 'abc', '1.5', '']) assert.equal(isEventId(bad), false, bad);
  assert.ok(!TABS.some((t) => /calendar/i.test(t.label)), 'Calendar joins with part 4');
  assert.equal(COMMUNITY_PATH, '/admin/held/community', 'the canvas\'s /admin/community is not a route');
  assert.equal(SCOPE_LABEL, INSIGHTS_SCOPE_LABEL, 'the scope chip is Insights\' own');
  assert.equal(TITLE, 'Events');
  assert.equal(LINE, 'Approve public events, keep the calendar healthy and see how events perform.');
});

test('a path segment that cannot be decoded is an event page with no event, not a crash', () => {
  for (const path of ['/admin/events/%E0', '/admin/events/100%']) {
    assert.equal(tabFor(path), 'event', path);
    assert.equal(eventIdFor(path), path.slice('/admin/events/'.length), 'the raw segment comes back');
    assert.equal(isEventId(eventIdFor(path)), false, 'so no read starts and the page says the event no longer exists');
  }
  assert.equal(eventIdFor('/admin/events/%31%32'), '12', 'a segment that decodes is still decoded');
});

test('the status words are the canvas\'s, and the stored `rejected` reads "Sent back"', () => {
  assert.deepEqual(STATUSES.map((s) => s.word), ['Draft', 'Waiting for review', 'Published', 'Sent back', 'Cancelled']);
  assert.equal(statusWord('rejected'), 'Sent back');
  assert.equal(statusWord('pending_review'), 'Waiting for review');
  assert.equal(statusWord('some_new_state'), 'Some New State');
  assert.equal(statusWord(null), 'Status not recorded');
  assert.equal(statusFromSearch('?status=rejected'), 'rejected');
  assert.equal(statusFromSearch('?status=nope'), null);
  const counts = statusCounts([ev(1, { status: 'rejected' }), ev(2), ev(3), ev(4, { status: 'archived' })]);
  assert.deepEqual(counts.map((c) => [c.word, c.count]), [['Draft', 0], ['Waiting for review', 0], ['Published', 2], ['Sent back', 1], ['Cancelled', 0], ['Archived', 1]],
    'counted from R1, real zeros, Sent back its own bucket, and a stored status the canvas does not name is still counted');
});

test('Guard G (a): R1 has events and R2\'s rows are empty, so the per-event counts could not be read', () => {
  const join = analyticsJoin(ready({ summary: {}, events: [] }), 3);
  assert.equal(join.state, 'unreadable');
  assert.equal(countText(countsFor(join, 1), 'taken'), 'Could not be read');
  assert.equal(analyticsJoin(ready({ events: [] }), 0).state, 'ready', 'no events at all: an empty list is the truth');
});

test('Guard G (b) and (c): rows that are not a list, a `{}` reply, or R2 naming its own failure', () => {
  for (const data of [{}, { events: null }, { events: 'x' }, null]) assert.equal(analyticsJoin(ready(data), 2).state, 'unreadable', JSON.stringify(data));
  assert.equal(analyticsJoin(ready({ events: [row(1, 4)], unreadable: ['events'] }), 1).state, 'unreadable', '(c): part 1 says so itself');
  assert.equal(analyticsJoin(ready({ events: [row(1, 4)], unreadable: ['summary'] }), 1).state, 'ready', 'a failed summary does not touch the rows');
  assert.equal(analyticsJoin({ status: 'error', data: null }, 1).state, 'unreadable');
  assert.equal(analyticsJoin({ status: 'loading', data: null }, 1).state, 'loading');
});

test('Guard G: an R1 event missing from R2\'s 200 rows reads "Not in this read", never 0', () => {
  const join = analyticsJoin(ready({ events: [row(1, 4, 1, 2)] }), 2);
  assert.equal(join.state, 'ready');
  assert.deepEqual(countsFor(join, 1), { state: 'ready', taken: 4, attended: 1, waitlisted: 2 });
  const missing = countsFor(join, 2);
  assert.equal(missing.state, 'missing');
  for (const k of ['taken', 'waitlisted', 'attended']) assert.equal(countText(missing, k), NOT_IN_READ);
  assert.equal(fillText(40, missing), NOT_IN_READ);
  assert.equal(countText(countsFor(join, 1), 'taken'), '4', 'a real count is drawn');
  assert.equal(countText(countsFor(analyticsJoin(ready({ events: [row(1, 0)] }), 1), 1), 'taken'), '0', 'a real zero is a zero');
});

test('an event has ended once ends_at has passed, or a day after its start when there is no ends_at', () => {
  assert.equal(hasEnded(ev(1, { starts_at: iso(-3), ends_at: iso(-2) }), NOW), true);
  assert.equal(hasEnded(ev(1, { starts_at: iso(-3), ends_at: iso(1) }), NOW), false, 'a three-day event still running');
  assert.equal(hasEnded(ev(1, { starts_at: iso(-0.5), ends_at: null }), NOW), false, 'started twelve hours ago, no end: not ended');
  assert.equal(hasEnded(ev(1, { starts_at: iso(-1.5), ends_at: null }), NOW), true, 'started 36 hours ago, no end: ended');
  assert.equal(hasEnded(ev(1, { starts_at: '2026-10-22 09:00:00', ends_at: null }), NOW), true, 'a D1 stamp is UTC');
  assert.equal(hasEnded(ev(1, { starts_at: null, ends_at: null }), NOW), null);
});

test('show-up only once an event has ended; fill, attended and No cap in words', () => {
  const join = analyticsJoin(ready({ events: [row(1, 20, 15), row(2, 20, 0), row(3, 0, 0)] }), 3);
  const upcoming = ev(1, { starts_at: iso(5) });
  assert.equal(showUpText(upcoming, countsFor(join, 1), NOW), NOT_HELD, 'never 0% or a dash before it is held');
  assert.equal(attendedText(ev(2, { starts_at: iso(5) }), countsFor(join, 2), NOW), NOT_HELD);
  const ended = ev(1, { starts_at: iso(-5) });
  assert.equal(showUpText(ended, countsFor(join, 1), NOW), '75%');
  assert.equal(attendedText(ended, countsFor(join, 1), NOW), '15');
  assert.equal(showUpText(ev(2, { starts_at: iso(-5) }), countsFor(join, 2), NOW), '0%', 'an ended event nobody came to is a real 0%');
  assert.equal(showUpText(ev(3, { starts_at: iso(-5) }), countsFor(join, 3), NOW), 'No seats taken');
  assert.equal(showUpText(ev(1, { starts_at: iso(-5), status: 'cancelled' }), countsFor(join, 1), NOW), 'Not held');
  assert.equal(showUpText(ended, countsFor(analyticsJoin(ready({ events: [] }), 1), 1), NOW), 'Could not be read');
  assert.equal(fillText(40, countsFor(join, 1)), '50%');
  assert.equal(fillText(null, countsFor(join, 1)), NO_CAP);
  assert.equal(fillText(0, countsFor(join, 1)), 'No seats');
  // R2's conversion is 0 for every upcoming event; it is never what show-up draws.
  assert.notEqual(showUpText(upcoming, countsFor(join, 1), NOW), '0%');
});

test('money is drawn in its own currency, and two currencies are never added', () => {
  assert.equal(money(4000, 'usd'), '$40');
  assert.equal(money(1550, 'eur'), '€15.50');
  assert.equal(money(0, 'usd'), 'Free');
  assert.equal(money(null, 'usd'), 'Not recorded');
  assert.equal(money(4000, 'xyz1'), '40 XYZ1', 'a code Intl does not know is still named');
  assert.equal(moneyTotals([{ cents: 4000, currency: 'usd' }, { cents: 1500, currency: 'usd' }, { cents: 4000, currency: 'eur' }]), '$55 · €40');
  assert.equal(moneyTotals([]), 'Free');
});

test('the publish gate (EV7g): public and approved, waiting, and private', () => {
  assert.deepEqual(publishGate(ev(1)).map((s) => s.text), ['Public', 'Published', 'Approved by an admin', 'On the public calendar']);
  assert.deepEqual(publishGate(ev(1, { status: 'pending_review', admin_published: false })).map((s) => s.text), ['Public', 'Waiting for review', 'Not approved yet', 'Not on the public calendar']);
  assert.deepEqual(publishGate(ev(1, { visibility: 'private', admin_published: false })).map((s) => s.text), ['Private', 'Published', 'Reached by invitation only. Private and unlisted events publish without review.']);
  assert.equal(onPublicCalendar(ev(1)), true);
  assert.equal(onPublicCalendar(ev(1, { admin_published: false })), false, 'the feed predicate needs the approval');
  assert.equal(onPublicCalendar(ev(1, { visibility: 'unlisted' })), false);
});

test('"What approving does": line 3 names the two sources approve invites, and says the other three send none', () => {
  assert.equal(approveLine3({}), 'Sends no invitations.');
  assert.equal(approveLine3({ comp_official_partners: true, comp_invested_lps: true }), 'Sends free-seat invitations to official partners and invested LPs not invited yet.');
  assert.equal(approveLine3({ comp_investors: true, comp_host_connections: true }), 'Sends no invitations. Investors and the host’s contacts get a free seat when they sign up; no invitation is sent to them.');
  assert.equal(approveLine3({ comp_invested_lps: true, comp_project_founders: true }), 'Sends free-seat invitations to invested LPs not invited yet. Founders of live ventures get a free seat when they sign up; no invitation is sent to them.');
  assert.equal(approveLine3({ comp_official_partners: false }), 'Sends no invitations.', 'a flag turned off is no flag');
  assert.doesNotMatch(approveLine3({ comp_official_partners: true }), /\d/, 'no counts until part 3\'s preview');
  const lines = approveLines(ev(1, { status: 'pending_review' }));
  assert.equal(lines[0], 'Puts the event on the public calendar at axal.vc/events.');
  assert.equal(lines[1], 'Tells the host it is live.');
  assert.match(approveLines(ev(1, { visibility: 'unlisted' }))[0], /stays off the public calendar/);
  assert.equal(approvedLine(ev(1, { title: 'A' })), 'Approved. A is on the public calendar.');
  assert.equal(approvedLine(ev(1, { title: 'A' }), { featured: true }), 'Approved. A is on the public calendar. It is featured.');
  assert.match(approvedLine(ev(1, { title: 'A' }), { featureError: { status: 423, code: 'branch_suspended' } }), /It is not featured: This studio’s licence is suspended/);
});

test('the review queue: titles only, sorted by start or by creation, with the Paid and Free seats flags', () => {
  const list = [
    ev(1, { title: 'Breakfast', starts_at: iso(9), created_at: '2026-10-01 09:00:00', price_cents: 4000 }),
    ev(2, { title: 'Workshop', starts_at: iso(2), created_at: '2026-10-05 09:00:00', audience_rules: { comp_invested_lps: true } }),
    ev(3, { title: 'Roundtable', starts_at: null, created_at: '2026-10-03 09:00:00' }),
  ];
  assert.deepEqual(queueRows(list).map((e) => e.id), [2, 1, 3], 'starts soonest; no start last');
  assert.deepEqual(queueRows(list, { sort: 'created' }).map((e) => e.id), [2, 3, 1], 'newest created');
  assert.deepEqual(queueRows(list, { q: 'work' }).map((e) => e.id), [2]);
  assert.deepEqual(queueFlags(list[0]), ['Paid $40']);
  assert.deepEqual(queueFlags(list[1]), ['Free seats']);
  assert.deepEqual(queueFlags(list[2]), []);
  const facts = Object.fromEntries(factsOf(ev(1, { capacity: 60, audience_rules: { mode: 'selected', roles: ['founder', 'investor'], comp_official_partners: true } })).map((f) => [f.label, f.value ?? f.unrecorded.text]));
  assert.equal(facts['Who may register'], 'Selected roles: Founder, Investor');
  assert.equal(facts['Free seats for'], 'Official partners');
  assert.equal(facts.Capacity, '60 seats · waitlist on');
  assert.equal(facts.Place, 'Not recorded');
  assert.equal(facts.Submitted, 'Not recorded yet', 'submitted_at is part 2');
  assert.equal(Object.fromEntries(factsOf(ev(1, { capacity: null })).map((f) => [f.label, f.value]))['Capacity'], NO_CAP);
  assert.equal(whenLine(ev(1, { starts_at: '2026-11-14T18:30:00Z', ends_at: '2026-11-14T21:00:00Z', timezone: 'Europe/Lisbon' })), 'Sat 14 Nov 2026, 18:30–21:00 · Europe/Lisbon');
  assert.equal(whenLine(ev(1, { starts_at: null })), 'Date not recorded');
});

test('All events: the canvas\'s default order, the status from the address, and 25 a page', () => {
  const list = [ev(1, { starts_at: iso(-10) }), ev(2, { starts_at: iso(20) }), ev(3, { starts_at: iso(3) }), ev(4, { starts_at: null }), ev(5, { starts_at: iso(-2), status: 'rejected' })];
  assert.deepEqual(allRows(list, { now: NOW }).map((e) => e.id), [3, 2, 5, 1, 4], 'upcoming soonest first, then past latest first');
  assert.deepEqual(allRows(list, { now: NOW, status: 'rejected' }).map((e) => e.id), [5]);
  const many = Array.from({ length: 30 }, (_, i) => ev(i + 1));
  assert.equal(rangeText(pageOf(many, 1)), '1–25 of 30');
  assert.equal(rangeText(pageOf(many, 2)), '26–30 of 30');
  assert.equal(pageOf(many, 9).page, 2, 'a page past the end is the last page');
  assert.equal(rangeText(pageOf([], 1)), 'No events');
});

test('the Overview tiles: real zeros on a read that succeeded, and words for every unknown', () => {
  const list = [
    ev(1, { starts_at: iso(5), capacity: 10 }),
    ev(2, { starts_at: iso(12), status: 'pending_review', admin_published: false }),
    ev(3, { starts_at: iso(-5), ends_at: iso(-5 + 0.1) }),
    ev(4, { starts_at: iso(45), status: 'draft' }),
    ev(5, { starts_at: iso(-20), status: 'cancelled' }),
    // Inside the 30 days, with seats and waitlists, but not live (D915 §3): never counted ahead.
    ev(6, { starts_at: iso(3), status: 'rejected' }),
    ev(7, { starts_at: iso(4), status: 'draft' }),
    ev(8, { starts_at: iso(6), status: 'cancelled' }),
  ];
  const all = ready(list);
  const queue = ready([list[1]]);
  const join = analyticsJoin(ready({ events: [row(1, 10, 0, 3), row(2, 0, 0, 1), row(3, 8, 6), row(4, 0), row(5, 9), row(6, 5, 0, 2), row(7, 1, 0, 1), row(8, 4, 0, 2)] }), list.length);
  const t = Object.fromEntries(overviewTiles({ all, queue, join, now: NOW }).map((x) => [x.key, x]));
  assert.equal(t.waiting.value, '1');
  assert.equal(t.waiting.note.text, 'Waiting time not recorded yet', 'waiting time counts from submission, which part 2 records');
  assert.equal(t.next30.value, '2', 'published and waiting, starting in the next 30 days; not the draft, the sent-back or the cancelled one');
  assert.equal(t.next30.sub, '10 seats taken · 1 full');
  assert.equal(t.waitlists.value, '4', 'waitlisted on upcoming live events only');
  assert.equal(t.showup.value, '75%', 'ended and not cancelled');
  // R2 failed: every count says so, R1's own counts still answer.
  const failed = Object.fromEntries(overviewTiles({ all, queue, join: analyticsJoin(ready({ events: [] }), list.length), now: NOW }).map((x) => [x.key, x]));
  assert.equal(failed.next30.value, '2');
  assert.equal(failed.next30.sub, 'Seats taken could not be read');
  assert.equal(failed.waitlists.state, 'unreadable');
  assert.equal(failed.showup.state, 'unreadable');
  // Nothing upcoming: the waitlists sum is a real 0 from R1 alone, whatever R2 says.
  const quiet = Object.fromEntries(overviewTiles({ all: ready([list[2]]), queue, join: analyticsJoin({ status: 'error' }, 1), now: NOW }).map((x) => [x.key, x]));
  assert.equal(quiet.waitlists.value, '0');
  assert.equal(quiet.showup.state, 'unreadable', 'the ended event\'s counts could not be read');
  // An ended event missing from R2: not summed as 0.
  const partial = Object.fromEntries(overviewTiles({ all, queue, join: analyticsJoin(ready({ events: [row(1, 10, 0, 3), row(2, 0, 0, 1)] }), list.length), now: NOW }).map((x) => [x.key, x]));
  assert.equal(partial.showup.state, 'missing');
  // R1 failed.
  const down = overviewTiles({ all: { status: 'error' }, queue: { status: 'error' }, join: analyticsJoin({ status: 'error' }, 0), now: NOW });
  assert.deepEqual(down.map((x) => x.state), ['unreadable', 'unreadable', 'unreadable', 'unreadable']);
  // No events at all: real zeros, and words where a rate has nothing to divide.
  const none = Object.fromEntries(overviewTiles({ all: ready([]), queue: ready([]), join: analyticsJoin(ready({ events: [] }), 0), now: NOW }).map((x) => [x.key, x]));
  assert.deepEqual([none.waiting.value, none.next30.value, none.waitlists.value, none.showup.value], ['0', '0', '0', 'No event has ended yet']);
});

test('R1 is read page by page at 200 until a short page; a reply with no list is a failed read', async () => {
  const offsets = [];
  const rows = await readEveryPage(async (offset) => { offsets.push(offset); return { events: Array.from({ length: offset === 0 ? 200 : 3 }, (_, i) => ev(offset + i + 1)) }; });
  assert.deepEqual(offsets, [0, 200]);
  assert.equal(rows.length, 203);
  await assert.rejects(readEveryPage(async () => ({})), /did not come back as a list/);
});

test('R1 pages by offset, so an event created between two pages pushes a row onto the next; each id is kept once', async () => {
  // 250 events, newest created first, as R1 orders them. A draft is created
  // after the first page is read, so every row moves down one.
  const table = Array.from({ length: 250 }, (_, i) => ev(250 - i));
  const rows = await readEveryPage(async (offset) => {
    if (offset === 200) table.unshift(ev(251, { status: 'draft' }));
    return { events: table.slice(offset, offset + 200) };
  });
  const ids = rows.map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size, 'no event twice');
  assert.equal(rows.length, 250, 'the 250 events the read began with; the new draft is in the next read');
  const published = statusCounts(rows).find((s) => s.key === 'published').count;
  assert.equal(published, 250, 'counted once each');
});

test('the dialogs say only what the Worker does', () => {
  const counts = (taken, waitlisted) => ({ state: 'ready', taken, attended: 0, waitlisted });
  const e = ev(1, { capacity: 60, waitlist_enabled: true });
  assert.equal(capacityPreview(e, counts(60, 6), '66').line, '6 people move off the waitlist, oldest first. Each is told in StudioOS.');
  assert.equal(capacityPreview(e, counts(60, 1), '66').line, '1 person moves off the waitlist, oldest first. Each is told in StudioOS.');
  assert.equal(capacityPreview(e, counts(50, 0), '66').line, 'No one is on the waitlist, so no one moves.');
  assert.equal(capacityPreview(e, counts(60, 6), '50').line, '60 seats are already taken. No one loses a seat. New sign-ups join the waitlist.');
  assert.equal(capacityPreview({ ...e, waitlist_enabled: false }, counts(60, 0), '50').line, '60 seats are already taken. No one loses a seat. The waitlist is off, so new sign-ups are turned away while it is full.');
  assert.equal(capacityPreview(e, counts(20, 0), '50').line, 'No one loses a seat. 30 seats stay open.');
  assert.deepEqual(capacityPreview(e, counts(60, 6), '-5'), { error: 'Use a whole number, 0 or more.' });
  assert.deepEqual(capacityPreview(e, counts(60, 6), '2.5'), { error: 'Use a whole number, 0 or more.' });
  assert.equal(capacityPreview(e, counts(60, 6), '', true).value, null, 'No cap sends null');
  assert.match(capacityPreview(e, { state: 'unreadable' }, '66').line, /oldest first, up to the new capacity/);
  for (const r of [capacityPreview(e, counts(60, 6), '66'), capacityPreview(e, counts(60, 6), '', true)]) assert.doesNotMatch(r.line, /email/i, 'promotion is in-app only');

  const cancel = cancelCopy(ev(1, { title: 'A' }));
  assert.equal(cancel.lines[0], 'It leaves the public calendar.');
  assert.match(cancel.lines[1], /^People with an account who hold a seat or wait for one are told in StudioOS\./);
  assert.equal(cancel.paid, null, 'a free event has no refund box');
  assert.match(cancelCopy(ev(1, { price_cents: 4000 })).paid, /HQ refunds them in Revenue › Billing/);
  const all = JSON.stringify([cancel, cancelCopy(ev(1, { price_cents: 4000 })), unpublishCopy(ev(1)), featureCopy(ev(1)), featureCopy(ev(1, { featured: true }))]);
  assert.doesNotMatch(all, /cannot be undone|every calendar|with your note|Each gets an email/, 'the canvas copy the Worker does not do');
  assert.match(unpublishCopy(ev(1)).body, /The host is not told automatically\./);
  assert.equal(featureCopy(ev(1)).action, 'Feature');
  assert.equal(featureCopy(ev(1)).next, true);
  assert.equal(featureCopy(ev(1, { featured: true })).action, 'Stop featuring');
  assert.equal(featureCopy(ev(1, { featured: true })).next, false, 'the body is sent explicitly; a missing body unfeatures');
});

test('Cancel says "It leaves the public calendar" only for an event that is on it', () => {
  assert.equal(cancelCopy(ev(1)).lines[0], 'It leaves the public calendar.', 'public, published and approved');
  for (const o of [{ status: 'pending_review', admin_published: false }, { status: 'draft', admin_published: false }, { status: 'rejected', admin_published: false }, { admin_published: false }, { visibility: 'private' }]) {
    assert.equal(cancelCopy(ev(1, o)).lines[0], 'It is marked cancelled.', JSON.stringify(o));
  }
});

test('refusals are one sentence: suspended licence, frozen account, gone event', () => {
  assert.equal(refusalText({ status: 423, code: 'branch_suspended' }), SUSPENDED);
  assert.equal(refusalText({ status: 403, code: 'admin_frozen' }), FROZEN);
  assert.equal(refusalText({ status: 423, code: 'admin_frozen' }), FROZEN, 'the frozen 423 is not a suspension');
  assert.equal(refusalText({ status: 404, code: 'not_found' }), GONE);
  assert.equal(refusalText({ status: 400, code: 'invalid_capacity' }), 'Use a whole number, 0 or more.');
  assert.equal(refusalText({ status: 500 }), 'That did not go through. Try again.');
  assert.equal(SUSPENDED, 'This studio’s licence is suspended, so approving and featuring are paused until HQ lifts it.');
});

/* ------------------------------------------------------------------ *
 * Wiring and the source
 * ------------------------------------------------------------------ */

const DESK_FILES = ['frontend/src/pages/admin/AdminEventsPage.jsx',
  ...readdirSync(resolve(root, 'frontend/src/pages/admin/events')).filter((f) => /\.jsx?$/.test(f)).map((f) => `frontend/src/pages/admin/events/${f}`)];

test('the routes: each address under the same guard, at App.jsx\'s six-space indent, static paths before :id', () => {
  const app = read('frontend/src/App.jsx');
  const lines = ['/admin/events', '/admin/events/review', '/admin/events/all', '/admin/events/:id']
    .map((p) => `\n      <Route path="${p}" element={guard(['admin'], <AdminEventsPage />)} />`);
  for (const l of lines) assert.ok(app.includes(l), l.trim());
  const at = lines.map((l) => app.indexOf(l));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'Overview, Review, All events, then :id');
  assert.doesNotMatch(app, /path="\/admin\/events\/calendar"/, 'part 4 adds Calendar');
  assert.equal((app.match(/<AdminEventsPage \/>/g) || []).length, 4);
});

test('the page keeps its frame, its crumb and its literal tab doors', () => {
  const page = read('frontend/src/pages/admin/AdminEventsPage.jsx');
  assert.match(page, /export default function AdminEventsPage\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Events" note="Eadwyn reads the events listed here\. An event is approved or published only when you do it\." data-testid="admin-board-events">/);
  assert.equal((page.match(/<AdminBoardFrame\b/g) || []).length, 1);
  const doors = [...page.matchAll(/<DeskTab to="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(doors, TABS.map((t) => t.path), 'the strip and TABS list the same three doors');
  assert.match(page, /<DeskTab to="\/admin\/events" end /, 'Overview is lit only on its own address');
  assert.match(page, /<Link to="\/admin\/held\/community" className=\{CRUMB_LINK\}>Community<\/Link> › Events/);
  assert.match(page, /<Link to="\/admin\/events\/all" className=\{CRUMB_LINK\}>‹ All events<\/Link>/);
  assert.match(page, /<Link to="\/events\/new" className=\{actionGhost\} data-testid="events-new">New event<\/Link>/, 'New event, not "New studio event" (O-STU)');
  assert.doesNotMatch(page, /to="\/admin\/community"/);
  // The approvals lane and the Community doors keep /admin/events.
  assert.match(read('frontend/src/pages/admin/HeldApprovals.jsx'), /to="\/admin\/events"/);
  assert.match(read('frontend/src/pages/admin/HeldCommunity.jsx'), /to="\/admin\/events"/);
});

test('the desk reads only R1, R2, R3 and R5, never the roster, R2\'s summary or conversion', () => {
  // The comments say why each of these is not read; the code must not read it.
  const src = DESK_FILES.map((f) => codeOnly(read(f))).join('\n');
  for (const call of ['adminEvents.list(', 'adminEvents.analytics()', 'adminEvents.get(', 'eventsApi.agenda(']) assert.ok(src.includes(call), `the desk no longer calls ${call}`);
  for (const write of ['adminEvents.approve(', 'adminEvents.reject(', 'adminEvents.feature(', 'adminEvents.unpublish(', 'adminEvents.cancel(', 'adminEvents.setCapacity(']) assert.ok(src.includes(write), write);
  assert.doesNotMatch(src, /\.roster\(|roster\(/, 'the roster carries names and emails');
  assert.doesNotMatch(src, /\.summary\b|\bsummary\./, 'R2\'s summary is all-time and hides its failure');
  assert.doesNotMatch(src, /conversion/, 'R2\'s conversion is 0 for every upcoming event');
  assert.doesNotMatch(src, /window\.confirm|useToast|dangerouslySetInnerHTML/);
  for (const imp of src.matchAll(/import \{([^}]+)\} from '[./]+lib\/api'/g)) {
    assert.deepEqual(imp[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).sort(), imp[1].includes('events as') ? ['adminEvents', 'events'] : ['adminEvents'], 'only the two existing clients');
  }
  // Nothing D915 §3 leaves undrawn: no type, format, period or chart.
  assert.doesNotMatch(src, /location_kind|\bev\.type\b|In person|'Online'|12 weeks|recharts|<svg/);
  for (const sample of ['Northwind', 'Bluefern', 'Rua Exemplo', 'Fund I', 'Pricing Workshop', 'Demo Day Rehearsal', '[$', '[3]']) assert.ok(!src.includes(sample), `a canvas sample reached the desk: ${sample}`);
});

test('docs: the folder is documented, ROUTE_MAP has the row, and the canvas is graded', () => {
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/admin/events/README.md')));
  assert.match(read('frontend/src/pages/admin/README.md'), /`events\/`/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /\n\| Events Console \| admin, super-admin \| `\/admin\/events`/);
  const incoming = read('design/incoming/README.md');
  assert.doesNotMatch(incoming, /S1's integration lands next and records its grade\s+here\./);
  assert.match(incoming, /\*\*Grade: UPGRADE\.\*\* `\/admin\/events` is live\./);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();
const liveIso = (days) => new Date(LIVE + days * DAY_MS).toISOString();

function worker({ list = [], queue = [], analytics = { summary: {}, events: [] }, event = null, agenda = { agenda: [] }, writes = {} } = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const m = url.match(/\/api\/admin\/events\/(\d+)\/(\w+)$/);
    if (method === 'POST' && m) return writes[m[2]] ? writes[m[2]](options) : response({ event: { id: Number(m[1]) } });
    if (url.includes('/api/admin/events/analytics')) return analytics instanceof Function ? analytics() : response(analytics);
    if (/\/api\/admin\/events\?/.test(url)) {
      const q = new URLSearchParams(url.split('?')[1]);
      const source = q.get('status') === 'pending_review' ? queue : list;
      if (source instanceof Function) return source(q);
      const offset = Number(q.get('offset'));
      return response({ events: source.slice(offset, offset + Number(q.get('limit'))) });
    }
    if (/\/api\/admin\/events\/\d+$/.test(url)) return event ? response({ event }) : response({ error: 'not_found' }, 404);
    if (/\/api\/events\/\d+\/agenda$/.test(url)) return response(agenda);
    return response({});
  };
}

/** A promise the test settles by hand, to hold a read open. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function mounted(url, handle) {
  const restore = installDocument();
  // The test DOM has no focus, no containment and no document events. The
  // desk moves focus and its menu listens on the document, so each node gets
  // `focus()` and `contains()`, and document listeners are kept to dispatch.
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    return n;
  };
  const listeners = new Map();
  document.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  document.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminEventsPage))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  // The test DOM keeps no attributes, so each node's React props are read instead.
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const buttonNode = (label) => nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
  return {
    requests, flush, text: () => text(container),
    textOf: (id) => text(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    props: (id) => props(byId(id)),
    node: byId,
    nodeProps: props,
    /** A button's props by its words, or null when no such button is drawn. */
    button: (label) => { const n = buttonNode(label); return n ? props(n) : null; },
    /** The test id of the focused node, or of its nearest ancestor that has one. */
    focused: () => { for (let n = document.activeElement; n; n = n.parentNode) { const id = props(n)['data-testid']; if (id) return id; } return null; },
    /** A left click on a router link, which navigates inside the MemoryRouter. */
    async follow(href) {
      const node = nodes().find((n) => String(n.tagName).toUpperCase() === 'A' && props(n).href === href);
      assert.ok(node, `no link to ${href}`);
      const e = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, target: node, currentTarget: node, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      await act(async () => { props(node).onClick(e); });
      await flush();
    },
    /** An event on the document, to each listener the page added. */
    async dispatch(type, event) { await act(async () => { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, ...event }); }); await flush(); },
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    /** A button by its words. */
    async press(label) {
      const node = nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const QUEUE = [
  ev(21, { title: 'Breakfast for founders', status: 'pending_review', admin_published: false, starts_at: liveIso(9), price_cents: 1500, audience_rules: { comp_official_partners: true } }),
  ev(22, { title: 'Office hours', status: 'pending_review', admin_published: false, starts_at: liveIso(3) }),
];

test('Review reads the whole queue from R1, draws its facts, and the tab carries the count', async () => {
  const view = await mounted('/admin/events/review', worker({ queue: QUEUE }));
  try {
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events?status=pending_review&limit=200&offset=0'), 'R1, waiting events, at 200');
    assert.ok(!view.requests.some((r) => r.url.includes('/analytics')), 'Review draws no count, so it reads none');
    assert.ok(!view.requests.some((r) => r.url.includes('/roster')));
    const t = view.text();
    assert.match(t, /Waiting for review · 2/);
    assert.match(t, /Sends no invitations\./, 'the first in the queue is the one starting soonest, with no free-seat flags');
    assert.equal(view.textOf('events-tab-review-count'), '2');
    assert.match(view.textOf('events-crumb'), /Community › Events/);
    assert.ok(view.testIds().includes('events-scope-chip'));
    assert.ok(view.hrefs().includes('/events/22/manage'), 'Open as host');
    await view.click('events-queue-row-21');
    assert.match(view.text(), /Sends free-seat invitations to official partners not invited yet\./);
    assert.match(view.text(), /Paid \$15/);
  } finally { await view.close(); }
});

test('Approve with "Also feature it" sends the approve, then {featured: true}, and says so when the second call fails', async () => {
  const view = await mounted('/admin/events/review', worker({ queue: QUEUE, writes: { feature: () => response({ error: 'admin_frozen' }, 403) } }));
  try {
    await view.click('events-approve');
    assert.ok(view.testIds().includes('events-approve-dialog'), 'a Lightbox, not a browser pop-up');
    await view.change('events-approve-feature', { checked: true });
    await view.click('events-approve-go');
    const posts = view.requests.filter((r) => r.method === 'POST');
    assert.deepEqual(posts.map((r) => r.url), ['/api/admin/events/22/approve', '/api/admin/events/22/feature']);
    assert.deepEqual(JSON.parse(posts[1].body), { featured: true });
    assert.match(view.textOf('events-done'), /^Approved\. Office hours is on the public calendar\. It is not featured: That did not go through: your account is frozen\./);
    assert.ok(!view.testIds().includes('events-approve-dialog'));
    assert.ok(view.hrefs().includes('/admin/events/22'), 'Open event');
  } finally { await view.close(); }
});

test('Send back needs a reason; a quick reason fills it, and a suspended licence is one sentence', async () => {
  const view = await mounted('/admin/events/review', worker({ queue: QUEUE, writes: { approve: () => response({ detail: 'Branch suspended by HQ', code: 'branch_suspended' }, 423) } }));
  try {
    await view.click('events-sendback');
    assert.equal(view.props('events-sendback-go').disabled, true, 'disabled until there is a reason');
    assert.equal(view.textOf('events-sendback-count'), '0 / 1000');
    await view.press('Add the venue');
    assert.equal(view.props('events-sendback-reason').value, QUICK_REASONS[0].text, 'a quick reason fills the text');
    assert.equal(view.textOf('events-sendback-count'), `${QUICK_REASONS[0].text.length} / 1000`);
    await view.change('events-sendback-reason', { value: 'Add the venue address.' });
    assert.equal(view.props('events-sendback-go').disabled, false);
    await view.click('events-sendback-go');
    const post = view.requests.find((r) => r.method === 'POST');
    assert.equal(post.url, '/api/admin/events/22/reject');
    assert.deepEqual(JSON.parse(post.body), { reason: 'Add the venue address.' });
    assert.match(view.textOf('events-done'), /Sent back\. The host of Office hours sees your reason\./);
    await view.click('events-approve');
    await view.click('events-approve-go');
    assert.equal(view.textOf('events-refusal'), SUSPENDED);
  } finally { await view.close(); }
});

test('All events joins R2 under Guard G: an empty analytics read is "Could not be read", never 0', async () => {
  const list = [ev(31, { title: 'Breakfast', starts_at: liveIso(4) }), ev(32, { title: 'Roundtable', starts_at: liveIso(-4), capacity: null })];
  const view = await mounted('/admin/events/all', worker({ list, analytics: { summary: { total_events: 0 }, events: [] } }));
  try {
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events?limit=200&offset=0'));
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events/analytics'));
    const rowText = view.textOf('events-all-row-31');
    assert.match(rowText, /Could not be read/);
    assert.doesNotMatch(rowText, /\b0%/);
    assert.match(view.text(), /Seat counts could not be read\./);
    assert.match(view.textOf('events-all-row-32'), /No cap/);
    assert.equal(view.textOf('events-all-range'), '1–2 of 2');
    assert.ok(view.hrefs().includes('/admin/events/31'), 'each title opens its event');
  } finally { await view.close(); }
  const counted = await mounted('/admin/events/all?status=published', worker({ list, analytics: { events: [row(31, 12, 0, 2)] } }));
  try {
    const r31 = counted.textOf('events-all-row-31');
    assert.match(r31, /12/);
    assert.match(r31, /30%/, 'fill = 12 of 40');
    assert.match(r31, /Not held yet/);
    assert.match(counted.textOf('events-all-row-32'), new RegExp(NOT_IN_READ), 'missing from R2\'s rows');
  } finally { await counted.close(); }
});

test('Overview pages R1 to the end, counts statuses from it, and says Not recorded where nothing stores a value', async () => {
  // Every start is on the live clock the page reads, so no event ends while the suite ages.
  const list = [
    ...Array.from({ length: 200 }, (_, i) => ev(i + 1, { starts_at: liveIso(-30 - i / 10) })),
    ev(201, { status: 'rejected', starts_at: liveIso(10) }), ev(202, { status: 'rejected', starts_at: liveIso(10) }), ev(203, { status: 'draft', starts_at: liveIso(10) }),
  ];
  // R2 as the Worker reads it: `ORDER BY e.starts_at DESC LIMIT 200`, so the three oldest ended events are not in it.
  const r2 = [...list].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, 200).map((e) => ({ ...row(e.id, 2, 1), starts_at: e.starts_at }));
  const view = await mounted('/admin/events', worker({ list, analytics: { events: r2 } }));
  try {
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events?limit=200&offset=200'), 'a full page asks for the next');
    assert.match(view.textOf('events-status-rejected'), /Sent back · 2/);
    assert.match(view.textOf('events-status-published'), /Published · 200/);
    assert.ok(view.hrefs().includes('/admin/events/all?status=rejected'), 'each chip opens All events with its status');
    assert.match(view.textOf('events-unrecorded-views'), /No store counts views of an event page/);
    assert.match(view.textOf('events-unrecorded-feedback'), /Events have no feedback form yet\./);
    assert.equal(view.textOf('events-tile-showup'),
      'Show-up rateNot in this read3 events are not in this read. The analytics read holds the 200 events that start latest, and some of these are older.',
      'three of the 200 ended events start before R2\'s 200 rows: never summed as if they had none');
    assert.match(view.textOf('events-tile-waiting'), /Waiting time not recorded yet/);
  } finally { await view.close(); }
});

test('a Worker that is down, or answers {}, draws no zero and does not throw', async () => {
  for (const handle of [() => response({ error: 'down' }, 503), () => response({})]) {
    const view = await mounted('/admin/events', handle);
    try {
      const t = view.text();
      assert.match(t, /could not be read/);
      for (const id of ['events-tile-waiting', 'events-tile-next30', 'events-tile-waitlists', 'events-tile-showup']) assert.doesNotMatch(view.textOf(id), /\b0\b|—/, id);
      assert.ok(view.testIds().includes('events-tabs'));
    } finally { await view.close(); }
  }
});

test('one event: R3, R2\'s row and R5; Not held yet before it ends; the roster stays with the host', async () => {
  const event = ev(41, { title: 'Demo night', starts_at: liveIso(6), ends_at: liveIso(6.1), capacity: 60, featured: true, price_cents: 4000, location_text: 'Main room' });
  const agenda = { agenda: [{ id: 1, event_id: 41, title: 'Doors', starts_at: liveIso(6), display_order: 0, speaker_name: null, location_text: 'Room A' }] };
  const view = await mounted('/admin/events/41', worker({ event, agenda, analytics: { events: [row(41, 42, 0, 6)] } }));
  try {
    for (const path of ['/api/admin/events/41', '/api/events/41/agenda', '/api/admin/events/analytics']) assert.ok(view.requests.some((r) => r.url === path), path);
    assert.ok(!view.requests.some((r) => r.url.includes('/roster')), 'never the roster');
    const t = view.text();
    assert.match(t, /Demo night/);
    assert.match(view.textOf('events-crumb'), /‹ All events/);
    assert.match(view.textOf('events-event-tile-taken'), /42/);
    assert.match(view.textOf('events-event-tile-taken'), /70% full/);
    assert.match(view.textOf('events-event-tile-showup'), /Not held yet/);
    assert.match(view.textOf('events-event-gate'), /On the public calendar/);
    assert.match(view.textOf('events-event-roster'), /Names and emails are on the host’s roster\./);
    assert.match(view.textOf('events-event-history'), /Created · 1 Oct 2026/);
    assert.match(view.textOf('events-event-history'), /Not read here yet/);
    assert.match(view.textOf('events-event-agenda'), /Doors/);
    assert.ok(view.hrefs().includes('/events/41/manage/registrations'));
    assert.ok(!view.testIds().includes('events-header'), 'the event\'s own header, not the desk\'s');
    await view.click('events-event-menu');
    assert.ok(view.hrefs().includes('/api/events/41/export') && view.hrefs().includes('/api/events/41/ics'));
    assert.ok(view.hrefs().includes('/events/ev-41'), 'public, published and approved: its public page');
  } finally { await view.close(); }
  const gone = await mounted('/admin/events/99', worker({}));
  try {
    assert.ok(gone.testIds().includes('events-event-gone'));
    assert.match(gone.text(), /This event no longer exists\./);
  } finally { await gone.close(); }
});

test('one event\'s cancel waits for the refund box on a paid event, and the capacity dialog previews what it does', async () => {
  const event = ev(51, { title: 'Paid supper', price_cents: 4000, capacity: 60, starts_at: liveIso(6) });
  const view = await mounted('/admin/events/51', worker({ event, analytics: { events: [row(51, 60, 0, 6)] }, writes: { capacity: () => response({ event, promoted: 6 }) } }));
  try {
    // Capacity: raising to 66 moves six off the waitlist, in StudioOS.
    await view.press('Change capacity');
    assert.ok(view.testIds().includes('events-capacity-dialog'));
    assert.match(view.text(), /Now: 60 seats · 60 taken · 6 waiting\./);
    await view.change('events-capacity-input', { value: '66' });
    assert.equal(view.textOf('events-capacity-line'), '6 people move off the waitlist, oldest first. Each is told in StudioOS.');
    await view.click('events-capacity-go');
    const post = view.requests.find((r) => r.method === 'POST');
    assert.equal(post.url, '/api/admin/events/51/capacity');
    assert.deepEqual(JSON.parse(post.body), { capacity: 66 });
    assert.match(view.textOf('events-done'), /Capacity saved\. 6 people moved off the waitlist\./);
    // Cancel: the refund box gates the button, and nothing is sent until it is ticked.
    await view.press('Cancel event');
    assert.match(view.textOf('events-cancel-paid'), /not refunded automatically/);
    assert.equal(view.props('events-cancel-go').disabled, true);
    await view.change('events-cancel-understood', { checked: true });
    assert.equal(view.props('events-cancel-go').disabled, false);
    assert.equal(view.requests.filter((r) => r.method === 'POST').length, 1);
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * The review (2026-10-24): D915 §7
 * ------------------------------------------------------------------ */

test('coming back from an event\'s page reads the list, R2 and the queue again together, so a new event has its counts', async () => {
  const base = [ev(31, { title: 'Breakfast', starts_at: liveIso(4) }), ev(32, { title: 'Roundtable', starts_at: liveIso(8) })];
  let lists = 0;
  let counts = 0;
  // Event 33 is created while the admin is on event 31's page.
  const list = () => { lists += 1; return response({ events: lists === 1 ? base : [ev(33, { title: 'Supper', starts_at: liveIso(2) }), ...base] }); };
  const analytics = () => { counts += 1; return response({ events: [row(31, 4), row(32, 5), ...(counts === 1 ? [] : [row(33, 7)])] }); };
  const view = await mounted('/admin/events/all', worker({ list, analytics, event: base[0] }));
  const made = (path) => view.requests.filter((r) => r.url === path).length;
  const R1 = '/api/admin/events?limit=200&offset=0';
  const R2 = '/api/admin/events/analytics';
  const QUEUE_READ = '/api/admin/events?status=pending_review&limit=200&offset=0';
  try {
    assert.deepEqual([made(R1), made(R2), made(QUEUE_READ)], [1, 1, 1]);
    await view.follow('/admin/events/31');
    assert.ok(view.testIds().includes('events-event'));
    await view.follow('/admin/events/all');
    assert.equal(made(R1), 2, 'the list is read again on the way back');
    assert.equal(made(R2), 3, 'and R2 with it, as it was with the event page');
    assert.equal(made(QUEUE_READ), 3, 'and the queue');
    const r33 = view.textOf('events-all-row-33');
    assert.doesNotMatch(r33, new RegExp(NOT_IN_READ), 'a new event is joined to counts read at the same moment');
    assert.match(r33, /18%/, 'fill = 7 of 40');
  } finally { await view.close(); }
});

test('"Updated" is the oldest answer among the reads the tab draws, never a newer one', async () => {
  const realNow = Date.now;
  let clock = LIVE;
  Date.now = () => clock;
  const held = { queue: deferred(), list: deferred(), analytics: deferred() };
  const T = [0, 10, 20, 30].map((m) => LIVE + m * 60_000);
  try {
    const view = await mounted('/admin/events', worker({ queue: () => held.queue.promise, list: () => held.list.promise, analytics: () => held.analytics.promise }));
    try {
      assert.equal(view.textOf('events-asof'), 'Reading…', 'nothing has answered yet');
      clock = T[0]; held.queue.resolve(response({ events: QUEUE })); await view.flush();
      clock = T[1]; held.list.resolve(response({ events: [ev(31, { starts_at: liveIso(4) })] })); await view.flush();
      clock = T[2]; held.analytics.resolve(response({ events: [row(31, 4)] })); await view.flush();
      assert.equal(view.textOf('events-asof'), `Updated ${clockLabel(T[0])}`, 'the Waiting tile and the Review count are the queue read at T0');
      // Review draws the queue alone, read again on the way in: the list's and R2's times are not its.
      clock = T[3];
      await view.follow('/admin/events/review');
      assert.equal(view.textOf('events-asof'), `Updated ${clockLabel(T[3])}`);
    } finally { await view.close(); }
  } finally { Date.now = realNow; }
});

test('the header says "Could not be read" once every read the tab makes has failed, and "Reading…" only while one is out', async () => {
  for (const url of ['/admin/events', '/admin/events/review', '/admin/events/all']) {
    const view = await mounted(url, () => response({ error: 'down' }, 503));
    try {
      assert.equal(view.textOf('events-asof'), 'Could not be read', url);
    } finally { await view.close(); }
  }
  const out = deferred();
  const view = await mounted('/admin/events/review', () => out.promise);
  try {
    assert.equal(view.textOf('events-asof'), 'Reading…', 'the queue read is still out');
    out.resolve(response({ error: 'down' }, 503));
    await view.flush();
    assert.equal(view.textOf('events-asof'), 'Could not be read');
  } finally { await view.close(); }
});

test('Review: a decided event leaves the queue at once, so it cannot be approved or sent back again before the re-read lands', async () => {
  const later = deferred();
  let reads = 0;
  const queue = () => { reads += 1; return reads === 1 ? response({ events: QUEUE }) : later.promise; };
  const view = await mounted('/admin/events/review', worker({ queue }));
  try {
    assert.ok(view.testIds().includes('events-queue-row-22'));
    await view.click('events-approve');
    await view.click('events-approve-go');
    assert.equal(reads, 2, 'the approve reads the queue again, and that read is still out');
    assert.ok(!view.testIds().includes('events-queue-row-22'), 'the approved event is out of the queue');
    assert.ok(view.testIds().includes('events-queue-row-21'));
    assert.match(view.text(), /Waiting for review · 1/);
    assert.equal(view.textOf('events-approving-does'), 'What approving doesPuts the event on the public calendar at axal.vc/events.Tells the host it is live.Sends free-seat invitations to official partners not invited yet.',
      'the action bar acts on the next event, Breakfast for founders');
    assert.equal(view.focused(), 'events-done', 'focus moves to the confirmation line');
    // A read newer than the decision is the truth again, whatever it holds.
    later.resolve(response({ events: QUEUE }));
    await view.flush();
    assert.ok(view.testIds().includes('events-queue-row-22'), 'once a newer read lands, the queue is that read');
  } finally { await view.close(); }
});

test('one event: after Cancel, focus moves to the confirmation line and the actions wait for the re-read', async () => {
  const event = ev(61, { title: 'Supper club', starts_at: liveIso(6) });
  const later = deferred();
  let gets = 0;
  const base = worker({ event, analytics: { events: [row(61, 3)] } });
  const handle = (url, options = {}) => {
    if (url === '/api/admin/events/61' && String(options.method || 'GET').toUpperCase() === 'GET') {
      gets += 1;
      return gets === 1 ? response({ event }) : later.promise;
    }
    return base(url, options);
  };
  const view = await mounted('/admin/events/61', handle);
  try {
    await view.press('Cancel event');
    await view.click('events-cancel-go');
    assert.deepEqual(view.requests.filter((r) => r.method === 'POST').map((r) => r.url), ['/api/admin/events/61/cancel']);
    assert.equal(view.textOf('events-done'), 'Supper club is cancelled.');
    assert.equal(view.focused(), 'events-done', 'focus moves to the confirmation line');
    for (const label of ['Change capacity', 'Feature', 'Unpublish', 'Cancel event']) assert.equal(view.button(label)?.disabled, true, `${label} waits for the re-read`);
    later.resolve(response({ event: { ...event, status: 'cancelled', admin_published: false } }));
    await view.flush();
    assert.equal(view.button('Cancel event'), null, 'the re-read removes the button that opened the dialog');
    assert.equal(view.button('Unpublish'), null);
    assert.equal(view.focused(), 'events-done', 'and focus is still on the line, not lost to the page');
    assert.equal(view.button('Change capacity').disabled, false, 'a read newer than the write frees the actions');
  } finally { await view.close(); }
});

test('More actions is a disclosure hung from the actions row; Escape, a click outside, focus leaving and a pick close it', async () => {
  const event = ev(71, { title: 'Demo night', starts_at: liveIso(6) });
  const view = await mounted('/admin/events/71', worker({ event, analytics: { events: [row(71, 1)] } }));
  const open = () => view.testIds().includes('events-event-menu-list');
  try {
    const btn = view.props('events-event-menu');
    assert.equal(btn['aria-haspopup'], undefined, 'not announced as a menu: its items are links');
    assert.equal(btn['aria-expanded'], false);
    await view.click('events-event-menu');
    const list = view.props('events-event-menu-list');
    assert.equal(view.props('events-event-menu')['aria-expanded'], true);
    assert.ok(list.id, 'the list has an id');
    assert.equal(view.props('events-event-menu')['aria-controls'], list.id);
    // On a phone ⋯ wraps to the left; the list hangs from the row, which spans the content width.
    assert.ok(view.props('events-event-actions').className.split(/\s+/).includes('relative'), 'the actions row places the list');
    const wrapper = view.node('events-event-menu').parentNode;
    assert.ok(!String(view.nodeProps(wrapper).className || '').split(/\s+/).includes('relative'), '⋯\'s own wrapper does not');
    const cls = list.className.split(/\s+/);
    for (const c of ['absolute', 'right-0', 'top-full', 'max-w-full', 'w-[240px]']) assert.ok(cls.includes(c), c);
    // Escape closes it and puts focus back on ⋯.
    await view.dispatch('keydown', { key: 'Escape' });
    assert.equal(open(), false, 'Escape closes it');
    assert.equal(view.focused(), 'events-event-menu');
    // A click inside keeps it; a click outside closes it.
    await view.click('events-event-menu');
    await view.dispatch('mousedown', { target: view.node('events-event-menu-roster') });
    assert.equal(open(), true, 'a click inside keeps it open');
    await view.dispatch('mousedown', { target: view.node('events-event-gate') });
    assert.equal(open(), false, 'a click outside closes it');
    // Focus moving to another item keeps it; focus moving out of it closes it.
    await view.click('events-event-menu');
    await act(async () => { view.nodeProps(wrapper).onBlur({ relatedTarget: view.node('events-event-menu-roster') }); });
    assert.equal(open(), true, 'focus moving inside keeps it open');
    await act(async () => { view.nodeProps(wrapper).onBlur({ relatedTarget: view.node('events-event-gate') }); });
    assert.equal(open(), false, 'focus moving out closes it');
    // Picking an item closes it, and focus goes back to ⋯ rather than to the removed link.
    await view.click('events-event-menu');
    view.node('events-event-gate').focus();
    await view.click('events-event-menu-roster');
    assert.equal(open(), false, 'a pick closes it');
    assert.equal(view.focused(), 'events-event-menu');
  } finally { await view.close(); }
});

test('an event address that cannot be decoded draws "This event no longer exists." inside the desk, and reads nothing for it', async () => {
  const view = await mounted('/admin/events/%E0', worker({}));
  try {
    assert.equal(view.textOf('events-event-gone'), `${GONE}All events`);
    assert.ok(view.testIds().includes('events-tabs'), 'the desk\'s frame is drawn, not the error boundary');
    assert.ok(!view.requests.some((r) => /\/api\/admin\/events\/[^?]/.test(r.url) && !r.url.endsWith('/analytics')), 'no R3 read');
  } finally { await view.close(); }
});
