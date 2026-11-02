/**
 * D1530 (#3849, E5 of #3742) — duties, handoffs and memory. On E3's world
 * (`_agent_engine_fixture.ts`: the real migrated schema, the scope objects,
 * a fake Workflow, queue and agentRun). Every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_duties_handoffs_d1530.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, COMPANY, MEMBER, PROJECT, SPONSOR, STRANGER, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { runTaskLoop, buildContext } from '../src/agents/loop.ts';
import { sweepAgentDuties } from '../src/agents/sweep.ts';
import { eraseAccountAgents } from '../src/agents/erasure.ts';
import { DUTY_TEMPLATES, claimDuty, nextDue, sqlTime, sweepDuties, type DutyDeps, type DutyRow } from '../src/services/agents/duties.ts';
import { DEPTH_MAX, HANDS_OFF_TO, parseHandoff, proposeHandoff } from '../src/services/agents/handoffs.ts';
import { RETENTION, eraseAgentData, exportAgentData, onAgentRemoved, purgeExpired, retentionText } from '../src/services/agents/memory.ts';
import { decideRail } from '../src/services/railProposals.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import engineRoutes from '../src/routes/agent_engine.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const CFO = 52, GC = 53, CTO = 54;
const count = (w: World, sql: string, ...b: unknown[]) => Number((w.db.prepare(sql).get(...b) as any).n);
const tasksOf = (w: World, agentId: number) => w.db.prepare('SELECT * FROM scope_tasks WHERE assignee_agent_id = ? ORDER BY id').all(agentId) as any[];

function app(w: World) {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', engineRoutes);
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app(w).request(`/api/teams${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env);
  return { status: r.status, body: await r.json() as any };
}
/** Every read key answers (the CFO's rule book names reads that have no function on main yet). */
const READ_ALL: any = new Proxy({}, { get: () => async () => ({ ok: true, data: {} }) });
const uidOf = (w: World, id: number) => (w.db.prepare('SELECT uid FROM team_agents WHERE id = ?').get(id) as any).uid;

/** A duty row for the CFO, due at `due`. */
function duty(w: World, agentId: number, due: string, extra: Partial<DutyRow> = {}): DutyRow {
  w.db.prepare(`INSERT INTO agent_duties (uid, agent_id, template_key, title, module, option, cadence, weekday, day_of_month, hour_utc, next_due_at, status)
    VALUES (?, ?, 'cfo.runway', 'State the runway', 'use-of-funds', 'draft:raise/use-of-funds-runway', 'weekly', 1, NULL, 8, ?, ?)`)
    .run(`duty-${agentId}-${due.replace(/\D/g, '')}`, agentId, due, extra.status ?? 'active');
  return w.db.prepare('SELECT * FROM agent_duties ORDER BY id DESC LIMIT 1').get() as DutyRow;
}
const deps = (o: Partial<DutyDeps> = {}): DutyDeps & { told: number[]; admitted: number[] } => {
  const told: number[] = [], admitted: number[] = [];
  return { tokensLeft: async () => true, admit: null, tell: async (_e, _a, t) => { told.push(t.id); }, ...o, told, admitted };
};

// ── Duties ──────────────────────────────────────────────────────────────────

