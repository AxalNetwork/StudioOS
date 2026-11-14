/**
 * D570 (#1174) — Wellbeing built to the Ops canvas: the member home, booking an
 * expert, the expert's practice and the admin resource library.
 *
 * The screens are rendered from their exported components with fixtures shaped
 * like the Worker's own responses, and the model is driven against the Worker's
 * own validator (`validateDailyBody`) rather than a copy of it. So a test here
 * fails when the page drifts from the route, AND when the route drifts from the
 * page: the second direction is what "the real route's shape" means below.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_d570.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DAILY_KEYS, CHECKIN_KEYS, validateDailyBody } from '../../cloudflare-worker/src/routes/wellbeing.helpers.ts';
import { VALID_MODALITIES, VALID_PRICING_MODELS } from '../../cloudflare-worker/src/data/expertCategories.ts';
import * as M from '../src/pages/wellbeing/wellbeingModel.js';
import { CheckinCard, PastWeeksCard, MyBookingsCard, ResourcesCard, PulseCounts } from '../src/pages/WellbeingPage.jsx';
import WellbeingBookPage, {
  DirectoryToolbar, ExpertColumn, ServiceColumn, TimeColumn, ConfirmColumn, SERVICE_GAP,
} from '../src/pages/wellbeing/WellbeingBookPage.jsx';
import { BOOKING_ROLES, BookingCard, ServicesPanel, viewerOf } from '../src/pages/ExpertProfilePage.jsx';
import {
  ServiceRow, ServiceForm, ServicesCard, AvailabilityGrid, AvailabilityCard, PracticeBookingRow, PracticeBookingsCard,
} from '../src/pages/wellbeing/PracticeZones.jsx';
import { LibraryToolbar, ResourceTable, ResourceEditor } from '../src/pages/wellbeing/WellbeingResourceLibrary.jsx';
import { BecomeExpert } from '../src/pages/ExpertEditorPage.jsx';
import { codeOnly } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const ROUTE = read('cloudflare-worker/src/routes/wellbeing.ts');
/** One handler's source, from its declaration to the next `wellbeing.` route. */
const handler = (decl) => {
  const at = ROUTE.indexOf(decl);
  assert.ok(at >= 0, `${decl} is no longer in wellbeing.ts`);
  const next = ROUTE.indexOf('\nwellbeing.', at + decl.length);
  return ROUTE.slice(at, next < 0 ? undefined : next);
};

const TODAY = '2026-10-06'; // a Tuesday; its week starts Monday 5 October
const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const UTC = { timeZone: 'UTC' };

// ── The check-in, against the real route ─────────────────────────────────────

test('the real route: eight stored scores, and one check-in per week that replaces, never refuses (D574)', () => {
  assert.deepEqual(M.ROUTE_SCORE_KEYS, [...DAILY_KEYS], 'the page stores what the validator accepts, in its order');
  assert.deepEqual(M.CANVAS_SCORES.map((s) => s.key), ['stress', 'sleep', 'support', 'decisions', 'energy'], 'the canvas’s five, in its order');
  for (const s of M.CANVAS_SCORES) assert.ok(DAILY_KEYS.includes(s.field), `${s.key} is stored`);
  for (const s of M.MORE_SCORES) assert.ok(DAILY_KEYS.includes(s.field));
  assert.ok(CHECKIN_KEYS.every((k) => k === 'support' || k === 'decisions' || DAILY_KEYS.includes(k)), 'every canvas question is now a stored score');

  // D574: support and decisions are kept; a 'notes' key is still not the note.
  const v = validateDailyBody({ stress: 3, support: 4, decisions: 2, notes: 'kept?' });
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.values), [...DAILY_KEYS]);
  assert.equal(v.values.support, 4);
  assert.equal(v.values.decisions, 2);
  assert.equal(v.free_text, null);

  const submit = ROUTE.slice(ROUTE.indexOf('export async function submitCanonicalCheckin'), ROUTE.indexOf("wellbeing.post('/checkins'"));
  assert.match(submit, /validateDailyBody\(body\)/);
  assert.match(submit, /INSERT INTO wellbeing_daily_pulses/);
  assert.match(submit, /ON CONFLICT\(user_id, day\) DO UPDATE SET/, 'a second save on the same day replaces the first');
  assert.match(submit, /free_text_enc = excluded\.free_text_enc, tags_enc = excluded\.tags_enc/, 'the upsert overwrites every column');
  assert.match(submit, /const week = weekSpan\(v\.day\);/, 'the route keeps one check-in per week');
  assert.match(submit, /const day = existing\?\.day \?\? v\.day;/, 'a second save that week replaces the week\'s row');
  assert.doesNotMatch(submit, /week_anchor|409/, 'and nothing refuses a second save');
  assert.match(handler("wellbeing.get('/checkins'"), /clampLimit\(c\.req\.query\('limit'\), 30, 200\)/);
  assert.equal(M.HISTORY_ROW_CAP, 30);
  assert.match(read('cloudflare-worker/sql/migrations/395_wellbeing_weekly_and_library.sql'), /support_enc[\s\S]*decisions_enc/);
});

test('the body: only answered scores, the note as free_text, and day only to replace this week', () => {
  const body = M.buildCheckinPayload({ values: { stress: 4, sleep: 2, energy: 3, support: 5, mood: null }, note: '   ', tags: ['executive_coach'] });
  assert.deepEqual(body, { stress: 4, sleep: 2, energy: 3, support: 5, free_text: null, tags: ['executive_coach'] });
  for (const k of ['decisions', 'notes', 'day']) assert.equal(k in body, false, `${k} is not sent when unanswered or not this page's`);
  const v = validateDailyBody(body);
  assert.equal(v.ok, true);
  assert.deepEqual(v.values, { mood: null, stress: 4, sleep: 2, energy: 3, focus: null, social: null, support: 5, decisions: null }, 'an unanswered score is absent, never a default 3');
  assert.equal(v.day, new Date().toISOString().slice(0, 10), 'no day: the route writes its own today');

  const none = M.buildCheckinPayload({ values: {} });
  assert.equal(M.answeredCount(none), 0);
  assert.equal(validateDailyBody(none).ok, false, 'the route refuses a body with no score, so the page checks first');
  assert.equal(M.buildCheckinPayload({ values: { stress: 7, sleep: 2.5 } }).stress, undefined, 'out of range is not sent');
  assert.equal(M.buildCheckinPayload({ note: 'hello' }).free_text, 'hello');
  assert.equal(M.buildCheckinPayload({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }).tags.length, M.MAX_TAGS);
});

const ENTRY = {
  id: 9, uid: 'c9', day: '2026-10-05', mood: 3, stress: 4, sleep: 3, energy: 2, focus: null, social: 5,
  free_text: 'only mine', tags: ['burnout_specialist'], created_at: '2026-10-05 09:00:00',
};
const LAST_WEEK = { id: 8, uid: 'c8', day: '2026-09-29', stress: 2, sleep: 4, energy: 3, tags: [], created_at: '2026-09-29 09:00:00' };

test('one per week: a save this week replaces this week’s entry on its own day; a new week starts a new one', () => {
  assert.equal(M.weekStart('2026-10-05'), '2026-10-05');
  assert.equal(M.weekStart('2026-10-11'), '2026-10-05', 'Sunday closes the week');
  assert.equal(M.weekStart('2026-10-12'), '2026-10-12');

  const entry = M.thisWeekEntry([LAST_WEEK, ENTRY], TODAY);
  assert.equal(entry.uid, 'c9');
  const body = M.buildCheckinPayload({ ...M.formFromEntry(entry), entry });
  assert.deepEqual(body, {
    mood: 3, stress: 4, sleep: 3, energy: 2, social: 5, free_text: 'only mine', tags: ['burnout_specialist'], day: '2026-10-05',
  }, 'every stored value goes back, or the upsert would erase it');
  const v = validateDailyBody(body);
  assert.equal(v.ok, true);
  assert.equal(v.day, '2026-10-05', 'the route upserts Monday’s row: one entry for the week');

  assert.equal(M.thisWeekEntry([LAST_WEEK, ENTRY], '2026-10-12'), null, 'next Monday the week is empty again');
  assert.equal(M.thisWeekEntry([LAST_WEEK], TODAY), null);
  assert.equal(M.thisWeekEntry([ENTRY, { ...LAST_WEEK, uid: 'c10', day: '2026-10-06' }], '2026-10-07').uid, 'c10', 'with two rows in a week, the latest is replaced');
  assert.equal(M.thisWeekEntry([ENTRY], null), null);
});

