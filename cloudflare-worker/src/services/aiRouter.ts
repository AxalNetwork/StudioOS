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
 *   - Any failure on a Workers AI attempt → the next model in the chain.
 *     D761: each attempt's timeout is its class's (chat 8 s, reasoning and
 *     long context 30 s, images 60 s; a stream's first chunk the same); a
 *     model whose context window the input overflows is skipped uncalled;
 *     the request and response shapes, and each attempt's units, are
 *     `./ai/shapes.ts`'s.
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
import { branchOf } from '../util/branch';
import * as aiBudget from './aiBudget';
import { audioInputFor, parseAudioOutput, type SttTranscript } from './sttFormats';
import * as shapes from './ai/shapes';
import * as catalogue from './ai/catalogue';
import { costMicro, unitPrice } from './ai/pricing';
import * as guard from './ai/guard';
import { resolveRail, resolveRailChain, resolveRailOption } from './ai/railMatrix';

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
  // D691 (#1698) — Grow's feedback-theme fill, a restatement like the pain tagger.
  | 'grow_theme_feedback'
  | 'market_sizing_inputs'
  | 'competitor_scan'
  | 'research_ask'
  | 'structure_interview'
  // D685 §5.10 — StudioOS's own summary of a session, every sentence cited.
  | 'summarise_interview'
  // D765 (#2090), D720 §6: a queue job no member started (deal scoring,
  // traction review, valuation, buyer matching, LPA drafting, equity), run as
  // a system call (userId 0): logged at cost and charged to no member.
  | 'system_job'
  // D766 (#2094) — system calls that used to call env.AI.run directly: the
  // monitoring summary, and the X post image screen and alt text.
  | 'ops_summary'
  | 'image_screen'
  | 'image_alt_text'
  // D766 (#2094) PR 3 — Build › Brand's logo, which called FLUX.1 Schnell
  // directly. Now a member's press, drawn through D761's image shape.
  | 'brand_logo'
  // D764 (#2089) — the rail's fourteen kinds of work, one task each. The
  // page's row in `ai/railMatrix.json` names the models a member may pick;
  // the entries below are each kind's default and its alternates.
  | RailTask;

/** The canvas's fourteen kinds of work (D720 §1), in its order. */
export const RAIL_KINDS = [
  'chat', 'synth', 'speech', 'research', 'reason', 'vision', 'code',
  'numbers', 'write', 'match', 'plan', 'legal', 'multi', 'search',
] as const;
export type RailKind = (typeof RAIL_KINDS)[number];
export type RailTask = `rail_${RailKind}`;

export type RefusalReason =
  | 'budget_user_day'
  | 'budget_user_month'
  | 'budget_review'
  | 'budget_org_month'
  | 'kill_switch'
  | 'safety_block'
  | 'misconfigured'
  // The caller named a model this task does not offer. Distinct from
  // 'misconfigured' (an unknown TASK) because the fix is different: a stale
  // saved preference in someone's browser, not a coding error, and the caller
  // is expected to clear it and re-run on the primary.
  | 'model_not_offered'
  // D760: a model the catalogue cannot price. Refused before it runs, because
  // a run billed at zero trips no cap.
  | 'model_unpriced'
  | 'all_models_failed'
  // D763: the guard could not be reached, threw, or answered something it is
  // not allowed to answer. Nothing runs (or, on the output side, nothing the
  // model wrote is returned), and the hold is released.
  | 'guard_unavailable'
  // D763: the member's input is unsafe under the category policy.
  | 'guard_blocked'
  // D763: the model's output is unsafe; it is withheld.
  | 'guard_blocked_output'
  // D761 PR 2: the run's images, rerank or translation are malformed (too
  // many images, a URL instead of a data URI, no target language). Refused
  // before the guard, the hold or any model; nothing is charged.
  | 'invalid_input'
  // D765 (#2090): the member turned AI assistance off on the page the run was
  // asked from. Refused before the hold, with no usage row: nothing ran.
  | 'assist_off';

/**
 * D765 (#2090) — where a member's run was asked from: the rail's page (D768's
 * page key; until it lands, the rail's workspace), the option on it, and the
 * record it is about (`type:id`). `run()` writes them to the log row and
 * checks the page's switch against them.
 */
export interface RailContext {
  page: string;
  option?: string | null;
  record?: string | null;
}

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
  // The clip's content type, for a model that decodes a container itself
  // (Nova-3 takes `{ body, contentType }`). Ignored by the Whisper models.
  audioMime?: string;
  // D685 — the session's language for a transcription task, an ISO-639-1 code;
  // absent is Detect. `audioInputFor` decides which models take it.
  language?: string | null;
  // A model the CALLER picked, validated against `ROUTE[task].alternates`.
  // Absent means "whatever the route says", which is every internal caller.
  // A model not on that list is REFUSED, never quietly swapped for the
  // primary: reporting success under a model the caller did not ask for is
  // the class of lie this router exists to avoid.
  model?: string;
  // The app path the run was asked from (`/validate/customer-research`), written to
  // `ai_usage_logs.surface` (migration 319, D404) so a page can show its own
  // spend. Optional, and absent for every internal caller: NULL is "not
  // recorded". Re-validated in `recordUsage` against SURFACE_RE, so a caller
  // that forwards a request field cannot put anything else into the column.
  surface?: string;
  // D762 (#2019): the AI rail's page, option and record the run was asked
  // from, written to `ai_usage_logs.rail_page`, `rail_option` and `record_ref`
  // (migration 493). D765's run path passes them; every other caller leaves
  // them out, and NULL is "not recorded". Re-validated in `recordUsage`.
  railPage?: string;
  railOption?: string;
  recordRef?: string;
  // D761 PR 2: images for a vision model, as base64 data URIs the Worker
  // measures (`shapes.imagesRefusal`), attached to the last user message as
  // content parts. A model that does not take images is skipped uncalled.
  images?: string[];
  // D761 PR 2: a rerank (`{ query, contexts, topK? }`) for a rerank model; the
  // result carries `ranking`, best first, by each context's index.
  rerank?: shapes.RerankInput;
  // D761 PR 2: a translation of `text` for a translation model (m2m100).
  translate?: shapes.TranslateInput;
  // D761 PR 3: `text` spoken by a voice model (Aura, MeloTTS); the result
  // carries `audio`. A partner voice runs only once D760's gate offers it.
  speak?: shapes.SpeakInput;
  // D761 PR 4: an image drawn from `text` (the prompt) by an image model; the
  // result carries `image`. The size and steps are clamped to the model's range.
  draw?: shapes.DrawInput;
  // D765 (#2090): the rail context of a MEMBER's run. `run()` copies it into
  // `railPage`, `railOption` and `recordRef`, and refuses `assist_off` when the
  // member turned AI assistance off on that page. Every member call passes it
  // (rail_run_path_d765.test.ts lists them); a system call does not.
  rail?: RailContext;
  // D763 (#2020): the text the MEMBER typed or supplied for this run (typed
  // text, the page's text, an upload's text), which the guard checks in full
  // before the model is called. Absent, it is every message the run sends
  // except the system prompt (or `text`). A handler that puts rows gathered
  // from the member's own store into the prompt passes only the member's
  // words here, so those rows are not checked again; '' checks nothing.
  guardText?: string;
  // D763: 'mark' for the member's own material, such as a transcript or an
  // upload's extracted text: an unsafe output verdict is logged and the text
  // kept, and any run that later uses it is checked again on its input.
  // Default 'withhold'. A transcription run is always 'mark'.
  guardOutput?: 'withhold' | 'mark';
  // D763: the member's role, so an S11 refusal links to Wellbeing only for a
  // role that page opens for (`guard.refusalFor`).
  role?: string | null;
}

/**
 * What a recorded surface may look like: an absolute app path of letters,
 * digits, `/`, `_`, `.` and `-`, at most 160 characters. Anything else is
 * recorded as NULL rather than trimmed into something that looks valid.
 */
export const SURFACE_RE = /^\/[A-Za-z0-9/_.-]{0,159}$/;
export function normaliseSurface(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/\/+$/, '') || (value.trim() === '/' ? '/' : '');
  return SURFACE_RE.test(path) ? path : null;
}

/** A rail key as `recordUsage` writes it: letters, digits and `/_.:-`, at most 160 characters; anything else is NULL. */
const RAIL_KEY_RE = /^[A-Za-z0-9/_.:-]{1,160}$/;
function railKey(value: unknown): string | null {
  return typeof value === 'string' && RAIL_KEY_RE.test(value.trim()) ? value.trim() : null;
}
/**
 * D765: a rail PAGE may also hold spaces, `&` and `·`, because the rail's
 * workspaces ("Perks & Products") and D720's page keys ("Founder · Validate")
 * do. Option and record keys keep `RAIL_KEY_RE`.
 */
const RAIL_PAGE_RE = /^[\p{L}\p{N} &·/_.:-]{1,160}$/u;
export function railPageKey(value: unknown): string | null {
  return typeof value === 'string' && RAIL_PAGE_RE.test(value.trim()) ? value.trim() : null;
}
export function railOptionKey(value: unknown): string | null { return railKey(value); }
/** D770 (#2095): a record ref (`type:id`) keeps D762's rule too. */
export function railRecordKey(value: unknown): string | null { return railKey(value); }

/**
 * D764 PR 3 (#2089): the member's stored picks for a rail page and option
 * (migration 465, section = the page key lower-cased). A missing table or row
 * is no pick; a read that fails for another reason throws, as `assistOff` does.
 */
export async function railPicks(env: Env, userId: number, page: string, option: string | null): Promise<{ page: string | null; option: string | null }> {
  try {
    const rows = (await env.DB.prepare(
      'SELECT task, model FROM ai_rail_preferences WHERE user_id = ? AND section = ? AND task IN (?, ?)',
    ).bind(userId, page.trim().toLowerCase(), 'page', option ?? 'page').all<{ task: string; model: string | null }>()).results ?? [];
    return {
      page: rows.find((r) => r.task === 'page')?.model ?? null,
      option: option ? rows.find((r) => r.task === option)?.model ?? null : null,
    };
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return { page: null, option: null };
    throw e;
  }
}

/** D765: the refusal's words, which every route answers with 403 `assist_off`. */
export const ASSIST_OFF_MESSAGE = 'AI assistance is off on this page.';

/**
 * D765: whether the member turned AI assistance off on `page`: migration
 * 465's mode row (`task = ''`) for the page, lower-cased as the rail writes
 * it, holds 'manual'. No row is on (D720 §6). A database without the table
 * (a dev or test database before 465) has no switch to read, so it is on;
 * any other read failure throws, and `run()` refuses rather than guess.
 */
export async function assistOff(env: Env, userId: number, page: string): Promise<boolean> {
  const section = page.trim().toLowerCase();
  try {
    const row = await env.DB.prepare(
      "SELECT mode FROM ai_rail_preferences WHERE user_id = ? AND section = ? AND task = '' LIMIT 1",
    ).bind(userId, section).first<{ mode: string | null }>();
    return row?.mode === 'manual';
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return false;
    throw e;
  }
}

/**
 * D762 (#2019): what a log row records about the money beside the cost.
 * `charged` is the micro-USD the run's hold settled at: 0 when nothing was
 * charged (a refusal, a cached answer, a failed run, a run with no hold), and
 * null when it is not known yet (a run that cost more than its hold, waiting
 * for a Super Admin's decision). `units` are what the run was settled on.
 */
interface RunCharge {
  charged: number | null;
  reservationUid?: string | null;
  units?: Record<string, number> | null;
  // D763: a guard row's run, `ai_usage_logs.guard_for`.
  guardFor?: number | null;
}
const NOTHING_CHARGED: RunCharge = { charged: 0 };

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

/**
 * D761: one model the router tried. `called: false` is a model skipped for
 * its context window, which cost nothing. `units` are what the attempt used,
 * measured by the Worker (`./ai/shapes.ts`); absent when the provider gave
 * nothing to count, never zero-filled.
 */
export interface AttemptRecord {
  model: string;
  ok: boolean;
  called: boolean;
  status?: number;
  code?: number | null;
  timeout_ms?: number;
  units?: shapes.Units;
}

export interface RunResult {
  ok: boolean;
  output?: string;             // assistant text or stringified JSON for tool_call
  embedding?: number[];        // populated for task='embed'
  // D761 PR 2: a rerank's contexts, best first, by their index in the request.
  ranking?: shapes.RankedContext[];
  // D761 PR 3: a voice run's audio.
  audio?: shapes.SpeechAudio;
  // D761 PR 4: an image run's image, with the size the Worker measured.
  image?: shapes.GeneratedImage;
  stream?: ReadableStream;     // populated only when opts.stream === true
  // A speech-to-text run's passages, language and speaker labels (D657).
  transcript?: SttTranscript;
  refusal?: RefusalReason;
  error?: string;
  usage: UsageMeta;
  // D761: the answering attempt's units, and every attempt in order. A3 (D762) settles on them.
  units?: shapes.Units;
  attempts?: AttemptRecord[];
  // D763: what the guard decided. Absent on a run the guard skips.
  guard?: GuardReport;
  // D780: the `ai_usage_logs` row of a run that answered, so what it leaves in
  // `ai_rail_proposals` can name the run that wrote it. Null when it could not be written.
  usageLogId?: number | null;
}

