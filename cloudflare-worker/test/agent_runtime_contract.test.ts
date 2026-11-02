/**
 * D1528 (#3847, E3 of #3742) — the runtime contract, parameterised by
 * runtime. Every runtime behind the seam (`src/agents/runtime.ts`) must pass
 * it before `AGENT_RUNTIME` may name it (the runbook,
 * documentation/operations/AGENT_RUNTIME_SWITCH.md). Today that is `do`:
 * the `AgentScope` object's behaviour (`ScopeCore`) over in-memory storage,
 * the real migrated schema, and a fake Workflow binding; and `sdk` (#3852,
 * E0): `SdkScopeCore` over a fake of the Agents SDK `Agent` slice it uses
 * (`FakeSdkHost`: whole-second schedules, the alarm deleting a row after its
 * callback, `runWorkflow` refusing a second instance). Every case runs on
 * both. The real `ScopeAgent` on workerd is the E0 report's smoke, on #3742.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_runtime_contract.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { ScopeCore, doRuntime, scopeOf } from '../src/agents/doRuntime.ts';
import { context, load, propose, runStep, runTaskLoop } from '../src/agents/loop.ts';
import { decideRail } from '../src/services/railProposals.ts';
import { autonomy, engineVar, runtimeName, type AgentRuntime } from '../src/agents/runtime.ts';

test.after(() => removeMigratedDatabases());

/**
 * A runtime under test, and what the suite needs to see inside its scope object:
 * `alarm` (when the object will next wake, ms), `fire` (that wake), `wipe` (the
 * object lost everything) and `tick` (the runtime's alarm resolution: `do`
 * keeps ms, the SDK whole seconds).
 */
type Made = { w: World; rt: AgentRuntime; alarm(): number | null; fire(): Promise<void>; wipe(): void; tick(ms: number): number };
const NAME = `project:${PROJECT}`;
const RUNTIMES: Record<string, () => Made> = {
  do: () => {
    const w = world();
    const store = () => w.storageOf(NAME);
    return {
      w, rt: w.runtime,
      alarm: () => store().alarm,
      // Every call builds a fresh ScopeCore over the same storage: the object was evicted.
      fire: () => new ScopeCore(store(), w.env, w.deps).alarm(scopeOf(NAME)!),
      wipe: () => { store().map.clear(); store().alarm = null; },
      tick: (ms) => ms,
    };
  },
  sdk: () => {
    const w = world({ runtime: 'sdk' });
    const host = () => w.hostOf(NAME);
    return {
      w, rt: w.runtime,
      alarm: () => host().alarm,
      // The SDK's alarm calls `ScopeAgent.dutyDue`, which is the core's, built fresh: the Agent was evicted.
      fire: () => host().fire(Date.now(), (p) => w.sdkCore(NAME).dutyDue(scopeOf(NAME)!, p)),
      wipe: () => { host().state = { halted: false, live: [] }; host().rows.clear(); },
      tick: (ms) => Math.floor(ms / 1000) * 1000,
    };
  },
};

const P = { kind: 'project' as const, id: PROJECT };