test('the check-in card: each state, the five canvas rows, and a second save this week replaces — never refused', () => {
  const blank = M.formFromEntry(null);
  assert.match(html(h(CheckinCard, { status: 'loading', form: blank })), /animate-pulse/);

  const unread = text(h(CheckinCard, { status: 'unreadable', form: blank, onRetry: () => {} }));
  assert.match(unread, /Your check-ins could not be read\. Saving waits until they can be read/);
  assert.doesNotMatch(unread, /Save check-in/, 'no save while the week cannot be read: it could be written twice');

  const emptyMarkup = html(h(CheckinCard, { status: 'ready', today: TODAY, entry: null, form: blank }));
  const empty = text(h(CheckinCard, { status: 'ready', today: TODAY, entry: null, form: blank }));
  assert.match(empty, /This week’s check-in week of Mon 5 Oct · one per week/);
  assert.match(empty, /No check-in this week yet\./);
  assert.match(empty, /Save check-in/);
  assert.match(empty, /Private note \(optional\)/);
  assert.match(empty, /Stored encrypted\. Only you can read it\./);
  // D574: the canvas's five are all asked, support and decisions included.
  assert.match(empty, /Support 1 2 3 4 5 1 · On my own — 5 · Well supported Decisions 1 2 3 4 5 1 · Stuck — 5 · Clear/);
  for (const k of ['stress', 'sleep', 'support', 'decisions', 'energy']) assert.match(emptyMarkup, new RegExp(`data-testid="score-${k}"`));
  assert.doesNotMatch(emptyMarkup, /not-recorded/);
  assert.doesNotMatch(emptyMarkup, /aria-checked="true"/, 'nothing is pre-answered');
  assert.doesNotMatch(emptyMarkup, /<details[^>]* open=""/, 'the extra scores stay folded when unused');

  const again = text(h(CheckinCard, { status: 'ready', today: TODAY, entry: ENTRY, form: M.formFromEntry(ENTRY) }));
  assert.match(again, /You checked in on Mon 5 Oct\. Saving again replaces that entry\./);
  assert.match(again, /Update this week/);
  assert.doesNotMatch(again, /already|refus|not allowed|limit/i, 'nothing refuses a second save, so nothing says one is refused');
  const prefilled = html(h(CheckinCard, { status: 'ready', today: TODAY, entry: ENTRY, form: M.formFromEntry(ENTRY) }));
  assert.match(prefilled, /role="radio" aria-checked="true" aria-label="Stress 4 of 5"/);
  assert.match(prefilled, /role="radio" aria-checked="true" aria-label="Connection 5 of 5 \(Supported\)"/);
  assert.match(prefilled, /<details[^>]* open=""/, 'a stored extra score is shown, since a save sends it back');
  assert.match(prefilled, />only mine<\/textarea>/);

  const refused = text(h(CheckinCard, {
    status: 'ready', today: TODAY, entry: null, form: blank,
    save: { saving: false, ok: null, error: 'Invalid input', fieldErrors: { stress: 'stress must be an integer 1..5' } },
  }));
  assert.match(refused, /stress must be an integer 1\.\.5/);
  assert.match(refused, /Invalid input/);
  const saved = text(h(CheckinCard, { status: 'ready', today: TODAY, entry: ENTRY, form: M.formFromEntry(ENTRY), save: { ok: 'Updated this week’s check-in.', fieldErrors: {} } }));
  // D574: the route says whether the save was encrypted; a plaintext backstop save is never called encrypted.
  const card = (encrypted) => text(h(CheckinCard, { status: 'ready', today: TODAY, entry: ENTRY, form: M.formFromEntry(ENTRY), save: { ok: 'Saved.', fieldErrors: {}, encrypted } }));
  assert.match(card(true), /Saved encrypted\. Only you can read it\./);
  assert.match(card(false), /Saved, but not encrypted: the server could not encrypt it this time\./);
  assert.doesNotMatch(card(false), /Stored encrypted|Saved encrypted/);
  assert.match(saved, /Updated this week’s check-in\./);
});

// ── My past weeks ─────────────────────────────────────────────────────────────

test('past weeks: a week without a check-in is a gap, never a zero; a full page leaves older weeks unread', () => {
  const rows = [
    { day: '2026-10-05', stress: 4, sleep: 3, energy: 2 },
    { day: '2026-09-22', stress: 2, sleep: 5, energy: 4 },
    { day: '2026-09-23', stress: 4, sleep: 5, energy: null },
  ];
  const weeks = M.pastWeeks(rows, TODAY);
  assert.deepEqual(weeks.map((w) => w.week), [
    '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05',
  ]);
  assert.deepEqual(weeks.map((w) => w.values.stress), [null, null, null, null, null, 3, null, 4]);
  assert.deepEqual(weeks.map((w) => w.values.energy), [null, null, null, null, null, 4, null, 2], 'a missing answer is skipped, not averaged in as zero');
  assert.deepEqual(weeks.map((w) => w.entries), [0, 0, 0, 0, 0, 2, 0, 1]);
  assert.ok(weeks.every((w) => !w.unread));

  const { d, dots } = M.sparkPath([null, 2, 3, null, 5]);
  assert.equal((d.match(/M/g) || []).length, 2, 'the gap breaks the line');
  assert.deepEqual(dots, [{ x: 126, y: 3 }], 'a point with no neighbour is still drawn');
  for (const y of [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))) assert.ok(y >= 3 && y <= 23, 'every point sits on the 1–5 scale');
  assert.equal(M.sparkPath([null, null]).d, '');

  const thirty = Array.from({ length: 30 }, (_, i) => ({ day: M.addDays(TODAY, -i), stress: 3 }));
  assert.deepEqual(M.pastWeeks(thirty, TODAY).map((w) => w.unread), [true, true, true, true, false, false, false, false],
    'thirty daily rows reach back to 7 Sep: that week and older may hold rows the read did not return');
  assert.ok(M.pastWeeks(thirty.slice(0, 29), TODAY).every((w) => !w.unread), 'a short page read everything there is');
});

test('the past-weeks card: each state, and support and decisions as lines with gaps for older weeks (D574)', () => {
  assert.match(html(h(PastWeeksCard, { status: 'loading' })), /animate-pulse/);
  assert.match(text(h(PastWeeksCard, { status: 'unreadable', onRetry: () => {} })), /Your past weeks could not be read\. This is not a sign that you skipped them\./);
  assert.match(text(h(PastWeeksCard, { status: 'ready', weeks: M.pastWeeks([], TODAY) })), /No past weeks yet\./);

  const weeks = M.pastWeeks([ENTRY, { day: '2026-09-22', stress: 2, sleep: 5, energy: 4, social: 2 }], TODAY);
  const markup = html(h(PastWeeksCard, { status: 'ready', weeks }));
  const t = text(h(PastWeeksCard, { status: 'ready', weeks }));
  assert.match(t, /My past weeks 8 weeks · 1 = low · 5 = high/);
  assert.match(t, /2 of 8 weeks have a check-in\. A week without one is a gap in the line, never a zero\./);
  assert.match(t, /Weeks saved before support and decisions were asked have neither: those are gaps, never zeros\./);
  for (const k of ['stress', 'sleep', 'support', 'decisions', 'energy']) assert.match(markup, new RegExp(`data-testid="spark-${k}"`));
  assert.match(markup, /aria-label="Support, oldest week first: (no check-in, ){7}no check-in"/, 'a week with no support answer is a gap');
  const answered = html(h(PastWeeksCard, { status: 'ready', weeks: M.pastWeeks([{ ...ENTRY, support: 4 }], TODAY) }));
  assert.match(answered, /aria-label="Support, oldest week first: (no check-in, ){7}4"/);
  assert.match(markup, /aria-label="Stress, oldest week first: no check-in, no check-in, no check-in, no check-in, no check-in, 2, no check-in, 4"/);
  assert.match(t, /Also recorded Mood .*Connection/, 'scores the canvas does not draw are still shown when recorded');

  const thirty = Array.from({ length: 30 }, (_, i) => ({ day: M.addDays(TODAY, -i), stress: 3 }));
  assert.match(text(h(PastWeeksCard, { status: 'ready', weeks: M.pastWeeks(thirty, TODAY) })),
    /Weeks up to Mon 7 Sep are left blank: they are older than the 30 most recent check-ins this page reads\./);
});

// ── My bookings ───────────────────────────────────────────────────────────────

const MY_BOOKINGS = [
  { uid: 'b1', status: 'scheduled', payment_status: 'free', scheduled_at: '2026-10-08T10:00:00.000Z', duration_minutes: 30, meet_link: 'https://meet.jit.si/axal-b1', expert_uid: 'e1', expert_name: 'Dr Ada', booker_note: 'PRIVATE NOTE', notes: 'PRIVATE NOTE' },
  { uid: 'b2', status: 'requested', scheduled_at: null, duration_minutes: 30, meet_link: null, expert_uid: 'e2', expert_name: 'Sam Coach' },
  { uid: 'b3', status: 'confirmed', scheduled_at: '2026-09-30T10:00:00.000Z', duration_minutes: 30, expert_uid: 'e1', expert_name: 'Dr Ada' },
  { uid: 'b4', status: 'cancelled', scheduled_at: '2026-10-09T10:00:00.000Z', duration_minutes: 30, expert_uid: 'e3', expert_name: 'Lee' },
  { uid: 'b5', status: 'pending_payment', scheduled_at: '2026-09-29T10:00:00.000Z', duration_minutes: 50, expert_uid: 'e3', expert_name: 'Lee', meet_link: 'javascript:alert(1)' },
];

test('bookings split into upcoming and past; only a held session can be rated', () => {
  const { upcoming, past } = M.splitBookings(MY_BOOKINGS, NOW);
  assert.deepEqual(upcoming.map((b) => b.uid), ['b1', 'b2'], 'a timed booking first; one with no time stays upcoming until it is closed');
  assert.deepEqual(past.map((b) => b.uid), ['b4', 'b3', 'b5'], 'a cancelled booking is past, whatever its date');
  assert.deepEqual(MY_BOOKINGS.map((b) => M.canRate(b, NOW)), [false, false, true, false, false]);
  assert.deepEqual(M.bookingStatus('pending_payment'), { label: 'Awaiting payment', tone: 'warn' });
  assert.equal(M.bookingStatus('weird_state').label, 'Weird State');
  assert.equal(M.bookingStatus(null).label, 'Status not recorded');
});

