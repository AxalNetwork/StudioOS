/**
 * D4593 (#4593, audit R2-06) — an exhausted agent message is acknowledged only after its run and task are repaired.
 *
 *   1. The actual handler: a lifecycle failure followed by a successful mirror does not lose the message (retried, not mirrored).
 *   2. Failure between the run update and the task update, an unknown commit outcome, a repeated delivery.
 *   3. Per message: one message's mirror never acknowledges another message's failed repair.
 *   4. A newer attempt, a cancelled or completed task, a run that ended another way, a deleted run: nothing is overwritten.
 *   5. The last delivery hands the obligation to the sweep, which repairs from D1's own state, idempotently, with metrics.
 *
 * The database is the real migrated schema; the queue and the Workflow are fakes. Every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_dlq_repair_d4593.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, world, type World } from './_agent_engine_fixture.ts';
import { agentDlqConsumer, DLQ_FINAL_ATTEMPT, repairExhaustedRun } from '../src/agents/agentQueue.ts';
import { sweepAgents, sweepStrandedRuns } from '../src/agents/sweep.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const admit = (w: World, agentId: number, taskId: number) => w.runtime.admit(P, { agentId, taskId, by: SPONSOR, source: 'person' });
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;
const taskRow = (w: World, id: number) => w.db.prepare('SELECT * FROM scope_tasks WHERE id = ?').get(id) as any;
const metric = (w: World, name: string) => w.db.prepare('SELECT value, labels FROM system_metrics WHERE metric_name = ?').all(name) as any[];

type Msg = { uid: string; attempts?: number };
function dead(msgs: Msg[]) {
  const log: string[] = [];
  const messages = msgs.map((m, i) => ({
    id: `m${i}`, timestamp: new Date(), attempts: m.attempts ?? 1,
    body: { job_type: 'agent_run', payload: { run_uid: m.uid }, idempotency_key: 'x' },
    ack() { log.push(`ack:${i}`); }, retry() { log.push(`retry:${i}`); },
  }));
  return { batch: { queue: 'studioos-agent-queue-dlq', messages } as any, log };
}
/** The job queue's mirror, the real one's shape: it acknowledges the messages it is handed. */
const mirrorOf = (seen: string[]) => async (batch: any) => { for (const m of batch.messages) { seen.push(m.body.payload.run_uid); m.ack(); } };

/** A statement whose SQL matches fails: before it runs (`commit: false`) or after it committed (`commit: true`, a timeout with an unknown outcome). */
function failing(w: World, re: RegExp, o: { commit?: boolean; times?: number } = {}) {
  const prep = w.env.DB.prepare.bind(w.env.DB);
  let left = o.times ?? 1; const state = { hits: 0 };
  w.env.DB.prepare = (sql: string) => {
    const st = prep(sql);
    if (!re.test(sql)) return st;
    const bind = st.bind.bind(st);
    st.bind = (...a: unknown[]) => {
      const b = bind(...a); const run = b.run.bind(b);
      b.run = async () => {
        if (left <= 0) return run();
        left -= 1; state.hits += 1;
        if (o.commit) await run();
        throw new Error('D1_ERROR: timeout');
      };
      return b;
    };
    return st;
  };
  return state;
}

const RUN_UPDATE = /UPDATE agent_task_runs SET status = 'failed'/;
const TASK_UPDATE = /UPDATE scope_tasks/;

async function admitted(w: World, taskId = 200) {
  w.agent(AGENT); w.task(taskId, AGENT);
  const a = await admit(w, AGENT, taskId);
  assert.ok(a.ok);
  return a.run.uid as string;
}