/**
 * D763: the guard's part in one run. `input` and `output` are each side's
 * combined decision (`none` where there was no text to check, or the run never
 * got that far; `marked` is an unsafe verdict on the member's own material,
 * kept). `codes` are the S-codes behind a block, a log or a mark, for the
 * logs; `refusal` is the member's words when the run was refused, and never
 * names a code.
 */
export interface GuardReport {
  input: 'pass' | 'log' | 'block' | 'fail' | 'none';
  output: 'pass' | 'log' | 'block' | 'fail' | 'none' | 'marked';
  codes: guard.GuardCode[];
  calls: number;
  refusal?: guard.GuardRefusal;
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
  // D761: the output budget a reasoning model gets on this task when the caller
  // names a smaller one (`shapes.REASONING_MAX_TOKENS` when absent).
  reasoningMaxTokens?: number;
}

/**
 * Per-1M-token USD prices, read from the catalogue (D760), which holds
 * Cloudflare's published Workers AI pricing table.
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
 * Pinned by `cloudflare-worker/test/ai_router_prices.test.mjs`, and every
 * catalogue price by `ai_catalogue_d760.test.mjs` against what was read, so a
 * future edit has to mean it.
 */
export const PRICE_USD_PER_1M_TOKENS: Record<string, { in: number; out: number }> = tokenPriceView([
  '@cf/meta/llama-guard-3-8b',
  // Kept for callers that still name it, and for accounting on runs already
  // recorded against it. It is DEPRECATED (5/30/2026) and is no longer routed
  // to — see SMALL_LLAMA below.
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  // Offered as a workspace_explain alternate: six times cheaper to prompt and
  // shallower, which is a trade a founder may reasonably want to make on a
  // read-back. Priced here because an alternate with no row would bill as zero.
  '@cf/meta/llama-3.2-3b-instruct',
  // D658 — a structure_interview alternate: cheaper to prompt than the fp8 8B
  // and dearer to answer, the trade the SMALL_LLAMA comment below describes.
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  // D658 — the third structure_interview model. "Paid access required":
  // refused on a free plan, the fallback answers and the receipt says so. Its
  // cached input has its own rate (D760), billed in `estimateCostUsd` only
  // when the provider reports cached tokens.
  '@cf/deepseek-ai/deepseek-v4-flash-0731',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  // D760: moved from 0.05 to its neuron price, 6058 neurons: 0.066638.
  '@cf/baai/bge-base-en-v1.5',
  // D764 (#2089): the models the rail_<kind> tasks route to. Their prices are the catalogue's, as every row here.
  '@cf/zai-org/glm-4.7-flash',
  '@cf/openai/gpt-oss-120b',
  '@cf/openai/gpt-oss-20b',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/deepseek-ai/deepseek-v4-pro-0813',
  '@cf/qwen/qwq-32b',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/ibm-granite/granite-4.0-h-micro',
]);

/**
 * D760 (#2017) — the three tables above and below are VIEWS of the catalogue
 * (`services/ai/catalogue.ts`): this file names which models it prices, and
 * every figure is the catalogue's neuron price (`pricing.ts` `unitPrice`:
 * neurons × $0.011 / 1000, what Cloudflare bills), read as a number. One
 * source of prices, so the rate the rail shows, the quote the hold reserves and
 * the receipt all come from the same figure. A model the catalogue cannot
 * price fails here, at load, rather than billing as zero.
 */
function tokenPriceView(ids: string[]): Record<string, { in: number; out: number }> {
  return Object.fromEntries(ids.map((id) => {
    const pin = unitPrice(id, 'tokens_in');
    if (!pin) throw new Error(`${id} has no token price in the catalogue`);
    return [id, { in: Number(pin), out: Number(unitPrice(id, 'tokens_out') ?? '0') }];
  }));
}

function minutePriceView(ids: string[], unit: 'audio_minutes' | 'audio_minutes_websocket'): Record<string, number> {
  return Object.fromEntries(ids.map((id) => {
    const raw = unitPrice(id, unit);
    if (!raw) throw new Error(`${id} has no ${unit} price in the catalogue`);
    return [id, Number(raw)];
  }));
}

/**
 * Audio models are billed by the MINUTE, not by the token, and the table above
 * cannot express that.
 *
 * This is not a stylistic split. A model with no token row would bill as zero,
 * and `ai_router_prices.test.mjs` exists because of what that costs:
 * "a model in ROUTE with no price row bills as zero, and a spend cap that
 * counts zero never trips". Whisper has no token price anywhere, so folding it
 * into the token table would mean either a fabricated per-token rate or a
 * transcription that is free until the invoice arrives.
 */
export const PRICE_USD_PER_AUDIO_MINUTE: Record<string, number> = minutePriceView([
  '@cf/openai/whisper',
  '@cf/openai/whisper-large-v3-turbo',
  // D657 — Nova-3 over plain HTTP (batch). Its WebSocket rate is different and
  // lives in the table below.
  '@cf/deepgram/nova-3',
  // D761 PR 3 — MeloTTS is billed per minute of audio it RETURNS, measured
  // from its output bytes (`audioMinutesFromBytes`).
  '@cf/myshell-ai/melotts',
], 'audio_minutes');

/**
 * D761 PR 3 — Deepgram's Aura voices are billed per 1,000 characters of the
 * text they speak, which neither table above can express. A view of the
 * catalogue's `characters` price, as the two tables above are of theirs.
 */
export const PRICE_USD_PER_1K_CHARACTERS: Record<string, number> = Object.fromEntries([
  '@cf/deepgram/aura-1',
  '@cf/deepgram/aura-2-en',
  '@cf/deepgram/aura-2-es',
].map((id) => {
  const raw = unitPrice(id, 'characters');
  if (!raw) throw new Error(`${id} has no characters price in the catalogue`);
  return [id, Number(raw)];
}));

/**
 * D761 PR 4 — the image models, priced in the units each is billed in (tiles
 * and steps, tile-steps, tiles or megapixels), which no table above can
 * express. Their cost is the catalogue's own (`costMicro` over the run's
 * `shapes.imageUnits`); this set names which of them the router prices, and
 * fails at load if the catalogue cannot price one in its billing unit.
 */
export const IMAGE_PRICED_MODELS: ReadonlySet<string> = new Set(Object.keys(shapes.IMAGE_SPECS).map((id) => {
  for (const unit of Object.keys(shapes.imageUnits(id, 1024, 1024, 4)) as Array<'tiles' | 'steps' | 'output_tile_steps' | 'output_tiles' | 'first_megapixels' | 'subsequent_megapixels'>) {
    if (!unitPrice(id, unit)) throw new Error(`${id} has no ${unit} price in the catalogue`);
  }
  return id;
}));

/**
 * Live speech-to-text over a WebSocket is billed at its own rate, per minute
 * of audio streamed. A separate table because one model (Nova-3) has both a
 * batch and a WebSocket price, and Flux is WebSocket only.
 */
