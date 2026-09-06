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
  | 'brand_autofill'
  | 'brand_palette'
  | 'brand_taglines'
  | 'workspace_explain'
  | 'transcribe'
  | 'validate_tag_pains'
  | 'validate_draft_hypotheses'
  | 'research_ask';

export type RefusalReason =
  | 'budget_user_day'
  | 'budget_user_month'
  | 'budget_org_month'
  | 'kill_switch'
  | 'safety_block'
  | 'misconfigured'
  // The caller named a model this task does not offer. Distinct from
  // 'misconfigured' (an unknown TASK) because the fix is different: a stale
  // saved preference in someone's browser, not a coding error, and the caller
  // is expected to clear it and re-run on the primary.
  | 'model_not_offered'
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
  // Minutes of audio, for a task billed by the minute. Derived server-side
  // from the clip's byte length — see `audioMinutesFromBytes` — never taken
  // from a request, because it decides what a run costs.
  audioMinutes?: number;
  // Raw audio bytes for a transcription task. Not `text`, and not `messages`:
  // Workers AI takes `{ audio: number[] }` for Whisper, which shares nothing
  // with the chat shape.
  audio?: Uint8Array;
  // A model the CALLER picked, validated against `ROUTE[task].alternates`.
  // Absent means "whatever the route says", which is every internal caller.
  // A model not on that list is REFUSED, never quietly swapped for the
  // primary: reporting success under a model the caller did not ask for is
  // the class of lie this router exists to avoid.
  model?: string;
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
  // Models a CALLER may pick for this task, primary first. Empty or absent
  // means the caller may pick nothing — `opts.model` is refused outright,
  // even when it names the primary.
  //
  // NOT `fallbackChain`, which is a different question. That list is what the
  // router degrades to when a model fails; this one is what a person is
  // allowed to choose while everything is working. A model can be on one and
  // not the other: the deprecated 8b was a fallback for years and was never
  // something to offer, and a costlier sibling can be worth offering while
  // being the wrong thing to degrade TO under load.
  //
  // DECISIONS D13 removed the rail's model menu because "a caller must never
  // be able to route a `safety` call away from the guard model", and left the
  // menu's return conditional on solving that. This is the solution, and it is
  // structural rather than a check: `safety` and `embed` declare no
  // alternates, so no value of `opts.model` reaches them.
  alternates?: string[];
  // KV cache TTL in seconds. Undefined → no cache.
  cacheTtlSec?: number;
  // True for embedding models (response shape differs).
  isEmbed?: boolean;
  // True for speech-to-text. A third request shape, and a third response
  // shape: Workers AI takes `{ audio: number[] }` and answers `{ text }`,
  // which shares nothing with either the chat or the embed path.
  isAudio?: boolean;
}

/**
 * Per-1M-token USD prices, taken from Cloudflare's published Workers AI
 * pricing table.
 *
 * THIS COMMENT USED TO SAY THE NUMBERS DID NOT HAVE TO BE PERFECT — "we just
 * need them to be stable so caps trip in roughly the right place". That stopped
 * being true when `ui/WorkerRail.jsx` began rendering the rate beside the model
 * name: these figures are now shown to a founder deciding whether to run
 * something, so a wrong one is a wrong price quoted to a customer, not a
 * slightly-off budget cap.
 *
 * Every previous value was wrong, and the most-used one was wrong by 4.5x:
 *
 *   model                                    was          published
 *   llama-guard-3-8b                         0.20 / 0.20  0.484 / 0.030
 *   llama-3.1-8b-instruct                    0.20 / 0.20  0.282 / 0.827
 *   llama-3.3-70b-instruct-fp8-fast          0.50 / 0.50  0.293 / 2.253
 *   qwen2.5-coder-32b-instruct               0.40 / 0.40  0.660 / 1.000
 *
 * Note the shape the old table could not express and the real one needs: input
 * and output are NOT symmetric. Llama Guard is dear to prompt and nearly free
 * to answer (it emits one word); the 70b is the reverse by a factor of eight.
 * A table that set them equal mispriced every task in the same direction as the
 * traffic — long prompts, short answers — and understated the total.
 *
 * Stored separately so test harnesses can swap them, and pinned by
 * `cloudflare-worker/test/ai_router_prices.test.mjs` so a future edit has to
 * mean it.
 */
