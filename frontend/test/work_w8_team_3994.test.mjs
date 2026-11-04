// D1614 W8 (#3994, frontend half) — the Team picker on a task's sheet, "My tasks"
// in every licence's workspace, and Workload rows grouped by role. The
// components run against a stubbed fetch through the real clients (#4286's
// GET /api/teams/project/:id/assignable and GET /api/teams/me/tasks); every
// fixture is worked out by hand and names no real person.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/work_w8_team_3994.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  assigneeGroups, assigneeOption, licenceBadge, myTaskRow, myTaskSections, refusalWords, teamRoleWords, workloadByRole, workloadRows,
} from '../src/pages/work/workModel.js';
import { workApi } from '../src/lib/api/work.js';
import AssignPicker from '../src/pages/work/AssignPicker.jsx';
import MyTasks, { MY_TASKS_EMPTY } from '../src/pages/work/MyTasks.jsx';
import WorkloadView from '../src/pages/work/WorkloadView.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date('2026-11-12T10:00:00Z');

const TEAM = {
  team: [
    { kind: 'person', uid: 'u-1', name: 'Synthetic Founder', team_role: 'owner', licence: 'founder', open_tasks: 3, capacity: 8 },
    { kind: 'person', uid: 'u-2', name: 'Synthetic Investor', team_role: 'investor', licence: 'investor', open_tasks: 1, capacity: null },
    { kind: 'person', uid: 'u-3', name: 'Synthetic Advisor', team_role: 'advisor', licence: 'advisor', open_tasks: 0, capacity: null },
    { kind: 'agent', uid: 'a-1', name: 'Synthetic Agent', role: 'cfo', status: 'active', open_tasks: 2 },
    { kind: 'agent', uid: 'a-2', name: null, role: 'cmo', status: 'paused', open_tasks: 1 },
  ],
};

const MINE = {
  projects: [{ project: { id: 7, name: 'Synthetic venture' }, tasks: [
    { uid: 't1', task_number: 4, title: 'Runway note', type: 'task', column: 'in_progress', state: 'open', due_at: '2026-01-10', blocked: true, needs_reassignment: false, link: '/projects/7/work?item=t1' },
    { uid: 't2', task_number: 5, title: 'Board pack', type: 'task', column: 'ready', state: 'open', due_at: null, blocked: false, needs_reassignment: true, link: '/projects/7/work?item=t2' },
  ] }],
  compliance: [{ company: { uid: 'c1', name: 'Synthetic Co' }, tasks: [
    { uid: 'e1', title: 'Delaware franchise tax', type: 'tax', state: 'open', due_at: '2026-11-20', needs_reassignment: false, project_id: null, link: '/account/companies/c1/settings/compliance' },
  ] }],
  has_more: false,
};

