// D1614 W6 (#3974) — WK5 the run sheet, WK6 a project's activity feed, WK7 its
// Workload. The components run against a stubbed fetch through the real
// clients (W3's run, retry and feed; W4's workload and time block); every
// fixture is worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { detailOutcome, feedRow, runChip, runSheet, scheduleBody, spendWords, weekLabel, workloadRows, workloadSessions } from '../src/pages/work/workModel.js';
import { workAdapter } from '../src/pages/work/workAdapter.js';
import { ItemSheet, RunSheet } from '../src/pages/work/WorkPage.jsx';
import ActivityFeed from '../src/pages/work/ActivityFeed.jsx';
import WorkloadView from '../src/pages/work/WorkloadView.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FAILED = {
  run: { uid: 'run-aaaa-0001', status: 'failed' }, steps: [], cost: null,
  detail: {
    agent: { uid: 'a1', name: 'Carla', role: 'Finance', model: '@cf/openai/gpt-oss-120b' },
    skill: { uid: 'f'.repeat(32), name: 'Prepare franchise tax figures', version: 2 },
    work: { task: { uid: 't1', title: 'Prepare Delaware franchise tax figures' }, instruction: 'Use the authorised-shares method.' },
    sources: ['Cap table', 'Mercury balance'], tools: ['mercury.read'], proposals: [],
    outcome: { kind: 'failed', reason_code: 'failed', reason_text: 'The Mercury connection expired, so the balance could not be read.', retryable: true },
    started_at: '2026-11-12 18:02:00', finished_at: '2026-11-12 18:02:41', duration_ms: 41_000,
    cost: { held: { available: true, value_microusd: 400_000 }, charged: { available: false }, model: '@cf/openai/gpt-oss-120b', tokens: { available: true, input: 1500, output: 420 } },
  },
};
const COMPLETED = {
  ...FAILED,
  detail: {
    ...FAILED.detail, skill: null,
    outcome: { kind: 'completed', awaiting_decision: false },
    proposals: [{ uid: 'p1', status: 'accepted', decided_by: { uid: 'u-2', name: 'Jordan Reyes' } }, { uid: 'p2', status: 'proposed', decided_by: null }],
    cost: { held: { available: false }, charged: { available: true, value_microusd: 120_000 }, model: null, tokens: { available: false } },
  },
};

test('W6 words: the run sheet\'s rows, a cost never read is "Not recorded" and never $0, a failed run says why', () => {
  const s = runSheet(FAILED);
  assert.equal(s.title, 'Failed');
  assert.equal(s.retryable, true);
  const rows = Object.fromEntries(s.rows);
  assert.equal(rows.Skill, 'Prepare franchise tax figures · v2');
  assert.equal(rows['Worked on'], 'Prepare Delaware franchise tax figures');
  assert.equal(rows.Read, 'Cap table · Mercury balance · mercury.read');
  assert.equal(rows.Outcome, 'Failed. The Mercury connection expired, so the balance could not be read.');
  assert.equal(rows.Timing, 'Started 18:02 · stopped 18:02 · 41 s');
  // Mutation checked: `spendWords` answering $0.00 for an unknown → "charged $0.00" and this fails.
  assert.equal(rows.Cost, 'Held $0.40 · charged Not recorded · 1,920 tokens · @cf/openai/gpt-oss-120b');
  const c = Object.fromEntries(runSheet(COMPLETED).rows);
  assert.equal(c.Produced, '2 proposals · accepted by Jordan Reyes · waiting');
  assert.equal(c.Skill, 'Not recorded');
  assert.equal(c.Cost, 'Held Not recorded · charged $0.12 · Not recorded · @cf/openai/gpt-oss-120b');
  assert.equal(runSheet(COMPLETED).retryable, false);
  // A failure a retry would only repeat is not retryable.
  assert.equal(detailOutcome({ kind: 'failed', reason_text: 'Not ready.', retryable: false }).retryable, false);
  assert.equal(spendWords(null), 'Not recorded');
  assert.equal(spendWords({ available: true, value_microusd: 0 }), '$0.00', 'a recorded zero is a zero');
});

