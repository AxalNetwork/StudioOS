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
import {
  GATEWAY_TASKS, GUARD_CHARS_PER_OUTPUT_TOKEN, advisorGatewaySlug, assistOff, deckGatewaySlug, guardFinalText, guardQuoteMicro, providerGatewayOptionFor,
  recordUsage, type ProviderGatewayOption, type RefusalReason, type TaskClass, type UsageMeta, type UsageWho,
} from './aiRouter';
import {
  GATEWAY_TEXT_MODELS, GATEWAY_TEXT_PRICING_VERSION, GATEWAY_TEXT_SLUG_VAR, GATEWAY_TEXT_SWITCH, GATEWAY_TEXT_ZDR_VAR, PROVIDER_PRICING_VERSION,
  gatewayTextEligibility, gatewayTextModelById, gatewayTextOn, providerModelById, providerOffered,
  type GatewayTextModel, type ProviderModel, type ProviderSwitches, type ProviderUnit,
} from './ai/catalogue';
import { usdRatesBilledMicro } from './ai/pricing';
import { ADAPTERS, GATEWAY_ADAPTERS, type GatewayOutcome, type ProviderErrorKind, type ProviderRequest } from './ai/providers';
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

// ─────────────────────────────────── D4556: a third-party model through AI Gateway (Path A)

/**
 * D4556 (#4556): a run on a third-party catalogue model through AI Gateway, on
 * the Workers AI binding, metered on the same ledger, hold and row as D851's
 * direct providers. Cloudflare holds the provider's credential (Unified
 * Billing), so there is no key; the gateway's id is config. In this order, each
 * refusing before the next costs anything, and every refusal before step 8
 * makes NO call to the binding:
 *
 *   1. the row exists and its switch is exactly 'on' (`AI_PROVIDER_GATEWAY_OPENAI`);
 *   2. never the Advisor (`advisorReach`): an Advisor task, surface or page is
 *      refused, so the production Advisor stays on Workers AI (SECURITY.md);
 *   3. the workload policy (`gatewayTextEligibility`): ZDR confirmed, the task,
 *      the caller's data class;
 *   4. the input fits the model's window, with the whole output allowance;
 *   5. the required config (`gatewayConfig`): a gateway id of its own, the
 *      owner's ZDR statement, the binding. Missing config is `misconfigured`,
 *      with one row naming what is missing (names only, never a value);
 *   6. the page's AI switch (`assistOff`), as `run()` checks it;
 *   7. the admission seam (`deps.admit`): shared upstream capacity, when the
 *      caller has one (#4594). A refusal or an unreadable check calls nothing;
 *   8. the hold, through ONE `meteredCall` keyed `exec:<executionId>:<component>`:
 *      the provider's quote plus the guard's share (D763);
 *   9. inside it: the input guard; the call, retried only on a rate limit or an
 *      overload, at most `GATEWAY_MAX_ATTEMPTS` times, waiting the
 *      `retry-after` the gateway sent (or a backoff) plus jitter, within an
 *      end-to-end `GATEWAY_RETRY_BUDGET_MS`; the answer pinned to the row's model
 *      and to Cloudflare's own credential; the output guard;
 *  10. one `ai_usage_logs` row, the guard rows naming it.
 *
 * FALLBACK. None. A failure is the caller's to handle, and never becomes a run
 * on another provider, whose data terms differ (D4556 §3).
 *
 * WHAT IT CHARGES. The provider's reported usage at its printed rates times the
 * member's multiplier, plus every guard call that completed. A failure, a
 * refusal by the model or an answer that is not the pinned model charges only
 * the guard. With no reported usage the provider's part settles at its quote
 * (D851's policy) and the row says `usage_reported: false`, with the gateway's
 * log id to reconcile from. A timeout or an unknown completion releases the
 * member's hold (nothing charged) and the row says `completion: 'unknown'`: the
 * provider may still have done the work, and the gateway's log says.
 *
 * LOGGING. Every call sends `collectLog: false` and
 * `cf-aig-collect-log-payload: false`: no prompt or answer in the gateway's
 * logs. Unified Billing's billing details are logged whatever the setting
 * (Cloudflare's logging page). Nothing here logs the prompt or the answer.
 */