export const PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET: Record<string, number> = minutePriceView([
  '@cf/deepgram/nova-3',
  '@cf/deepgram/flux',
], 'audio_minutes_websocket');

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
// D766 — the vision model for the system's image calls (D761 PR 2's content parts).
const VISION_SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';

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
  // D657 OFFERS A CHOICE, and it is no longer a choice between equals: the
  // owner asked for one (#1470). Whisper Large v3 Turbo is the default; Nova-3
  // batch costs ten times more and returns speaker labels; the base Whisper is
  // the cheapest and plainest. Whisper Tiny EN is not offered: Cloudflare
  // publishes no price for it, and a model with no price row bills as zero.
  //
  // The fallback goes one way only, to the default. A founder who picked Nova-3
  // and hit a failure gets Turbo's words, and the session's receipt says so;
  // the chain is filtered of the model that just failed, so Turbo never retries
  // itself and a clip that fails on the default is billed once.
  transcribe: {
    provider: 'workers-ai',
    model: '@cf/openai/whisper-large-v3-turbo',
    fallbackChain: ['@cf/openai/whisper-large-v3-turbo'],
    alternates: ['@cf/openai/whisper-large-v3-turbo', '@cf/deepgram/nova-3', '@cf/openai/whisper'],
    isAudio: true,
  },
  validate_tag_pains: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    alternates: [MID_LLAMA, SMALL_LLAMA, '@cf/meta/llama-3.2-3b-instruct'],
  },
  // D691 (#1698) — places unthemed feedback into the venture's own themes. Like
  // tagging, it picks from a list the founder wrote, so the same three are offered.
  grow_theme_feedback: {
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
  // The market page's sizing INPUTS — an addressable population, an ACV
  // benchmark — each proposed with a citation or dropped. The first `sourced`
  // fill, so it is the first task in this table whose output is refused when it
  // arrives unsupported rather than merely scored.
  //
  // A SEPARATE CLASS FROM THE TWO ABOVE, for this table's stated reason:
  // `/api/ai/me/spend` groups by task and the rail quotes the caller's observed
  // average per task. A sizing run reads a project's sector and its own library;
  // folding it in with a tagging run would misreport both.
  //
  // No 3b in the alternates, and the asymmetry is the same one
  // `validate_draft_hypotheses` makes. A shallower model asked for a market
  // figure does not return a worse-written figure, it returns one whose citation
  // is likelier to be invented — and the refusal path then drops the run
  // entirely, so the cheaper model is not cheaper, it is a wasted call.
  //
  // Not cached. A sizing proposal reads the project's current sector and the
  // documents in its library, which is exactly what changes between two asks.
  market_sizing_inputs: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    alternates: [MID_LLAMA, SMALL_LLAMA],
  },
  // Naming competitors a founder has not listed, each with a citation or dropped.
  //
  // ITS OWN CLASS FOR THIS TABLE'S STATED REASON — `/api/ai/me/spend` groups by
  // task and the rail quotes the caller's observed average — and for a second one
  // that is specific to it: a sizing run reads a sector and returns numbers, and
  // this reads a sector and returns names of real companies. The failure modes
  // differ (a wrong number is a wrong number; an invented company is a
  // fabrication), so their averages should not be folded into one figure that
  // describes neither.
  //
  // Same alternates as sizing, and the same reason a 3b is absent: a shallower
  // model asked to name competitors returns ones whose citation is likelier to be
  // invented, and the refusal path then drops the run — so it is not cheaper.
  competitor_scan: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
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
  // D658 (#1471) — turn an interview session's final transcript into
  // placements for every Validate module. The 70B by default; the fp8-fast 8B
  // as the cheap choice. `usage.model` records which one actually answered,
  // and the session's receipt names it when the fallback did.
  // DeepSeek V4 Flash, on the canvas's list, is not offered until its price
  // is in the table above: an alternate with no row would bill as zero.
  structure_interview: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    // DeepSeek last: Compare's "Structure again" takes the first model that is
    // not the last run's (InterviewReview.jsx), and the 8B needs no paid plan.
    alternates: [MID_LLAMA, '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/deepseek-ai/deepseek-v4-flash-0731'],
  },
  // D685 §5.10 — the same models and prices as structuring: the summary reads
  // the same transcript the same way, and the rail offers one list for both.
  summarise_interview: {
    provider: 'workers-ai',
    model: MID_LLAMA,
    fallbackChain: [SMALL_LLAMA],
    alternates: [MID_LLAMA, '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/deepseek-ai/deepseek-v4-flash-0731'],
  },
  sentiment:    { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA], cacheTtlSec: 30 * 86400 },
  embed:        { provider: 'workers-ai', model: '@cf/baai/bge-base-en-v1.5', isEmbed: true,  cacheTtlSec: 30 * 86400 },
  // D766 (#2094) — system calls (userId 0): logged at cost, charged to no member.
  // The monitoring summary keeps the model it called directly.
  ops_summary:  { provider: 'workers-ai', model: SMALL_LLAMA },
  image_screen: { provider: 'workers-ai', model: VISION_SCOUT },
  image_alt_text: { provider: 'workers-ai', model: VISION_SCOUT },
  brand_logo:   { provider: 'workers-ai', model: '@cf/black-forest-labs/flux-1-schnell' },
  paraphrase:   { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: [SMALL_LLAMA] },
  // D765: `ai-workers/` jobs, which called the deprecated 8B directly, unlogged.
  system_job:   { provider: 'workers-ai', model: SMALL_LLAMA },
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
  // D764 (#2089) — the rail's kinds of work. Each primary is its kind's first
  // model on the canvas that a free plan can run (D720 §5's paid-only
  // demotion); `alternates` are the kind's models of the same shape, so a
  // member's pick from the row is accepted; the chain keeps only models a
  // free plan can run. A page's own models come from `ai/railMatrix.json`
  // (`rail_matrix_d764.test.ts` holds these entries to it). rail_search has
  // only Kimi K2.6 to answer with, which needs a paid plan: the canvas pairs
  // the index with no other answer model.
  rail_chat:     { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', fallbackChain: [MID_LLAMA, '@cf/openai/gpt-oss-120b'], alternates: ['@cf/zai-org/glm-4.7-flash', MID_LLAMA, '@cf/openai/gpt-oss-120b'] },
  rail_synth:    { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-120b'], alternates: [MID_LLAMA, '@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-120b'] },
  rail_speech:   { provider: 'workers-ai', model: '@cf/openai/whisper-large-v3-turbo', isAudio: true, alternates: ['@cf/openai/whisper-large-v3-turbo'] },
  rail_research: { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', alternates: ['@cf/openai/gpt-oss-120b', '@cf/moonshotai/kimi-k2.6'] },
  rail_reason:   { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', fallbackChain: ['@cf/qwen/qwq-32b'], alternates: ['@cf/openai/gpt-oss-120b', '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/qwen/qwq-32b'] },
  rail_vision:   { provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it', fallbackChain: ['@cf/meta/llama-4-scout-17b-16e-instruct'], alternates: ['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-4-scout-17b-16e-instruct'] },
  rail_code:     { provider: 'workers-ai', model: '@cf/qwen/qwen2.5-coder-32b-instruct', alternates: ['@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/moonshotai/kimi-k2.7-code'] },
  rail_numbers:  { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', fallbackChain: ['@cf/ibm-granite/granite-4.0-h-micro'], alternates: ['@cf/openai/gpt-oss-120b', '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/ibm-granite/granite-4.0-h-micro'] },
  rail_write:    { provider: 'workers-ai', model: MID_LLAMA, fallbackChain: ['@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/zai-org/glm-4.7-flash'], alternates: [MID_LLAMA, '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/zai-org/glm-4.7-flash'] },
  rail_match:    { provider: 'workers-ai', model: MID_LLAMA, alternates: [MID_LLAMA] },
  rail_plan:     { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', fallbackChain: ['@cf/openai/gpt-oss-20b', '@cf/openai/gpt-oss-120b'], alternates: ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-20b', '@cf/openai/gpt-oss-120b'] },
  rail_legal:    { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', alternates: ['@cf/openai/gpt-oss-120b', '@cf/deepseek-ai/deepseek-v4-pro-0813'] },
  rail_multi:    { provider: 'workers-ai', model: '@cf/mistralai/mistral-small-3.1-24b-instruct', alternates: ['@cf/mistralai/mistral-small-3.1-24b-instruct'] },
  rail_search:   { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', alternates: ['@cf/moonshotai/kimi-k2.6'] },
};

// D761: the latency budget is per attempt and per class (`shapes.TIMEOUT_MS`),
// read through `shapes.timeoutMs` in `run`. The old flat 8 s is the chat class.

// ---------------------------------------------------------------------------
// Budget defaults (overridable via env vars)
// ---------------------------------------------------------------------------
function budgetCaps(env: Env): { userDay: number; userMonth: number; orgMonth: number } {
  const caps = aiBudget.environmentAiCaps(env);
  return {userDay:caps.day,userMonth:caps.month,orgMonth:caps.orgMonth};
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

/**
 * D242 — THE ORG TRIP IS PER MONTH, KEYED EXACTLY AS THE SPEND IT MEASURES.
 *
 * It was one key, `ai_killswitch:org`, written for 35 days. The spend it
 * guards is counted per calendar month (`org:${monthKey()}`), so a trip on the
 * 29th kept every AI call refused for about five weeks — through most of a
 * month whose budget nobody had touched — and nothing in the product could
 * clear it sooner. Keyed by the same `monthKey()`, the trip ends with the month
 * it measured: on the 1st the readers ask for a key that has never been
 * written.
 *
 * THE OLD KEY IS INERT, NOT DELETED. Nothing reads `ai_killswitch:org` any
 * more; a copy left in KV expires on its own TTL. There is no runtime delete
 * and no runtime clear of the new key either: D203 made the operator store
 * kill-only, and a way to switch AI back on mid-month would be a second,
 * unaudited one.
 */
function orgKillSwitchKey(month: string): string {
  return `ai_killswitch:org:${month}`;
}

/**
 * The organisation-wide budget trip, read as one of three answers.
 *
 * ONE READING OF THE KEY, TWO USES. The router gates on it and HQ Platform
 * reports it (D202), and the two must agree about what "tripped" means — so
 * the truthiness rule lives here once rather than in each reader.
 */
async function killSwitchState(store: MinimalKV): Promise<'on' | 'off' | 'unreadable'> {
  try {
    const v = await store.get(orgKillSwitchKey(monthKey()));
    return v === '1' || v === 'true' ? 'on' : 'off';
  } catch { return 'unreadable'; }
}

async function killSwitchOn(store: MinimalKV): Promise<boolean> {
  // FAILS OPEN, deliberately and unchanged: a KV hiccup must not refuse every
  // AI call on the platform. A reader that REPORTS rather than gates keeps the
  // unreadable case — `aiOrgKillSwitchState` below.
  return (await killSwitchState(store)) === 'on';
}

/**
 * Whether the router is refusing AI calls platform-wide, for a reader that
 * reports it. `no_store` is a deployment with neither AI_SPEND nor TOKENS
 * bound, where the router cannot budget at all and so never trips.
 */
export async function aiOrgKillSwitchState(env: Env): Promise<'on' | 'off' | 'unreadable' | 'no_store'> {
  const store = kv(env);
  if (!store) return 'no_store';
  return killSwitchState(store);
}

// The TTL outlasts any month, so a trip written on the 1st still stands on the
// 31st; the month in the KEY, not the TTL, is what ends it.
async function setKillSwitch(store: MinimalKV, ttlSec: number): Promise<void> {
  try { await store.put(orgKillSwitchKey(monthKey()), '1', { expirationTtl: ttlSec }); } catch {}
}

// ---------------------------------------------------------------------------
// Cost helper
// ---------------------------------------------------------------------------
export function estimateCostUsd(
  model: string, promptTok: number, completionTok: number, audioMinutes = 0, cachedTok = 0, characters = 0, image: shapes.Units = {},
): number {
  // D761 PR 4: an image model is priced on its image units, at the catalogue's figure.
  if (IMAGE_PRICED_MODELS.has(model)) {
    const { tiles, steps, output_tile_steps, output_tiles, first_megapixels, subsequent_megapixels } = image;
    return costMicro(model, { tiles, steps, output_tile_steps, output_tiles, first_megapixels, subsequent_megapixels }) / 1_000_000;
  }
  // D761 PR 3: a voice priced by the character has no token rate either.
  const perK = PRICE_USD_PER_1K_CHARACTERS[model];
  if (perK != null) return (Math.max(0, characters) / 1000) * perK;
  // Audio first: a model priced by the minute has no token rate, and asking
  // the token table for one would answer 0.
  const perMinute = PRICE_USD_PER_AUDIO_MINUTE[model];
  if (perMinute != null) return Math.max(0, audioMinutes) * perMinute;
  const p = PRICE_USD_PER_1M_TOKENS[model];
  // D760: there is no zero path. `run()` refuses a model with no row before it
  // is called (`model_unpriced`), so arriving here without one is a coding
  // error, and a free run would trip no cap.
  if (!p) throw new Error(`model_unpriced: ${model}`);
  // D760: cached input at its own rate, only when the provider reported cached
  // tokens and the model prints a cached rate; otherwise every input token is
  // billed at the input rate. `promptTok` is the provider's whole input count.
  const cachedRaw = unitPrice(model, 'tokens_cached');
  const cached = cachedRaw ? Math.min(Math.max(0, cachedTok), promptTok) : 0;
  return ((promptTok - cached) / 1_000_000) * p.in
    + (cached / 1_000_000) * (cachedRaw ? Number(cachedRaw) : 0)
    + (completionTok / 1_000_000) * p.out;
}

/**
 * D760: why a run may not reach this model, or null when it may. The catalogue
 * refuses a model it cannot price (`model_unpriced`) or does not offer (a beta
 * or retired model, or a gated partner: `model_not_offered`); a model it offers
 * but neither of this file's price views holds is unpriced here too, because
 * its receipt would have nothing to be computed from.
 */
export function modelRefusal(env: Env, model: string): 'model_unpriced' | 'model_not_offered' | null {
  const refusal = catalogue.refusalFor(model, env);
  if (refusal) return refusal;
  return model in PRICE_USD_PER_1M_TOKENS || model in PRICE_USD_PER_AUDIO_MINUTE || model in PRICE_USD_PER_1K_CHARACTERS || IMAGE_PRICED_MODELS.has(model) ? null : 'model_unpriced';
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
  // D761 PR 3 and 4: a voice's audio and an image are not cached; the KV entry holds text only.
  if (!route.cacheTtlSec || opts.speak || opts.draw) return null;
  const base = opts.contentHash
    || (opts.task === 'explain' && opts.topic ? `topic:${opts.topic}` : null)
    || defaultContentBlob(opts);
  // D761 PR 2: the images, the rerank and the translation are part of what was
  // asked. Without them two runs with the same words and different images, or
  // different target languages, would share one answer.
  const extra = opts.images?.length || opts.rerank || opts.translate
    ? JSON.stringify({ images: opts.images ?? null, rerank: opts.rerank ?? null, translate: opts.translate ?? null })
    : '';
  const seed = extra ? `${base}\u0000${extra}` : base;
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
// per D1 BINDING so dev/SQLite is self-healing and a second database in the
// same isolate is not told the work is already done (#204).
//
// THE CAST IS SPELLED OUT HERE rather than taken from `util/schemaBootstrap`'s
// `bindingKey`, and that is deliberate: `aiRouter.test.mjs` loads this file by
// reading its bytes, stripping the single `import type` line and evaluating the
// rest inside `new Function`. A value import would survive that strip and throw
// `Cannot use import statement outside a module`. This module having no value
// import is a property that test depends on, so it keeps its own cast.
// ---------------------------------------------------------------------------
let LOG_SCHEMA_READY = new WeakMap<object, boolean>();
const LOG_PAGE_INDEX_493 = 'CREATE INDEX IF NOT EXISTS idx_ai_usage_user_page_created ON ai_usage_logs(user_id, rail_page, created_at)';
/** Migration 493's columns (D762), in its order. */
const LOG_COLUMNS_493: ReadonlyArray<readonly [string, string]> = [
  ['charged_microusd', 'INTEGER CHECK (charged_microusd IS NULL OR charged_microusd >= 0)'],
  ['reservation_uid', 'TEXT'], ['rail_page', 'TEXT'], ['rail_option', 'TEXT'], ['record_ref', 'TEXT'],
  ['guard_for', 'INTEGER'], ['units_json', 'TEXT'],
];
async function ensureLogSchema(env: Env): Promise<void> {
  if (LOG_SCHEMA_READY.get(env.DB as unknown as object)) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL, fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), surface TEXT, charged_microusd INTEGER CHECK (charged_microusd IS NULL OR charged_microusd >= 0), reservation_uid TEXT, rail_page TEXT, rail_option TEXT, record_ref TEXT, guard_for INTEGER, units_json TEXT)",
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_logs(user_id, created_at DESC)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_ai_usage_task_created ON ai_usage_logs(task, created_at DESC)");
    // A table from before migration 493 has no rail_page yet: its index is made when its columns are (`addLogColumns493`).
    try { await env.DB.exec(LOG_PAGE_INDEX_493); } catch { /* see addLogColumns493 */ }
    LOG_SCHEMA_READY.set(env.DB as unknown as object, true);
  } catch (e) {
    console.warn('[aiRouter] log schema:', (e as Error).message);
  }
}

/**
 * A table made before migration 493 (a dev or test database) gains its
 * columns, so a run is still logged there. Called only when an INSERT names a
 * column the table lacks; production has 493 before this Worker deploys.
 */
async function addLogColumns493(env: Env): Promise<void> {
  const cols = await env.DB.prepare('PRAGMA table_info(ai_usage_logs)').all<{ name: string }>();
  const have = new Set((cols.results ?? []).map((c) => c.name));
  for (const [name, type] of LOG_COLUMNS_493) {
    if (!have.has(name)) await env.DB.exec(`ALTER TABLE ai_usage_logs ADD COLUMN ${name} ${type}`);
  }
  await env.DB.exec(LOG_PAGE_INDEX_493);
}

type UsageWho = Pick<RunOptions, 'userId' | 'surface' | 'railPage' | 'railOption' | 'recordRef'>;
async function recordUsage(env: Env, who: UsageWho, usage: UsageMeta, refusal: RefusalReason | null, charge: RunCharge = NOTHING_CHARGED): Promise<number | null> {
  await ensureLogSchema(env);
  const charged = charge.charged == null ? null : Math.max(0, Math.round(charge.charged));
  // `surface` stays the last column bound, as it was before migration 493.
  const insert = () => env.DB.prepare(
    `INSERT INTO ai_usage_logs (user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal,
       charged_microusd, reservation_uid, rail_page, rail_option, record_ref, units_json, guard_for, surface)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    who.userId,
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
    charged,
    charge.reservationUid ?? null,
    railPageKey(who.railPage),
    railKey(who.railOption),
    railKey(who.recordRef),
    charge.units ? JSON.stringify(charge.units) : null,
    charge.guardFor ?? null,
    normaliseSurface(who.surface),
  ).run();
  // The row's id, which a guard row names in `guard_for` (D763); null when it could not be written.
  const idOf = (r: unknown): number | null => {
    const id = Number((r as { meta?: { last_row_id?: unknown } } | null)?.meta?.last_row_id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  try {
    try { return idOf(await insert()); }
    catch (e) {
      if (!/no column named|no such column/i.test((e as Error).message)) throw e;
      await addLogColumns493(env);
      return idOf(await insert());
    }
  } catch (e) {
    console.warn('[aiRouter] recordUsage:', (e as Error).message);
    return null;
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
  ranking?: shapes.RankedContext[];
  audio?: shapes.SpeechAudio;
  image?: shapes.GeneratedImage;
  stream?: ReadableStream;
  transcript?: SttTranscript;
  prompt_tokens?: number;
  completion_tokens?: number;
  error?: string;
  // D761: Workers AI's numeric error code, when the failure carried one.
  code?: number | null;
  units?: shapes.Units;
}

/** The slice of workers-types' `GatewayOptions` this router sends (D261). */
type GatewayOption = { gateway: { id: string; metadata: Record<string, string> } };

interface WorkersAIBinding {
  run(
    model: string,
    payload: unknown,
    options?: { gateway?: { id: string; skipCache?: boolean; cacheTtl?: number; metadata?: Record<string, string> }; extraHeaders?: Record<string, string> },
  ): Promise<unknown>;
}

// Task #4 (CG) — advisor tasks (`advisor_turn`, `advisor_explain`)
// route through the dedicated advisor AI Gateway slug so their
// analytics, cache and rate limits are tracked separately from the
// onboarding chatbot. Returns undefined when the env var is missing
// (call falls through to the un-gatewayed Workers AI path).
// Task #19 (WS0): `onboarding_chat` is deliberately NOT in this list — it
// must never depend on the advisor gateway, so it always runs un-gatewayed.
//
// D209 — the list and the slug are exported because HQ's topology page states
// them, and a page holding its own copy of "which calls go through the gateway"
// is a second place to update.
//
// D261 — THE OPTION NOW SAYS WHOSE CALL IT IS. It carries the gateway's custom
// metadata (at most five entries; `cf.*` is reserved): the branch the Worker is
// deployed for, or `hq`; the account as `<branch>:<user id>`, because a user id
// is only unique within one database; and the task class. So the gateway's logs
// can split this traffic by branch and by account. Only these two task classes
// carry it, because only they are gatewayed; every other call reaches Workers AI
// with no gateway and so with no metadata. `GATEWAY_METADATA_KEYS` is exported
// for the topology page, and `topology_d209.test.ts` holds the two equal.
export const GATEWAY_TASKS: readonly TaskClass[] = ['advisor_turn', 'advisor_explain'];

/** The metadata keys a gatewayed call carries, in the order it sends them (D261). */
export const GATEWAY_METADATA_KEYS = ['branch', 'account', 'task'] as const;

export function advisorGatewaySlug(env: Env): string | null {
  const slug = env.CF_AI_GATEWAY_SLUG_ADVISOR;
  return slug && slug.trim() ? slug.trim() : null;
}

function gatewayOptionFor(env: Env, task: TaskClass, userId?: number | null): GatewayOption | undefined {
  if (!GATEWAY_TASKS.includes(task)) return undefined;
  const slug = advisorGatewaySlug(env);
  if (!slug) return undefined;
  const branch = branchOf(env) ?? 'hq';
  const metadata: Record<string, string> = { branch };
  // NO ACCOUNT FROM A ZERO. `bindAi` defaults `userId` to 0 for calls that have
  // no person behind them; `hq:0` would read as an account and pool every such
  // call under it. So the key is left out rather than invented.
  if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
    metadata.account = `${branch}:${userId}`;
  }
  metadata.task = task;
  return { gateway: { id: slug, metadata } };
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
async function callWorkersAI(env: Env, model: string, opts: RunOptions, isEmbed: boolean, bypassGateway = false, limitMs: number = shapes.TIMEOUT_MS.chat): Promise<ProviderResult> {
  const ai = (env as unknown as { AI?: WorkersAIBinding }).AI;
  if (!ai || typeof ai.run !== 'function') {
    return { ok: false, status: 0, error: 'AI binding not configured' };
  }
  const gatewayOpt = bypassGateway ? undefined : gatewayOptionFor(env, opts.task, opts.userId);
  // D761: cache affinity, so a member's next turn on the same page earns cached
  // input. The member's id and the page key only, never an email or a name.
  const affinity = shapes.sessionAffinity(opts.userId, normaliseSurface(opts.surface) ?? opts.task);
  const runOpt = affinity ? { ...(gatewayOpt ?? {}), extraHeaders: { 'x-session-affinity': affinity } } : gatewayOpt;
  const facts = shapes.factsFor(model);
  try {
    if (ROUTE[opts.task]?.isAudio) {
      // `Array.from` on the bytes is what the binding expects, and it is also
      // the memory cliff: V8 holds ~8 bytes per element, so the caller's size
      // cap is what keeps a clip from approaching the 128 MB isolate limit.
      // See `MAX_RECORDING_BYTES` in `routes/founder_validate.ts`.
      const bytes = opts.audio;
      if (!bytes || !bytes.byteLength) return { ok: false, status: 400, error: 'no audio' };
      const out = await ai.run(model, audioInputFor(model, bytes, opts.audioMime || '', opts.language ?? null), runOpt);
      // Silence and non-speech transcribe to an empty string. That is an
      // answer, not a failure: the clip contained no words, and reporting it
      // as an error would have the caller retry and pay again.
      const transcript = parseAudioOutput(model, out);
      return { ok: true, output: transcript.text, transcript, prompt_tokens: 0, completion_tokens: 0, units: shapes.audioUnits(opts.audioMinutes) };
    }
    // D761 PR 2: a rerank and a translation have their models' own shapes.
    if (opts.rerank) {
      const out = await ai.run(model, shapes.rerankRequest(opts.rerank), runOpt);
      const { ranking, units } = shapes.parseRerank(out, opts.rerank);
      if (!ranking) return { ok: false, status: 502, error: 'unexpected rerank response', units };
      return { ok: true, output: '', ranking, prompt_tokens: units.tokens_in ?? 0, completion_tokens: 0, units };
    }
    // D761 PR 3: a voice. Aura is counted in the characters it speaks;
    // MeloTTS in the minutes of audio it returns, measured from the bytes.
    if (opts.speak) {
      const text = opts.text ?? '';
      const request = shapes.speakRequest(model, text, opts.speak);
      if (!request) return { ok: false, status: 400, error: `${model} has no voice "${opts.speak.voice}"` };
      const audio = await shapes.readSpeech(await ai.run(model, request, runOpt));
      if (!audio) return { ok: false, status: 502, error: 'unexpected speech response' };
      const units: shapes.Units = shapes.AURA_SPEAKERS[model]
        ? { characters: text.length }
        : { audio_minutes: audioMinutesFromBytes(audio.bytes.byteLength) };
      return { ok: true, output: '', audio, prompt_tokens: 0, completion_tokens: 0, units };
    }
    // D761 PR 4: an image, sent as JSON or as FLUX.2's multipart form, and
    // counted in its model's billing units from the size it came back at.
    if (opts.draw) {
      const req = shapes.drawRequest(model, opts.text ?? '', opts.draw);
      if (!req) return { ok: false, status: 400, error: `${model} draws no image` };
      let input: unknown = req.fields;
      if (req.wire === 'multipart') {
        const form = new FormData();
        for (const [k, v] of Object.entries(req.fields)) form.append(k, String(v));
        const body = new Response(form);
        input = { multipart: { body: body.body, contentType: body.headers.get('content-type') } };
      }
      const image = await shapes.readImage(await ai.run(model, input, runOpt), req.sent);
      if (!image) return { ok: false, status: 502, error: 'unexpected image response' };
      const units = shapes.imageUnits(model, image.width, image.height, req.sent.steps);
      return { ok: true, output: '', image, prompt_tokens: 0, completion_tokens: 0, units };
    }
    if (opts.translate) {
      const source = opts.text ?? '';
      const out = await ai.run(model, shapes.translateRequest(source, opts.translate), runOpt);
      const { text, units } = shapes.parseTranslate(out, source);
      if (text == null) return { ok: false, status: 502, error: 'unexpected translation response', units };
      return { ok: true, output: text, prompt_tokens: units.tokens_in ?? 0, completion_tokens: units.tokens_out ?? 0, units };
    }
    if (isEmbed) {
      const text = opts.text ?? defaultContentBlob(opts);
      const out = await ai.run(model, shapes.embedRequest(text), runOpt);
      const { vector, units } = shapes.parseEmbed(out, text);
      if (!vector) return { ok: false, status: 502, error: 'unexpected embed response' };
      return { ok: true, output: '', embedding: vector, prompt_tokens: units.tokens_in ?? 0, completion_tokens: 0, units };
    }
    // When the caller supplies `messages`, honor them — but still
    // inject `systemPrompt` as a leading system message unless the
    // caller already included one. Without this, /advisor/explain
    // (which always passes both systemPrompt + a single user message)
    // would silently drop ADVISOR_SYSTEM_PROMPT + persona context on
    // the Workers AI path while keeping it on the Anthropic path,
    // producing diverging guardrail behavior across providers.
    const messages = chatMessagesFor(opts);
    // D761: the shape is the model's — a reasoning model gets its task's output
    // budget and its control as its model page gives it (`./ai/shapes.ts`).
    // D761 PR 2: a vision run's images ride on the last user message as content parts.
    const images = opts.images?.length ? opts.images : null;
    const payload = shapes.chatRequest(facts, images ? shapes.withImages(messages, images) : messages, {
      maxTokens: shapes.maxTokensFor(facts, opts.maxTokens, ROUTE[opts.task]?.reasoningMaxTokens),
      temperature: opts.temperature,
      stream: opts.stream,
    });
    const raw = await ai.run(model, payload, runOpt);
    // Streaming pass-through: Workers AI returns a ReadableStream of
    // SSE-formatted chunks when stream:true is set. We forward it
    // verbatim to the caller once its first chunk arrives within the class's
    // limit (D761); cost accounting falls back to estimated prompt tokens only
    // since we don't see the completion side.
    if (opts.stream && raw && typeof (raw as ReadableStream).getReader === 'function') {
      const units = { ...shapes.streamOpenUnits(messages), ...(images ? { images_in: images.length } : {}) };
      const opened = await shapes.firstChunkWithin(raw as ReadableStream, limitMs);
      if (!opened) return { ok: false, status: 504, error: `no first chunk within ${limitMs}ms`, units };
      return { ok: true, stream: opened, prompt_tokens: units.tokens_in ?? 0, completion_tokens: 0, units };
    }
    // Workers AI chat models return { response: string } or
    // { choices: [{ message: { content } }] } depending on model. Some
    // gateway/binding combinations (and AI Gateway responses) nest the same
    // payload one level deeper under `result` — Task #19 (WS0): parse those
    // nested shapes too so a valid reply is never silently dropped as empty,
    // which previously surfaced to the onboarding user as the degraded
    // "had trouble processing that" fallback even though the model answered.
    // D761: `reasoning_content` is never the answer (`shapes.parseChat`).
    const parsed = shapes.parseChat(raw, facts, messages);
    const units = images ? { ...parsed.units, images_in: images.length } : parsed.units;
    return { ok: true, output: parsed.text, prompt_tokens: units.tokens_in ?? 0, completion_tokens: units.tokens_out ?? 0, units };
  } catch (e) {
    const f = shapes.failureOf(e);
    return { ok: false, status: f.status, code: f.code, error: (e as Error).message };
  }
}

/** D761 PR 2: what a run asks of its model, from the inputs it carries. */
function needOf(opts: RunOptions): shapes.Need {
  if (opts.rerank) return 'rerank';
  if (opts.translate) return 'translation';
  if (opts.speak) return 'voice';
  if (opts.draw) return 'image';
  if (ROUTE[opts.task]?.isEmbed) return 'embedding';
  if (opts.images?.length) return 'vision';
  return 'chat';
}

/** D761 PR 2: why a run's own inputs cannot be sent to any model, or null. Checked before any call. */
function inputRefusal(opts: RunOptions): string | null {
  const asks = [opts.rerank != null, opts.translate != null, opts.speak != null, opts.draw != null, (opts.images?.length ?? 0) > 0].filter(Boolean).length;
  if (asks > 1) return 'a run is one of: images, a rerank, a translation, a voice or a drawing';
  if ((opts.speak != null || opts.draw != null) && opts.stream) return 'a voice or image run is not streamed';
  if ((opts.speak != null || opts.draw != null) && ROUTE[opts.task]?.isAudio) return 'a voice or image run is not a transcription';
  if (opts.images?.length) return shapes.imagesRefusal(opts.images);
  if (opts.rerank) return shapes.rerankRefusal(opts.rerank);
  if (opts.translate) return shapes.translateRefusal(opts.translate, opts.text);
  if (opts.speak != null) return shapes.speakRefusal(opts.speak, opts.text);
  if (opts.draw != null) return shapes.drawRefusal(opts.draw, opts.text);
  return null;
}

/** The chat messages a run sends: the caller's, with `systemPrompt` leading unless they brought their own system message. */
function chatMessagesFor(opts: RunOptions): shapes.ChatMessage[] {
  return opts.messages?.length
    ? (
        opts.systemPrompt && !opts.messages.some((m) => m.role === 'system')
          ? [{ role: 'system' as const, content: opts.systemPrompt }, ...opts.messages]
          : opts.messages
      )
    : [
        ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
        { role: 'user' as const, content: opts.text || '' },
      ];
}

// Task #31 — non-WAI providers removed from the production worker.
// The dev/eval harness lives in `scripts/eval/` with its own fetch
// wrapper; the router itself is Workers-AI-only on the prod surface.

// Wrap a provider call in a hard latency budget. Resolves to {ok:false,status:504}
// on timeout so the caller can fall back to the smaller sibling.
function withTimeout(p: Promise<ProviderResult>, ms: number): Promise<ProviderResult> {
  return new Promise((resolve) => {
    let late = false;
    const timer = setTimeout(() => { late = true; resolve({ ok: false, status: 504, error: `timeout >${ms}ms` }); }, ms);
    p.then((r) => {
      clearTimeout(timer);
      // D761: a stream that opens after its limit was already given up on is cancelled, not leaked.
      if (late && r.stream) r.stream.cancel().catch(() => {});
      resolve(r);
    }, (e) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 500, error: (e as Error).message });
    });
  });
}

// ---------------------------------------------------------------------------
// D763 (#2020): the guard inside a run
// ---------------------------------------------------------------------------
// Llama Guard 3 8B checks a run's input and output in full, slice by slice
// (`./ai/guard.ts` holds the rules). It runs inside the run's own hold and
// settles there: it never takes a hold of its own, and each call is logged as
// a `safety` row whose `guard_for` is the run's row. A guard that cannot be
// reached, throws, or answers anything but a verdict FAILS CLOSED.
const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
// Its answer is "safe", or "unsafe" and a line of codes.
const GUARD_MAX_TOKENS = 16;
// The quote's bounds. Each slice is wrapped in Llama Guard's own template
// (the category list), which the provider counts as input; a token is at
// least one character; the quote's output allowance per call is four times
// what the call asks for, and an output token is taken as at most eight
// characters. A guard that somehow used more than the quote leaves the run
// for a Super Admin's review, like any other overrun (D640).
const GUARD_TEMPLATE_TOKENS = 1_024;
const GUARD_QUOTE_OUT_TOKENS = 4 * GUARD_MAX_TOKENS;
const GUARD_CHARS_PER_OUTPUT_TOKEN = 8;
// A transcript's length bound, for the quote of a transcription's output check.
const TRANSCRIPT_CHARS_PER_MINUTE = 2_000;
// How many slices are checked at once.
const GUARD_CONCURRENCY = 4;
// The user turn an output slice is checked under, so Llama Guard reads the
// slice as the agent's reply.
const GUARD_OUTPUT_TURN = 'Answer the member.';

/** Whether the guard checks this run. It skips its own run, and system embeddings. */
function guarded(opts: RunOptions): boolean {
  if (opts.task === 'safety') return false;
  return !(opts.userId <= 0 && opts.task === 'embed');
}

/** The input the guard checks: the caller's `guardText`, else every message the run sends but the system prompt. */
function guardInputFor(opts: RunOptions): string {
  if (opts.guardText != null) return String(opts.guardText);
  if (ROUTE[opts.task]?.isAudio) return '';
  // D761 PR 2: a rerank's query and every context it sends.
  if (opts.rerank) return [opts.rerank.query, ...(opts.rerank.contexts ?? [])].join('\n\n');
  if (opts.messages?.length) return opts.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
  return opts.text ?? '';
}

/** One guard call, as the run records it. `micro` is what it charges, 0 when it did not complete. */
interface GuardCall { usage: UsageMeta; decision: guard.GuardDecision; micro: number }

async function guardSlice(env: Env, opts: RunOptions, slice: string, side: 'input' | 'output'): Promise<GuardCall> {
  const startedAt = Date.now();
  const messages: shapes.ChatMessage[] = side === 'input'
    ? [{ role: 'user', content: slice }]
    : [{ role: 'user', content: GUARD_OUTPUT_TURN }, { role: 'assistant', content: slice }];
  const ms = shapes.TIMEOUT_MS.chat;
  const r = await withTimeout(callWorkersAI(env, GUARD_MODEL, {
    task: 'safety', userId: opts.userId, surface: opts.surface, messages, maxTokens: GUARD_MAX_TOKENS, temperature: 0,
  }, false, false, ms), ms);
  const verdict = r.ok ? guard.parseVerdict(r.output) : { verdict: 'unreadable' as const };
  const prompt = r.ok ? r.prompt_tokens || 0 : 0;
  const completion = r.ok ? r.completion_tokens || 0 : 0;
  const cost = r.ok ? estimateCostUsd(GUARD_MODEL, prompt, completion) : 0;
  return {
    usage: {
      task: 'safety', model: GUARD_MODEL, latency_ms: Date.now() - startedAt,
      prompt_tokens: prompt, completion_tokens: completion, est_cost_usd: cost,
      fallback_used: false, cached: false,
      safety_score: verdict.verdict === 'safe' ? 1 : verdict.verdict === 'unsafe' ? 0 : null,
    },
    // A call that did not complete is the guard failing, never a pass.
    decision: r.ok ? guard.decide(verdict) : { action: 'fail' },
    micro: r.ok ? aiBudget.usdToMicro(cost) : 0,
  };
}

/**
 * Check one text in full, `GUARD_CONCURRENCY` slices at a time, and stop at
 * the first batch that blocks or fails. Every call is pushed onto `calls`.
 */
async function guardCheck(env: Env, opts: RunOptions, text: string, side: 'input' | 'output', calls: GuardCall[]): Promise<guard.GuardDecision> {
  const slices = guard.sliceForGuard(text);
  const decisions: guard.GuardDecision[] = [];
  for (let i = 0; i < slices.length; i += GUARD_CONCURRENCY) {
    const batch = await Promise.all(slices.slice(i, i + GUARD_CONCURRENCY).map((s) => guardSlice(env, opts, s, side)));
    calls.push(...batch);
    decisions.push(...batch.map((b) => b.decision));
    const so = guard.combine(decisions);
    if (so.action === 'fail' || so.action === 'block') return so;
  }
  return guard.combine(decisions);
}

/** The most slices `sliceForGuard` cuts from `chars` characters: two consecutive slices always cover a full window. */
function guardSliceBound(chars: number): number {
  return chars > 0 ? 2 * Math.ceil(chars / guard.GUARD_SLICE_CHARS) + 1 : 0;
}

/**
 * The guard's share of a run's quote, in micro-USD: every input slice, and
 * every output slice the run's maximum output allows, at the guard's rate
 * (D762's: cost while `AI_BILLING` is unset). One micro-USD per call covers
 * each call's own rounding up.
 */
export function guardQuoteMicro(inputText: string, maxOutputChars: number): number {
  const inputSlices = guard.sliceForGuard(inputText);
  const outputSlices = guardSliceBound(maxOutputChars);
  const calls = inputSlices.length + outputSlices;
  if (!calls) return 0;
  const tokensIn = inputText.length + maxOutputChars + calls * GUARD_TEMPLATE_TOKENS;
  return aiBudget.usdToMicro(estimateCostUsd(GUARD_MODEL, tokensIn, calls * GUARD_QUOTE_OUT_TOKENS)) + calls;
}

/** The guard rows, written after the run's own row so each names it in `guard_for`. */
async function recordGuardCalls(env: Env, opts: RunOptions, calls: GuardCall[], runRowId: number | null, reservationUid: string | null): Promise<void> {
  for (const call of calls) {
    await recordUsage(env, opts, call.usage, null, {
      charged: reservationUid ? call.micro : 0, reservationUid, guardFor: runRowId,
      units: { tokens_in: call.usage.prompt_tokens, tokens_out: call.usage.completion_tokens },
    });
  }
}

/** The report a run returns, and the member's words when it was refused. */
function guardReport(
  input: GuardReport['input'], output: GuardReport['output'], decisions: guard.GuardDecision[], calls: number,
  refused?: { where: 'input' | 'output' | 'unavailable'; role: string | null | undefined },
): GuardReport {
  const codes = [...new Set(decisions.flatMap((d) => ('codes' in d ? d.codes : [])))];
  return {
    input, output, codes, calls,
    ...(refused ? { refusal: guard.refusalFor(refused.where, codes, refused.role) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public: run()
// ---------------------------------------------------------------------------
/**
 * The D640 budget's own words for a refusal. One function, so a run refused
 * here, a live stream refused mid-way and a session's transcription refused up
 * front all say the same thing (D657).
 */
export function budgetRefusalMessage(refusal: string): string {
  return refusal === 'budget_review'
    ? 'An AI run is held for review. New runs can start after it is settled.'
    : 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.';
}

export async function run(env: Env, input: RunOptions): Promise<RunResult> {
  // D765: a member's rail context is what the log row records.
  const opts: RunOptions = input.rail
    ? { ...input, railPage: input.rail.page, railOption: input.rail.option ?? undefined, recordRef: input.rail.record ?? undefined }
    : input;
  const route = ROUTE[opts.task];
  const startedAt = Date.now();

  if (!route) {
    const usage: UsageMeta = {
      task: opts.task, model: 'unknown', latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts, usage, 'misconfigured');
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
  // ---- The page's switch (D765, D720 §6) -------------------------------
  // Before the cache, the hold and the guard, and with no usage row: nothing
  // ran and nothing is held or charged. Transcribing a member's own recording
  // is saving ("Your work saves as usual"), so the switch never refuses it.
  if (opts.rail && !route.isAudio) {
    let off: boolean;
    try { off = await assistOff(env, opts.userId, opts.rail.page); }
    catch {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      return { ok: false, refusal: 'misconfigured', error: 'Unreadable: whether AI assistance is on for this page could not be checked. Nothing was run.', usage };
    }
    if (off) {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      return { ok: false, refusal: 'assist_off', error: ASSIST_OFF_MESSAGE, usage };
    }
  }

  // ---- D764 PR 3: a rail run's models come from its page's row ------------
  // A text run (or a vision run) with rail context whose page, or option, has
  // a matrix row: the caller's model when it can do the work, else the
  // member's pick, else the row's default; the chain is the row's other models
  // of the same shape (`resolveRailChain`). Audio, embeddings, rerank,
  // translation, voice and images keep their route: their shapes are the
  // task's, and only bge-base writes axal-search. A row with no model for the
  // run leaves the route in charge too.
  let railed: { primary: string; chain: string[] } | null = null;
  const railShaped = !route.isAudio && !route.isEmbed && !opts.rerank && !opts.translate && !opts.speak && !opts.draw;
  const railRow = opts.rail && railShaped
    ? resolveRailOption(opts.rail.page, opts.rail.option ?? null) ?? resolveRail(opts.rail.page)
    : null;
  if (opts.rail && railRow) {
    let picks: { page: string | null; option: string | null };
    try { picks = await railPicks(env, opts.userId, railRow.pageKey, opts.rail.option ?? null); }
    catch {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      return { ok: false, refusal: 'misconfigured', error: 'Unreadable: your model picks for this page could not be read. Nothing was run.', usage };
    }
    const resolved = resolveRailChain(railRow, { vision: (opts.images?.length ?? 0) > 0 }, env as catalogue.CatalogueSwitches, {
      caller: opts.model ?? null, option: picks.option, page: picks.page,
    });
    if (resolved && !resolved.ok) {
      const usage: UsageMeta = {
        task: opts.task, model: route.model, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts, usage, 'model_not_offered');
      return { ok: false, refusal: 'model_not_offered', error: `${resolved.model} cannot do this page's work`, usage };
    }
    if (resolved) railed = { primary: resolved.primary, chain: resolved.chain };
  }

  const offered = route.alternates ?? [];
  if (!railed && opts.model && !offered.includes(opts.model)) {
    const usage: UsageMeta = {
      task: opts.task, model: route.model, latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts, usage, 'model_not_offered');
    return {
      ok: false,
      refusal: 'model_not_offered',
      error: `${opts.model} is not offered for ${opts.task}`,
      usage,
    };
  }
  const primaryModel = railed ? railed.primary : opts.model || route.model;
  // The models a failure falls back to: the rail row's, or the route's.
  const fallbacks = railed ? railed.chain : route.fallbackChain ?? [];

  // D761 PR 2: a run whose own inputs no model could take is refused here.
  const badInput = inputRefusal(opts);
  if (badInput) {
    const usage: UsageMeta = {
      task: opts.task, model: primaryModel, latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts, usage, 'invalid_input');
    return { ok: false, refusal: 'invalid_input', error: badInput, usage };
  }

  // ---- D760: every model this run can reach is priced and offered ----------
  // Checked before the cache, the budget and the call, for the primary and each
  // fallback: a fallback that answered at no price would be the free run this
  // guards against, only later.
  for (const model of [primaryModel, ...fallbacks]) {
    const refusal = modelRefusal(env, model);
    if (!refusal) continue;
    const usage: UsageMeta = {
      task: opts.task, model, latency_ms: 0,
      prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
      fallback_used: false, cached: false, safety_score: null,
    };
    await recordUsage(env, opts, usage, refusal);
    return { ok: false, refusal, error: `${model} ${refusal === 'model_unpriced' ? 'has no price' : 'is not offered'}`, usage };
  }

  const store = kv(env);
  const caps = budgetCaps(env);
  // D763: whether the guard checks this run, and the input it checks.
  const guardOn = guarded(opts);
  const guardInput = guardOn ? guardInputFor(opts) : '';

  // ---- Cache lookup ----------------------------------------------------
  // Streaming requests bypass the cache (caching a stream would require
  // buffering the entire response, defeating the latency benefit).
  //
  // D763: a guarded run looks in the cache only after its input has passed
  // the guard (below), so a cached answer never skips the input check. What
  // the cache holds was checked on its output before it was written.
  const cacheHit = async (): Promise<{ output?: string; embedding?: number[]; ranking?: shapes.RankedContext[] } | null> => {
    if (!store || !route.cacheTtlSec || opts.stream) return null;
    const ck = await cacheKeyFor(opts, primaryModel);
    if (!ck) return null;
    try { return await store.get(ck, 'json') as { output?: string; embedding?: number[]; ranking?: shapes.RankedContext[] } | null; }
    catch { return null; /* fall through to fresh call */ }
  };
  const cachedUsage = (): UsageMeta => ({
    task: opts.task, model: primaryModel, latency_ms: Date.now() - startedAt,
    prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
    fallback_used: false, cached: true, safety_score: null,
  });
  if (!guardOn) {
    const hit = await cacheHit();
    if (hit) {
      const usage = cachedUsage();
      await recordUsage(env, opts, usage, null);
      return {
        ok: true,
        output: hit.output ?? '',
        embedding: hit.embedding,
        ...(hit.ranking ? { ranking: hit.ranking } : {}),
        usage,
      };
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
      await recordUsage(env, opts, usage, 'kill_switch');
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
    if (opts.userId <= 0 && d >= caps.userDay) {
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts, usage, 'budget_user_day');
      return { ok: false, refusal: 'budget_user_day', error: `daily cap ${caps.userDay} USD reached`, usage };
    }
    if (opts.userId <= 0 && m >= caps.userMonth) {
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts, usage, 'budget_user_month');
      return { ok: false, refusal: 'budget_user_month', error: `monthly cap ${caps.userMonth} USD reached`, usage };
    }
    if (o >= caps.orgMonth) {
      await setKillSwitch(store, 35 * 86400);
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: 0,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      await recordUsage(env, opts, usage, 'budget_org_month');
      return { ok: false, refusal: 'budget_org_month', error: `org cap ${caps.orgMonth} USD reached`, usage };
    }
  }

  let reservation: {uid:string;userId:number} | undefined;
  if (opts.userId > 0) {
    try {
      // UTF-8 bytes bound input tokenization; include chat/system overhead.
      // Reserve the most expensive offered fallback, refund to the actual logged estimate.
      const inputBytes = new TextEncoder().encode(defaultContentBlob(opts)+(opts.systemPrompt || '')).byteLength;
      const promptBound = inputBytes + 4096 + (opts.messages?.length || 1) * 64;
      // D761: a reasoning model's output budget is its task's, not 512.
      const outputBound = Math.max(...[primaryModel, ...fallbacks]
        .map((m) => shapes.maxTokensFor(shapes.factsFor(m), opts.maxTokens, route.reasoningMaxTokens)));
      if (!Number.isSafeInteger(outputBound) || outputBound < 1 || !Number.isFinite(opts.audioMinutes || 0) || (opts.audioMinutes || 0)<0) throw new Error('AI estimate unreadable');
      const models = [primaryModel, ...fallbacks];
      // D761 PR 3: a voice is held for its text's characters (Aura) and for the
      // most audio `readSpeech` accepts (MeloTTS), which bounds what it returns.
      const quoteMinutes = opts.speak ? audioMinutesFromBytes(shapes.MAX_SPEECH_BYTES) : opts.audioMinutes || 0;
      const quoteChars = opts.speak ? (opts.text ?? '').length : 0;
      // D761 PR 4: an image is held for the size and steps sent to each model.
      const quoteImage = (model: string): shapes.Units => {
        const req = opts.draw ? shapes.drawRequest(model, opts.text ?? '', opts.draw) : null;
        return req ? shapes.imageUnits(model, req.sent.width, req.sent.height, req.sent.steps) : {};
      };
      const quote = Math.max(...models.map(model=>estimateCostUsd(model,promptBound,outputBound,quoteMinutes,0,quoteChars,quoteImage(model))));
      // D763: the guard is held inside this hold, never in one of its own: every
      // input slice, and every output slice the run's maximum output allows.
      const outputChars = !guardOn || route.isEmbed || opts.speak || opts.draw ? 0
        : route.isAudio ? Math.ceil((opts.audioMinutes || 0) * TRANSCRIPT_CHARS_PER_MINUTE)
          : outputBound * GUARD_CHARS_PER_OUTPUT_TOKEN;
      const guardQuote = guardOn ? guardQuoteMicro(guardInput, outputChars) : 0;
      const held = await aiBudget.reserveAiBudget(env,opts.userId,aiBudget.usdToMicro(quote) + guardQuote);
      if (!held.ok) {
        const usage:UsageMeta={task:opts.task,model:primaryModel,latency_ms:0,prompt_tokens:0,completion_tokens:0,est_cost_usd:0,fallback_used:false,cached:false,safety_score:null};
        await recordUsage(env, opts, usage, held.refusal);
        return {ok:false,refusal:held.refusal,error:budgetRefusalMessage(held.refusal),usage};
      }
      reservation = held.reservation;
    } catch {
      const usage:UsageMeta={task:opts.task,model:primaryModel,latency_ms:0,prompt_tokens:0,completion_tokens:0,est_cost_usd:0,fallback_used:false,cached:false,safety_score:null};
      await recordUsage(env, opts, usage, 'misconfigured');
      return {ok:false,refusal:'misconfigured',error:'Unreadable: your AI allowance and top-up balance could not be checked.',usage};
    }
  }

  // ---- Settlement -----------------------------------------------------
  // D763: every guard call that completed is charged under this run's hold,
  // whatever the run's outcome; the guard rows are written after the run's own
  // row, so each names it in `guard_for`.
  const guardCalls: GuardCall[] = [];
  const guardDecisions: guard.GuardDecision[] = [];
  const guardMicro = () => guardCalls.reduce((s, c) => s + c.micro, 0);
  const guardUsd = () => guardCalls.reduce((s, c) => s + c.usage.est_cost_usd, 0);
  /**
   * Settle the hold at `micro` and bump the KV spend buckets by `usd`. The hold
   * and the buckets are both on cost while billing is (D762 §2). A hold that
   * charged nothing for a run that did not answer is released as a refund.
   * False when the settlement could not be written.
   */
  const settleHold = async (micro: number, usd: number, answered: boolean): Promise<boolean> => {
    if (reservation) {
      try { await aiBudget.settleAiReservation(env, reservation, micro, !answered && micro === 0); }
      catch { return false; }
    }
    // ---- Bump KV spend buckets ------------------------------------------
    // Post-bump: if the org monthly bucket just crossed the hard cap, flip
    // the kill switch in the same code path so the overshoot window is at
    // most one in-flight request per concurrent caller. The pre-check at
    // the top of the next call will then refuse before invoking any model.
    if (store && usd > 0) {
      const dayKey    = `user:${opts.userId}:${todayKey()}`;
      const monthKey_ = `user:${opts.userId}:${monthKey()}`;
      const orgKey    = `org:${monthKey()}`;
      const [, , orgTotal] = await Promise.all([
        bumpSpend(store, dayKey,    usd, 2 * 86400),
        bumpSpend(store, monthKey_, usd, 35 * 86400),
        bumpSpend(store, orgKey,    usd, 35 * 86400),
      ]);
      if (orgTotal >= caps.orgMonth) {
        await setKillSwitch(store, 35 * 86400);
      }
    }
    return true;
  };
  const writeGuardRows = (runRowId: number | null) => recordGuardCalls(env, opts, guardCalls, runRowId, reservation?.uid ?? null);

  // ---- D763: the input check ------------------------------------------
  // After the hold, so a budget refusal is answered before `guard_unavailable`
  // can be; before the model, so an unsafe or unchecked input runs nothing.
  let inputAction: GuardReport['input'] = 'none';
  if (guardOn && guardInput) {
    const decided = await guardCheck(env, opts, guardInput, 'input', guardCalls);
    guardDecisions.push(decided);
    inputAction = decided.action;
    if (decided.action === 'fail' || decided.action === 'block') {
      const refusal: RefusalReason = decided.action === 'fail' ? 'guard_unavailable' : 'guard_blocked';
      const report = guardReport(inputAction, 'none', guardDecisions, guardCalls.length,
        { where: decided.action === 'fail' ? 'unavailable' : 'input', role: opts.role });
      const usage: UsageMeta = {
        task: opts.task, model: primaryModel, latency_ms: Date.now() - startedAt,
        prompt_tokens: 0, completion_tokens: 0, est_cost_usd: 0,
        fallback_used: false, cached: false, safety_score: null,
      };
      const settled = await settleHold(guardMicro(), guardUsd(), false);
      const id = await recordUsage(env, opts, usage, settled ? refusal : 'misconfigured',
        { charged: settled ? 0 : null, reservationUid: reservation?.uid ?? null });
      await writeGuardRows(id);
      if (!settled) return { ok: false, refusal: 'misconfigured', error: 'Unreadable: the AI allowance and top-up draw could not be recorded.', usage, guard: report };
      return { ok: false, refusal, error: report.refusal?.message, usage, guard: report };
    }
  }
  if (guardOn) {
    const hit = await cacheHit();
    if (hit) {
      const usage = cachedUsage();
      const settled = await settleHold(guardMicro(), guardUsd(), true);
      const id = await recordUsage(env, opts, usage, settled ? null : 'misconfigured',
        { charged: settled ? 0 : null, reservationUid: reservation?.uid ?? null });
      await writeGuardRows(id);
      const report = guardReport(inputAction, 'none', guardDecisions, guardCalls.length);
      if (!settled) return { ok: false, refusal: 'misconfigured', error: 'Unreadable: the AI allowance and top-up draw could not be recorded.', usage, guard: report };
      return { ok: true, output: hit.output ?? '', embedding: hit.embedding, ...(hit.ranking ? { ranking: hit.ranking } : {}), usage, guard: report, usageLogId: id };
    }
  }

  // ---- Primary call + fallback chain ----------------------------------
  // D761: each attempt's limit is its class's (`shapes.timeoutMs`: chat 8 s,
  // reasoning and long context 30 s, images 60 s). A streamed run gets the
  // same limit for the handshake and its first chunk; the body after that
  // may legitimately run longer, so it is not timed.
  const gatewayRouted = isGatewayRouted(env, opts.task);
  const inputTokens = route.isAudio ? 0
    : opts.rerank ? estTokens([opts.rerank.query, ...opts.rerank.contexts].join('\n'))
    : estTokens(route.isEmbed || opts.translate ? (opts.text ?? defaultContentBlob(opts)) : chatMessagesFor(opts).map((m) => m.content).join('\n'));
  // D761 PR 2: what this run asks of a model (chat, vision, rerank, embedding, translation).
  const need = needOf(opts);
  const limitFor = (model: string): number => shapes.timeoutMs(shapes.factsFor(model), inputTokens);
  const callWaiRaw = (model: string, bypassGateway: boolean): Promise<ProviderResult> => {
    const ms = limitFor(model);
    return withTimeout(callWorkersAI(env, model, opts, !!route.isEmbed, bypassGateway, ms), ms);
  };
  // Task #50 — gateway-resilient call. For gateway-routed advisor tasks we
  // first hit the gatewayed path (keeps advisor analytics/cache/RL). If that
  // fails — which a broken/misconfigured `advisor-ongoing` gateway would
  // cause for EVERY model in the chain — we retry the SAME model un-gatewayed
  // before declaring the model dead. So a single shared-gateway outage can no
  // longer take onboarding down. Non-gateway tasks are unaffected (the first
  // call is already un-gatewayed, so no extra call is made).
  const attempts: AttemptRecord[] = [];
  const record = (model: string, r: ProviderResult, called = true): ProviderResult => {
    attempts.push({
      model, ok: r.ok, called,
      ...(r.ok ? {} : { status: r.status, code: r.code ?? null }),
      ...(called ? { timeout_ms: limitFor(model) } : {}),
      ...(r.units ? { units: r.units } : {}),
    });
    return r;
  };
  const callWai = async (model: string): Promise<ProviderResult> => {
    // D761: an input the model's context window cannot hold skips the model
    // without calling it. An unknown window always fits.
    const facts = shapes.factsFor(model);
    // D761 PR 2: a model that cannot serve what the run asks (a text-only model
    // handed images, a chat model handed a rerank) is skipped without a call.
    if (!route.isAudio && !shapes.canServe(facts, need)) {
      return record(model, { ok: false, status: 422, error: `${model} cannot serve a ${need} run` }, false);
    }
    if (!route.isAudio && !shapes.fitsContext(facts, inputTokens, shapes.maxTokensFor(facts, opts.maxTokens, route.reasoningMaxTokens))) {
      return record(model, { ok: false, status: 413, error: `input does not fit ${model}'s context window` }, false);
    }
    return record(model, await callWaiCalled(model));
  };
  const callWaiCalled = async (model: string): Promise<ProviderResult> => {
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
  // D761: every failure moves down the chain, a paid-only model's 429, or 403
  // with code 5035, included (#1874 §7): the plan the account is on cannot run
  // it, and a sibling may well answer.
  //
  // The chain skips the model that just failed. It never contained the route's
  // own primary, so this only bites once a caller can PICK one: a founder who
  // chose the 8b would otherwise have the router answer its failure by calling
  // the 8b again, wait out a second timeout, and report the same error.
  const chain = fallbacks.filter((m) => m !== primaryModel);
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

  const audioMinutes = opts.audioMinutes || 0;
  // D761 PR 3: a voice's minutes and characters are the answering attempt's, as the Worker measured them.
  const usageFor = (promptTok: number, completionTok: number, safetyScore: number | null): UsageMeta => ({
    task: opts.task,
    model: modelUsed,
    latency_ms: Date.now() - startedAt,
    prompt_tokens: promptTok,
    completion_tokens: completionTok,
    est_cost_usd: estimateCostUsd(modelUsed, promptTok, completionTok, audioMinutes || attempt.units?.audio_minutes || 0, attempt.units?.tokens_cached ?? 0, attempt.units?.characters ?? 0, attempt.units ?? {}),
    fallback_used: fallbackUsed,
    cached: false,
    safety_score: safetyScore,
  });
  // D762: the units a run is settled on, as the log row records them: the
  // answering attempt's D761 `units` (cached input among them), with the token
  // counts the run was settled on, which for a stream are the ones read when
  // it ended. Every figure is the Worker's.
  const unitsFor = (u: UsageMeta): Record<string, number> => ({
    ...(attempt.units ?? {}),
    tokens_in: u.prompt_tokens, tokens_out: u.completion_tokens, ...(audioMinutes > 0 ? { audio_minutes: audioMinutes } : {}),
  });
  /**
   * Settle the hold at the run's cost and the guard's (D763), and bump the KV
   * spend buckets. Returns what the run's own row records (the model's share;
   * each guard row records its own), or null when the settlement could not be
   * written.
   */
  const settle = async (u: UsageMeta, ok: boolean): Promise<RunCharge | null> => {
    const charged = ok ? aiBudget.usdToMicro(u.est_cost_usd) : 0;
    if (!await settleHold(charged + guardMicro(), (ok ? u.est_cost_usd : 0) + guardUsd(), ok)) return null;
    // A run with no hold (a system run) charged nobody.
    return { charged: reservation ? charged : 0, reservationUid: reservation?.uid ?? null, units: unitsFor(u) };
  };
  // Settlement failed: a run that cost more than its hold now waits for a
  // Super Admin's decision, so what it charged is not known yet.
  const unsettled = (u: UsageMeta): RunCharge => ({ charged: null, reservationUid: reservation?.uid ?? null, units: unitsFor(u) });
  // D763: an unsafe verdict on the member's own material marks it and is
  // logged, and the text is kept; so is a guard that could not read it.
  const marksOutput = opts.guardOutput === 'mark' || !!route.isAudio;

  // ---- A streamed run settles when its stream ends ----------------------
  // D762 §3: on the provider's final usage where the last chunk carries it,
  // and otherwise on the output the Worker counted as it passed through.
  // Never on 0 output tokens. A reader who stops early is settled on what
  // they were sent.
  if (attempt.ok && attempt.stream) {
    const promptEstimate = attempt.prompt_tokens || 0;
    if (!guardOn) {
      const metered = meterStream(attempt.stream, async (counted) => {
        const u = usageFor(counted.prompt_tokens ?? promptEstimate, counted.completion_tokens, null);
        const charge = await settle(u, true);
        if (!charge) await recordUsage(env, opts, u, 'misconfigured', unsettled(u));
        else await recordUsage(env, opts, u, null, charge);
      });
      return { ok: true, stream: metered, usage: usageFor(promptEstimate, 0, null), units: attempt.units, attempts };
    }
    // D763: the Worker releases the text one checked slice at a time, so no
    // unchecked text reaches the reader and "withheld" is true. The model's
    // whole output is metered, released or not: the model ran.
    let counted: MeteredUsage = { completion_tokens: 0, source: 'counted' };
    const metered = meterStream(attempt.stream, async (c) => { counted = c; });
    const released = releaseChecked(metered, async (slice) => {
      const decided = await guardCheck(env, opts, slice, 'output', guardCalls);
      guardDecisions.push(decided);
      if (marksOutput && decided.action === 'block') return { action: 'log', codes: decided.codes };
      return marksOutput && decided.action === 'fail' ? { action: 'pass' } : decided;
    }, async (end) => {
      const u = usageFor(counted.prompt_tokens ?? promptEstimate, counted.completion_tokens, null);
      const charge = await settle(u, true);
      const refusal: RefusalReason | null = end === 'block' ? 'guard_blocked_output' : end === 'fail' ? 'guard_unavailable' : null;
      const id = !charge ? await recordUsage(env, opts, u, 'misconfigured', unsettled(u)) : await recordUsage(env, opts, u, refusal, charge);
      await writeGuardRows(id);
    }, (end) => guard.refusalFor(end === 'block' ? 'output' : 'unavailable',
      [...new Set(guardDecisions.flatMap((d) => ('codes' in d ? d.codes : [])))], opts.role));
    return {
      ok: true, stream: released, usage: usageFor(promptEstimate, 0, null), units: attempt.units, attempts,
      guard: guardReport(inputAction, 'none', guardDecisions, guardCalls.length),
    };
  }

  const promptTok = attempt.prompt_tokens || 0;
  const completionTok = attempt.completion_tokens || 0;

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

  // ---- D763: the output check -----------------------------------------
  // Every text output, in full, before it is returned or stored. An embedding
  // has no text to check; an image run's text output is checked, and its image
  // is not (D763.md: a text guard cannot read an image).
  let outputAction: GuardReport['output'] = 'none';
  if (guardOn && attempt.ok && !route.isEmbed && attempt.output) {
    const decided = await guardCheck(env, opts, attempt.output, 'output', guardCalls);
    guardDecisions.push(decided);
    outputAction = marksOutput && decided.action === 'block' ? 'marked' : decided.action;
  }
  const withheld = outputAction === 'block' || (outputAction === 'fail' && !marksOutput);

  const usage = usageFor(promptTok, completionTok, safetyScore);

  const charge = await settle(usage, attempt.ok);
  const report = guardOn
    ? guardReport(inputAction, outputAction, guardDecisions, guardCalls.length,
      withheld ? { where: outputAction === 'block' ? 'output' : 'unavailable', role: opts.role } : undefined)
    : undefined;
  if (!charge) {
    await writeGuardRows(await recordUsage(env, opts, usage, 'misconfigured', unsettled(usage)));
    return {ok:false,refusal:'misconfigured',error:'Unreadable: the AI allowance and top-up draw could not be recorded.',usage, ...(report ? { guard: report } : {})};
  }

  if (!attempt.ok) {
    await writeGuardRows(await recordUsage(env, opts, usage, 'all_models_failed', charge));
    return { ok: false, refusal: 'all_models_failed', error: lastError || 'provider failed', usage, attempts, ...(report ? { guard: report } : {}) };
  }

  // D763: the output is withheld. The guard and the model both ran, and both are charged.
  if (withheld) {
    const refusal: RefusalReason = outputAction === 'block' ? 'guard_blocked_output' : 'guard_unavailable';
    await writeGuardRows(await recordUsage(env, opts, usage, refusal, charge));
    return { ok: false, refusal, error: report?.refusal?.message, usage, units: attempt.units, attempts, guard: report };
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
          JSON.stringify({ output: attempt.output, embedding: attempt.embedding, ...(attempt.ranking ? { ranking: attempt.ranking } : {}) }),
          { expirationTtl: route.cacheTtlSec },
        );
      } catch { /* cache best-effort */ }
    }
  }

  const usageLogId = await recordUsage(env, opts, usage, null, charge);
  await writeGuardRows(usageLogId);

  return {
    ok: true,
    usageLogId,
    output: attempt.output,
    embedding: attempt.embedding,
    ...(attempt.ranking ? { ranking: attempt.ranking } : {}),
    ...(attempt.audio ? { audio: attempt.audio } : {}),
    ...(attempt.image ? { image: attempt.image } : {}),
    stream: attempt.stream,
    transcript: attempt.transcript,
    usage,
    units: attempt.units,
    attempts,
    ...(report ? { guard: report } : {}),
  };
}

/** What a streamed run used, as `meterStream` read it off the stream. */
export interface MeteredUsage {
  // The provider's own count where its last chunk carried one; absent otherwise.
  prompt_tokens?: number;
  completion_tokens: number;
  // 'provider': the chunk's usage; 'counted': the Worker's count of the text it passed on.
  source: 'provider' | 'counted';
}

/**
 * D762 §3: pass a Workers AI SSE stream through unchanged, and when it ends,
 * or the reader stops early, call `onDone` once with what it used. The
 * provider's `usage` wins where a chunk carries one with completion tokens;
 * otherwise the output is counted from the `response` deltas the reader was
 * sent. `onDone` runs before the stream closes, so the Worker is still serving
 * the response while it settles; a failure in it is logged, never thrown at
 * the reader.
 */
export function meterStream(source: ReadableStream, onDone: (u: MeteredUsage) => Promise<void>): ReadableStream {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let provider: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  let finished = false;
  const readLine = (line: string) => {
    const m = /^data:\s*(.*)$/.exec(line.trim());
    if (!m || m[1] === '[DONE]') return;
    try {
      const chunk = JSON.parse(m[1]) as { response?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      if (typeof chunk.response === 'string') text += chunk.response;
      const c = Number(chunk.usage?.completion_tokens);
      if (Number.isSafeInteger(c) && c > 0) {
        const p = Number(chunk.usage?.prompt_tokens);
        provider = { completion_tokens: c, ...(Number.isSafeInteger(p) && p > 0 ? { prompt_tokens: p } : {}) };
      }
    } catch { /* a line that is not JSON carries no text */ }
  };
  const feed = (bytes: Uint8Array | undefined, last: boolean) => {
    pending += decoder.decode(bytes, { stream: !last });
    const lines = pending.split('\n');
    pending = last ? '' : lines.pop() ?? '';
    lines.forEach(readLine);
  };
  const finish = async () => {
    if (finished) return;
    finished = true;
    const counted: MeteredUsage = provider
      ? { ...provider, completion_tokens: provider.completion_tokens as number, source: 'provider' }
      : { completion_tokens: estTokens(text), source: 'counted' };
    try { await onDone(counted); }
    catch (e) { console.warn('[aiRouter] stream settlement:', (e as Error).message); }
  };
  return new ReadableStream({
    async pull(controller) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); }
      catch (e) { await finish(); controller.error(e); return; }
      if (next.done) {
        feed(undefined, true);
        await finish();
        controller.close();
        return;
      }
      feed(next.value, false);
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      feed(undefined, true);
      await finish();
      await reader.cancel(reason);
    },
  });
}

