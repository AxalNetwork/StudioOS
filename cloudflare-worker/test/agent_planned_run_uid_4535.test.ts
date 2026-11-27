/**
 * #4535 (slice 2): admission takes a workflow plan's per-attempt run uid. The
 * attempt's run is named by the plan, so its proposal and hold keys are the
 * plan's; admitting the same attempt again answers the first run and sends
 * nothing; a malformed or borrowed uid is refused. Both runtimes. Every row is
 * made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_planned_run_uid_4535.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, world } from './_agent_engine_fixture.ts';
import { PLANNED_RUN_UID_RE } from '../src/agents/engine.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const PLANNED = `wf-${'0123456789abcdef0123456789abcdef01234567'}`;

for (const runtime of ['do', 'sdk'] as const) {
  test(`${runtime}: a planned attempt is admitted under its plan's uid, once`, async () => {
    const w = world({ runtime });
    try {
      w.agent(AGENT); w.task(300, AGENT); w.task(301, AGENT);
      assert.match(PLANNED, PLANNED_RUN_UID_RE);
      const first = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person', runUid: PLANNED });
      assert.ok(first.ok, JSON.stringify(first));
      // Mutation checked: keep `crypto.randomUUID()` → the run is not the plan's.
      assert.equal(first.run.uid, PLANNED);
      assert.equal(w.enqueued.filter((u) => u === PLANNED).length, 1);
      const again = await w.runtime.admit(P, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person', runUid: PLANNED });
      assert.ok(again.ok, JSON.stringify(again));
      // Mutation checked: drop the prior-run lookup → agent_busy (the live run), not the same run.
      assert.deepEqual([again.run.uid, again.run.attempt, (again as any).replayed], [PLANNED, first.run.attempt, true]);
      // Mutation checked: enqueue a replay → the run goes out twice.
      assert.equal(w.enqueued.filter((u) => u === PLANNED).length, 1, 'a replayed admission sends nothing');
      assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs WHERE uid = ?').get(PLANNED) as any).n, 1);
      // The same planned uid named for another task is refused, never reused.
      const borrowed = await w.runtime.admit(P, { agentId: AGENT, taskId: 301, by: SPONSOR, source: 'person', runUid: PLANNED });
      assert.deepEqual([borrowed.ok, !borrowed.ok && borrowed.code], [false, 'run_uid_taken']);
    } finally { w.close(); }
  });
}

test('a planned uid that is not a plan\'s shape is refused before anything is read', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(310, AGENT);
    for (const bad of ['wf-short', `x${PLANNED.slice(1)}`, `${PLANNED}0`, `wf-${'G'.repeat(40)}`, 42 as any]) {
      const r = await w.runtime.admit(P, { agentId: AGENT, taskId: 310, by: SPONSOR, source: 'person', runUid: bad });
      // Mutation checked: drop the shape check → a free-form uid becomes a run.
      assert.deepEqual([r.ok, !r.ok && r.code], [false, 'invalid_run'], String(bad));
    }
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 0);
    // No runUid: a fresh uid, as before.
    const plain = await w.runtime.admit(P, { agentId: AGENT, taskId: 310, by: SPONSOR, source: 'person' });
    assert.ok(plain.ok);
    assert.doesNotMatch(plain.run.uid, PLANNED_RUN_UID_RE);
  } finally { w.close(); }
});