test('my bookings card: names, the service, times and status; a cancel for what the route allows; no note (D574)', () => {
  const withService = MY_BOOKINGS.map((b) => (b.uid === 'b1' ? { ...b, service_title: 'Intro call' } : b));
  const props = { status: 'ready', bookings: withService, now: NOW, timeZone: 'UTC', onTab: () => {}, onRate: () => {} };
  const up = text(h(MyBookingsCard, { ...props, tab: 'upcoming' }));
  const upMarkup = html(h(MyBookingsCard, { ...props, tab: 'upcoming' }));
  assert.match(up, /Upcoming · 2 Past · 3/);
  assert.match(up, /Dr Ada · Intro call Thu 8 Oct · 10:00 · 30 min Scheduled Join call Cancel/);
  assert.match(up, /Sam Coach · no service chosen Time not recorded · 30 min Requested Cancel/);
  assert.match(upMarkup, /href="https:\/\/meet\.jit\.si\/axal-b1"/);
  assert.match(upMarkup, /data-testid="button-cancel-b1"/);
  assert.doesNotMatch(up, /not available yet/);
  assert.match(text(h(MyBookingsCard, { ...props, tab: 'upcoming', cancels: { b1: { stage: 'confirm' } } })), /Cancel this session\? Yes, cancel Keep it/);
  assert.match(text(h(MyBookingsCard, { ...props, tab: 'upcoming', cancels: { b1: { error: 'This session is paid for.' } } })), /This session is paid for\./);
  // A paid session is the expert's to cancel, with its refund: no button, and the card says why.
  const paid = withService.map((b) => (b.uid === 'b1' ? { ...b, payment_status: 'paid', status: 'confirmed' } : b));
  const paidUp = html(h(MyBookingsCard, { ...props, bookings: paid, tab: 'upcoming' }));
  assert.doesNotMatch(paidUp, /button-cancel-b1/);
  assert.match(text(h(MyBookingsCard, { ...props, bookings: paid, tab: 'upcoming' })), /A paid session is cancelled by the expert, so its payment is refunded with it\./);
  assert.deepEqual([
    { status: 'scheduled', scheduled_at: '2026-10-08T10:00:00.000Z' },
    { status: 'scheduled', scheduled_at: '2026-09-01T10:00:00.000Z' },
    { status: 'confirmed', payment_status: 'paid', scheduled_at: '2026-10-08T10:00:00.000Z' },
    { status: 'completed', scheduled_at: '2026-10-08T10:00:00.000Z' },
    { status: 'requested', scheduled_at: null },
  ].map((b) => M.canMemberCancel(b, NOW)), [true, false, false, false, true], 'the route\'s own rules: open, unpaid, not started');
  assert.match(up, /A booking made here carries no note\./);
  assert.doesNotMatch(up, /none records its service/);
  assert.match(upMarkup, /href="\/wellbeing\/book"/);

  const pastMarkup = html(h(MyBookingsCard, { ...props, tab: 'past' }));
  assert.match(pastMarkup, /data-testid="rate-b3"/);
  assert.doesNotMatch(pastMarkup, /rate-b4|rate-b5/, 'no rating for a cancelled or unpaid session');
  assert.doesNotMatch(pastMarkup, /javascript:/, 'a stored link that is not http(s) is never a href');
  assert.match(text(h(MyBookingsCard, { ...props, tab: 'past', rated: { b3: { stars: 4 } } })), /Rated 4 of 5\./);
  // D574: the stars already stored come with the booking, so they survive a reload.
  const stored = withService.map((b) => (b.uid === 'b3' ? { ...b, my_stars: 3 } : b));
  assert.match(text(h(MyBookingsCard, { ...props, bookings: stored, tab: 'past' })), /Rated 3 of 5\./);
  assert.match(text(h(MyBookingsCard, { ...props, bookings: stored, tab: 'past', rated: { b3: { stars: 5 } } })), /Rated 5 of 5\./, 'a new rating replaces the stored one');
  assert.match(text(h(MyBookingsCard, { ...props, tab: 'past', rated: { b3: { error: 'stars must be integer 1..5' } } })), /stars must be integer 1\.\.5/);
  for (const tab of ['upcoming', 'past']) assert.doesNotMatch(html(h(MyBookingsCard, { ...props, tab })), /PRIVATE NOTE/);

  assert.match(html(h(MyBookingsCard, { status: 'loading' })), /animate-pulse/);
  assert.match(text(h(MyBookingsCard, { status: 'unreadable', onRetry: () => {} })), /Your bookings could not be read\. This is not a sign that you have none\./);
  assert.match(text(h(MyBookingsCard, { status: 'ready', bookings: [], now: NOW })), /No upcoming bookings\./);
  assert.match(text(h(MyBookingsCard, { status: 'ready', bookings: [], now: NOW, tab: 'past' })), /No past bookings\./);
});

// ── Resources ─────────────────────────────────────────────────────────────────

const RESOURCES = [
  { id: 1, uid: 'r1', category: 'hotline', name: '988 Suicide & Crisis Lifeline (US)', url: 'https://988lifeline.org', region: 'us', is_24_7: true, is_free: true, sort_order: 1, created_at: '2026-09-01 10:00:00' },
  { id: 2, uid: 'r2', category: 'reading', name: 'A stored bad link', url: 'javascript:alert(1)', region: null, is_24_7: false, is_free: false, sort_order: 40, created_at: '2026-09-03 10:00:00' },
  { id: 3, uid: 'r3', category: 'therapy', name: 'Open Path Collective', url: 'https://openpathcollective.org', region: 'us', is_24_7: false, is_free: false, sort_order: 21, created_at: '2026-09-02 10:00:00' },
  { id: 4, uid: 'r4', category: 'coaching', name: 'The Founder Coach Directory', url: null, region: 'global', is_24_7: false, is_free: false, sort_order: 30, created_at: '2026-09-04 10:00:00' },
];

test('resources: the library’s order, crisis lines first, and never a non-http link', () => {
  for (const ok of ['https://988lifeline.org', 'http://example.org/x']) assert.equal(M.safeHref(ok), ok);
  for (const bad of ['javascript:alert(1)', ' data:text/html,x', 'ftp://x.org', '/relative', '', null, 'https://a b']) assert.equal(M.safeHref(bad), null, String(bad));
  const shut = html(h(ResourcesCard, { status: 'ready', resources: RESOURCES }));
  const t = text(h(ResourcesCard, { status: 'ready', resources: RESOURCES }));
  assert.match(t, /Resources for you 4 in the library/);
  assert.match(t, /Crisis line 988 Suicide & Crisis Lifeline \(US\) 24\/7 · Free · US/);
  assert.match(t, /Show all 4/);
  assert.doesNotMatch(t, /Founder Coach Directory/, 'three shown until expanded');
  assert.match(text(h(ResourcesCard, { status: 'ready', resources: RESOURCES, expanded: true })), /Founder Coach Directory.*Show fewer/);
  assert.doesNotMatch(html(h(ResourcesCard, { status: 'ready', resources: RESOURCES, expanded: true })), /href="javascript/i);
  assert.match(shut, /href="https:\/\/988lifeline\.org"/);
  assert.match(t, /Nothing here is chosen from your check-ins/);
  assert.doesNotMatch(shut, /admin\/wellbeing\/resources/);
  assert.match(html(h(ResourcesCard, { status: 'ready', resources: RESOURCES, isAdmin: true })), /href="\/admin\/wellbeing\/resources"/);
  assert.match(html(h(ResourcesCard, { status: 'loading' })), /animate-pulse/);
  assert.match(text(h(ResourcesCard, { status: 'unreadable', onRetry: () => {} })), /The resource library could not be read\. This is not a sign that it is empty\./);
  assert.match(text(h(ResourcesCard, { status: 'ready', resources: [] })), /No resources yet\./);
});

// ── Book an expert ────────────────────────────────────────────────────────────

const EXPERTS = [
  { uid: 'e1', name: 'Dr Ada', headline: 'Sleep and stress', categories: ['sleep_specialist_physician', 'executive_coach', 'mindfulness_coach', 'leadership_coach'], pricing_model: 'paid', hourly_rate_usd: 150, first_session_free: true, rating_avg: 4.56, rating_count: 9, services: null },
  { uid: 'e2', name: 'Sam Coach', headline: null, categories: ['unknown_key'], pricing_model: 'free', hourly_rate_usd: null, rating_avg: 0, rating_count: 0, services: null },
  { uid: 'e3', name: 'Lee', headline: '', categories: [], pricing_model: 'paid', hourly_rate_usd: 0, rating_avg: 5, rating_count: 1, services: null },
];
const LABELS = new Map([['sleep_specialist_physician', 'Sleep specialist'], ['executive_coach', 'Executive coach'], ['mindfulness_coach', 'Mindfulness coach']]);
const SLOTS = {
  e1: { status: 'ready', external: false, launch_url: null, slots: ['2026-10-08T10:00:00.000Z', '2026-10-07T09:00:00.000Z', '2026-10-07T09:30:00.000Z'] },
  e2: { status: 'ready', external: true, launch_url: 'https://cal.example/sam', slots: [] },
  e3: { status: 'unreadable' },
};

test('the booking body: the slot, the route’s 30-minute length and the chosen service, never a note (D574)', () => {
  assert.deepEqual(M.bookingPayload({ slot: '2026-10-08T10:00:00.000Z' }), { scheduled_at: '2026-10-08T10:00:00.000Z', duration_minutes: 30 });
  assert.deepEqual(M.bookingPayload({ slot: '2026-10-08T10:00:00.000Z', serviceUid: 's2' }),
    { scheduled_at: '2026-10-08T10:00:00.000Z', duration_minutes: 30, service_uid: 's2' });
  assert.deepEqual(M.bookingPayload({ external: true }), {});
  assert.deepEqual(M.bookingPayload({ external: true, serviceUid: 's2' }), { service_uid: 's2' });
  assert.match(read('cloudflare-worker/src/services/wellbeing/slots.ts'), /export const SLOT_MINUTES = 30;/, 'slots are 30 minutes, so a booking asks for 30');
  assert.equal(M.SESSION_MINUTES, 30);
  const book = handler("wellbeing.post('/experts/:uid/book'");
  assert.match(book, /body as any\)\?\.notes/, 'the route would store a note if one were sent, which is why none is');
  assert.match(book, /scheduled_at is required when the expert has no external scheduler/);
  assert.match(book, /That slot was just taken/);
  // D574: both member reads return the expert's active services, and the
  // slots are cut from the expert's weekly grid.
  assert.match(handler("wellbeing.get('/experts/:uid'"), /services: services\.get\(expert\.id\) \?\? \[\]/);
  assert.match(handler("wellbeing.get('/experts'"), /services: services\.get\(s\.expert\.id\) \?\? \[\]/);
  assert.match(handler("wellbeing.get('/experts/:uid/slots'"), /offeredSlots\(await loadAvailability\(c\.env, expert\.id\)\)/);
  assert.match(book, /slot_not_offered/);
});

test('slots group by the viewer’s own day, and each card says when the expert is next open', () => {
  const ny = M.groupSlots(['2026-10-07T02:00:00.000Z', '2026-10-07T14:00:00.000Z'], { timeZone: 'America/New_York' });
  assert.deepEqual(ny.map((g) => [g.label, g.slots.map((s) => s.time)]), [['Tue 6 Oct', ['22:00']], ['Wed 7 Oct', ['10:00']]]);
  assert.deepEqual(M.groupSlots(SLOTS.e1.slots, UTC).map((g) => g.label), ['Wed 7 Oct', 'Thu 8 Oct'], 'days in order');
  assert.equal(M.nextOpening(SLOTS.e1, UTC).text, 'Next: Wed 7 Oct · 09:00');
  assert.equal(M.nextOpening(SLOTS.e2, UTC).text, 'Books through their own scheduler');
  assert.equal(M.nextOpening(SLOTS.e3, UTC).kind, 'unreadable');
  assert.equal(M.nextOpening({ status: 'ready', slots: [] }, UTC).text, 'No open slot in the next few days');
  assert.equal(M.nextOpening(undefined).kind, 'loading');
  assert.equal(M.expertRate(EXPERTS[0]), '$150 / hr');
  assert.equal(M.expertRate(EXPERTS[1]), 'Free');
  assert.equal(M.expertRate(EXPERTS[2]), null, 'a rate of 0 on a paid expert is not a published rate');
  assert.deepEqual(M.wantedCategories([{ tags: ['a', 'b'] }, { tags: ['b'] }, { tags: null }]), ['b', 'a']);
});