export const GATEWAY_ATTEMPT_TIMEOUT_MS = 30_000;
export const GATEWAY_MAX_ATTEMPTS = 3;
/** The most the run waits between attempts, in all. A longer `retry-after` ends the run with it. */
export const GATEWAY_RETRY_BUDGET_MS = 4_000;
export const GATEWAY_RETRY_BASE_MS = 500;
export const GATEWAY_JITTER_MS = 250;
const GATEWAY_RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['rate_limited', 'overloaded']);
export const GATEWAY_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const GATEWAY_LOG_PAYLOAD_HEADER = 'cf-aig-collect-log-payload';

/** The tasks, surfaces and pages of the Advisor, which this path never serves. */
export const ADVISOR_TASKS: readonly string[] = Object.freeze([...GATEWAY_TASKS, 'onboarding_chat']);
const ADVISOR_WORD = /(^|[^a-z])advisor([^a-z]|$)/i;
export function advisorReach(opts: { task: string; surface?: string | null; railPage?: string | null; railOption?: string | null }): boolean {
  if (ADVISOR_TASKS.includes(opts.task)) return true;
  return [opts.surface, opts.railPage, opts.railOption].some((v) => typeof v === 'string' && ADVISOR_WORD.test(v));
}

type AiLike = { run(model: string, input: unknown, options?: unknown): Promise<unknown> };

export type GatewayConfig = { ok: true; slug: string; ai: AiLike } | { ok: false; missing: string[] };
/**
 * The config a gateway run needs. Its own gateway: never the Advisor's or the
 * deck's, whose logging and limits are theirs. The owner's ZDR statement,
 * exactly 'on'. The binding.
 */
export function gatewayConfig(env: Env): GatewayConfig {
  const vars = env as unknown as Record<string, unknown>;
  const missing: string[] = [];
  const raw = vars[GATEWAY_TEXT_SLUG_VAR];
  const slug = typeof raw === 'string' ? raw.trim() : '';
  if (!GATEWAY_SLUG_RE.test(slug)) missing.push(GATEWAY_TEXT_SLUG_VAR);
  else if (slug === advisorGatewaySlug(env) || slug === deckGatewaySlug(env)) missing.push(`${GATEWAY_TEXT_SLUG_VAR}:own_gateway`);
  if (vars[GATEWAY_TEXT_ZDR_VAR] !== 'on') missing.push(GATEWAY_TEXT_ZDR_VAR);
  const binding = vars.AI as AiLike | undefined;
  if (!binding || typeof binding.run !== 'function') missing.push('AI');
  return missing.length ? { ok: false, missing } : { ok: true, slug, ai: binding! };
}

/** The wait before attempt `attempt + 1`: the gateway's `retry-after`, else a doubling backoff, plus jitter. */
export function gatewayRetryDelayMs(attempt: number, retryAfterSec: number | null, random: () => number = Math.random): number {
  const base = retryAfterSec != null ? retryAfterSec * 1000 : GATEWAY_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.ceil(base + Math.min(1, Math.max(0, random())) * GATEWAY_JITTER_MS);
}

/** Shared upstream capacity (#4594 owns the authority). Absent, no capacity check runs; it is never a substitute for the hold. */
export type GatewayAdmission = (req: { userId: number; model: string; task: string; executionId: string }) =>
  Promise<{ ok: true; release: () => void | Promise<void> } | { ok: false; retryAfterSec: number | null }>;

export interface GatewayDeps {
  attemptTimeoutMs?: number;
  /** The whole run's limit, inside the hold. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  admit?: GatewayAdmission;
}

export interface GatewayRunOptions extends UsageWho {
  /** A `GATEWAY_TEXT_MODELS` id, e.g. `openai/gpt-5-mini`. */
  model: string;
  executionId: string;
  component?: string;
  apiKeyUid?: string | null;
  task: TaskClass;
  /** The caller's classification of the text it sends (`GATEWAY_DATA_CLASSES`). Anything unapproved is refused. */
  dataClass: string;
  request: ProviderRequest;
  /** The member's own words, which the guard checks; default every message but the system prompt. */
  guardText?: string;
}

export type GatewayRefusal = ProviderRefusal
  | 'surface_not_eligible' | 'zdr_not_confirmed' | 'task_not_eligible' | 'data_class_not_approved' | 'invalid_input'
  | 'capacity_unavailable' | 'provider_refused' | 'terms_mismatch' | 'guard_blocked' | 'guard_blocked_output' | 'guard_unavailable';

