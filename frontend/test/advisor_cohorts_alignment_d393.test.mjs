/**
 * D393 — Cohorts alignment: the five archetypes are the canvas's own, Founders
 * draws the week lanes from the Lab's week record, and Calendar gets the
 * canvas's four chips and a client-side .ics export.
 *
 * The archetypes are read out of the canvas here, so the guard cannot pass on
 * a shell that agrees with a typo. Everything else drives the real helpers
 * and renders the real card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { bucketsFor } from '../src/workspaces/shellConfig.js';
import { lanesFrom, FOUNDER_VIEWS, FounderCard } from '../src/pages/advisor/cohorts/FoundersZone.jsx';
import { CAL_VIEWS, calendarIcs } from '../src/pages/advisor/cohorts/CalendarZone.jsx';
import { buildIcs } from '../src/lib/ics.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));
const CANVAS = raw('design/canvases/backlog/Pages · Advisor Cohorts.dc.html');

// ── Archetypes ─────────────────────────────────────────────────────────────

test('D393: the Cohorts zones carry the canvas\'s five archetypes, in order', () => {
  const fromCanvas = [...CANVAS.matchAll(/<span class="ab-nm">([^<]+) — ([A-Z ]+)<\/span>/g)]
    .map((m) => [m[1].trim(), m[2].trim()]);
  assert.equal(fromCanvas.length, 5, 'the five Cohorts artboards could not be read from the canvas');
  const cohorts = bucketsFor('advisor').find((b) => b.prefix === '/cohorts');
  assert.ok(cohorts, 'the advisor licence has no Cohorts bucket');
  const fromShell = cohorts.zones.map((z) => [z.label, z.archetype?.label]);
  assert.deepEqual(fromShell, fromCanvas);
});

// ── Founders lanes ─────────────────────────────────────────────────────────

const ROSTER = [
  { user_id: 1, name: 'Amara Osei' },
  { user_id: 2, name: 'Dev Rao' },
  { user_id: 3, name: 'Nadia Park' },
  { user_id: 4, name: 'No Row Yet' },
];
const WEEKS = {
  available: true,
  windows_recorded: true,
  current_week: 2,
  weeks: [1, 2, 3, 4].map((n) => ({ week_number: n })),
  founders: [
    { user_id: 1, weeks: { 1: { status: 'complete', deliverables_done: 4, deliverables_required: 4 }, 2: { status: 'in_progress', deliverables_done: 1, deliverables_required: 4 } } },
    { user_id: 2, weeks: { 2: { status: 'complete', deliverables_done: 3, deliverables_required: 3 } } },
    { user_id: 3, weeks: { 2: { status: 'open', deliverables_done: 0, deliverables_required: 0 } } },
  ],
};

test('D393: every founder sits in the lane of the batch\'s week, with that week\'s deliverables', () => {
  const m = lanesFrom(WEEKS, ROSTER);
  assert.deepEqual(m.lanes.map((l) => [l.week, l.cards.length]), [[1, 0], [2, 4], [3, 0], [4, 0]]);
  const by = Object.fromEntries(m.cards.map((c) => [c.user_id, c]));
  assert.deepEqual([by[1].done, by[1].required, by[1].pct, by[1].behind], [1, 4, 25, true],
    'week 2 is read, not week 1');
  assert.equal(by[2].complete, true);
  assert.equal(by[3].pct, null, 'nothing required is not 0%');
  assert.equal(by[3].behind, false);
  assert.equal(by[4].pct, null, 'a founder with no status row has no progress, not 0%');
  assert.equal(by[4].done, null);
  assert.deepEqual(m.cards.filter(FOUNDER_VIEWS.behind).map((c) => c.user_id), [1]);
});

test('D393: no windows, or no week open yet, means no lanes — never "Week 1" by default', () => {
  const none = lanesFrom({ ...WEEKS, windows_recorded: false, weeks: [] }, ROSTER);
  assert.equal(none.lanes, null);
  assert.match(none.reason, /no week windows recorded/);
  const early = lanesFrom({ ...WEEKS, current_week: null }, ROSTER);
  assert.equal(early.lanes, null);
  assert.match(early.reason, /No week of this cycle has opened yet/);
  assert.equal(early.cards.length, 4, 'the roster still reads');
});

test('D393: a card shows name and deliverables, the behind flag, and no company', () => {
  const [amara, , nadia, noRow] = lanesFrom(WEEKS, ROSTER).cards;
  const a = renderedText(renderToStaticMarkup(React.createElement(FounderCard, { card: amara })));
  assert.match(a, /Amara Osei/);
  assert.match(a, /1 of 4 deliverables · 25%/);
  assert.match(a, /Behind plan/);
  assert.doesNotMatch(a, /Company/i);
  const n = renderedText(renderToStaticMarkup(React.createElement(FounderCard, { card: nadia })));
  assert.match(n, /No deliverable is required this week/);
  assert.doesNotMatch(n, /0%/);
  const r = renderedText(renderToStaticMarkup(React.createElement(FounderCard, { card: noRow })));
  assert.match(r, /Progress not recorded/);
});

test('D393: the page reads the week record, and draws what it cannot count as absent', () => {
  const src = read('frontend/src/pages/advisor/cohorts/FoundersZone.jsx');
  assert.match(src, /api\.listMyAdvisorCohortWeeks\(cycleId\)/);
  assert.match(src, /label: 'Flagged', value: null/, 'Flagged has no store and must read absent');
  assert.match(src, /Bulk: nudge behind-plan · not built/);
  assert.match(src, /<button type="button" disabled title="Nothing sends a founder a nudge/,
    'the bulk nudge is drawn as a stated gap, not as a live control');
  assert.match(src, /lane\.cards\.filter\(shown\)/, 'the chips narrow the lanes');
});

// ── Calendar ───────────────────────────────────────────────────────────────

const ITEMS = [
  { ref: 'week:2:unlock', kind: 'cohort', title: 'Week 2 opens', starts_at: '2026-09-28T09:00:00Z', ends_at: null },
  { ref: 'slot:7', kind: 'client', title: 'Meridian, client session', starts_at: '2026-09-29T14:00:00Z', ends_at: '2026-09-29T15:00:00Z' },
  { ref: 'demo', kind: 'demo_day', title: 'Demo Day', starts_at: '2026-10-03T09:30:00Z', ends_at: null },
];

test('D393: the four calendar chips narrow the stream by kind', () => {
  const ids = (k) => ITEMS.filter(CAL_VIEWS[k]).map((i) => i.ref);
  assert.deepEqual(ids('all'), ['week:2:unlock', 'slot:7', 'demo']);
  assert.deepEqual(ids('cohort'), ['week:2:unlock']);
  assert.deepEqual(ids('client'), ['slot:7']);
  assert.deepEqual(ids('demo_day'), ['demo']);
  const src = read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx');
  assert.match(src, /downloadIcs\(calendarIcs\(shown\)/, 'the export takes the narrowed rows');
  assert.match(src, /\{shown\.map\(\(it\) =>/, 'the list draws the narrowed rows');
});

test('D393: the export is a real calendar, and a Lab date is a point in time, not a meeting', () => {
  const ics = calendarIcs(ITEMS);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/Axal\/\/Cohort Calendar\/\/EN/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  const opens = ics.slice(ics.indexOf('UID:week:2:unlock'), ics.indexOf('END:VEVENT'));
  assert.match(opens, /DTSTART:20260928T090000Z/);
  assert.doesNotMatch(opens, /DTEND/, 'no end is invented for a week opening');
  assert.match(ics, /DTEND:20260929T150000Z/, 'a session keeps its real end');
  assert.match(ics, /SUMMARY:Meridian\\, client session/, 'commas are escaped');
  assert.ok(ics.endsWith('END:VCALENDAR'));
});

test('D393: an event whose start does not parse is skipped, and Sessions uses the same builder', () => {
  const ics = buildIcs({ prodId: 'x', events: [{ uid: 'a', start: 'not a date', summary: 'x' }] });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
  assert.match(read('frontend/src/pages/advisor/practice/SessionsZone.jsx'), /downloadIcs\(buildIcs\(/);
});
