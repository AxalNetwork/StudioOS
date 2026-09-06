/**
 * Task #4 (CG) — Personal Advisor AI client.
 *
 * Thin wrapper around the Workers AI binding (`env.AI`) that:
 *   1. Routes every call through the dedicated AI Gateway slug
 *      (`CF_AI_GATEWAY_SLUG_ADVISOR`, default `advisor-ongoing`) so
 *      advisor analytics are tracked separately from the onboarding
 *      chatbot. Cloudflare Workers AI does NOT support multiple
 *      [ai] blocks per worker — there's a single `AI` binding shared
 *      across all features. The gateway slug is therefore the only
 *      way to keep advisor spend / latency / cache visibility
 *      isolated.
 *   2. Single-tier model fallback: primary
 *      `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, fallback
 *      `@cf/meta/llama-3.1-8b-instruct` only on HTTP 500/429 from
 *      the primary. Per spec ("Sole fallback ... only on HTTP
 *      500/429"), no Anthropic, no GitHub Models, no further hops.
 *   3. Per-user daily turn cap (KV bucket
 *      `ai_spend:advisor_turns:{user_id}:{yyyy-mm-dd}`). Soft-warns at
 *      80%, hard-blocks at 100%. Default 100 turns/day, configurable
 *      via env `WORKERS_AI_ADVISOR_BUDGET_PER_DAY`.
 *
 * NOT used by /api/advisor/explain — that surface still routes
 * through `services/aiRouter.ts` (task=`advisor_explain`) which has
 * been taught to use the same gateway slug for traffic separation
 * while keeping its $-budget, leak-strip, and Anthropic-fallback
 * machinery. This client is what CB (the new state machine) will
 * call for `/api/advisor/turn` chat completions.
 *
 * Public API:
 *   runAdvisorTurn(env, opts) → Promise<AdvisorRunResult>
 *   checkAdvisorTurnBudget(env, userId) → Promise<TurnBudgetStatus>
 *   bumpAdvisorTurn(env, userId)        → Promise<void>
 *
 * Why a separate budget module from aiRouter:
 *   aiRouter tracks $-spend (USD per user / month / org). The CG
 *   spec mandates a TURN-COUNT cap on the advisor specifically
 *   (100 turns/day) so a user can't burn the dashboard with a
 *   tight retry loop even when their dollar spend is tiny.
 */
import type { Env } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// The fallback was `@cf/meta/llama-3.1-8b-instruct`, which Cloudflare marks
// DEPRECATED with the date 5/30/2026 — already past. It is the model this
// client reaches for exactly when the primary is failing, so it was the least
// visible place in the worker for a model to stop answering. `-fp8` is the same
// family and size, cheaper on both sides, and has a 32,000-token context
// against the deprecated model's 7,968 — which matters here, because a long
// advisor turn is precisely what makes the primary 500 in the first place.
export type AdvisorModel =
  | '@cf/meta/llama-3.3-70b-instruct-fp8-fast'  // PRIMARY
  | '@cf/meta/llama-3.1-8b-instruct-fp8';       // 500/429 fallback only

export const ADVISOR_PRIMARY_MODEL: AdvisorModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const ADVISOR_FALLBACK_MODEL: AdvisorModel = '@cf/meta/llama-3.1-8b-instruct-fp8';

export interface AdvisorTurnOptions {
  userId: number;
  systemPrompt?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;     // default 0.2
  maxTokens?: number;       // default 800
  stream?: boolean;         // streaming first token under 500ms in prod
  // Optional cache directives for the gateway. Advisor turns are
  // user-specific so caching is normally OFF; explainers (handled by
  // aiRouter, not this client) cache at 5m via the gateway dashboard.
  skipCache?: boolean;
  cacheTtlSec?: number;
}

export interface TurnBudgetStatus {
  used: number;             // turns counted today
  limit: number;            // hard cap
  remaining: number;        // limit - used (>= 0)
  blocked: boolean;         // used >= limit
  warn: boolean;            // used >= 0.8 * limit (and not blocked)
  reset_at: string;         // ISO timestamp of next UTC midnight
}

