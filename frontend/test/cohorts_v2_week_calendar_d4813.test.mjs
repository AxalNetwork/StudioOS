/**
 * D4813 (#4813, package 3) — This week (C7) and the integrated calendar (C8,
 * C9, C15).
 *
 * What these pin, each a decision that could quietly go the other way:
 *   · a founder's week status is explicit, and Not yet assessed is never
 *     Complete — not when the row is missing, and not when the counts are full
 *     but the Lab has not decided;
 *   · the agenda is the next 14 days and keeps a session already under way;
 *   · a calendar with one half unread draws the other half and names what is
 *     missing — never blank, never the half as the whole;
 *   · a conflict is explained in words, including which side is in progress;
 *   · the zone is named; exported UIDs are scoped to the cohort;
 *   · a response for the cohort just left is dropped;
 *   · phone markers: agenda first, no month grid at 390px, 44px targets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { createRequestGate, guardedRead } from '../src/pages/advisor/cohorts/cohortModel.js';
import {
  addDays, agendaDays, calendarEvents, conflictText, conflictsByRef, dayKey, eventDetail, eventType,
  exportUid, filterByTypes, missingSources, monthGrid, shiftAnchor, startOfWeek, weekColumns,
} from '../src/pages/advisor/cohorts/calendarModel.js';
import {
  advisorActions, attentionLine, deliverableStatus, recentGuidance, sessionsBetween, thisWeek,
} from '../src/pages/advisor/cohorts/weekModel.js';
import { AgendaList, EventDetail, MonthView, PartialNotice, ViewSwitch, calendarIcs } from '../src/pages/advisor/cohorts/CalendarZone.jsx';
import { DeliverablesTable, WeekHeader } from '../src/pages/advisor/cohorts/ThisWeekZone.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const H = 3_600_000;
const NOW = Date.parse('2026-11-11T17:00:00Z'); // Wed Nov 11, 12:00 New York
const at = (hours) => new Date(NOW + hours * H).toISOString();
const html = (el) => renderedText(renderToStaticMarkup(h(MemoryRouter, null, el)));

// ── This week ─────────────────────────────────────────────────────────────

const WINDOW = { week_number: 2, unlock_at: at(-48), deadline_at: at(72) };
const WEEKS = {
  available: true, windows_recorded: true, current_week: 2,
  weeks: [{ week_number: 1, unlock_at: at(-9 * 24), deadline_at: at(-48) }, WINDOW,
    { week_number: 3, unlock_at: at(72), deadline_at: at(9 * 24) }, { week_number: 4, unlock_at: at(9 * 24), deadline_at: at(16 * 24) }],
  founders: [
    { user_id: 1, name: 'Ana', weeks: { 1: { status: 'passed' }, 2: { status: 'passed', deliverables_done: 3, deliverables_required: 3 } } },
    { user_id: 2, name: 'Bruno', weeks: { 1: { status: 'failed', deliverables_done: 1, deliverables_required: 3 } } },
    { user_id: 3, name: 'Chen', weeks: { 2: { status: 'pending', deliverables_done: 1, deliverables_required: 3 } } },
    { user_id: 4, name: 'Dara', weeks: { 2: { status: 'grace', deliverables_done: 2, deliverables_required: 3, grace_until: at(30), grace_reason: 'Illness' } } },
    { user_id: 5, name: 'Femi', weeks: { 2: { status: 'pending', deliverables_done: 3, deliverables_required: 3 } } },
  ],
};
const ROSTER = [1, 2, 3, 4, 5, 6].map((id) => ({ user_id: id, name: ['Ana', 'Bruno', 'Chen', 'Dara', 'Femi', 'Gus'][id - 1] }));

test('D4813 p3: each founder has an explicit week status; nothing is inferred from missing data', () => {
  const w = thisWeek({ weeks: WEEKS, roster: ROSTER, cycleId: 12, now: NOW });
  assert.equal(w.ready, true);
  const by = Object.fromEntries(w.rows.map((r) => [r.name, r.status]));
  assert.deepEqual(by, {
    Ana: 'complete', Bruno: 'failed', Chen: 'in_progress', Dara: 'grace',
    Femi: 'not_assessed', Gus: 'not_assessed',
  });
  assert.match(w.rows.find((r) => r.name === 'Bruno').reason, /Held at week 1/);
  assert.match(w.rows.find((r) => r.name === 'Femi').reason, /has not decided/, 'full counts are not a pass');
  assert.match(w.rows.find((r) => r.name === 'Gus').reason, /no week 2 record/, 'no row is not a pass either');
  assert.equal(w.complete, 1, 'only the founder the Lab recorded passed is complete');
});

test('D4813 p3: Not assessed is never Complete, and a pending week past its deadline is Missing', () => {
  assert.equal(deliverableStatus(undefined, 2, WINDOW, NOW).status, 'not_assessed');
  assert.equal(deliverableStatus({ 2: { status: 'pending' } }, 2, WINDOW, NOW).status, 'not_assessed', 'unreadable counts');
  assert.equal(deliverableStatus({ 2: { status: 'pending', deliverables_done: 3, deliverables_required: 3 } }, 2, WINDOW, NOW).status, 'not_assessed');
  assert.equal(deliverableStatus({ 2: { status: 'passed' } }, 2, WINDOW, NOW).status, 'complete');
  const late = deliverableStatus({ 2: { status: 'pending', deliverables_done: 1, deliverables_required: 3 } }, 2, WINDOW, NOW + 80 * H);
  assert.equal(late.status, 'missing');
});

test('D4813 p3: the header carries week n of N, dates, the named zone, the deadline, days left, completion and attention', () => {
  const w = thisWeek({ weeks: WEEKS, roster: ROSTER, cycleId: 12, now: NOW });
  assert.equal(w.week, 2);
  assert.equal(w.total, 4);
  assert.equal(w.timezone, 'America/New_York');
  assert.equal(w.daysRemaining, 3);
  assert.equal(w.range, 'Mon, Nov 9 – Sat, Nov 14');
  assert.deepEqual(w.deliverables, { done: 9, required: 12, uncounted: 2 }, 'unreadable founders are named as not counted, not added as zero');
  assert.equal(attentionLine(w.tally), '1 failed · 1 grace');
  const text = html(h(WeekHeader, { week: w }));
  for (const s of ['2 of 4', 'America/New_York', 'Days remaining', '1 of 6', '9 of 12 deliverables in · 2 not counted', 'Need attention', '1 failed · 1 grace']) {
    assert.ok(text.includes(s), `header shows ${s}`);
  }
});

test('D4813 p3: no windows, or no week open, is stated — never week one', () => {
  assert.equal(thisWeek({ weeks: { ...WEEKS, windows_recorded: false }, roster: ROSTER }).ready, false);
  assert.match(thisWeek({ weeks: { ...WEEKS, windows_recorded: false }, roster: ROSTER }).reason, /not week one by default/);
  assert.equal(thisWeek({ weeks: { ...WEEKS, current_week: null }, roster: ROSTER }).ready, false);
  assert.equal(thisWeek({ weeks: { available: false }, roster: ROSTER }).ready, false);
});

test('D4813 p3: the deliverables table is read-only — words and shapes, a semantic table, phone cards', () => {
  const w = thisWeek({ weeks: WEEKS, roster: ROSTER, cycleId: 12, now: NOW });
  const markup = renderToStaticMarkup(h(MemoryRouter, null, h(DeliverablesTable, { week: w })));
  assert.match(markup, /<caption/);
  assert.match(markup, /<th scope="row"/);
  assert.doesNotMatch(markup, /<(input|select|textarea)\b/, 'founder data never looks editable');
  assert.match(renderedText(markup), /○\s*Not yet assessed/);
  assert.match(renderedText(markup), /✓\s*Complete/);
  assert.match(markup, /sm:hidden/, 'cards on a phone');
});

test('D4813 p3: your actions are kept apart from the founders’, and no session prep is claimed', () => {
  const guidance = { counts: { open: 1 }, items: [
    { uid: 'q1', kind: 'question', body: 'How deep should the interview log go?', answer: null, posted_at: at(-20) },
    { uid: 'b1', kind: 'broadcast', body: 'Week 2 is about the problem statement', posted_at: at(-40) },
    { uid: 'd1', kind: 'broadcast', body: 'Unpublished draft', posted_at: at(-1), is_draft: true },
  ] };
  const sessions = [{ kind: 'client', ref: 'slot:7', title: 'Pricing review', starts_at: at(20), ends_at: at(21) }];
  const acts = advisorActions({ guidance, sessions, cycleId: 12, now: NOW });
  assert.deepEqual(acts.map((a) => a.kind), ['question', 'session']);
  assert.equal(acts[0].to, '/cohorts/guidance?cohort=12');
  assert.ok(!JSON.stringify(acts).match(/notes|brief|prepare/i));
  assert.deepEqual(recentGuidance(guidance).map((g) => g.uid), ['b1']);
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/ThisWeekZone.jsx'));
  assert.match(src, /title="Your actions"/);
  assert.match(src, /title="Required deliverables · founder responsibilities"/);
  assert.match(src, /title="Guidance & communication"/);
  assert.match(src, /title="Sessions this week"/);
  assert.doesNotMatch(src, /postMyAdvisorCohortGuidance|answerMyAdvisorCohortGuidance/, 'guidance is read only here');
});

test('D4813 p3: sessions this week keep an ongoing one', () => {
  const ev = [
    { kind: 'client', ref: 'slot:1', starts_at: at(-1), ends_at: at(1) },
    { kind: 'client', ref: 'slot:2', starts_at: at(200), ends_at: at(201) },
    { kind: 'cohort', ref: 'week:2:deadline', starts_at: at(5), ends_at: null },
  ];
  assert.deepEqual(sessionsBetween(ev, at(-48), at(72), NOW).map((e) => e.ref), ['slot:1']);
});

// ── Calendar ──────────────────────────────────────────────────────────────

const PAYLOAD = {
  timezone: 'America/New_York',
  sources: { lab_dates: 'ok', sessions: 'ok' },
  events: [
    { kind: 'cohort', type: 'week_opens', ref: 'week:2:unlock', uid: 'cohort-12-week-2-opens', title: 'Week 2 opens', starts_at: at(-48), ends_at: null },
    { kind: 'client', type: 'session', ref: 'slot:1', uid: 'advisor-slot-1', title: 'Pricing review', starts_at: at(-0.5), ends_at: at(1), ongoing: true, participants: [{ name: 'Fay', status: 'confirmed' }], status: 'confirmed' },
    { kind: 'client', type: 'session', ref: 'slot:2', uid: 'advisor-slot-2', title: 'Interview debrief', starts_at: at(0.5), ends_at: at(1.5), participants: [{ name: 'Flo', status: 'pending' }], status: 'pending' },
    { kind: 'client', type: 'group_session', ref: 'slot:3', uid: 'advisor-slot-3', title: 'Week 2 check-in', starts_at: at(24), ends_at: at(25), participants: [{ name: 'Ana', status: 'confirmed' }, { name: 'Chen', status: 'confirmed' }, { name: 'Dara', status: 'confirmed' }], status: 'confirmed' },
    { kind: 'cohort', type: 'deadline', ref: 'week:2:deadline', uid: 'cohort-12-week-2-due', title: 'Week 2 deliverables due', starts_at: at(72), ends_at: null },
    { kind: 'demo_day', type: 'demo_day', ref: 'cycle:12:end', uid: 'cohort-12-demo-day', title: 'Demo Day', starts_at: at(20 * 24), ends_at: null },
  ],
  collisions: [{ a: 'slot:1', b: 'slot:2', kind: 'sessions_overlap', overlap_start: at(0.5), overlap_end: at(1), overlap_minutes: 30, ongoing: ['slot:1'] }],
};

test('D4813 p3: the agenda is the next 14 days, ongoing session first, past and later events left out', () => {
  const events = calendarEvents(PAYLOAD);
  const days = agendaDays(events, NOW, 14);
  const refs = days.flatMap((d) => d.items.map((i) => i.ref));
  assert.deepEqual(refs, ['slot:1', 'slot:2', 'slot:3', 'week:2:deadline']);
  assert.ok(!refs.includes('cycle:12:end'), 'Demo Day in 20 days is outside the window');
  assert.ok(!refs.includes('week:2:unlock'), 'a past instant is not on the agenda');
  assert.equal(days[0].key, dayKey(NOW));
  assert.equal(agendaDays(events, NOW, 21).flatMap((d) => d.items).length, 5);
});

test('D4813 p3: a group session is one event with its participants inside', () => {
  const ev = calendarEvents(PAYLOAD).find((e) => e.ref === 'slot:3');
  assert.equal(eventType(ev), 'group_session');
  const d = eventDetail(ev, { year: 2026, month: 11 });
  assert.equal(d.participants, 'Ana, Chen, Dara');
  assert.equal(d.cohort, 'November 2026');
  assert.equal(d.timezone, 'America/New_York');
  assert.equal(d.type, 'Group mentoring');
  assert.equal(d.status, 'Confirmed');
  const text = html(h(EventDetail, { detail: d, conflicts: [], onClose() {} }));
  for (const k of ['Cohort', 'Type', 'Starts', 'Ends', 'Timezone', 'Participants', 'Status']) assert.ok(text.includes(k));
});

test('D4813 p3: a conflict is explained in words, and says which side is in progress', () => {
  const events = calendarEvents(PAYLOAD);
  const byRef = new Map(events.map((e) => [e.ref, e]));
  const text = conflictText(PAYLOAD.collisions[0], byRef);
  assert.match(text, /“Pricing review” 11:30–13:00 overlaps “Interview debrief” 12:30–13:30 by 30 minutes/);
  assert.match(text, /“Pricing review” is in progress now/);
  const inside = conflictText({ a: 'slot:1', b: 'week:2:deadline', kind: 'instant_in_session', ongoing: [] }, byRef);
  assert.match(inside, /“Week 2 deliverables due” at \d\d:\d\d falls inside “Pricing review”/);
  assert.equal(conflictsByRef(PAYLOAD.collisions).get('slot:2').length, 1);
  const markup = renderedText(renderToStaticMarkup(h(AgendaList, {
    days: agendaDays(events, NOW, 14), clash: conflictsByRef(PAYLOAD.collisions), onOpen() {}, cohortName: 'November 2026',
  })));
  assert.match(markup, /▲ Conflict/, 'marked in words and a shape, not colour alone');
  assert.match(markup, /in progress/);
});

test('D4813 p3: partial sources draw what loaded and name what is missing', () => {
  assert.deepEqual(missingSources({ ...PAYLOAD }), []);
  const labDown = missingSources({ sources: { lab_dates: 'error', sessions: 'ok' } });
  assert.equal(labDown.length, 1);
  assert.match(labDown[0].text, /Cohort dates couldn’t be loaded\. Your sessions are shown/);
  assert.match(missingSources({ sources: { lab_dates: 'not_recorded', sessions: 'ok' } })[0].text, /no week windows recorded/);
  assert.match(missingSources({ sources: { lab_dates: 'ok', sessions: 'error' } })[0].text, /Your sessions couldn’t be loaded\. Cohort dates are shown/);
  assert.match(missingSources({ windows_recorded: false })[0].text, /no week windows/, 'an older payload still reports it');
  assert.match(missingSources({ sources: { lab_dates: 'ok', sessions: 'ok' }, sessions_truncated: true })[0].text, /200 bookings/);
  const text = html(h(PartialNotice, { missing: labDown, onRetry() {} }));
  assert.match(text, /Showing what loaded/);
  assert.match(text, /Retry/);
  // The zone no longer refuses a calendar with no windows: it is partial, not failed.
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx'));
  assert.doesNotMatch(src, /accept:/, 'a partial calendar is drawn, not turned into an error');
  assert.match(src, /isEmpty=\{!data\.loading && !data\.error && all\.length === 0 && missing\.length === 0\}/);
});

test('D4813 p3: the timezone is named on the calendar and in This week', () => {
  assert.match(codeOnly(read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx')), /`Times in \$\{tz\}`/);
  assert.match(codeOnly(read('frontend/src/pages/advisor/cohorts/ThisWeekZone.jsx')), /week\.timezone/);
});

test('D4813 p3: the type filter narrows; week and month put events on their Lab day', () => {
  const events = calendarEvents(PAYLOAD);
  assert.deepEqual(filterByTypes(events, new Set(['deadline'])).map((e) => e.ref), ['week:2:deadline']);
  const start = startOfWeek(dayKey(NOW));
  assert.equal(start, '2026-11-09', 'weeks start on Monday');
  const cols = weekColumns(events, start);
  assert.equal(cols.length, 7);
  assert.deepEqual(cols[2].items.map((e) => e.ref), ['slot:1', 'slot:2']);
  assert.equal(shiftAnchor('week', '2026-11-11', 1), '2026-11-16');
  assert.equal(shiftAnchor('month', '2026-11-11', 1), '2026-12-01');
  assert.equal(shiftAnchor('agenda', '2026-11-11', 1), addDays('2026-11-11', 14));
  // A 23:59 New York deadline is that day in New York, not the next UTC day.
  assert.equal(dayKey('2026-11-14T04:59:00Z'), '2026-11-13');
  const grid = monthGrid(events, '2026-11-11');
  assert.ok(grid.every((row) => row.length === 7));
});

test('D4813 p3: exported UIDs are scoped to the cohort', () => {
  const ics = calendarIcs(calendarEvents(PAYLOAD), 12);
  assert.match(ics, /UID:cohort-12-week-2-due@axal\.vc/);
  assert.match(ics, /UID:advisor-slot-3@axal\.vc/);
  const legacy = { ref: 'week:2:unlock', kind: 'cohort' };
  assert.notEqual(exportUid(legacy, 12), exportUid(legacy, 13), 'an old payload without uid is still cohort-scoped');
  const uids = ics.match(/^UID:.*$/gm);
  assert.equal(new Set(uids).size, uids.length);
});

test('D4813 p3: a calendar response for the cohort just left is dropped', async () => {
  const gate = createRequestGate();
  const states = [];
  let releaseOld;
  const old = guardedRead({ gate, fetch: () => new Promise((r) => { releaseOld = r; }), onState: (s) => states.push(['old', s]) });
  const fresh = guardedRead({ gate, fetch: async () => ({ cohort_cycle_id: 12, events: [] }), onState: (s) => states.push(['new', s]) });
  await fresh;
  releaseOld({ cohort_cycle_id: 9, events: PAYLOAD.events });
  assert.equal(await old, false);
  assert.ok(!states.some(([who, s]) => who === 'old' && s.data), 'the old cohort never paints');
  for (const f of ['CalendarZone', 'ThisWeekZone']) {
    assert.match(codeOnly(read(`frontend/src/pages/advisor/cohorts/${f}.jsx`)), /useCohortRead\(/, `${f} reads through the guarded path`);
  }
});

test('D4813 p3: the view switch is a keyboard radio group', () => {
  const markup = renderToStaticMarkup(h(ViewSwitch, { view: 'agenda', onChange() {} }));
  assert.match(markup, /role="radiogroup"/);
  assert.equal((markup.match(/role="radio"/g) || []).length, 3);
  assert.match(markup, /aria-checked="true"[^>]*tabindex="0"[^>]*>Agenda|tabindex="0"[^>]*>Agenda/);
  assert.match(codeOnly(read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx')), /e\.key === 'ArrowRight'/);
});

test('D4813 p3: phone markers — agenda first, no month grid at 390px, 44px targets', () => {
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx'));
  assert.match(src, /\(max-width: 639px\)/);
  assert.match(src, /phoneFirst\(\) \? 'agenda' : 'week'/);
  const month = renderToStaticMarkup(h(MonthView, { weeks: monthGrid(calendarEvents(PAYLOAD), '2026-11-11'), clash: new Map(), onOpen() {}, today: '2026-11-11' }));
  assert.match(month, /<table class="hidden[^"]*sm:table"/, 'the grid is not drawn on a phone');
  assert.match(month, /class="sm:hidden" data-testid="calendar-month-list"/, 'a phone gets the month as a list');
  assert.ok((src.match(/min-h-\[44px\]/g) || []).length >= 6, 'controls are 44px on touch');
  assert.match(codeOnly(read('frontend/src/pages/advisor/cohorts/ThisWeekZone.jsx')), /min-h-\[44px\]/);
});