/** How a checked stream ended: its last slice released, a slice refused, or the reader gone. */
export type CheckedStreamEnd = 'pass' | 'block' | 'fail' | 'cancelled' | 'error';

/**
 * D763: release a Workers AI SSE stream one CHECKED slice at a time. The
 * source's `response` text is gathered; each slice `guard.sliceForGuard` cuts
 * from it is released, as one `data: {"response": …}` event, only after
 * `check` has passed or logged it; text after the last full slice waits for
 * the source to end. A slice that blocks or fails ends the stream with one
 * `data: {"refusal": …, "message": …}` event and `[DONE]`, the source is
 * cancelled, and nothing after the refused slice is ever sent. Unchecked text
 * never reaches the reader.
 *
 * `onEnd` runs once, when the stream ends for any reason, after the source
 * has finished (so a metered source has counted what it read) and before the
 * stream closes. A failure in it is logged, never thrown at the reader.
 *
 * The Worker reads ahead of the reader by up to a slice, to check it, so a
 * run whose reader stops early is settled on what the model produced and the
 * Worker read: the model ran that far, and Workers AI charged for it.
 */
export function releaseChecked(
  source: ReadableStream,
  check: (slice: string) => Promise<guard.GuardDecision>,
  onEnd: (end: CheckedStreamEnd) => Promise<void>,
  refusal: (end: 'block' | 'fail') => guard.GuardRefusal,
): ReadableStream {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lines = '';
  let pending = '';
  let sourceDone = false;
  let ended = false;
  const event = (data: unknown) => encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  const readLines = (chunk: string, last: boolean) => {
    lines += chunk;
    const parts = lines.split('\n');
    lines = last ? '' : parts.pop() ?? '';
    for (const line of parts) {
      const m = /^data:\s*(.*)$/.exec(line.trim());
      if (!m || m[1] === '[DONE]') continue;
      try {
        const chunk = JSON.parse(m[1]) as { response?: unknown };
        if (typeof chunk.response === 'string') pending += chunk.response;
      } catch { /* a line that is not JSON carries no text */ }
    }
  };
  const end = async (how: CheckedStreamEnd) => {
    if (ended) return;
    ended = true;
    try { await onEnd(how); }
    catch (e) { console.warn('[aiRouter] checked stream settlement:', (e as Error).message); }
  };
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        // The slices ready to check: every full one while the source runs, all of it once it has ended.
        const cut = pending ? guard.sliceForGuard(pending) : [];
        const ready = sourceDone ? cut : pending.length > guard.GUARD_SLICE_CHARS ? cut.slice(0, -1) : [];
        if (ready.length) {
          for (const slice of ready) {
            const decided = await check(slice);
            if (decided.action === 'block' || decided.action === 'fail') {
              const r = refusal(decided.action);
              controller.enqueue(event({ refusal: decided.action === 'block' ? 'guard_blocked_output' : 'guard_unavailable', message: r.message, link: r.link }));
              controller.enqueue(event('[DONE]'));
              if (!sourceDone) await reader.cancel().catch(() => {});
              // Settled before the stream closes, as `meterStream` does.
              await end(decided.action);
              controller.close();
              return;
            }
            pending = pending.slice(slice.length);
            controller.enqueue(event({ response: slice }));
          }
          return;
        }
        if (sourceDone) {
          controller.enqueue(event('[DONE]'));
          await end('pass');
          controller.close();
          return;
        }
        let next: ReadableStreamReadResult<Uint8Array>;
        try { next = await reader.read(); }
        catch (e) { await end('error'); controller.error(e); return; }
        if (next.done) {
          readLines(decoder.decode(), true);
          sourceDone = true;
          continue;
        }
        readLines(decoder.decode(next.value, { stream: true }), false);
      }
    },
    async cancel(reason) {
      if (!sourceDone) await reader.cancel(reason).catch(() => {});
      await end('cancelled');
    },
  });
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