test('W6 words: feed rows, week labels, workload rows (amber only over a recorded capacity), a time block', () => {
  assert.equal(feedRow({ type: 'task_event', verb: 'moved', to: 'in_review', by: { kind: 'person', uid: 'u-2', name: 'Jordan Reyes' }, task: { title: 'Runway note' }, at: '2026-11-12 10:02:11' }).text,
    'Jordan Reyes moved “Runway note” to In review');
  const run = feedRow({ type: 'agent_run', run_uid: 'r1', by: { kind: 'agent', uid: 'a1', name: 'Carla' }, task: { title: 'Franchise tax' }, outcome: { kind: 'completed' }, cost: { available: false }, at: '2026-11-12 09:16:00' });
  assert.deepEqual([run.text, run.cost, run.run, run.at], ['Carla ran on “Franchise tax” · Completed', 'Not recorded', 'r1', '2026-11-12 09:16']);
  assert.equal(feedRow({ type: 'proposal_decision', decision: 'discarded', by: { kind: 'person', name: 'Sam' }, task: { title: 'Deck' } }).text, 'Sam discarded a proposal on “Deck”');
  assert.equal(weekLabel('2026-11-09'), 'W46 · 9–15 Nov');
  assert.equal(weekLabel('2026-11-30'), 'W49 · 30 Nov–6 Dec');
  const rows = workloadRows({
    people: [
      { person: { uid: 'u-2', name: 'Ada' }, capacity: { available: true, value: 8 }, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 11, unestimated: 1, over_capacity: true }], unscheduled: [] },
      { person: { uid: 'u-3', name: 'Bo' }, capacity: { available: false, reason: 'Not recorded' }, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 20, unestimated: 0, over_capacity: null }], unscheduled: [] },
    ],
    agents: [{ agent: { uid: 'a1', name: 'Carla', role_key: 'cfo' }, capacity: null, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 4, unestimated: 0, over_capacity: null }], unscheduled: [] }],
  });
  assert.deepEqual(rows.map((r) => [r.kind, r.capacity, r.cells[0].over, r.cells[0].load]), [
    ['person', '8 pts a week', true, '11 pts · 1 not estimated'],
    // Mutation checked: `over` from the points alone → Bo (no capacity recorded) reads over and this fails.
    ['person', 'Not recorded', false, '20 pts'],
    ['agent', null, false, '4 pts'],
  ]);
  assert.deepEqual(scheduleBody('2026-11-16', '09:00', '11:00'), { body: { scheduled_start: '2026-11-16T09:00:00Z', scheduled_end: '2026-11-16T11:00:00Z' } });
  assert.match(scheduleBody('2026-11-16', '11:00', '09:00').error, /ends after it starts/);
  assert.match(scheduleBody('', '09:00', '11:00').error, /Choose a day/);
});

/** Mount with a stubbed Worker; `routes` are [regex over "METHOD url", answer(url, body)]. */
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
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('WK5: a failed run shows its reason and Retry; Retry calls the route', async () => {
  const m = await mount(h(RunSheet, { uid: 'run-aaaa-0001', onClose() {} }), [
    [/GET .*\/api\/teams\/runs\/run-aaaa-0001$/, () => json(FAILED)],
    [/POST .*\/api\/teams\/runs\/run-aaaa-0001\/retry$/, () => json({ run: { uid: 'run-aaaa-0002', status: 'admitted' } }, 202)],
  ]);
  try {
    assert.match(m.text(m.by('work-run-fields')), /The Mercury connection expired/);
    assert.match(m.text(m.by('work-run-fields')), /charged Not recorded/);
    assert.doesNotMatch(m.text(), /\$0\.00/);
    // Mutation checked: the Retry button shown only for a status of 'failed' on the old shape → it is missing here and this fails.
    await m.press(m.by('work-run-retry'));
    assert.ok(m.calls.some((c) => c.method === 'POST' && /\/runs\/run-aaaa-0001\/retry$/.test(c.url)), 'the retry route');
    assert.equal(m.text(m.by('work-run-retry')), 'Retry started');
  } finally { await m.unmount(); }
  const ok = await mount(h(RunSheet, { uid: 'run-aaaa-0001', onClose() {} }), [[/GET .*\/runs\/run-aaaa-0001$/, () => json(COMPLETED)]]);
  try { assert.equal(ok.by('work-run-retry'), undefined, 'a completed run has no Retry'); } finally { await ok.unmount(); }
});