async function mount(element, routes) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = String(u); const method = o.method || 'GET'; const body = o.body ? JSON.parse(o.body) : null;
    calls.push({ url, method, body });
    for (const [re, answer] of routes) if (re.test(`${method} ${url}`)) return answer(url, body);
    return json({ detail: 'Not found' }, 404);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
  return {
    calls, by, all, props, settle, text: (n) => text(n ?? document.body),
    press: async (n) => { assert.ok(n, 'no such node'); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    change: async (n, value) => { await act(async () => { props(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('W8 words: the picker groups this Team\'s people then its agents, with role badges in each licence\'s accent', () => {
  const [people, agents] = assigneeGroups(TEAM);
  assert.deepEqual([people.label, agents.label], ['Team', 'AI agents']);
  assert.deepEqual(people.options.map((o) => [o.name, o.badge.text, o.line]), [
    ['Synthetic Founder', 'Founder', '3 open tasks · 8 pts a week'],
    // Mutation checked: a null capacity read as 0 → "0 pts a week" and this fails; it is "Not recorded".
    ['Synthetic Investor', 'Investor', '1 open task · capacity Not recorded'],
    ['Synthetic Advisor', 'Advisor', '0 open tasks · capacity Not recorded'],
  ]);
  assert.deepEqual(agents.options.map((o) => [o.name, o.badge.text, o.line, o.paused]), [
    ['Synthetic Agent', 'cfo', 'Active · 2 open tasks', false],
    ['AI agent', 'cmo', 'Paused · 1 open task', true],
  ]);
  // Mutation checked: one badge class for every licence → the founder and investor badges are equal and this fails.
  assert.match(people.options[0].badge.className, /violet/);
  assert.match(people.options[1].badge.className, /indigo/);
  assert.match(people.options[2].badge.className, /emerald/);
  assert.match(licenceBadge('partner'), /amber/);
  assert.match(licenceBadge('admin'), /slate/);
  assert.equal(teamRoleWords('cofounder'), 'Co-founder');
  assert.equal(teamRoleWords(null), 'Not recorded');
  assert.equal(assigneeOption({ kind: 'person' }), null, 'a member with no uid is never offered');
  assert.deepEqual(assigneeGroups(null).map((g) => g.options.length), [0, 0]);
});

test('W8 words: a refusal is the Worker\'s own sentence; My tasks rows and sections; workload rows by role', () => {
  assert.equal(refusalWords({ status: 422, message: 'Only people and agents on this Team can be given its tasks.', data: { error: 'assignee_not_member', detail: 'Only people and agents on this Team can be given its tasks.' } }),
    'Only people and agents on this Team can be given its tasks.');
  assert.equal(refusalWords({ data: { detail: { code: 'x' } }, message: 'Request failed' }, 'Fallback.'), 'Fallback.', 'an object or a status line is never shown as a sentence');
  const r1 = myTaskRow(MINE.projects[0].tasks[0], NOW);
  assert.deepEqual([r1.where, r1.due, r1.overdue, r1.chips], ['In progress', 'Overdue · 10 Jan', true, ['Blocked']]);
  const r2 = myTaskRow(MINE.projects[0].tasks[1], NOW);
  // Mutation checked: needs_reassignment dropped → the seat-ended task shows no chip and this fails.
  assert.deepEqual([r2.where, r2.due, r2.chips], ['Ready', 'No due date', ['Needs reassignment']]);
  assert.equal(myTaskRow({ uid: 'x', column: 'mystery' }).where, 'Not recorded', 'an unknown column is never shown as its raw key');
  const v = myTaskSections(MINE, NOW);
  assert.deepEqual(v.sections.map((s) => [s.kind, s.title, s.rows.length]), [['project', 'Synthetic venture', 2], ['compliance', 'Synthetic Co · compliance', 1]]);
  assert.equal(v.count, 3);
  assert.deepEqual(myTaskSections({ projects: [{ project: { id: 1, name: 'Empty' }, tasks: [] }], compliance: [] }).sections, [], 'an empty group is not drawn');
  const rows = workloadRows({
    people: [{ person: { uid: 'u-2', name: 'Synthetic Investor' }, capacity: { available: false }, weeks: [], unscheduled: [] },
      { person: { uid: 'u-1', name: 'Synthetic Founder' }, capacity: { available: true, value: 8 }, weeks: [], unscheduled: [] },
      { person: { uid: 'u-9', name: 'Synthetic Stranger' }, capacity: { available: false }, weeks: [], unscheduled: [] }],
    agents: [{ agent: { uid: 'a-1', name: 'Synthetic Agent', role_key: 'cfo' }, capacity: null, weeks: [], unscheduled: [] }],
  });
  // Mutation checked: grouping by team_role instead of licence → the investor lands under "Team" and this fails.
  assert.deepEqual(workloadByRole(rows, TEAM.team).map((g) => [g.label, g.rows.map((r) => r.who.name)]), [
    ['Founders', ['Synthetic Founder']], ['Investors', ['Synthetic Investor']], ['Team', ['Synthetic Stranger']], ['AI agents', ['Synthetic Agent']],
  ]);
});

test('the clients: the assignable read and My tasks reach #4286\'s routes, with only the filters given', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return json({ team: [], projects: [], compliance: [] }); };
  try {
    await workApi.assignable(7);
    await workApi.myTasks();
    await workApi.myTasks({ state: 'all', project: 7, due: 'week' });
  } finally { globalThis.fetch = previous; restore(); }
  assert.match(urls[0], /\/api\/teams\/project\/7\/assignable$/);
  assert.match(urls[1], /\/api\/teams\/me\/tasks$/);
  assert.match(urls[2], /\/api\/teams\/me\/tasks\?state=all&project=7&due=week$/);
});

test('the picker: two groups from the Team read; a pick assigns; a refusal shows the Worker\'s words and assigns nothing', async () => {
  const assigned = [];
  const m = await mount(h(AssignPicker, { projectId: 7, taskUid: 't1', current: { kind: 'person', uid: 'u-1', name: 'Synthetic Founder' }, onAssigned: (t) => assigned.push(t), onCancel() {} }), [
    [/^GET .*\/teams\/project\/7\/assignable$/, () => json(TEAM)],
    [/^PATCH .*\/teams\/tasks\/t1$/, (_u, body) => (body.assignee?.uid === 'u-3'
      ? json({ error: 'assignee_not_member', detail: 'Only people and agents on this Team can be given its tasks.' }, 422)
      : json({ task: { uid: 't1', assignee: body.assignee } }))],
  ]);
  try {
    assert.ok(m.by('work-assign-group-people'));
    assert.ok(m.by('work-assign-group-agents'));
    const keys = m.all('work-assign-option').map((n) => m.props(n)['data-key']);
    // Mutation checked: agents listed before people → the order differs and this fails.
    assert.deepEqual(keys, ['person:u-1', 'person:u-2', 'person:u-3', 'agent:a-1', 'agent:a-2']);
    assert.equal(m.props(m.all('work-assign-option')[0])['aria-current'], 'true', 'the current assignee is marked');
    await m.press(m.all('work-assign-option')[2]);
    assert.equal(m.text(m.by('work-assign-refusal')), 'Only people and agents on this Team can be given its tasks.');
    assert.equal(assigned.length, 0, 'a refusal assigns nothing');
    await m.press(m.all('work-assign-option')[3]);
    assert.deepEqual(m.calls.filter((c) => c.method === 'PATCH').at(-1).body, { assignee: { kind: 'agent', uid: 'a-1' } });
    assert.equal(assigned.length, 1);
    await m.press(m.by('work-assign-none'));
    assert.deepEqual(m.calls.filter((c) => c.method === 'PATCH').at(-1).body, { assignee: null }, 'Unassign sends null');
  } finally { await m.unmount(); }
});

test('the picker: read_only_admin is shown in the Worker\'s words; an empty Team says so', async () => {
  const m = await mount(h(AssignPicker, { projectId: 7, taskUid: 't1', onAssigned() {}, onCancel() {} }), [
    [/^GET .*\/assignable$/, () => json({ team: [TEAM.team[0]] })],
    [/^PATCH /, () => json({ error: 'read_only_admin', detail: 'HQ read-only access cannot be given a task.' }, 422)],
  ]);
  try {
    await m.press(m.by('work-assign-option'));
    assert.equal(m.text(m.by('work-assign-refusal')), 'HQ read-only access cannot be given a task.');
    assert.equal(m.by('work-assign-none'), undefined, 'no Unassign when nobody is assigned');
  } finally { await m.unmount(); }
  const e = await mount(h(AssignPicker, { projectId: 7, taskUid: 't1', onAssigned() {}, onCancel() {} }), [[/^GET .*\/assignable$/, () => json({ team: [] })]]);
  try { assert.ok(e.by('work-assign-empty')); assert.equal(e.all('work-assign-option').length, 0); } finally { await e.unmount(); }
});

test('My tasks: projects then compliance, the filters go to the Worker, empty and engine-off are said plainly', async () => {
  const m = await mount(h(MyTasks, { licence: 'advisor', testId: 'mt' }), [[/^GET .*\/teams\/me\/tasks/, () => json(MINE)]]);
  try {
    assert.equal(m.text(m.by('mt-licence')), 'Advisor');
    assert.equal(m.text(m.by('mt-count')), '3');
    assert.deepEqual(m.all('mt-section').map((n) => m.text(n.childNodes[0])), ['Synthetic venture', 'Synthetic Co · compliance']);
    assert.match(m.text(m.by('mt-section')), /Overdue · 10 Jan.*Blocked.*Ready.*No due date.*Needs reassignment/s);
    await m.change(m.by('mt-state'), 'closed');
    await m.change(m.by('mt-due'), 'overdue');
    // Mutation checked: the due filter not sent → the last URL has no due= and this fails.
    assert.match(m.calls.at(-1).url, /\/teams\/me\/tasks\?state=closed&due=overdue$/);
  } finally { await m.unmount(); }
  const p = await mount(h(MyTasks, { licence: 'founder', project: 7, testId: 'mt' }), [[/^GET .*\/teams\/me\/tasks/, () => json({ projects: [], compliance: [], has_more: false })]]);
  try {
    assert.match(p.calls[0].url, /state=open&project=7$/, 'Work › My items is narrowed to its project');
    assert.equal(p.text(p.by('mt-empty')), MY_TASKS_EMPTY);
  } finally { await p.unmount(); }
  const off = await mount(h(MyTasks, { licence: 'partner', testId: 'mt' }), [[/^GET /, () => json({ error: 'agent_engine_off' }, 404)]]);
  try { assert.ok(off.by('mt-off'), 'an engine that is off is the honest block, never an empty list'); assert.equal(off.by('mt-empty'), undefined); } finally { await off.unmount(); }
  const bad = await mount(h(MyTasks, { licence: 'admin', testId: 'mt' }), [[/^GET /, () => json({ detail: 'Unreadable.' }, 503)]]);
  try { assert.ok(bad.by('mt-error')); assert.equal(bad.by('mt-empty'), undefined, 'a failed read is never "nothing given to you"'); } finally { await bad.unmount(); }
});

test('Workload: rows grouped by role from the Team read; without it, one ungrouped list', async () => {
  const WL = {
    weeks: ['2026-11-09'],
    people: [{ person: { uid: 'u-2', name: 'Synthetic Investor' }, capacity: { available: false }, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 0, unestimated: 0, over_capacity: null }], unscheduled: [] },
      { person: { uid: 'u-1', name: 'Synthetic Founder' }, capacity: { available: true, value: 8 }, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 3, unestimated: 0, over_capacity: false }], unscheduled: [] }],
    agents: [{ agent: { uid: 'a-1', name: 'Synthetic Agent', role_key: 'cfo' }, capacity: null, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 0, unestimated: 0, over_capacity: null }], unscheduled: [] }],
  };
  const m = await mount(h(WorkloadView, { projectId: 7 }), [
    [/^GET .*\/work\/workload/, () => json(WL)], [/^GET .*\/assignable$/, () => json(TEAM)]]);
  try {
    assert.deepEqual(m.all('work-workload-group').map((n) => m.text(n)), ['Founders', 'Investors', 'AI agents']);
    assert.deepEqual(m.all('work-workload-row').map((n) => m.text(n.childNodes[0].childNodes[0])), ['Synthetic Founder', 'Synthetic Investor', 'Synthetic Agent']);
  } finally { await m.unmount(); }
  const u = await mount(h(WorkloadView, { projectId: 7 }), [[/^GET .*\/work\/workload/, () => json(WL)], [/^GET .*\/assignable$/, () => json({ detail: 'x' }, 503)]]);
  try {
    assert.equal(u.all('work-workload-group').length, 0, 'no Team read: no role headings are guessed');
    assert.equal(u.all('work-workload-row').length, 3, 'and every row is still drawn');
  } finally { await u.unmount(); }
});

