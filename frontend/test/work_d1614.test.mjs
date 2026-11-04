// D1614 (#3968, canvases WK and CO) — Work for projects, compliance tasks for companies.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/work_d1614.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import {
  COLUMNS, agenda, assignGroups, assigneeLine, backlogRows, boardColumns, burnup, complianceCan, complianceTiles,
  canMove, dueLine, gutter, linkedWork, moveTargets, needsYou, runChip, runCost, runOutcome, AGENTS_OFF_REASON,
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

// #3970 turned `burnup` on, #3969/#3973 the board methods, and #3976 the compliance methods
// (company_compliance_d1614.test.mjs holds what each sends); every other method stays off until its route lands.
// D1614 W6 (#3974): W3's run, retry and feed and W4's workload and schedule are on; #3972 turned agentSessions on, once
// W4's Worker put agents' sessions in the workload read. CAL10's run sheet opens from the session itself.
const LIVE = new Set(['summary', 'burnup', 'board', 'item', 'move', 'assign', 'create', 'run', 'retry', 'feed', 'workload', 'schedule', 'agentSessions',
  'complianceTasks', 'complianceTask', 'markDone', 'createWork', 'complianceCreate', 'complianceUpdate',
  'complianceAssignable', 'complianceAssign', 'complianceComment', 'complianceReady', 'complianceReopen',
  // D1614 W8 (#3994): the Team picker and My tasks, on #4286's routes.
  'assignable', 'myTasks']);
