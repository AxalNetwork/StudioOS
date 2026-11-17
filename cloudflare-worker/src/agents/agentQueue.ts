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
 * D4593 (#4593): the mirror comes AFTER the repair, per message. A message whose repair failed is retried,
 * not mirrored and acknowledged; see `repairExhaustedRun` for the table and `sweepStrandedRuns` for the owner
 * of what a dropped message leaves behind.
 *
 * `dispatchQueue` is the Worker's one `queue()` handler's routing: the agent
 * branch comes BEFORE the job queue's `dlq` test, and inside it a name ending
 * in `-dlq` goes to the agent DLQ consumer. Moved after the `dlq` test, the
 * agent DLQ would be mirrored but its runs never ended.
 */
import type { Env, JobMessage } from '../types';
import { moveTask, runByUid, scopeOfRow } from './engine';
import { agentRuntime, scopeName } from './runtime';
import { admitModelStart, budgetFor, readModelBudgets, type BudgetVerdict, type ModelBudgets } from './modelBudget';
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

/**
 * D7077 (#7077): a batch's runs are started TOGETHER (`Promise.allSettled`), not one after
 * another, and each message keeps its own outcome: a start that throws is retried in 30 s
 * exactly as before, and never fails or delays the others. Two messages naming one run are
 * dispatched once and share the outcome. The acks and retries are applied in message order
 * after every start has settled.
 *
 * Before a start, the run's model must fit the platform budget (`modelBudget.ts`, off unless
 * `AGENT_MODEL_RPM` is set). A throttled message is NOT retried, which would spend the
 * queue's 3 retries and end the run `queue_exhausted` at the DLQ: it is sent again with a
 * delay to the next minute and acknowledged. If that send fails, it is retried instead, and
 * the sweep's resend of runs still `admitted` after 5 minutes stays the backstop.
 */
export type QueueOutcome =
  | { kind: 'ack'; admittedAgeSec?: number }
  | { kind: 'throttled'; model: string; reason: 'model_full' | 'scope_share'; delaySeconds: number }
  | { kind: 'retry' };

export type AgentQueueDeps = { now?: () => Date };

/** Metric label keys a dispatch metric may carry. A model is labelled only by the knob's own keys. */
export const DISPATCH_LABEL_KEYS = ['model', 'reason'] as const;

const sqlTimeMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  return Number.isFinite(ms) ? ms : null;
};

async function dispatchOne(env: Env, uid: string, start: StartRun, budgets: ModelBudgets | null, now: () => Date, flags: { budgetUnavailable: number }): Promise<QueueOutcome> {
  const run = await runByUid(env, uid);
  // Gone, or already past `admitted`: a redelivery, or a run that ended. Nothing to start.
  if (!run || run.status !== 'admitted') return { kind: 'ack' };
  const agent = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(run.agent_id).first<AgentRow>();
  if (!agent) return { kind: 'ack' };
  if (budgets) {
    let verdict: BudgetVerdict;
    try { verdict = await admitModelStart(env, budgets, agent.model_id, scopeName(scopeOfRow(agent)), now()); }
    catch { console.warn('[agent-queue] model_budget_unavailable'); flags.budgetUnavailable += 1; verdict = { ok: true, counted: false }; }
    if (!verdict.ok) {
      const label = budgetFor(budgets, agent.model_id)?.label ?? '*';
      return { kind: 'throttled', model: label, reason: verdict.reason, delaySeconds: verdict.retryAfterSec };
    }
  }
  await start(env, { uid, agent });
  const admitted = sqlTimeMs(run.created_at);
  return { kind: 'ack', admittedAgeSec: admitted == null ? undefined : Math.max(0, Math.floor((now().getTime() - admitted) / 1000)) };
}