test('step 1 · expert: cards with specialties, rate, ratings and next opening, in each state', () => {
  const props = { status: 'ready', experts: EXPERTS, labels: LABELS, slots: SLOTS, selected: 'e1', timeZone: 'UTC', onSelect: () => {} };
  const t = text(h(ExpertColumn, props));
  const markup = html(h(ExpertColumn, props));
  assert.match(t, /Dr Ada Sleep and stress Sleep specialist Executive coach Mindfulness coach \$150 \/ hr First session free 4\.6 · 9 ratings Next: Wed 7 Oct · 09:00/);
  assert.doesNotMatch(t, /Leadership/, 'three specialties at most');
  assert.match(t, /Sam Coach Unknown Key Free No ratings yet Books through their own scheduler/);
  assert.match(t, /Lee Rate not recorded 5\.0 · 1 rating Openings could not be read/);
  assert.match(markup, /data-testid="expert-e1"[^>]*aria-pressed="true"/);
  assert.match(markup, /data-testid="expert-e2"[^>]*aria-pressed="false"/);
  assert.match(text(h(ExpertColumn, { ...props, missingSelected: true })), /The expert you came for is not in this list/);
  const closed = { e1: { status: 'ready', slots: [] }, e2: { status: 'ready', slots: [] }, e3: { status: 'ready', slots: [] } };
  assert.match(text(h(ExpertColumn, { ...props, slots: closed })), /No expert has an open slot in the next few days\./);
  assert.match(html(h(ExpertColumn, { status: 'loading' })), /animate-pulse/);
  assert.match(text(h(ExpertColumn, { status: 'unreadable', onRetry: () => {} })), /The expert directory could not be read\. This is not a sign that no expert is listed\./);
  assert.match(text(h(ExpertColumn, { status: 'ready', experts: [] })), /No expert matches these filters\./);
  assert.match(text(h(DirectoryToolbar, { filters: { q: '', category: '', language: '', modality: '', price_max: '' }, count: '1–3 of 7' })), /1–3 of 7 · Sort: best match/);
});

