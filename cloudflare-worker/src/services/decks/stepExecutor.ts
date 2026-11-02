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
 *   3. A busy model (429 or 3040) backs off with jitter and retries; then the
 *      step falls back within the same tier (the element's other suggestions,
 *      D1503's `chain`) and records `fallback_used`. Any other refusal (a guard
 *      block, an invalid input, a spent allowance) ends the step: it is not a
 *      model's to answer.
 *   4. What the step charged is what its usage rows say (`charged_microusd`
 *      summed by `record_ref` under the parent); the run clamps it to the
 *      step's line of the quote.
 *
 * A step with no task (a check the Worker does itself) runs no model and is free.
 */
import type { Env } from '../../types';
import { run as aiRun, type RunOptions, type RunResult } from '../aiRouter';
import { ELEMENT_ROUTES, GRID_PAGE } from './elementModels';
import { MAX_BUSY_RETRIES, backoffMs, governorFor, isBusy, waitForSlot, type GovernorClient } from './aiGovernor';
import { stepRecordRef, type StepExecutor, type StepRow } from './genRuntime';
import { pipelineStep } from './imageDraw';

export type ExecutorDeps = {
  run?: (env: Env, opts: RunOptions) => Promise<RunResult>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  governor?: GovernorClient;
  /** Told when a busy model is backed off ("Busy, retrying"), and when the step waits for a slot. */
  onBusy?: (step: StepRow, attempt: number, ms: number) => void | Promise<void>;
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
          userId: account, projectId: Number(ctx.batch.project_id), cardUid: step.card_uid, area: step.area_id,
          base: String(passed.text ?? ''), draw: { ...passed, task: 'deck_image', userId: account, ...(step.model ? { model: step.model } : {}) } as RunOptions,
          model: step.model, size: d.width && d.height ? { width: d.width, height: d.height } : null,
          parentHold: ctx.parentHold ?? null, rail: { page: GRID_PAGE, option, record: ref },
          run: (o) => run(env, { ...o, userId: account, parentHold: ctx.parentHold ?? undefined, idempotencyKey: `${ref}:p${n++}`, executionId: step.batch_uid, rail: { page: GRID_PAGE, option, record: ref } }),
        });
        const charged = await chargedFor(env, parentUid, ref);
        if (!r.ok) return { ok: false, charged_microusd: charged, error_code: r.code };
        return {
          ok: true, charged_microusd: charged, model_used: r.model, usage_log_id: r.usage_log_id,
          variant: { image: r.image, alt: r.alt, seed: r.seed, variant_index: r.variant_index, pipeline_uid: r.pipeline_uid, steps: r.steps, qa: r.qa, refused: r.refused },
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
          if (attempt < MAX_BUSY_RETRIES) {
            const ms = backoffMs(attempt, random);
            await deps.onBusy?.(step, attempt + 1, ms);
            await sleep(ms);
          }
        }
        // A refusal that is not a model's (guard, input, allowance) ends the step; a busy or failed model falls back.
        if (!busy && last && last.refusal !== 'all_models_failed') break;
        fellBack = true;
      }
    } finally {
      await gov.release(lease.id).catch(() => {});
    }
    return { ok: false, charged_microusd: await chargedFor(env, parentUid, ref), error_code: last?.refusal ?? 'step_failed', fallback_used: fellBack };
  };
}
