/**
 * D1504 (#3755, deck v2 A11) — a model Workers AI says it does not have.
 *
 * When a call answers "model not found" (404, or a 5xxx error code; 5035,
 * "your plan cannot run this", is a plan answer, not a missing model), the
 * model is marked unavailable in KV for an hour. Every run in that hour skips
 * it without a call and goes on to the next model in its chain, the same tier
 * (`aiRouter.ts`), so a whole-deck run never fails on a retired model and never
 * waits out the same failure twice. The model that answered is the one the
 * run records (`usage.model`, `fallback_used`), so a proposal names it truly.
 *
 * KV: `RATE_LIMITS` (always bound), under the `ai_unavailable:` prefix. A KV
 * that cannot be read or written marks nothing and skips nothing: the run goes
 * on as it would have. Nothing is logged but the model id and the code.
 */
import type { Env } from '../../types';

export const UNAVAILABLE_TTL_S = 3600;
const KEY = (model: string) => `ai_unavailable:${model}`;
/** "Your plan cannot run this model": the model exists. */
const PLAN_CODE = 5035;

/** Whether a failed call means the model is not there. */
export function meansUnavailable(r: { ok: boolean; status?: number; code?: number | null; error?: string }): boolean {
  if (r.ok) return false;
  if (r.code === PLAN_CODE) return false;
  if (r.status === 404) return true;
  if (typeof r.code === 'number' && r.code >= 5000 && r.code <= 5999) return true;
  return /model not found|no such model|unknown model/i.test(String(r.error ?? ''));
}

export async function isUnavailable(env: Env, model: string): Promise<boolean> {
  try { return (await env.RATE_LIMITS?.get(KEY(model))) != null; } catch { return false; }
}

export async function markUnavailable(env: Env, model: string, code: number | null | undefined): Promise<void> {
  try {
    await env.RATE_LIMITS?.put(KEY(model), JSON.stringify({ code: code ?? null, at: new Date().toISOString() }), { expirationTtl: UNAVAILABLE_TTL_S });
    console.warn('[AI_ROUTER] model marked unavailable', { model, code: code ?? null });
  } catch { /* a KV that cannot be written marks nothing */ }
}