test('WK6: the feed filters by People · AI agents · Both and by one person, pages with Show older, and names nobody by email', async () => {
  const ITEMS = [
    { id: 'e1', type: 'task_event', verb: 'completed', by: { kind: 'person', uid: 'u-2', name: 'Jordan Reyes' }, task: { uid: 't1', title: 'Runway note' }, at: '2026-11-12 10:02:00' },
    { id: 'r1', type: 'agent_run', run_uid: 'run-aaaa-0001', by: { kind: 'agent', uid: 'a1', name: 'Carla', role_key: 'cfo' }, task: { uid: 't2', title: 'Franchise tax' }, outcome: { kind: 'completed' }, cost: { available: true, value_microusd: 80_000 }, at: '2026-11-12 09:16:00' },
  ];
  const m = await mount(h(ActivityFeed, { projectId: 7 }), [
    [/GET .*\/api\/teams\/project\/7\/activity/, (url) => {
      const q = new URL(url, 'https://x.test').searchParams;
      if (q.get('before')) return json({ items: [{ ...ITEMS[0], id: 'e0', task: { uid: 't0', title: 'Older thing' } }], next_cursor: null });
      if (q.get('person') === 'u-2') return json({ items: [ITEMS[0]], next_cursor: null, lists: { worked_on: [{ uid: 't3', title: 'Board pack' }], completed: [{ uid: 't1', title: 'Runway note' }], completed_last_7_days: 1 } });
      return json({ items: ITEMS, next_cursor: '2026-11-12 09:16:00|r000000000001' });
    }],
  ]);
  try {
    assert.equal(m.all('team-activity-row').length, 2);
    assert.match(m.text(m.all('team-activity-row')[1]), /Carla ran on “Franchise tax” · Completed · \$0\.08/);
    await m.press(m.by('team-activity-who-people'));
    // Mutation checked: the who filter left out of the request → no ?who=people and this fails.
    assert.ok(m.calls.some((c) => /[?&]who=people/.test(c.url)), 'the People filter is the Worker\'s');
    await m.press(m.by('team-activity-who-both'));
    await m.press(m.by('team-activity-older'));
    assert.ok(m.calls.some((c) => /before=2026-11-12/.test(c.url)));
    assert.match(m.text(), /Older thing/);
    const pick = m.by('team-activity-pick');
    await act(async () => { m.props(pick).onChange({ target: { value: 'person:u-2' } }); });
    await m.settle();
    assert.ok(m.calls.some((c) => /[?&]person=u-2/.test(c.url)));
    assert.match(m.text(m.by('team-activity-lists')), /Worked on · Board pack.*Completed · Runway note.*1 completed in the last 7 days/s);
    assert.doesNotMatch(m.text(), /@/);
  } finally { await m.unmount(); }
});