export async function agentQueueConsumer(batch: Batch, env: Env, _ctx: ExecutionContext, start: StartRun = startWithRuntime, deps: AgentQueueDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const budgets = readModelBudgets(env);
  const messages = batch.messages;
  const outcomes: QueueOutcome[] = new Array(messages.length);
  const groups = new Map<string, number[]>();
  messages.forEach((m, i) => {
    const uid = runUidOf(m.body);
    if (!uid) { console.warn('[agent-queue] not_an_agent_run'); outcomes[i] = { kind: 'ack' }; return; }
    groups.set(uid, [...(groups.get(uid) ?? []), i]);
  });
  const flags = { budgetUnavailable: 0 };
  const uids = [...groups.keys()];
  const settled = await Promise.allSettled(uids.map((uid) => dispatchOne(env, uid, start, budgets, now, flags)));
  const resend: Array<{ i: number; delaySeconds: number }> = [];
  settled.forEach((s, k) => {
    const idx = groups.get(uids[k])!;
    if (s.status === 'rejected') { console.warn('[agent-queue] start_failed'); for (const i of idx) outcomes[i] = { kind: 'retry' }; return; }
    idx.forEach((i, j) => {
      // A throttled run is sent again once; its duplicates in this batch are only acknowledged.
      if (s.value.kind === 'throttled' && j === 0) resend.push({ i, delaySeconds: s.value.delaySeconds });
      outcomes[i] = j === 0 ? s.value : { kind: 'ack' };
    });
  });
  const resent = await Promise.allSettled(resend.map(({ i, delaySeconds }) => {
    if (!env.AGENT_QUEUE) return Promise.reject(new Error('agent_queue_unbound'));
    return env.AGENT_QUEUE.send(messages[i].body, { delaySeconds });
  }));
  const resendFailed = new Set(resend.filter((_, k) => resent[k].status === 'rejected').map((r) => r.i));
  messages.forEach((m, i) => {
    const o = outcomes[i];
    if (o.kind === 'retry') m.retry({ delaySeconds: 30 });
    else if (o.kind === 'throttled' && resendFailed.has(i)) { console.warn('[agent-queue] throttle_resend_failed'); m.retry({ delaySeconds: o.delaySeconds }); }
    else m.ack();
  });
  await recordDispatchMetrics(env, now(), messages, outcomes, flags.budgetUnavailable);
}

/**
 * D7077 — the dispatch's low-cardinality metrics, one batch at a time, into `system_metrics` like the
 * sweep's and the repair's. Labels are only `DISPATCH_LABEL_KEYS`: a model as the knob names it and a
 * throttle reason. Never a run, task, agent, scope, user, prompt or output.
 */
async function recordDispatchMetrics(env: Env, now: Date, messages: Batch['messages'], outcomes: QueueOutcome[], budgetUnavailable: number): Promise<void> {
  const rows: Array<[string, number, Record<string, string>?]> = [];
  const started = outcomes.filter((o) => o.kind === 'ack' && o.admittedAgeSec !== undefined) as Array<{ kind: 'ack'; admittedAgeSec: number }>;
  const failed = outcomes.filter((o) => o.kind === 'retry').length;
  if (started.length) {
    rows.push(['agent_dispatch_started', started.length]);
    rows.push(['agent_dispatch_admitted_to_started_seconds', Math.max(...started.map((o) => o.admittedAgeSec))]);
  }
  if (failed) rows.push(['agent_dispatch_start_failed', failed]);
  if (budgetUnavailable) rows.push(['agent_dispatch_budget_unavailable', budgetUnavailable]);
  const ages = messages.map((m) => (m.timestamp instanceof Date ? m.timestamp.getTime() : NaN)).filter(Number.isFinite);
  if (ages.length) rows.push(['agent_dispatch_queue_age_seconds', Math.max(0, Math.floor((now.getTime() - Math.min(...ages)) / 1000))]);
  const throttled = new Map<string, { model: string; reason: string; n: number }>();
  for (const o of outcomes) {
    if (o.kind !== 'throttled') continue;
    const k = `${o.model}\u0000${o.reason}`;
    const t = throttled.get(k) ?? { model: o.model, reason: o.reason, n: 0 };
    t.n += 1;
    throttled.set(k, t);
  }
  for (const t of throttled.values()) rows.push(['agent_dispatch_throttled', t.n, { model: t.model, reason: t.reason }]);
  if (rows.length) await recordRepairMetrics(env, rows.map(([name, value, labels]) => [name, value, dispatchLabels(labels)]));
}

