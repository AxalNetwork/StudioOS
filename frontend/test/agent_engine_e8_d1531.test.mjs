// D1531 (#3742 E8) — the agent engine's screens TM10–TM19 and TM5m, drawn to
// `design/incoming/Agent Engine Page.dc.html`. The words are pure
// (`engineModel.js`); the components run against a stubbed fetch through the
// real `agentEngineApi`. Every fixture is worked out by hand and names no real
// person.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/agent_engine_e8_d1531.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  acceptBody, costToDate, dayWord, dutyOutcome, engineBanner, evalRow, goalBody, goalLine, goalRow, holderName, loopWords, moveNotice,
  noteLine, noteProblem, pct, quoteLine, refusalSentence, skillCheck, startLine, stepDecision, tasksByModule,
} from '../src/pages/team/engineModel.js';
import { pauseWords } from '../src/pages/team/teamModel.js';
import GoalsView from '../src/pages/team/GoalsView.jsx';
import HandoffTrail from '../src/pages/team/HandoffTrail.jsx';
import AgentEvaluation from '../src/pages/team/AgentEvaluation.jsx';
import MoveNotices from '../src/pages/team/MoveNotices.jsx';
import EngineControl, { StartTask } from '../src/pages/team/EngineControl.jsx';
import { AgentMemory } from '../src/pages/team/AgentMemory.jsx';
import { personaFor } from '../src/pages/team/SuggestAgentsSheet.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (code, message, status) => json({ code, message }, status);

