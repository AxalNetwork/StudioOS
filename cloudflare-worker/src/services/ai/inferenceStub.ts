/**
 * D4594 part 2 (#4594) — the deterministic inference stub for hosted Stage A.
 *
 * Hosted Stage A runs one real agent lifecycle on a throwaway preview Worker:
 * real admission, queue, Workflow, proposal, decision and accounting, with
 * STUBBED INFERENCE. The #4566 preflight passes a hosted run only when the
 * account-wide Workers AI binding is not called (`inference: "stub"`,
 * `scripts/lib/previewIsolation.mjs`), because `AI` is the account's and
 * cannot be isolated by configuration.
 *
 * THE SEAM is the one place a model call reaches Workers AI:
 * `callWorkersAI` in `services/aiRouter.ts`, which Llama Guard's check also
 * uses. With the stub on, that function is handed this binding in place of
 * `env.AI`. Everything above it runs unchanged: holds, the guard's verdict
 * handling, settlement, usage rows and charges. That is the same depth the
 * local harness stubs at (`test/_agent_lifecycle_fixture.ts`, D4594 §2).
 *
 * THE SWITCH, fail closed, like `skillEngineOf` (D4555):
 *   · `ENVIRONMENT` is exactly `preview`;
 *   · `STUDIOOS_ENV` does not say production;
 *   · `AGENT_INFERENCE_STUB` is exactly `deterministic`.
 * Anything else is off. `wrangler.toml` declares the variable nowhere: the
 * hosted Stage A workflow sets it on its own throwaway Worker only, and both
 * var blocks a production deploy uses say `ENVIRONMENT = "production"`
 * (`test/inference_stub_4594.test.ts` holds both).
 *
 * The answers are fixed and say they are synthetic. Guard calls answer
 * `safe` with zero usage; every other call answers `STUB_ANSWER` with fixed
 * token counts, so a run's charge is reproducible. Nothing leaves the Worker.
 */
import type { Env } from '../../types';

export const INFERENCE_STUB_VAR = 'AGENT_INFERENCE_STUB';
export const INFERENCE_STUB_VALUE = 'deterministic';

/** The guard model `aiRouter.ts` checks member runs with (D763). */
export const STUB_GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
/** What every non-guard call answers. Marked synthetic, so it is never mistaken for a model's words. */
export const STUB_ANSWER = '[synthetic inference stub · D4594] A deterministic answer for hosted orchestration tests. No model ran.';
/** The fixed usage every non-guard call reports, so the charge per run is reproducible. */
export const STUB_USAGE = Object.freeze({ prompt_tokens: 40, completion_tokens: 10 });

/** Whether this Worker answers model calls from the stub. No D1 read, no member setting. */
export function inferenceStubOn(env: Pick<Env, 'ENVIRONMENT' | 'STUDIOOS_ENV' | 'AGENT_INFERENCE_STUB'>): boolean {
  if (env.ENVIRONMENT !== 'preview') return false;
  const studio = String(env.STUDIOOS_ENV ?? '').trim().toLowerCase();
  if (studio === 'production' || studio === 'prod') return false;
  return env.AGENT_INFERENCE_STUB === INFERENCE_STUB_VALUE;
}

/** The stub in the shape `callWorkersAI` reads (`run(model, input, options)`). It counts its calls. */
export function stubBinding() {
  const seen = { calls: 0, guard: 0 };
  return {
    seen,
    async run(model: string, _input?: unknown, _options?: unknown): Promise<unknown> {
      seen.calls += 1;
      if (model === STUB_GUARD_MODEL) { seen.guard += 1; return { response: 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } }; }
      return { response: STUB_ANSWER, usage: { ...STUB_USAGE } };
    },
  };
}

const SHARED = stubBinding();

/** The binding a model call uses: the stub when it is on, else the Worker's own `AI`. */
export function inferenceBinding<T>(env: Env, real: T): T | ReturnType<typeof stubBinding> {
  return inferenceStubOn(env) ? SHARED : real;
}
