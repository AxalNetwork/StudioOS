/**
 * #4594 (audit R2-11) — the agent lifecycle harness: LOCAL SIMULATION of the
 * whole agent path with REAL authorization, admission, accounting and state
 * transitions, and STUBBED INFERENCE only.
 *
 * What is real here, and what is not:
 *   real     the migrated schema (`_storage_schema.ts`); the engine routes and
 *            their auth (JWT, the scope's gates); `admitInScope` and the scope
 *            object (`ScopeCore` over in-memory storage); the queue consumer
 *            and `dispatchQueue`; the loop (`runTaskLoop`) and every step;
 *            `agentRun` and `aiRouter.run()`, so holds, settlement, usage rows
 *            and charges are the production code's; `decideRail` and
 *            `deliverDecision`; the DLQ repair.
 *   stubbed  `env.AI` (the Workers AI binding): a deterministic answer, a
 *            timeout, a 429 or a throw, per call. Llama Guard answers "safe"
 *            (`_guard_stub.mjs`).
 *   faked    the Workflow binding (`fakeWorkflows`: one instance per id), the
 *            AGENT_SCOPE binding (forwarding to the in-memory scope objects), and
 *            the step runner (`lifecycleStep`: memoised by name, a crash
 *            between running a step and saving it, a decision read from the
 *            instance's events); the queue (an array). These stand in for
 *            Cloudflare's runtime and are NOT a hosted test (#4594 Stage A
 *            proper needs owner approval and a passed #4566 preflight).
 *
 * Every row is made up; no prompt, output or name is logged.
 */
import { world, type World, SPONSOR } from './_agent_engine_fixture.ts';
import { withGuard, GUARD_MODEL } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import type { StepLike } from '../src/agents/loop.ts';

export const EVIDENCE_LABEL = 'LOCAL SIMULATION · real orchestration and accounting code · STUBBED INFERENCE · fake Workflow and queue bindings';

/** What the stubbed model does on each call, in order; the last mode repeats. */
export type AiMode = 'ok' | 'timeout' | 'rate_limited' | 'throw';
export const STUB_ANSWER = 'A synthetic draft plan with three milestones.';

export function lifecycleWorld(o: { engine?: string; autonomy?: string; modes?: AiMode[] } = {}) {
  __resetForTest();
  const w = world({ engine: o.engine, autonomy: o.autonomy });
  // The sponsor's plan, licence cap row and top-up balance: what `run()` holds and charges against.
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE id = ?").run(SPONSOR);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(SPONSOR);
  // The scope objects as production reaches them from outside the runtime seam (the cancel route,
  // deliverDecision's default deps): through the AGENT_SCOPE binding. Here it forwards to the same
  // in-memory ScopeCores the runtime uses, so a track from any path lands in one place.
  w.env.AGENT_SCOPE = {
    idFromName: (name: string) => name,
    get: () => ({
      async fetch(req: Request) {
        const body = await req.json() as Record<string, any>;
        const out = await w.caller(body.scope, new URL(req.url).pathname, body);
        return new Response(JSON.stringify(out ?? { ok: true }), { headers: { 'content-type': 'application/json' } });
      },
    }),
  };
  const modes = [...(o.modes ?? ['ok'])];
  const ai = { calls: 0, models: [] as string[], modes };
  w.env.AI = withGuard({
    run: async (model: string) => {
      ai.calls += 1;
      ai.models.push(model);
      const mode = modes.length > 1 ? modes.shift()! : modes[0];
      if (mode === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      if (mode === 'rate_limited') throw Object.assign(new Error('429 Too Many Requests'), { status: 429 });
      if (mode === 'throw') throw new Error('upstream exploded');
      return { response: STUB_ANSWER, usage: { prompt_tokens: 40, completion_tokens: 10 } };
    },
  });
  return { ...w, ai };
}
export type LifeWorld = ReturnType<typeof lifecycleWorld>;

/** Model calls other than Llama Guard's. */
export const modelCalls = (w: LifeWorld) => w.ai.models.filter((m) => m !== GUARD_MODEL).length;

/**
 * The step runner a Workflow gives `runTaskLoop`: `do` memoises by name across
 * replays, retries a throw up to 3 times, and can crash once after a step ran
 * but before its result was saved. `waitForEvent` reads the run's instance in
 * the fake binding: the decision `deliverDecision` sent, or a timeout once
 * `expire()` is called (the 7 days ran out).
 */
export function lifecycleStep(w: World, uid: string) {
  const saved = new Map<string, unknown>();
  const executed: string[] = [];
  const opts: { crashBeforeSave?: string; expired?: boolean; beforeStep?: (name: string) => Promise<void> | void } = {};
  class Crash extends Error {}
  const step: StepLike = {
    async do<T>(name: string, _cfg: unknown, fn: () => Promise<T>): Promise<T> {
      if (saved.has(name)) return saved.get(name) as T;
      if (opts.beforeStep) await opts.beforeStep(name);
      for (let attempt = 1; ; attempt += 1) {
        executed.push(name);
        try {
          const v = await fn();
          if (opts.crashBeforeSave === name) { opts.crashBeforeSave = undefined; throw new Crash('crash'); }
          saved.set(name, v);
          return v;
        } catch (e) {
          if (e instanceof Crash || attempt > 3) throw e;
        }
      }
    },
    async waitForEvent<T>(_name: string, _o: { type: string; timeout: string }): Promise<{ payload: T }> {
      for (let i = 0; i < 2000; i += 1) {
        const inst = w.workflows.instances.get(uid);
        const ev = inst?.events.find((e: any) => e?.type === 'decision') as { payload: T } | undefined;
        if (ev) return { payload: ev.payload };
        if (opts.expired || inst?.terminated) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 1));
      }
      throw new Error('timeout');
    },
  };
  return { step, executed, opts, isCrash: (e: unknown) => e instanceof Crash };
}

