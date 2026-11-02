/**
 * D1528 (#3847, E3 of #3742) — the runtime contract, parameterised by
 * runtime. Every runtime behind the seam (`src/agents/runtime.ts`) must pass
 * it before `AGENT_RUNTIME` may name it (the runbook,
 * documentation/operations/AGENT_RUNTIME_SWITCH.md). Today that is `do`:
 * the `AgentScope` object's behaviour (`ScopeCore`) over in-memory storage,
 * the real migrated schema, and a fake Workflow binding. `sdk` is not built
 * (E0 evaluates it); when it is, it joins RUNTIMES and runs every case.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_runtime_contract.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { ScopeCore, doRuntime, scopeOf } from '../src/agents/doRuntime.ts';
import { context, load, propose, runStep, runTaskLoop } from '../src/agents/loop.ts';
import { decideRail } from '../src/services/railProposals.ts';
import { autonomy, engineVar, runtimeName, type AgentRuntime } from '../src/agents/runtime.ts';

test.after(() => removeMigratedDatabases());

type Made = { w: World; rt: AgentRuntime; evict(): void };
const RUNTIMES: Record<string, () => Made> = {
  do: () => {
    const w = world();
    return { w, rt: w.runtime, evict: () => { /* every call builds a fresh ScopeCore over the same storage: the object was evicted */ } };
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
    const { w, rt, evict } = make();
    try {
      const now = Date.now();
      await rt.schedule(P, { dutyId: 1, at: now - 1000 });
      await rt.schedule(P, { dutyId: 2, at: now + 3_600_000 });
      await rt.schedule(P, { dutyId: 3, at: now - 500 });
      await rt.cancelSchedule(P, 3);
      evict();
      const store = w.storageOf(`project:${PROJECT}`);
      assert.equal(store.alarm, now - 1000, 'the alarm is the earliest timer');
      const fire = () => new ScopeCore(store, w.env, w.deps).alarm(scopeOf(`project:${PROJECT}`)!);
      await fire();
      await fire(); // a second alarm finds nothing due
      assert.deepEqual(w.due, [1], 'duty 1 fired once; 3 was cancelled; 2 is not due');
      assert.equal(store.alarm, now + 3_600_000);
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
    const { w, rt } = make();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const a = await rt.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.ok(a.ok);
      const due = '2030-01-02 09:00:00';
      w.db.prepare(`INSERT INTO agent_duties (id, uid, agent_id, template_key, title, cadence, hour_utc, next_due_at)
        VALUES (7, 'd7', ?, 'ceo.weekly_plan', 'Weekly plan', 'daily', 9, ?)`).run(AGENT, due);
      const store = w.storageOf(`project:${PROJECT}`);
      store.map.clear(); store.alarm = null; // the object lost everything
      const s = await rt.rebuild(P);
      assert.deepEqual(s.live.map((l) => [l.run_uid, l.status]), [[a.run.uid, 'admitted']]);
      assert.deepEqual(s.schedules, [{ dutyId: 7, at: Date.parse('2030-01-02T09:00:00Z') }]);
      assert.equal(store.alarm, Date.parse('2030-01-02T09:00:00Z'));
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
}

test('the defaults: engine off, autonomy manual, runtime do; sdk falls back to do', async () => {
  assert.equal(engineVar({}), 'off');
  assert.equal(engineVar({ AGENT_ENGINE: 'loud' }), 'off');
  assert.equal(autonomy({}), 'manual');
  assert.equal(autonomy({ AGENT_AUTONOMY: 'yes' }), 'manual');
  assert.equal(runtimeName({}), 'do');
  const w = world();
  try {
    w.env.AGENT_RUNTIME = 'sdk';
    const { agentRuntime } = await import('../src/agents/runtime.ts');
    assert.equal((await agentRuntime(w.env)).name, 'do');
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
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|js|mjs)$/.test(f)) continue;
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