test('steps 2 to 4: the expert’s services to pick, a slot in the viewer’s time, and a confirmation that sends no note', () => {
  const service = text(h(ServiceColumn, { expert: EXPERTS[0] }));
  assert.match(service, /Services not read This expert’s services could not be read/, 'null is "not read", never "none"');
  assert.match(service, /A 30-minute session Dr Ada’s published rate: \$150 \/ hr/);
  assert.equal(SERVICE_GAP.includes('30-minute'), true);
  assert.match(text(h(ServiceColumn, { expert: { ...EXPERTS[0], services: [] } })), /Dr Ada lists no services\. A 30-minute session/);
  const SERVICES = [
    { uid: 's1', title: 'Intro call', duration_minutes: 25, price_cents: 0, currency: 'usd' },
    { uid: 's2', title: 'Deep session', duration_minutes: 50, price_cents: 9050, currency: 'eur' },
  ];
  const withServices = { ...EXPERTS[0], services: SERVICES };
  assert.match(text(h(ServiceColumn, { expert: withServices })), /Intro call 25 min · Free Deep session 50 min · EUR 90\.50 A 30-minute session/);
  assert.match(html(h(ServiceColumn, { expert: withServices, serviceUid: 's2' })), /aria-pressed="true"[^>]*data-testid="service-s2"/);
  assert.match(html(h(ServiceColumn, { expert: withServices })), /aria-pressed="true"[^>]*data-testid="service-plain"/, 'no service chosen is the plain session');
  assert.match(text(h(ConfirmColumn, { expert: withServices, slotState: SLOTS.e1, chosen: '2026-10-08T10:00:00.000Z', serviceUid: 's2', timeZone: 'UTC' })),
    /Service Deep session · 50 min When/);
  assert.match(text(h(ServiceColumn, { expert: null })), /Choose an expert first\./);

  const chosen = '2026-10-08T10:00:00.000Z';
  const time = html(h(TimeColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC', onChoose: () => {} }));
  assert.match(text(h(TimeColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC' })), /3 · Time Times in UTC Wed 7 Oct 09:00 09:30 Thu 8 Oct 10:00/);
  assert.match(time, /aria-pressed="true"[^>]*data-testid="slot-2026-10-08T10:00:00\.000Z"/);
  assert.match(text(h(TimeColumn, { expert: EXPERTS[1], slotState: SLOTS.e2, timeZone: 'UTC' })), /Sam Coach books through their own scheduler\. Confirming records the booking here and opens it/);
  assert.match(text(h(TimeColumn, { expert: EXPERTS[2], slotState: SLOTS.e3, timeZone: 'UTC', onRetry: () => {} })), /Availability could not be read\. This is not a sign that the expert is fully booked\./);
  assert.match(text(h(TimeColumn, { expert: EXPERTS[0], slotState: { status: 'ready', slots: [] }, timeZone: 'UTC' })), /No open slot in the next few days\. Try another expert\./);
  // D574: the default hours are said as such, never as the expert's own.
  assert.match(text(h(TimeColumn, { expert: EXPERTS[0], slotState: { ...SLOTS.e1, source: 'default_hours' }, timeZone: 'UTC' })),
    /Dr Ada has not set weekly hours, so these are the default ones: weekdays, 09:00 to 17:00 UTC\./);
  assert.doesNotMatch(text(h(TimeColumn, { expert: EXPERTS[0], slotState: { ...SLOTS.e1, source: 'grid' }, timeZone: 'UTC' })), /default ones/);

  const confirm = text(h(ConfirmColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC' }));
  assert.match(confirm, /Expert Dr Ada Service A 30-minute session When Thu 8 Oct · 10:00 Rate \$150 \/ hr/);
  assert.match(confirm, /No note is stored with the booking, and no payment is taken when you confirm\./);
  assert.doesNotMatch(html(h(ConfirmColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC' })), /data-testid="button-confirm-booking"[^>]*disabled/);
  assert.match(html(h(ConfirmColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen: null, timeZone: 'UTC' })), /disabled=""[^>]*data-testid="button-confirm-booking"/);
  assert.match(text(h(ConfirmColumn, { expert: EXPERTS[1], slotState: SLOTS.e2, timeZone: 'UTC' })), /When Chosen in their scheduler .*Confirm and open their scheduler/);
  assert.match(text(h(ConfirmColumn, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, booking: { error: 'That slot was just taken — please pick another.' } })),
    /That slot was just taken — please pick another\./);
  const done = text(h(ConfirmColumn, {
    expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC',
    booking: { result: { booking_uid: 'bk', scheduled_at: chosen, status: 'scheduled', message: 'Confirmed for Thu, 08 Oct 2026 10:00:00 GMT. Both of you have been emailed.' } },
  }));
  assert.match(done, /Confirmed for Thu, 08 Oct 2026 10:00:00 GMT\. Both of you have been emailed\. In your time: Thu 8 Oct · 10:00 Back to Wellbeing Book another/);

  const all = [ServiceColumn, TimeColumn, ConfirmColumn].map((C) => html(h(C, { expert: EXPERTS[0], slotState: SLOTS.e1, chosen, timeZone: 'UTC' }))).join('');
  assert.doesNotMatch(all, /<textarea/, 'there is nowhere to write a note to the expert');
});

// ── The expert's public profile ──────────────────────────────────────────────

/** The first element in a rendered tree that `pred` accepts. */
const findEl = (el, pred) => {
  if (!el || typeof el !== 'object') return null;
  if (Array.isArray(el)) {
    for (const c of el) { const f = findEl(c, pred); if (f) return f; }
    return null;
  }
  return pred(el) ? el : findEl(el.props?.children, pred);
};
const PROFILE = { ...EXPERTS[0], user_id: 41, profile_completion_pct: 85, hidden: false, calendly_url: null, booking_url: null };
const FOUNDER = { id: 7, role: 'founder' };
const bookLink = (expert, viewer) => findEl(BookingCard({ expert, viewer }), (el) => el.props?.['data-testid'] === 'link-book-expert');

test('the expert profile books nothing itself: no note, no booking request, no payment', () => {
  const src = codeOnly(read('frontend/src/pages/ExpertProfilePage.jsx'));
  assert.doesNotMatch(src, /<textarea|booker_note|notes:/, 'nowhere to write a note, and none sent (D331)');
  assert.doesNotMatch(src, /wellbeingExpertBook|client_secret|AxalCheckout/, 'no booking request and no payment of its own');
  assert.match(src, /<BookingCard expert=\{expert\} viewer=\{readViewer\(\)\} \/>/);
});

test('the profile’s card hands the expert to the booking flow, which opens with them chosen', () => {
  const link = bookLink(PROFILE, FOUNDER);
  assert.equal(link.props.to, '/wellbeing/book?expert=e1');
  assert.equal(link.props.state.expert, PROFILE, 'the card the profile read travels with the link');
  assert.match(text(h(BookingCard, { expert: PROFILE, viewer: FOUNDER })),
    /Book a session Choose one of Dr Ada’s open times in the booking flow\. A booking is visible to you and the expert alone, and carries no note\. Choose a time/);

  // Where the link lands. The directory is still loading, so the expert can
  // only have come from the link's state.
  const land = (entry) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, h(WellbeingBookPage)))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const at = new URL(link.props.to, 'https://axal.vc');
  const landed = land({ pathname: at.pathname, search: at.search, state: link.props.state });
  assert.match(landed, /4 · Confirm Expert Dr Ada Service A 30-minute session When Choose a time Rate \$150 \/ hr/);
  assert.match(land({ pathname: at.pathname, search: at.search }), /4 · Confirm Choose an expert and a time\./, 'no state: nothing to show before the directory loads');
  assert.match(land({ pathname: at.pathname, search: '?expert=e2', state: link.props.state }), /4 · Confirm Choose an expert and a time\./,
    'state naming someone the address does not: ignored');
});

test('the profile’s card offers the flow only to the roles its route admits, and says why to the rest', () => {
  const app = read('frontend/src/App.jsx');
  const guarded = /<Route path="\/wellbeing\/book" element=\{guard\((\[[^\]]*\])/.exec(app)?.[1];
  assert.deepEqual(JSON.parse(String(guarded).replace(/'/g, '"')), BOOKING_ROLES, 'the card and the route guard agree');
  assert.ok(bookLink(PROFILE, { id: 1, role: 'admin' }), 'an admin');
  for (const role of ['partner', 'advisor', 'investor', '']) {
    assert.equal(bookLink(PROFILE, { id: 7, role }), null, `${role || 'no role'}: the flow’s guard would turn them away`);
    assert.match(text(h(BookingCard, { expert: PROFILE, viewer: { id: 7, role } })), /Booking a wellbeing expert is open to founders\./);
  }
  assert.deepEqual(viewerOf({ id: 3, role: 'Admin' }, 'founder'), { id: 3, role: 'founder' }, 'an admin viewing as a founder sees what a founder sees');
  assert.deepEqual(viewerOf({ id: 3, role: 'admin' }, null), { id: 3, role: 'admin' });
  assert.deepEqual(viewerOf({ id: 9, role: 'partner' }, 'founder'), { id: 9, role: 'partner' }, 'only an admin views as another role');
  assert.deepEqual(viewerOf(null, null), { id: null, role: '' });
});

test('the profile’s card is closed where the route would refuse, and the expert is shown their own', () => {
  const incomplete = text(h(BookingCard, { expert: { ...PROFILE, profile_completion_pct: 60 }, viewer: FOUNDER }));
  assert.match(incomplete, /This expert hasn’t completed their profile yet, so bookings are not open\./);
  assert.equal(bookLink({ ...PROFILE, profile_completion_pct: 60 }, FOUNDER), null);
  assert.match(text(h(BookingCard, { expert: { ...PROFILE, hidden: true }, viewer: FOUNDER })), /This expert is not taking bookings at the moment\./);
  assert.equal(bookLink({ ...PROFILE, hidden: true }, FOUNDER), null);

  const own = { id: '41', role: 'founder' };
  assert.match(text(h(BookingCard, { expert: PROFILE, viewer: own })),
    /This is the profile members see\. They book you from the booking flow, and the bookings arrive in your practice ?\./);
  assert.match(html(h(BookingCard, { expert: PROFILE, viewer: own })), /href="\/wellbeing\/practice"/);
  assert.equal(bookLink(PROFILE, own), null, 'no booking yourself');
  assert.ok(bookLink({ ...PROFILE, user_id: null }, FOUNDER), 'an expert with no account is booked like any other');
});

test('the profile’s services tab: the list to read, "not read" for null, never "none listed" (D574)', () => {
  const gap = text(h(ServicesPanel, { services: null }));
  assert.match(gap, /Services not read This expert’s services could not be read/);
  assert.doesNotMatch(gap, /No specific services|lists no services/);
  assert.match(text(h(ServicesPanel, { services: [] })), /This expert lists no services\./);
  const services = [
    { uid: 's1', title: 'Intro call', duration_minutes: 25, price_cents: 0, currency: 'usd' },
    { uid: 's2', title: 'Deep session', description: 'Fifty minutes', duration_minutes: 50, price_cents: 9000, currency: 'eur' },
  ];
  assert.match(text(h(ServicesPanel, { services })), /Intro call 25 min Free Deep session Fifty minutes 50 min .*90/);
  assert.doesNotMatch(html(h(ServicesPanel, { services })), /<input/, 'picked in the booking flow, not here');
});

test('the booking flow lists the expert a profile sent first, even outside the directory’s twelve', () => {
  const far = { ...EXPERTS[0], uid: 'e9', name: 'Dr Far' };
  assert.equal(M.arrivedExpert({ expert: far }, 'e9'), far);
  assert.equal(M.arrivedExpert({ expert: far }, 'e1'), null, 'the address names someone else: a stale entry chooses no one');
  assert.equal(M.arrivedExpert(null, 'e9'), null);
  assert.equal(M.arrivedExpert({ expert: far }, null), null);
  assert.deepEqual(M.withArrived(EXPERTS, far).map((e) => e.uid), ['e9', 'e1', 'e2', 'e3']);
  assert.deepEqual(M.withArrived(EXPERTS, EXPERTS[1]).map((e) => e.uid), ['e1', 'e2', 'e3'], 'listed already: kept in its ranked place, once');
  assert.equal(M.withArrived(EXPERTS, null), EXPERTS);

  // The column and the slot reads take the joined list; the arrived expert's
  // times do not wait for the directory.
  const page = codeOnly(read('frontend/src/pages/wellbeing/WellbeingBookPage.jsx'));
  assert.match(page, /<ExpertColumn\s+status=\{list\.status\}\s+experts=\{experts\}/);
  assert.match(page, /useEffect\(\(\) => \{ if \(arrived\) loadSlots\(arrived\.uid\); \}, \[arrived, loadSlots\]\);/);

  const missing = html(h(ExpertColumn, { status: 'ready', experts: EXPERTS, labels: LABELS, slots: SLOTS, selected: 'e9', missingSelected: true, timeZone: 'UTC' }));
  assert.match(missing, /The expert you came for is not in this list\. Clear the filters, choose another, or/);
  assert.match(missing, /href="\/wellbeing\/expert\/e9"[^>]*>book them from their profile</, 'a way back that carries them');
});

// ── The expert's practice ─────────────────────────────────────────────────────

test('services: name, length, rate and an active switch, edited and deleted only after a confirmation', () => {
  const free = { uid: 's1', title: 'Intro call', duration_minutes: 25, price_cents: 0, currency: 'usd', is_active: 1 };
  const paid = { uid: 's2', title: 'Deep session', duration_minutes: 50, price_cents: 9000, currency: 'eur', is_active: 0 };
  assert.match(text(h('ul', null, h(ServiceRow, { service: free }))), /Intro call 25 min Free Active Edit/);
  assert.match(text(h('ul', null, h(ServiceRow, { service: paid }))), /Deep session 50 min €90 Inactive Edit/);
  assert.match(html(h('ul', null, h(ServiceRow, { service: free }))), /role="switch" aria-checked="true"/);
  assert.match(html(h('ul', null, h(ServiceRow, { service: paid }))), /role="switch" aria-checked="false"/);
  assert.doesNotMatch(html(h('ul', null, h(ServiceRow, { service: free }))), /confirm-delete/);
  assert.match(text(h('ul', null, h(ServiceRow, { service: free, confirming: true }))), /Delete “Intro call”\? This cannot be undone\. Delete service Keep/);

  assert.deepEqual(M.serviceBody({ title: ' Deep session ', minutes: '50', price: '90.5', currency: 'EUR', description: '' }), {
    ok: true, body: { title: 'Deep session', duration_minutes: 50, price_cents: 9050, currency: 'eur', description: null },
  });
  assert.deepEqual(Object.keys(M.serviceBody({ title: '', minutes: '4', price: '' }).fields).sort(), ['minutes', 'price', 'title']);
  assert.equal(M.serviceBody({ title: 'x', minutes: '30', price: '0' }).body.price_cents, 0, 'zero is the route’s free session');
  assert.deepEqual(M.serviceDraft(paid), { title: 'Deep session', minutes: '50', price: '90', currency: 'eur', description: '' });

  const form = text(h(ServiceForm, { draft: M.serviceDraft(null), mode: 'create', fields: { title: 'A service needs a name.' }, error: 'title required' }));
  assert.match(form, /A service needs a name\./);
  assert.match(form, /A rate of zero is a free session\./);
  assert.match(form, /Add service Cancel title required/);

  const card = text(h(ServicesCard, { status: 'ready', services: [free, paid] }));
  assert.match(card, /Services 2 listed/);
  assert.match(card, /Members see your active services when they book, or can book a plain 30-minute session\./, 'D574: the list reaches members');
  assert.doesNotMatch(card, /do not see these services/);
  assert.match(text(h(ServicesCard, { status: 'ready', services: [] })), /No services yet\./);
  assert.match(text(h(ServicesCard, { status: 'unreadable', onRetry: () => {} })), /Your services could not be read\. This is not a sign that you have none\./);
  assert.match(html(h(ServicesCard, { status: 'ready', services: [], creating: true })), /data-testid="form-service-create"/);
});

const WINDOWS = [
  { uid: 'w1', day_of_week: 2, start_minute: 540, end_minute: 720, timezone: 'UTC' },
  { uid: 'w2', day_of_week: 1, start_minute: 840, end_minute: 900, timezone: 'UTC' },
  { uid: 'w3', day_of_week: 4, start_minute: 600, end_minute: 660, timezone: 'Europe/Paris' },
  { uid: 'w4', day_of_week: 6, start_minute: 1200, end_minute: 1260, timezone: 'UTC' },
  { uid: 'w5', day_of_week: 4, start_minute: 780, end_minute: 960, timezone: 'UTC' },
];
const EXPERT_BOOKINGS = [
  { uid: 'p1', status: 'scheduled', payment_status: 'free', scheduled_at: '2026-10-13T10:00:00.000Z', duration_minutes: 30, booker_name: 'Mina Founder', booker_note: 'PRIVATE NOTE', meet_link: 'https://meet.jit.si/axal-p1', service_title: 'Intro call' },
  { uid: 'p2', status: 'confirmed', scheduled_at: '2026-10-01T10:00:00.000Z', duration_minutes: 30, booker_name: 'Old Booker', booker_note: 'PRIVATE NOTE' },
  { uid: 'p3', status: 'requested', scheduled_at: null, duration_minutes: 30, booker_name: null, booker_note: 'PRIVATE NOTE' },
  { uid: 'p4', status: 'cancelled', scheduled_at: '2026-10-10T10:00:00.000Z', duration_minutes: 30, booker_name: 'Gone Away' },
];

test('the weekly grid: open, booked and closed from the stored windows, widened for a window outside it', () => {
  const grid = M.availabilityGrid({ windows: WINDOWS, bookings: EXPERT_BOOKINGS, timeZone: 'UTC', now: NOW });
  assert.deepEqual(grid.days, [1, 2, 3, 4, 5, 6], 'Monday first; Saturday added for its window');
  assert.deepEqual([grid.hours[0], grid.hours.at(-1)], [8, 20]);
  const at = (d, hr) => grid.cells[`${d}:${hr}`];
  assert.deepEqual([at(2, 9), at(2, 10), at(2, 11), at(2, 12)], ['open', 'booked', 'open', 'closed']);
  assert.equal(at(1, 14), 'open');
  assert.equal(at(4, 10), 'closed', 'a window in another zone is not guessed onto this grid');
  assert.equal(at(6, 10), 'closed', 'a cancelled booking does not hold an hour');
  assert.equal(at(6, 20), 'open');
  assert.deepEqual(grid.other.map((w) => w.uid), ['w3']);
  assert.equal(M.gridTimeZone(WINDOWS, 'Asia/Tokyo'), 'Asia/Tokyo', 'mixed zones: the viewer’s');
  assert.equal(M.gridTimeZone([WINDOWS[0]], 'Asia/Tokyo'), 'UTC');
  assert.equal(M.availabilityGrid({ windows: [], timeZone: 'UTC', now: NOW }).cells['1:8'], 'closed');

  const act = (d, hr) => M.cellAction({ windows: WINDOWS, cells: grid.cells, day: d, hour: hr, timeZone: 'UTC' });
  assert.deepEqual(act(3, 10), { kind: 'open', body: { day_of_week: 3, start_minute: 600, end_minute: 660, timezone: 'UTC' } });
  assert.deepEqual(act(1, 14), { kind: 'close', uid: 'w2' });
  assert.equal(act(2, 10).kind, 'blocked', 'a booked cell cannot be closed');
  assert.equal(act(2, 9).kind, 'blocked', 'nor can the window holding it');
  assert.deepEqual(act(4, 14), { kind: 'remove', windows: [WINDOWS[4]] }, 'one hour of a longer window asks to remove the window');

  // A booked hour that IS a one-hour window: only the booked rule keeps it
  // open, since the window would otherwise simply close.
  const exact = [...WINDOWS, { uid: 'w6', day_of_week: 5, start_minute: 900, end_minute: 960, timezone: 'UTC' }];
  const held = [...EXPERT_BOOKINGS, { uid: 'p5', status: 'confirmed', scheduled_at: '2026-10-09T15:00:00.000Z', duration_minutes: 30, booker_name: 'Fri Booker' }];
  const exactGrid = M.availabilityGrid({ windows: exact, bookings: held, timeZone: 'UTC', now: NOW });
  assert.equal(exactGrid.cells['5:15'], 'booked');
  assert.deepEqual(M.cellAction({ windows: exact, cells: exactGrid.cells, day: 5, hour: 15, timeZone: 'UTC' }),
    { kind: 'blocked', reason: 'A member has booked this hour, so it stays open.' });
  assert.deepEqual(M.cellAction({ windows: exact, cells: grid.cells, day: 5, hour: 15, timeZone: 'UTC' }), { kind: 'close', uid: 'w6' }, 'unbooked, the same hour closes');
});

test('the availability card and grid: cells say what they are, and the expert is told members book from them (D574)', () => {
  const grid = M.availabilityGrid({ windows: WINDOWS, bookings: EXPERT_BOOKINGS, timeZone: 'UTC', now: NOW });
  const markup = html(h(AvailabilityGrid, { grid }));
  assert.match(markup, /disabled=""[^>]*aria-label="Tuesday 10:00, booked"[^>]*data-state="booked"/);
  assert.match(markup, /aria-label="Tuesday 09:00, open — close this hour"/);
  assert.match(markup, /aria-label="Wednesday 10:00, closed — open this hour"/);
  const card = text(h(AvailabilityCard, { status: 'ready', windows: WINDOWS, bookings: EXPERT_BOOKINGS, timeZone: 'UTC', now: NOW }));
  assert.match(card, /Weekly availability Open Booked Closed/);
  assert.match(card, /Times in UTC\. Click a cell to open or close it\. Booked cells cannot be closed\./);
  assert.match(card, /Set in another time zone, not drawn above: Thu 10:00–11:00 \(Europe\/Paris\) Remove/);
  assert.match(card, /Members are offered half-hours inside these windows, read in each window’s own timezone\. With no window set, they are offered weekdays 09:00 to 17:00 UTC\./);
  assert.doesNotMatch(card, /not offered these hours/);
  assert.match(html(h(AvailabilityCard, { status: 'loading' })), /animate-pulse/);
  assert.match(text(h(AvailabilityCard, { status: 'unreadable', onRetry: () => {} })), /Your weekly availability could not be read\. This is not a sign that every hour is closed\./);
});

test('upcoming bookings: names and times only, never the note the route returns', () => {
  assert.match(handler("wellbeing.get('/experts/me/bookings'"), /b\.booker_note/, 'the note IS in the response — the page drops it');
  const t = text(h(PracticeBookingsCard, { status: 'ready', bookings: EXPERT_BOOKINGS, now: NOW, timeZone: 'UTC' }));
  const markup = html(h(PracticeBookingsCard, { status: 'ready', bookings: EXPERT_BOOKINGS, now: NOW, timeZone: 'UTC' }));
  assert.match(t, /Upcoming bookings 2/);
  assert.match(t, /Mina Founder Intro call Tue 13 Oct · 10:00 30 min Scheduled Confirm Cancel/);
  assert.match(t, /Name not recorded No service chosen Time not recorded 30 min Requested Confirm Cancel/);
  assert.match(t, /Earlier bookings · 2/);
  assert.match(t, /Old Booker .* Confirmed Cancel Mark completed/);
  assert.match(t, /Gone Away .* Cancelled/);
  assert.match(t, /Names and times only\. This list never shows a booking’s note\./);
  assert.doesNotMatch(markup, /PRIVATE NOTE/);
  assert.doesNotMatch(markup, /meet\.jit\.si/, 'a meeting link is not a name or a time');
  assert.deepEqual(EXPERT_BOOKINGS.map((b) => M.expertActions(b, NOW)), [
    ['confirmed', 'cancelled'], ['cancelled', 'completed'], ['confirmed', 'cancelled'], [],
  ]);
  const asking = text(h('ul', null, h(PracticeBookingRow, { booking: EXPERT_BOOKINGS[0], now: NOW, timeZone: 'UTC', confirmingCancel: true })));
  assert.match(asking, /Cancel this booking\? The member is told, and it cannot be undone\. Cancel booking Keep/);
  assert.match(text(h(PracticeBookingsCard, { status: 'ready', bookings: [], now: NOW })), /No upcoming bookings\./);
  assert.match(text(h(PracticeBookingsCard, { status: 'unreadable', onRetry: () => {} })), /Your bookings could not be read\. This is not a sign that you have none\./);
  assert.match(text(h(PracticeBookingsCard, { status: 'ready', bookings: EXPERT_BOOKINGS, now: NOW, error: 'invalid status' })), /invalid status/);
});

test('the profile keeps to the route’s own lists, and an empty hourly rate is left out rather than sent as zero', () => {
  assert.deepEqual(M.EXPERT_MODALITIES.map(([k]) => k), [...VALID_MODALITIES]);
  assert.deepEqual(M.EXPERT_PRICING_MODELS.map(([k]) => k), [...VALID_PRICING_MODELS]);
  assert.match(handler("wellbeing.put('/experts/me'"), /sanitiseExpertInput\(body\)/);
  assert.match(ROUTE, /if \(Number\.isFinite\(Number\(body\.hourly_rate_usd\)\)\)/, 'Number(null) is 0 and finite, so a null would store 0');
  const draft = M.profileDraft({ name: 'Ada', hourly_rate_usd: 0, modalities: ['video', 'chat'], pricing_model: 'insurance' });
  assert.equal(draft.hourly_rate_usd, '', 'a stored 0 reads as no rate');
  const body = M.profileBody(draft);
  assert.equal(body.ok, true);
  assert.equal('hourly_rate_usd' in body.body, false);
  assert.deepEqual(body.body.modalities, ['video'], 'a value the route would drop is not sent');
  assert.equal(body.body.pricing_model, 'paid');
  assert.equal(M.profileBody({ ...draft, hourly_rate_usd: '150' }).body.hourly_rate_usd, 150);
  assert.deepEqual(M.profileBody({ ...draft, hourly_rate_usd: 'lots' }).fields, { hourly_rate_usd: 'The hourly rate is a number of dollars.' });
  assert.match(text(h(BecomeExpert, { error: 'You already have an expert profile.' })), /Create my expert profile You already have an expert profile\./);
});

// ── The admin resource library ────────────────────────────────────────────────

test('the library mirrors the route: its five categories, four kinds, its fields, and an admin gate on every write', () => {
  const allowed = /ALLOWED_RESOURCE_CATEGORIES = new Set\(\[([^\]]*)\]\)/.exec(ROUTE)?.[1];
  assert.ok(allowed);
  assert.deepEqual([...M.RESOURCE_CATEGORIES].sort(), [...allowed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort());
  assert.match(handler("wellbeing.post('/resources'"), /const a = await admin\(c\);[\s\S]*requireBranchNotSuspended\(c\)/);
  assert.match(handler("wellbeing.delete('/resources/:id'"), /const a = await admin\(c\);/);
  assert.match(handler("wellbeing.patch('/resources/:id'"), /const a = await admin\(c\);[\s\S]*requireBranchNotSuspended\(c\)/);
  const kinds = /RESOURCE_KINDS = \[([^\]]*)\]/.exec(ROUTE)?.[1];
  assert.deepEqual([...M.RESOURCE_FORMATS], [...kinds.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  assert.match(ROUTE, new RegExp(`RESOURCE_TOPIC_MAX = ${M.RESOURCE_TOPIC_MAX};`));
  const ok = M.resourceBody({ ...M.EMPTY_RESOURCE, name: ' Sleep, a primer ', category: 'reading', url: 'https://example.org/sleep', region: 'UK', is_free: true, kind: 'article', topic: ' Sleep ' });
  assert.deepEqual(ok, {
    ok: true,
    body: {
      category: 'reading', name: 'Sleep, a primer', description: null, url: 'https://example.org/sleep', region: 'uk',
      is_24_7: false, is_free: true, sort_order: 100, kind: 'article', topic: 'Sleep', status: 'published',
    },
  });
  assert.equal(M.resourceBody({ ...M.EMPTY_RESOURCE, name: 'x', category: 'reading' }, 'draft').body.status, 'draft');
  // Every field the page sends is one the route's checker reads.
  const checker = ROUTE.slice(ROUTE.indexOf('export function resourceFields'), ROUTE.indexOf('function serializeResource'));
  for (const key of Object.keys(ok.body)) assert.match(checker, new RegExp(`'${key}'`), `the route reads ${key}`);
  const bad = M.resourceBody({ ...M.EMPTY_RESOURCE, url: 'javascript:alert(1)', sort_order: '1.5', kind: 'podcast', topic: 't'.repeat(61) });
  assert.deepEqual(Object.keys(bad.fields).sort(), ['category', 'kind', 'name', 'sort_order', 'topic', 'url']);
  assert.deepEqual(M.draftOf({ id: 4, name: 'A', category: 'reading', kind: 'video', topic: 'Sleep', sort_order: 3, is_free: true }),
    { id: 4, name: 'A', category: 'reading', url: '', description: '', region: '', is_24_7: false, is_free: true, sort_order: '3', kind: 'video', topic: 'Sleep', file: null });
  // D574 part 4: the file's types and limit are the route's own.
  const SVC = read('cloudflare-worker/src/services/wellbeing/resourceFiles.ts');
  const types = /RESOURCE_FILE_TYPES[^=]*= \{([^}]*)\}/.exec(SVC)?.[1];
  assert.deepEqual(Object.keys(M.RESOURCE_FILE_TYPES).sort(), [...types.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort());
  assert.match(SVC, new RegExp(`RESOURCE_FILE_MAX_BYTES = ${M.RESOURCE_FILE_MAX_MB} \\* 1024 \\* 1024;`));
});

test('the library list: search, kind and sort over the route’s rows, counted "1–25 of N" and paged', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, category: i % 2 ? 'reading' : 'therapy', name: `Res ${String(i + 1).padStart(2, '0')}`, sort_order: 30 - i, created_at: `2026-09-${String(i + 1).padStart(2, '0')} 10:00:00` }));
  const first = M.pageOf(M.filterResources(many, {}), 1);
  assert.equal(M.countLabel(first), '1–25 of 30');
  assert.equal(first.rows[0].name, 'Res 30', 'members’ order is the stored sort order');
  assert.equal(M.countLabel(M.pageOf(M.filterResources(many, {}), 2)), '26–30 of 30');
  assert.equal(M.countLabel(M.pageOf(M.filterResources(many, {}), 9)), '26–30 of 30', 'a page past the end is the last page');
  assert.equal(M.countLabel(M.pageOf([], 1)), '0 of 0');
  assert.equal(M.filterResources(many, { category: 'reading' }).length, 15);
  assert.deepEqual(M.filterResources(many, { q: 'res 0' }).map((r) => r.name).sort().slice(0, 2), ['Res 01', 'Res 02']);
  assert.equal(M.filterResources(many, { sort: 'added' })[0].name, 'Res 30');
  assert.equal(M.filterResources(many, { sort: 'title' })[0].name, 'Res 01');
  assert.match(text(h(LibraryToolbar, { q: '', category: '', sort: 'order', count: '1–25 of 30' })), /Any kind Crisis line Therapy Peer group Coaching Reading .*Sort: Members’ order .*1–25 of 30/);
});

test('the library table and editor: kind, topic, state and date as stored, edit in place, and delete only after a confirmation (D574)', () => {
  const t = text(h(ResourceTable, { rows: RESOURCES }));
  const markup = html(h(ResourceTable, { rows: RESOURCES }));
  assert.match(t, /Kind Title Topic State Date/);
  // One row, two layouts: the stacked line for a narrow card, then the table's
  // cells for a wide one. The card's own width decides (a container query).
  // A row from before D574 has no kind and no topic: said, never guessed.
  assert.match(t, /Not recorded 988 Suicide & Crisis Lifeline \(US\) Crisis line · 24\/7 · Free · US Topic: none Published Added 1 Sep 2026 None Published Added 1 Sep 2026 Edit Delete/);
  const stored = text(h(ResourceTable, { rows: [{ ...RESOURCES[0], kind: 'article', topic: 'Crisis', status: 'draft', edited_at: '2026-10-02T09:00:00.000Z' }] }));
  assert.match(stored, /Article 988 Suicide & Crisis Lifeline \(US\) Crisis line · 24\/7 · Free · US Topic: Crisis Draft Edited 2 Oct 2026 Crisis Draft Edited 2 Oct 2026 Edit Delete/);
  assert.match(markup, /data-testid="button-edit-resource-1"/);
  assert.match(markup, /class="@container" data-testid="table-library"/);
  assert.match(markup, /@2xl:grid-cols-\[6rem_minmax\(0,2fr\)_minmax\(0,1fr\)_5\.5rem_6\.5rem_4\.5rem\]/);
  assert.match(t, /Members see published resources only\. A draft is listed here, to admins, until it is published\./);
  assert.deepEqual(M.libraryCoverage([...RESOURCES, { ...RESOURCES[1], id: 9, status: 'draft' }]).slice(0, 2), ['4 resources published', '1 draft not yet published']);
  assert.doesNotMatch(markup, /href="javascript/i);
  assert.doesNotMatch(markup, /confirm-delete-resource/);
  const asking = text(h(ResourceTable, { rows: RESOURCES, confirmingId: 1 }));
  assert.match(asking, /Delete “988 Suicide & Crisis Lifeline \(US\)”\? Members stop seeing it at once\. This cannot be undone\. Delete resource Keep/);

  const editor = text(h(ResourceEditor, { draft: M.EMPTY_RESOURCE }));
  assert.match(editor, /Title Category Choose a category Crisis line Therapy Peer group Coaching Reading Kind Not set Article Audio Video Link Topic \(optional\)/);
  assert.match(editor, /File \(optional\) Save the resource first, then attach a file to it\./, 'a file belongs to a saved row');
  assert.doesNotMatch(editor, /nothing can be uploaded/);
  const withFile = M.draftOf({ ...RESOURCES[0], file: { type: 'application/pdf', size: 1258291, url: '/api/wellbeing/resources/r1/file' } });
  assert.match(text(h(ResourceEditor, { draft: withFile })), /Attached: PDF · 1\.2 MB Remove .*Replace file A PDF, MP3, M4A, MP4 or WebM, at most 95 MB\./);
  assert.match(text(h(ResourceEditor, { draft: M.draftOf(RESOURCES[0]) })), /No file attached\. .*Upload file/);
  assert.match(html(h(ResourceEditor, { draft: M.draftOf(RESOURCES[0]) })), /disabled=""[^>]*data-testid="button-upload-file"/, 'nothing chosen, nothing to upload');
  assert.equal(M.fileProblem({ type: 'text/html', size: 10 }), 'A library file is a PDF, an MP3 or M4A, or an MP4 or WebM video.');
  assert.equal(M.fileProblem({ type: 'video/mp4', size: 96 * 1024 * 1024 }), 'A library file is at most 95 MB.');
  assert.equal(M.fileProblem({ type: 'audio/mpeg', size: 10 }), null);
  // A file is opened through the gated path only; a stored link still wins.
  assert.equal(M.resourceHref({ url: null, file: { url: '/api/wellbeing/resources/r1/file' } }), '/api/wellbeing/resources/r1/file');
  assert.equal(M.resourceHref({ url: 'https://x.test/a', file: { url: '/api/wellbeing/resources/r1/file' } }), 'https://x.test/a');
  assert.equal(M.resourceHref({ url: null, file: { url: 'https://evil.test/api/wellbeing/resources/r1/file' } }), null);
  assert.equal(M.resourceHref({ url: 'javascript:alert(1)', file: null }), null);
  assert.match(text(h(ResourceTable, { rows: [{ ...RESOURCES[3], file: { type: 'audio/mpeg', size: 2048, url: '/api/wellbeing/resources/r4/file' } }] })), /Coaching · GLOBAL · MP3 · 2 KB/);
  assert.match(html(h(ResourceTable, { rows: [{ ...RESOURCES[3], file: { type: 'audio/mpeg', size: 2048, url: '/api/wellbeing/resources/r4/file' } }] })), /href="\/api\/wellbeing\/resources\/r4\/file"/);
  assert.match(editor, /Publishing lists it to every member at once\. A draft is kept for admins until it is published\. Publish Save draft/);
  assert.doesNotMatch(editor, /Stop editing/, 'a new resource has nothing to stop editing');
  assert.match(text(h(ResourceEditor, { draft: M.draftOf({ ...RESOURCES[0], kind: 'link' }) })), /Stop editing/);
  assert.match(html(h(ResourceEditor, { draft: M.draftOf({ ...RESOURCES[0], kind: 'link' }) })), /<option value="link" selected="">Link<\/option>/);
  const refused = text(h(ResourceEditor, { draft: M.EMPTY_RESOURCE, fields: { name: 'A resource needs a title.' }, error: 'Admin required' }));
  assert.match(refused, /A resource needs a title\./);
  assert.match(refused, /Admin required/);
  assert.match(text(h(ResourceEditor, { draft: M.EMPTY_RESOURCE, ok: 'Published “Sleep, a primer”.' })), /Published “Sleep, a primer”\./);
});

// ── Rails, voice, routes, the client ─────────────────────────────────────────

test('the rails read counts only, and Eadwyn’s copy is plain and makes no clinical claim', () => {
  assert.deepEqual(M.homeCoverage(RESOURCES), ['4 resources in the library', '1 crisis line open 24/7']);
  assert.deepEqual(M.homeCoverage(null), []);
  assert.deepEqual(M.practiceCoverage({ services: [{ is_active: 1 }, { is_active: 0 }], windows: WINDOWS, upcoming: 2 }),
    ['2 services, 1 active', '5 weekly windows open', '2 upcoming bookings']);
  assert.deepEqual(M.libraryCoverage(RESOURCES), ['4 resources published', 'Crisis line: 1', 'Therapy: 1', 'Coaching: 1', 'Reading: 1']);
  const home = read('frontend/src/pages/WellbeingPage.jsx');
  assert.match(home, /coverage=\{homeCoverage\(resources\.status === 'ready' \? resources\.rows : null\)\}/, 'the home rail is fed the library and nothing else');

  const files = ['frontend/src/pages/WellbeingPage.jsx', 'frontend/src/pages/ExpertEditorPage.jsx', 'frontend/src/pages/wellbeing/WellbeingResourceLibrary.jsx'];
  for (const f of files) {
    const src = codeOnly(read(f));
    const tag = src.slice(src.indexOf('<WorkerRail'), src.indexOf('/>', src.indexOf('<WorkerRail')));
    assert.match(tag, /workspace="Wellbeing/);
    assert.match(tag, /role="(founder|advisor|admin)"/);
    assert.doesNotMatch(tag.replace(/role="advisor"/, ''), /advis|advice|recommend|fiduciar/i, `${f}: Eadwyn's copy`);
  }
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/wellbeing/WellbeingBookPage.jsx')), /<WorkerRail/, 'the canvas draws no rail on the booking page');
  const copy = ['frontend/src/pages/WellbeingPage.jsx', 'frontend/src/pages/ExpertEditorPage.jsx',
    'frontend/src/pages/wellbeing/WellbeingBookPage.jsx', 'frontend/src/pages/wellbeing/PracticeZones.jsx',
    'frontend/src/pages/wellbeing/WellbeingResourceLibrary.jsx', 'frontend/src/pages/wellbeing/wellbeingModel.js']
    .map((f) => codeOnly(read(f))).join('\n');
  assert.doesNotMatch(copy, /diagnos|symptom|disorder|\bcure|treatment|clinically|recommend/i, 'no clinical claim and no recommendation');
});

test('the admin pulse: the route’s rounded counts are shown as the ranges they stand for, never as counts', () => {
  // The route's rounding, read from the route: a multiple of five, floored,
  // on both counts and on both answers (a small cohort and a full one).
  assert.match(ROUTE, new RegExp(`const COUNT_BUCKET = ${M.COUNT_STEP};`));
  assert.match(ROUTE, /function bucket\(n: number, step = COUNT_BUCKET\): number \{\s*if \(n <= 0\) return 0;\s*return Math\.floor\(n \/ step\) \* step;/);
  const agg = handler("wellbeing.get('/aggregate'");
  assert.equal(agg.match(/cohort_size: bucket\(cohort\),\s*submissions: bucket\(rows\.length\),/g)?.length, 2);

  assert.equal(M.countRange(0), 'Fewer than 5', 'a cohort of one to four is sent as 0');
  assert.equal(M.countRange(5), '5–9');
  assert.equal(M.countRange(10), '10–14');
  assert.equal(M.countRange(12), '10–14', 'a count off the step is floored, so the range still holds it');
  assert.equal(M.countRange(1230), '1,230–1,234');
  for (const none of [null, undefined, '', 'many', -5, Number.NaN]) assert.equal(M.countRange(none), null, String(none));

  const t = text(h(PulseCounts, { data: { cohort_size: 0, submissions: 10, window_days: 30 } }));
  assert.match(t, /Founders Fewer than 5 Submissions 10–14 Window 30d/);
  assert.match(t, /Counts are rounded down to a multiple of five so no founder can be singled out, and are shown as the range they stand for\./);
  assert.doesNotMatch(t, /Founders 0 |Submissions 10 /, 'no bucket printed as a count');
  assert.match(text(h(PulseCounts, { data: { window_days: 90 } })), /Founders Not recorded Submissions Not recorded Window 90d/);

  const page = codeOnly(read('frontend/src/pages/WellbeingPage.jsx'));
  assert.match(page, /<PulseCounts data=\{data\} \/>/, 'the admin card shows the ranges');
  assert.doesNotMatch(page, /\{data\.(cohort_size|submissions)\}/, 'and prints neither count bare');
});

test('the four routes are registered with guards matching the API, the old dashboard redirects, and the library has a door', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/wellbeing" element=\{guard\(\['admin', 'founder'\], <WellbeingPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/wellbeing\/book" element=\{guard\(\['admin', 'founder'\], <WellbeingBookPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/wellbeing\/practice" element=\{guard\(\['admin', 'founder', 'partner', 'advisor'\], <ExpertEditorPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/wellbeing\/expert-dashboard" element=\{<Navigate to="\/wellbeing\/practice" replace \/>\} \/>/);
  assert.match(app, /<Route path="\/admin\/wellbeing\/resources" element=\{guard\(\['admin'\], <WellbeingResourceLibrary \/>\)\} \/>/);
  assert.match(app, /const WellbeingBookPage = lazy\(\(\) => import\('\.\/pages\/wellbeing\/WellbeingBookPage'\)\);/);
  assert.match(app, /const WellbeingResourceLibrary = lazy\(\(\) => import\('\.\/pages\/wellbeing\/WellbeingResourceLibrary'\)\);/);
  // The API's gates: every member read refuses an investor; both library writes need an admin.
  for (const decl of ["wellbeing.get('/checkins'", "wellbeing.post('/checkins'", "wellbeing.get('/experts'", "wellbeing.post('/experts/:uid/book'"]) {
    assert.match(handler(decl), /Not available for investors/, decl);
  }
  assert.match(adminConsoleSource(), /<Link to="\/admin\/wellbeing\/resources"/);
});

test('every method the screens call reaches a route wellbeing.ts declares', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url), init.body]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.wellbeingMyCheckins();
    await api.wellbeingSubmit(M.buildCheckinPayload({ values: { stress: 3 }, entry: ENTRY }));
    await api.wellbeingMyBookings();
    await api.wellbeingExpertRate('e1', { stars: 4 });
    await api.wellbeingResources();
    await api.wellbeingResourceCreate({ category: 'reading', name: 'R' });
    await api.wellbeingResourceDelete(7);
    await api.wellbeingExperts({ q: 'sleep', limit: 12, want_categories: ['executive_coach'] });
    await api.wellbeingExpertCategories();
    await api.wellbeingExpertSlots('e1');
    await api.wellbeingExpertBook('e1', M.bookingPayload({ slot: '2026-10-08T10:00:00.000Z' }));
    await api.wellbeingExpertMe();
    await api.wellbeingExpertMeUpdate({ name: 'Ada' });
    await api.wellbeingExpertMyServices();
    await api.wellbeingExpertServiceCreate({ title: 'T' });
    await api.wellbeingExpertServiceUpdate('s1', { is_active: false });
    await api.wellbeingExpertServiceDelete('s1');
    await api.wellbeingExpertMyAvailability();
    await api.wellbeingExpertAvailabilityCreate({ day_of_week: 3, start_minute: 600, end_minute: 660, timezone: 'UTC' });
    await api.wellbeingExpertAvailabilityDelete('w1');
    await api.wellbeingExpertMyBookings();
    await api.wellbeingExpertBookingPatch('p1', { status: 'cancelled' });
  } finally {
    globalThis.fetch = orig;
  }
  const got = calls.map(([m, u]) => `${m} ${u.replace(/^.*\/api\/wellbeing/, '').replace(/\?.*$/, '')}`);
  const expected = [
    ['GET /checkins', "wellbeing.get('/checkins'"],
    ['POST /checkins', "wellbeing.post('/checkins'"],
    ['GET /bookings/mine', "wellbeing.get('/bookings/mine'"],
    ['POST /experts/e1/rate', "wellbeing.post('/experts/:uid/rate'"],
    ['GET /resources', "wellbeing.get('/resources'"],
    ['POST /resources', "wellbeing.post('/resources'"],
    ['DELETE /resources/7', "wellbeing.delete('/resources/:id'"],
    ['GET /experts', "wellbeing.get('/experts'"],
    ['GET /experts/categories', "wellbeing.get('/experts/categories'"],
    ['GET /experts/e1/slots', "wellbeing.get('/experts/:uid/slots'"],
    ['POST /experts/e1/book', "wellbeing.post('/experts/:uid/book'"],
    ['GET /experts/me', "wellbeing.get('/experts/me'"],
    ['PUT /experts/me', "wellbeing.put('/experts/me'"],
    ['GET /experts/me/services', "wellbeing.get('/experts/me/services'"],
    ['POST /experts/me/services', "wellbeing.post('/experts/me/services'"],
    ['PUT /experts/me/services/s1', "wellbeing.put('/experts/me/services/:uid'"],
    ['DELETE /experts/me/services/s1', "wellbeing.delete('/experts/me/services/:uid'"],
    ['GET /experts/me/availability', "wellbeing.get('/experts/me/availability'"],
    ['POST /experts/me/availability', "wellbeing.post('/experts/me/availability'"],
    ['DELETE /experts/me/availability/w1', "wellbeing.delete('/experts/me/availability/:uid'"],
    ['GET /experts/me/bookings', "wellbeing.get('/experts/me/bookings'"],
    ['PATCH /experts/me/bookings/p1', "wellbeing.patch('/experts/me/bookings/:uid'"],
  ];
  assert.deepEqual(got, expected.map(([call]) => call));
  for (const [, decl] of expected) assert.ok(ROUTE.includes(decl), `${decl} is declared`);
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/wellbeing', wellbeingRoutes\);/);
  assert.deepEqual(JSON.parse(calls[1][2]), { stress: 3, free_text: null, tags: [], day: '2026-10-05' });
  assert.deepEqual(JSON.parse(calls[3][2]), { stars: 4 });
  assert.deepEqual(JSON.parse(calls[10][2]), { scheduled_at: '2026-10-08T10:00:00.000Z', duration_minutes: 30 });
  assert.match(calls[7][1], /want_category=executive_coach/);
});

test('D570 is recorded, with its gaps and the route behind each', () => {
  const d = read('documentation/architecture/decisions/D570.md');
  assert.match(d, /^## D570 — /);
  for (const route of ['POST /api/wellbeing/checkins', 'GET /api/wellbeing/bookings/mine', 'GET /api/wellbeing/experts/:uid/slots', 'POST /api/wellbeing/resources']) {
    assert.ok(d.includes(route), `D570 names ${route}`);
  }
  assert.match(d, /GAPS/);
});
