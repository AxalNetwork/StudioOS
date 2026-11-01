/**
 * D1502 (#3753, deck v2 A3a) — the deck generation runtime, behind a seam.
 *
 * Routes talk only to `DeckGenRuntime` (`admit`, `startBatch`, `cancel`,
 * `status`, `rebuild`). `D1GenRuntime` is the implementation over D1 that every
 * other one builds on: `DeckGenRoom` (part 2, one Durable Object per deck, so a
 * run survives a closed tab) drives it, and B9's Queue fallback will too. The
 * contract suite (`deck_gen_runtime_contract.test.ts`) runs against every one.
 *
 * ONE QUOTE, ONE HOLD (dk-auto AUTO-6, option (a): a `deck_build` class).
 *   - A run is a plan of lines: an area's text, an image, a guard or vision
 *     check, a critique pass, a retry. The quote is the sum of the lines, each
 *     line priced at its run's maximum (`quoteRun`), so what the run settles
 *     can never exceed it: quote = parent hold = sum of the lines ≥ settled.
 *   - `admit` takes ONE parent hold for the whole quote (`reserveBatch`), keyed
 *     by the request's `Idempotency-Key`, so a retried request is the same run
 *     and is never charged twice.
 *   - Each step runs under that hold (`RunOptions.parentHold`): it takes no hold
 *     of its own; its usage row names the parent and records its charge. The run
 *     settles the parent once, at the sum of its steps, when it ends.
 *   - A long run keeps its hold alive (`extendAiReservation`) at every step, so
 *     the five-minute rule never releases it mid-run.
 *
 * STOP charges what started. `cancel` stops the run at the next step: steps not
 * started are `stopped` and charged nothing; the parent settles at what ran,
 * and the rest of the hold is released.
 *
 * A FAILED STEP never sinks the others: it is `failed`, its area reports
 * `area_failed`, and the run goes on.
 *
 * CRASH SAFE. Every step's state is in D1 (migration 716). A step that is `done`
 * is never run again. `rebuild` restores a run whose driver died: a step left
 * `running` is `done` if its usage row exists (the charge happened), else back
 * to `waiting` (nothing was charged). Then `startBatch` resumes it.
 *
 * Caps are throttles, not ceilings: a whole-deck run of 30–45 areas is admitted
 * and queues its steps; the `AiGovernor` (part 2) paces them per model and
 * account. One active run per deck (migration 716's partial unique index).
 */
import type { Env } from '../../types';
import { extendAiReservation, reserveAiBudget, settleAiReservation } from '../aiBudget';
import { modelById } from '../ai/catalogue';

export const FREE_LABEL = 'No model · free';
export const MAX_LINES = 400;

export type RunClass = 'areas' | 'deck_build';
export type PlanLine = {
  card_uid?: string | null;
  area_id?: string | null;
  element: string;
  /** What the step does: text, image, guard, vision, critique, retry. */
  kind: string;
  task?: string | null;
  model?: string | null;
  quote_microusd: number;
};
export type AdmitInput = {
  deckId: number; projectId: number; userId: number; cls: RunClass;
  idemKey: string; lines: PlanLine[]; quoteUid?: string | null;
};
export type Admitted =
  | { ok: true; uid: string; quote_microusd: number; reservation_uid: string | null; replayed: boolean }
  | { ok: false; refusal: string; message: string };

export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
export type BatchState = 'queued' | 'running' | 'cancelling' | 'done' | 'cancelled' | 'failed';
export type StepRow = {
  batch_uid: string; seq: number; card_uid: string | null; area_id: string | null; element: string; kind: string;
  task: string | null; model: string | null; state: StepState; quote_microusd: number; charged_microusd: number;
  model_used: string | null; fallback_used: number; usage_log_id: number | null; error_code: string | null;
  started_at: string | null; ended_at: string | null;
};
export type BatchRow = {
  uid: string; deck_id: number; project_id: number; class: RunClass; state: BatchState; quote_uid: string | null;
  quote_microusd: number; reservation_uid: string | null; charged_microusd: number; idem_key: string; created_by: number;
  created_at: string; started_at: string | null; settled_at: string | null;
};
export type StepResult = {
  ok: boolean; charged_microusd: number; model_used?: string | null; fallback_used?: boolean;
  usage_log_id?: number | null; error_code?: string | null; variant?: unknown;
};
/** Runs one step under the parent hold. The default (part 2) calls `aiRouter.run` with `parentHold` and `rail.record = stepRecordRef(…)`. */
export type StepExecutor = (step: StepRow, ctx: { batch: BatchRow; parentHold: { uid: string; userId: number } | null }) => Promise<StepResult>;