test('the templates are the roles\' own; a duty is added by a manager, once, only from its role', async () => {
  const w = world();
  try {
    w.agent(CFO, 'cfo'); w.agent(CTO, 'cto');
    assert.ok(DUTY_TEMPLATES.some((t) => t.key === 'cfo.runway' && t.role_key === 'cfo'));
    const add = await call(w, SPONSOR, 'POST', `/agents/${uidOf(w, CFO)}/duties`, { template: 'cfo.runway', cadence: 'weekly', weekday: 1, hour_utc: 8 });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.deepEqual([add.body.duty.template, add.body.duty.cadence, add.body.duty.weekday, add.body.duty.hour_utc], ['cfo.runway', 'weekly', 1, 8]);
    assert.equal(new Date(`${add.body.duty.next_due_at.replace(' ', 'T')}Z`).getUTCDay(), 1, 'the next slot is a Monday');
    assert.ok('available' in add.body.duty.est_month, 'an estimate, or available: false; never a bare 0');
    assert.equal((await call(w, SPONSOR, 'POST', `/agents/${uidOf(w, CFO)}/duties`, { template: 'cfo.runway' })).body.error, 'duty_exists');
    const wrong = await call(w, SPONSOR, 'POST', `/agents/${uidOf(w, CFO)}/duties`, { template: 'cto.roadmap' });
    assert.deepEqual([wrong.status, wrong.body.error], [422, 'template_not_in_role']);
    // Mutation checked: the role check dropped → the COO's weekly plan (a module and option the CEO's rule book allows) is added to the CEO.
    w.agent(AGENT, 'ceo');
    const other = await call(w, SPONSOR, 'POST', `/agents/${uidOf(w, AGENT)}/duties`, { template: 'coo.weekly_plan' });
    assert.deepEqual([other.status, other.body.error], [422, 'template_not_in_role'], 'another role\'s duty, even one its rule book would run');
    assert.equal((await call(w, STRANGER, 'POST', `/agents/${uidOf(w, CFO)}/duties`, { template: 'cfo.funds_check' })).status, 404);
    const list = await call(w, SPONSOR, 'GET', `/agents/${uidOf(w, CFO)}/duties`);
    assert.equal(list.body.duties.length, 1);
    const pause = await call(w, SPONSOR, 'PATCH', `/duties/${list.body.duties[0].uid}`, { status: 'paused', cadence: 'monthly', day_of_month: 31 });
    assert.deepEqual([pause.body.duty.status, pause.body.duty.cadence, pause.body.duty.day_of_month], ['paused', 'monthly', 31]);
    assert.equal((await call(w, SPONSOR, 'DELETE', `/duties/${list.body.duties[0].uid}`)).body.ok, true);
    assert.equal((await call(w, SPONSOR, 'GET', `/agents/${uidOf(w, CFO)}/duties`)).body.duties.length, 0);
  } finally { w.close(); }
});