/**
 * What the platform records about its own AI guardrails, in one place.
 *
 * WHY THIS IS A FUNCTION AND NOT INLINE (D152). The llama-guard rollup was
 * written inside `loadAiUsageReport` and served only `/api/monitoring/ai-usage`,
 * so HQ's Security page — which draws an "AI safety" zone and an H7 guardrail
 * panel — had no way to read it and rendered a refusal instead. Giving
 * `admin_security.ts` its own copy of this SQL is the drift this repo has
 * consolidated eleven times (D127 one `GROUP BY role`, D128 one LIKE escaper,
 * D130 one definition of open, D131 one count, D138 one definition of what
 * freezes, D140 one zone formatter, D142 one freeze list, D144 one notification
 * row, D149 one bps formatter, D151 one name for the branch). **Twelfth.**
 *
 * TWO STORES, BECAUSE THEY COUNT DIFFERENT THINGS AND BOTH ARE REAL.
 *
 *   · `ai_usage_logs.safety_score` (migration 040) is written by `recordUsage`
 *     on EVERY router call, so `task = 'safety'` rows are every guard
 *     EVALUATION and its verdict. That is the safe/unsafe rate.
 *   · `advisor_turn_audit` (migration 043) is written by `writeTurnAudit` from
 *     seventeen call sites in `routes/advisor.ts`, and records what the guard
 *     caused: `refusal_reason = 'safety_block'` is a turn that was BLOCKED, and
 *     `shadow_flagged = 1` is an output the screen FLAGGED. A verdict and a
 *     consequence are not the same number, and reporting one as the other is
 *     how a safety figure comes to mean nothing.
 *
 * EACH READ FAILS ON ITS OWN. `advisor_turn_audit` is lazily bootstrapped
 * (`ensureAuditSchema`), so its absence is a state a caller can actually meet —
 * and an absent table read as "zero hits" is the #204 defect this programme has
 * fixed repeatedly. `evaluated` and `enforcement` therefore carry their own
 * `available` flag rather than collapsing to zeros.
 */
