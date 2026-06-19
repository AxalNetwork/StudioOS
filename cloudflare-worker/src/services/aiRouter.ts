/**
 * Task #1 (AX) — Multi-model AI router.
 *
 * Single entry point every Personal Advisor feature (banks, write-router
 * LLM tool-calls, guardrails, find/deep-link, MI extractors, publication
 * synthesis) calls into. Production: Workers AI only.
 * The dev/eval-only provider (Task #31) is documented separately under
 * `docs/dev/`; this file no longer references it by name.
 *
 * Public API:
 *   run(env, opts) → Promise<RunResult>
 *
 * Behaviour:
 *   - ROUTE map picks the model per task class.
 *   - Non-2xx or >8 s latency on a Workers AI primary → smaller WAI sibling.
 *   - Chain exhausted → refusal (`all_models_failed`).
 *   - Per-user $/day + $/month KV caps; org-wide kill switch on monthly cap.
 *   - embed/explain/sentiment results cached by content-hash (30d / 7d / 30d).
 *   - Every call writes one row to D1 `ai_usage_logs` for the admin dashboard.
 *
 * KV bindings:
 *   - Prefers `env.AI_SPEND` (dedicated namespace). Falls back to `env.TOKENS`
 *     with the `ai_spend:` / `ai_cache:` / `ai_killswitch:` prefixes so this
 *     module is deployable today without provisioning a new namespace.
 */
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TaskClass =
  | 'safety'
  | 'role_detect'
  | 'advisor_turn'
  | 'onboarding_chat'
  | 'tool_call'
  | 'rerank'
  | 'explain'
  | 'advisor_explain'
  | 'sentiment'
  | 'embed'
  | 'paraphrase'
  | 'publication'
  | 'dd_synthesis'
  | 'brand_suggest'
  | 'brand_palette'
  | 'brand_taglines';

export type RefusalReason =
  | 'budget_user_day'
  | 'budget_user_month'
  | 'budget_org_month'
  | 'kill_switch'
  | 'safety_block'
  | 'misconfigured'
  | 'all_models_failed';

export interface RunOptions {
  task: TaskClass;
  userId: number;
  // Free-form text for embed / sentiment / safety; chat messages for the rest.
  text?: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  // Optional override of the cache key (defaults to sha256 of `text` or
  // the concatenated message contents).
  contentHash?: string;
  // For explainer caching: a stable topic key so different phrasings of the
  // same topic share the cached response.
  topic?: string;
  // Streaming pass-through (Workers AI only). When true the result carries
  // a `stream: ReadableStream` instead of `output`. Fallback applies only
  // to synchronous failures before the stream opens; mid-stream errors
  // are surfaced to the caller. Cache + safety_score parsing are bypassed
  // for streams since neither is meaningful without buffering the body.
  stream?: boolean;
}

export interface UsageMeta {
  task: TaskClass;
  model: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  est_cost_usd: number;
  fallback_used: boolean;
  cached: boolean;
  safety_score: number | null;
}

export interface RunResult {
  ok: boolean;
  output?: string;             // assistant text or stringified JSON for tool_call
  embedding?: number[];        // populated for task='embed'
  stream?: ReadableStream;     // populated only when opts.stream === true
  refusal?: RefusalReason;
  error?: string;
  usage: UsageMeta;
}

// ---------------------------------------------------------------------------
// ROUTE table — one record per task class
// ---------------------------------------------------------------------------
interface RouteEntry {
  provider: 'workers-ai';
  model: string;
  // Ordered chain of smaller Workers AI siblings to retry on 5xx / >8s
  // latency. The router tries the primary, then each entry in
  // `fallbackChain` until one succeeds or the chain is exhausted.
  fallbackChain?: string[];
  // KV cache TTL in seconds. Undefined → no cache.
  cacheTtlSec?: number;
  // True for embedding models (response shape differs).
  isEmbed?: boolean;
}

// Per-1M-token rough USD prices used for budget accounting. The exact
// numbers don't have to be perfect — we just need them to be stable so
// caps trip in roughly the right place. Workers AI pricing is per-token
// (May 2026 published rates).
//
// Stored separately so test harnesses can swap them.
export const PRICE_USD_PER_1M_TOKENS: Record<string, { in: number; out: number }> = {
  '@cf/meta/llama-guard-3-8b':                { in: 0.20, out: 0.20 },
  '@cf/meta/llama-3.1-8b-instruct':           { in: 0.20, out: 0.20 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.50, out: 0.50 },
  '@cf/qwen/qwen2.5-coder-32b-instruct':      { in: 0.40, out: 0.40 },
  '@cf/baai/bge-base-en-v1.5':                { in: 0.05, out: 0.00 },
};