test('nextDue: weekly to the next Monday 08:00, daily to the next hour slot, monthly to the month\'s last day when it is short', () => {
  const at = new Date('2026-11-03T09:00:00Z'); // a Tuesday
  assert.equal(nextDue({ cadence: 'weekly', weekday: 1, day_of_month: null, hour_utc: 8 }, at).toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(nextDue({ cadence: 'daily', weekday: null, day_of_month: null, hour_utc: 8 }, at).toISOString(), '2026-11-04T08:00:00.000Z');
  assert.equal(nextDue({ cadence: 'monthly', weekday: null, day_of_month: 31, hour_utc: 8 }, at).toISOString(), '2026-11-30T08:00:00.000Z');
  assert.equal(nextDue({ cadence: 'weekly', weekday: 1, day_of_month: null, hour_utc: 8 }, new Date('2026-11-09T08:00:00Z')).toISOString(), '2026-11-16T08:00:00.000Z', 'the slot itself is past');
});

test('claim before act: a claim that changed no row creates no task (two sweeps read the same due duty)', async () => {
  // Mutation checked: the claim without `AND next_due_at = ?` lets the second claim through → two tasks.
  const w = world();
  try {
    w.agent(CFO, 'cfo');
    const d = duty(w, CFO, '2026-11-09 08:00:00');
    const now = new Date('2026-11-09T08:01:00Z');
    const first = await claimDuty(w.env, d, now, deps());
    const second = await claimDuty(w.env, d, now, deps());
    assert.deepEqual([first.outcome, second.outcome], ['task_created', 'not_claimed']);
    const t = tasksOf(w, CFO);
    assert.equal(t.length, 1);
    assert.deepEqual([t[0].kind, t[0].source_kind, t[0].source_ref, t[0].status, t[0].module, t[0].option],
      ['duty', 'duty', d.uid, 'open', 'use-of-funds', 'draft:raise/use-of-funds-runway']);
  } finally { w.close(); }
});

test('a missed duty runs once and jumps to the next future slot; manual autonomy runs nothing and tells the sponsor', async () => {
  const w = world();
  try {
    w.agent(CFO, 'cfo');
    duty(w, CFO, '2026-10-12 08:00:00'); // three Mondays missed
    const now = new Date('2026-11-03T09:00:00Z');
    const dp = deps();
    const r = await sweepDuties(w.env, now, dp);
    assert.equal(r.task_created, 1, 'once, not three times');
    assert.equal((w.db.prepare('SELECT next_due_at FROM agent_duties').get() as any).next_due_at, '2026-11-09 08:00:00');
    assert.equal((await sweepDuties(w.env, now, dp)).task_created, 0);
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_task_runs'), 0, 'manual: no run before a person presses Start');
    assert.equal(dp.told.length, 1, 'the sponsor is told');
  } finally { w.close(); }
});

test('a paused agent\'s duty advances and records skipped; an out-of-tokens sponsor\'s duty is skipped, not queued', async () => {
  // Mutation checked: queueing when `tokensLeft` is false → a task appears for the out-of-tokens sponsor.
  const w = world();
  try {
    w.agent(CFO, 'cfo', { status: 'paused' });
    const d = duty(w, CFO, '2026-11-09 08:00:00');
    const now = new Date('2026-11-09T08:01:00Z');
    assert.equal((await claimDuty(w.env, d, now, deps())).outcome, 'skipped:agent_paused');
    const row = w.db.prepare('SELECT next_due_at, last_outcome FROM agent_duties WHERE id = ?').get(d.id) as any;
    assert.deepEqual([row.next_due_at, row.last_outcome], ['2026-11-16 08:00:00', 'skipped:agent_paused']);
    assert.equal(tasksOf(w, CFO).length, 0);
    w.db.prepare("UPDATE team_agents SET status = 'active' WHERE id = ?").run(CFO);
    const d2 = w.db.prepare('SELECT * FROM agent_duties WHERE id = ?').get(d.id) as DutyRow;
    assert.equal((await claimDuty(w.env, d2, new Date('2026-11-16T08:01:00Z'), deps({ tokensLeft: async () => false }))).outcome, 'skipped:no_tokens');
    assert.equal(tasksOf(w, CFO).length, 0, 'no task queued while the sponsor has no tokens');
    const d3 = w.db.prepare('SELECT * FROM agent_duties WHERE id = ?').get(d.id) as DutyRow;
    assert.equal((await claimDuty(w.env, d3, new Date('2026-11-23T08:01:00Z'), deps({ tokensLeft: async () => null }))).outcome, 'task_created', 'an unreadable balance does not skip: a task spends nothing');
  } finally { w.close(); }
});

test('the sweep block: off or halted claims nothing; self_start asks the scope\'s object to admit the duty\'s task', async () => {
  const w = world({ autonomy: 'self_start' });
  try {
    w.agent(CFO, 'cfo');
    duty(w, CFO, sqlTime(new Date(Date.now() - 60_000)));
    await w.kv.put('agents:halt', 'drill');
    assert.equal(await sweepAgentDuties(w.env, new Date(), { tokensLeft: async () => true, tell: async () => {}, runtime: async () => w.runtime }), null);
    await w.kv.delete('agents:halt');
    const r = await sweepAgentDuties(w.env, new Date(), { tokensLeft: async () => true, tell: async () => {}, runtime: async () => w.runtime });
    assert.equal(r?.task_created, 1);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ? AND status = 'admitted'", CFO), 1, 'self_start admitted the task');
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    assert.match(index, /const \{ sweepAgentDuties \} = await import\('\.\/agents\/sweep'\);/);
  } finally { w.close(); }
});

// ── Handoffs ────────────────────────────────────────────────────────────────

const handoffText = (to: string, note = 'The term sheet is in the data room; the liquidation preference looks off.') =>
  `Here is the review.\n{"handoff":{"to_role":"${to}","title":"Review the term sheet","why":"It needs counsel.","note":"${note}"}}`;

/** Run the loop once for `agentId`'s task with the output ending in `text`, and decide with `decision`. */
async function runWithOutput(w: World, agentId: number, taskId: number, text: string) {
  const a = await w.runtime.admit({ kind: 'project', id: PROJECT }, { agentId, taskId, by: SPONSOR, source: 'person' });
  assert.ok(a.ok, JSON.stringify(a));
  const h = harness();
  h.opts.beforeStep = (name) => {
    if (name === 'propose') w.db.prepare('UPDATE ai_rail_proposals SET payload_json = ? WHERE run_key = ?').run(JSON.stringify({ text }), `agent:${a.run.uid}`);
  };
  h.opts.decision = 'timeout';
  await runTaskLoop(a.run.uid, h.step, loopDeps(w, fakeAgentRun(w).fn, READ_ALL));
  return a.run.uid;
}

test('a handoff is a proposal: no task and no run for the target before a person accepts; accept makes a handoff task; discard ends it', async () => {
  const w = world();
  try {
    w.agent(CFO, 'cfo'); w.agent(GC, 'general_counsel');
    w.db.prepare("UPDATE team_agents SET status = 'active' WHERE id = ?").run(CFO);
    w.task(300, CFO);
    w.db.prepare("UPDATE scope_tasks SET module = 'use-of-funds', option = 'draft:raise/use-of-funds-runway' WHERE id = 300").run();
    const runUid = await runWithOutput(w, CFO, 300, handoffText('general_counsel'));
    const h = w.db.prepare('SELECT * FROM agent_handoffs').get() as any;
    assert.deepEqual([h.status, h.depth, h.to_role_key, h.to_agent_id, h.from_agent_id], ['proposed', 1, 'general_counsel', GC, CFO]);
    const p = w.db.prepare('SELECT * FROM ai_rail_proposals WHERE uid = ?').get(h.proposal_uid) as any;
    assert.deepEqual([p.rail_option, p.agent_id, p.run_key], ['propose:handoff', CFO, `agent:ho-${runUid}`]);
    assert.equal(tasksOf(w, GC).length, 0, 'no task for the target before Accept');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ?', GC), 0, 'and no run');
    await decideRail(w.env, SPONSOR, h.proposal_uid, 'accept');
    const t = tasksOf(w, GC);
    assert.deepEqual([t.length, t[0].kind, t[0].source_kind, t[0].source_ref, t[0].status, t[0].title], [1, 'handoff', 'handoff', h.uid, 'open', 'Review the term sheet']);
    assert.ok(!String(t[0].detail ?? '').includes('liquidation'), 'the note never enters the task\'s words');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ?', GC), 0, 'manual: still no run');
    assert.equal((w.db.prepare('SELECT status FROM agent_handoffs WHERE id = ?').get(h.id) as any).status, 'accepted');
    // The target's run reads the note only inside the untrusted wrapper.
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES ('ffffffff-run-gc', ?, ?, 1, 'running')").run(GC, t[0].id);
    w.db.prepare("UPDATE scope_tasks SET status = 'in_progress' WHERE id = ?").run(t[0].id);
    const run = w.db.prepare("SELECT * FROM agent_task_runs WHERE uid = 'ffffffff-run-gc'").get() as any;
    const built = await buildContext(loopDeps(w, fakeAgentRun(w).fn, READ_ALL), { run, agent: w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(GC) as any, task: { ...t[0], status: 'in_progress' } });
    assert.ok(built.ok);
    const prompt = (built as any).prompt as string;
    const inside = /<agent_data source="handoff" trust="data">[^]*?liquidation preference[^]*?<\/agent_data>/.test(prompt);
    assert.ok(inside, 'the note is inside the handoff data block');
    assert.equal(prompt.split('liquidation preference').length - 1, 1, 'and nowhere else');
    // Discard ends a chain.
    w.task(350, CFO);
    w.db.prepare("UPDATE scope_tasks SET module = 'use-of-funds', option = 'draft:raise/use-of-funds-runway' WHERE id = 350").run();
    await runWithOutput(w, CFO, 350, handoffText('general_counsel'));
    const h2 = w.db.prepare("SELECT * FROM agent_handoffs WHERE status = 'proposed'").get() as any;
    await decideRail(w.env, SPONSOR, h2.proposal_uid, 'discard');
    assert.equal((w.db.prepare('SELECT status FROM agent_handoffs WHERE id = ?').get(h2.id) as any).status, 'discarded');
    assert.equal(tasksOf(w, GC).length, 1);
    const trail = await call(w, SPONSOR, 'GET', `/project/${PROJECT}/handoffs`);
    assert.equal(trail.status, 200);
    assert.equal(trail.body.chains.length, 2);
    assert.ok(trail.body.chains.some((c: any) => c.steps[0].status === 'accepted' && c.steps[0].from.role_key === 'cfo' && c.steps[0].to.role_key === 'general_counsel' && c.steps[0].decided_by?.name));
    assert.equal((await call(w, STRANGER, 'GET', `/project/${PROJECT}/handoffs`)).status, 403);
  } finally { w.close(); }
});

test('refused handoffs: a role not in hands_off_to, depth 4, and a loop back into the chain; each is a refused step of its chain', async () => {
  // Mutation checked: DEPTH_MAX raised to 4 → the fourth step is not refused depth_exceeded.
  const w = world();
  try {
    w.agent(CTO, 'cto'); w.agent(CFO, 'cfo'); w.agent(GC, 'general_counsel');
    assert.ok(!HANDS_OFF_TO.cto.includes('cfo'));
    w.task(400, CTO);
    const ask = parseHandoff(handoffText('cfo'))!;
    const task400 = w.db.prepare('SELECT * FROM scope_tasks WHERE id = 400').get() as any;
    const ctoRow = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(CTO) as any;
    const notAllowed = await proposeHandoff(w.env, { from: ctoRow, task: task400, runUid: 'aaaaaaaa-1', ask });
    assert.deepEqual([notAllowed.status, (notAllowed as any).code], ['refused', 'not_allowed']);
    // A chain already DEPTH_MAX deep: the next step is refused.
    const cfoRow = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(CFO) as any;
    w.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, title, status)
      VALUES ('ho-deep', 'chain-deep', ?, ?, 'cfo', ?, 'Earlier', 'accepted')`).run(DEPTH_MAX, GC, CFO);
    w.task(401, CFO);
    w.db.prepare("UPDATE scope_tasks SET source_kind = 'handoff', source_ref = 'ho-deep' WHERE id = 401").run();
    const deep = await proposeHandoff(w.env, { from: cfoRow, task: w.db.prepare('SELECT * FROM scope_tasks WHERE id = 401').get() as any, runUid: 'aaaaaaaa-2', ask: parseHandoff(handoffText('general_counsel'))! });
    assert.deepEqual([deep.status, (deep as any).code], ['refused', 'depth_exceeded']);
    // A loop: CFO → GC accepted; GC's task hands back to CFO.
    w.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, title, status)
      VALUES ('ho-one', 'chain-one', 1, ?, 'general_counsel', ?, 'Review', 'accepted')`).run(CFO, GC);
    w.task(402, GC);
    w.db.prepare("UPDATE scope_tasks SET source_kind = 'handoff', source_ref = 'ho-one' WHERE id = 402").run();
    const gcRow = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(GC) as any;
    const loop = await proposeHandoff(w.env, { from: gcRow, task: w.db.prepare('SELECT * FROM scope_tasks WHERE id = 402').get() as any, runUid: 'aaaaaaaa-3', ask: parseHandoff(handoffText('cfo'))! });
    assert.deepEqual([loop.status, (loop as any).code], ['refused', 'handoff_loop']);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE rail_option = 'propose:handoff'"), 0, 'a refused handoff proposes nothing');
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM agent_handoffs WHERE status = 'refused'"), 3, 'each refusal is on the trail');
    assert.equal(parseHandoff('{"handoff":{"to_role":"cfo"}}'), null, 'no title, no handoff');
    assert.equal(parseHandoff(`{"handoff":{"to_role":"cfo","title":"t","note":"${'x'.repeat(1001)}"}}`), null, 'a note over 1,000 characters is no handoff');
  } finally { w.close(); }
});

