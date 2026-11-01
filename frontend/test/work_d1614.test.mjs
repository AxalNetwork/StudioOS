// D1614 (#3968, canvases WK and CO) — Work for projects, compliance tasks for companies.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/work_d1614.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  COLUMNS, agenda, assignGroups, assigneeLine, backlogRows, boardColumns, burnup, complianceCan, complianceTiles,
  dueLine, gutter, linkedWork, moveTargets, needsYou, runChip, runCost, runOutcome, AGENTS_OFF_REASON,
} from '../src/pages/work/workModel.js';
import { WORK_SEAM, workAdapter } from '../src/pages/work/workAdapter.js';
import { Agenda, TaskSheet } from '../src/pages/work/CompliancePage.jsx';
import { Board, Backlog, Burnup } from '../src/pages/work/WorkPage.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const ITEMS = [
  { uid: 'a', title: 'Pricing page A/B test', column: 'triage', estimate: 2 },
  { uid: 'b', title: 'Prepare Delaware franchise tax figures', column: 'backlog', estimate: 2, assignee: { kind: 'agent', name: 'CFO agent', role: 'Finance' }, run: { status: 'completed', charged_microusd: 120000 } },
  { uid: 'c', title: 'Draft runway note', column: 'in_review', estimate: 2, assignee: { kind: 'agent', name: 'CFO agent', role: 'Finance' }, run: { status: 'waiting', proposals: 3, charged_microusd: 120000 } },
  { uid: 'd', title: 'Carrier status alerts spike', column: 'in_progress', estimate: 4, blocked: true, assignee: { kind: 'agent', name: 'CTO agent', role: 'Engineering' }, run: { status: 'failed', charged_microusd: 60000 } },
  { uid: 'e', title: 'Seed deck v3', column: 'done', estimate: 5, assignee: { kind: 'person', name: 'Avery Stone' } },
  { uid: 'f', title: 'Ready, no estimate', column: 'ready' },
  { uid: 'g', title: 'Somewhere else', column: 'mystery', estimate: 9 },
];

test('the six columns, in the canvas\'s order and words', () => {
  assert.deepEqual(COLUMNS.map((c) => c.label), ['To triage', 'Backlog', 'Ready', 'In progress', 'In review', 'Done']);
  assert.equal(COLUMNS.find((c) => c.key === 'in_review').line, 'Waiting for a named person to accept');
});

test('the board: cards by column, an unknown column never guessed, an unrecorded estimate never 0', () => {
  const cols = boardColumns(ITEMS);
  assert.deepEqual(cols.map((c) => c.count), [1, 1, 1, 1, 1, 1]);
  assert.equal(cols.find((c) => c.key === 'ready').estimate, 'Not recorded');
  assert.equal(cols.find((c) => c.key === 'in_progress').estimate, 4);
  assert.ok(!cols.some((c) => c.cards.some((x) => x.uid === 'g')), 'a card in an unknown column is in no column');
  assert.deepEqual(moveTargets(ITEMS[0]).map((c) => c.key), ['backlog', 'ready', 'in_progress', 'in_review', 'done']);
});

test('a card\'s lines: who, the run chip with its cost, due and soon', () => {
  assert.deepEqual(assigneeLine(ITEMS[0]), { text: 'Unassigned', agent: false, role: null });
  assert.deepEqual(assigneeLine(ITEMS[1]), { text: 'CFO agent', agent: true, role: 'Finance' });
  assert.deepEqual(assigneeLine(ITEMS[4]), { text: 'Avery Stone', agent: false, role: null });
  assert.deepEqual(runChip({ status: 'running', charged_microusd: 40000 }), { words: 'Running', tone: 'running', cost: '$0.04 so far' });
  assert.equal(runChip({ status: 'waiting', charged_microusd: null }).cost, null, 'an unrecorded charge is not $0.00');
  assert.equal(runChip({ status: 'odd' }), null);
  const now = new Date('2026-11-17T09:00:00Z');
  assert.deepEqual(dueLine('2026-11-18', now), { text: '18 Nov', soon: true, overdue: false });
  assert.equal(dueLine('2026-12-30', now).soon, false);
  assert.equal(dueLine('nope', now), null);
});