export type GuardrailCounters = {
  window_days: number;
  since: string;
  /**
   * llama-guard verdicts over `ai_usage_logs` where task = 'safety'.
   *
   * `safe_rate` is **null when nothing was evaluated**, not 0. A rate over an
   * empty denominator is undefined, and rendering it as 0 would put "0% safe"
   * on a security page for a window in which the guard never ran — the worst
   * direction for this particular figure to be wrong in. (`loadAiUsageReport`
   * keeps its own zero-defaulted copy: `AiUsageTab` has shipped with that
   * shape and changing what its tiles mean is not this function's business.)
   */
  verdicts:
    | { available: true; evaluated: number; safe_count: number; unsafe_count: number; safe_rate: number | null }
    | { available: false; reason: string };
  /**
   * What the guard CAUSED, over `advisor_turn_audit`.
   *
   * D158 — `rules` is WHICH RULE fired, which until migration 270 was computed
   * on every guarded turn and thrown away. Three things about its shape are
   * deliberate:
   *
   *   · `rules` and `states` are SEPARATE. `classifyInput` returns an S-code
   *     when llama-guard names a violated category, and otherwise one of
   *     `safe` / `empty` / `router_failed` / `error` — which are not rules that
   *     fired, they are descriptions of the classification itself. Mixing them
   *     would put "the router failed" in a list headed "what tripped the
   *     guard", and a router failure is the guard NOT running.
   *   · `unclassified` is its own number and is never folded into either. Every
   *     row written before 270 has a null category, and reporting those as
   *     `safe` would be a verdict nothing reached.
   *   · The whole block still fails as one with the rest of `enforcement`: an
   *     unreadable `advisor_turn_audit` is not a turn that fired no rules.
   */
  enforcement:
    | {
      available: true;
      blocked: number;
      flagged: number;
      rules: Array<{ category: string; turns: number }>;
      states: Array<{ category: string; turns: number }>;
      unclassified: number;
    }
    | { available: false; reason: string };
  /**
   * D763: the guard inside `run()`, per page (`rail_page`) and for today. A
   * verdict is a guard row (`guard_for` set); what it caused is its run's
   * refusal. `page` is '' for a run asked from no rail page.
   */
  guard:
    | {
      available: true;
      today: GuardCounts;
      by_page: Array<GuardCounts & { page: string }>;
    }
    | { available: false; reason: string };
};