// ── Memory ──────────────────────────────────────────────────────────────────

test('memory: a manager adds a fact (at most 1,000 characters), forgets one note or everything; a stranger reads nothing', async () => {
  const w = world();
  try {
    w.agent(CFO, 'cfo');
    const u = uidOf(w, CFO);
    const long = await call(w, SPONSOR, 'POST', `/agents/${u}/memory`, { body: 'x'.repeat(1001) });
    assert.deepEqual([long.status, long.body.error], [422, 'note_too_long']);
    const a = await call(w, SPONSOR, 'POST', `/agents/${u}/memory`, { body: 'Runway is stated in months, not weeks.' });
    const b = await call(w, SPONSOR, 'POST', `/agents/${u}/memory`, { body: 'The board meets on the first Tuesday.' });
    assert.deepEqual([a.status, a.body.note.kind, a.body.note.by.name], [201, 'fact', 'Sam Sponsor']);
    const read = await call(w, SPONSOR, 'GET', `/agents/${u}/memory`);
    assert.equal(read.body.notes.length, 2);
    assert.deepEqual([read.body.retention.days_after_removal, read.body.retention.run_summaries_days], [90, 180]);
    assert.equal(read.body.retention.text, retentionText());
    assert.match(read.body.retention.text, /90 days after it is removed/);
    assert.equal((await call(w, STRANGER, 'GET', `/agents/${u}/memory`)).status, 404);
    assert.equal((await call(w, STRANGER, 'DELETE', `/memory/${a.body.note.uid}`)).status, 404);
    assert.equal((await call(w, SPONSOR, 'DELETE', `/memory/${a.body.note.uid}`)).body.ok, true);
    assert.equal((await call(w, SPONSOR, 'GET', `/agents/${u}/memory`)).body.notes.length, 1);
    assert.deepEqual((await call(w, SPONSOR, 'DELETE', `/agents/${u}/memory`)).body, { ok: true, forgotten: 1 });
    // Mutation checked: the manager gate dropped → a company member who only reads adds and forgets notes.
    w.agent(56, 'cfo', { scope: 'company' });
    w.db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company) VALUES ('l-member', ?, ?, 'Member')").run(COMPANY, MEMBER);
    const cu = uidOf(w, 56);
    assert.equal((await call(w, MEMBER, 'GET', `/agents/${cu}/memory`)).status, 200, 'a member reads');
    assert.equal((await call(w, MEMBER, 'POST', `/agents/${cu}/memory`, { body: 'A fact' })).status, 403, 'and cannot write');
    assert.equal((await call(w, MEMBER, 'DELETE', `/agents/${cu}/memory`)).status, 403);
    assert.equal((await call(w, MEMBER, 'POST', `/agents/${cu}/duties`, { template: 'cfo.runway' })).status, 403);
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_memory_notes WHERE agent_id = ?', CFO), 0);
    void b;
  } finally { w.close(); }
});

