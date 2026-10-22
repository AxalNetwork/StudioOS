/**
 * D851 (#2474): a run on a model provider's own API (pattern C), metered on
 * the one AI token ledger. The adapter in `ai/providers/` builds the request
 * and reads the answer; this file does everything around it, the same way for
 * every provider:
 *
 *   1. OFF unless the provider's switch is exactly 'on' (`AI_PROVIDER_ANTHROPIC`):
 *      no hold, no call, no row.
 *   2. The page's AI switch (`assistOff`), as `run()` checks it.
 *   3. The platform key is a Worker secret (`AI_PROVIDER_ANTHROPIC_KEY`), never
 *      in D1 and never a member's key. Without it the run is `misconfigured`.
 *   4. HOLD a quote through `reserveAiBudget`: the input bounded at the dearest
 *      input rate and `maxTokens` of output, at the member's multiplier.
 *   5. CALL the provider. A failure releases the hold and charges nothing.
 *   6. SETTLE through `settleAiReservation`:
 *      - from the provider's REPORTED usage, at its printed rates times
 *        `chargeMultiplier` (exact decimals, rounded up once);
 *      - with no usage it can read, at the quote (the policy), and the row
 *        says so: `usage_reported: false` with the `pricing_version`. The
 *        token columns then read 0 because they cannot be NULL; `units_json`
 *        is the truth.
 *   7. One `ai_usage_logs` row, through `aiRouter`'s own `recordUsage`.
 *
 * Nothing here logs the key, the prompt or the answer.
 */
import type { Env } from '../types';
import * as aiBudget from './aiBudget';
import { assistOff, recordUsage, type RefusalReason, type TaskClass, type UsageMeta, type UsageWho } from './aiRouter';
import { PROVIDER_PRICING_VERSION, providerModelById, providerOffered, type ProviderModel, type ProviderSwitches, type ProviderUnit } from './ai/catalogue';
import { usdRatesBilledMicro } from './ai/pricing';
import { ADAPTERS, type ProviderErrorKind, type ProviderRequest } from './ai/providers';

/** The Worker secret each provider's platform key is read from. */
export const PROVIDER_KEY_SECRET = { anthropic: 'AI_PROVIDER_ANTHROPIC_KEY' } as const;
export const PROVIDER_TIMEOUT_MS = 30_000;
/** Characters per token the quote assumes: below any real tokenizer's, so the hold covers the input. */
export const QUOTE_CHARS_PER_TOKEN = 3;

export interface ProviderRunOptions extends UsageWho {
  /** A `PROVIDER_MODELS` id, e.g. `anthropic/claude-sonnet-5-5`. */
  model: string;
  /** The task class the row is recorded under. */
  task: TaskClass;
  request: ProviderRequest;
}

export type ProviderRunResult =
  | { ok: true; output: string; charged: number | null; usageReported: boolean; usageLogId: number | null }
  | { ok: false; refusal: RefusalReason; error?: ProviderErrorKind; retryAfterSec?: number | null };

export interface ProviderDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
}

const inputUnits: readonly ProviderUnit[] = ['tokens_in', 'tokens_cache_write'];

/** The hold for a run: the whole input at the dearest input rate, and every output token allowed. */
export function providerQuoteMicro(m: ProviderModel, req: ProviderRequest, multiplier: number): number {
  const chars = (req.system ?? '').length + req.messages.reduce((s, x) => s + x.content.length, 0);
  const tokensIn = Math.ceil(chars / QUOTE_CHARS_PER_TOKEN);
  return Math.max(...inputUnits.map((unit) => usdRatesBilledMicro(m.rates, { [unit]: tokensIn, tokens_out: req.maxTokens }, multiplier)));
}

const estimate = (micro: number, multiplier: number) => micro / multiplier / 1_000_000;

export async function runProviderModel(env: Env, opts: ProviderRunOptions, deps: ProviderDeps = { fetch }): Promise<ProviderRunResult> {
  const m = providerModelById(opts.model);
  if (!m || !providerOffered(m, env as unknown as ProviderSwitches)) return { ok: false, refusal: 'model_not_offered' };
  const usageOf = (latency: number, tokensIn: number, tokensOut: number, usd: number): UsageMeta => ({
    task: opts.task, model: m.id, latency_ms: latency, prompt_tokens: tokensIn, completion_tokens: tokensOut,
    est_cost_usd: usd, fallback_used: false, cached: false, safety_score: null,
  });

  if (opts.railPage && await assistOff(env, opts.userId, opts.railPage)) return { ok: false, refusal: 'assist_off' };

  const key = (env as unknown as Record<string, unknown>)[PROVIDER_KEY_SECRET[m.provider]];
  if (typeof key !== 'string' || !key) {
    await recordUsage(env, opts, usageOf(0, 0, 0, 0), 'misconfigured');
    return { ok: false, refusal: 'misconfigured' };
  }

  const multiplier = await aiBudget.memberChargeMultiplier(env, opts.userId);
  const quote = providerQuoteMicro(m, opts.request, multiplier);
  const held = await aiBudget.reserveAiBudget(env, opts.userId, quote);
  if (!held.ok) {
    await recordUsage(env, opts, usageOf(0, 0, 0, 0), held.refusal);
    return { ok: false, refusal: held.refusal };
  }
  const reservation = held.reservation;
  const base = { provider: m.provider, pricing_version: PROVIDER_PRICING_VERSION };

  const adapter = ADAPTERS[m.provider];
  const http = adapter.build(m.apiModel, opts.request, key);
  const started = Date.now();
  let outcome;
  try {
    const res = await deps.fetch(http.url, {
      method: 'POST', headers: http.headers, body: http.body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROVIDER_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    outcome = adapter.read(res.status, body, (name) => res.headers.get(name));
  } catch {
    outcome = { ok: false as const, error: 'server' as const, status: 0, retryAfterSec: null, requestId: null };
  }
  const latency = Date.now() - started;

  if (!outcome.ok) {
    // Nothing answered: release the hold, charge nothing.
    let released = true;
    try { await aiBudget.settleAiReservation(env, reservation, 0, true); } catch { released = false; }
    await recordUsage(env, opts, usageOf(latency, 0, 0, 0), released ? 'all_models_failed' : 'misconfigured',
      { charged: released ? 0 : null, reservationUid: reservation.uid, units: { ...base, error: outcome.error, status: outcome.status } });
    return { ok: false, refusal: 'all_models_failed', error: outcome.error, retryAfterSec: outcome.retryAfterSec };
  }

  const usage = outcome.usage;
  const charged = usage ? usdRatesBilledMicro(m.rates, usage, multiplier) : quote;
  let settled = true;
  try { await aiBudget.settleAiReservation(env, reservation, charged, false); } catch { settled = false; }
  const tokensIn = usage ? usage.tokens_in + usage.tokens_cache_write + usage.tokens_cached : 0;
  const id = await recordUsage(env, opts, usageOf(latency, tokensIn, usage?.tokens_out ?? 0, estimate(charged, multiplier)), null, {
    charged: settled ? charged : null,
    reservationUid: reservation.uid,
    units: usage ? { ...base, usage_reported: true, ...usage } : { ...base, usage_reported: false },
  });
  return { ok: true, output: outcome.output, charged: settled ? charged : null, usageReported: !!usage, usageLogId: id };
}