test('1. a lifecycle failure followed by a successful mirror does not lose the message', async () => {
  const w = world();
  try {
    const uid = await admitted(w);
    failing(w, RUN_UPDATE);
    const seen: string[] = []; const d = dead([{ uid }]);
    await agentDlqConsumer(d.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual(d.log, ['retry:0'], 'retried, not acknowledged');
    assert.deepEqual(seen, [], 'and not mirrored');
    assert.equal(runRow(w, uid).status, 'admitted');
    // The retry finds the database healthy and repairs everything.
    const d2 = dead([{ uid, attempts: 2 }]);
    await agentDlqConsumer(d2.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual([d2.log, seen], [['ack:0'], [uid]]);
    assert.deepEqual([runRow(w, uid).status, runRow(w, uid).refusal, taskRow(w, 200).status], ['failed', 'queue_exhausted', 'open']);
    assert.deepEqual(metric(w, 'agent_dlq_repair_outcome').map((r) => JSON.parse(r.labels).outcome).sort(), ['repaired', 'retry']);
  } finally { w.close(); }
});

test('2. failure after the run update and before the task update: retried, then repaired once; a repeat changes nothing', async () => {
  const w = world();
  try {
    const uid = await admitted(w);
    failing(w, TASK_UPDATE);
    const seen: string[] = []; const d = dead([{ uid }]);
    await agentDlqConsumer(d.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual([d.log, seen], [['retry:0'], []]);
    assert.deepEqual([runRow(w, uid).status, taskRow(w, 200).status], ['failed', 'in_progress'], 'the half-done state the audit found');
    const d2 = dead([{ uid, attempts: 2 }]);
    await agentDlqConsumer(d2.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual([d2.log, seen], [['ack:0'], [uid]]);
    assert.equal(taskRow(w, 200).status, 'open');
    const runs = () => (w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n;
    const before = [runs(), taskRow(w, 200).attempts, taskRow(w, 200).updated_at];
    assert.equal(await repairExhaustedRun(w.env, uid), 'settled', 'a repeat finds it done');
    assert.deepEqual([runs(), taskRow(w, 200).attempts, taskRow(w, 200).updated_at], before, 'no new run, no recycling');
  } finally { w.close(); }
});

test('2b. an unknown commit outcome is read back, not assumed', async () => {
  const w = world();
  try {
    const uid = await admitted(w);
    failing(w, RUN_UPDATE, { commit: true });       // the run update committed, then the call timed out
    assert.equal(await repairExhaustedRun(w.env, uid), 'repaired', 'the run reads failed, so the repair goes on to the task');
    assert.deepEqual([runRow(w, uid).status, taskRow(w, 200).status], ['failed', 'open']);

    const w2 = world();
    try {
      const uid2 = await admitted(w2);
      failing(w2, TASK_UPDATE, { commit: true });  // the task reopened, then the call timed out
      assert.equal(await repairExhaustedRun(w2.env, uid2), 'settled', 'the task reads open, so there is nothing left to do');
      assert.equal(taskRow(w2, 200).status, 'open');
    } finally { w2.close(); }
  } finally { w.close(); }
});

test('3. per message: a good message\'s mirror does not acknowledge a different message\'s failed repair', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT); w.agent(51, 'cto'); w.task(201, 51);
    const a = await admit(w, AGENT, 200); const b = await admit(w, 51, 201);
    assert.ok(a.ok && b.ok);
    // Only the first run's update fails.
    const prep = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (sql: string) => {
      const st = prep(sql);
      if (!RUN_UPDATE.test(sql)) return st;
      const bind = st.bind.bind(st);
      st.bind = (...args: unknown[]) => { if (args.includes(runRow(w, a.run.uid).id)) throw new Error('D1_ERROR: boom'); return bind(...args); };
      return st;
    };
    const seen: string[] = []; const d = dead([{ uid: a.run.uid }, { uid: b.run.uid }]);
    await agentDlqConsumer(d.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual(d.log.sort(), ['ack:1', 'retry:0']);
    assert.deepEqual(seen, [b.run.uid], 'only the repaired message was mirrored');
    assert.deepEqual([runRow(w, a.run.uid).status, runRow(w, b.run.uid).status], ['admitted', 'failed']);
  } finally { w.close(); }
});

test('4. nothing newer or intentionally ended is overwritten', async () => {
  const w = world();
  try {
    const uid = await admitted(w);
    // A cancelled / completed task is not reopened.
    for (const status of ['done', 'blocked']) {
      w.db.prepare("UPDATE agent_task_runs SET status = 'failed', refusal = 'queue_exhausted' WHERE uid = ?").run(uid);
      w.db.prepare('UPDATE scope_tasks SET status = ?, board_column = NULL WHERE id = 200').run(status);
      assert.equal(await repairExhaustedRun(w.env, uid), 'settled');
      assert.equal(taskRow(w, 200).status, status);
    }
    // A run that ended another way is not ours.
    w.db.prepare("UPDATE agent_task_runs SET status = 'cancelled', refusal = NULL WHERE uid = ?").run(uid);
    w.db.prepare("UPDATE scope_tasks SET status = 'in_progress', board_column = NULL WHERE id = 200").run();
    assert.equal(await repairExhaustedRun(w.env, uid), 'settled');
    assert.equal(taskRow(w, 200).status, 'in_progress', 'a cancelled run does not reopen its task');
    // A run another handler failed for its own reason is not this repair's to undo.
    w.db.prepare("UPDATE agent_task_runs SET status = 'failed', refusal = 'read_unavailable' WHERE uid = ?").run(uid);
    assert.equal(await repairExhaustedRun(w.env, uid), 'settled');
    assert.equal(taskRow(w, 200).status, 'in_progress');
    // A newer attempt that is live keeps the task.
    w.db.prepare("UPDATE agent_task_runs SET status = 'failed', refusal = 'queue_exhausted' WHERE uid = ?").run(uid);
    w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES ('newer-attempt-uid', ?, 200, 2, 'running')").run(AGENT);
    assert.equal(await repairExhaustedRun(w.env, uid), 'settled');
    assert.equal(taskRow(w, 200).status, 'in_progress', 'the newer attempt owns the task');
    assert.equal(runRow(w, 'newer-attempt-uid').status, 'running');
    // A deleted run is settled.
    assert.equal(await repairExhaustedRun(w.env, 'no-such-run-uid-0000'), 'settled');
    // And a message with no run in it is handed to the generic mirror untouched.
    const seen: string[] = []; const d = dead([{ uid: 'x' }]);
    d.batch.messages[0].body = { job_type: 'other', payload: {} };
    await agentDlqConsumer(d.batch, w.env, {} as any, async (b: any) => { seen.push(b.messages[0].body.job_type); b.messages[0].ack(); });
    assert.deepEqual([seen, d.log], [['other'], ['ack:0']]);
  } finally { w.close(); }
});

test('5. the last delivery hands the obligation to the sweep, which repairs from D1 state, idempotently, with metrics', async () => {
  const w = world();
  try {
    const uid = await admitted(w);
    failing(w, TASK_UPDATE, { times: 99 });          // the database keeps failing the task update
    const seen: string[] = []; const d = dead([{ uid, attempts: DLQ_FINAL_ATTEMPT }]);
    await agentDlqConsumer(d.batch, w.env, {} as any, mirrorOf(seen));
    assert.deepEqual([d.log, seen], [['ack:0'], [uid]], 'the queue would drop it now, so it is mirrored and acknowledged');
    assert.deepEqual([runRow(w, uid).status, taskRow(w, 200).status], ['failed', 'in_progress'], 'but the obligation is still in D1');
    assert.ok(metric(w, 'agent_dlq_repair_outcome').some((r) => JSON.parse(r.labels).outcome === 'deferred_to_sweep'));

  } finally { w.close(); }
  const w2 = world();
  try {
    const uid = await admitted(w2);
    w2.db.prepare("UPDATE agent_task_runs SET status = 'failed', refusal = 'queue_exhausted', ended_at = datetime('now', '-30 minutes') WHERE uid = ?").run(uid);
    const first = await sweepStrandedRuns(w2.env, new Date());
    assert.equal(first.repaired, 1);
    assert.equal(taskRow(w2, 200).status, 'open');
    const pending = metric(w2, 'agent_repair_pending'), age = metric(w2, 'agent_repair_oldest_age_seconds');
    assert.equal(pending[0].value, 1);
    assert.ok(age[0].value >= 1700, 'the age of the oldest pending repair');
    const after = taskRow(w2, 200);
    const again = await sweepStrandedRuns(w2.env, new Date());
    assert.equal(again.repaired, 0);
    assert.deepEqual(taskRow(w2, 200), after, 'a second sweep changes nothing');
    const latest = metric(w2, 'agent_repair_pending').map((r) => r.value);
    assert.equal(latest[latest.length - 1], 0, 'a reopened task is no longer pending');
    assert.equal((w2.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 1, 'no run admitted, nothing started');
    // The sweep repairs even with the engine off: it changes state only.
    w2.env.AGENT_ENGINE = 'off';
    w2.db.prepare("UPDATE scope_tasks SET status = 'in_progress', board_column = NULL WHERE id = 200").run();
    await sweepAgents(w2.env, new Date(), { enqueue: async () => {}, runtime: async () => w2.runtime });
    assert.equal(taskRow(w2, 200).status, 'open');
    for (const r of [...pending, ...age]) assert.doesNotMatch(r.labels, /uid|task|run_|@|prompt/i, 'labels carry no identifiers');
  } finally { w2.close(); }
});
