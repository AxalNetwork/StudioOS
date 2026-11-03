/**
 * D1502 part 2 (#3753, deck v2 A3a): the step executor every deck generation
 * run uses by default — one step of the plan, run under the run's ONE parent
 * hold.
 *
 *   1. Wait for a slot from the account's `AiGovernor` (per-kind throttles, two
 *      runs per account, a token bucket per model).
 *   2. Run the step through `aiRouter.run` with `parentHold` (no hold of its
 *      own), `idempotencyKey` and `executionId`, and `rail.record =
 *      stepRecordRef(…)`, so its usage rows name the parent and the step.
 *   3. A busy model (429, 503 or 3040) backs off with jitter and retries; then
 *      the step falls back within the same tier (the element's other
 *      suggestions, D1503's `chain`) and records `fallback_used`. Any other
 *      refusal (a guard block, an invalid input, a spent allowance) ends the
 *      step: it is not a model's to answer. D1600 (#3879): at most
 *      `MAX_AREA_RETRIES` (3) automatic retries in all, counted across the
 *      fallback; then the step fails `model_busy`. Each try runs under its own
 *      Idempotency-Key and the step's one record ref (4.), so a retry never
 *      settles a hold of its own: the run charges the step once, when it lands.
 *   4. What the step charged is what its usage rows say (`charged_microusd`
 *      summed by `record_ref` under the parent); the run clamps it to the
 *      step's line of the quote.
 *
 * A step with no task (a check the Worker does itself) runs no model and is free.
 */
import type { Env } from '../../types';
import { run as aiRun, type RunOptions, type RunResult } from '../aiRouter';
import { ELEMENT_ROUTES, GRID_PAGE } from './elementModels';
import { MAX_AREA_RETRIES, MAX_BUSY_RETRIES, backoffMs, governorFor, isBusy, waitForSlot, type GovernorClient } from './aiGovernor';
import { stepRecordRef, type StepExecutor, type StepRow } from './genRuntime';
import { pipelineStep } from './imageDraw';
import { runEnsemble } from '../aiRouter';
import { stepJudge } from './ensembles';
import { modelLabel } from './genRuntime';

export type ExecutorDeps = {
  run?: (env: Env, opts: RunOptions) => Promise<RunResult>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  governor?: GovernorClient;
  /** Told before each automatic retry of a busy model ("Busy, retrying"): the step's retry number (1 to `MAX_AREA_RETRIES`) and the wait. */
  onBusy?: (step: StepRow, attempt: number, ms: number) => void | Promise<void>;
  /** D1551 (#3798): told when an ensemble step's first draft lands, before its refine or its judge has run. */
  onDraft?: (step: StepRow, text: string, model: string | null) => void | Promise<void>;
};

const STEP_INPUT_KEYS = ['text', 'messages', 'systemPrompt', 'maxTokens', 'temperature', 'draw', 'drawJob', 'images', 'guardText'] as const;