/** The guard's verdicts, and what they caused, over a set of runs (D763). */
export interface GuardCounts {
  checks: number;
  safe: number;
  unsafe: number;
  unreadable: number;
  blocked_input: number;
  withheld_output: number;
  unavailable: number;
}

export async function loadGuardrailCounters(env: Env, days = 7): Promise<GuardrailCounters> {
  await ensureLogSchema(env);
  const win = Math.max(1, Math.min(90, Math.round(days)));
  const since = new Date(Date.now() - win * 86400_000).toISOString().slice(0, 19).replace('T', ' ');

  const safety = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN safety_score IS NOT NULL THEN 1 ELSE 0 END) AS evaluated,
        SUM(CASE WHEN safety_score >= 0.5 THEN 1 ELSE 0 END) AS safe_count,
        SUM(CASE WHEN safety_score IS NOT NULL AND safety_score < 0.5 THEN 1 ELSE 0 END) AS unsafe_count
       FROM ai_usage_logs WHERE created_at >= ? AND task = 'safety'`,
  ).bind(since).first<{ evaluated: number; safe_count: number; unsafe_count: number }>()
    .catch(() => undefined);

  // `blocked` keys on the documented refusal value, not on `safety_score < 0.5`:
  // a low score is the guard's opinion, and a block is what the route did with
  // it. `flagged` rides `idx_advisor_turn_audit_flagged(shadow_flagged, created_at DESC)`.
  const enforcement = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN refusal_reason = 'safety_block' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN shadow_flagged = 1 THEN 1 ELSE 0 END) AS flagged
       FROM advisor_turn_audit WHERE created_at >= ?`,
  ).bind(since).first<{ blocked: number; flagged: number }>()
    .catch(() => undefined);

  // D158 — the breakdown, riding `idx_advisor_turn_audit_category`. Rows with a
  // null category are counted here rather than excluded, so `unclassified` is a
  // figure the page can show rather than a silent difference between this total
  // and `blocked`.
  const byCategory = await env.DB.prepare(
    `SELECT COALESCE(guardrail_category, '') AS category, COUNT(*) AS turns
       FROM advisor_turn_audit
      WHERE created_at >= ?
      GROUP BY COALESCE(guardrail_category, '')
      ORDER BY turns DESC, category ASC`,
  ).bind(since).all<{ category: string; turns: number }>()
    .catch(() => undefined);

  // An S-code is a rule that fired; everything else `classifyInput` can return
  // describes the classification instead. A literal test, not a built regex.
  const isRule = (c: string) => /^s\d+$/.test(c);
  const catRows = (byCategory?.results || []).map((r) => ({
    category: String(r.category || ''),
    turns: Number(r.turns || 0),
  }));

  // D763: one pass over the window, grouped by page; `today` is the same sums
  // over today's rows. A guard row is a verdict; a run row's refusal is what
  // it caused.
  const guardRows = await env.DB.prepare(
    `SELECT COALESCE(rail_page, '') AS page, (created_at >= ?) AS today,
        SUM(CASE WHEN guard_for IS NOT NULL THEN 1 ELSE 0 END) AS checks,
        SUM(CASE WHEN guard_for IS NOT NULL AND safety_score >= 0.5 THEN 1 ELSE 0 END) AS safe,
        SUM(CASE WHEN guard_for IS NOT NULL AND safety_score < 0.5 THEN 1 ELSE 0 END) AS unsafe,
        SUM(CASE WHEN guard_for IS NOT NULL AND safety_score IS NULL THEN 1 ELSE 0 END) AS unreadable,
        SUM(CASE WHEN refusal = 'guard_blocked' THEN 1 ELSE 0 END) AS blocked_input,
        SUM(CASE WHEN refusal = 'guard_blocked_output' THEN 1 ELSE 0 END) AS withheld_output,
        SUM(CASE WHEN refusal = 'guard_unavailable' THEN 1 ELSE 0 END) AS unavailable
       FROM ai_usage_logs
      WHERE created_at >= ? AND (guard_for IS NOT NULL OR refusal IN ('guard_blocked', 'guard_blocked_output', 'guard_unavailable'))
      GROUP BY COALESCE(rail_page, ''), (created_at >= ?)`,
  ).bind(todayStart(), since, todayStart()).all<Record<string, unknown>>()
    .catch(() => undefined);
  const GUARD_KEYS = ['checks', 'safe', 'unsafe', 'unreadable', 'blocked_input', 'withheld_output', 'unavailable'] as const;
  const zero = (): GuardCounts => ({ checks: 0, safe: 0, unsafe: 0, unreadable: 0, blocked_input: 0, withheld_output: 0, unavailable: 0 });
  const add = (into: GuardCounts, r: Record<string, unknown>) => { for (const k of GUARD_KEYS) into[k] += Number(r[k] || 0); };
  const today = zero();
  const pages = new Map<string, GuardCounts>();
  for (const r of guardRows?.results ?? []) {
    const page = String(r.page ?? '');
    if (!pages.has(page)) pages.set(page, zero());
    add(pages.get(page)!, r);
    if (Number(r.today) === 1) add(today, r);
  }

  const evaluated = Number(safety?.evaluated || 0);
  return {
    window_days: win,
    since,
    verdicts: safety === undefined
      ? {
        available: false,
        reason: 'The guard-verdict rollup over `ai_usage_logs` did not complete, which is not the '
          + 'same as no guarded call having run.',
      }
      : {
        available: true,
        evaluated,
        safe_count: Number(safety?.safe_count || 0),
        unsafe_count: Number(safety?.unsafe_count || 0),
        safe_rate: evaluated > 0 ? Number(safety?.safe_count || 0) / evaluated : null,
      },
    enforcement: enforcement === undefined
      ? {
        available: false,
        reason: '`advisor_turn_audit` could not be read on this database (migration 043). That is '
          + 'not the same as no turn having been blocked or flagged.',
      }
      : {
        available: true,
        blocked: Number(enforcement?.blocked || 0),
        flagged: Number(enforcement?.flagged || 0),
        rules: catRows.filter((r) => isRule(r.category)),
        states: catRows.filter((r) => r.category !== '' && !isRule(r.category)),
        unclassified: catRows.find((r) => r.category === '')?.turns ?? 0,
      },
    guard: guardRows === undefined
      ? {
        available: false,
        reason: 'The guard rollup over `ai_usage_logs` did not complete (migration 493). That is not '
          + 'the same as no run having been checked.',
      }
      : {
        available: true,
        today,
        by_page: [...pages.entries()]
          .map(([page, counts]) => ({ page, ...counts }))
          .sort((a, b) => b.checks - a.checks || a.page.localeCompare(b.page)),
      },
  };
}