/** Keeps only the allowed label keys. */
export function dispatchLabels(labels: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of DISPATCH_LABEL_KEYS) if (labels && typeof labels[k] === 'string') out[k] = labels[k].slice(0, 128);
  return out;
}

/**
 * D4593 (#4593, audit R2-06) — the repair behind an exhausted message, and the acknowledgement table.
 *
 * State the repair reads, and what it does with each (every row is idempotent, so a redelivery, a
 * second handler or the sweep reaches the same end):
 *
 *   run              task                       does                                          result
 *   gone             —                          nothing to repair                             settled
 *   admitted         any                        run → failed `queue_exhausted`, then below    —
 *   failed (ours)    a newer attempt or a live   nothing: the newer lifecycle is not ours      settled
 *                    run exists for the task
 *   failed (ours)    in_progress                task → open (only from in_progress)           repaired
 *   failed (ours)    open/done/blocked/gone     nothing: reopened, cancelled or completed     settled
 *   any other        any                        nothing: it moved on without us               settled
 *   (a database error, a timeout, an unknown commit)                                           throws
 *
 * `repaired` and `settled` are the only outcomes that let a message be mirrored and acknowledged, and
 * they are read back from D1, never inferred from a statement having run. A throw leaves the message
 * to be retried. Nothing here admits, starts, refunds or charges anything.
 */
export type Repair = 'repaired' | 'settled';

export async function repairExhaustedRun(env: Env, uid: string): Promise<Repair> {
  let run = await runByUid(env, uid);
  if (!run) return 'settled';
  if (run.status === 'admitted') {
    let failed: unknown = null;
    try {
      await env.DB.prepare(
        "UPDATE agent_task_runs SET status = 'failed', refusal = 'queue_exhausted', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'admitted'",
      ).bind(run.id).run();
    } catch (e) { failed = e; }
    // Read it back: an unknown commit outcome, or another handler's win, reads the same either way.
    run = await runByUid(env, uid);
    if (!run) return 'settled';
    if (failed && run.status === 'admitted') throw failed;
  }
  if (run.status !== 'failed' || run.refusal !== 'queue_exhausted') return 'settled';
  await untrackEnded(env, run);
  const newer = await env.DB.prepare(
    `SELECT 1 AS n FROM agent_task_runs
      WHERE task_id = ? AND id <> ? AND (attempt > ? OR status IN ('admitted', 'running', 'waiting_decision')) LIMIT 1`,
  ).bind(run.task_id, run.id, run.attempt).first<{ n: number }>();
  if (newer) return 'settled';
  let moved = false, failedMove: unknown = null;
  try { moved = await moveTask(env, run.task_id, 'open', ['in_progress']); } catch (e) { failedMove = e; }
  if (moved) return 'repaired';
  const task = await env.DB.prepare('SELECT status FROM scope_tasks WHERE id = ?').bind(run.task_id).first<{ status: string }>();
  // Still in_progress after a move that changed nothing: a race we cannot read the end of. Try again.
  if (task?.status === 'in_progress') throw failedMove ?? new Error('task_reopen_unconfirmed');
  return 'settled';
}

/**
 * D4594 §4 (#4594, for #4593): the repair ends the run in D1; this tells the scope's object too, so its
 * live view (the status socket) stops listing it. Best effort and never throws: admission is decided by
 * D1, so a missed track costs only a stale row until the next rebuild, and it must not fail the repair.
 */