test('My tasks is placed in every licence\'s workspace, and the item sheet\'s Assign opens the picker', () => {
  const places = [
    ['frontend/src/pages/Dashboard.jsx', /<MyTasks licence="founder" testId="studio-my-tasks" \/>/],
    ['frontend/src/pages/work/WorkPage.jsx', /<MyTasks licence="founder" project=\{id\} title="My items" testId="work-mine" \/>/],
    ['frontend/src/workspaces/investor/InvestorDealsRoutes.jsx', /<MyTasks licence="investor" testId="deals-my-tasks" \/>/],
    ['frontend/src/pages/advisor/practice/EngagementsZone.jsx', /<MyTasks licence="advisor" testId="practice-my-tasks" \/>/],
    ['frontend/src/pages/partner/delivery/BoardZone.jsx', /<MyTasks licence="partner" testId="delivery-my-tasks" \/>/],
    ['frontend/src/pages/hq/HqHomePage.jsx', /<MyTasks licence="admin" testId="hq-my-tasks" \/>/],
  ];
  for (const [p, re] of places) assert.match(codeOnly(read(p)), re, p);
  const page = codeOnly(read('frontend/src/pages/work/WorkPage.jsx'));
  assert.match(page, /onClick=\{\(\) => setPicking\(\(v\) => !v\)\}/);
  assert.match(page, /<AssignPicker projectId=\{projectId\} taskUid=\{uid\}/);
  assert.doesNotMatch(page, /My items arrive with #3994/);
});