function inputOf(step: StepRow): Record<string, unknown> {
  if (!step.input) return {};
  try { const v = JSON.parse(step.input); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** The same-tier candidates: the step's model, then the element's other suggestions; [undefined] lets the route choose. */
export function candidatesFor(step: Pick<StepRow, 'model' | 'element' | 'kind'>): Array<string | undefined> {
  const chain = ELEMENT_ROUTES[step.element]?.chain ?? [];
  const out: Array<string | undefined> = [];
  for (const m of [step.model, ...chain]) if (m && !out.includes(m)) out.push(m);
  return out.length ? out : [undefined];
}

/** D1512 (#3764): a stored deck image as a run's result names it: its uid, file URL, size, alt and model. */
export const storedView = (row: any) => ({
  uid: String(row.uid), url: `/api/decks/images/${row.uid}/file`, width: row.width == null ? null : Number(row.width),
  height: row.height == null ? null : Number(row.height), alt: row.alt ?? '', model: row.model ?? null,
  charged_microusd: row.charged_microusd == null ? null : Number(row.charged_microusd),
});

/** What the run's answer is, as the proposal the step leaves: text, or an image's reference. */
function variantOf(r: RunResult): unknown {
  if (r.image) return { image: r.image };
  return { text: r.output ?? '' };
}

async function chargedFor(env: Env, parentUid: string | null, ref: string): Promise<number> {
  if (!parentUid) return 0;
  const row = await env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2')
    .bind(parentUid, ref).first<{ n: number }>().catch(() => null);
  return Number(row?.n || 0);
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function stepExecutor(env: Env, deps: ExecutorDeps = {}): StepExecutor {
  const run = deps.run ?? aiRun;
  const sleep = deps.sleep ?? sleepReal;
  const random = deps.random ?? Math.random;
  return async (step, ctx) => {
    if (!step.task) return { ok: true, charged_microusd: 0, model_used: null };
    const account = Number(ctx.batch.created_by);
    const ref = stepRecordRef(step.batch_uid, step.seq);
    const parentUid = ctx.parentHold?.uid ?? null;
    const gov = deps.governor ?? governorFor(env, account);
    const lease = await waitForSlot(gov, { account, run: step.batch_uid, kind: step.kind, model: step.model }, { sleep }).catch(() => null);
    if (!lease) return { ok: false, charged_microusd: await chargedFor(env, parentUid, ref), error_code: 'governor_unavailable' };
    const input = inputOf(step);
    const passed: Partial<RunOptions> = {};
    for (const k of STEP_INPUT_KEYS) if (input[k] !== undefined) (passed as any)[k] = input[k];
    const option = typeof input.option === 'string' ? input.option : (ELEMENT_ROUTES[step.element]?.option ?? null);
    let last: RunResult | null = null;
    let fellBack = false;
    // D1505 (#3756): an image step is the image pipeline, not a bare draw:
    // expand, draw at its size and seed, check, style, alt. A refused image
    // settles at zero and is redrawn once; nothing unchecked leaves the step.
    if (step.task === 'deck_image') {
      try {
        let n = 0;
        const d = (passed.draw && typeof passed.draw === 'object' ? passed.draw : {}) as { width?: number; height?: number };
        const r = await pipelineStep(env, {
          userId: account, projectId: Number(ctx.batch.project_id), deckId: Number(ctx.batch.deck_id) || null, cardUid: step.card_uid, area: step.area_id,
          base: String(passed.text ?? ''), draw: { ...passed, task: 'deck_image', userId: account, ...(step.model ? { model: step.model } : {}) } as RunOptions,
          model: step.model, size: d.width && d.height ? { width: d.width, height: d.height } : null,
          parentHold: ctx.parentHold ?? null, rail: { page: GRID_PAGE, option, record: ref },
          // D1512 (#3764): the area's variant, and the ask the stored proposal answers.
          variant: Number(input.variant) || 0,
          store: input.store && typeof input.store === 'object' ? input.store as any : null,
          run: (o) => run(env, { ...o, userId: account, parentHold: ctx.parentHold ?? undefined, idempotencyKey: `${ref}:p${n++}`, executionId: step.batch_uid, rail: { page: GRID_PAGE, option, record: ref } }),
        });
        const charged = await chargedFor(env, parentUid, ref);
        if (!r.ok) return { ok: false, charged_microusd: charged, error_code: r.code };
        return {
          ok: true, charged_microusd: charged, model_used: r.model, usage_log_id: r.usage_log_id,
          // D1512: the stored proposal, never the bytes (a run's result is JSON, at most MAX_RESULT_CHARS).
          variant: { image: r.stored ? storedView(r.stored) : null, alt: r.alt, seed: r.seed, variant_index: r.variant_index, pipeline_uid: r.pipeline_uid, steps: r.steps, qa: r.qa, refused: r.refused },
        };
      } finally {
        await gov.release(lease.id).catch(() => {});
      }
    }
    // D1600: the step's automatic retries, counted across the fallback; at `MAX_AREA_RETRIES` it stops.
    let retries = 0;
    let exhausted = false;
    // D1551 (#3798): an ensemble step. Each of its calls runs as a single step's call does (same-tier fallback, busy
    // retries counted across the step), under the run's parent hold and the step's one record ref; the judge too.
    const ens = input.ensemble && typeof input.ensemble === 'object' ? input.ensemble as Record<string, unknown> : null;
    if (ens && (ens.mode === 'draft-refine' || ens.mode === 'best-of-n')) {
      let tag = 0;
      let fell = false;
      const tiered = async (_e: Env, o: RunOptions): Promise<RunResult> => {
        const t = tag++;
        const tier = [o.model ?? step.model, ...candidatesFor(step).filter((m) => m !== (o.model ?? step.model))].filter((m, i, a) => a.indexOf(m) === i);
        let r: RunResult | null = null;
        for (let i = 0; i < tier.length; i++) {
          let busy = false;
          for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
            r = await run(env, { ...o, ...(tier[i] ? { model: tier[i] as string } : {}), idempotencyKey: `${ref}:e${t}:${i}:${attempt}` });
            if (r.ok) { if (i > 0) fell = true; return r; }
            busy = (r.attempts ?? []).some((a) => a.called && isBusy(a));
            if (!busy || attempt >= MAX_BUSY_RETRIES || retries >= MAX_AREA_RETRIES) break;
            retries++;
            const ms = backoffMs(attempt, random);
            await deps.onBusy?.(step, retries, ms);
            await sleep(ms);
          }
          if (busy && retries >= MAX_AREA_RETRIES) { exhausted = true; break; }
          if (!busy && r && r.refusal !== 'all_models_failed') break;
        }
        return r!;
      };
      const base = {
        ...passed, task: step.task as RunOptions['task'], userId: account, ...(step.model ? { model: step.model } : {}),
        parentHold: ctx.parentHold ?? undefined, executionId: step.batch_uid, rail: { page: GRID_PAGE, option, record: ref },
      } as RunOptions;
      try {
        const out = await runEnsemble(env, base, { mode: ens.mode, n: Number(ens.n) || undefined }, {
          run: tiered,
          judge: ens.mode === 'best-of-n' ? stepJudge(env, {
            charge: { userId: account, rail: { page: GRID_PAGE, option, record: ref }, parentHold: ctx.parentHold ?? undefined, executionId: step.batch_uid },
            element: step.element, seed: ref, judgeModel: typeof ens.judge_model === 'string' ? ens.judge_model : null, judgeMicrousd: Number(ens.judge_microusd) || 0, run,
          }) : undefined,
          onDraft: deps.onDraft ? (text, model) => deps.onDraft!(step, text, model) : undefined,
        });
        const charged = await chargedFor(env, parentUid, ref);
        if (!out.ok) return { ok: false, charged_microusd: charged, error_code: exhausted ? 'model_busy' : (out.failed?.refusal ?? 'step_failed'), fallback_used: fell };
        return {
          ok: true, charged_microusd: charged, model_used: out.model, fallback_used: fell, usage_log_id: out.usageLogId,
          variant: {
            text: out.output,
            ensemble: {
              mode: out.mode, refined: out.refined, pick: out.pick, judged: out.judged, probability: out.probability,
              judge_model_label: out.judge_model ? modelLabel(out.judge_model) : null,
              calls: out.calls.map((c) => ({ role: c.role, index: c.index, ok: c.ok, model_label: modelLabel(c.model) })),
            },
          },
        };
      } finally {
        await gov.release(lease.id).catch(() => {});
      }
    }
    try {
      const candidates = candidatesFor(step);
      for (let i = 0; i < candidates.length; i++) {
        const model = candidates[i];
        let busy = false;
        for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
          const r = await run(env, {
            ...passed,
            task: step.task as RunOptions['task'],
            userId: account,
            ...(model ? { model } : {}),
            parentHold: ctx.parentHold ?? undefined,
            idempotencyKey: `${ref}:${i}:${attempt}`,
            executionId: step.batch_uid,
            rail: { page: GRID_PAGE, option, record: ref },
          });
          if (r.ok) {
            return {
              ok: true, charged_microusd: await chargedFor(env, parentUid, ref),
              model_used: r.usage?.model ?? model ?? null, fallback_used: fellBack || !!r.usage?.fallback_used,
              usage_log_id: r.usageLogId ?? null, variant: variantOf(r),
            };
          }
          last = r;
          busy = (r.attempts ?? []).some((a) => a.called && isBusy(a));
          if (!busy) break;
          if (attempt >= MAX_BUSY_RETRIES || retries >= MAX_AREA_RETRIES) break;
          retries++;
          const ms = backoffMs(attempt, random);
          await deps.onBusy?.(step, retries, ms);
          await sleep(ms);
        }
        if (busy && retries >= MAX_AREA_RETRIES) { exhausted = true; break; }
        // A refusal that is not a model's (guard, input, allowance) ends the step; a busy or failed model falls back.
        if (!busy && last && last.refusal !== 'all_models_failed') break;
        fellBack = true;
      }
    } finally {
      await gov.release(lease.id).catch(() => {});
    }
    return { ok: false, charged_microusd: await chargedFor(env, parentUid, ref), error_code: exhausted ? 'model_busy' : (last?.refusal ?? 'step_failed'), fallback_used: fellBack };
  };
}