test('retention: a removed agent\'s notes stay 90 days, then go; run step summaries are emptied after 180 days', async () => {
  // Mutation checked: keeping notes past 90 days (the purge's DELETE dropped) → the 91st-day count is 1.
  const w = world();
  try {
    w.agent(CFO, 'cfo');
    w.db.prepare("INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, project_id, kind, body) VALUES ('note-1', ?, 'project', ?, 'fact', 'A fact')").run(CFO, PROJECT);
    const removed = new Date('2026-11-01T00:00:00Z');
    await onAgentRemoved(w.env, CFO, removed);
    const day = (n: number) => new Date(removed.getTime() + n * 86_400_000);
    await purgeExpired(w.env, day(89));
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_memory_notes'), 1, 'kept on day 89');
    await purgeExpired(w.env, day(RETENTION.notes_days_after_removal + 1));
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_memory_notes'), 0, 'gone after 90 days');
    const removal = readFileSync(new URL('../src/routes/team_agents.ts', import.meta.url), 'utf8');
    assert.match(removal, /await onAgentRemoved\(c\.env, a\.id\);/, 'the remove route starts the 90 days');
    w.task(500, CFO);
    w.db.prepare(`INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, steps_json, ended_at)
      VALUES ('old-run-1', ?, 500, 1, 'done', '[{"name":"load","status":"done","at":"x","summary":"Ready"}]', '2026-01-01 00:00:00')`).run(CFO);
    await purgeExpired(w.env, new Date('2026-08-01T00:00:00Z'));
    assert.equal((w.db.prepare("SELECT steps_json FROM agent_task_runs WHERE uid = 'old-run-1'").get() as any).steps_json, '[]');
  } finally { w.close(); }
});