// Spec step 3: "fall back to a smaller Workers AI sibling
// (tool_call → advisor_turn → role_detect; 70b → 8b)". The chain below
// implements that two-step degradation for tool_call (qwen32b →
// llama-3.3-70b → llama-3.1-8b) and one-step for everything else that
// has a smaller sibling.
const SMALL_LLAMA = '@cf/meta/llama-3.1-8b-instruct';
const MID_LLAMA   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const ROUTE: Record<TaskClass, RouteEntry> = {
  safety:       { provider: 'workers-ai', model: '@cf/meta/llama-guard-3-8b' },
  role_detect:  { provider: 'workers-ai', model: SMALL_LLAMA },
  advisor_turn: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // Onboarding profiling chatbot (routes/profiling.ts). Deliberately NOT
  // gateway-routed (see gatewayOptionFor) and on the light 8B model first:
  // it is a short 5–8 turn intake, not the Personal Advisor, so it must not
  // share the `advisor-ongoing` AI Gateway (whose failure used to cost an 8s
  // timeout PER TURN before the bypass kicked in) nor the advisor daily
  // budget. 8B primary keeps it fast/cheap; 70B is the fallback. Matches the
  // documented intent in OnboardingChatPage.jsx.
  onboarding_chat: { provider: 'workers-ai', model: SMALL_LLAMA, fallbackChain: [MID_LLAMA] },
  tool_call:    { provider: 'workers-ai', model: '@cf/qwen/qwen2.5-coder-32b-instruct', fallbackChain: [MID_LLAMA, SMALL_LLAMA] },
  // Personal Advisor next-question re-ranker (advisor/rerank.ts).
  // Structured JSON pick over a bounded candidate list — qwen-coder
  // is the strongest at obeying the {"id": "..."} schema; fall back
  // to MID then SMALL llama if qwen 5xxs / times out. The route layer
  // ALWAYS treats a router miss as deterministic-first-in-bank, so a
  // total chain failure still yields a valid next question.
  rerank:       { provider: 'workers-ai', model: '@cf/qwen/qwen2.5-coder-32b-instruct', fallbackChain: [MID_LLAMA, SMALL_LLAMA] },
  explain:      { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA], cacheTtlSec: 7 * 86400 },
  // Personal Advisor free-form "explain" SSE endpoint. Workers AI is the
  // only provider in production (Task #31 removed the Anthropic narrow
  // last-resort fallback). No cache: each explanation is persona/topic-
  // specific and short-lived.
  advisor_explain: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  sentiment:    { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA], cacheTtlSec: 30 * 86400 },
  embed:        { provider: 'workers-ai', model: '@cf/baai/bge-base-en-v1.5', isEmbed: true,  cacheTtlSec: 30 * 86400 },
  paraphrase:   { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // High-stakes synthesis (Task #2 AU admin publication summaries,
  // dd synthesis). Task #31: Anthropic removed from production. Both
  // task classes now route through Workers AI MID_LLAMA primary →
  // SMALL_LLAMA fallback. Voice/quality regression is monitored via
  // the existing admin AI usage dashboard.
  publication:  { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  dd_synthesis: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // Founder Brand & Landing Page name/tagline generator (routes/brand.ts).
  // Creative short-form JSON; MID_LLAMA primary → SMALL_LLAMA fallback.
  // A total chain failure falls back to the deterministic heuristic in
  // the route, so the wizard is always usable.
  brand_suggest: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // Task #3 (Brand Kit Expansion) — AI palette suggester. Creative short-form
  // JSON; MID_LLAMA primary → SMALL_LLAMA fallback. Fallback chain failure
  // returns null to the route, which lands on the deterministic heuristic bank.
  brand_palette: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // Task #3 (Brand Kit Expansion) — AI tagline iterator. 6 JSON taglines;
  // MID_LLAMA primary → SMALL_LLAMA fallback. Fallback chain failure returns
  // null to the route, which lands on the deterministic template bank.
  brand_taglines: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
};

// Latency budget per primary attempt before we fall back.
const PRIMARY_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Budget defaults (overridable via env vars)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  USER_DAY_USD: 5,
  USER_MONTH_USD: 50,
  ORG_MONTH_USD: 5_000,
};

