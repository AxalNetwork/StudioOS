/**
 * D1528 (#3847, E3 of #3742) — the agent queue: `AGENT_QUEUE` →
 * `studioos-agent-queue` (batch 5, timeout 5 s, 3 retries 30 s apart, at most
 * 10 consumers at once), its DLQ `studioos-agent-queue-dlq`.
 *
 * A message is `{ job_type: 'agent_run', payload: { run_uid } }`. It names a
 * run the scope's object admitted; the consumer starts that run's Workflow
 * instance (id = run uid). A redelivery is a no-op: the run is no longer
 * `admitted`, or the instance already exists. The DLQ consumer ends the run
 * `failed` (`queue_exhausted`), puts the task back to open, and mirrors the
 * message into `cf_dlq_mirror` like every other DLQ.
 *
 * `dispatchQueue` is the Worker's one `queue()` handler's routing: the agent
 * branch comes BEFORE the job queue's `dlq` test, and inside it a name ending
 * in `-dlq` goes to the agent DLQ consumer. Moved after the `dlq` test, the
 * agent DLQ would be mirrored but its runs never ended.
 */
import type { Env, JobMessage } from '../types';
import { moveTask, runByUid, scopeOfRow } from './engine';
import { agentRuntime } from './runtime';
import type { AgentRow } from '../services/agents/teams';

export const AGENT_RUN_JOB = 'agent_run';
const RUN_UID = /^[A-Za-z0-9-]{8,64}$/;

type Batch = MessageBatch<JobMessage>;
type Consumer = (batch: Batch, env: Env, ctx: ExecutionContext) => Promise<void>;

export async function enqueueAgentRun(env: Env, runUid: string): Promise<void> {
  if (!env.AGENT_QUEUE) throw new Error('agent_queue_unbound');
  await env.AGENT_QUEUE.send({ job_type: AGENT_RUN_JOB, payload: { run_uid: runUid }, idempotency_key: `agent:${runUid}` });
}

const runUidOf = (body: JobMessage | undefined): string | null => {
  const uid = body?.job_type === AGENT_RUN_JOB ? body?.payload?.run_uid : null;
  return typeof uid === 'string' && RUN_UID.test(uid) ? uid : null;
};

export type StartRun = (env: Env, run: { uid: string; agent: AgentRow }) => Promise<void>;

const startWithRuntime: StartRun = async (env, run) => {
  const rt = await agentRuntime(env);
  await rt.startRun(scopeOfRow(run.agent), run.uid);
};

export async function agentQueueConsumer(batch: Batch, env: Env, _ctx: ExecutionContext, start: StartRun = startWithRuntime): Promise<void> {
  for (const m of batch.messages) {
    const uid = runUidOf(m.body);
    if (!uid) { console.warn('[agent-queue] not_an_agent_run'); m.ack(); continue; }
    try {
      const run = await runByUid(env, uid);
      // Gone, or already past `admitted`: a redelivery, or a run that ended. Nothing to start.
      if (!run || run.status !== 'admitted') { m.ack(); continue; }
      const agent = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(run.agent_id).first<AgentRow>();
      if (!agent) { m.ack(); continue; }
      await start(env, { uid, agent });
      m.ack();
    } catch {
      console.warn('[agent-queue] start_failed');
      m.retry({ delaySeconds: 30 });
    }
  }
}

/** Exhausted messages: the run ends `failed`, the task is open again, and the message is mirrored. */
export async function agentDlqConsumer(batch: Batch, env: Env, ctx: ExecutionContext, mirror?: Consumer): Promise<void> {
  for (const m of batch.messages) {
    const uid = runUidOf(m.body);
    if (!uid) continue;
    try {
      const run = await runByUid(env, uid);
      if (!run || run.status !== 'admitted') continue;
      const r = await env.DB.prepare(
        "UPDATE agent_task_runs SET status = 'failed', refusal = 'queue_exhausted', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'admitted'",
      ).bind(run.id).run();
      if (r.meta?.changes) {
        await moveTask(env, run.task_id, 'open', ['in_progress']);
      }
    } catch {
      console.warn('[agent-dlq] end_failed');
    }
  }
  const m = mirror ?? (await import('../queue-consumer')).dlqConsumer;
  await m(batch, env, ctx);
}

export type QueueConsumers = { queue: Consumer; dlq: Consumer; agent: Consumer; agentDlq: Consumer };

/** The `queue()` handler's routing. The agent branch is first; see the header. */
export async function dispatchQueue(batch: Batch, env: Env, ctx: ExecutionContext, c: QueueConsumers): Promise<void> {
  const name = batch.queue ?? '';
  if (name.includes('agent-queue')) {
    if (name.endsWith('-dlq')) return c.agentDlq(batch, env, ctx);
    return c.agent(batch, env, ctx);
  }
  // Task #7 (IE) — DLQ batches go to dlqConsumer, which mirrors them to D1.
  if (name.includes('dlq')) return c.dlq(batch, env, ctx);
  return c.queue(batch, env, ctx);
}