/** The start of today (UTC), in `ai_usage_logs.created_at`'s own format. */
function todayStart(): string {
  return `${todayKey()} 00:00:00`;
}

export async function loadAiUsageReport(env: Env, days = 7): Promise<AiUsageReport> {
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

  // D152 — ONE DEFINITION OF THE ROLLUP, and this is now its caller rather than
  // a second copy of the SQL. `safety` keeps the shape this endpoint has always
  // returned, including zeros when the read fails: `AiUsageTab` is a shipped
  // page and changing what its tiles mean is not this PR's concern. The RICHER
  // form, which distinguishes "nothing was evaluated" from "the read did not
  // complete", is what the new HQ surface consumes.
  const counters = await loadGuardrailCounters(env, win);
  const safety = counters.verdicts.available ? counters.verdicts : null;

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

// Test-only export — drops what every binding has bootstrapped, so a scenario
// that reuses one D1 stub still starts from a cold schema. Keyed per binding
// (#204) this matters less than it did: a test handing over a FRESH stub now
// gets a cold cache with no reset at all. It stays because the suites that
// reuse a stub across cases still need it, not because the cache leaks.
export function __resetForTest(): void {
  LOG_SCHEMA_READY = new WeakMap<object, boolean>();
}

// Spec phrased the public entry point as `run(task, payload, opts)`.
// Workers convention forces us to thread `env` explicitly (no module-level
// globals), so the actual surface is `run(env, opts)`. This thin adapter
// gives downstream features (AR/AS/AW/AV/AT/AU) a curried callable that
// matches the conceptual signature: `const ai = bindAi(env); ai('embed', { text })`.
export function bindAi(env: Env): (task: TaskClass, payload: Omit<RunOptions, 'task' | 'userId'> & { userId?: number }, userId?: number) => Promise<RunResult> {
  return (task, payload, userId = 0) => run(env, { ...payload, task, userId: payload.userId ?? userId });
}
