/**
 * D393 — Cohorts alignment: the five archetypes are the canvas's own, Founders
 * reads the Lab's week record, and Calendar gets the canvas's four chips and a
 * client-side .ics export.
 *
 * RE-AIMED IN D4813 (#4813). D393's founder week lanes are gone: Cohorts v2's
 * board C2 groups founders by state, and the four-week view is the Overview's
 * progress grid. The invariants the lane tests pinned are kept against the new
 * model — the batch's CURRENT week is read, nothing required is not 0%, a
 * founder with no row has no progress, and no windows is never "Week 1".
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
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { bucketsFor } from '../src/workspaces/shellConfig.js';
import { FounderCard } from '../src/pages/advisor/cohorts/FoundersZone.jsx';
import { founderRows, filterFounders } from '../src/pages/advisor/cohorts/cohortModel.js';
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

test('D393/D4813: every founder is read at the batch\'s current week, with that week\'s deliverables', () => {
  const rows = founderRows(ROSTER, WEEKS);
  const by = Object.fromEntries(rows.map((c) => [c.user_id, c]));
  assert.deepEqual([by[1].week, by[1].done, by[1].required, by[1].pct, by[1].state], [2, 1, 4, 25, 'at_risk'],
    'week 2 is read, not week 1');
  assert.equal(by[2].state, 'on_track');
  assert.equal(by[2].pct, 100);
  assert.equal(by[3].pct, null, 'nothing required is not 0%');
  assert.equal(by[3].state, 'not_assessed');
  assert.equal(by[4].pct, null, 'a founder with no status row has no progress, not 0%');
  assert.equal(by[4].done, null);
  assert.equal(by[4].state, 'not_assessed');
  assert.deepEqual(filterFounders(rows, { state: 'attention' }).map((c) => c.user_id), [1]);
});

test('D393/D4813: no windows, or no week open yet, means no week — never "Week 1" by default', () => {
  const none = founderRows(ROSTER, { ...WEEKS, windows_recorded: false, weeks: [] });
  assert.ok(none.every((r) => r.week == null && r.state === 'not_assessed'));
  assert.match(none[0].reason, /No week windows are recorded/);
  const early = founderRows(ROSTER, { ...WEEKS, current_week: null });
  assert.ok(early.every((r) => r.week == null));
  assert.match(early[0].reason, /No week of this cohort has opened yet/);
  assert.equal(early.length, 4, 'the roster still reads');
});

test('D393/D4813: a card shows name, state and progress, and no company', () => {
  const [amara, , nadia, noRow] = founderRows(ROSTER, WEEKS);
  const card = (row) => renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(FounderCard, { row, guidanceHref: '/cohorts/guidance?cohort=1' }))));
  const a = card(amara);
  assert.match(a, /Amara Osei/);
  assert.match(a, /25%/);
  assert.match(a, /At risk/);
  assert.match(a, /1 of 4 week-2 deliverables/);
  assert.doesNotMatch(a, /Company/i);
  const n = card(nadia);
  assert.match(n, /No deliverable is required in week 2/);
  assert.match(n, /Not assessed/);
  assert.doesNotMatch(n, /0%/);
  const r = card(noRow);
  assert.match(r, /Not assessed/);
  assert.doesNotMatch(r, /\b0%/);
});

test('D393/D4813: the page reads the shared week record and narrows by state', () => {
  const src = read('frontend/src/pages/advisor/cohorts/FoundersZone.jsx');
  assert.match(src, /const weeks = ws\.weeks;/, 'Founders reads the workspace’s one week record');
  assert.match(read('frontend/src/pages/advisor/cohorts/CohortWorkspace.jsx'), /api\.listMyAdvisorCohortWeeks\(cycleId\)/);
  assert.match(src, /filterFounders\(rows, \{ q, state, sort, founder: only \}\)/, 'search, status and sort narrow the rows');
  assert.match(src, /BOARD_COLUMNS\.map/, 'the board is the state columns');
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
  // D4813 p3: the export takes the rows of the view on screen, with the cohort so each UID is scoped to it.
  assert.match(src, /downloadIcs\(calendarIcs\(shown, ws\.cycleId\)/, 'the export takes the narrowed rows');
  assert.match(src, /const visible = filterByTypes\(all, types\)/, 'the views draw the narrowed rows');
});

test('D393: the export is a real calendar, and a Lab date is a point in time, not a meeting', () => {
  const ics = calendarIcs(ITEMS, 12);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/Axal\/\/Cohort Calendar\/\/EN/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  const opens = ics.slice(ics.indexOf('UID:cohort-12-week-2-unlock'), ics.indexOf('END:VEVENT'));
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