test('WK7: Workload draws rows and weeks, amber over capacity; a drop reassigns through W1\'s PATCH; Schedule work saves a time block', async () => {
  const DATA = {
    weeks: ['2026-11-09', '2026-11-16'],
    people: [
      { person: { uid: 'u-2', name: 'Ada Shah' }, capacity: { available: true, value: 8 }, weeks: [
        { week_start: '2026-11-09', items: [{ uid: 't1', title: 'Seed deck v4', estimate_points: 6 }, { uid: 't2', title: 'Board pack', estimate_points: 5 }], estimate_points: 11, unestimated: 0, over_capacity: true },
        { week_start: '2026-11-16', items: [], estimate_points: 0, unestimated: 0, over_capacity: false }], unscheduled: [{ uid: 't9', title: 'Pilot onboarding', estimate_points: 3 }] },
      { person: { uid: 'u-3', name: 'Jordan Reyes' }, capacity: { available: false, reason: 'Not recorded' }, weeks: [
        { week_start: '2026-11-09', items: [], estimate_points: 0, unestimated: 0, over_capacity: null },
        { week_start: '2026-11-16', items: [], estimate_points: 0, unestimated: 0, over_capacity: null }], unscheduled: [] },
    ],
    agents: [],
  };
  const m = await mount(h(WorkloadView, { projectId: 7, onOpenItem() {}, onNotice() {} }), [
    [/GET .*\/api\/teams\/project\/7\/work\/workload/, () => json(DATA)],
    [/PATCH .*\/api\/teams\/tasks\/t\d$/, () => json({ task: { uid: 't1' } })],
  ]);
  try {
    assert.deepEqual(m.all('work-workload-week').map((n) => m.text(n)), ['W46 · 9–15 Nov', 'W47 · 16–22 Nov']);
    assert.equal(m.all('work-workload-row').length, 2);
    const cells = m.all('work-workload-cell');
    assert.equal(m.props(cells[0])['data-over'], 'true');
    assert.equal(m.props(cells[2])['data-over'], undefined, 'no capacity recorded: never amber');
    // Drag Seed deck v4 from Ada's row to Jordan's first week.
    await act(async () => { m.props(m.all('work-workload-bar')[0]).onDragStart({}); });
    await act(async () => { await m.props(cells[2]).onDrop({ preventDefault() {} }); });
    await m.settle();
    const assign = m.calls.find((c) => c.method === 'PATCH' && /\/tasks\/t1$/.test(c.url));
    // Mutation checked: the drop sending the bar's own row → the assignee is Ada and this fails.
    assert.deepEqual(assign?.body, { assignee: { kind: 'person', uid: 'u-3' } });
    // A drop on the bar's own row does nothing.
    const before = m.calls.length;
    await act(async () => { m.props(m.all('work-workload-bar')[0]).onDragStart({}); });
    await act(async () => { await m.props(m.all('work-workload-cell')[1]).onDrop({ preventDefault() {} }); });
    assert.equal(m.calls.filter((c) => c.method === 'PATCH').length, m.calls.slice(0, before).filter((c) => c.method === 'PATCH').length);
    // Schedule work for the unscheduled item.
    await m.press(m.by('work-workload-schedule'));
    await act(async () => { m.props(m.by('work-schedule-day')).onChange({ target: { value: '2026-11-17' } }); });
    await m.press(m.by('work-schedule-save'));
    const block = m.calls.find((c) => c.method === 'PATCH' && /\/tasks\/t9$/.test(c.url));
    assert.deepEqual(block?.body, { scheduled_start: '2026-11-17T09:00:00Z', scheduled_end: '2026-11-17T11:00:00Z' });
    assert.doesNotMatch(m.text(), /@/);
  } finally { await m.unmount(); }
});

