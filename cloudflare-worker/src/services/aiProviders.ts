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
 *   4. HOLD a quote through ONE `meteredCall` (metering.ts, D844), under the
 *      key `exec:<executionId>:<component>` with the execution id the caller
 *      supplies: the input bounded at the dearest input rate and `maxTokens`
 *      of output, at the member's multiplier. A retry with the same id holds
 *      once and calls once; a replay of a finished execution is refused with
 *      `execution_closed` and makes no call.
 *   5. CALL the provider inside the run. A failure throws inside it, so
 *      `meteredCall` releases the hold and nothing is charged; the row keeps
 *      the failure's kind.
 *   6. SETTLE: `meter.reportCost` with the provider's REPORTED usage, at its
 *      printed rates times `chargeMultiplier` (exact decimals, rounded up
 *      once); with no usage it can read, at the quote (the policy), and the
 *      row says so: `usage_reported: false` with the `pricing_version`. The
 *      token columns then read 0 because they cannot be NULL; `units_json` is
 *      the truth. A reported cost above the hold goes to a Super Admin's
 *      review, and the row's charge is NULL.
 *   D844's refusals at the hold are the result's and the row's refusal:
 *   `insufficient_tokens`, `monthly_limit`, `ai_paused`, `budget_review`,
 *   `execution_closed` (and D849's `key_limit_reached` for a key's own cap).
 *   7. One `ai_usage_logs` row, through `aiRouter`'s own `recordUsage`.
 *
 * Nothing here logs the key, the prompt or the answer.
 */
import type { Env } from '../types';
import * as aiBudget from './aiBudget';
import { MeteredRunStopped, MeteringRefused, meteredCall, type MeteredUsage } from './metering';
import { assistOff, recordUsage, type RefusalReason, type TaskClass, type UsageMeta, type UsageWho } from './aiRouter';
import { PROVIDER_PRICING_VERSION, providerModelById, providerOffered, type ProviderModel, type ProviderSwitches, type ProviderUnit } from './ai/catalogue';
import { usdRatesBilledMicro } from './ai/pricing';
import { ADAPTERS, type ProviderErrorKind, type ProviderRequest } from './ai/providers';
import type { ProviderOutcome } from './ai/providers/types';
import type { ConnectorPattern } from '../integrations/contract';

type Answered = Extract<ProviderOutcome, { ok: true }>;

/** The Worker secret each provider's platform key is read from. */
export const PROVIDER_KEY_SECRET = { anthropic: 'AI_PROVIDER_ANTHROPIC_KEY' } as const;
/** The public var each provider's switch is read from; the provider runs only when it is exactly 'on'. */
export const PROVIDER_SWITCH_VAR = { anthropic: 'AI_PROVIDER_ANTHROPIC' } as const;

/**
 * D851 · D848: each model provider as the Super Admin's Integration keys read
 * lists it (`GET /api/admin/integration-keys`, `model_providers`). Pattern C,
 * the provider's own API. It is the platform's key, never a member's
 * connection: no `ConnectorAdapter`, and not on `/api/connectors/health`.
 * Only the switch's value and whether the key is set: never the key, and no
 * call to the provider.
 */
export interface ModelProviderRow {
  provider: keyof typeof PROVIDER_KEY_SECRET;
  label: string;
  pattern: ConnectorPattern;
  member_connection: false;
  switch: { var: string; value: string | null; on: boolean };
  secret: { name: string; set: boolean };
  decision: 'D851';
}
export function modelProviderRows(env: Env): ModelProviderRow[] {
  const vars = env as unknown as Record<string, unknown>;
  return (Object.keys(PROVIDER_KEY_SECRET) as Array<keyof typeof PROVIDER_KEY_SECRET>).map((provider) => {
    const raw = vars[PROVIDER_SWITCH_VAR[provider]];
    const value = typeof raw === 'string' ? raw.slice(0, 40) : null;
    const key = vars[PROVIDER_KEY_SECRET[provider]];
    return {
      provider, label: 'Anthropic · Claude models (the platform’s key)', pattern: 'api', member_connection: false,
      switch: { var: PROVIDER_SWITCH_VAR[provider], value, on: raw === 'on' },
      secret: { name: PROVIDER_KEY_SECRET[provider], set: typeof key === 'string' && key.length > 0 },
      decision: 'D851',
    };
  });
}
export const PROVIDER_TIMEOUT_MS = 30_000;
/** Characters per token the quote assumes: below any real tokenizer's, so the hold covers the input. */
export const QUOTE_CHARS_PER_TOKEN = 3;

export interface ProviderRunOptions extends UsageWho {
  /** A `PROVIDER_MODELS` id, e.g. `anthropic/claude-sonnet-5-5`. */
  model: string;
  /** The execution this run belongs to (D844): the caller's, so a retry holds once. */
  executionId: string;
  /** The component under the execution, for the hold's key. Defaults to `model.<provider>`. */
  component?: string;
  /** The member API key the call came through, so its own cap applies (D849). */
  apiKeyUid?: string | null;
  /** The task class the row is recorded under. */
  task: TaskClass;
  request: ProviderRequest;
}