export type GatewayRunResult =
  | { ok: true; output: string; charged: number | null; usageReported: boolean; usageLogId: number | null; servedModel: string; gatewayLogId: string | null; attempts: number }
  | { ok: false; refusal: GatewayRefusal; error?: ProviderErrorKind; retryAfterSec?: number | null; completion?: 'none' | 'unknown'; missing?: string[]; attempts?: number };

type Attempt = { status: number; error: ProviderErrorKind | null; code: number | null; waited_ms: number };
type CallEnd =
  | { ok: true; outcome: Extract<GatewayOutcome, { ok: true }>; attempts: Attempt[] }
  | { ok: false; error: ProviderErrorKind; status: number; retryAfterSec: number | null; completion: 'none' | 'unknown'; logId: string | null; usage: Record<string, number> | null; attempts: Attempt[] };

/** A binding error's AI Gateway code (`AiGatewayError: 2018: …`), read as a status would be. */
function thrownFailure(e: unknown): { error: ProviderErrorKind; completion: 'none' | 'unknown'; code: number | null } {
  const m = /^\s*(?:\w*Error:\s*)?(\d{4}):/.exec(String((e as Error)?.message ?? ''));
  const code = m ? Number(m[1]) : null;
  if (code === 2018) return { error: 'rate_limited', completion: 'none', code };
  if (code === 7005) return { error: 'overloaded', completion: 'none', code };
  if (code === 2009) return { error: 'auth', completion: 'none', code };
  if (code === 2049 || code === 2052 || code === 2021) return { error: 'billing', completion: 'none', code };
  return { error: 'unknown', completion: 'unknown', code };
}

const TIMED_OUT = Symbol('timed_out');

/** One run's calls: bounded, retried only where the gateway said the provider did not run. */
async function callGateway(ai: AiLike, m: GatewayTextModel, input: Record<string, unknown>, option: ProviderGatewayOption, deps: GatewayDeps): Promise<CallEnd> {
  const adapter = GATEWAY_ADAPTERS[m.format];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const limit = deps.attemptTimeoutMs ?? GATEWAY_ATTEMPT_TIMEOUT_MS;
  const attempts: Attempt[] = [];
  let waited = 0;
  for (let n = 1; ; n++) {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let out: GatewayOutcome;
    try {
      const raw = await Promise.race([
        ai.run(m.id, input, { ...option, extraHeaders: { [GATEWAY_LOG_PAYLOAD_HEADER]: 'false' }, returnRawResponse: true, signal: ctl.signal }),
        new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(TIMED_OUT); }, limit); }),
      ]);
      if (raw === TIMED_OUT) {
        out = { ok: false, error: 'timeout', status: 0, code: null, retryAfterSec: null, completion: 'unknown', logId: null, usage: null };
      } else {
        const res = raw as { status?: unknown; headers?: { get?: (n: string) => string | null }; json?: () => Promise<unknown> } | null;
        const status = Number(res?.status);
        if (!res || !Number.isInteger(status)) {
          out = { ok: false, error: 'server', status: 0, code: null, retryAfterSec: null, completion: 'unknown', logId: null, usage: null };
        } else {
          const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
          out = adapter.read(status, body, (name) => (typeof res.headers?.get === 'function' ? res.headers.get(name) : null));
        }
      }
    } catch (e) {
      const f = thrownFailure(e);
      out = { ok: false, ...f, status: 0, retryAfterSec: null, logId: null, usage: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
    attempts.push({ status: out.ok ? 200 : out.status, error: out.ok ? null : out.error, code: out.ok ? null : out.code, waited_ms: 0 });
    if (out.ok) return { ok: true, outcome: out, attempts };
    const fail = { ok: false as const, error: out.error, status: out.status, retryAfterSec: out.retryAfterSec, completion: out.completion, logId: out.logId, usage: out.usage, attempts };
    // Only a refusal the gateway made before the provider ran is retried; anything that may have done work never is.
    if (!GATEWAY_RETRYABLE.has(out.error) || out.completion !== 'none' || n >= GATEWAY_MAX_ATTEMPTS) return fail;
    const wait = gatewayRetryDelayMs(n, out.retryAfterSec, random);
    if (waited + wait > GATEWAY_RETRY_BUDGET_MS) return fail;
    await sleep(wait);
    waited += wait;
    attempts[attempts.length - 1].waited_ms = wait;
  }
}

/** A row's units: what is known, and nothing that is not (no nulls, no zeros for the unknown). */
function known(u: Record<string, number | string | boolean | null | undefined>): Record<string, number | string | boolean> {
  return Object.fromEntries(Object.entries(u).filter(([, v]) => v != null)) as Record<string, number | string | boolean>;
}