/** Notes, runs and a queued task for `agentId`. */
function seed(w: World, agentId: number, taskId: number) {
  w.task(taskId, agentId);
  w.db.prepare("INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, project_id, kind, body) VALUES (?, ?, 'project', ?, 'fact', 'Kept')").run(`n-${taskId}`, agentId, PROJECT);
  w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, steps_json) VALUES (?, ?, ?, 1, 'done', '[]')").run(`r-${taskId}-aaaaaaaa`, agentId, taskId);
}
const left = (w: World) => ({
  notes: count(w, 'SELECT COUNT(*) AS n FROM agent_memory_notes'),
  runs: count(w, 'SELECT COUNT(*) AS n FROM agent_task_runs'),
  queued: count(w, "SELECT COUNT(*) AS n FROM scope_tasks WHERE assignee_kind = 'agent' AND status IN ('open', 'in_progress', 'waiting_decision', 'blocked')"),
});

test('erasure: a project hard-deleted, a company deleted, an account deleted each leave zero notes, run summaries and queued tasks', async () => {
  let w = world();
  try {
    w.agent(CFO, 'cfo'); seed(w, CFO, 600);
    await hardDeleteProject(w.env, PROJECT);
    assert.deepEqual(left(w), { notes: 0, runs: 0, queued: 0 }, 'project');
  } finally { w.close(); }
  w = world();
  try {
    w.agent(CFO, 'cfo', { scope: 'company' }); w.task(601, CFO, { scope: 'company' });
    w.db.prepare("INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, company_id, kind, body) VALUES ('n-c', ?, 'company', ?, 'fact', 'Kept')").run(CFO, COMPANY);
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, steps_json) VALUES ('r-c-aaaaaaaa', ?, 601, 1, 'done', '[]')").run(CFO);
    await eraseAgentData(w.env, { scope: { kind: 'company', id: COMPANY } });
    assert.deepEqual(left(w), { notes: 0, runs: 0, queued: 0 }, 'company');
  } finally { w.close(); }
  w = world();
  try {
    w.agent(CFO, 'cfo'); seed(w, CFO, 602);
    await eraseAccountAgents(w.env, SPONSOR, async () => w.runtime);
    assert.deepEqual(left(w), { notes: 0, runs: 0, queued: 0 }, 'account');
  } finally { w.close(); }
});

