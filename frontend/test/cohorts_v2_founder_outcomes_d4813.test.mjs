/**
 * D4813 (#4813, package 4) — the founder detail (C4), cohort Outcomes (C10),
 * the tablet layout (C17) and Eadwyn's cohort prompts.
 *
 * What these pin, each a decision that could quietly go the other way:
 *   · the detail has six labelled sections, and each week's LIVE status and
 *     the Lab's RECORDED decision are two separate fields; a deadline snapshot
 *     reads Not recorded;
 *   · a founder the Worker refuses (404) is a boundary state that names
 *     nothing about them, not a failed read;
 *   · a late detail answer for the cohort just left is dropped, and switching
 *     cohort closes the detail;
 *   · every cohort figure has a definition, a source and a reporting time;
 *     unknown is Not recorded, a capped read is "n+";
 *   · the graduate showcase is labelled a selection and never a total, and
 *     the programme is its own scope;
 *   · at 834px the table drops two columns and the panels reflow; at 390px
 *     targets are 44px and the detail is full screen;
 *   · the five cohort prompts reach the rail and only fill the composer.
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
import { COHORT_PROMPTS, createRequestGate, guardedRead, withCohort } from '../src/pages/advisor/cohorts/cohortModel.js';
import { CohortWorkspaceContext } from '../src/pages/advisor/cohorts/CohortWorkspace.jsx';
import FounderDetail, { FounderDetailBody, FounderNotVisible } from '../src/pages/advisor/cohorts/FounderDetail.jsx';
import { FounderCard, FounderTable } from '../src/pages/advisor/cohorts/FoundersZone.jsx';
import { CohortOutcomes, ProgrammeOutcomes } from '../src/pages/advisor/cohorts/OutcomesZone.jsx';
import {
  DETAIL_SECTIONS, NOT_VISIBLE, fetchFounderDetail, milestoneRows, parseDetailParam,
} from '../src/pages/advisor/cohorts/founderDetailModel.js';
import { cohortFigures, completionTable, formatCount, programmeView } from '../src/pages/advisor/cohorts/outcomesModel.js';
import { panelChips, promptOptions } from '../src/ui/askPanelModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const H = 3_600_000;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const at = (hours) => new Date(NOW + hours * H).toISOString();

const DETAIL = {
  cohort_cycle_id: 12,
  reported_at: at(0),
  founder: { user_id: 21, name: 'Fin Founder', email: 'fin@example.test' },
  milestones: {
    available: true, windows_recorded: true, current_week: 2, snapshots_recorded: false,
    weeks: [
      { week_number: 1, unlock_at: at(-24 * 9), deadline_at: at(-24 * 2),
        live: { status: 'failed', deliverables_done: 1, deliverables_required: 3 },
        recorded: { decided_at: at(-40), decision_reason: 'One of three deliverables at the deadline', grace_until: null, grace_reason: null },
        snapshot_recorded: false },
      { week_number: 2, unlock_at: at(-24 * 2), deadline_at: at(36),
        live: { status: 'pending', deliverables_done: 1, deliverables_required: 3 }, recorded: null, snapshot_recorded: false },
      { week_number: 3, unlock_at: at(24 * 5), deadline_at: at(24 * 12), live: null, recorded: null, snapshot_recorded: false },
    ],
  },
  evidence: { items_recorded: false },
  guidance: { available: true, truncated: false, items: [
    { uid: 'g1', kind: 'broadcast', title: 'Week 1 interviews', body: 'Talk to five customers.', week_number: 1, posted_at: at(-100), retired_at: null, answer: null, acted_at: at(-90) },
    { uid: 'g2', kind: 'question', title: null, body: 'Annual plans?', week_number: 1, posted_at: at(-30), retired_at: null, answer: null, acted_at: null },
  ] },
  sessions: { available: true, profile: true, truncated: false, items: [
    { uid: 'b1', status: 'completed', topic: 'Interview review', starts_at: at(-48), ends_at: at(-47) },
    { uid: 'b2', status: 'confirmed', topic: 'Pricing', starts_at: at(48), ends_at: at(49) },
  ] },
  activity: { complete: true, truncated: false, items: [
    { kind: 'session_booked', at: at(-5), ref: 'booking:b2' },
    { kind: 'question_asked', at: at(-30), ref: 'guidance:g2' },
  ] },
};

const ASSIGNED = [{ cohort_cycle_id: 12, cohort: { year: 2026, month: 11, start_at: at(-24 * 9), end_at: at(24 * 19), status: 'active' } }];
function ctx(over = {}) {
  return {
    preview: false, assignments: { loading: false, error: '', items: ASSIGNED }, reloadAssignments() {},
    cycleId: 12, current: ASSIGNED[0], label: 'November 2026', notice: null, select() {}, version: 0, refresh() {},
    lastUpdated: null, markUpdated() {}, weeks: { loading: false, error: '', data: null }, reloadWeeks() {},
    href: (path, extra) => withCohort(path, 12, extra), ...over,
  };
}
const render = (el, value = ctx()) => renderToStaticMarkup(h(MemoryRouter, null, h(CohortWorkspaceContext.Provider, { value }, el)));

// ── Founder detail (C4) ───────────────────────────────────────────────────

test('D4813: the detail has six labelled sections, each with its own heading', () => {
  assert.deepEqual(DETAIL_SECTIONS.map(([, l]) => l), ['Overview', 'Milestones', 'Evidence', 'Guidance', 'Sessions', 'Activity']);
  const html = render(h(FounderDetailBody, { data: DETAIL, label: 'November 2026', guidanceHref: '/cohorts/guidance?cohort=12', now: NOW }));
  for (const [id, label] of DETAIL_SECTIONS) {
    assert.match(html, new RegExp(`<section id="fd-${id}" aria-labelledby="fd-${id}-h"`), `${label} is a labelled region`);
    assert.match(html, new RegExp(`<h3 id="fd-${id}-h"[^>]*>${label}</h3>`), `${label} has a heading`);
  }
  assert.match(html, /<nav aria-label="Founder sections"/);
  const text = renderedText(html);
  assert.match(text, /Held at week 1/);
  assert.match(text, /1 waiting for your answer/);
  assert.match(text, /1 upcoming with you/);
});

test('D4813: live status and the Lab’s recorded decision are two separate fields', () => {
  const rows = milestoneRows(DETAIL.milestones, NOW);
  assert.equal(rows[0].live.label, 'Failed');
  assert.match(rows[0].recorded, /^Decided .* by the Lab · One of three deliverables at the deadline$/);
  assert.equal(rows[1].live.label, 'In progress');
  assert.equal(rows[1].recorded, 'No decision recorded yet', 'an undecided week is not given a decision');
  assert.equal(rows[2].live.label, 'Not open', 'a week that has not opened is not "not assessed" or zero');
  for (const r of rows) assert.equal(r.snapshot, 'Not recorded', 'a deadline snapshot is not stored');
  const html = render(h(FounderDetailBody, { data: DETAIL, label: 'November 2026', now: NOW }));
  const week1 = html.slice(html.indexOf('data-week="1"'), html.indexOf('data-week="2"'));
  assert.match(week1, /data-field="live"[^>]*>.*Failed.*1 of 3 deliverables/s);
  assert.match(week1, /data-field="recorded"[^>]*>Decided/);
  assert.match(week1, /data-field="snapshot"[^>]*>Not recorded/);
  assert.match(renderedText(html), /Live status/);
  assert.match(renderedText(html), /Lab’s recorded decision/);
});

test('D4813: evidence is counts only, and says the Lab stores no items', () => {
  const text = renderedText(render(h(FounderDetailBody, { data: DETAIL, label: 'November 2026', now: NOW })));
  assert.match(text, /Week 1 · 1 of 3 deliverables/);
  assert.match(text, /The Lab stores how many deliverables are in, not the submitted work/);
  assert.match(text, /Recorded actions only/);
  assert.match(text, /Asked you a question/);
  assert.match(text, /Booked a session with you/);
  assert.match(text, /Acknowledgements are not recorded yet/);
});

test('D4813: a refused founder is a boundary that names nothing about them', async () => {
  const refusal = Object.assign(new Error('No founder with that id in this cohort is visible to you.'), { status: 404 });
  assert.deepEqual(await fetchFounderDetail(async () => { throw refusal; }, 12, 21), { not_visible: true });
  const boom = Object.assign(new Error('Server error'), { status: 500 });
  await assert.rejects(fetchFounderDetail(async () => { throw boom; }, 12, 21), /Server error/, 'a failed read is still an error to retry');
  const text = renderedText(renderToStaticMarkup(h(FounderNotVisible)));
  assert.equal(text, NOT_VISIBLE);
  assert.match(text, /not in this cohort, or they stopped sharing their progress with you/);
  assert.equal(parseDetailParam('21'), 21);
  for (const bad of ['0', '-1', 'abc', '1.5', '', null]) assert.equal(parseDetailParam(bad), null);
});

test('D4813: the detail is a dialog sheet that names the cohort and traps and returns focus', () => {
  const html = render(h(FounderDetail, { userId: 21, name: 'Fin Founder', onClose() {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+-title"/);
  assert.match(renderedText(html), /Founder · November 2026/);
  assert.match(renderedText(html), /Loading this founder for November 2026…/, 'a loading line names the cohort');
  assert.match(html, /data-phone="full"/, 'full screen on a phone');
  assert.match(html, /data-width="640"/);
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/FounderDetail.jsx'));
  assert.match(src, /import \{ Sheet \} from '\.\.\/\.\.\/\.\.\/ui';/, 'the repository’s one sheet: focus in, Tab kept inside, focus back to the opener');
});

test('D4813: a late detail answer for the cohort just left is dropped, and switching closes it', async () => {
  const gate = createRequestGate();
  const states = [];
  let releaseOld;
  const old = guardedRead({ gate, fetch: () => fetchFounderDetail(() => new Promise((r) => { releaseOld = r; }), 9, 21), onState: (s) => states.push(s) });
  const cur = guardedRead({ gate, fetch: () => fetchFounderDetail(async () => ({ founder: { name: 'November Fin' } }), 12, 21), onState: (s) => states.push(s) });
  assert.equal(await cur, true);
  releaseOld({ founder: { name: 'October Fin' } });
  assert.equal(await old, false);
  assert.deepEqual(states.filter((s) => s.data).map((s) => s.data.founder.name), ['November Fin']);
  const provider = codeOnly(read('frontend/src/pages/advisor/cohorts/CohortWorkspace.jsx'));
  assert.match(provider, /next\.delete\('founder'\);\s*next\.delete\('detail'\);/, 'choosing a cohort closes an open founder');
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/FounderDetail.jsx'));
  assert.match(src, /if \(state\.for !== `\$\{cycleId\}:\$\{userId\}`\) return \{ loading: true/, 'the previous cohort’s founder is never shown while the new read runs');
});

test('D4813: Founders offers Open founder beside Write guidance', () => {
  const row = { user_id: 21, name: 'Fin Founder', email: 'fin@example.test', state: 'failed', week: 1, held: true, pct: 33, reason: 'Week 1 failed' };
  let opened = null;
  const card = render(h(FounderCard, { row, guidanceHref: '/cohorts/guidance?cohort=12', onOpen: (id) => { opened = id; } }));
  assert.match(card, /<button type="button" data-testid="open-founder" class="[^"]*min-h-\[44px\][^"]*">\s*Open founder/);
  assert.match(renderedText(card), /Write guidance/);
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/FoundersZone.jsx'));
  assert.match(src, /next\.set\(DETAIL_PARAM, String\(id\)\)/, 'Open founder writes ?detail=');
  assert.match(src, /<FounderDetail userId=\{detailId\}/);
  assert.equal(opened, null);
});

// ── Outcomes (C10) ────────────────────────────────────────────────────────

const OUTCOMES = {
  scope: 'cohort', reported_at: at(0),
  metrics: {
    participants: { value: 6, available: true, truncated: false, visible: { value: 5, available: true, truncated: false }, definition: 'Founders the Lab has a week record for.', source: 'company_week_status' },
    week_completion: { available: true, truncated: false, definition: 'A week passes when the Lab records it passed.', source: 'company_week_status',
      weeks: [
        { week_number: 1, passed: 2, grace: 1, failed: 1, pending: 0, not_assessed: 1, founders: 5 },
        { week_number: 2, passed: 0, grace: 0, failed: 0, pending: 3, not_assessed: 2, founders: 5 },
      ] },
    graduates: { value: null, available: false, truncated: false, definition: 'D4659 graduates.', source: 'spinout_lab_graduates' },
    sessions: { value: 2000, available: true, truncated: true, booked: { value: 1, available: true, truncated: false }, definition: 'Your completed sessions.', source: 'advisor_bookings' },
  },
};

test('D4813: unknown is Not recorded, a capped count is n+, and zero is only zero', () => {
  assert.equal(formatCount({ value: null, available: false }), 'Not recorded');
  assert.equal(formatCount(undefined), 'Not recorded');
  assert.equal(formatCount({ value: 2000, available: true, truncated: true }), '2000+');
  assert.equal(formatCount({ value: 0, available: true, truncated: false }), '0');
  const figs = cohortFigures(OUTCOMES, { currentWeek: 1 });
  const by = Object.fromEntries(figs.map((f) => [f.key, f]));
  assert.equal(by.graduates.value, 'Not recorded');
  assert.equal(by.sessions.value, '2000+');
  assert.equal(by.participants.value, '6');
  assert.equal(by.participants.sub, '5 visible to you');
  assert.equal(by.week_completion.label, 'Week 1 completion');
  assert.equal(by.week_completion.value, '2 of 5');
  assert.equal(completionTable({ metrics: { week_completion: { available: false } } }), null, 'a failed read is not a table of zeros');
});

test('D4813: every cohort figure has a definition, a source and a reporting time', () => {
  const html = render(h(CohortOutcomes, { data: OUTCOMES, label: 'November 2026', currentWeek: 1 }));
  for (const key of ['participants', 'week_completion', 'graduates', 'sessions']) {
    const card = html.slice(html.indexOf(`data-metric="${key}"`));
    const text = renderedText(card.slice(0, card.indexOf('</dl>')));
    assert.match(text, /Source: /, `${key} names its source`);
    assert.match(text, /Reported .*\(America\/New_York\)/, `${key} says when it was reported`);
  }
  const text = renderedText(html);
  assert.match(text, /Outcomes for November 2026/);
  assert.match(text, /Not recorded/);
  assert.match(text, /2000\+/);
  assert.match(html, /<caption[^>]*>Milestone completion by week, November 2026<\/caption>/);
  assert.match(html, /<th scope="row"[^>]*>Week 1<\/th>/);
  assert.match(text, /Programme outcomes are company-level and anonymous across every cohort\. They are a separate scope/);
});

test('D4813: the graduate showcase is a labelled selection, never a total; the programme is its own scope', () => {
  const graduates = [{ name: 'Ferrous Labs', sector: 'Climate', cohort: 'Oct 2026', raised: 1200000 }, { name: 'Brightline', raised: null }];
  const v = programmeView({ stats: { companies: 31, total_raised: 5_000_000 }, cohort: [], graduates });
  assert.match(v.graduatesHeading, /a selection, not a total/);
  assert.equal(v.graduatesNote(2), 'Showing 2 graduate companies the public page features. The programme total is 31.');
  assert.equal(programmeView({ stats: null, cohort: [], graduates }).totals[0].value, 'Not recorded', 'no stats: the total is not the list length');
  const text = renderedText(render(h(ProgrammeOutcomes, { stats: { companies: 31, total_raised: 5_000_000 }, cohort: [{ name: 'A', week: 2, status: 'active' }], graduates })));
  assert.match(text, /Programme outcomes · every cohort/);
  assert.match(text, /Graduate showcase · a selection, not a total/);
  assert.match(text, /On the public tracker · a selection, not a total/);
  assert.match(text, /Graduate companies, all cohorts\s*31/);
  assert.doesNotMatch(text, /Graduated — 2/, 'the list length is never a heading count');
  assert.match(text, /This is the program, not your batch/);
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/OutcomesZone.jsx'));
  assert.match(src, /role="radiogroup" aria-label="Outcome scope"/);
  assert.match(src, /scope === 'programme' \? <ProgrammeScope \/> : <CohortScope \/>/, 'the two scopes are never drawn into one list');
  assert.match(src, /useCohortRead\(\(id\) => cohortFounderApi\.outcomes\(id\)/, 'the cohort scope follows the selection and drops stale answers');
});

// ── Tablet (C17) and phone ───────────────────────────────────────────────

test('D4813: at 834px the founders table drops two columns and the panels reflow', () => {
  const row = { user_id: 21, name: 'Fin', email: 'f@x.test', state: 'on_track', week: 2, pct: 50 };
  const table = render(h(FounderTable, { rows: [row], label: 'November 2026', lastBy: new Map(), guidanceHref: '/g', onOpen() {} }));
  assert.match(table, /<th scope="col" class="[^"]*hidden lg:table-cell">Cohort<\/th>/);
  assert.match(table, /<th scope="col" class="[^"]*hidden lg:table-cell">Last activity<\/th>/);
  for (const col of ['Founder', 'Week', 'Progress', 'Status', 'Next deadline', 'Action']) {
    assert.match(table, new RegExp(`<th scope="col" class="[^"]*">${col}</th>`));
    assert.doesNotMatch(table, new RegExp(`hidden lg:table-cell">${col}<`), `${col} stays at 834px`);
  }
  const founders = codeOnly(read('frontend/src/pages/advisor/cohorts/FoundersZone.jsx'));
  assert.match(founders, /grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="founder-board"/, 'the board keeps three state columns from md');
  assert.match(founders, /<div className="hidden md:block"><FounderTable/, 'the table from md, cards below');
  const overview = codeOnly(read('frontend/src/pages/advisor/cohorts/OverviewZone.jsx'));
  assert.match(overview, /grid grid-cols-2 gap-2\.5 md:grid-cols-4" data-testid="overview-figures"/, 'four figures in a row at 834');
  assert.match(overview, /mt-4 grid gap-4 lg:grid-cols-2/, 'the two-up panels stack below lg');
  const nav = codeOnly(read('frontend/src/pages/advisor/cohorts/CohortWorkspace.jsx'));
  assert.match(nav, /flex flex-wrap items-center gap-x-3 gap-y-2/, 'the header row wraps');
  assert.match(nav, /aria-label="Cohorts sections" className="-mx-1 flex gap-1\.5 overflow-x-auto/, 'tabs scroll inside their own row, never the page');
  const outcomes = render(h(CohortOutcomes, { data: OUTCOMES, label: 'November 2026' }));
  assert.match(outcomes, /grid grid-cols-1 gap-2\.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="outcome-figures"/, 'two figures a row at 834');
  const sheet = codeOnly(read('frontend/src/ui/Sheet.jsx'));
  assert.match(sheet, /maxWidth: 'calc\(100vw - 108px\)'/, 'the 640px detail fits 834px beside the rail');
});

test('D4813: on a phone the detail is full screen and its targets are 44px', () => {
  const html = render(h(FounderDetailBody, { data: DETAIL, label: 'November 2026', guidanceHref: '/g', now: NOW }));
  const navButtons = html.match(/<nav aria-label="Founder sections"[\s\S]*?<\/nav>/)[0].match(/<button[^>]*>/g);
  assert.equal(navButtons.length, 6);
  for (const b of navButtons) assert.match(b, /min-h-\[44px\]/);
  assert.match(html, /<a[^>]*class="[^"]*min-h-\[44px\][^"]*"[^>]*>Write guidance/);
  const scope = read('frontend/src/pages/advisor/cohorts/OutcomesZone.jsx');
  assert.match(scope, /role="radio" aria-checked=\{scope === k\} onClick=\{\(\) => choose\(k\)\}\s*className=\{`min-h-\[44px\]/, 'the scope switch is 44px on a phone');
});

// ── Eadwyn ────────────────────────────────────────────────────────────────

test('D4813: the five cohort prompts reach the rail and only fill the composer', () => {
  assert.deepEqual([...COHORT_PROMPTS], ['Summarize this cohort', 'Who needs attention?', 'Draft weekly guidance', 'Prepare my next session', 'Explain this metric']);
  const chips = panelChips(promptOptions(COHORT_PROMPTS));
  assert.deepEqual(chips.map((c) => c.label), [...COHORT_PROMPTS]);
  assert.ok(chips.every((c) => c.run === false), 'no prompt is a run chip: nothing is sent until the advisor sends it');
  const routes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(routes, /prompts=\{cohorts \? COHORT_PROMPTS : undefined\}/);
  assert.match(routes, /import \{ COHORT_PROMPTS \} from '\.\.\/\.\.\/pages\/advisor\/cohorts\/cohortModel';/);
});