test('"Needs you": proposals waiting and failed runs, in words', () => {
  const n = needsYou(ITEMS);
  assert.match(n.line, /CFO agent proposed 3 changes on “Draft runway note”/);
  assert.match(n.line, /CTO agent’s run on “Carrier status alerts spike” failed/);
  assert.equal(n.review, 'Review 3 proposals');
  assert.equal(n.failed, true);
  assert.equal(needsYou([ITEMS[0]]), null);
});

test('the backlog: title order, Done hidden; Assign to… greys agents when they are off', () => {
  assert.deepEqual(backlogRows(ITEMS).map((r) => r.uid), ['d', 'c', 'b', 'a', 'f']);
  const g = assignGroups({ people: [{ id: 1, name: 'Avery Stone' }], agents: [{ uid: 'x', name: 'CFO agent', role: 'Finance' }], agentsOn: false });
  assert.deepEqual(g.map((x) => x.label), ['People', 'AI agents']);
  assert.equal(g[1].options[0].disabled, true);
  assert.equal(g[1].options[0].why, AGENTS_OFF_REASON);
});

test('the burn-up: lines from recorded days only, its sentence, and "Not recorded" before the first item', () => {
  const g = burnup([{ day: '1 Nov', scope: 16, completed: 2 }, { day: '2 Nov', scope: null, completed: 3 }, { day: '14 Nov', scope: 24, completed: 12 }]);
  assert.equal(g.empty, false);
  assert.deepEqual(g.tiles, { scope: 24, completed: 12, open: 12 });
  assert.equal(g.line, 'Scope grew from 16 to 24 items; 12 are completed and 12 are open.');
  assert.match(g.scope, /^M0\.0,/);
  assert.deepEqual(burnup([]), { empty: true, line: 'Not recorded' });
});

test('a run: outcome and cost in the canvas\'s words', () => {
  assert.deepEqual(runOutcome({ status: 'failed', reason: 'The Mercury connection expired' }), { title: 'Failed', tone: 'negative', reason: 'The Mercury connection expired' });
  assert.equal(runCost({ hold_microusd: 400000, charged_microusd: 120000, tokens: 18240, model: '[Model A]' }), 'Held $0.40 · charged $0.12 · 18,240 tokens · [Model A]');
  assert.equal(runCost({ hold_microusd: 400000 }), 'Held $0.40 · charge not recorded');
  assert.equal(runOutcome({}).title, 'Not recorded');
});

const NOW = new Date('2026-11-12T10:00:00Z');
const TASKS = [
  { uid: 't1', title: 'Registered agent renewal', due: '2026-10-15', type: 'Renewal', jurisdiction: 'Delaware' },
  { uid: 't2', title: '83(b) election', due: '2026-11-20', type: 'Filing', linked_work: { project_name: 'Pilot app', column: 'in_review' } },
  { uid: 't3', title: 'Q4 estimated tax payment', due: '2026-12-15', type: 'Payment' },
  { uid: 't4', title: 'Delaware franchise tax', due: '2027-03-01', type: 'Payment' },
  { uid: 't5', title: 'Filed last spring', status: 'done', done_at: '2026-03-01' },
  { uid: 't6', title: 'No date', type: 'Report' },
];

test('the agenda: Overdue pinned with its days, then months oldest first; a task without a date is never placed', () => {
  const a = agenda(TASKS, NOW);
  assert.deepEqual(a.overdue.map((t) => [t.uid, t.late]), [['t1', 28]]);
  assert.deepEqual(a.months.map((m) => m.label), ['NOVEMBER 2026', 'DECEMBER 2026', 'MARCH 2027']);
  assert.ok(!a.months.some((m) => m.tasks.some((t) => t.uid === 't6')));
  assert.deepEqual(gutter('2026-10-15'), { month: 'OCT', day: '15', weekday: 'THU' });
  assert.deepEqual(complianceTiles(TASKS, NOW), { overdue: 1, next30: 1, quarter: 2, doneYear: 1 });
  assert.deepEqual(complianceTiles(null), { overdue: 'Not recorded', next30: 'Not recorded', quarter: 'Not recorded', doneYear: 'Not recorded' });
  assert.equal(linkedWork(TASKS[1].linked_work), 'In review in Pilot app');
  assert.deepEqual(complianceCan({ can_manage: false }), { markDone: false, create: false, createWork: false, reschedule: false });
  assert.equal(complianceCan({ can_manage: true }).markDone, true);
});