/** Wait until a condition holds (the loop runs in the background while the test acts as a person). */
export async function until(cond: () => boolean, what: string, max = 2000): Promise<void> {
  for (let i = 0; i < max; i += 1) { if (cond()) return; await new Promise((r) => setTimeout(r, 1)); }
  throw new Error(`timed out waiting for ${what}`);
}

/** A message batch as the queue runtime hands it over: ack / retry recorded. */
export function batchOf(queue: string, bodies: unknown[], attempts = 1) {
  const acked: number[] = [], retried: number[] = [];
  const messages = bodies.map((body, i) => ({
    id: `m${i}`, timestamp: new Date(), body, attempts,
    ack() { acked.push(i); }, retry() { retried.push(i); },
  }));
  return { batch: { queue, messages, ackAll() {}, retryAll() {} } as any, acked, retried };
}

/**
 * The ledger a run leaves: every count the acceptance criteria name. `pending`
 * holds are orphans; a run key with two proposals or two settled holds is a
 * double effect.
 */
export function ledger(w: World) {
  const n = (sql: string, ...a: unknown[]) => Number((w.db.prepare(sql).get(...(a as any[])) as any).n);
  const rows = (sql: string, ...a: unknown[]) => w.db.prepare(sql).all(...(a as any[])) as any[];
  return {
    runs: rows('SELECT uid, status, refusal, step, proposal_uid, task_id FROM agent_task_runs ORDER BY id'),
    holds: rows('SELECT idempotency_key, execution_id, status, operation, included_microusd + topup_microusd AS held, COALESCE(actual_included_microusd, 0) + COALESCE(actual_topup_microusd, 0) AS actual FROM ai_budget_reservations ORDER BY created_at'),
    pendingHolds: n("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status IN ('pending', 'review')"),
    proposals: rows('SELECT uid, run_key, agent_id, task_id, status, usage_log_id FROM ai_rail_proposals ORDER BY id'),
    duplicateProposals: n('SELECT COUNT(*) AS n FROM (SELECT run_key FROM ai_rail_proposals WHERE run_key IS NOT NULL GROUP BY run_key HAVING COUNT(*) > 1)'),
    duplicateSettlements: n("SELECT COUNT(*) AS n FROM (SELECT idempotency_key FROM ai_budget_reservations WHERE status = 'settled' GROUP BY idempotency_key HAVING COUNT(*) > 1)"),
    charged: n('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE agent_id IS NOT NULL'),
    usage: rows('SELECT id, task, model, charged_microusd, agent_id, user_id, rail_option FROM ai_usage_logs ORDER BY id'),
    instances: w.workflows.instances.size,
    queued: w.queue.length,
  };
}
