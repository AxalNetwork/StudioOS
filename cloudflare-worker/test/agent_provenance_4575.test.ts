/**
 * #4575 (AI governance G1) — a run's provenance over the tables the engine
 * already writes (`services/agents/provenance.ts`), and the recovery
 * assertions it makes checkable: one proposal and one hold per logical run,
 * unknown usage reported as unavailable (never 0), no orphaned or mismatched
 * hold left unnamed, and nothing private in the record. Synthetic rows only;
 * no provider, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { runStep, runTaskLoop } from '../src/agents/loop.ts';
import { holdKeyOf, runKeyOf } from '../src/services/agents/agentRun.ts';
import { RECONCILIATION, reconcile, runProvenance } from '../src/services/agents/provenance.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const admit = (w: World, taskId: number) => w.runtime.admit(P, { agentId: AGENT, taskId, by: SPONSOR, source: 'person' });
const NOW = new Date('2026-11-06T12:00:00Z');

function hold(w: World, runUid: string, o: { status: string; held: number; actual?: number; expires?: string }) {
  const settled = o.status === 'settled' || o.status === 'refunded';
  w.db.prepare(`INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, status, settlement_uid,
      actual_included_microusd, actual_topup_microusd, expires_at, idempotency_key, execution_id)
    VALUES (?, ?, '2026-11-06', '2026-11', ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`h-${runUid}-${o.status}`, SPONSOR, o.held, o.status, settled ? `s-${runUid}` : null, settled ? (o.actual ?? 0) : null, settled ? 0 : null,
      o.expires ?? '2026-11-06 13:00:00', holdKeyOf(runKeyOf(runUid)), runUid);
}
function usage(w: World, runUid: string, charged: number | null, o: { skill?: [number, number] } = {}) {
  const id = Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id, skill_id, skill_version)
    VALUES (?, 'agent_run', '@cf/synthetic/model', ?, ?, ?, ?)`).run(SPONSOR, charged, AGENT, o.skill?.[0] ?? null, o.skill?.[1] ?? null).lastInsertRowid);
  w.db.prepare('UPDATE agent_task_runs SET usage_log_id = ? WHERE uid = ?').run(id, runUid);
  return id;
}

test('the record of a finished run: lineage known, and what no table keeps per run said to be unavailable', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    h.opts.decision = { status: 'accepted' };
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    usage(w, a.run.uid, 4200, { skill: [7, 3] });
    hold(w, a.run.uid, { status: 'settled', held: 5000, actual: 4200 });
    const p = (await runProvenance(w.env, a.run.uid, NOW))!;
    assert.equal(p.task.scope, `project:${PROJECT}`);
    assert.equal(p.agent.sponsor_user_id, SPONSOR);
    assert.deepEqual(p.model_invoked, { available: true, value: '@cf/synthetic/model' });
    assert.deepEqual(p.skill, { available: true, value: { id: 7, version: 3 } });
    assert.deepEqual(p.charge_microusd, { available: true, value: 4200 });
    assert.equal(p.reconciliation, 'settled_matches');
    assert.equal(p.idempotency.hold_key, `agent:${a.run.uid}:run`);
    assert.equal(p.proposal.available && p.proposal.value.status, 'proposed', 'the fixture records the decision on the task; the proposal row is the store\'s');
    assert.equal(p.tool_grants_at_admission.available, false, 'grants are read live; their state at admission is not stored');
    assert.equal(p.data_class.available, false);
  } finally { w.close(); }
});

test('unknown usage stays unavailable: no usage row, or a NULL charge, is never 0', async () => {
  // Mutation checked: the charge read with `?? 0` (an unrecorded charge reported as 0).
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness(); h.opts.decision = 'timeout';
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    let p = (await runProvenance(w.env, a.run.uid, NOW))!;
    assert.deepEqual(p.charge_microusd, { available: false, why: 'no usage row for this run' });
    assert.equal(p.model_invoked.available, false);
    assert.equal(p.reconciliation, 'unrecorded', 'a proposal with no money record is unknown, not "nothing charged"');
    usage(w, a.run.uid, null);
    p = (await runProvenance(w.env, a.run.uid, NOW))!;
    assert.deepEqual(p.charge_microusd, { available: false, why: 'the usage row records no charge' });
  } finally { w.close(); }
});

test('a duplicate delivery of the same run makes one proposal and one charge, and the record shows one', async () => {
  // Mutation checked: none here (the fake keeps E2's promise); this pins the provenance read to one row per run key.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const deps = loopDeps(w, ar.fn);
    const h = harness(); h.opts.decision = 'timeout';
    await runTaskLoop(a.run.uid, h.step, deps);
    // The queue delivers the same run again: a fresh step harness (no memo), the run step re-executed.
    await runStep(deps, a.run.uid).catch(() => null);
    const n = (w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE run_key = ?').get(runKeyOf(a.run.uid)) as any).n;
    assert.equal(n, 1);
    assert.equal(ar.state.charges, 1);
    const p = (await runProvenance(w.env, a.run.uid, NOW))!;
    assert.equal(p.proposal.available && p.proposal.value.uid, `prop-${a.run.uid}`);
  } finally { w.close(); }
});

test('reconciliation names every money state, including the orphan and the mismatch', () => {
  // Mutation checked: a settled hold whose amount differs from the charge reported as settled_matches.
  const H = (status: string, actual: number | null = null, expires = '2026-11-06 13:00:00') =>
    ({ status, included_microusd: 5000, topup_microusd: 0, actual_included_microusd: actual, actual_topup_microusd: actual === null ? null : 0, expires_at: expires });
  const U = (charged: number | null) => ({ model: 'm', charged_microusd: charged, skill_id: null, skill_version: null });
  const PR = { uid: 'p', status: 'proposed', decided_at: null, decided_by_user_id: null };
  const cases: Array<[string, ReturnType<typeof reconcile>]> = [
    [reconcile(null, null, null, NOW), 'nothing_charged'],
    [reconcile(H('settled', 4200), U(4200), PR, NOW), 'settled_matches'],
    [reconcile(H('settled', 4200), U(4000), PR, NOW), 'mismatch'],
    [reconcile(H('settled', 4200), U(null), PR, NOW), 'unrecorded'],
    [reconcile(H('pending'), null, null, NOW), 'held_unsettled'],
    [reconcile(H('review'), null, null, NOW), 'held_unsettled'],
    [reconcile(H('pending', null, '2026-11-06 11:00:00'), null, null, NOW), 'held_expired'],
    [reconcile(H('refunded', 0), U(0), null, NOW), 'released'],
    [reconcile(H('refunded', 0), U(10), null, NOW), 'mismatch'],
    [reconcile(null, U(10), PR, NOW), 'mismatch'],
    [reconcile(null, null, PR, NOW), 'unrecorded'],
  ];
  for (const [got, want] of cases) assert.equal(got, want);
  assert.deepEqual([...new Set(cases.map((c) => c[1]))].sort(), [...RECONCILIATION].sort(), 'every state is reachable');
});

test('the record carries no prompt, payload, summary, email or name, and a missing run is null', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT, { title: 'Synthetic secret title 4575' });
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness(); h.opts.decision = 'timeout';
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    const text = JSON.stringify(await runProvenance(w.env, a.run.uid, NOW));
    for (const leak of ['a draft', 'Synthetic secret title 4575', 'sponsor@example.test', 'Sam Sponsor', 'Kestrel', ar.state.prompts[0]?.slice(0, 40) ?? 'never']) {
      assert.ok(!text.includes(leak), `leaked: ${leak}`);
    }
    assert.equal(await runProvenance(w.env, 'no-such-run', NOW), null);
  } finally { w.close(); }
});