test('the seam: every method is off, with the issue that turns it on, and makes no request', async () => {
  assert.deepEqual(Object.keys(WORK_SEAM).sort(), Object.keys(workAdapter).sort());
  for (const [m, issue] of Object.entries(WORK_SEAM)) {
    const r = await workAdapter[m]('x');
    assert.equal(r.available, false, m);
    assert.match(issue, /^#39(69|70|71|72|76)$/);
  }
  const src = codeOnly(read('frontend/src/pages/work/workAdapter.js'));
  assert.doesNotMatch(src, /request\(|fetch\(|\/api\//, 'no client path for a route that is not on main');
});

test('the views draw the canvas\'s parts with fixtures', () => {
  const board = html(h(Board, { items: ITEMS }));
  for (const w of ['To triage', 'In review', 'Needs you', 'Review 3 proposals', 'See the failed run', 'Waiting for you', 'Blocked', 'Move to ▾', 'Estimate: Not recorded']) assert.ok(board.includes(w), w);
  assert.ok(!board.includes('Somewhere else'));
  const ro = html(h(Board, { items: ITEMS, readOnly: true }));
  assert.ok(!ro.includes('Move to ▾'), 'a reader opens cards, never moves them');
  const back = html(h(Backlog, { items: ITEMS }));
  assert.match(back, /Sorted by title · Done hidden · 5 open/);
  assert.match(html(h(Burnup, { series: [] })), /Not recorded/);
  const ag = html(h(Agenda, { ag: agenda(TASKS, NOW), can: complianceCan({ can_manage: true }) }));
  assert.match(ag, /Overdue · 1/);
  assert.match(ag, /overdue 28 days/);
  assert.match(ag, /In review in Pilot app/);
  assert.match(ag, /Mark done/);
  const reader = html(h(Agenda, { ag: agenda(TASKS, NOW), can: complianceCan({ can_manage: false }) }));
  assert.doesNotMatch(reader, /Mark done|type="checkbox"/, 'a reader: no checkbox, no Mark done');
  assert.doesNotMatch(board + back + ag, /\$0\.00|\bFill\b/);
  assert.equal(typeof TaskSheet, 'function');
});

test('the routes, the Project settings card, and the honest block while off', () => {
  const routes = read('frontend/src/routes/team.jsx');
  assert.match(routes, /path="\/projects\/:id\/work" element=\{guard\(labRoles\(\['admin', 'founder', 'partner', 'investor'\]\), <WorkPage \/>\)\}/);
  assert.match(routes, /path="\/account\/companies\/:uid\/settings\/compliance"/);
  const settings = read('frontend/src/pages/team/ProjectSettingsPage.jsx');
  assert.match(settings, /to=\{`\/projects\/\$\{encodeURIComponent\(id\)\}\/work`\}/);
  assert.match(settings, /Open Work ›/);
  const page = codeOnly(read('frontend/src/pages/work/WorkPage.jsx'));
  assert.match(page, /testId="work-off"/);
  assert.match(page, /disabled=\{off\}/, 'New item is off while Work is');
  assert.doesNotMatch(read('frontend/src/pages/work/CompliancePage.jsx'), /company_projects|scope_tasks/);
});

test('the canvases are in design/incoming with the named logo edit, and D1614 names them', () => {
  const page = read('design/incoming/Work Compliance Page.dc.html');
  const boards = read('design/incoming/Work Compliance · Boards.dc.html');
  for (const k of ['WK0', 'WK8', 'CO2', 'CO5']) assert.ok(boards.includes(`'${k}'`), k);
  assert.ok(page.includes('Waiting for a named person to accept'));
  assert.ok(!page.includes('uploads/axal-logo-200x200.png'));
  assert.ok(existsSync(new URL('../../documentation/architecture/decisions/D1614.md', import.meta.url)));
  assert.match(read('documentation/architecture/decisions/D1614.md'), /Prompt 1 v3/);
  assert.match(read('design/incoming/README.md'), /## Landed 2026-11-01 — Work and company compliance \(#3968\)/);
});