async function untrackEnded(env: Env, run: NonNullable<Awaited<ReturnType<typeof runByUid>>>): Promise<void> {
  try {
    const agent = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(run.agent_id).first<AgentRow>();
    if (!agent) return;
    await (await import('./doRuntime')).trackRun(env, scopeOfRow(agent), run);
  } catch { console.warn('[agent-dlq] untrack_failed'); }
}

/** Low-cardinality repair telemetry: an outcome code and a number, never a run, task, tenant or payload. */
export async function recordRepairMetrics(env: Env, rows: Array<[string, number, Record<string, string | number | boolean>?]>): Promise<void> {
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await env.DB.batch(rows.map(([name, value, labels]) => env.DB.prepare(
      'INSERT INTO system_metrics (timestamp, metric_name, value, labels) VALUES (?, ?, ?, ?)',
    ).bind(at, name, value, JSON.stringify(labels ?? {}))));
  } catch { console.warn('[agent-dlq] repair_metrics_unwritable'); }
}

/**
 * The DLQ queue retries a message `max_retries` (3) times and then drops it, so the last delivery
 * hands the obligation to the sweep (`sweepStrandedRuns`), which finds it from D1's own state: an
 * `admitted` run is resent by the existing resend step, a `failed` `queue_exhausted` run whose task is
 * still `in_progress` is reopened by the repair sweep. Neither depends on this message surviving.
 */
export const DLQ_FINAL_ATTEMPT = 3;
const DLQ_RETRY_SECONDS = 30;

/**
 * Exhausted messages. Each message is repaired on its own and is mirrored and acknowledged only when
 * its own repair is read back as done. A failed repair is retried (`retry`), not mirrored: one
 * message's mirror can never acknowledge another message's failed repair.
 */
// `mirror` is the job queue's dlqConsumer, handed in by dispatchQueue: this file never imports
// queue-consumer.ts, which reaches billing and Stripe (fund_modules_no_stripe_d707 walks dynamic imports too).
export async function agentDlqConsumer(batch: Batch, env: Env, ctx: ExecutionContext, mirror: Consumer): Promise<void> {
  const settled: Array<Batch['messages'][number]> = [];
  const outcomes: Record<string, number> = {};
  const count = (k: string) => { outcomes[k] = (outcomes[k] ?? 0) + 1; };
  for (const m of batch.messages) {
    const uid = runUidOf(m.body);
    if (!uid) { settled.push(m); count('not_a_run'); continue; }
    try {
      count(await repairExhaustedRun(env, uid));
      settled.push(m);
    } catch {
      console.warn('[agent-dlq] repair_failed');
      if (Number(m.attempts ?? 1) >= DLQ_FINAL_ATTEMPT) { count('deferred_to_sweep'); settled.push(m); }
      else { count('retry'); m.retry({ delaySeconds: DLQ_RETRY_SECONDS }); }
    }
  }
  await recordRepairMetrics(env, Object.entries(outcomes).map(([outcome, n]) => ['agent_dlq_repair_outcome', n, { outcome }]));
  if (settled.length) {
    await mirror({ queue: batch.queue, messages: settled, ackAll() {}, retryAll() {} } as unknown as Batch, env, ctx);
  }
}

export type QueueConsumers = { queue: Consumer; dlq: Consumer; agent: Consumer; agentDlq: (batch: Batch, env: Env, ctx: ExecutionContext, mirror: Consumer) => Promise<void> };

/** The `queue()` handler's routing. The agent branch is first; see the header. */
export async function dispatchQueue(batch: Batch, env: Env, ctx: ExecutionContext, c: QueueConsumers): Promise<void> {
  const name = batch.queue ?? '';
  if (name.includes('agent-queue')) {
    if (name.endsWith('-dlq')) return c.agentDlq(batch, env, ctx, c.dlq);
    return c.agent(batch, env, ctx);
  }
  // Task #7 (IE) — DLQ batches go to dlqConsumer, which mirrors them to D1.
  if (name.includes('dlq')) return c.dlq(batch, env, ctx);
  return c.queue(batch, env, ctx);
}