/** What pd2b draws per row, plus the running "charged so far of held". */
export type GenEvent = {
  type: 'area_started' | 'step_done' | 'variant_ready' | 'area_failed' | 'batch_done';
  batch_uid: string; seq?: number; card_uid?: string | null; area_id?: string | null; element?: string;
  model_label?: string; state: StepState | BatchState; seconds?: number; cost_microusd?: number;
  charged_microusd: number; held_microusd: number; variant?: unknown;
};
export type BatchStatus = BatchRow & { steps: StepRow[]; held_microusd: number };

export interface DeckGenRuntime {
  admit(input: AdmitInput): Promise<Admitted>;
  startBatch(uid: string): Promise<BatchStatus | null>;
  cancel(uid: string, userId: number): Promise<BatchStatus | null>;
  status(uid: string): Promise<BatchStatus | null>;
  rebuild(uid: string): Promise<BatchStatus | null>;
}

/** The `record_ref` a step's usage row carries, so `rebuild` can tell a step that charged from one that did not. */
export const stepRecordRef = (batchUid: string, seq: number) => `deckstep:${batchUid}:${seq}`;
export const modelLabel = (model: string | null | undefined) => (model ? (modelById(model)?.name ?? model) : FREE_LABEL);
const ACTIVE: readonly BatchState[] = ['queued', 'running', 'cancelling'];
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const KEY = /^[A-Za-z0-9._:-]{8,120}$/;

export function quoteOf(lines: readonly PlanLine[]): number {
  return lines.reduce((s, l) => s + Math.max(0, Math.ceil(Number(l.quote_microusd) || 0)), 0);
}

export class D1GenRuntime implements DeckGenRuntime {
  private env: Env;
  private execute: StepExecutor;
  private emit: (e: GenEvent) => void | Promise<void>;
  constructor(env: Env, execute: StepExecutor, emit: (e: GenEvent) => void | Promise<void> = () => {}) {
    this.env = env;
    this.execute = execute;
    this.emit = emit;
  }

  private async batchRow(uid: string): Promise<BatchRow | null> {
    return (await this.env.DB.prepare('SELECT * FROM deck_area_batches WHERE uid = ?1').bind(uid).first<BatchRow>()) ?? null;
  }
  private async steps(uid: string): Promise<StepRow[]> {
    const r = await this.env.DB.prepare('SELECT * FROM deck_area_batch_steps WHERE batch_uid = ?1 ORDER BY seq').bind(uid).all<StepRow>();
    return (r.results || []) as StepRow[];
  }

  async status(uid: string): Promise<BatchStatus | null> {
    const b = await this.batchRow(uid);
    if (!b) return null;
    const steps = await this.steps(uid);
    return { ...b, steps, charged_microusd: steps.reduce((s, x) => s + Number(x.charged_microusd), 0), held_microusd: Number(b.quote_microusd) };
  }

