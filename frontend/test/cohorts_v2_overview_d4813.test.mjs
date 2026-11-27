/**
 * D4813 (#4813, package 1) — Cohorts v2: one selected cohort, the Overview
 * command centre, and founder triage.
 *
 * What these pin, each a decision that could quietly go the other way:
 *   · the `?cohort=` selection is validated, and a bad value falls back VISIBLY;
 *   · a response for the cohort the advisor just left never replaces the
 *     current one's content (reverse-order responses);
 *   · a failed or grace founder needs attention whatever their percentage, and
 *     progress that cannot be read is Not assessed, never 0%;
 *   · every attention item names who, why, when and one action, and its link
 *     keeps the cohort;
 *   · unknown is never zero and a capped list is never a total;
 *   · the Super Admin preview reads nothing and shows no founder;
 *   · `/cohorts` is the Overview, with six section tabs and no archetype labels.
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
import {
  attentionItems, createRequestGate, filterFounders, founderRows, founderState, guardedRead,
  guidanceActivity, parseCohortParam, progressGrid, resolveCohort, summaryFigures, upcomingDays,
  weekOfLabel, withCohort, cohortRange,
} from '../src/pages/advisor/cohorts/cohortModel.js';
import { CohortSectionNav, CohortWorkspaceContext, COHORT_SECTIONS, StatusBadge } from '../src/pages/advisor/cohorts/CohortWorkspace.jsx';
import OverviewZone, { AttentionList, ProgressTable } from '../src/pages/advisor/cohorts/OverviewZone.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const H = 3_600_000;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const at = (hours) => new Date(NOW + hours * H).toISOString();

const ASSIGNED = [
  { cohort_cycle_id: 12, cohort: { year: 2026, month: 11, start_at: '2026-11-01T04:00:00Z', end_at: '2026-11-29T05:00:00Z', status: 'active' } },
  { cohort_cycle_id: 9, cohort: { year: 2026, month: 10, start_at: '2026-10-01T04:00:00Z', end_at: '2026-10-29T04:00:00Z', status: 'completed' } },
];

// ── The selection ─────────────────────────────────────────────────────────

test('D4813: ?cohort= is a positive integer or nothing', () => {
  assert.equal(parseCohortParam('12'), 12);
  for (const bad of ['0', '-1', '1.5', '12abc', ' ', '', null, undefined, '1e3', '00012']) {
    assert.equal(parseCohortParam(bad), null, `${bad} is not a cycle id`);
  }
});

test('D4813: the URL wins when it names a cohort the advisor holds', () => {
  assert.deepEqual(resolveCohort({ items: ASSIGNED, raw: '9', remembered: '12' }), { cycleId: 9, source: 'url', fallback: null });
});

test('D4813: an invalid or unassigned value falls back, and says why', () => {
  const invalid = resolveCohort({ items: ASSIGNED, raw: 'spring', remembered: null });
  assert.equal(invalid.cycleId, 12, 'the newest assignment');
  assert.deepEqual(invalid.fallback, { reason: 'invalid', raw: 'spring' });
  const foreign = resolveCohort({ items: ASSIGNED, raw: '77', remembered: '9' });
  assert.equal(foreign.cycleId, 9, 'the cohort this browser chose last, when it is still assigned');
  assert.deepEqual(foreign.fallback, { reason: 'unassigned', raw: '77' });
});

test('D4813: with no value, the remembered cohort, then the newest; with none assigned, nothing', () => {
  assert.equal(resolveCohort({ items: ASSIGNED, raw: null, remembered: '9' }).cycleId, 9);
  assert.equal(resolveCohort({ items: ASSIGNED, raw: null, remembered: '77' }).cycleId, 12, 'a remembered cohort that is no longer assigned is ignored');
  assert.equal(resolveCohort({ items: ASSIGNED, raw: null, remembered: null }).fallback, null, 'no value is not a fallback');
  assert.deepEqual(resolveCohort({ items: [], raw: '12', remembered: '12' }).cycleId, null);
});

test('D4813: links keep the cohort', () => {
  assert.equal(withCohort('/cohorts/founders', 12), '/cohorts/founders?cohort=12');
  assert.equal(withCohort('/cohorts/founders', 12, { founder: 5 }), '/cohorts/founders?cohort=12&founder=5');
  assert.equal(withCohort('/cohorts', null), '/cohorts');
});

// ── Stale responses ───────────────────────────────────────────────────────

function deferred() {
  let res; let rej;
  const promise = new Promise((a, b) => { res = a; rej = b; });
  return { promise, resolve: res, reject: rej };
}

test('D4813: a late answer for the previous cohort never replaces the current one', async () => {
  const gate = createRequestGate();
  const states = [];
  const onState = (s) => states.push(s);
  const october = deferred();
  const november = deferred();
  const first = guardedRead({ gate, fetch: () => october.promise, onState });
  const second = guardedRead({ gate, fetch: () => november.promise, onState });
  november.resolve({ cohort: 'November' });
  assert.equal(await second, true);
  october.resolve({ cohort: 'October' });
  assert.equal(await first, false, 'the older read reports that it did not land');
  const landed = states.filter((s) => s.data);
  assert.deepEqual(landed.map((s) => s.data.cohort), ['November']);
  assert.deepEqual(states.at(-1), { loading: false, error: '', data: { cohort: 'November' } });
});

test('D4813: a late failure for the previous cohort is ignored too, and loading clears old data first', async () => {
  const gate = createRequestGate();
  const states = [];
  const old = deferred();
  const p = guardedRead({ gate, fetch: () => old.promise, onState: (s) => states.push(s) });
  assert.deepEqual(states[0], { loading: true, error: '', data: null }, 'the old cohort’s content is cleared before the new one loads');
  gate.invalidate(); // the advisor switched cohort
  old.reject(new Error('boom'));
  assert.equal(await p, false);
  assert.equal(states.length, 1, 'no error was painted for a cohort no longer on screen');
});

test('D4813: a 200 that is a failed Lab read is an error, never an empty week', async () => {
  const gate = createRequestGate();
  let last;
  await guardedRead({ gate, fetch: async () => ({ available: false, detail: 'Lab down' }), accept: (d) => (d.available === false ? d.detail : null), onState: (s) => { last = s; } });
  assert.deepEqual(last, { loading: false, error: 'Lab down', data: null });
});

// ── Founder states ────────────────────────────────────────────────────────

const WINDOWS = [
  { week_number: 1, unlock_at: at(-24 * 9), deadline_at: at(-24 * 2) },
  { week_number: 2, unlock_at: at(-24 * 2), deadline_at: at(36) },
  { week_number: 3, unlock_at: at(24 * 5), deadline_at: at(24 * 12) },
  { week_number: 4, unlock_at: at(24 * 12), deadline_at: at(24 * 19) },
];
const WEEKS = {
  available: true, windows_recorded: true, current_week: 2, weeks: WINDOWS,
  founders: [
    // Failed in week 1 with every deliverable counted — still needs attention.
    { user_id: 1, weeks: { 1: { status: 'failed', deliverables_done: 3, deliverables_required: 3, decided_at: at(-40), decision_reason: 'Late submission' } } },
    // In grace at 100% — still needs attention.
    { user_id: 2, weeks: { 1: { status: 'grace', deliverables_done: 3, deliverables_required: 3, grace_until: at(20) } } },
    // Passed week 1, under half of week 2 — at risk.
    { user_id: 3, weeks: { 1: { status: 'passed', deliverables_done: 3, deliverables_required: 3 }, 2: { status: 'pending', deliverables_done: 1, deliverables_required: 3 } } },
    // Passed week 1, two of three in week 2 with 36h left — at risk (deadline close).
    { user_id: 4, weeks: { 1: { status: 'passed' }, 2: { status: 'pending', deliverables_done: 2, deliverables_required: 3 } } },
    // Everything in.
    { user_id: 5, weeks: { 2: { status: 'pending', deliverables_done: 3, deliverables_required: 3 } } },
    // Unreadable counts.
    { user_id: 6, weeks: { 2: { status: 'pending', deliverables_done: 'n/a', deliverables_required: null } } },
  ],
};
const ROSTER = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ user_id: id, name: `Founder ${id}`, email: `f${id}@example.test` }));

test('D4813: failed and grace need attention whatever the percentage', () => {
  const by = Object.fromEntries(founderRows(ROSTER, WEEKS, NOW).map((r) => [r.user_id, r]));
  assert.equal(by[1].state, 'failed');
  assert.equal(by[1].pct, 100, 'the percentage is kept, and does not rescue the founder');
  assert.equal(by[1].held, true);
  assert.match(by[1].reason, /Week 1 failed: 3 of 3 deliverables — Late submission/);
  assert.equal(by[2].state, 'grace');
  assert.equal(by[2].deadline, at(20), 'grace ends when the Lab says');
  const attention = filterFounders(Object.values(by), { state: 'attention' }).map((r) => r.user_id);
  assert.deepEqual(attention, [1, 2, 3, 4], 'failed, then grace, then at risk');
});

test('D4813: at risk is under half done, or work outstanding close to the deadline', () => {
  const by = Object.fromEntries(founderRows(ROSTER, WEEKS, NOW).map((r) => [r.user_id, r]));
  assert.equal(by[3].state, 'at_risk');
  assert.equal(by[4].state, 'at_risk');
  assert.match(by[4].reason, /2 of 3 week-2 deliverables, 1 day left/);
  assert.equal(by[5].state, 'on_track');
  const later = founderState(WEEKS.founders[3], WEEKS, NOW - 48 * H);
  assert.equal(later.state, 'on_track', 'two of three with three days left is on track');
});

test('D4813: progress that cannot be read is Not assessed, never 0%', () => {
  const by = Object.fromEntries(founderRows(ROSTER, WEEKS, NOW).map((r) => [r.user_id, r]));
  assert.equal(by[6].state, 'not_assessed');
  assert.equal(by[6].pct, null);
  assert.equal(by[7].state, 'not_assessed', 'no Lab row at all');
  assert.equal(by[7].pct, null);
  const noWeeks = founderRows(ROSTER, null, NOW);
  assert.ok(noWeeks.every((r) => r.state === 'not_assessed' && r.pct === null));
  assert.match(noWeeks[0].reason, /not loaded/);
  const failedRead = founderRows(ROSTER, { available: false }, NOW);
  assert.match(failedRead[0].reason, /could not be read/);
});

test('D4813: search, state filter, sort and the one-founder deep link', () => {
  const rows = founderRows(ROSTER, WEEKS, NOW);
  assert.deepEqual(filterFounders(rows, { q: 'f5@' }).map((r) => r.user_id), [5]);
  assert.deepEqual(filterFounders(rows, { state: 'not_assessed' }).map((r) => r.user_id), [6, 7]);
  assert.deepEqual(filterFounders(rows, { founder: 3 }).map((r) => r.user_id), [3]);
  assert.deepEqual(filterFounders(rows, { sort: 'name' }).map((r) => r.user_id), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(filterFounders(rows, { sort: 'progress' })[0].pct, null, 'unknown sorts below every real percentage');
  assert.equal(rows.length, 7, 'filtering does not mutate');
});

// ── The four-week grid and the agenda ─────────────────────────────────────

test('D4813: the progress grid says passed, failed, grace, in progress, not assessed and not open', () => {
  const g = progressGrid(ROSTER, WEEKS, NOW);
  assert.deepEqual(g.columns, [1, 2, 3, 4]);
  const by = Object.fromEntries(g.rows.map((r) => [r.user_id, r.cells]));
  assert.deepEqual(by[1], ['failed', 'not_assessed', 'not_open', 'not_open']);
  assert.deepEqual(by[2], ['grace', 'not_assessed', 'not_open', 'not_open']);
  assert.deepEqual(by[3], ['passed', 'in_progress', 'not_open', 'not_open']);
  assert.deepEqual(by[7], ['not_assessed', 'not_assessed', 'not_open', 'not_open']);
  assert.equal(progressGrid(ROSTER, { ...WEEKS, windows_recorded: false, weeks: [] }, NOW).missing, true);
  const html = renderToStaticMarkup(h(ProgressTable, { grid: g, label: 'November 2026' }));
  assert.match(html, /<caption[^>]*>Week status per founder in November 2026<\/caption>/);
  assert.match(html, /<th scope="row"/);
  assert.match(renderedText(html), /Week 2 · now/);
  assert.match(renderedText(html), /✕\s*Failed/, 'a shape and a word, not colour alone');
});

const GUIDANCE = {
  counts: { open: 1, answered: 1, broadcast: 1 },
  truncated: false,
  items: [
    { uid: 'q1', kind: 'question', asked_by_user_id: 3, body: 'Should the pricing test include annual plans?', answer: null, posted_at: at(-20), retired_at: null, acted_by: [] },
    { uid: 'q2', kind: 'question', asked_by_user_id: 4, body: 'Old', answer: 'Yes', answered_at: at(-5), posted_at: at(-30), retired_at: null, acted_by: [] },
    { uid: 'b1', kind: 'broadcast', asked_by_user_id: null, body: 'Week 2: talk to customers', answer: null, posted_at: at(-50), retired_at: null, acted_by: [{ user_id: 3, name: 'Founder 3', acted_at: at(-10) }] },
  ],
};
const CALENDAR = {
  windows_recorded: true, sessions_truncated: false,
  items: [
    { ref: 'slot:7', kind: 'client', title: 'Session with Founder 4', starts_at: at(20), ends_at: at(21) },
    { ref: 'week:2:deadline', kind: 'cohort', title: 'Week 2 deliverables due', starts_at: at(36) },
    { ref: 'week:3:unlock', kind: 'cohort', title: 'Week 3 opens', starts_at: at(24 * 5) },
    { ref: 'slot:9', kind: 'client', title: 'Session with Founder 5', starts_at: at(24 * 6) },
    { ref: 'slot:10', kind: 'client', title: 'Session far away', starts_at: at(24 * 10) },
  ],
};

test('D4813: every attention item has who, why, when and one action that keeps the cohort', () => {
  const rows = founderRows(ROSTER, WEEKS, NOW);
  const { items, unknown } = attentionItems({ cycleId: 12, cohortName: 'November 2026', rows, guidance: GUIDANCE, calendar: CALENDAR, now: NOW });
  assert.deepEqual(unknown, []);
  assert.deepEqual(items.map((i) => i.key), [
    'founder:1', 'founder:2', 'founder:3', 'founder:4', 'question:q1', 'session:slot:7', 'deadline:week:2:deadline',
  ]);
  for (const i of items) {
    assert.ok(i.who && i.reason && i.date && i.action.label && i.action.to, `${i.key} is complete`);
    assert.match(i.action.to, /[?&]cohort=12(&|$)/, `${i.key} keeps the cohort`);
  }
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by['founder:1'].action.to, '/cohorts/founders?cohort=12&founder=1');
  assert.equal(by['question:q1'].who, 'Question from Founder 3');
  assert.equal(by['question:q1'].action.label, 'Answer');
  assert.equal(by['deadline:week:2:deadline'].who, 'November 2026');
  assert.ok(!items.some((i) => i.key === 'question:q2'), 'an answered question needs nothing');
});

test('D4813: a failed read makes the attention list partial, and says which part', () => {
  const r = attentionItems({ cycleId: 12, rows: null, guidance: null, calendar: CALENDAR, now: NOW });
  assert.deepEqual(r.unknown, ['founders', 'guidance']);
  const html = renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(AttentionList, r))));
  assert.match(html, /Partial: founders, guidance could not be read/);
  assert.match(html, /Open calendar/);
});

test('D4813: the summary figures: unknown is never zero, and a capped list is never a total', () => {
  const rows = founderRows(ROSTER, WEEKS, NOW);
  const f = summaryFigures({ roster: ROSTER, rosterTruncated: false, rows, weeksReadable: true, guidance: GUIDANCE, calendar: CALENDAR, now: NOW });
  assert.deepEqual(f.founders, { value: 7, capped: false });
  assert.deepEqual(f.attention, { value: 4, capped: false });
  assert.deepEqual(f.questions, { value: 1, capped: false });
  assert.deepEqual(f.sessions, { value: 2, capped: false }, 'next 7 days only');
  const unknown = summaryFigures({ roster: null, rows: null, weeksReadable: false, guidance: null, calendar: null, now: NOW });
  for (const k of ['founders', 'attention', 'questions', 'sessions']) assert.equal(unknown[k].value, null, `${k} is unknown, not 0`);
  const notJudged = summaryFigures({ roster: ROSTER, rows, weeksReadable: false, guidance: GUIDANCE, calendar: CALENDAR, now: NOW });
  assert.equal(notJudged.attention.value, null, 'without the week record nobody is judged, so the count is unknown');
  const capped = summaryFigures({ roster: ROSTER, rosterTruncated: true, rows, weeksReadable: true, guidance: { ...GUIDANCE, truncated: true }, calendar: { ...CALENDAR, sessions_truncated: true }, now: NOW });
  assert.equal(capped.founders.capped, true);
  assert.equal(capped.questions.capped, true);
  assert.equal(capped.sessions.capped, true);
});

test('D4813: the 7-day agenda and the recorded activity', () => {
  const days = upcomingDays(CALENDAR, NOW, 7);
  assert.deepEqual(days.flatMap((d) => d.items.map((i) => i.ref)), ['slot:7', 'week:2:deadline', 'week:3:unlock', 'slot:9']);
  assert.equal(upcomingDays(null, NOW), null, 'no calendar is unknown, not an empty week');
  const act = guidanceActivity(GUIDANCE);
  assert.deepEqual(act.map((a) => a.text), [
    'You answered “Old”',
    'Founder 3 acted on “Week 2: talk to customers”',
    'You posted “Week 2: talk to customers”',
  ]);
  assert.equal(guidanceActivity(null), null);
});

test('D4813: the header names the dates and the week', () => {
  assert.equal(cohortRange(ASSIGNED[0].cohort), 'Nov 1 – Nov 28');
  assert.equal(weekOfLabel(WEEKS), 'Week 2 of 4');
  assert.equal(weekOfLabel({ ...WEEKS, current_week: null }), 'Not started · 4 weeks');
  assert.equal(weekOfLabel({ ...WEEKS, windows_recorded: false }), null, 'no windows, no week — not "Week 1"');
  assert.equal(weekOfLabel({ available: false }), null);
});

// ── The rendered workspace ────────────────────────────────────────────────

function ctx(over = {}) {
  return {
    preview: false,
    assignments: { loading: false, error: '', items: ASSIGNED },
    reloadAssignments() {}, cycleId: 12, current: ASSIGNED[0], label: 'November 2026', notice: null,
    select() {}, version: 0, refresh() {}, lastUpdated: null, markUpdated() {},
    weeks: { loading: false, error: '', data: WEEKS }, reloadWeeks() {},
    href: (path, extra) => withCohort(path, 12, extra),
    ...over,
  };
}
const renderNav = (value, path = '/cohorts') => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [path] }, h(CohortWorkspaceContext.Provider, { value }, h(CohortSectionNav))));

test('D4813: six section tabs, Overview first, each carrying the cohort, the current one marked', () => {
  assert.deepEqual(COHORT_SECTIONS.map((s) => s.label), ['Overview', 'Founders', 'Guidance', 'This week', 'Calendar', 'Outcomes']);
  const html = renderNav(ctx(), '/cohorts/founders?cohort=12');
  for (const s of COHORT_SECTIONS) assert.ok(html.includes(`href="${s.path}?cohort=12"`), `${s.label} keeps the cohort`);
  assert.match(html, /<a[^>]*aria-current="page"[^>]*data-testid="cohort-tab-founders"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  const text = renderedText(html);
  assert.match(text, /November 2026/);
  assert.match(text, /Nov 1 – Nov 28/);
  assert.match(text, /Week 2 of 4/);
  assert.match(text, /Refresh/);
  assert.match(html, /<label[^>]*>.*Cohort.*<select/s, 'the selector is labelled');
  assert.match(renderNav(ctx(), '/cohorts'), /aria-current="page"[^>]*data-testid="cohort-tab-overview"/);
});

test('D4813: a fallback is stated; loading names the cohort; an unrecorded week is not "Week 1"', () => {
  const fell = renderedText(renderNav(ctx({ notice: { reason: 'unassigned', raw: '77', shown: 'November 2026' } })));
  assert.match(fell, /You are not assigned to cohort 77, so November 2026 is shown instead/);
  const loading = renderedText(renderNav(ctx({ weeks: { loading: true, error: '', data: null } })));
  assert.match(loading, /Loading November 2026…/);
  const noWeek = renderedText(renderNav(ctx({ weeks: { loading: false, error: '', data: { ...WEEKS, windows_recorded: false } } })));
  assert.match(noWeek, /Week not recorded/);
  assert.doesNotMatch(noWeek, /Week 1/);
});

test('D4813: the Super Admin preview shows the structure and no founder data', () => {
  const value = ctx({ preview: true, assignments: { loading: false, error: '', items: [] }, cycleId: null, current: null, label: null, weeks: { loading: false, error: '', data: null } });
  const nav = renderedText(renderNav(value));
  assert.match(nav, /No cohort · preview/);
  assert.match(nav, /Not assigned/);
  assert.doesNotMatch(nav, /Refresh|Updated/);
  const body = renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(CohortWorkspaceContext.Provider, { value }, h(OverviewZone)))));
  assert.match(body, /Needs your attention/);
  assert.match(body, /Appears here for an assigned advisor/);
  assert.match(body, /No founders in preview/);
  assert.match(body, /Missing data/);
  assert.match(body, /No cohort selected/);
  assert.doesNotMatch(body, /Founder \d/);
  const provider = codeOnly(read('frontend/src/pages/advisor/cohorts/CohortWorkspace.jsx'));
  assert.match(provider, /if \(preview\) return undefined;/, 'preview reads nothing');
  const routes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(routes, /<CohortWorkspaceProvider preview=\{preview\}>/);
  assert.match(routes, /\{preview && <AdvisorPreviewNotice \/>\}/, 'the notice with Impersonate stays');
});

test('D4813: status is a word and a shape', () => {
  const html = renderedText(renderToStaticMarkup(h(StatusBadge, { state: 'grace' })));
  assert.match(html, /◐\s*Grace/);
});

// ── Structure ─────────────────────────────────────────────────────────────

test('D4813: /cohorts is the Overview; the directory cards and archetype labels are gone from it', () => {
  const routes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(routes, /if \(isRoot && prefix === '\/cohorts'\) \{\s*return <Suspense fallback=\{<Loading \/>\}><CohortsOverviewZone \/><\/Suspense>;/);
  assert.match(routes, /sectionNav=\{cohorts \? <CohortSectionNav \/> : undefined\}/);
  assert.match(routes, /title=\{cohorts \? 'Cohorts'/);
  assert.match(routes, /'\/cohorts': 'Guide founders from milestones to outcomes\.'/);
  const shell = codeOnly(read('frontend/src/workspaces/WorkspaceShell.jsx'));
  assert.match(shell, /const arch = ownNav \? null : zone\?\.archetype;/, 'a page with its own section nav draws no archetype badge');
  assert.match(shell, /\{ownNav \? sectionNav : /);
  for (const f of ['FoundersZone', 'GuidanceZone', 'ThisWeekZone', 'CalendarZone', 'OverviewZone']) {
    const src = codeOnly(read(`frontend/src/pages/advisor/cohorts/${f}.jsx`));
    assert.doesNotMatch(src, /listMyAdvisorCohorts\(\)/, `${f} must not read assignments itself — the workspace selects the cohort`);
    assert.doesNotMatch(src, /BatchPicker/, `${f} must not draw its own picker`);
  }
});

test('D4813: Recent activity is only what the guidance store records', () => {
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/OverviewZone.jsx'));
  assert.match(src, /guidanceActivity\(guidance\.data\)/);
  assert.match(src, /Founder submissions, sessions held and Lab decisions are not recorded as activity yet/);
});