// #3972: the workload read carries agents' scheduled sessions (`WORKLOAD_DEPS.agentSessions`). A session slot is a bar in
// its week that is never dragged and never opened as a task; a repeat has one per slot; the week counts it as not estimated.
test('WK7 sessions: an agent\'s session slots are teal bars, not dragged or opened as a task; agentSessions reads them from the workload', async () => {
  const slot = (at) => ({ uid: 's-weekly', title: 'Weekly brief', estimate_points: null, when: { kind: 'scheduled', at }, session: { uid: 's-weekly', cadence: 'daily' } });
  const DATA = {
    weeks: ['2027-03-08'],
    people: [],
    agents: [{ agent: { uid: 'a1', name: 'Carla', role_key: 'cfo' }, capacity: null, weeks: [
      { week_start: '2027-03-08', items: [{ uid: 't1', title: 'Runway note', estimate_points: 2 }, slot('2027-03-11 09:00:00'), slot('2027-03-12 09:00:00')],
        estimate_points: 2, unestimated: 2, over_capacity: null }], unscheduled: [] },
    { agent: { uid: 'a2', name: 'Ivo', role_key: 'cto' }, capacity: null, weeks: [{ week_start: '2027-03-08', items: [], estimate_points: 0, unestimated: 0, over_capacity: null }], unscheduled: [] }],
  };
  assert.deepEqual(workloadSessions(DATA), [{ agent: DATA.agents[0].agent, items: [slot('2027-03-11 09:00:00'), slot('2027-03-12 09:00:00')] }], 'tasks and agents with no session left out');
  const opened = [];
  const m = await mount(h(WorkloadView, { projectId: 7, onOpenItem(uid) { opened.push(uid); }, onNotice() {} }), [
    [/GET .*\/api\/teams\/project\/7\/work\/workload/, () => json(DATA)],
  ]);
  try {
    // Mutation checked: the session branch dropped → the slots are draggable task buttons (three bars) and this fails.
    assert.equal(m.all('work-workload-bar').length, 1, 'only the task is a task bar');
    const sessions = m.all('work-workload-session');
    assert.deepEqual(sessions.map((n) => m.text(n)), ['Weekly brief · agent session', 'Weekly brief · agent session'], 'one per slot');
    assert.equal(m.props(sessions[0]).draggable, undefined);
    assert.equal(m.props(sessions[0]).onClick, undefined, 'never opened as a task');
    assert.match(m.text(m.all('work-workload-cell')[0]), /2 pts · 2 not estimated/);
    const r = await workAdapter.agentSessions(7, { weeks: 1 });
    // Mutation checked: agentSessions answering the off block → available is false and this fails.
    assert.deepEqual([r.available, r.data.map((x) => [x.agent.uid, x.items.length])], [true, [['a1', 2]]]);
    assert.ok(m.calls.some((c) => /\/work\/workload\?weeks=1$/.test(c.url)), 'through the workload read');
  } finally { await m.unmount(); }
});


test('#3968: the item sheet opens its recorded latest run, and preserves a supplied history', async () => {
  assert.equal(runChip({ status: 'skipped' })?.words, 'Skipped');
  assert.equal(runChip({ status: 'cancelled' })?.words, 'Cancelled');
  const opened = [];
  for (const task of [
    { uid: 'task-live', title: 'Recorded work', column: 'in_review', run: { uid: 'last-run', status: 'waiting', charged_microusd: null } },
    { uid: 'task-live', title: 'Recorded work', column: 'in_review', run: { uid: 'last-run', status: 'waiting' }, runs: [{ uid: 'history-run', status: 'completed' }] },
    { uid: 'task-live', title: 'Recorded work', column: 'ready', run: null },
  ]) {
    const m = await mount(h(ItemSheet, { uid: 'task-live', onClose() {}, onRun: (uid) => opened.push(uid) }), [
      [/GET .*\/tasks\/task-live$/, () => json({ task })],
    ]);
    try {
      const uid = task.runs ? 'history-run' : task.run ? 'last-run' : null;
      if (uid) { if (!task.runs) assert.match(m.text(), /Waiting for you/); assert.ok(m.by(`work-item-run-${uid}`)); await m.press(m.by(`work-item-run-${uid}`)); }
      else { assert.ok(!m.by('work-item-run-last-run')); assert.match(m.text(), /Agent runsNone/); }
    } finally { await m.unmount(); }
  }
  assert.deepEqual(opened, ['last-run', 'history-run']);
});