test('exportAgentData: the agents, rule books, notes and run history the member can see, and nothing else; wired into the account export', async () => {
  const w = world();
  try {
    w.agent(CFO, 'cfo'); seed(w, CFO, 700);
    const own = await exportAgentData(w.env, w.db.prepare('SELECT * FROM users WHERE id = ?').get(SPONSOR) as any);
    assert.equal(own.agents.length, 1);
    assert.deepEqual([own.agents[0].role_key, own.agents[0].memory_notes.map((n: any) => n.body), own.agents[0].runs.length], ['cfo', ['Kept'], 1]);
    assert.ok(Array.isArray(own.agents[0].rule_book.works_in));
    assert.equal(own.retention.notes_days_after_removal, 90);
    const other = await exportAgentData(w.env, w.db.prepare('SELECT * FROM users WHERE id = ?').get(STRANGER) as any);
    assert.deepEqual(other.agents, [], 'a stranger exports none of this team\'s agents');
    // Mutation checked: the read gate dropped → a sponsor who lost access to the team still exports its agent.
    w.agent(57, 'cto', { sponsor: STRANGER });
    assert.deepEqual((await exportAgentData(w.env, w.db.prepare('SELECT * FROM users WHERE id = ?').get(STRANGER) as any)).agents, [], 'not even an agent they sponsor on a team they can no longer read');
    const settings = readFileSync(new URL('../src/routes/settings.ts', import.meta.url), 'utf8');
    assert.match(settings, /agents = await exportAgentData\(c\.env, user as any\);/);
  } finally { w.close(); }
});