async function mount(element, routes) {
  const restore = installDocument();
  try { window.localStorage.setItem('token', 'synthetic'); } catch { /* no storage */ }
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
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
  return {
    calls, all, props, by: (id) => all(id)[0], text: (n) => text(n ?? document.body),
    press: async (n) => { assert.ok(n, 'no such node'); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    change: async (n, value) => { await act(async () => { props(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const TEAM = [
  { uid: 'a1', role_key: 'general_counsel', status: 'active', persona: { key: 'vesta', name: 'Vesta' } },
  { uid: 'a2', role_key: 'investor_relations', status: 'active', persona: { key: 'aurel', name: 'Aurel' } },
  { uid: 'a3', role_key: 'cmo', status: 'removed', persona: { key: 'kade', name: 'Kade' } },
];

test('TM10 words: a goal row, its line, cost never $0, and the form refuses a bad date before the Worker does', () => {
  const r = goalRow({ uid: 'g1', title: 'Ship self-serve onboarding', status: 'open', parent: { uid: 'g0', title: 'Reach 40 paying teams' }, target_date: '2027-01-15', progress: { done: 4, total: 6 }, cost: { available: true, value_microusd: 1_100_000 } });
  assert.deepEqual([r.status, r.parent, r.due, r.progress, r.cost], ['Open', '↳ Reach 40 paying teams', '15 Jan 2027', '4 of 6 tasks done', '$1.10 to date']);
  // Mutation checked: `{ available: false }` read as 0 → "$0.00 to date" and this fails.
  assert.equal(costToDate({ available: false }), 'Not recorded');
  assert.equal(costToDate({ available: true, value_microusd: null }), 'Not recorded');
  assert.equal(goalLine({ status: 'open', target_date: '2027-01-15', parent: { title: 'Reach 40 paying teams' }, progress: { done: 4, total: 6 } }),
    'Open · target 15 Jan 2027 · parent: Reach 40 paying teams · 4 of 6 tasks done.');
  assert.deepEqual(goalBody({ title: 'X', target_date: '31/03/2027' }).error, { field: 'target_date', text: 'The target date is a day, such as 2027-03-31.' });
  assert.deepEqual(goalBody({ title: '  ' }).error.field, 'title');
  // A project sends a stage and no parent; a company sends a parent and no stage.
  assert.deepEqual(goalBody({ title: 'A', stage: 'build', parent_goal_uid: 'g9', priority: 'high' }, { project: true }).body, { title: 'A', priority: 'high', stage: 'build' });
  assert.deepEqual(goalBody({ title: 'A', stage: 'build', parent_goal_uid: 'g9' }, { project: false }).body, { title: 'A', parent_goal_uid: 'g9' });
  assert.equal(dayWord('2026-13-01'), null);
});

test('TM10b/c/d words: tasks by module with “Waits on”, the quote line, and the accept body', () => {
  const groups = tasksByModule([
    { uid: 't1', title: 'Onboarding checklist spec', module: 'product', depends_on: [] },
    { uid: 't2', title: 'Billing on signup', module: 'engineering', depends_on: ['t1'] },
    { uid: 't3', title: 'Self-serve signup flow', module: 'product', depends_on: ['t1', 'missing'] },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.waits.join('|'))]), [['Product', ['', 'Onboarding checklist spec']], ['Engineering', ['Onboarding checklist spec']]]);
  assert.equal(quoteLine({ available: true, value_microusd: 120_000 }, 'agent', 'Vesta'), '$0.12 · by Vesta');
  assert.equal(quoteLine({ available: true, value_microusd: 10_000 }, 'eadwyn'), '$0.01 · by Eadwyn');
  assert.equal(quoteLine({ available: false }, 'eadwyn'), 'Cost can’t be estimated right now');
  const items = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
  assert.deepEqual(acceptBody(items, [true, false, true], { 2: 'C, retitled', 0: 'A' }), { remove: [1], titles: { 2: 'C, retitled' } });
  assert.deepEqual(acceptBody(items, [true, true, true], {}), { remove: undefined, titles: undefined });
});

test('refusals: the Worker’s own sentence first, then the canvas’s sentence for its code', () => {
  const said = Object.assign(new Error('This team runs at most 2 agents at once. Try again when one finishes.'), { status: 409, code: 'scope_busy' });
  assert.equal(refusalSentence(said), 'This team runs at most 2 agents at once. Try again when one finishes.');
  const bare = Object.assign(new Error('agent_busy'), { status: 409, code: 'agent_busy' });
  assert.equal(refusalSentence(bare), 'This agent is already working on a task.');
  assert.equal(refusalSentence(Object.assign(new Error('Request failed'), { status: 500 })), 'That did not go through. Nothing changed.');
});

test('TM13, TM14, TM18 words: steps, loops, rates as fractions, skill checks, and each side of a move', () => {
  assert.equal(stepDecision({ status: 'accepted', decided_by: { name: 'Synthetic Person' } }), 'accepted by Synthetic Person');
  assert.equal(stepDecision({ status: 'accepted', decided_by: null }), 'decided by: Not recorded');
  assert.equal(stepDecision({ status: 'proposed' }), 'no decision yet');
  assert.equal(loopWords({ reason: 'loop' }), 'Stopped: this would hand the work back to an agent already in the chain.');
  assert.equal(holderName('general_counsel', TEAM), 'Vesta');
  assert.equal(holderName('cmo', TEAM), null, 'a removed agent holds nothing');
  // Mutation checked: pct(0.82) printed as "1%" (rounding the fraction) fails here.
  assert.equal(pct(0.82), '82%');
  assert.equal(pct(null), '—');
  const rated = evalRow({ role_key: 'general_counsel', decided: 48, acceptance: 0.82, edit: 0.11, discard: 0.07, median_decision_h: 3.2, open_past_3d: 1, expired: 0, cost_per_accepted: { available: true, value_microusd: 140_000 }, refused: [{ reason: 'module_not_allowed', n: 2 }] });
  assert.deepEqual([rated.accepted, rated.edited, rated.discarded, rated.median, rated.cost, rated.refused[0].n], ['82%', '11%', '7%', '3.2 h', '$0.14', 2]);
  const few = evalRow({ role_key: 'cmo', decided: 7, acceptance: null, note: 'Too few decisions to rate (7)', cost_per_accepted: { available: false } });
  assert.deepEqual([few.rated, few.note, few.cost], [false, 'Too few decisions to rate (7)', 'Not recorded']);
  const sk = skillCheck({ name: 'Runway note', version: 2, pass: 9, total: 10, not_run: 1, regressed: [{ case: 'Case 4', model: 'Model B' }], last_run: '2026-11-21T09:00:00Z' });
  assert.deepEqual([sk.name, sk.cases, sk.notRun, sk.last, sk.regressions], ['Runway note · v2', 'golden cases 9/10', 1, 'Last run 21 Nov 2026', 'Regressed: Case 4 · Model B']);
  const m = { direction: 'in', project: { id: 7, name: 'Pilot app' }, from: { uid: 'c1', name: 'Acme Inc.' }, to: { uid: 'c2', name: 'Northwind Labs' }, by: { name: 'Synthetic Person' }, at: '2026-11-18T10:00:00Z', blocked_tasks: 4 };
  assert.equal(moveNotice(m).text, 'This project moved from Acme Inc. to Northwind Labs on 18 Nov 2026. Its agents stayed with the project.');
  assert.equal(moveNotice({ ...m, from: null }).text, 'This project joined Northwind Labs on 18 Nov 2026. Its agents stayed with the project.');
  assert.equal(moveNotice({ ...m, to: null, by: null }).by, 'Moved by: Not recorded');
  assert.deepEqual(moveNotice({ ...m, direction: 'out' }, { side: 'company' }), { text: 'Pilot app left Acme Inc. on 18 Nov 2026. 4 tasks were blocked.', by: 'Moved by Synthetic Person', tone: 'amb', suggest: false });
  assert.equal(moveNotice(m, { side: 'company' }).suggest, true);
});

test('TM19 and TM5m words: banners, the start line, every pause reason TM9b lacked, notes and duties', () => {
  assert.equal(engineBanner({ engine: 'on', halted: false, scope_paused: false }), null);
  assert.equal(engineBanner({ engine: 'paused' }).text, 'Agents are paused on the platform. You can still run them yourself.');
  assert.equal(engineBanner({ engine: 'canary' }).text, 'Agents are paused on the platform. You can still run them yourself.');
  assert.match(engineBanner({ engine: 'on', halted: true }).text, /^Axal has paused all AI agents on the platform\./);
  assert.equal(engineBanner({ engine: 'on', scope_paused: true }).text, 'Agents are paused on this team. An editor can resume them.');
  assert.deepEqual(startLine({ available: true, value_microusd: 40_000 }), { button: 'Start · ~$0.04', hint: 'Holds up to $0.04 · you pay what it uses' });
  assert.deepEqual(startLine({ available: false }), { button: 'Start', hint: 'Cost can’t be estimated right now' });
  const p = (r) => pauseWords({ status: 'paused', paused_reason: r });
  assert.deepEqual(p('daily_limit'), { reason: 'Paused because it ran 20 times today.', hint: 'It can run again after midnight UTC. There is no automatic resume.', fix: 'Resume' });
  assert.equal(p('spend_limit').reason, 'Paused because its sponsor reached their AI spend limit.');
  assert.equal(p('ai_paused').fix, null);
  assert.equal(p('scope_archived').reason, 'Paused because its team was archived.');
  assert.deepEqual([p('persona_retired').reason, p('persona_retired').fix], ['Axal VC HQ retired this agent. It cannot be resumed.', null]);
  assert.equal(p('sponsor_left').fix, 'Choose a new sponsor');
  // The Worker's daily limit is the number the sentence says.
  assert.match(read('cloudflare-worker/src/agents/runtime.ts'), /export const DAILY_LIMIT = 20;/);
  assert.equal(noteLine({ by: null, at: '2026-11-09T00:00:00Z', expires_at: '2027-05-08T00:00:00Z' }), 'Added by the agent · 9 Nov 2026 · kept until 8 May 2027');
  assert.equal(noteProblem(''), 'Write the fact first.');
  assert.equal(noteProblem('x'.repeat(1001)), 'A note is at most 1,000 characters.');
  assert.equal(noteProblem('x'.repeat(1000)), null);
  assert.equal(dutyOutcome('out_of_tokens'), 'Skipped: its sponsor was out of AI tokens');
  assert.equal(dutyOutcome(null), 'Not run yet');
});

test('TM15: each suggested role is drawn as the persona that holds it, never one already on the team', () => {
  const personas = [{ key: 'vesta', name: 'Vesta', natural_fit: ['legal'] }, { key: 'aurel', name: 'Aurel', natural_fit: ['finance'] }, { key: 'sylva', name: 'Sylva', natural_fit: ['capital'] }];
  assert.equal(personaFor('general_counsel', personas, new Set())?.name, 'Vesta');
  assert.equal(personaFor('general_counsel', personas, new Set(['vesta'])), null);
  assert.equal(personaFor('investor_relations', personas, new Set())?.name, 'Aurel');
});

test('TM10a: the project’s goals, cost “Not recorded”, and a manager’s New goal; an engine that is off draws no goals', async () => {
  const goals = { goals: [
    { uid: 'g1', title: 'Reach 40 paying teams', status: 'open', parent: null, target_date: '2027-03-31', progress: { done: 7, total: 12 }, cost: { available: true, value_microusd: 4_800_000 } },
    { uid: 'g2', title: 'Close the seed round', status: 'open', parent: null, target_date: '2027-02-28', progress: { done: 2, total: 9 }, cost: { available: false } },
  ] };
  const m = await mount(h(GoalsView, { scope: 'project', id: 7, canManage: true }), [[/^GET .*\/teams\/project\/7\/goals$/, () => json(goals)]]);
  try {
    assert.equal(m.all('goal-row').length, 2);
    assert.deepEqual(m.all('goal-cost').map((n) => m.text(n)), ['$4.80 to date', 'Not recorded']);
    assert.ok(m.by('goals-new'));
    await m.press(m.by('goals-new'));
    await m.change(m.by('goal-title'), 'Ship self-serve onboarding');
    await m.change(m.by('goal-date'), '15/01/2027');
    await m.press(m.by('goal-save'));
    assert.match(m.text(), /The target date is a day, such as 2027-03-31\./);
    assert.equal(m.calls.filter((c) => c.method === 'POST').length, 0, 'a bad date is never sent');
  } finally { await m.unmount(); }
  const off = await mount(h(GoalsView, { scope: 'project', id: 7, canManage: true }), [[/goals$/, () => json({ error: 'agent_engine_off' }, 404)]]);
  try {
    assert.match(off.text(off.by('goals-off')), /AI agents are not switched on for this team\./);
    assert.equal(off.all('goal-row').length, 0);
  } finally { await off.unmount(); }
});

test('TM10c/d: the quote first, then the draft; Accept sends what was kept and retitled', async () => {
  const goal = { uid: 'g1', title: 'Ship self-serve onboarding', status: 'open', progress: { done: 0, total: 0 } };
  const m = await mount(h(GoalsView, { scope: 'project', id: 7, canManage: true }), [
    [/^GET .*\/teams\/project\/7\/goals$/, () => json({ goals: [goal] })],
    [/^GET .*\/teams\/project\/7\/tasks\?goal=g1$/, () => json({ tasks: [] })],
    [/^GET .*\/teams\/goals\/g1\/plan\/quote$/, () => json({ quote: { available: true, value_microusd: 120_000 }, by: 'eadwyn' })],
    [/^POST .*\/teams\/goals\/g1\/plan$/, () => json({ proposal: { uid: 'p1', by: 'eadwyn', plan: { items: [
      { title: 'Map the five onboarding steps', module: 'product', suggested_assignee: { role_key: 'cpo' }, depends_on: [], due_in_days: 5 },
      { title: 'Review the flow with three customers', module: 'product', suggested_assignee: { person: true }, depends_on: [0], due_in_days: null },
    ], dropped: ['2 items referred to modules that do not exist.'] } } }, 201)],
    [/^POST .*\/teams\/goals\/g1\/plan\/accept$/, () => json({ tasks: [{ uid: 't1' }] }, 201)],
  ]);
  try {
    await m.press(m.by('goal-open'));
    assert.equal(m.text(m.by('plan-quote')), '$0.12 · by Eadwyn');
    assert.match(m.text(m.by('plan-ask')), /Paid from your AI tokens\./);
    await m.press(m.by('plan-draft'));
    assert.equal(m.all('plan-item').length, 2);
    assert.match(m.text(m.by('plan-item')), /Due in 5 days/);
    assert.match(m.text(m.all('plan-item')[1]), /Waits on: Map the five onboarding steps · No due date/);
    assert.match(m.text(m.by('plan-dropped')), /2 items referred to modules/);
    await m.press(m.by('plan-accept'));
    const accept = m.calls.find((c) => /plan\/accept$/.test(c.url));
    assert.deepEqual(accept.body, { proposal: 'p1' });
    assert.match(m.text(m.by('plan-accepted')), /Accepted · 1 task created/);
  } finally { await m.unmount(); }
});

test('TM13: chains with indents and “task created”; refused loops in words; a read that fails says so', async () => {
  const m = await mount(h(HandoffTrail, { scope: 'project', id: 7, team: TEAM }), [[/handoffs$/, () => json({ chains: [{ uid: 'c1', steps: [
    { uid: 's1', depth: 0, from: { role_key: 'general_counsel' }, to: { role_key: 'investor_relations' }, title: 'check the pro-rata figures', status: 'accepted', decided_by: { uid: 'u1', name: 'Synthetic Person' }, task_created: true },
    { uid: 's2', depth: 1, from: { role_key: 'investor_relations' }, to: { role_key: 'cfo' }, title: 'draft the closing note', status: 'proposed', decided_by: null, task_created: false },
  ], refused: [{ reason: 'depth' }] }] })]]);
  try {
    const steps = m.all('handoff-step');
    assert.equal(steps.length, 2);
    assert.match(m.text(steps[0]), /Vesta.*Aurel: check the pro-rata figures.*Accepted.*accepted by Synthetic Person.*task created/);
    assert.match(m.text(steps[1]), /No agent/, 'a role nobody on the team holds');
    assert.match(m.text(m.by('handoffs-refused')), /Stopped: the chain is already three steps deep\./);
  } finally { await m.unmount(); }
  const bad = await mount(h(HandoffTrail, { scope: 'project', id: 7 }), [[/handoffs$/, () => json({ code: 'x', message: 'boom' }, 500)]]);
  try { assert.match(bad.text(bad.by('handoffs-error')), /Handoffs could not be read\. That is not the same as having none\./); } finally { await bad.unmount(); }
});

test('TM14: rows by persona, too few to rate, 90 days re-reads with ?days=90, and skills null vs []', async () => {
  const body = (skills) => ({ days: 30, roles: [
    { role_key: 'general_counsel', decided: 48, acceptance: 0.82, edit: 0.11, discard: 0.07, median_decision_h: 3.2, open_past_3d: 1, expired: 0, cost_per_accepted: { available: true, value_microusd: 140_000 }, refused: [] },
    { role_key: 'research_analyst', decided: 7, acceptance: null, edit: null, discard: null, note: 'Too few decisions to rate (7)', median_decision_h: null, open_past_3d: 0, expired: 0, cost_per_accepted: { available: false }, refused: [] },
  ], skills });
  const m = await mount(h(AgentEvaluation, { scope: 'company', id: 'c1', team: TEAM }), [[/evaluation\?days=30$/, () => json(body(null))], [/evaluation\?days=90$/, () => json(body([]))]]);
  try {
    const rows = m.all('eval-row');
    assert.match(m.text(rows[0]), /^Vesta82%11%7%3\.2 h10\$0\.14None$/);
    assert.match(m.text(rows[1]), /An agent no longer on this team.*Too few decisions to rate \(7\).*Not recorded/);
    assert.match(m.text(m.by('eval-skills')), /Skill checks could not be read\./);
    await m.press(m.by('eval-days-90'));
    assert.ok(m.calls.some((c) => /evaluation\?days=90$/.test(c.url)));
    assert.match(m.text(m.by('eval-skills')), /No Axal skills to check/);
  } finally { await m.unmount(); }
});

test('TM18: a move’s notice, Dismiss kept in this browser; no moves draws nothing', async () => {
  const mv = { moves: [{ direction: 'in', project: { id: 7, name: 'Pilot app' }, from: null, to: { uid: 'c2', name: 'Northwind Labs' }, by: null, at: '2026-11-18T10:00:00Z', blocked_tasks: 0 }] };
  const m = await mount(h(MoveNotices, { scope: 'project', id: 7 }), [[/moves\?limit=5$/, () => json(mv)]]);
  try {
    assert.equal(m.text(m.by('move-notice')).startsWith('This project joined Northwind Labs on 18 Nov 2026. Its agents stayed with the project.Moved by: Not recorded'), true);
    await m.press(m.by('move-dismiss'));
    assert.equal(m.by('move-notice'), undefined);
  } finally { await m.unmount(); }
  const none = await mount(h(MoveNotices, { scope: 'project', id: 7 }), [[/moves\?limit=5$/, () => json({ moves: [] })]]);
  try { assert.equal(none.by('move-notice'), undefined); } finally { await none.unmount(); }
});

test('TM19a: pausing confirms first and PUTs paused; the stepper stays within 1 to 5; a reader gets no controls', async () => {
  let engine = { engine: 'on', halted: false, scope_paused: false, max_parallel_runs: 5, autonomy: 'manual' };
  const m = await mount(h(EngineControl, { scope: 'project', id: 7, canManage: true }), [
    [/^GET .*\/engine$/, () => json(engine)],
    [/^PUT .*\/engine$/, (_u, b) => { engine = { ...engine, ...(b.paused != null ? { scope_paused: b.paused } : {}), ...(b.max_parallel_runs ? { max_parallel_runs: b.max_parallel_runs } : {}) }; return json(engine); }],
  ]);
  try {
    assert.match(m.text(m.by('engine-control')), /Run at most 5 agents at once.*A person starts each task.*Set by Axal VC/);
    assert.equal(m.props(m.by('engine-more')).disabled, true, 'six at once is never offered');
    await m.press(m.by('engine-pause'));
    assert.ok(m.by('engine-pause-confirm'));
    assert.equal(m.calls.filter((c) => c.method === 'PUT').length, 0, 'nothing is paused before the confirm');
    await m.press(m.by('engine-pause-yes'));
    assert.deepEqual(m.calls.find((c) => c.method === 'PUT').body, { paused: true });
    assert.match(m.text(m.by('engine-team-paused')), /Agents are paused on this team\. An editor can resume them\./);
  } finally { await m.unmount(); }
  const ro = await mount(h(EngineControl, { scope: 'project', id: 7, canManage: false }), [[/engine$/, () => json(engine)]]);
  try { assert.match(ro.text(ro.by('engine-reader')), /You can read these settings\. An editor changes them\./); } finally { await ro.unmount(); }
});

test('TM19f: Start shows the quote first; a refusal is its own sentence', async () => {
  const m = await mount(h(StartTask, { task: { uid: 't1' }, agentName: 'Vesta' }), [
    [/^GET .*\/tasks\/t1\/quote$/, () => json({ quote: { available: true, value_microusd: 40_000 } })],
    [/^POST .*\/tasks\/t1\/start$/, () => refusal('scope_paused', 'Agents are paused on this team. An editor can resume them.', 403)],
  ]);
  try {
    assert.equal(m.text(m.by('start-button')), 'Start · ~$0.04');
    assert.equal(m.text(m.by('start-hint')), 'Holds up to $0.04 · you pay what it uses');
    await m.press(m.by('start-button'));
    assert.equal(m.text(m.by('start-refused')), 'Agents are paused on this team. An editor can resume them.');
  } finally { await m.unmount(); }
});

test('TM5m: notes with who and how long; Add refuses a blank or long note before sending; Forget everything confirms first', async () => {
  const notes = { notes: [{ uid: 'n1', kind: 'decision', body: 'Accepted the synthetic term sheet.', by: { uid: 'u1', name: 'Synthetic Person' }, at: '2026-11-18T00:00:00Z', expires_at: '2027-02-17T00:00:00Z' }], retention: { text: 'Kept for the synthetic window.' } };
  const m = await mount(h(AgentMemory, { uid: 'a1', canManage: true }), [
    [/^GET .*\/agents\/a1\/memory$/, () => json(notes)],
    [/^DELETE .*\/agents\/a1\/memory$/, () => json({ ok: true, forgotten: 1 })],
  ]);
  try {
    assert.match(m.text(m.by('memory-note')), /Decision.*Added by Synthetic Person · 18 Nov 2026 · kept until 17 Feb 2027/);
    assert.equal(m.text(m.by('memory-retention')), 'Kept for the synthetic window.');
    await m.change(m.by('memory-draft'), 'x'.repeat(1001));
    assert.match(m.text(), /A note is at most 1,000 characters\./);
    await m.press(m.by('memory-forget-all'));
    assert.equal(m.calls.filter((c) => c.method === 'DELETE').length, 0);
    await m.press(m.by('memory-forget-all-yes'));
    assert.equal(m.calls.filter((c) => c.method === 'DELETE').length, 1);
    assert.match(m.text(m.by('memory-said')), /Forgot 1 note/);
  } finally { await m.unmount(); }
});

test('the wiring: Work has Goals and the banner; Team has moves, evaluation, handoffs; Settings has the engine; the profile has memory', () => {
  assert.match(read('frontend/src/pages/work/workModel.js'), /\{ key: 'goals', label: 'Goals' \}/);
  const work = read('frontend/src/pages/work/WorkPage.jsx');
  for (const s of ['<GoalsView scope="project"', '<EngineBanner scope="project"', '<StartTask ']) assert.ok(work.includes(s), s);
  const team = read('frontend/src/pages/team/TeamAgentsPage.jsx');
  for (const s of ['<MoveNotices ', '<AgentEvaluation ', '<GoalsView scope="company"', '<HandoffTrail scope="project"', '<SuggestAgentsSheet ']) assert.ok(team.includes(s), s);
  assert.ok(read('frontend/src/pages/team/TeamSettingsTab.jsx').includes('<EngineControl '));
  const profile = read('frontend/src/pages/team/AgentProfileSheet.jsx');
  assert.ok(profile.includes('<AgentMemory ') && profile.includes('<AgentDuties '));
  // The canvases are in the intake queue, with no upload path or stray uuid left in them.
  for (const f of ['Agent Engine Page.dc.html', 'Agent Engine · Boards.dc.html']) {
    const html = read(`design/incoming/${f}`);
    assert.doesNotMatch(html, /uploads\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, f);
  }
});