for (const [name, make] of Object.entries(RUNTIMES)) {
  test(`${name}: a duplicate admission is refused`, async () => {
    const { w, rt } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const first = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.ok(first.ok);
      const again = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.equal(!again.ok && again.status, 409);
      assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 1);
      assert.deepEqual((await rt.status(P)).live.map((l) => l.run_uid), [first.ok && first.run.uid]);
    } finally { w.close(); }
  });

  test(`${name}: schedules fire once, survive eviction, and cancel works`, async () => {
    const { w, rt, alarm, fire, tick } = make();
    try {
      const now = Date.now();
      await rt.schedule(P, { dutyId: 1, at: now - 1000 });
      await rt.schedule(P, { dutyId: 2, at: now + 3_600_000 });
      await rt.schedule(P, { dutyId: 3, at: now - 500 });
      await rt.cancelSchedule(P, 3);
      await rt.schedule(P, { dutyId: 2, at: now + 3_600_000 }); // scheduling a duty again replaces it
      assert.equal(alarm(), tick(now - 1000), 'the alarm is the earliest timer');
      await fire();
      await fire(); // a second alarm finds nothing due
      assert.deepEqual(w.due, [1], 'duty 1 fired once; 3 was cancelled; 2 is not due');
      assert.equal(alarm(), tick(now + 3_600_000));
      assert.deepEqual((await rt.status(P)).schedules, [{ dutyId: 2, at: now + 3_600_000 }]);
    } finally { w.close(); }
  });

  test(`${name}: a crash between steps repeats no proposal or charge`, async () => {
    for (const crash of ['load', 'context', 'run', 'propose', 'after']) {
      const { w, rt } = make();
      try {
        w.agent(AGENT); w.task(200, AGENT);
        const a = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
        assert.ok(a.ok);
        const ar = fakeAgentRun(w);
        const h = harness();
        h.opts.crashBeforeSave = crash;
        h.opts.decision = { status: 'accepted' };
        // The step ran, the worker died before its result was saved; the Workflow replays run().
        await assert.rejects(runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn)), (e) => h.isCrash(e));
        const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
        assert.deepEqual(out, { go: true, decision: 'accepted' }, crash);
        assert.equal(ar.state.charges, 1, `${crash}: one charge`);
        assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get() as any).n, 1, `${crash}: one proposal`);
        assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_memory_notes').get() as any).n, 1, `${crash}: one note`);
        assert.equal((w.db.prepare("SELECT status FROM scope_tasks WHERE id = 200").get() as any).status, 'done', crash);
      } finally { w.close(); }
    }
  });

  test(`${name}: halt stops new admissions within one request`, async () => {
    const { w, rt } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT); w.agent(51, 'cto'); w.task(201, 51);
      await rt.halt(P, 'drill');
      const r = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.equal(!r.ok && r.status, 403);
      assert.equal((await rt.status(P)).halted, true);
      await rt.rebuild(P); // still paused in D1, so still halted
      assert.equal((await rt.status(P)).halted, true);
      w.db.prepare('UPDATE agent_scope_settings SET engine_paused = 0').run();
      await rt.rebuild(P);
      assert.ok((await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' })).ok);
      await rt.halt('all', 'drill');
      const all = await rt.admit(P, { agentId: 51, taskId: 201, by: SPONSOR, source: 'person' });
      assert.deepEqual([!all.ok && all.code, !all.ok && all.status], ['engine_paused', 403]);
    } finally { w.close(); }
  });

  test(`${name}: rebuild restores the live runs and the schedules from D1 alone`, async () => {
    const { w, rt, alarm, wipe } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const a = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.ok(a.ok);
      await rt.schedule(P, { dutyId: 99, at: Date.now() + 60_000 }); // not in D1: a rebuild drops it
      const due = '2030-01-02 09:00:00';
      w.db.prepare(`INSERT INTO agent_duties (id, uid, agent_id, template_key, title, cadence, hour_utc, next_due_at)
        VALUES (7, 'd7', ?, 'ceo.weekly_plan', 'Weekly plan', 'daily', 9, ?)`).run(AGENT, due);
      wipe(); // the object lost everything
      const s = await rt.rebuild(P);
      assert.deepEqual(s.live.map((l) => [l.run_uid, l.status]), [[a.run.uid, 'admitted']]);
      assert.deepEqual(s.schedules, [{ dutyId: 7, at: Date.parse('2030-01-02T09:00:00Z') }]);
      assert.equal(alarm(), Date.parse('2030-01-02T09:00:00Z'));
      // A rebuild over a stale object, not an empty one, ends with the same view.
      await rt.schedule(P, { dutyId: 99, at: Date.now() + 60_000 });
      assert.deepEqual((await rt.rebuild(P)).schedules, s.schedules);
    } finally { w.close(); }
  });

  test(`${name}: a decision reaches a waiting run`, async () => {
    const { w, rt } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const a = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.ok(a.ok);
      const started = await rt.startRun(P, a.run.uid);
      assert.deepEqual(started, { runUid: a.run.uid, started: true });
      assert.deepEqual(await rt.startRun(P, a.run.uid), { runUid: a.run.uid, started: false }, 'a second start is a no-op');
      const d = loopDeps(w, fakeAgentRun(w).fn);
      for (const f of [load, context, runStep, propose]) assert.ok((await f(d, a.run.uid)).go);
      const prop = (w.db.prepare('SELECT proposal_uid FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).proposal_uid;
      await decideRail(w.env, SPONSOR, prop, 'accept');
      assert.deepEqual(w.workflows.instances.get(a.run.uid)!.events, [{ type: 'decision', payload: { status: 'accepted' } }]);
    } finally { w.close(); }
  });
  test(`${name}: erase ends one agent's runs and timers, or the whole scope's`, async () => {
    const { w, rt } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT); w.agent(51, 'cto'); w.task(201, 51);
      const a = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      const b = await rt.admit(P, { agentId: 51, taskId: 201, by: SPONSOR, source: 'person' });
      assert.ok(a.ok && b.ok);
      await rt.startRun(P, a.run.uid);
      await rt.schedule(P, { dutyId: 1, at: Date.now() + 60_000, agentId: AGENT } as any);
      await rt.schedule(P, { dutyId: 2, at: Date.now() + 60_000, agentId: 51 } as any);
      await rt.erase(P, AGENT);
      const s = await rt.status(P);
      assert.deepEqual(s.live.map((l) => l.agent_id), [51]);
      assert.deepEqual(s.schedules.map((d) => d.dutyId), [2]);
      assert.equal(w.workflows.instances.get(a.run.uid)!.terminated, true, "the agent's Workflow instance ended");
      assert.equal((w.db.prepare('SELECT status FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).status, 'cancelled');
      await rt.erase(P, null);
      const e = await rt.status(P);
      assert.deepEqual([e.live, e.schedules, e.halted], [[], [], false]);
    } finally { w.close(); }
  });
}

test('the switch: do → sdk → do with a run waiting for a decision; it completes once, with one charge and one proposal', async () => {
  // The runbook's rehearsal on one world: both runtimes over the same D1, Workflows and approvals queue.
  // Mutation checked: sdk's startRun not refusing a second instance → `started: true` twice; a run's move not reaching
  // the sdk object (a dropped `/track`) → "the sdk object saw the run end" fails.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await w.runtimeFor('do').admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    assert.deepEqual(await w.runtimeFor('do').startRun(P, a.run.uid), { runUid: a.run.uid, started: true });
    const ar = fakeAgentRun(w);
    const h = harness();
    // The Workflow instance: its wait resolves with the event the binding receives, as Workflows does.
    let deliver!: (v: unknown) => void;
    const arrived = new Promise((r) => { deliver = r; });
    const step = { do: h.step.do, waitForEvent: async () => ({ payload: await arrived }) } as typeof h.step;
    const loop = runTaskLoop(a.run.uid, step, loopDeps(w, ar.fn));
    const status = () => (w.db.prepare('SELECT status FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).status;
    for (let i = 0; i < 200 && status() !== 'waiting_decision'; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(status(), 'waiting_decision', 'the run waits under do');
    // Switch to sdk: its object rebuilds from D1 and shows the waiting run; a start there is the same instance.
    w.env.AGENT_RUNTIME = 'sdk';
    const sdk = w.runtimeFor('sdk');
    assert.deepEqual((await sdk.rebuild(P)).live.map((l) => [l.run_uid, l.status]), [[a.run.uid, 'waiting_decision']]);
    assert.deepEqual(await sdk.startRun(P, a.run.uid), { runUid: a.run.uid, started: false }, 'one instance per run, whichever runtime asks');
    // A person decides in the approvals queue; the event reaches the waiting instance and the run finishes under sdk.
    const prop = (w.db.prepare('SELECT proposal_uid FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).proposal_uid;
    await decideRail(w.env, SPONSOR, prop, 'accept');
    const events = w.workflows.instances.get(a.run.uid)!.events as { payload: unknown }[];
    assert.deepEqual(events, [{ type: 'decision', payload: { status: 'accepted' } }]);
    deliver(events[0].payload);
    assert.deepEqual(await loop, { go: true, decision: 'accepted' });
    assert.equal(status(), 'done');
    assert.deepEqual((await sdk.status(P)).live, [], 'the sdk object saw the run end');
    // Back to do: a rebuild finds nothing live, and nothing repeated.
    w.env.AGENT_RUNTIME = 'do';
    assert.deepEqual((await w.runtimeFor('do').rebuild(P)).live, []);
    assert.equal(ar.state.charges, 1, 'one charge');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get() as any).n, 1, 'one proposal');
  } finally { w.close(); }
});

test('the defaults: engine off, autonomy manual, runtime do; sdk without its binding falls back to do', async () => {
  assert.equal(engineVar({}), 'off');
  assert.equal(engineVar({ AGENT_ENGINE: 'loud' }), 'off');
  assert.equal(autonomy({}), 'manual');
  assert.equal(autonomy({ AGENT_AUTONOMY: 'yes' }), 'manual');
  assert.equal(runtimeName({}), 'do');
  const w = world();
  try {
    w.env.AGENT_RUNTIME = 'sdk';
    const { agentRuntime } = await import('../src/agents/runtime.ts');
    assert.equal((await agentRuntime(w.env)).name, 'do', 'no AGENT_SCOPE_SDK binding: do');
    // With no object binding the runtime refuses admission rather than run without a single writer.
    const bare = doRuntime({ ...w.env, AGENT_SCOPE: undefined });
    const r = await bare.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.deepEqual([!r.ok && r.code, !r.ok && r.status], ['engine_unavailable', 503]);
  } finally { w.close(); }
});

test('the import guard: nothing outside src/agents/sdkRuntime.ts imports the `agents` package', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    // Directory entries carry their own type, so no file is checked and then read (CodeQL js/file-system-race).
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const f = d.name;
      const p = join(dir, f);
      if (d.isDirectory()) { walk(p); continue; }
      if (!d.isFile() || !/\.(ts|js|mjs)$/.test(f)) continue;
      const rel = p.slice(root.length);
      if (rel === 'agents/sdkRuntime.ts') continue;
      const src = readFileSync(p, 'utf8');
      if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]agents(?:\/[^'"]*)?['"]/.test(src)) offenders.push(rel);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
  // The guard itself is live: it sees an import written the three ways.
  for (const line of ["import { Agent } from 'agents';", "await import('agents/mcp')", "require(\"agents\")"]) {
    assert.match(line, /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]agents(?:\/[^'"]*)?['"]/);
  }
});
