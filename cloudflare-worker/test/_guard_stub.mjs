/**
 * D763 (#2020): every member run is checked by Llama Guard inside `run()`, and
 * the guard FAILS CLOSED, so a stubbed `env.AI` that answers the guard model
 * with anything but a verdict refuses the run as `guard_unavailable`.
 *
 * `guardSafe(run)` is a Workers AI `run` that answers the guard's own calls
 * and passes every other call to `run`, so a test about something else keeps
 * its own call list. The guard answers free by default (zero usage), so the
 * test's figures for what a run cost and charged are its model's alone; the
 * guard's own price, hold and rows are `ai_guard_d763.test.mjs`'s to test.
 */
export const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';

export function guardSafe(run, verdict = 'safe', usage = { prompt_tokens: 0, completion_tokens: 0 }) {
  return async function guarded(model, input, options) {
    if (model === GUARD_MODEL) return { response: typeof verdict === 'function' ? verdict(input) : verdict, ...(usage ? { usage } : {}) };
    return run.call(this, model, input, options);
  };
}

/** The same on a binding object, in place: its `run` is wrapped. */
export function withGuard(ai, verdict, usage) {
  ai.run = guardSafe(ai.run.bind(ai), verdict, usage);
  return ai;
}