test('the seam: every method not yet live is off, with the issue that turns it on, and makes no request', async () => {
  assert.deepEqual(Object.keys(WORK_SEAM).sort(), Object.keys(workAdapter).sort());
  for (const [m, issue] of Object.entries(WORK_SEAM)) {
    assert.match(issue, /^#(?:39(57|69|70|71|72|76|93|94)|4420)$/);
    if (LIVE.has(m) || issue === '#3993') continue; // W7 routes are on main and covered by work_w7_3993.
    const r = await workAdapter[m]('x');
    assert.equal(r.available, false, m);
  }
  const src = codeOnly(read('frontend/src/pages/work/workAdapter.js'));
  // No request of its own and no API URL; the import of lib/api/work.js is the client, not a path.
  assert.doesNotMatch(src, /request\(|fetch\(|['"`]\/api\//, 'the adapter never reaches the network itself');
  // #3970: the burn-up goes through workApi.burnup, and an engine that is off is the honest off block.
  assert.match(src, /burnup: \(projectId, opts\) => through\(\(\) => workApi\.burnup\(projectId, opts\), WORK_OFF\)/);
  const client = read('frontend/src/lib/api/work.js');
  assert.match(client, /request\(`\/teams\/project\/\$\{enc\(projectId\)\}\/work\/burnup/);
});

test('#3970: through answers the off block for agent_engine_off and rethrows anything else', async () => {
  const { through } = await import('../src/pages/work/workAdapter.js');
  assert.deepEqual(await through(async () => ({ series: [] }), 'off'), { available: true, data: { series: [] } });
  assert.deepEqual(await through(async () => { throw Object.assign(new Error('x'), { status: 404, data: { error: 'agent_engine_off' } }); }, 'off'), { available: false, reason: 'off' });
  await assert.rejects(through(async () => { throw Object.assign(new Error('x'), { status: 500 }); }, 'off'));
});

test('the views draw the canvas\'s parts with fixtures', () => {
  const board = html(h(Board, { items: ITEMS, viewer: { can_manage: true, user_uid: 'u-1' } }));
  for (const w of ['To triage', 'In review', 'Needs you', 'Review 3 proposals', 'See the failed run', 'Waiting for you', 'Blocked', 'Move to ▾', 'Estimate: Not recorded']) assert.ok(board.includes(w), w);
  assert.ok(!board.includes('Somewhere else'));
  const ro = html(h(Board, { items: ITEMS, viewer: { can_manage: false, user_uid: 'u-1' } }));
  assert.ok(!ro.includes('Move to ▾'), 'a reader opens cards, never moves them');
  assert.ok(!ro.includes('draggable="true"'), 'a reader gets no drag');
  assert.ok(!html(h(Board, { items: ITEMS })).includes('Move to ▾'), 'without a viewer nothing moves');
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
  // D1443 (#3706, part 5 #3992): both pages' Ask is the page's one header Ask (HeaderAsk, which draws PageAsk).
  for (const f of ['WorkPage.jsx', 'CompliancePage.jsx']) assert.match(codeOnly(read(`frontend/src/pages/work/${f}`)), /import HeaderAsk from '\.\.\/\.\.\/ui\/HeaderAsk\.jsx'[\s\S]*<HeaderAsk label=/, f);
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

// ── #3973: W1 is live ───────────────────────────────────────────────────────

test('#3973: canMove is the Worker\'s rule: an editor moves any card, anyone else only a card assigned to them', () => {
  const mine = { uid: 'm', column: 'ready', assignee: { kind: 'person', uid: 'u-2', name: 'Max Member' } };
  const theirs = { uid: 't', column: 'ready', assignee: { kind: 'person', uid: 'u-3', name: 'Ali Other' } };
  const agent = { uid: 'a', column: 'ready', assignee: { kind: 'agent', uid: 'u-2', name: 'CFO agent' } };
  assert.equal(canMove(theirs, { can_manage: true, user_uid: 'u-2' }), true);
  // Mutation checked: let a reader move every card → this fails.
  assert.equal(canMove(theirs, { can_manage: false, user_uid: 'u-2' }), false);
  assert.equal(canMove(mine, { can_manage: false, user_uid: 'u-2' }), true);
  assert.equal(canMove(agent, { can_manage: false, user_uid: 'u-2' }), false, 'an agent\'s card is not a person\'s own');
  assert.equal(canMove(mine, null), false);
  assert.equal(canMove(mine, { can_manage: false, user_uid: null }), false);
});

test('#3973: the five W1 methods go through workApi to W1\'s routes, and agent_engine_off is the honest block', async () => {
  const src = codeOnly(read('frontend/src/pages/work/workAdapter.js'));
  for (const m of ['board', 'item', 'move', 'assign', 'create']) assert.match(src, new RegExp(`${m}: \\([^)]*\\) => through\\(`), m);
  const restore = installDocument();
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o = {}) => {
    calls.push({ url: String(u), method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    if (/\/work\/board/.test(String(u))) return new Response(JSON.stringify({ error: 'agent_engine_off' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ task: { uid: 'u1', column: 'done' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const moved = await workAdapter.move('u1', 'done');
    assert.deepEqual(moved, { available: true, data: { uid: 'u1', column: 'done' } });
    await workAdapter.item('u1');
    await workAdapter.assign('u1', { kind: 'person', uid: 'u-2' });
    await workAdapter.create(7, { title: 'New thing' });
    const off = await workAdapter.board(7);
    assert.equal(off.available, false, 'an engine that is off is the honest block');
    const path = (c) => `${c.method} ${c.url.replace(/^.*\/api/, '')}`;
    assert.deepEqual(calls.map(path), [
      'PATCH /teams/tasks/u1/move', 'GET /teams/tasks/u1', 'PATCH /teams/tasks/u1', 'POST /teams/project/7/tasks', 'GET /teams/project/7/work/board',
    ]);
    assert.deepEqual(calls[0].body, { column: 'done' });
    assert.deepEqual(calls[2].body, { assignee: { kind: 'person', uid: 'u-2' } });
  } finally { globalThis.fetch = previous; restore(); }
});

test('#3973: mounted board: columns and counts from the read; Move to calls the move with the card and column; a reader gets neither menu nor drag', async () => {
  const restore = installDocument();
  try {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const moves = [];
    const live = [
      { uid: 'x1', title: 'Draft runway note', column: 'ready', estimate: 2, assignee: { kind: 'person', uid: 'u-2', name: 'Max Member' } },
      { uid: 'x2', title: 'Pricing page', column: 'ready', estimate: 3, assignee: { kind: 'person', uid: 'u-3', name: 'Ali Other' } },
      { uid: 'x3', title: 'Seed deck', column: 'done', estimate: 5 },
    ];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
    const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
    const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
    await act(async () => root.render(h(MemoryRouter, null, h(Board, { items: live, viewer: { can_manage: false, user_uid: 'u-2' }, onMove: (uid, col) => moves.push([uid, col]) }))));
    assert.match(text(byId('work-col-ready')), /Ready2/);
    assert.match(text(byId('work-col-ready')), /Estimate: 5/);
    assert.match(text(byId('work-col-done')), /Done1/);
    // The member's own card moves; the other's has no menu and no drag.
    assert.equal(props(byId('work-card-x1')).draggable, true);
    assert.equal(props(byId('work-card-x2')).draggable, false);
    const toggle = nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n) === 'Move to ▾');
    await act(async () => { props(toggle).onClick(); });
    assert.ok(byId('work-move-x1-in_progress'));
    assert.ok(!byId('work-move-x2-in_progress'), 'no menu on a card the reader may not move');
    // Mutation checked: drop onMove from the menu item → no move is recorded and this fails.
    await act(async () => { props(byId('work-move-x1-in_progress')).onClick(); });
    assert.deepEqual(moves, [['x1', 'in_progress']]);
    // A drop of a card the reader may not move does nothing.
    const drop = (uid, col) => props(byId(`work-col-${col}`)).onDrop({ preventDefault() {}, dataTransfer: { getData: () => uid } });
    await act(async () => { drop('x2', 'done'); });
    await act(async () => { drop('x1', 'done'); });
    assert.deepEqual(moves, [['x1', 'in_progress'], ['x1', 'done']]);
    await act(async () => root.unmount());
  } finally { restore(); }
});

// W7 part 2 (#4419): mounted interactions use the same adapter seam as the sheets.
import TaskTimeline from '../src/pages/work/TaskTimeline.jsx';
import TaskReview from '../src/pages/work/TaskReview.jsx';
import TaskDraft from '../src/pages/work/TaskDraft.jsx';
import TaskClassification from '../src/pages/work/TaskClassification.jsx';
import WorkSettings from '../src/pages/work/WorkSettings.jsx';
import { mountContracts } from './_contracts_dom.mjs';
const yes = (data) => Promise.resolve({available:true,data});

test('W7 timeline names the actor, keeps missing cost honest, opens the run, and edits only your own comments', async () => {
  const runs=[], writes=[];
  const adapter={timeline:()=>yes({entries:[{type:'comment',at:'2026-11-04',comment:{uid:'c1',body:'Recorded words',author:{kind:'agent',name:'Analyst',uid:'a1'},run:'r1',cost:{available:false}}},
    {type:'comment',at:'2026-11-05',comment:{uid:'c2',body:'My words',author:{kind:'person',name:'Member',uid:'u1'}}}]}),assignable:()=>yes({team:[{kind:'person',uid:'u1',name:'Member'}]}),editComment:(...a)=>{writes.push(a);return yes({});}};
  const m=await mountContracts(h(TaskTimeline,{projectId:7,number:3,viewer:{user_uid:'u1'},adapter,onRun:(r)=>runs.push(r)}));
  try {
    assert.match(m.text(),/Cost: Not recorded/);assert.doesNotMatch(m.text(),/\$0/);
    await m.click('View run ›');assert.deepEqual(runs,['r1']);
    assert.equal(m.nodes().filter((n)=>m.props(n)?.children==='Edit comment').length,1);
    await m.click('Edit comment');await m.fill('Edit your comment','Revised');
    const form=m.nodes().find((n)=>n.tagName==='FORM');await act(async()=>m.props(form).onSubmit({preventDefault(){}}));
    assert.deepEqual(writes,[[7,'c2',{body:'Revised'}]]);
  }finally{await m.unmount();}
});

test('W7 review requires changes comment, calls review for both decisions and hides controls from readers', async()=>{
  const calls=[],changed=[];const adapter={review:(...a)=>{calls.push(a);return yes({task:{uid:'t',column:'done'}});}};
  const m=await mountContracts(h(TaskReview,{projectId:7,task:{task_number:3,column:'in_review'},canManage:true,adapter,onChanged:(r)=>changed.push(r)}));
  try{await m.click('Request changes');assert.equal(calls.length,0);assert.match(m.text(),/Add a comment/);
    await m.fill('Review comment','Please add evidence');await m.click('Request changes');await m.click('Approve and close');
    assert.deepEqual(calls.map((c)=>c[2].decision),['request_changes','approve']);assert.equal(changed.length,2);
  }finally{await m.unmount();}
  assert.doesNotMatch(html(h(TaskReview,{task:{column:'in_review'},canManage:false})),/Approve and close/);
});

test('W7 draft accepts edits and requires a discard reason',async()=>{
  const accepted=[],discarded=[];const adapter={acceptDraft:(...a)=>{accepted.push(a);return yes({task:{uid:'new'}});},discardDraft:(...a)=>{discarded.push(a);return yes({});}};
  const m=await mountContracts(h(TaskDraft,{projectId:7,draft:{uid:'d',title:'Draft'},canManage:true,adapter}));
  try{await m.click('Discard');assert.equal(discarded.length,0);await m.fill('Discard reason','Duplicate');await m.click('Discard');
    assert.deepEqual(discarded,[[7,'d',{reason:'Duplicate'}]]);await m.click('Edit');await m.fill('Draft title','Reviewed title');await m.click('Accept edited draft');
    assert.deepEqual(accepted,[[7,'d',{title:'Reviewed title',body:''}]]);
  }finally{await m.unmount();}
});

test('W7 task label and milestone pickers call the project task routes',async()=>{
  const calls=[];const adapter={labels:()=>yes({labels:[{uid:'l',name:'Bug'}]}),milestones:()=>yes({milestones:[{uid:'m',title:'Launch'}]}),
    setLabels:(...a)=>{calls.push(['labels',...a]);return yes({task:{}});},setMilestone:(...a)=>{calls.push(['milestone',...a]);return yes({task:{}});}};
  const m=await mountContracts(h(TaskClassification,{projectId:7,task:{task_number:3},canManage:true,adapter}));
  try{const box=m.nodes().find((n)=>n.tagName==='INPUT');await act(async()=>m.props(box).onChange({target:{checked:true}}));await m.click('Save labels');
    const select=m.nodes().find((n)=>n.tagName==='SELECT');await act(async()=>m.props(select).onChange({target:{value:'m'}}));await m.click('Save milestone');
    assert.deepEqual(calls,[['labels',7,3,{labels:['l']}],['milestone',7,3,{milestone:'m'}]]);
  }finally{await m.unmount();}
});

test('W7 settings create project labels with palette colors and milestones with dates',async()=>{
 const calls=[];const adapter={labels:()=>yes({labels:[]}),milestones:()=>yes({milestones:[]}),createLabel:(...a)=>{calls.push(a);return yes({});},createMilestone:(...a)=>{calls.push(a);return yes({});}};
 const m=await mountContracts(h(WorkSettings,{projectId:7,canManage:true,adapter}));
 try{await m.fill('Label name','Bug');let forms=m.nodes().filter((n)=>n.tagName==='FORM');await act(async()=>m.props(forms[0]).onSubmit({preventDefault(){}}));
  await m.fill('Milestone title','Launch');forms=m.nodes().filter((n)=>n.tagName==='FORM');await act(async()=>m.props(forms[1]).onSubmit({preventDefault(){}}));
  assert.deepEqual(calls,[[7,{name:'Bug',color:'gray'}],[7,{title:'Launch',due_on:null,state:'open'}]]);
 }finally{await m.unmount();}
});

// S1's review of #4441: accessibility and state refresh regressions.
import TaskDrafts from '../src/pages/work/TaskDrafts.jsx';
import { ItemSheet } from '../src/pages/work/WorkPage.jsx';

test('editing a comment focuses and names its field and announces edit mode',async()=>{
 const adapter={timeline:()=>yes({entries:[{type:'comment',comment:{uid:'c',body:'Words',author:{kind:'person',uid:'u'}}}]}),assignable:()=>yes({team:[]})};
 const m=await mountContracts(h(TaskTimeline,{projectId:7,number:1,viewer:{user_uid:'u'},adapter}));
 try{const field=m.nodes().find((n)=>n.tagName==='TEXTAREA');let focused=0;field.focus=()=>{focused++;};await m.click('Edit comment');
  assert.equal(focused,1);assert.equal(m.props(field)['aria-label'],'Edit your comment');
  assert.equal(m.nodes().some((n)=>m.props(n)?.role==='status'&&m.props(n)?.children==='Editing your comment.'),true);
 }finally{await m.unmount();}
});

test('catalogue save and Cancel edit reset milestone date/state and label color',async()=>{
 const api={labels:()=>yes({labels:[{uid:'l',name:'Bug',color:'red'}]}),milestones:()=>yes({milestones:[{uid:'m',title:'Old milestone',due_on:'2026-12-01',state:'closed'}]}),updateMilestone:()=>yes({}),updateLabel:()=>yes({})};
 const m=await mountContracts(h(WorkSettings,{projectId:7,canManage:true,adapter:api}));
 const byLabel=(name)=>m.nodes().find((n)=>m.props(n)?.['aria-label']===name);
 const clickLabel=async(name)=>{await act(async()=>m.props(byLabel(name)).onClick());};
 try{
  await clickLabel('Edit Old milestone');await m.click('Cancel edit');
  assert.equal(m.props(byLabel('Milestone due date')).value,'');assert.equal(m.props(byLabel('Milestone state')).value,'open');
  await clickLabel('Edit Old milestone');const forms=m.nodes().filter((n)=>n.tagName==='FORM');await act(async()=>m.props(forms[1]).onSubmit({preventDefault(){}}));
  assert.equal(m.props(byLabel('Milestone due date')).value,'');assert.equal(m.props(byLabel('Milestone state')).value,'open');
  await clickLabel('Edit Bug');await m.click('Cancel edit');assert.equal(m.props(byLabel('Label color')).value,'gray');
  await clickLabel('Edit Bug');await act(async()=>m.props(m.nodes().filter((n)=>n.tagName==='FORM')[0]).onSubmit({preventDefault(){}}));assert.equal(m.props(byLabel('Label color')).value,'gray');
 }finally{await m.unmount();}
});

test('the item sheet reloads Activity after label and milestone saves',async()=>{
 const saved={...workAdapter};let reads=0;const task={uid:'task-refresh',task_number:1,title:'Task',column:'backlog'};
 Object.assign(workAdapter,{item:()=>yes(task),timeline:()=>{reads++;return yes({entries:[]});},assignable:()=>yes({team:[]}),labels:()=>yes({labels:[]}),milestones:()=>yes({milestones:[]}),setLabels:()=>yes({task}),setMilestone:()=>yes({task})});
 const m=await mountContracts(h(ItemSheet,{uid:task.uid,projectId:7,viewer:{can_manage:true,user_uid:'u'},onClose(){}}));
 try{assert.equal(reads,1);await m.click('Save labels');assert.equal(reads,2);await m.click('Save milestone');assert.equal(reads,3);}finally{await m.unmount();Object.assign(workAdapter,saved);}
});

test('the draft list has a named region and README component rows stay inside the table',()=>{
 const out=html(h(TaskDrafts,{projectId:7,canManage:false}));assert.match(out,/<section aria-label="Agent task drafts"/);
 const doc=read('frontend/src/pages/work/README.md');assert.doesNotMatch(doc,/\|\n\s*\n\| `TaskTimeline/);
});