export const PRICE_USD_PER_1M_TOKENS: Record<string, { in: number; out: number }> = {
  '@cf/meta/llama-guard-3-8b':                { in: 0.484, out: 0.030 },
  // Kept for callers that still name it, and for accounting on runs already
  // recorded against it. It is DEPRECATED (5/30/2026) and is no longer routed
  // to — see SMALL_LLAMA below.
  '@cf/meta/llama-3.1-8b-instruct':           { in: 0.282, out: 0.827 },
  '@cf/meta/llama-3.1-8b-instruct-fp8':       { in: 0.152, out: 0.287 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.293, out: 2.253 },
  // Offered as a workspace_explain alternate: six times cheaper to prompt and
  // shallower, which is a trade a founder may reasonably want to make on a
  // read-back. Priced here because an alternate with no row would bill as zero.
  '@cf/meta/llama-3.2-3b-instruct':            { in: 0.051, out: 0.335 },
  '@cf/qwen/qwen2.5-coder-32b-instruct':      { in: 0.660, out: 1.000 },
  '@cf/baai/bge-base-en-v1.5':                { in: 0.05,  out: 0.00 },
};

/**
 * Audio models are billed by the MINUTE, not by the token, and the table above
 * cannot express that.
 *
 * This is not a stylistic split. `estimateCostUsd` returns 0 for a model with
 * no row, and `ai_router_prices.test.mjs` exists because of what that costs:
 * "a model in ROUTE with no price row bills as zero, and a spend cap that
 * counts zero never trips". Whisper has no token price anywhere, so folding it
 * into the token table would mean either a fabricated per-token rate or a
 * transcription that is free until the invoice arrives.
 *
 * Read from Cloudflare's audio pricing table on 2026-09-06.
 */
export const PRICE_USD_PER_AUDIO_MINUTE: Record<string, number> = {
  '@cf/openai/whisper': 0.0005,
  '@cf/openai/whisper-large-v3-turbo': 0.0005,
};

/**
 * Minutes of audio in a clip, from its byte length.
 *
 * WHY NOT ASK THE CLIENT. A browser can measure a clip's duration exactly, and
 * a number the client sends is a number the client chooses. This one drives
 * billing and the spend cap, so it is derived server-side from a fact the
 * server holds.
 *
 * WHY AN ASSUMED BITRATE IS ACCEPTABLE HERE. It is an estimate, and it sits
 * one function below the token estimator that calls itself "crude — ≈ 4
 * chars/token". 32 kbps is the top of the range a browser's MediaRecorder
 * produces for opus/webm speech, so this under-estimates rather than over-bills
 * a founder for a file we cannot decode. Cloudflare bills the real minutes
 * either way; this is our own accounting, and it is honest about being an
 * approximation rather than silently reporting zero.
 *
 * Rounded UP to a whole minute, because that is the unit the rate is quoted in.
 */
export const ASSUMED_AUDIO_BITRATE_BPS = 32_000;
export function audioMinutesFromBytes(bytes: number): number {
  const n = Number(bytes) || 0;
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(n / (ASSUMED_AUDIO_BITRATE_BPS / 8) / 60));
}

