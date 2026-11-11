/**
 * D4620 (#4620) — Studio's totals, source status and agendas.
 *
 *   A. studioAgenda: identity, active policy, calendar coverage.
 *   B. Advisor Today: bookings, calendar and slots, one input down at a time.
 *   C. Investor: the eligible total, per-figure unreadable rows, upcoming
 *      events (cancelled dropped, a failed source not an empty calendar).
 *   D. Partner feed: one-source and two-source failures keep what loaded and
 *      never draw the all-clear.
 *
 * Synthetic records only. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_source_status_4620.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ADVISOR_AGENDA_KINDS, INVESTOR_AGENDA_KINDS, agendaKey, calendarCoverage, isActiveStatus, mergeAgenda, upcomingActive,
} from '../src/pages/studio/studioAgenda.js';
import { advisorToday, todayState } from '../src/pages/advisor/advisorToday.js';
import { StatGroup, quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { investorTiles } from '../src/pages/studio/tiles/investorTiles.jsx';
import { FirmFeed, unreadFeedReads } from '../src/pages/partner/PartnerHomeP2.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const draw = (el) => renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, el)));

const NOW = new Date('2026-11-08T10:00:00');
const at = (hhmm) => `2026-11-08T${hhmm}:00`;
const loading = { state: 'loading' };
const ready = (data) => ({ state: 'ready', data });
const failedRead = { state: 'unavailable', failed: true, message: 'boom' };
const calendarOk = (items, extra = []) => ready({ items, sources: [{ kind: 'advisor_booking', ok: true, error: null }, ...extra] });

// ── A. studioAgenda ─────────────────────────────────────────────────────────

test('agendaKey: a booking and its calendar copy are one key; another kind with the same number is not', () => {
  const booking = { id: 17, status: 'confirmed' };
  const copy = { id: 'advisor_booking:17', kind: 'advisor_booking', source_id: 17 };
  assert.equal(agendaKey(booking, 'advisor_booking'), 'advisor_booking:17');
  assert.equal(agendaKey(copy), 'advisor_booking:17');
  assert.equal(agendaKey({ id: 'ic_meeting:17', kind: 'ic_meeting', source_id: 17 }), 'ic_meeting:17');
  assert.notEqual(agendaKey({ kind: 'ic_meeting', source_id: 17 }), agendaKey(copy));
  // A string id and a number are one id; a calendar id with no source_id still resolves.
  assert.equal(agendaKey({ kind: 'advisor_booking', source_id: '17' }), 'advisor_booking:17');
  assert.equal(agendaKey({ kind: 'advisor_booking', id: 'advisor_booking:17' }), 'advisor_booking:17');
});

test('agendaKey: an item that names no id has no key, and is never merged with another', () => {
  assert.equal(agendaKey({ kind: 'advisor_booking' }), null);
  assert.equal(agendaKey({ id: 5 }), null, 'no kind, no fallback: unknown');
  const merged = mergeAgenda([{ items: [{ kind: 'manual', title: 'a' }, { kind: 'manual', title: 'b' }], kind: 'manual' }]);
  assert.equal(merged.length, 2);
});

test('mergeAgenda: the first input wins the duplicate', () => {
  const merged = mergeAgenda([
    { items: [{ id: 17, topic: 'Seed round' }], kind: 'advisor_booking' },
    { items: [{ id: 'advisor_booking:17', kind: 'advisor_booking', source_id: 17, title: 'Advisor session — Seed round' }], kind: 'advisor_booking' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].topic, 'Seed round');
});

test('isActiveStatus: cancelled and no-show are history; a missing status is not assumed cancelled', () => {
  for (const status of ['cancelled', 'canceled', 'no_show', 'CANCELLED']) assert.equal(isActiveStatus(status), false, status);
  for (const status of ['confirmed', 'pending', 'completed', '', null, undefined]) assert.equal(isActiveStatus(status), true, String(status));
});

test('upcomingActive: drops cancelled, past and untimed items, soonest first, limited', () => {
  const items = [
    { id: 1, start_at: at('15:00'), status: 'confirmed' },
    { id: 2, start_at: at('11:00'), status: 'cancelled' },
    { id: 3, start_at: at('09:00'), status: 'confirmed' },
    { id: 4, status: 'confirmed' },
    { id: 5, start_at: at('12:00') },
    { id: 6, start_at: at('13:00'), status: 'no_show' },
  ];
  assert.deepEqual(upcomingActive(items, { now: NOW }).map((i) => i.id), [5, 1]);
  assert.deepEqual(upcomingActive(items, { now: NOW, limit: 1 }).map((i) => i.id), [5]);
  assert.deepEqual(upcomingActive(items, { now: NOW, until: new Date(at('12:30')) }).map((i) => i.id), [5]);
});

test('calendarCoverage: a failed relevant source is partial or unreadable; a failed unrelated one is ignored', () => {
  const ok = (kind) => ({ kind, ok: true, error: null });
  const bad = (kind, error = 'unreadable') => ({ kind, ok: false, error });
  const kinds = ['advisor_booking', 'ic_meeting'];
  assert.equal(calendarCoverage({ items: [], sources: [ok('advisor_booking'), ok('ic_meeting'), bad('compliance_due')] }, kinds).state, 'ready');
  const partial = calendarCoverage({ items: [{ id: 1 }], sources: [ok('advisor_booking'), bad('ic_meeting')] }, kinds);
  assert.equal(partial.state, 'partial');
  assert.deepEqual(partial.failed, [{ kind: 'ic_meeting', error: 'unreadable' }]);
  assert.equal(partial.items.length, 1, 'what loaded is kept');
  assert.equal(calendarCoverage({ items: [], sources: [bad('advisor_booking'), bad('ic_meeting', 'not_configured')] }, kinds).state, 'unreadable');
  // A bare list (the dev backend) names no sources and claims nothing.
  assert.equal(calendarCoverage([{ id: 1 }], kinds).state, 'ready');
  assert.equal(calendarCoverage(undefined, kinds).state, 'ready');
  assert.deepEqual(calendarCoverage({ events: [{ id: 2 }] }, kinds).items, [{ id: 2 }]);
});

// ── B. Advisor Today ────────────────────────────────────────────────────────

const booking = (id, hhmm, status = 'confirmed', extra = {}) => ({ id, slot_starts_at: at(hhmm), status, topic: 'Seed round', ...extra });
const copy = (id, hhmm, status = 'confirmed') => ({ id: `advisor_booking:${id}`, kind: 'advisor_booking', source_id: id, start_at: at(hhmm), status, title: 'Advisor session' });
const today = (inputs) => advisorToday({ bookings: ready([]), calendar: calendarOk([]), slots: ready([]), ...inputs }, NOW);

test('Advisor Today: a booking and its calendar copy appear once; a different kind with the same number does not merge', () => {
  const result = today({
    bookings: ready([booking(17, '14:00')]),
    calendar: calendarOk([copy(17, '14:00'), { id: 'ic_meeting:17', kind: 'ic_meeting', source_id: 17, start_at: at('15:00'), status: 'confirmed' }]),
  });
  assert.equal(result.items.length, 1, 'the ic_meeting is not an advisor session, and the copy is the booking');
  assert.equal(result.items[0].topic, 'Seed round');
  const both = advisorToday({
    bookings: ready([booking(17, '14:00')]),
    calendar: ready({ items: [copy(18, '16:00')], sources: [{ kind: 'advisor_booking', ok: true, error: null }] }),
    slots: ready([]),
  }, NOW);
  assert.deepEqual(both.items.map((i) => agendaKey(i, 'advisor_booking')), ['advisor_booking:17', 'advisor_booking:18']);
});

test('Advisor Today: cancelled and no-show are dropped from the booking branch and the calendar branch', () => {
  const result = today({
    bookings: ready([booking(1, '11:00', 'cancelled'), booking(2, '12:00', 'no_show'), booking(3, '13:00')]),
    calendar: calendarOk([copy(4, '14:00', 'cancelled'), copy(5, '15:00', 'no_show'), copy(6, '16:00')]),
  });
  assert.deepEqual(result.items.map((i) => agendaKey(i, 'advisor_booking')), ['advisor_booking:3', 'advisor_booking:6']);
});

test('Advisor Today: a cancelled booking is not revived by a calendar copy that still says confirmed', () => {
  const result = today({ bookings: ready([booking(9, '11:00', 'cancelled')]), calendar: calendarOk([copy(9, '11:00', 'confirmed')]) });
  assert.equal(result.items.length, 0);
});

test('Advisor Today: every input empty and answered is an empty day', () => {
  assert.equal(todayState(today({})), 'empty');
});

for (const input of ['bookings', 'calendar', 'slots']) {
  test(`Advisor Today: ${input} failed while the other two are empty is unreadable, never empty`, () => {
    const down = { bookings: failedRead, calendar: failedRead, slots: failedRead }[input];
    const result = today({ [input]: down });
    assert.deepEqual(result.failed, [input]);
    assert.equal(todayState(result), 'unreadable');
  });
  test(`Advisor Today: ${input} still loading while the other two are empty is loading, never empty`, () => {
    const result = today({ [input]: loading });
    assert.deepEqual(result.loading, [input]);
    assert.equal(todayState(result), 'loading');
  });
}

test('Advisor Today: a 200 calendar whose booking source failed is a failed calendar input, and keeps the other two', () => {
  const result = advisorToday({
    bookings: ready([booking(3, '13:00')]),
    calendar: ready({ items: [], sources: [{ kind: 'advisor_booking', ok: false, error: 'unreadable' }] }),
    slots: ready([]),
  }, NOW);
  assert.deepEqual(result.failed, ['calendar']);
  assert.equal(result.items.length, 1, 'the booking that loaded is kept');
  assert.equal(todayState(result), 'ready');
});

test('Advisor Today: an unrelated failed calendar source does not fail the advisor tile', () => {
  const result = today({ calendar: calendarOk([], [{ kind: 'compliance_due', ok: false, error: 'not_configured' }]) });
  assert.deepEqual(result.failed, []);
  assert.equal(todayState(result), 'empty');
});

test('Advisor Today: an open slot is shown while bookings are down', () => {
  const slot = { id: 's1', starts_at: at('16:00'), ends_at: at('16:30'), capacity: 1, taken: 0 };
  const result = today({ slots: ready([slot]), bookings: failedRead });
  assert.equal(result.openSlots.length, 1);
  assert.equal(todayState(result), 'ready');
  assert.deepEqual(result.failed, ['bookings']);
});

test('Advisor Today: no advisor profile is not a failure (slots are "none")', () => {
  const result = today({ slots: { state: 'unavailable', message: 'Publish an advisor profile to manage slots.' } });
  assert.deepEqual(result.failed, []);
  assert.equal(result.inputs.slots, 'none');
});

test('Advisor Today asks only the advisor-booking kind', () => {
  assert.deepEqual([...ADVISOR_AGENDA_KINDS], ['advisor_booking']);
});

// ── C. Investor ─────────────────────────────────────────────────────────────

const lifecycleOk = { counts: { watching: 4, dealrooms: 2 }, sources: { 'inv:watching': 'ready', 'inv:dealrooms': 'ready' } };
const rowsOf = (group) => Object.fromEntries(group.rows.map(([label, value, , state]) => [label, { value, state }]));

test('quickStats: the deals figure is the eligible total, and a floor is marked', () => {
  const q = quickStats({ dashboard: { quick_stats: { ai_score_avg: 71 }, source_status: { deals: 'ready' } }, lifecycle: lifecycleOk, dealCount: 14 });
  assert.equal(rowsOf(q.dealFlow)['Deals in flow'].value, 14);
  const floor = quickStats({ dashboard: { quick_stats: {} }, lifecycle: lifecycleOk, dealCount: 500, dealCountIsLowerBound: true });
  assert.equal(rowsOf(floor.dealFlow)['Deals in flow'].value, '500+');
});

test('quickStats: a total of 0 is a true zero; a total that could not be counted is unreadable, not 0', () => {
  const zero = quickStats({ dashboard: { quick_stats: {}, source_status: { deals: 'ready' } }, lifecycle: lifecycleOk, dealCount: 0 });
  assert.deepEqual(rowsOf(zero.dealFlow)['Deals in flow'], { value: 0, state: undefined });
  const down = quickStats({ dashboard: { quick_stats: {}, source_status: { deals: 'unreadable', scoresMine: 'ready' } }, lifecycle: lifecycleOk, dealCount: null });
  assert.equal(rowsOf(down.dealFlow)['Deals in flow'].state, 'unreadable');
  assert.equal(rowsOf(down.dealFlow)['Avg AI match'].state, undefined, 'the average read answered');
  const text = draw(React.createElement(StatGroup, { group: down.dealFlow, what: 'The deal-flow summary', claim: 'x', onRetry: () => {} }));
  assert.match(text, /Could not be read/);
  assert.match(text, /Retry/);
  assert.doesNotMatch(text, /\b0\b/);
});

test('quickStats: one lifecycle count failed keeps the other, and a retry is offered', () => {
  const lifecycle = { counts: { watching: null, dealrooms: 2 }, partial: true, sources: { 'inv:watching': 'unreadable', 'inv:dealrooms': 'ready' } };
  const rows = rowsOf(quickStats({ dashboard: { quick_stats: {} }, lifecycle, dealCount: 3 }).lifecycle);
  assert.equal(rows.Watching.state, 'unreadable');
  assert.deepEqual(rows['Active deal rooms'], { value: 2, state: undefined });
});

const tilesFor = (extra) => investorTiles({
  user: { id: 1 }, dashboard: {}, lifecycle: lifecycleOk, records: { portfolio: {}, events: {} }, failures: {}, stages: [], quick: quickStats({ dashboard: {}, lifecycle: lifecycleOk, dealCount: 1 }),
  refreshContext: () => {}, retryLifecycle: () => {}, retrySources: () => {}, ...extra,
});

test('Investor upcoming events: a 200 whose sources failed, with nothing to show, is unreadable, never "no events"', () => {
  const sources = [{ kind: 'investor_meeting', ok: false, error: 'unreadable' }, { kind: 'ic_meeting', ok: false, error: 'unreadable' }];
  const coverage = calendarCoverage({ items: [], sources }, INVESTOR_AGENDA_KINDS);
  assert.equal(coverage.state, 'unreadable');
  assert.equal(tilesFor({ events: [], eventsCoverage: coverage }).upcoming_events.state, 'unreadable');
  const none = calendarCoverage({ items: [], sources: [{ kind: 'investor_meeting', ok: true, error: null }] }, INVESTOR_AGENDA_KINDS);
  assert.equal(tilesFor({ events: [], eventsCoverage: none }).upcoming_events.state, 'empty');
});

test('Investor upcoming events: events that loaded are shown with the failed source named', () => {
  const coverage = calendarCoverage({ items: [], sources: [{ kind: 'investor_meeting', ok: true, error: null }, { kind: 'ic_meeting', ok: false, error: 'unreadable' }] }, INVESTOR_AGENDA_KINDS);
  const events = [{ id: 'm1', title: 'Fund call', start_at: at('15:00') }];
  const spec = tilesFor({ events, eventsCoverage: coverage }).upcoming_events;
  assert.equal(spec.state, 'ready');
  const text = draw(spec.body);
  assert.match(text, /Fund call/);
  assert.match(text, /ic meeting/i);
  assert.match(text, /may be incomplete/);
});

test('Investor upcoming events: a cancelled event is not upcoming (the Calendar keeps it)', () => {
  const items = [
    { id: 'a', kind: 'investor_meeting', source_id: 1, title: 'Held', start_at: at('15:00'), status: 'confirmed' },
    { id: 'b', kind: 'investor_meeting', source_id: 2, title: 'Dropped', start_at: at('14:00'), status: 'cancelled' },
  ];
  assert.deepEqual(upcomingActive(items, { now: NOW, limit: 2 }).map((i) => i.title), ['Held']);
});

test('Investor funnel: a stage whose read failed says Unreadable and offers a retry; a true 0 stays 0', () => {
  const stages = [{ id: 'watching', label: 'Watching', count: null, href: '/deals' }, { id: 'intro', label: 'Warm intro', count: 0, href: '/deals' }];
  const lifecycle = { counts: { watching: null, intros: 0 }, partial: true, sources: { 'inv:watching': 'unreadable' }, stages };
  const spec = tilesFor({ lifecycle, stages }).deal_lifecycle;
  const text = draw(spec.body);
  assert.match(text, /Unreadable/);
  assert.match(text, /Retry/);
  assert.match(text, /Warm intro/);
  const whole = draw(tilesFor({ lifecycle: { ...lifecycle, partial: false, sources: {}, counts: { watching: 0 }, stages: [{ id: 'watching', label: 'Watching', count: 0, href: '/deals' }] }, stages: [{ id: 'watching', label: 'Watching', count: 0, href: '/deals' }] }).deal_lifecycle.body);
  assert.doesNotMatch(whole, /Unreadable/);
});

// ── D. Partner feed ─────────────────────────────────────────────────────────

const BOARD = { items: [{ engagement_id: 1, client: 'Northwind', health: 'at_risk', status: 'accepted', health_reasons: ['Two overdue milestones'], milestones_due_7d: 0 }] };
const RETAINERS = { items: [] };
const CAPACITY = { people: [] };
const feed = (reads) => draw(React.createElement(FirmFeed, { reads, onRetry: () => {} }));

test('Partner feed: every read answered and nothing to report is the all-clear', () => {
  assert.match(feed({ board: { items: [] }, retainers: RETAINERS, capacity: CAPACITY }), /Nothing is at risk, due this week, over a stated cap or renewing soon\./);
});

test('Partner feed: one read down and nothing from the others is not the all-clear', () => {
  for (const down of ['board', 'retainers', 'capacity']) {
    const reads = { board: { items: [] }, retainers: RETAINERS, capacity: CAPACITY, [down]: null };
    const text = feed(reads);
    assert.doesNotMatch(text, /Nothing is at risk/, `${down} down`);
    assert.match(text, /could not be read/);
    assert.match(text, /Retry/);
  }
});

test('Partner feed: one read down keeps the entries the others produced and qualifies them', () => {
  const text = feed({ board: BOARD, retainers: null, capacity: CAPACITY });
  assert.match(text, /Northwind/);
  assert.match(text, /Two overdue milestones/);
  assert.match(text, /retainers could not be read/);
});

test('Partner feed: two reads down names both and still keeps the one that loaded', () => {
  const text = feed({ board: BOARD, retainers: null, capacity: null });
  assert.match(text, /Northwind/);
  assert.match(text, /retainers and capacity could not be read/);
  assert.doesNotMatch(text, /Nothing is at risk/);
});

test('Partner feed: unreadFeedReads names exactly the reads that did not answer', () => {
  assert.deepEqual(unreadFeedReads({ board: BOARD, retainers: null, capacity: null }), ['retainers', 'capacity']);
  assert.deepEqual(unreadFeedReads({ board: BOARD, retainers: RETAINERS, capacity: CAPACITY }), []);
});

// ── E. The homes use them ───────────────────────────────────────────────────
// The three homes mount the interview, whose imports reach Worker modules, so they
// cannot be mounted here; what they hand the helpers above is pinned as text.

const src = (rel) => codeOnly(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

test('InvestorStudioHome counts the worker\'s eligible total, never the preview\'s length, and reads coverage and the active policy', () => {
  const home = src('../src/pages/investor/InvestorStudioHome.jsx');
  assert.match(home, /dashboard\?\.proprietary_deal_flow_summary/);
  assert.doesNotMatch(home, /dealCount = list\(/, 'the deal count was the preview\'s length');
  assert.match(home, /calendarCoverage\(records\.events, INVESTOR_AGENDA_KINDS\)/);
  assert.match(home, /upcomingActive\(eventsCoverage\.items, \{ limit: 2 \}\)/);
  assert.match(home, /dealCountIsLowerBound: dealSummary\?\.total_is_lower_bound === true/);
});

test('AdvisorStudioHome builds Today from all three reads, keeps the calendar answer whole, and retries only what failed', () => {
  const home = src('../src/pages/advisor/AdvisorStudioHome.jsx');
  assert.match(home, /advisorToday\(\{ bookings, calendar, slots \}\)/);
  assert.match(home, /todayState\(today\)/);
  assert.match(home, /read\('calendar', setCalendar, \(\) => api\.listCalendarEvents\(\{ kinds: ADVISOR_AGENDA_KINDS\.join\(','\) \}\), \(r\) => r\)/);
  for (const name of ['bookings', 'calendar', 'slots']) assert.match(home, new RegExp(`today\\.failed\\.includes\\('${name}'\\)`));
  assert.doesNotMatch(home, /isBookableSlot/, 'a second private copy of the slot filter');
});

test('usePartnerHome keeps the reads that answered and asks again only for the others', () => {
  const home = src('../src/pages/partner/PartnerHomeP2.jsx');
  assert.match(home, /const wanted = have \? Object\.keys\(READS\)\.filter\(\(key\) => !have\[key\]\) : Object\.keys\(READS\);/);
  assert.match(home, /kept\.current = reads;/);
});