function budgetCaps(env: Env): { userDay: number; userMonth: number; orgMonth: number } {
  const e = env as unknown as Record<string, string | undefined>;
  const num = (v: string | undefined, fallback: number) => {
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    userDay:   num(e.WORKERS_AI_BUDGET_USD_DAY,   DEFAULTS.USER_DAY_USD),
    userMonth: num(e.WORKERS_AI_BUDGET_USD_MONTH, DEFAULTS.USER_MONTH_USD),
    orgMonth:  num(e.WORKERS_AI_BUDGET_USD_ORG_MONTH, DEFAULTS.ORG_MONTH_USD),
  };
}

// ---------------------------------------------------------------------------
// KV abstraction — prefer dedicated AI_SPEND namespace, fall back to TOKENS
// with prefixed keys so the router is deployable without re-provisioning KV.
// ---------------------------------------------------------------------------
interface MinimalKV {
  get(key: string, type?: 'text' | 'json'): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(env: Env): MinimalKV | null {
  const e = env as unknown as { AI_SPEND?: MinimalKV; TOKENS?: MinimalKV };
  return e.AI_SPEND || e.TOKENS || null;
}

function todayKey(): string {
  // YYYY-MM-DD in UTC (sortable, no locale drift).
  return new Date().toISOString().slice(0, 10);
}
function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function readSpend(store: MinimalKV, key: string): Promise<number> {
  try {
    const v = await store.get(`ai_spend:${key}`);
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

// NOTE on atomicity: Cloudflare KV is eventually consistent and offers no
// atomic increment primitive. Concurrent calls from the same user/org may
// race here and lose updates, slightly undercounting spend. For the AX
// budget-cap use case this is acceptable — the worst case is a small
// overshoot of a daily/monthly $ cap before the next request observes the
// updated value and refuses. If we ever need hard cap atomicity (e.g. a
// regulatory ledger) we should swap this for a Durable Object counter.
async function bumpSpend(store: MinimalKV, key: string, delta: number, ttlSec: number): Promise<number> {
  const prior = await readSpend(store, key);
  const next = prior + Math.max(0, delta);
  try {
    await store.put(`ai_spend:${key}`, String(next), { expirationTtl: ttlSec });
  } catch { /* best-effort */ }
  return next;
}

async function killSwitchOn(store: MinimalKV): Promise<boolean> {
  try {
    const v = await store.get('ai_killswitch:org');
    return v === '1' || v === 'true';
  } catch { return false; }
}

async function setKillSwitch(store: MinimalKV, ttlSec: number): Promise<void> {
  try { await store.put('ai_killswitch:org', '1', { expirationTtl: ttlSec }); } catch {}
}

// ---------------------------------------------------------------------------
// Cost helper
// ---------------------------------------------------------------------------
export function estimateCostUsd(model: string, promptTok: number, completionTok: number): number {
  const p = PRICE_USD_PER_1M_TOKENS[model];
  if (!p) return 0;
  return (promptTok / 1_000_000) * p.in + (completionTok / 1_000_000) * p.out;
}

// Crude token estimator — ≈ 4 chars/token for English. Good enough for
// budget accounting; real prompt/completion counts come back from the
// provider when available.
function estTokens(s: string | undefined | null): number {
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

// ---------------------------------------------------------------------------
// Content hashing for cache keys
// ---------------------------------------------------------------------------
async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function defaultContentBlob(opts: RunOptions): string {
  if (opts.text != null) return opts.text;
  if (opts.messages?.length) {
    return opts.messages.map(m => `${m.role}:${m.content}`).join('\n');
  }
  return '';
}

async function cacheKeyFor(opts: RunOptions): Promise<string | null> {
  const route = ROUTE[opts.task];
  if (!route.cacheTtlSec) return null;
  const seed = opts.contentHash
    || (opts.task === 'explain' && opts.topic ? `topic:${opts.topic}` : null)
    || defaultContentBlob(opts);
  if (!seed) return null;
  const hash = await sha256Hex(seed);
  return `ai_cache:${opts.task}:${hash}`;
}

// ---------------------------------------------------------------------------
// Schema bootstrap for ai_usage_logs (mirrors migration 040). Cheap, gated
// behind a once-per-isolate flag so dev/SQLite is self-healing.
// ---------------------------------------------------------------------------
let _logSchemaReady = false;
async function ensureLogSchema(env: Env): Promise<void> {
  if (_logSchemaReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL, fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_logs(user_id, created_at DESC)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_ai_usage_task_created ON ai_usage_logs(task, created_at DESC)");
    _logSchemaReady = true;
  } catch (e) {
    console.warn('[aiRouter] log schema:', (e as Error).message);
  }
}

async function recordUsage(env: Env, userId: number | null, usage: UsageMeta, refusal: RefusalReason | null): Promise<void> {
  await ensureLogSchema(env);
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage_logs (user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      usage.task,
      usage.model,
      Math.max(0, Math.round(usage.latency_ms)),
      Math.max(0, Math.round(usage.prompt_tokens)),
      Math.max(0, Math.round(usage.completion_tokens)),
      Math.max(0, usage.est_cost_usd),
      usage.safety_score,
      usage.fallback_used ? 1 : 0,
      usage.cached ? 1 : 0,
      refusal,
    ).run();
  } catch (e) {
    console.warn('[aiRouter] recordUsage:', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Provider invocations
// ---------------------------------------------------------------------------
interface ProviderResult {
  ok: boolean;
  status?: number;
  output?: string;
  embedding?: number[];
  stream?: ReadableStream;
  prompt_tokens?: number;
  completion_tokens?: number;
  error?: string;
}

interface WorkersAIBinding {
  run(
    model: string,
    payload: unknown,
    options?: { gateway?: { id: string; skipCache?: boolean; cacheTtl?: number } },
  ): Promise<unknown>;
}

// Task #4 (CG) — advisor tasks (`advisor_turn`, `advisor_explain`)
// route through the dedicated advisor AI Gateway slug so their
// analytics, cache and rate limits are tracked separately from the
// onboarding chatbot. Returns undefined when the env var is missing
// (call falls through to the un-gatewayed Workers AI path).
function gatewayOptionFor(env: Env, task: TaskClass): { gateway: { id: string } } | undefined {
  if (task !== 'advisor_turn' && task !== 'advisor_explain') return undefined;
  const slug = (env as unknown as Record<string, string | undefined>).CF_AI_GATEWAY_SLUG_ADVISOR;
  if (!slug || !slug.trim()) return undefined;
  return { gateway: { id: slug.trim() } };
}

// True when this task would normally route through the advisor AI Gateway
// AND a slug is configured — i.e. there's a gateway hop that could fail
// independently of the underlying Workers AI model.
function isGatewayRouted(env: Env, task: TaskClass): boolean {
  return gatewayOptionFor(env, task) !== undefined;
}

// Task #50 — when `bypassGateway` is set we skip the advisor AI Gateway and
// hit Workers AI directly. Used as the resilience retry so a misconfigured
// or unavailable `advisor-ongoing` gateway (e.g. Authenticated Gateway
// toggled on, a hostile rate-limit/cache rule) can no longer dead-end the
// onboarding chat — we lose only the separate advisor analytics namespace,
// not the conversation itself.
async function callWorkersAI(env: Env, model: string, opts: RunOptions, isEmbed: boolean, bypassGateway = false): Promise<ProviderResult> {
  const ai = (env as unknown as { AI?: WorkersAIBinding }).AI;
  if (!ai || typeof ai.run !== 'function') {
    return { ok: false, status: 0, error: 'AI binding not configured' };
  }
  const gatewayOpt = bypassGateway ? undefined : gatewayOptionFor(env, opts.task);
  try {
    if (isEmbed) {
      const text = opts.text ?? defaultContentBlob(opts);
      const out = await ai.run(model, { text }, gatewayOpt) as { data?: number[][]; shape?: number[] } | unknown;
      const data = (out as { data?: number[][] })?.data;
      const vec = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : null;
      if (!vec) return { ok: false, status: 502, error: 'unexpected embed response' };
      return { ok: true, output: '', embedding: vec, prompt_tokens: estTokens(text), completion_tokens: 0 };
    }
    // When the caller supplies `messages`, honor them — but still
    // inject `systemPrompt` as a leading system message unless the
    // caller already included one. Without this, /advisor/explain
    // (which always passes both systemPrompt + a single user message)
    // would silently drop ADVISOR_SYSTEM_PROMPT + persona context on
    // the Workers AI path while keeping it on the Anthropic path,
    // producing diverging guardrail behavior across providers.
    const messages = opts.messages?.length
      ? (
          opts.systemPrompt && !opts.messages.some((m) => m.role === 'system')
            ? [{ role: 'system' as const, content: opts.systemPrompt }, ...opts.messages]
            : opts.messages
        )
      : [
          ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
          { role: 'user' as const, content: opts.text || '' },
        ];
    const payload: Record<string, unknown> = {
      messages,
      max_tokens: opts.maxTokens || 512,
    };
    if (opts.temperature != null) payload.temperature = opts.temperature;
    if (opts.stream) payload.stream = true;
    const raw = await ai.run(model, payload, gatewayOpt);
    // Streaming pass-through: Workers AI returns a ReadableStream of
    // SSE-formatted chunks when stream:true is set. We forward it
    // verbatim to the caller; cost accounting falls back to estimated
    // prompt tokens only since we don't see the completion side.
    if (opts.stream && raw && typeof (raw as ReadableStream).getReader === 'function') {
      const promptTok = estTokens(messages.map(m => m.content).join('\n'));
      return { ok: true, stream: raw as ReadableStream, prompt_tokens: promptTok, completion_tokens: 0 };
    }
    // Workers AI chat models return { response: string } or
    // { choices: [{ message: { content } }] } depending on model. Some
    // models / gateway responses nest the payload under { result: {...} },
    // so unwrap that too before reading — otherwise a valid reply is
    // silently dropped to the empty-string fallback (reads as "the chatbot
    // is broken" even though the model answered).
    const rawObj = raw as { result?: unknown } | undefined;
    const r = ((rawObj && typeof rawObj === 'object' && 'result' in rawObj && rawObj.result)
      ? rawObj.result
      : raw) as {
      response?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = r.response ?? r.choices?.[0]?.message?.content ?? '';
    const promptTok = r.usage?.prompt_tokens ?? estTokens(messages.map(m => m.content).join('\n'));
    const completionTok = r.usage?.completion_tokens ?? estTokens(text);
    return { ok: true, output: String(text || ''), prompt_tokens: promptTok, completion_tokens: completionTok };
  } catch (e) {
    return { ok: false, status: 500, error: (e as Error).message };
  }
}

// Task #31 — non-WAI providers removed from the production worker.
// The dev/eval harness lives in `scripts/eval/` with its own fetch
// wrapper; the router itself is Workers-AI-only on the prod surface.

// Wrap a provider call in a hard latency budget. Resolves to {ok:false,status:504}
// on timeout so the caller can fall back to the smaller sibling.
function withTimeout(p: Promise<ProviderResult>, ms: number): Promise<ProviderResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, status: 504, error: `timeout >${ms}ms` }), ms);
    p.then((r) => { clearTimeout(timer); resolve(r); }, (e) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 500, error: (e as Error).message });
    });
  });
}