// Spec step 3: "fall back to a smaller Workers AI sibling
// (tool_call → advisor_turn → role_detect; 70b → 8b)". The chain below
// implements that two-step degradation for tool_call (qwen32b →
// llama-3.3-70b → llama-3.1-8b) and one-step for everything else that
// has a smaller sibling.
// `@cf/meta/llama-3.1-8b-instruct` — which this was until now — carries
// Cloudflare's DEPRECATED marker with the date 5/30/2026, already past. It was
// the `role_detect` model and the fallback for every other task class in this
// table, so the whole chain terminated on a model scheduled for removal.
//
// `-fp8` is the same family and size, has a 32,000-token context against the
// deprecated model's 7,968, and is cheaper on both sides (0.152/0.287 against
// 0.282/0.827). There is also a `-fp8-fast` at 0.045/0.384 — cheaper to prompt,
// dearer to answer — which suits a classifier better than a fallback; taking it
// here would change the failure behaviour of every task at once, so it is a
// deliberate second step rather than a side effect of this one.
const SMALL_LLAMA = '@cf/meta/llama-3.1-8b-instruct-fp8';
const MID_LLAMA   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const ROUTE: Record<TaskClass, RouteEntry> = {
  safety:       { provider: 'workers-ai', model: '@cf/meta/llama-guard-3-8b' },
  role_detect:  { provider: 'workers-ai', model: SMALL_LLAMA },
  advisor_turn: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // Task #19 (WS0) — onboarding chatbot turn. Same model chain as advisor_turn
  // but a DEDICATED task class so it is NOT routed through the advisor AI
  // Gateway (see gatewayOptionFor): a broken/misconfigured `advisor-ongoing`
  // gateway can never dead-end first-touch onboarding, and onboarding traffic
  // stays out of the advisor analytics namespace. MID_LLAMA primary →
  // SMALL_LLAMA fallback.
  onboarding_chat: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
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
  // Workspace zones — "read back what this page is showing". Its own class
  // rather than a reuse of `explain`, because the join key IS the reporting
  // dimension: `ASSIST_SURFACES` binds a surface to a task, `/api/ai/me/spend`
  // groups by task, and the rail quotes the caller's observed average FOR THAT
  // TASK. Folding workspace runs into `explain` would average them with market
  // comparisons and misreport both.
  //
  // No cache. `explain` caches for a week because a topic explanation is the
  // same answer every time; this one reads a page's CURRENT figures, so a
  // cached answer would describe a state that has moved on — which is worse
  // than no answer, since it looks current.
  // The one task every workspace zone runs, on all four licences — and the
  // first to offer a choice. The three are genuinely different trades and a
  // founder can tell them apart from the rail: the 70b reads across the whole
  // page, the fp8 8b is a fifth the price with a 32k window, the 3.2 3b is
  // cheaper still and shallower. Primary FIRST, because the rail sends back
  // whatever it renders selected and that includes the default.
  workspace_explain: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    alternates: [MID_LLAMA, SMALL_LLAMA, '@cf/meta/llama-3.2-3b-instruct'],
  },
  // The two halves of "AI fills the blanks" on Validate. TWO CLASSES AND NOT
  // ONE, for the reason this table states two entries above: `/api/ai/me/spend`
  // groups by task, and the rail quotes the caller's observed average per task.
  // Folding a tagging run in with a drafting run would average a job that reads
  // a list of phrases against one that reads the whole pain map and writes
  // prose, and misreport both.
  //
  // Neither is cached. A proposal is drawn from evidence that changes every
  // time an interview is logged, which is exactly when someone would ask for
  // one again; a cached answer would describe the map as it was.
  // Speech to text. The one task in this table billed by the MINUTE, which is
  // why `PRICE_USD_PER_AUDIO_MINUTE` exists — see the note above it.
  //
  // No fallback chain and no alternates. `whisper-large-v3-turbo` is faster and
  // more accurate at the same $0.0005/minute, so it is the primary; the base
  // `whisper` stays priced because `routes/advisor.ts`'s composer mic has been
  // calling it directly for as long as that feature has existed, and those runs
  // still have to cost what they cost. Falling back between them on a failure
  // would double the bill for a clip that is going to fail twice, and offering
  // a CHOICE between two models at one price and no meaningful difference is a
  // control that cannot change anything — D13's own objection.
  transcribe: { provider: 'workers-ai', model: '@cf/openai/whisper-large-v3-turbo', isAudio: true },
  validate_tag_pains: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    alternates: [MID_LLAMA, SMALL_LLAMA, '@cf/meta/llama-3.2-3b-instruct'],
  },
  validate_draft_hypotheses: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    // No 3b here, and the asymmetry is deliberate rather than an oversight.
    // Tagging picks from a list someone else wrote and a shallower model can
    // do it; drafting writes the sentence a founder will put in front of an
    // investor. Offering a model that writes a worse claim, to save a
    // hundredth of a cent, is not a trade worth putting on screen.
    alternates: [MID_LLAMA, SMALL_LLAMA],
  },
  // Research · Ask — answering a question over the caller's own indexed
  // documents, with citations.
  //
  // ITS OWN TASK CLASS RATHER THAN `explain`, for the reason stated above:
  // `/api/ai/me/spend` groups by task and the rail quotes the caller's
  // observed average for that task, so folding retrieval answers into a
  // different class would misreport both.
  //
  // NO CACHE, and here that is a correctness rule rather than a freshness
  // one. The prompt embeds the retrieved chunks, so the same question asked
  // after a new document is uploaded must be answered against the new
  // library. A cached answer would cite sources the caller has since changed
  // or deleted — worse than no answer, because it looks sourced.
  research_ask: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
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
  // Founder Brand & Landing Page content auto-fill (routes/brand.ts).
  // Creative short-form JSON (per-template page content); MID_LLAMA primary →
  // SMALL_LLAMA fallback. A total chain failure falls back to the deterministic
  // heuristic in the route, so the editor is always usable.
  brand_autofill: { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
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
export function estimateCostUsd(
  model: string, promptTok: number, completionTok: number, audioMinutes = 0,
): number {
  // Audio first: a model priced by the minute has no token rate, and asking
  // the token table for one would answer 0.
  const perMinute = PRICE_USD_PER_AUDIO_MINUTE[model];
  if (perMinute != null) return Math.max(0, audioMinutes) * perMinute;
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

async function cacheKeyFor(opts: RunOptions, model: string): Promise<string | null> {
  const route = ROUTE[opts.task];
  if (!route.cacheTtlSec) return null;
  const seed = opts.contentHash
    || (opts.task === 'explain' && opts.topic ? `topic:${opts.topic}` : null)
    || defaultContentBlob(opts);
  if (!seed) return null;
  const hash = await sha256Hex(seed);
  // The MODEL is part of the key, not just the task and the content. Once a
  // task offers alternates, two callers asking the same question of different
  // models would otherwise share one entry, and the second would be handed the
  // first one's answer under their own model's name and rate. Adding the
  // segment orphans the entries written before it; they expire on their own
  // TTL and the next call repopulates.
  return `ai_cache:${opts.task}:${model}:${hash}`;
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
// Task #19 (WS0): `onboarding_chat` is deliberately NOT in this list — it
// must never depend on the advisor gateway, so it always runs un-gatewayed.
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
    if (ROUTE[opts.task]?.isAudio) {
      // `Array.from` on the bytes is what the binding expects, and it is also
      // the memory cliff: V8 holds ~8 bytes per element, so the caller's size
      // cap is what keeps a clip from approaching the 128 MB isolate limit.
      // See `MAX_RECORDING_BYTES` in `routes/founder_validate.ts`.
      const bytes = opts.audio;
      if (!bytes || !bytes.byteLength) return { ok: false, status: 400, error: 'no audio' };
      const out = await ai.run(model, { audio: Array.from(bytes) }, gatewayOpt) as { text?: string };
      // Silence and non-speech transcribe to an empty string. That is an
      // answer, not a failure: the clip contained no words, and reporting it
      // as an error would have the caller retry and pay again.
      return { ok: true, output: String(out?.text ?? '').trim(), prompt_tokens: 0, completion_tokens: 0 };
    }
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
    // gateway/binding combinations (and AI Gateway responses) nest the same
    // payload one level deeper under `result` — Task #19 (WS0): parse those
    // nested shapes too so a valid reply is never silently dropped as empty,
    // which previously surfaced to the onboarding user as the degraded
    // "had trouble processing that" fallback even though the model answered.
    type ChatShape = {
      response?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const r = raw as ChatShape & { result?: ChatShape };
    const pickText = (s?: ChatShape): string | undefined =>
      s?.response ?? s?.choices?.[0]?.message?.content ?? undefined;
    const text = pickText(r) ?? pickText(r.result) ?? '';
    const usageObj = r.usage ?? r.result?.usage;
    const promptTok = usageObj?.prompt_tokens ?? estTokens(messages.map(m => m.content).join('\n'));
    const completionTok = usageObj?.completion_tokens ?? estTokens(text);
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

  // ---- The caller's model, if they named one -----------------------------
  // The whole security property of the model menu lives in these four lines:
  // a model that is not on this task's `alternates` list never reaches
  // `env.AI.run`, and a task with no list accepts no override at all. That is
  // why `safety` cannot be routed off llama-guard however the request is
  // shaped — not because a check rejects it, but because there is nothing to
  // check against.
  //
  // Refusing rather than falling back to the primary is deliberate. The rail
  // remembers a founder's choice in their browser; a model retired from the
  // list months later would otherwise run as something else and report
  // success, and they would read a rate on screen for a model that did not
  // run. A refusal names the problem and the rail clears the preference.
  const offered = route.alternates ?? [];
  if (opts.model && !offered.includes(opts.model)) {
    const usage: UsageMeta = {
      task: opts.task, model: route.model, latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts.userId, usage, 'model_not_offered');
    return {
      ok: false,
      refusal: 'model_not_offered',
      error: `${opts.model} is not offered for ${opts.task}`,
      usage,
    };
  }
  const primaryModel = opts.model || route.model;

  const store = kv(env);
  const caps = budgetCaps(env);

  // ---- Cache lookup ----------------------------------------------------
  // Streaming requests bypass the cache (caching a stream would require
  // buffering the entire response, defeating the latency benefit).
  if (store && route.cacheTtlSec && !opts.stream) {
    const ck = await cacheKeyFor(opts, primaryModel);
    if (ck) {
      try {
        const hit = await store.get(ck, 'json') as { output?: string; embedding?: number[] } | null;
        if (hit) {
          const usage: UsageMeta = {
            task: opts.task, model: primaryModel, latency_ms: Date.now() - startedAt,
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
        task: opts.task, model: primaryModel, latency_ms: 0,
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
        task: opts.task, model: primaryModel, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'budget_user_day');
      return { ok: false, refusal: 'budget_user_day', error: `daily cap ${caps.userDay} USD reached`, usage };
    }
    if (m >= caps.userMonth) {
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts.userId, usage, 'budget_user_month');
      return { ok: false, refusal: 'budget_user_month', error: `monthly cap ${caps.userMonth} USD reached`, usage };
    }
    if (o >= caps.orgMonth) {
      await setKillSwitch(store, 35 * 86400);
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: 0,
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

  let attempt = await callWai(primaryModel);
  let modelUsed = primaryModel;
  let fallbackUsed = false;
  let lastError = attempt.error;

  // Workers AI multi-hop fallback chain (spec: tool_call → advisor_turn →
  // role_detect, i.e. qwen32b → llama-70b → llama-8b).
  //
  // The chain skips the model that just failed. It never contained the route's
  // own primary, so this only bites once a caller can PICK one: a founder who
  // chose the 8b would otherwise have the router answer its failure by calling
  // the 8b again, wait out a second timeout, and report the same error.
  const chain = (route.fallbackChain ?? []).filter((m) => m !== primaryModel);
  if (!attempt.ok && chain.length) {
    for (const sibling of chain) {
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
  const cost = estimateCostUsd(modelUsed, promptTok, completionTok, opts.audioMinutes || 0);

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
  //
  // Keyed on `modelUsed`, not on what was ASKED for. When the primary failed
  // and a sibling answered, the text in hand is the sibling's; storing it
  // under the primary's key would hand the next caller a fallback's answer
  // labelled with the primary's name and rate. Keying it honestly also means
  // the next call to the primary misses and tries again — which is what you
  // want, because by then the primary may have recovered.
  if (store && route.cacheTtlSec && !opts.stream && attempt.stream == null) {
    const ck = await cacheKeyFor(opts, modelUsed);
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