/** D844's refusals at the hold, as the result and the row carry them. */
export type MeteringRefusal = 'insufficient_tokens' | 'monthly_limit' | 'ai_paused' | 'budget_review' | 'execution_closed' | 'key_limit_reached';
export type ProviderRefusal = RefusalReason | MeteringRefusal;
const METERING_REFUSALS: readonly MeteringRefusal[] = ['insufficient_tokens', 'monthly_limit', 'ai_paused', 'budget_review', 'execution_closed', 'key_limit_reached'];

export type ProviderRunResult =
  | { ok: true; output: string; charged: number | null; usageReported: boolean; usageLogId: number | null }
  | { ok: false; refusal: ProviderRefusal; error?: ProviderErrorKind; retryAfterSec?: number | null };

/** The provider answered with a failure: thrown inside the metered run, so its hold is released. */
class ProviderFailed extends Error {
  failure: { error: ProviderErrorKind; status: number; retryAfterSec: number | null };
  latency: number;
  constructor(failure: { error: ProviderErrorKind; status: number; retryAfterSec: number | null }, latency: number) {
    super('Provider call failed');
    this.failure = failure;
    this.latency = latency;
  }
}

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
  const base = { provider: m.provider, pricing_version: PROVIDER_PRICING_VERSION };
  const adapter = ADAPTERS[m.provider];
  // `recordUsage` takes aiRouter's refusals; D844's codes are written as the same text column.
  const row = (usage: UsageMeta, refusal: ProviderRefusal | null, charge?: Parameters<typeof recordUsage>[4]) =>
    recordUsage(env, opts, usage, refusal as RefusalReason | null, charge);

  let done: { value: { output: string; usage: Answered['usage']; latency: number }; usage: MeteredUsage };
  try {
    done = await meteredCall(env, {
      userId: opts.userId, executionId: opts.executionId, component: opts.component ?? `model.${m.provider}`,
      operation: `ai.provider.${m.provider}`, quoteMicrousd: quote, apiKeyUid: opts.apiKeyUid ?? null,
      pricingVersion: PROVIDER_PRICING_VERSION, timeoutMs: deps.timeoutMs ?? PROVIDER_TIMEOUT_MS,
    }, async (meter) => {
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
      if (!outcome.ok) throw new ProviderFailed({ error: outcome.error, status: outcome.status, retryAfterSec: outcome.retryAfterSec }, latency);
      // The provider's reported usage is the cost; with none, the run settles at the quote.
      if (outcome.usage) meter.reportCost(usdRatesBilledMicro(m.rates, outcome.usage, multiplier));
      return { output: outcome.output, usage: outcome.usage, latency };
    });
  } catch (e) {
    if (e instanceof MeteringRefused) {
      const refusal: ProviderRefusal = (METERING_REFUSALS as readonly string[]).includes(e.code) ? e.code as MeteringRefusal : 'insufficient_tokens';
      await row(usageOf(0, 0, 0, 0), refusal);
      return { ok: false, refusal };
    }
    // The provider failed, or the run timed out: the hold was released, nothing charged.
    const failure = e instanceof ProviderFailed ? e.failure
      : e instanceof MeteredRunStopped ? { error: 'server' as ProviderErrorKind, status: 0, retryAfterSec: null }
        : null;
    if (!failure) {
      await row(usageOf(0, 0, 0, 0), 'misconfigured');
      return { ok: false, refusal: 'misconfigured' };
    }
    const metered = (e as { meteringUsage?: MeteredUsage }).meteringUsage;
    const released = metered ? metered.charged_microusd === 0 : false;
    await row(usageOf(e instanceof ProviderFailed ? e.latency : 0, 0, 0, 0), released ? 'all_models_failed' : 'misconfigured',
      { charged: released ? 0 : null, reservationUid: metered?.reservation_uid ?? null, units: { ...base, error: failure.error, status: failure.status } });
    return { ok: false, refusal: 'all_models_failed', error: failure.error, retryAfterSec: failure.retryAfterSec };
  }

  const { output, usage, latency } = done.value;
  const charged = done.usage.charged_microusd;
  const cost = usage ? usdRatesBilledMicro(m.rates, usage, multiplier) : quote;
  const tokensIn = usage ? usage.tokens_in + usage.tokens_cache_write + usage.tokens_cached : 0;
  const id = await row(usageOf(latency, tokensIn, usage?.tokens_out ?? 0, estimate(cost, multiplier)), null, {
    charged,
    reservationUid: done.usage.reservation_uid,
    // The row's pricing version is the one the hold settled under.
    units: { ...base, pricing_version: done.usage.pricing_version, ...(usage ? { usage_reported: true, ...usage } : { usage_reported: false }) },
  });
  return { ok: true, output, charged, usageReported: !!usage, usageLogId: id };
}