/** The input bound the quote holds for: the whole input at the input rate, every output token allowed. */
export function gatewayQuoteMicro(m: GatewayTextModel, req: ProviderRequest, multiplier: number): number {
  return usdRatesBilledMicro(m.rates, { tokens_in: gatewayInputTokens(req), tokens_out: req.maxTokens }, multiplier);
}
const gatewayInputTokens = (req: ProviderRequest) =>
  Math.ceil(((req.system ?? '').length + req.messages.reduce((s, x) => s + x.content.length, 0)) / QUOTE_CHARS_PER_TOKEN);

type Settled =
  | { kind: 'answered'; output: string; usage: Record<string, number> | null; outcome: Extract<GatewayOutcome, { ok: true }>; attempts: Attempt[]; providerMicro: number }
  | { kind: 'failed'; end: Extract<CallEnd, { ok: false }> }
  | { kind: 'mismatch'; outcome: Extract<GatewayOutcome, { ok: true }>; attempts: Attempt[] }
  | { kind: 'guard'; side: 'input' | 'output'; action: 'block' | 'fail'; outcome?: Extract<GatewayOutcome, { ok: true }>; attempts?: Attempt[]; providerMicro?: number };

export async function runGatewayTextModel(env: Env, opts: GatewayRunOptions, deps: GatewayDeps = {}): Promise<GatewayRunResult> {
  const m = gatewayTextModelById(opts.model);
  if (!m || !gatewayTextOn(env as never)) return { ok: false, refusal: 'model_not_offered' };
  if (advisorReach(opts)) return { ok: false, refusal: 'surface_not_eligible' };
  const policy = gatewayTextEligibility(m, opts.task, opts.dataClass);
  if (policy) return { ok: false, refusal: policy };
  if (!Number.isSafeInteger(opts.request.maxTokens) || opts.request.maxTokens < 1 || !opts.request.messages.length
    || gatewayInputTokens(opts.request) + opts.request.maxTokens > m.contextTokens) return { ok: false, refusal: 'invalid_input' };

  const usageOf = (latency: number, tokensIn: number, tokensOut: number, usd: number): UsageMeta => ({
    task: opts.task, model: m.id, latency_ms: latency, prompt_tokens: tokensIn, completion_tokens: tokensOut,
    est_cost_usd: usd, fallback_used: false, cached: false, safety_score: null,
  });
  const base = { provider: m.provider, via: 'ai_gateway', billing: 'unified', pricing_version: GATEWAY_TEXT_PRICING_VERSION, data_class: String(opts.dataClass) };
  const row = (usage: UsageMeta, refusal: GatewayRefusal | null, charge?: Parameters<typeof recordUsage>[4]) =>
    recordUsage(env, opts, usage, refusal as RefusalReason | null, charge);

  // The guard and the model are called on the same binding, `env.AI`.
  const cfg = gatewayConfig(env);
  if (!cfg.ok) {
    await row(usageOf(0, 0, 0, 0), 'misconfigured', { charged: 0, units: { ...base, missing: cfg.missing.join(',') } });
    return { ok: false, refusal: 'misconfigured', missing: cfg.missing };
  }
  if (opts.railPage) {
    let off: boolean;
    try { off = await assistOff(env, opts.userId, opts.railPage); } catch { return { ok: false, refusal: 'misconfigured' }; }
    if (off) return { ok: false, refusal: 'assist_off' };
  }

  let admitted: { release: () => void | Promise<void> } | null = null;
  if (deps.admit) {
    try {
      const a = await deps.admit({ userId: opts.userId, model: m.id, task: opts.task, executionId: opts.executionId });
      if (!a.ok) return { ok: false, refusal: 'capacity_unavailable', retryAfterSec: a.retryAfterSec };
      admitted = a;
    } catch {
      // An admission check that cannot answer is no admission.
      return { ok: false, refusal: 'capacity_unavailable', retryAfterSec: null };
    }
  }

  try {
    const multiplier = await aiBudget.memberChargeMultiplier(env, opts.userId);
    const guardInput = opts.guardText ?? opts.request.messages.map((x) => x.content).join('\n\n');
    const providerQuote = gatewayQuoteMicro(m, opts.request, multiplier);
    const quote = providerQuote + guardQuoteMicro(guardInput, opts.request.maxTokens * GUARD_CHARS_PER_OUTPUT_TOKEN, multiplier);
    const who = { userId: opts.userId, surface: opts.surface ?? null };
    // Built by the router, as every gateway option is (D261): logging and the gateway's own retries off, ids only in its metadata.
    const option = providerGatewayOptionFor(cfg.slug, env, opts, deps.attemptTimeoutMs ?? GATEWAY_ATTEMPT_TIMEOUT_MS);
    const guards: Array<Awaited<ReturnType<typeof guardFinalText>>> = [];
    const guardMicro = () => guards.reduce((n, g) => n + g.micro, 0);
    const started = Date.now();

    let done: { value: Settled; usage: MeteredUsage };
    try {
      done = await meteredCall(env, {
        userId: opts.userId, executionId: opts.executionId, component: opts.component ?? `model.gateway.${m.provider}`,
        operation: `ai.provider.gateway.${m.provider}`, quoteMicrousd: quote, apiKeyUid: opts.apiKeyUid ?? null,
        pricingVersion: GATEWAY_TEXT_PRICING_VERSION,
        timeoutMs: deps.timeoutMs ?? GATEWAY_MAX_ATTEMPTS * GATEWAY_ATTEMPT_TIMEOUT_MS + GATEWAY_RETRY_BUDGET_MS + 30_000,
      }, async (meter): Promise<Settled> => {
        const gIn = await guardFinalText(env, who, guardInput, multiplier, 'input');
        guards.push(gIn);
        if (gIn.decision.action === 'block' || gIn.decision.action === 'fail') {
          meter.reportCost(guardMicro());
          return { kind: 'guard', side: 'input', action: gIn.decision.action };
        }
        const end = await callGateway(cfg.ai, m, GATEWAY_ADAPTERS[m.format].input(opts.request), option, deps);
        if (!end.ok) { meter.reportCost(guardMicro()); return { kind: 'failed', end }; }
        const o = end.outcome;
        // Pinned: the row's own model, on Cloudflare's own credential (ZDR applies to Unified Billing only).
        if (!o.servedModel || !o.servedModel.startsWith(m.servedModelPrefix) || o.keySource !== 'Unified') {
          meter.reportCost(guardMicro());
          return { kind: 'mismatch', outcome: o, attempts: end.attempts };
        }
        const providerMicro = o.usage ? usdRatesBilledMicro(m.rates, o.usage, multiplier) : providerQuote;
        const gOut = await guardFinalText(env, who, o.output, multiplier, 'output');
        guards.push(gOut);
        meter.reportCost(providerMicro + guardMicro());
        if (gOut.decision.action === 'block' || gOut.decision.action === 'fail') {
          return { kind: 'guard', side: 'output', action: gOut.decision.action, outcome: o, attempts: end.attempts, providerMicro };
        }
        return { kind: 'answered', output: o.output, usage: o.usage, outcome: o, attempts: end.attempts, providerMicro };
      });
    } catch (e) {
      if (e instanceof MeteringRefused) {
        const refusal: ProviderRefusal = (METERING_REFUSALS as readonly string[]).includes(e.code) ? e.code as MeteringRefusal : 'insufficient_tokens';
        await row(usageOf(0, 0, 0, 0), refusal);
        return { ok: false, refusal };
      }
      // The run's own limit: the call may still be running upstream. Released, never charged, reconciled from the gateway's log.
      const metered = (e as { meteringUsage?: MeteredUsage }).meteringUsage;
      const id = await row(usageOf(Date.now() - started, 0, 0, 0), 'all_models_failed', {
        charged: metered ? metered.charged_microusd : null, reservationUid: metered?.reservation_uid ?? null,
        units: { ...base, error: e instanceof MeteredRunStopped ? 'timeout' : 'unknown', completion: 'unknown', reconcile: 'gateway_log' },
      });
      for (const g of guards) await g.record(id, metered?.reservation_uid ?? null);
      return { ok: false, refusal: 'all_models_failed', error: e instanceof MeteredRunStopped ? 'timeout' : 'unknown', completion: 'unknown' };
    }

    const v = done.value;
    const latency = Date.now() - started;
    const charge = (units: Record<string, number | string | boolean | null | undefined>) => ({
      charged: done.usage.charged_microusd, reservationUid: done.usage.reservation_uid,
      units: known({ ...base, pricing_version: done.usage.pricing_version, ...units }),
    });
    const usageUnits = (u: Record<string, number> | null) => (u ? { usage_reported: true, ...u } : { usage_reported: false, reconcile: 'gateway_log' });
    const tokens = (u: Record<string, number> | null): [number, number] => (u ? [u.tokens_in + u.tokens_cached, u.tokens_out] : [0, 0]);
    const finish = async (refusal: GatewayRefusal | null, usage: UsageMeta, units: Record<string, number | string | boolean | null | undefined>) => {
      const id = await row(usage, refusal, charge(units));
      for (const g of guards) await g.record(id, done.usage.reservation_uid);
      return id;
    };

    if (v.kind === 'guard' && v.side === 'input') {
      await finish(v.action === 'block' ? 'guard_blocked' : 'guard_unavailable', usageOf(latency, 0, 0, 0), { guard: 'input' });
      return { ok: false, refusal: v.action === 'block' ? 'guard_blocked' : 'guard_unavailable' };
    }
    if (v.kind === 'failed') {
      const f = v.end;
      await finish('all_models_failed', usageOf(latency, 0, 0, 0), {
        error: f.error, status: f.status, attempts: f.attempts.length, completion: f.completion, gateway_log_id: f.logId,
        ...(f.completion === 'unknown' ? { reconcile: 'gateway_log' } : {}),
        ...(f.usage ? { reported_tokens_in: f.usage.tokens_in, reported_tokens_cached: f.usage.tokens_cached, reported_tokens_out: f.usage.tokens_out } : {}),
      });
      return {
        ok: false, refusal: f.error === 'refused' ? 'provider_refused' : 'all_models_failed', error: f.error,
        retryAfterSec: f.retryAfterSec, completion: f.completion, attempts: f.attempts.length,
      };
    }
    const o = v.outcome!;
    const answerUnits = {
      ...usageUnits(o.usage), reasoning_tokens: o.reasoningTokens, served_model: o.servedModel, key_source: o.keySource,
      finish_reason: o.finishReason, gateway_log_id: o.logId, attempts: v.attempts?.length,
    };
    const [tIn, tOut] = tokens(o.usage);
    if (v.kind === 'mismatch') {
      await finish('terms_mismatch', usageOf(latency, tIn, tOut, 0), { ...answerUnits, reconcile: 'gateway_log' });
      return { ok: false, refusal: 'terms_mismatch', attempts: v.attempts.length };
    }
    const est = v.providerMicro! / multiplier / 1_000_000;
    if (v.kind === 'guard') {
      const refusal = v.action === 'block' ? 'guard_blocked_output' : 'guard_unavailable';
      await finish(refusal, usageOf(latency, tIn, tOut, est), { ...answerUnits, guard: 'output' });
      return { ok: false, refusal };
    }
    const id = await finish(null, usageOf(latency, tIn, tOut, est), answerUnits);
    return {
      ok: true, output: v.output, charged: done.usage.charged_microusd, usageReported: !!v.usage, usageLogId: id,
      servedModel: o.servedModel!, gatewayLogId: o.logId, attempts: v.attempts.length,
    };
  } finally {
    if (admitted) {
      try { await admitted.release(); } catch { /* the admission seam's lease expires on its own */ }
    }
  }
}