export interface AdvisorRunResult {
  ok: boolean;
  model: AdvisorModel | null;
  output?: string;
  stream?: ReadableStream;
  fallback_used: boolean;
  // Echoed budget status AFTER bumping (or on refusal, the status that
  // caused the refusal). Lets the caller surface "X of Y turns used".
  budget: TurnBudgetStatus;
  // Friendly message intended for the chat UI when blocked / warning.
  // null when there's nothing to surface to the user.
  hint?: string | null;
  refusal?: 'budget_advisor_turns_day' | 'all_models_failed' | 'misconfigured';
  error?: string;
  // Latency of the upstream call in ms (0 on refusal pre-call).
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const DEFAULT_TURNS_PER_DAY = 100;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 800;

function turnLimit(env: Env): number {
  // Spec env name is `WORKERS_AI_ADVISOR_BUDGET_USD_DAY`. The "USD"
  // segment is a misnomer in the spec — the value is a TURN count,
  // not a dollar amount — but we honour the contract exactly.
  // `WORKERS_AI_ADVISOR_BUDGET_PER_DAY` is accepted as a backward-compat
  // alias so existing wrangler.toml entries don't have to be renamed
  // mid-deploy.
  const e = env as unknown as Record<string, string | undefined>;
  const raw = e.WORKERS_AI_ADVISOR_BUDGET_USD_DAY ?? e.WORKERS_AI_ADVISOR_BUDGET_PER_DAY;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TURNS_PER_DAY;
}

function gatewaySlug(env: Env): string | null {
  const v = (env as unknown as Record<string, string | undefined>).CF_AI_GATEWAY_SLUG_ADVISOR;
  return v && v.trim() ? v.trim() : null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nextUtcMidnightIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

interface MinimalKV {
  get(key: string, type?: 'text' | 'json'): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(env: Env): MinimalKV | null {
  // Prefer the dedicated AI_SPEND namespace if provisioned (matches the
  // commented-out [[kv_namespaces]] block in wrangler.toml). Falls back
  // to TOKENS so this module is deployable without a new namespace.
  const e = env as unknown as { AI_SPEND?: MinimalKV; TOKENS?: MinimalKV };
  return e.AI_SPEND || e.TOKENS || null;
}

function bucketKeyFor(userId: number, dayUtc: string): string {
  // Spec key: `ai_spend:advisor:{user_id}:{yyyy-mm-dd}`.
  return `ai_spend:advisor:${userId}:${dayUtc}`;
}

// ---------------------------------------------------------------------------
// Public: budget helpers
//
// All read/write operations accept an explicit `dayUtc` so a single
// /turn request that pre-checks the budget then bumps after a slow
// upstream call can't have the bucket key shift across UTC midnight
// between the two ops (which would otherwise read yesterday's count
// and write it into today's key, effectively carrying over usage and
// potentially hard-blocking early). The default argument resolves
// `today` at call time for callers that don't care about pinning.
// ---------------------------------------------------------------------------
export async function checkAdvisorTurnBudget(
  env: Env,
  userId: number,
  dayUtc: string = todayUtc(),
): Promise<TurnBudgetStatus> {
  const limit = turnLimit(env);
  const reset_at = nextUtcMidnightIso();
  const store = kv(env);
  let used = 0;
  if (store) {
    try {
      const raw = await store.get(bucketKeyFor(userId, dayUtc));
      const n = raw ? Number(raw) : 0;
      if (Number.isFinite(n) && n > 0) used = Math.floor(n);
    } catch { /* KV miss / outage → treat as zero */ }
  }
  const remaining = Math.max(0, limit - used);
  const blocked = used >= limit;
  const warn = !blocked && used >= Math.floor(limit * 0.8);
  return { used, limit, remaining, blocked, warn, reset_at };
}

export async function bumpAdvisorTurn(
  env: Env,
  userId: number,
  by = 1,
  dayUtc: string = todayUtc(),
): Promise<TurnBudgetStatus> {
  const status = await checkAdvisorTurnBudget(env, userId, dayUtc);
  const store = kv(env);
  if (!store) return status;
  const next = status.used + Math.max(0, Math.floor(by));
  // 2-day TTL gives a 24h overlap so a turn taken just before UTC
  // midnight can't roll over into a fresh day silently if the next
  // request lands a millisecond before the bucket key recomputes.
  try { await store.put(bucketKeyFor(userId, dayUtc), String(next), { expirationTtl: 2 * 86400 }); } catch { /* best-effort */ }
  const remaining = Math.max(0, status.limit - next);
  const blocked = next >= status.limit;
  const warn = !blocked && next >= Math.floor(status.limit * 0.8);
  return { used: next, limit: status.limit, remaining, blocked, warn, reset_at: status.reset_at };
}

// ---------------------------------------------------------------------------
// Workers AI binding shape (lightweight — matches Cloudflare's ts shim).
// The third `options` arg is what carries the gateway slug.
// ---------------------------------------------------------------------------
interface WorkersAIBinding {
  run(
    model: string,
    payload: unknown,
    options?: {
      gateway?: { id: string; skipCache?: boolean; cacheTtl?: number };
    },
  ): Promise<unknown>;
}

/**
 * Build the gateway option object passed to env.AI.run. Returns
 * undefined when no slug is configured so the call falls through to
 * the un-gatewayed Workers AI path (no breakage on misconfig).
 */
export function advisorGatewayOption(
  env: Env,
  cache?: { skipCache?: boolean; cacheTtlSec?: number },
): { gateway: { id: string; skipCache?: boolean; cacheTtl?: number } } | undefined {
  const id = gatewaySlug(env);
  if (!id) return undefined;
  const gateway: { id: string; skipCache?: boolean; cacheTtl?: number } = { id };
  if (cache?.skipCache != null) gateway.skipCache = cache.skipCache;
  if (cache?.cacheTtlSec != null && cache.cacheTtlSec > 0) gateway.cacheTtl = cache.cacheTtlSec;
  return { gateway };
}

interface CallResult {
  ok: boolean;
  status: number;
  output?: string;
  stream?: ReadableStream;
  error?: string;
}

async function callOnce(
  ai: WorkersAIBinding,
  model: AdvisorModel,
  opts: AdvisorTurnOptions,
  gatewayOpt: { gateway: { id: string; skipCache?: boolean; cacheTtl?: number } } | undefined,
): Promise<CallResult> {
  const messages = opts.systemPrompt && !opts.messages.some((m) => m.role === 'system')
    ? [{ role: 'system' as const, content: opts.systemPrompt }, ...opts.messages]
    : opts.messages;
  const payload: Record<string, unknown> = {
    messages,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
  };
  if (opts.stream) payload.stream = true;
  try {
    const raw = await ai.run(model, payload, gatewayOpt);
    if (opts.stream && raw && typeof (raw as ReadableStream).getReader === 'function') {
      return { ok: true, status: 200, stream: raw as ReadableStream };
    }
    const r = raw as {
      response?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = r.response ?? r.choices?.[0]?.message?.content ?? '';
    return { ok: true, status: 200, output: String(text || '') };
  } catch (e) {
    // Spec: "Sole fallback ... only on HTTP 500/429 from primary."
    // We therefore extract status STRICTLY — structured fields first,
    // then an explicit "<status> <Status-Text>" pattern in the error
    // message. Anything that can't be classified as a real HTTP 5xx
    // or 429 stays at 0 (unknown) so the caller does NOT trigger
    // fallback. This keeps non-HTTP failures (timeout configured by
    // us, payload validation, binding misconfig) from silently
    // double-dipping into the 8b sibling.
    const msg = (e as Error).message || '';
    const errObj = e as { status?: number; statusCode?: number; cause?: { status?: number } };
    let status = 0;
    if (typeof errObj?.status === 'number') status = errObj.status;
    else if (typeof errObj?.statusCode === 'number') status = errObj.statusCode;
    else if (typeof errObj?.cause?.status === 'number') status = errObj.cause.status;
    if (!status) {
      // Match Cloudflare's typical AiError serialization: "AiError:
      // 5022: Capacity temporarily exceeded" or "HTTP 429 Too Many
      // Requests". We require the digit to appear with a clear
      // boundary so a user-supplied prompt containing "500" can't
      // forge a fallback.
      const m = msg.match(/\b(?:HTTP\s+)?(\d{3})\b/);
      if (m) {
        const n = Number(m[1]);
        if (n === 429 || (n >= 500 && n <= 599)) status = n;
      }
    }
    return { ok: false, status, error: msg.slice(0, 240) };
  }
}

// ---------------------------------------------------------------------------
// Public: runAdvisorTurn — the entry point CB will use for /api/advisor/turn
// ---------------------------------------------------------------------------
export async function runAdvisorTurn(env: Env, opts: AdvisorTurnOptions): Promise<AdvisorRunResult> {
  const startedAt = Date.now();
  const ai = (env as unknown as { AI?: WorkersAIBinding }).AI;
  if (!ai || typeof ai.run !== 'function') {
    const budget = await checkAdvisorTurnBudget(env, opts.userId);
    return {
      ok: false,
      model: null,
      fallback_used: false,
      budget,
      refusal: 'misconfigured',
      error: 'AI binding not configured',
      latency_ms: 0,
      hint: null,
    };
  }

  // Pre-check budget. Hard-block at 100% of cap.
  const preBudget = await checkAdvisorTurnBudget(env, opts.userId);
  if (preBudget.blocked) {
    return {
      ok: false,
      model: null,
      fallback_used: false,
      budget: preBudget,
      refusal: 'budget_advisor_turns_day',
      error: `daily advisor turn cap (${preBudget.limit}) reached`,
      latency_ms: 0,
      hint: `You've reached today's ${preBudget.limit}-turn limit with the advisor. Take a breather — the limit resets at midnight UTC. (You can still browse anything you've already filled in.)`,
    };
  }

  const gatewayOpt = advisorGatewayOption(env, {
    skipCache: opts.skipCache ?? true,        // turns are user-specific
    cacheTtlSec: opts.cacheTtlSec,
  });

  // Primary attempt.
  let attempt = await callOnce(ai, ADVISOR_PRIMARY_MODEL, opts, gatewayOpt);
  let modelUsed: AdvisorModel = ADVISOR_PRIMARY_MODEL;
  let fallbackUsed = false;

  // Single-tier 8b fallback ONLY on HTTP 500/429 per spec.
  if (!attempt.ok && (attempt.status === 500 || attempt.status === 429)) {
    const second = await callOnce(ai, ADVISOR_FALLBACK_MODEL, opts, gatewayOpt);
    if (second.ok) {
      attempt = second;
      modelUsed = ADVISOR_FALLBACK_MODEL;
      fallbackUsed = true;
    } else {
      // Surface the second error if it's more informative; otherwise
      // keep the primary's so callers see the original failure.
      attempt = { ok: false, status: second.status, error: second.error || attempt.error };
    }
  }

  const latency_ms = Date.now() - startedAt;

  if (!attempt.ok) {
    return {
      ok: false,
      model: modelUsed,
      fallback_used: fallbackUsed,
      budget: preBudget,
      refusal: 'all_models_failed',
      error: attempt.error || 'upstream LLM error',
      latency_ms,
      hint: null,
    };
  }

  // Bump the turn counter on success. Failed turns DON'T count against
  // the cap so an upstream outage can't punish the user.
  const postBudget = await bumpAdvisorTurn(env, opts.userId, 1);
  const hint = postBudget.warn
    ? `Heads up — you've used ${postBudget.used} of your ${postBudget.limit} daily advisor turns.`
    : null;

  return {
    ok: true,
    model: modelUsed,
    output: attempt.output,
    stream: attempt.stream,
    fallback_used: fallbackUsed,
    budget: postBudget,
    latency_ms,
    hint,
  };
}