// ---------------------------------------------------------------------------
// Public: run()
// ---------------------------------------------------------------------------
export async function run(env: Env, opts: RunOptions): Promise<RunResult> {
  const route = ROUTE[opts.task];
  const startedAt = Date.now();

  if (!route) {
    const usage: UsageMeta = {
      task: opts.task, model: 'unknown', latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts.userId, usage, 'misconfigured');
    return { ok: false, refusal: 'misconfigured', error: `unknown task ${opts.task}`, usage };
  }

  const store = kv(env);
  const caps = budgetCaps(env);

  // ---- Cache lookup ----------------------------------------------------
  // Streaming requests bypass the cache (caching a stream would require
  // buffering the entire response, defeating the latency benefit).
  if (store && route.cacheTtlSec && !opts.stream) {
    const ck = await cacheKeyFor(opts);
    if (ck) {
      try {
        const hit = await store.get(ck, 'json') as { output?: string; embedding?: number[] } | null;
        if (hit) {
          const usage: UsageMeta = {
            task: opts.task, model: route.model, latency_ms: Date.now() - startedAt,
            prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
            fallback_used: false, cached: true, safety_score: null,
          };
          await recordUsage(env, opts.userId, usage, null);
          return {
            ok: true,
            output: hit.output ?? '',
            embedding: hit.embedding,
            usage,
          };
        }
      } catch { /* fall through to fresh call */ }
    }
  }

  // ---- Budget pre-check -----------------------------------------------
  if (store) {
    if (await killSwitchOn(store)) {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'kill_switch');
      return { ok: false, refusal: 'kill_switch', error: 'org-wide AI budget exhausted', usage };
    }
    const dayKey   = `user:${opts.userId}:${todayKey()}`;
    const monthKey_= `user:${opts.userId}:${monthKey()}`;
    const orgKey   = `org:${monthKey()}`;
    const [d, m, o] = await Promise.all([
      readSpend(store, dayKey),
      readSpend(store, monthKey_),
      readSpend(store, orgKey),
    ]);
    if (d >= caps.userDay) {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'budget_user_day');
      return { ok: false, refusal: 'budget_user_day', error: `daily cap ${caps.userDay} USD reached`, usage };
    }
    if (m >= caps.userMonth) {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'budget_user_month');
      return { ok: false, refusal: 'budget_user_month', error: `monthly cap ${caps.userMonth} USD reached`, usage };
    }
    if (o >= caps.orgMonth) {
      await setKillSwitch(store, 35 * 86400);
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'budget_org_month');
      return { ok: false, refusal: 'budget_org_month', error: `org cap ${caps.orgMonth} USD reached`, usage };
    }
  }

  // ---- Primary call + fallback chain ----------------------------------
  // Streaming bypasses the latency timeout (the stream opens fast but the
  // body may legitimately exceed 8 s). Latency budget still applies to
  // the synchronous Workers AI handshake before the stream opens because
  // ai.run() resolves only once the upstream accepts the request.
  const gatewayRouted = isGatewayRouted(env, opts.task);
  const callWaiRaw = (model: string, bypassGateway: boolean): Promise<ProviderResult> => {
    if (opts.stream) return callWorkersAI(env, model, opts, !!route.isEmbed, bypassGateway);
    return withTimeout(callWorkersAI(env, model, opts, !!route.isEmbed, bypassGateway), PRIMARY_TIMEOUT_MS);
  };
  // Task #50 — gateway-resilient call. For gateway-routed advisor tasks we
  // first hit the gatewayed path (keeps advisor analytics/cache/RL). If that
  // fails — which a broken/misconfigured `advisor-ongoing` gateway would
  // cause for EVERY model in the chain — we retry the SAME model un-gatewayed
  // before declaring the model dead. So a single shared-gateway outage can no
  // longer take onboarding down. Non-gateway tasks are unaffected (the first
  // call is already un-gatewayed, so no extra call is made).
  const callWai = async (model: string): Promise<ProviderResult> => {
    const first = await callWaiRaw(model, false);
    if (first.ok || !gatewayRouted) return first;
    const retry = await callWaiRaw(model, true);
    if (retry.ok) {
      console.warn('[AI_ROUTER] advisor gateway bypassed after failure', {
        task: opts.task,
        model,
        gatewayError: first.error,
      });
      return retry;
    }
    return first;
  };

  let attempt = await callWai(route.model);
  let modelUsed = route.model;
  let fallbackUsed = false;
  let lastError = attempt.error;

  // Workers AI multi-hop fallback chain (spec: tool_call → advisor_turn →
  // role_detect, i.e. qwen32b → llama-70b → llama-8b).
  if (!attempt.ok && route.fallbackChain?.length) {
    for (const sibling of route.fallbackChain) {
      const next = await callWai(sibling);
      if (next.ok) {
        attempt = next;
        modelUsed = sibling;
        fallbackUsed = true;
        lastError = undefined;
        break;
      }
      lastError = next.error || lastError;
    }
  }

  const latency = Date.now() - startedAt;
  const promptTok = attempt.prompt_tokens || 0;
  const completionTok = attempt.completion_tokens || 0;
  const cost = estimateCostUsd(modelUsed, promptTok, completionTok);

  // For task='safety' (llama-guard-3-8b) parse the structured response
  // into a 0..1 score so the admin dashboard can chart guardrail
  // effectiveness over time. llama-guard returns plain text whose first
  // line is either "safe" or "unsafe" (followed by violated category
  // codes on subsequent lines). 1.0 = safe, 0.0 = unsafe, null when the
  // response shape is unrecognised so we never invent scores.
  let safetyScore: number | null = null;
  if (opts.task === 'safety' && attempt.ok && attempt.output != null) {
    const firstLine = attempt.output.trim().split(/\r?\n/, 1)[0]?.trim().toLowerCase();
    if (firstLine === 'safe') safetyScore = 1;
    else if (firstLine === 'unsafe') safetyScore = 0;
  }

  const usage: UsageMeta = {
    task: opts.task,
    model: modelUsed,
    latency_ms: latency,
    prompt_tokens: promptTok,
    completion_tokens: completionTok,
    est_cost_usd: cost,
    fallback_used: fallbackUsed,
    cached: false,
    safety_score: safetyScore,
  };

  if (!attempt.ok) {
    await recordUsage(env, opts.userId, usage, 'all_models_failed');
    return { ok: false, refusal: 'all_models_failed', error: lastError || 'provider failed', usage };
  }

  // ---- Bump KV spend buckets ------------------------------------------
  // Post-bump: if the org monthly bucket just crossed the hard cap, flip
  // the kill switch in the same code path so the overshoot window is at
  // most one in-flight request per concurrent caller. The pre-check at
  // the top of the next call will then refuse before invoking any model.
  if (store && cost > 0) {
    const dayKey    = `user:${opts.userId}:${todayKey()}`;
    const monthKey_ = `user:${opts.userId}:${monthKey()}`;
    const orgKey    = `org:${monthKey()}`;
    const [, , orgTotal] = await Promise.all([
      bumpSpend(store, dayKey,    cost, 2 * 86400),
      bumpSpend(store, monthKey_, cost, 35 * 86400),
      bumpSpend(store, orgKey,    cost, 35 * 86400),
    ]);
    if (orgTotal >= caps.orgMonth) {
      await setKillSwitch(store, 35 * 86400);
    }
  }

  // ---- Cache write -----------------------------------------------------
  // Skip cache write for streamed responses (see cache-lookup note above).
  if (store && route.cacheTtlSec && !opts.stream && attempt.stream == null) {
    const ck = await cacheKeyFor(opts);
    if (ck) {
      try {
        await store.put(
          ck,
          JSON.stringify({ output: attempt.output, embedding: attempt.embedding }),
          { expirationTtl: route.cacheTtlSec },
        );
      } catch { /* cache best-effort */ }
    }
  }

  await recordUsage(env, opts.userId, usage, null);

  return {
    ok: true,
    output: attempt.output,
    embedding: attempt.embedding,
    stream: attempt.stream,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Admin helper — usage rollup for the /api/monitoring/ai-usage endpoint.
// ---------------------------------------------------------------------------
export interface AiUsageReport {
  generated_at: string;
  window_days: number;
  total_cost_usd: number;
  total_calls: number;
  fallback_rate: number;
  cache_hit_rate: number;
  by_task: Array<{
    task: string;
    calls: number;
    total_cost_usd: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    fallback_rate: number;
  }>;
  // Spec: per-day spend per task class with **model**/latency/safety/
  // fallback breakdown. by_model satisfies the model-level cut.
  by_model: Array<{ model: string; calls: number; total_cost_usd: number; fallback_count: number }>;
  // llama-guard safety scoring rollup over rows where task='safety'.
  // safe_rate is in [0,1]. evaluated counts only rows with a non-null
  // safety_score (so cache hits / refusals don't pollute the denominator).
  safety: { evaluated: number; safe_count: number; unsafe_count: number; safe_rate: number };
  by_day: Array<{ day: string; total_cost_usd: number; calls: number }>;
  top_users: Array<{ user_id: number | null; calls: number; total_cost_usd: number }>;
  refusals: Array<{ refusal: string; count: number }>;
}

export async function loadAiUsageReport(env: Env, days = 7): Promise<AiUsageReport> {
  await ensureLogSchema(env);
  const win = Math.max(1, Math.min(90, Math.round(days)));
  const since = new Date(Date.now() - win * 86400_000).toISOString().slice(0, 19).replace('T', ' ');

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS calls,
       COALESCE(SUM(est_cost_usd), 0) AS total_cost,
       SUM(fallback_used) AS fb,
       SUM(cached) AS ch
     FROM ai_usage_logs WHERE created_at >= ?`,
  ).bind(since).first<{ calls: number; total_cost: number; fb: number; ch: number }>().catch(() => null);

  const byTaskRows = await env.DB.prepare(
    `SELECT task,
            COUNT(*) AS calls,
            COALESCE(SUM(est_cost_usd), 0) AS total_cost,
            SUM(fallback_used) AS fb
       FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY task
      ORDER BY total_cost DESC`,
  ).bind(since).all<{ task: string; calls: number; total_cost: number; fb: number }>().catch(() => ({ results: [] as Array<{ task: string; calls: number; total_cost: number; fb: number }> }));

  // Compute per-task percentile latencies separately — D1/SQLite has no
  // PERCENTILE_CONT, so we pull the latency column and compute in JS.
  const byTask: AiUsageReport['by_task'] = [];
  for (const t of byTaskRows.results || []) {
    const latRows = await env.DB.prepare(
      `SELECT latency_ms FROM ai_usage_logs WHERE created_at >= ? AND task = ? AND latency_ms > 0 ORDER BY latency_ms ASC`,
    ).bind(since, t.task).all<{ latency_ms: number }>().catch(() => ({ results: [] as Array<{ latency_ms: number }> }));
    const lat = (latRows.results || []).map(r => Number(r.latency_ms) || 0);
    const pct = (p: number) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0;
    byTask.push({
      task: t.task,
      calls: Number(t.calls) || 0,
      total_cost_usd: Number(t.total_cost) || 0,
      p50_latency_ms: pct(0.50),
      p95_latency_ms: pct(0.95),
      fallback_rate: t.calls ? (Number(t.fb) || 0) / Number(t.calls) : 0,
    });
  }

  const byDay = await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day,
            COALESCE(SUM(est_cost_usd), 0) AS total_cost,
            COUNT(*) AS calls
       FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY day
      ORDER BY day ASC`,
  ).bind(since).all<{ day: string; total_cost: number; calls: number }>().catch(() => ({ results: [] as Array<{ day: string; total_cost: number; calls: number }> }));

  const topUsers = await env.DB.prepare(
    `SELECT user_id,
            COUNT(*) AS calls,
            COALESCE(SUM(est_cost_usd), 0) AS total_cost
       FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY user_id
      ORDER BY total_cost DESC
      LIMIT 10`,
  ).bind(since).all<{ user_id: number | null; calls: number; total_cost: number }>().catch(() => ({ results: [] as Array<{ user_id: number | null; calls: number; total_cost: number }> }));

  const refusals = await env.DB.prepare(
    `SELECT refusal, COUNT(*) AS count FROM ai_usage_logs
       WHERE created_at >= ? AND refusal IS NOT NULL
       GROUP BY refusal ORDER BY count DESC`,
  ).bind(since).all<{ refusal: string; count: number }>().catch(() => ({ results: [] as Array<{ refusal: string; count: number }> }));

  const byModel = await env.DB.prepare(
    `SELECT model,
            COUNT(*) AS calls,
            COALESCE(SUM(est_cost_usd), 0) AS total_cost,
            COALESCE(SUM(fallback_used), 0) AS fb
       FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY model
      ORDER BY total_cost DESC`,
  ).bind(since).all<{ model: string; calls: number; total_cost: number; fb: number }>().catch(() => ({ results: [] as Array<{ model: string; calls: number; total_cost: number; fb: number }> }));

  const safety = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN safety_score IS NOT NULL THEN 1 ELSE 0 END) AS evaluated,
        SUM(CASE WHEN safety_score >= 0.5 THEN 1 ELSE 0 END) AS safe_count,
        SUM(CASE WHEN safety_score IS NOT NULL AND safety_score < 0.5 THEN 1 ELSE 0 END) AS unsafe_count
       FROM ai_usage_logs WHERE created_at >= ? AND task = 'safety'`,
  ).bind(since).first<{ evaluated: number; safe_count: number; unsafe_count: number }>().catch(() => null);

  const calls = Number(totals?.calls || 0);
  return {
    generated_at: new Date().toISOString(),
    window_days: win,
    total_cost_usd: Number(totals?.total_cost || 0),
    total_calls: calls,
    fallback_rate: calls ? Number(totals?.fb || 0) / calls : 0,
    cache_hit_rate: calls ? Number(totals?.ch || 0) / calls : 0,
    by_task: byTask,
    by_model: (byModel.results || []).map(r => ({
      model: r.model,
      calls: Number(r.calls) || 0,
      total_cost_usd: Number(r.total_cost) || 0,
      fallback_count: Number(r.fb) || 0,
    })),
    safety: {
      evaluated: Number(safety?.evaluated || 0),
      safe_count: Number(safety?.safe_count || 0),
      unsafe_count: Number(safety?.unsafe_count || 0),
      safe_rate: Number(safety?.evaluated || 0) > 0
        ? Number(safety?.safe_count || 0) / Number(safety?.evaluated || 0)
        : 0,
    },
    by_day: (byDay.results || []).map(r => ({
      day: r.day, total_cost_usd: Number(r.total_cost) || 0, calls: Number(r.calls) || 0,
    })),
    top_users: (topUsers.results || []).map(r => ({
      user_id: r.user_id, calls: Number(r.calls) || 0, total_cost_usd: Number(r.total_cost) || 0,
    })),
    refusals: (refusals.results || []).map(r => ({ refusal: r.refusal, count: Number(r.count) || 0 })),
  };
}

// Test-only export — lets the test harness reset the once-per-isolate
// schema flag between scenarios.
export function __resetForTest(): void {
  _logSchemaReady = false;
}

// Spec phrased the public entry point as `run(task, payload, opts)`.
// Workers convention forces us to thread `env` explicitly (no module-level
// globals), so the actual surface is `run(env, opts)`. This thin adapter
// gives downstream features (AR/AS/AW/AV/AT/AU) a curried callable that
// matches the conceptual signature: `const ai = bindAi(env); ai('embed', { text })`.
export function bindAi(env: Env): (task: TaskClass, payload: Omit<RunOptions, 'task' | 'userId'> & { userId?: number }, userId?: number) => Promise<RunResult> {
  return (task, payload, userId = 0) => run(env, { ...payload, task, userId: payload.userId ?? userId });
}