  async admit(input: AdmitInput): Promise<Admitted> {
    if (!KEY.test(input.idemKey)) return { ok: false, refusal: 'invalid_idempotency_key', message: 'Send an Idempotency-Key of 8 to 120 letters, digits or . _ : -.' };
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) return { ok: false, refusal: 'empty_plan', message: 'Nothing to generate.' };
    if (lines.length > MAX_LINES) return { ok: false, refusal: 'plan_too_large', message: `A run holds at most ${MAX_LINES} steps.` };
    // A retried request is the same run: one hold, one charge.
    const same = await this.env.DB.prepare('SELECT * FROM deck_area_batches WHERE idem_key = ?1').bind(input.idemKey).first<BatchRow>();
    if (same) {
      if (Number(same.created_by) !== input.userId || Number(same.deck_id) !== input.deckId) return { ok: false, refusal: 'idempotency_key_reused', message: 'That Idempotency-Key belongs to another run.' };
      return { ok: true, uid: same.uid, quote_microusd: Number(same.quote_microusd), reservation_uid: same.reservation_uid, replayed: true };
    }
    const busy = await this.env.DB.prepare(`SELECT uid FROM deck_area_batches WHERE deck_id = ?1 AND state IN ('queued','running','cancelling')`).bind(input.deckId).first<{ uid: string }>();
    if (busy) return { ok: false, refusal: 'deck_busy', message: 'This deck is already generating. Stop it or wait for it to finish.' };
    const quote = quoteOf(lines);
    const uid = crypto.randomUUID();
    let reservation: { uid: string; userId: number } | null = null;
    if (quote > 0) {
      const held = await reserveBatch(this.env, input.userId, quote, input.idemKey, uid);
      if (!held.ok) return { ok: false, refusal: held.refusal, message: 'Your AI allowance cannot hold this run.' };
      reservation = held.reservation;
    }
    // The run and its steps land together or not at all (one D1 batch is one
    // transaction): a replayed request never sees a run without its plan.
    const insertRun = this.env.DB.prepare(
      `INSERT INTO deck_area_batches (uid, deck_id, project_id, class, state, quote_uid, quote_microusd, reservation_uid, idem_key, created_by)
       SELECT ?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, ?8, ?9
        WHERE NOT EXISTS (SELECT 1 FROM deck_area_batches WHERE deck_id = ?2 AND state IN ('queued','running','cancelling'))
          AND NOT EXISTS (SELECT 1 FROM deck_area_batches WHERE idem_key = ?8)`,
    ).bind(uid, input.deckId, input.projectId, input.cls, input.quoteUid ?? null, quote, reservation?.uid ?? null, input.idemKey, input.userId);
    const insertSteps = lines.map((l, seq) => this.env.DB.prepare(
      `INSERT INTO deck_area_batch_steps (batch_uid, seq, card_uid, area_id, element, kind, task, model, quote_microusd)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM deck_area_batches WHERE uid = ?1)`,
    ).bind(uid, seq, l.card_uid ?? null, l.area_id ?? null, String(l.element), String(l.kind), l.task ?? null, l.model ?? null, Math.max(0, Math.ceil(Number(l.quote_microusd) || 0))));
    const wrote = await this.env.DB.batch([insertRun, ...insertSteps]).catch(() => null);
    if (!wrote || !Number(wrote[0]?.meta?.changes)) {
      // Another request with the same key won the race: that run is this one.
      // Its hold is the same keyed hold, so nothing is released.
      const raced = await this.env.DB.prepare('SELECT * FROM deck_area_batches WHERE idem_key = ?1').bind(input.idemKey).first<BatchRow>();
      if (raced && Number(raced.created_by) === input.userId && Number(raced.deck_id) === input.deckId) {
        return { ok: true, uid: raced.uid, quote_microusd: Number(raced.quote_microusd), reservation_uid: raced.reservation_uid, replayed: true };
      }
      // A hold no run holds (the deck was busy) is given back; the keyed hold
      // of a run under the same key is that run's, and stays.
      if (reservation && raced?.reservation_uid !== reservation.uid) await settleAiReservation(this.env, reservation, 0, true).catch(() => {});
      if (raced) return { ok: false, refusal: 'idempotency_key_reused', message: 'That Idempotency-Key belongs to another run.' };
      return { ok: false, refusal: 'deck_busy', message: 'This deck is already generating. Stop it or wait for it to finish.' };
    }
    return { ok: true, uid, quote_microusd: quote, reservation_uid: reservation?.uid ?? null, replayed: false };
  }

  async startBatch(uid: string): Promise<BatchStatus | null> {
    const b0 = await this.batchRow(uid);
    if (!b0) return null;
    if (!ACTIVE.includes(b0.state)) return this.status(uid);
    await this.env.DB.prepare(`UPDATE deck_area_batches SET state = 'running', started_at = COALESCE(started_at, ?2) WHERE uid = ?1 AND state = 'queued'`).bind(uid, nowSql()).run();
    const parent = b0.reservation_uid ? { uid: b0.reservation_uid, userId: Number(b0.created_by) } : null;
    for (;;) {
      const b = (await this.batchRow(uid))!;
      if (b.state !== 'running') break;
      const step = await this.env.DB.prepare(`SELECT * FROM deck_area_batch_steps WHERE batch_uid = ?1 AND state = 'waiting' ORDER BY seq LIMIT 1`).bind(uid).first<StepRow>();
      if (!step) break;
      // Claim the step; a second driver that raced here claims nothing and stops.
      const claim = await this.env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'running', started_at = ?3 WHERE batch_uid = ?1 AND seq = ?2 AND state = 'waiting'`).bind(uid, step.seq, nowSql()).run();
      if (!Number(claim?.meta?.changes)) break;
      if (parent) await extendAiReservation(this.env, parent).catch(() => false);
      const started = Date.now();
      const charged0 = await this.chargedSoFar(uid);
      await this.emit({ type: 'area_started', batch_uid: uid, seq: step.seq, card_uid: step.card_uid, area_id: step.area_id, element: step.element, model_label: modelLabel(step.model), state: 'running', charged_microusd: charged0, held_microusd: Number(b.quote_microusd) });
      let r: StepResult;
      try { r = await this.execute({ ...step, state: 'running' }, { batch: b, parentHold: parent }); }
      catch { r = { ok: false, charged_microusd: 0, error_code: 'step_threw' }; }
      // Never more than the step's line: the quote stays the settled maximum.
      const charged = Math.min(Math.max(0, Math.ceil(Number(r.charged_microusd) || 0)), Number(step.quote_microusd));
      await this.env.DB.prepare(
        `UPDATE deck_area_batch_steps SET state = ?3, charged_microusd = ?4, model_used = ?5, fallback_used = ?6, usage_log_id = ?7, error_code = ?8, ended_at = ?9
          WHERE batch_uid = ?1 AND seq = ?2 AND state = 'running'`,
      ).bind(uid, step.seq, r.ok ? 'done' : 'failed', charged, r.model_used ?? step.model, r.fallback_used ? 1 : 0, r.usage_log_id ?? null, r.ok ? null : (r.error_code ?? 'step_failed'), nowSql()).run();
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const so = await this.chargedSoFar(uid);
      const base = { batch_uid: uid, seq: step.seq, card_uid: step.card_uid, area_id: step.area_id, element: step.element, model_label: modelLabel(r.model_used ?? step.model), seconds, cost_microusd: charged, charged_microusd: so, held_microusd: Number(b.quote_microusd) };
      if (r.ok) {
        await this.emit({ type: 'step_done', ...base, state: 'done' });
        if (r.variant !== undefined) await this.emit({ type: 'variant_ready', ...base, state: 'done', variant: r.variant });
      } else {
        await this.emit({ type: 'area_failed', ...base, state: 'failed' });
      }
    }
    return this.finish(uid);
  }

  private async chargedSoFar(uid: string): Promise<number> {
    const r = await this.env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM deck_area_batch_steps WHERE batch_uid = ?1').bind(uid).first<{ n: number }>();
    return Number(r?.n || 0);
  }

  /** Ends a run that has no step left to start: stops the waiting ones when cancelling, settles the parent once. */
  private async finish(uid: string): Promise<BatchStatus | null> {
    const b = await this.batchRow(uid);
    if (!b || !ACTIVE.includes(b.state)) return this.status(uid);
    const running = await this.env.DB.prepare(`SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE batch_uid = ?1 AND state = 'running'`).bind(uid).first<{ n: number }>();
    if (Number(running?.n || 0) > 0) return this.status(uid); // another driver is mid-step; it finishes the run
    if (b.state === 'cancelling') {
      await this.env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'stopped', ended_at = ?2 WHERE batch_uid = ?1 AND state = 'waiting'`).bind(uid, nowSql()).run();
    } else {
      const waiting = await this.env.DB.prepare(`SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE batch_uid = ?1 AND state = 'waiting'`).bind(uid).first<{ n: number }>();
      if (Number(waiting?.n || 0) > 0) return this.status(uid);
    }
    const charged = await this.chargedSoFar(uid);
    const done = await this.env.DB.prepare(`SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE batch_uid = ?1 AND state = 'done'`).bind(uid).first<{ n: number }>();
    const end: BatchState = b.state === 'cancelling' ? 'cancelled' : Number(done?.n || 0) > 0 ? 'done' : 'failed';
    const closed = await this.env.DB.prepare(`UPDATE deck_area_batches SET state = ?2, charged_microusd = ?3, settled_at = ?4 WHERE uid = ?1 AND state IN ('queued','running','cancelling')`)
      .bind(uid, end, charged, nowSql()).run();
    if (Number(closed?.meta?.changes) && b.reservation_uid) {
      await settleAiReservation(this.env, { uid: b.reservation_uid, userId: Number(b.created_by) }, charged, charged === 0);
    }
    await this.emit({ type: 'batch_done', batch_uid: uid, state: end, charged_microusd: charged, held_microusd: Number(b.quote_microusd) });
    return this.status(uid);
  }

  async cancel(uid: string, userId: number): Promise<BatchStatus | null> {
    const b = await this.batchRow(uid);
    if (!b || Number(b.created_by) !== userId) return null;
    if (!ACTIVE.includes(b.state)) return this.status(uid);
    await this.env.DB.prepare(`UPDATE deck_area_batches SET state = 'cancelling' WHERE uid = ?1 AND state IN ('queued','running')`).bind(uid).run();
    // A run with no step in flight ends now; one mid-step ends when that step lands.
    return this.finish(uid);
  }

  async rebuild(uid: string): Promise<BatchStatus | null> {
    const b = await this.batchRow(uid);
    if (!b) return null;
    if (!ACTIVE.includes(b.state)) return this.status(uid);
    for (const s of (await this.steps(uid)).filter((x) => x.state === 'running')) {
      const row = b.reservation_uid
        ? await this.env.DB.prepare('SELECT id, model, charged_microusd, fallback_used FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2 ORDER BY id DESC LIMIT 1')
          .bind(b.reservation_uid, stepRecordRef(uid, s.seq)).first<any>()
        : null;
      if (row) {
        await this.env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = ?3, model_used = ?4, fallback_used = ?5, usage_log_id = ?6, ended_at = ?7 WHERE batch_uid = ?1 AND seq = ?2 AND state = 'running'`)
          .bind(uid, s.seq, Math.min(Number(row.charged_microusd || 0), Number(s.quote_microusd)), row.model ?? s.model, Number(row.fallback_used) ? 1 : 0, Number(row.id), nowSql()).run();
      } else {
        await this.env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'waiting', started_at = NULL WHERE batch_uid = ?1 AND seq = ?2 AND state = 'running'`).bind(uid, s.seq).run();
      }
    }
    return this.status(uid);
  }
}

/**
 * The run's ONE parent hold, keyed by the request's Idempotency-Key, so a
 * retried request takes no second hold (D844's keyed hold).
 */
export async function reserveBatch(env: Env, userId: number, quoteMicrousd: number, idemKey: string, batchUid: string) {
  const held = await reserveAiBudget(env, userId, quoteMicrousd, new Date(), {
    idempotencyKey: `deck-batch:${idemKey}`,
    context: { operation: 'deck.generate', surface: 'ai', executionId: batchUid },
  });
  if (!held.ok) return { ok: false as const, refusal: held.refusal as string };
  return { ok: true as const, reservation: held.reservation, replayed: 'replayed' in held && held.replayed === true };
}