/**
 * D4556: each gateway model as the Super Admin's Integration keys read lists it
 * (`GET /api/admin/integration-keys`, `gateway_providers`): the switch's value,
 * which required config is set (names only, never a value), its ZDR status and
 * the workloads it may run. No call to the gateway.
 */
export function gatewayProviderRows(env: Env) {
  const vars = env as unknown as Record<string, unknown>;
  const raw = vars[GATEWAY_TEXT_SWITCH];
  const cfg = gatewayConfig(env);
  const state = !gatewayTextOn(env as never) ? 'off' : cfg.ok ? 'enabled' : 'missing_config';
  return GATEWAY_TEXT_MODELS.map((m) => ({
    model: m.id, provider: m.provider, via: 'ai_gateway' as const, billing: 'unified' as const, state,
    switch: { var: GATEWAY_TEXT_SWITCH, value: typeof raw === 'string' ? raw.slice(0, 40) : null, on: raw === 'on' },
    config: { missing: cfg.ok ? [] : cfg.missing },
    zdr: m.zdr, workloads: m.workloads.map((w) => ({ task: w.task, data_classes: [...w.dataClasses] })),
    capabilities: { ...m.capabilities }, rates: { ...m.rates }, source: m.source, read: m.read, decision: 'D4556' as const,
  }));
}
