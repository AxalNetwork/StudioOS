/**
 * D761 (#2018) — the request and response shapes the AI router sends to and
 * reads from Workers AI, and the rules that sit on each attempt: its timeout
 * class, whether the input fits the model's context window, which failures move
 * the router down the chain, the session-affinity header, and the units the
 * attempt used.
 *
 * Pure: no `env`, no binding, no D1. `services/aiRouter.ts` calls these from
 * `callWorkersAI` and `run`. A test calls them directly.
 *
 * UNITS ARE MEASURED BY THE WORKER. A shape returns `units` read from the
 * request it built and the provider's answer, never from anything a browser
 * sent: the provider's own token counts when it reports them, else an estimate
 * from the text the Worker holds. D762 (A3) settles a run on these units.
 *
 * THE CATALOGUE IS D760's (A1). A model's kind, context window and whether it
 * needs a paid plan are read through `factsFor`, which reads one source. Until
 * A1 installs its catalogue with `setModelFactsSource`, that source knows only
 * the reasoning controls below, so no model is skipped for its context window
 * and none is treated as paid-only. This file holds the shapes, not the prices:
 * those stay with A1.
 */

/**
 * The kinds of model the router can run. PR 1 built `text` and `reasoning`;
 * PR 2 adds `rerank`, `embedding` and `translation`, and vision as a
 * capability of a text or reasoning model (`ModelFacts.vision`), not a kind.
 */
export type ModelKind = 'text' | 'reasoning' | 'vision' | 'rerank' | 'embedding' | 'translation' | 'speech' | 'voice' | 'image';

/**
 * How a reasoning model is told how hard to think, as its model page gives it
 * (`@cloudflare/workers-types`, generated from Workers AI's own metadata):
 * `reasoning_effort` for most, `chat_template_kwargs` for Nemotron. `effort`
 * absent means the model's own default is used and nothing is sent.
 */
export type ReasoningControl =
  | { via: 'reasoning_effort'; effort?: string }
  | { via: 'chat_template_kwargs'; kwargs?: Record<string, boolean> }
  | { via: 'none' };

export interface ModelFacts {
  kind: ModelKind;
  /** Tokens of input plus output the model accepts; `null` when the catalogue does not say. */
  context_window: number | null;
  /** True for a model Workers AI serves on a paid plan only (D760). */
  paid_only: boolean;
  reasoning?: ReasoningControl;
  /** True for a text or reasoning model that takes images as content parts (PR 2). */
  vision?: boolean;
}

/**
 * The reasoning models Workers AI documents a control for, keyed by model id.
 * Each control is the one its model page names. No effort is chosen here, so
 * each model runs at its own default until a task asks for one.
 */
export const REASONING_CONTROLS: Readonly<Record<string, ReasoningControl>> = Object.freeze({
  '@cf/openai/gpt-oss-120b': { via: 'reasoning_effort' },
  '@cf/openai/gpt-oss-20b': { via: 'reasoning_effort' },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': { via: 'reasoning_effort' },
  '@cf/deepseek-ai/deepseek-v4-pro-0813': { via: 'reasoning_effort' },
  '@cf/zai-org/glm-5.3': { via: 'reasoning_effort' },
  '@cf/zai-org/glm-5.3-flash': { via: 'reasoning_effort' },
  '@cf/moonshotai/kimi-k2.6': { via: 'reasoning_effort' },
  '@cf/nvidia/nemotron-3-120b-a12b': { via: 'chat_template_kwargs' },
  // QwQ always reasons and takes no control; its answer still carries reasoning to strip.
  '@cf/qwen/qwq-32b': { via: 'none' },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { via: 'none' },
});

/**
 * PR 2: the models Workers AI documents as taking images in a chat's content
 * parts (`{ type: 'image_url', image_url: { url } }`, `@cloudflare/workers-types`
 * 5.20261012.1, and each model page's "Vision" flag). The catalogue's list on
 * 2026-10-17, as #2018 names it.
 */
export const VISION_MODELS: ReadonlySet<string> = new Set([
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/moonshotai/kimi-k2.6',
]);

/**
 * PR 2: the kinds of the non-chat models a rail can run, until D760's
 * catalogue says them. Each one's request shape is its model page's
 * (`/workers-ai/models/<name>/`) and `@cloudflare/workers-types`.
 */
export const INTERIM_KINDS: Readonly<Record<string, 'rerank' | 'embedding' | 'translation' | 'voice'>> = Object.freeze({
  '@cf/baai/bge-reranker-base': 'rerank',
  '@cf/baai/bge-base-en-v1.5': 'embedding',
  '@cf/baai/bge-small-en-v1.5': 'embedding',
  '@cf/baai/bge-large-en-v1.5': 'embedding',
  '@cf/baai/bge-m3': 'embedding',
  '@cf/qwen/qwen3-embedding-0.6b': 'embedding',
  '@cf/google/embeddinggemma-300m': 'embedding',
  '@cf/pfnet/plamo-embedding-1b': 'embedding',
  '@cf/meta/m2m100-1.2b': 'translation',
  // PR 3: text to speech.
  '@cf/deepgram/aura-1': 'voice',
  '@cf/deepgram/aura-2-en': 'voice',
  '@cf/deepgram/aura-2-es': 'voice',
  '@cf/myshell-ai/melotts': 'voice',
});

const DEFAULT_FACTS: ModelFacts = Object.freeze({ kind: 'text', context_window: null, paid_only: false }) as ModelFacts;

function interimFacts(model: string): ModelFacts | null {
  const reasoning = REASONING_CONTROLS[model];
  const vision = VISION_MODELS.has(model) ? { vision: true } : {};
  if (reasoning) return { kind: 'reasoning', context_window: null, paid_only: false, reasoning, ...vision };
  const kind = INTERIM_KINDS[model];
  if (kind) return { kind, context_window: null, paid_only: false };
  return VISION_MODELS.has(model) ? { kind: 'text', context_window: null, paid_only: false, vision: true } : null;
}

let factsSource: (model: string) => ModelFacts | null = interimFacts;

/** D760 installs its catalogue here; a reasoning model it lists without a control keeps the one above. */
export function setModelFactsSource(source: ((model: string) => ModelFacts | null) | null): void {
  factsSource = source ?? interimFacts;
}

/** What the router knows about a model: the catalogue's facts, else plain text with nothing known. */
export function factsFor(model: string): ModelFacts {
  const found = factsSource(model);
  if (!found) return DEFAULT_FACTS;
  if (found.kind === 'reasoning' && !found.reasoning && REASONING_CONTROLS[model]) return { ...found, reasoning: REASONING_CONTROLS[model] };
  return found;
}

/**
 * PR 2: what a run asks of a model, from the inputs it carries. A model that
 * cannot serve it is skipped without a call, as a context overflow is: a
 * text-only model handed an image would answer as if there were none.
 */
export type Need = 'chat' | 'vision' | 'rerank' | 'embedding' | 'translation' | 'voice';

export function canServe(facts: ModelFacts, need: Need): boolean {
  switch (need) {
    case 'vision': return (facts.kind === 'text' || facts.kind === 'reasoning') && facts.vision === true;
    case 'rerank': return facts.kind === 'rerank';
    case 'embedding': return facts.kind === 'embedding';
    case 'translation': return facts.kind === 'translation';
    // PR 3: Aura and MeloTTS. Aura is a partner model, which D760's gate refuses before the run (`modelRefusal`) until the switch offers it.
    case 'voice': return facts.kind === 'voice';
    default: return facts.kind === 'text' || facts.kind === 'reasoning';
  }
}

// ─────────────────────────────────────────────────────────── timeouts

/** #1874 §7: each class's limit, for the whole call or, streamed, for its first chunk. */
export const TIMEOUT_MS = Object.freeze({ chat: 8_000, reasoning: 30_000, long_context: 30_000, image: 60_000 });
export type TimeoutClass = keyof typeof TIMEOUT_MS;
/** An input at or above this many tokens is long context, whatever the model. */
export const LONG_CONTEXT_TOKENS = 32_000;

export function timeoutClass(facts: ModelFacts, inputTokens: number): TimeoutClass {
  if (facts.kind === 'image') return 'image';
  if (facts.kind === 'reasoning') return 'reasoning';
  // PR 3: speech is produced for the whole text before it returns, so it gets the long class.
  if (facts.kind === 'voice') return 'long_context';
  if (inputTokens >= LONG_CONTEXT_TOKENS) return 'long_context';
  return 'chat';
}

export const timeoutMs = (facts: ModelFacts, inputTokens: number): number => TIMEOUT_MS[timeoutClass(facts, inputTokens)];

// ─────────────────────────────────────────────────────────── context windows and output budgets

/** A reasoning model's output budget when its task names none: thinking spends tokens before the answer starts. */
export const REASONING_MAX_TOKENS = 4_096;
export const DEFAULT_MAX_TOKENS = 512;

/** The `max_tokens` an attempt sends: the caller's, else 512; a reasoning model gets at least its task's reasoning budget. */
export function maxTokensFor(facts: ModelFacts, requested: number | undefined, reasoningBudget?: number): number {
  const asked = requested || DEFAULT_MAX_TOKENS;
  if (facts.kind !== 'reasoning') return asked;
  return Math.max(asked, reasoningBudget || REASONING_MAX_TOKENS);
}

/** Whether input plus output fit the model's window. An unknown window always fits: nothing is skipped on a guess. */
export function fitsContext(facts: ModelFacts, inputTokens: number, maxOut: number): boolean {
  return facts.context_window == null || inputTokens + maxOut <= facts.context_window;
}

// ─────────────────────────────────────────────────────────── failures

export interface Failure { status: number; code: number | null }

/**
 * A thrown binding error read as a status and Workers AI's numeric code. The
 * binding throws `Error`s whose message carries the code (`5035: …`) and, for
 * rate limits, the status; a status on the error object wins.
 */
export function failureOf(e: unknown): Failure {
  const err = e as { status?: unknown; message?: unknown } | null;
  const message = String(err?.message ?? e ?? '');
  const code = /\b(5\d{3}|3\d{3}|1\d{3})\b/.exec(message);
  let status = typeof err?.status === 'number' ? err.status : 0;
  if (!status && /\b429\b|too many requests|rate limit/i.test(message)) status = 429;
  if (!status && /\b403\b|forbidden/i.test(message)) status = 403;
  return { status: status || 500, code: code ? Number(code[1]) : null };
}

/** The paid-plan refusals (#1874 §7): a 429, or a 403 with code 5035, from a `paid_only` model. */
export function isPaidOnlyRefusal(facts: ModelFacts, f: Failure): boolean {
  return facts.paid_only && (f.status === 429 || (f.status === 403 && f.code === 5035));
}

// ─────────────────────────────────────────────────────────── cache affinity

const PAGE_KEY_RE = /^[A-Za-z0-9/_.-]{1,160}$/;

/**
 * `x-session-affinity`: the member's id and the page key, so a member's next
 * turn on the same page lands where its cached input is. Never an email or a
 * name. `null` for a call with no member behind it or no usable page key.
 */
export function sessionAffinity(userId: number | undefined, page: string | null | undefined): string | null {
  if (!Number.isSafeInteger(userId) || (userId as number) <= 0) return null;
  const key = typeof page === 'string' ? page.trim() : '';
  if (!PAGE_KEY_RE.test(key)) return null;
  return `u${userId}:${key}`;
}

// ─────────────────────────────────────────────────────────── units

/**
 * What one attempt used, in D760's unit names. Each shape fills the ones its
 * kind bills by; the rest are absent, never zero-filled.
 */
export interface Units {
  tokens_in?: number;
  tokens_cached?: number;
  tokens_out?: number;
  audio_minutes?: number;
  /** PR 2: images sent to a vision model, counted by the Worker. Billing stays in tokens. */
  images_in?: number;
  /** PR 3: characters of text sent to a voice priced per 1k characters (Aura). */
  characters?: number;
  /** PR 3: minutes streamed over a WebSocket (Nova-3 and Flux live), on the Worker's clock. */
  audio_minutes_websocket?: number;
}

const estTokens = (s: string): number => (s ? Math.max(1, Math.ceil(s.length / 4)) : 0);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// ─────────────────────────────────────────────────────────── text and reasoning

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
/** A content part a vision model reads (`ChatCompletionContentPart*` in `@cloudflare/workers-types`). */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type WireMessage = { role: ChatMessage['role']; content: string | ContentPart[] };

/** The chat request for a text or reasoning model. A reasoning control is sent only when it names a value. */
export function chatRequest(facts: ModelFacts, messages: ChatMessage[] | WireMessage[], o: { maxTokens: number; temperature?: number; stream?: boolean }): Record<string, unknown> {
  const payload: Record<string, unknown> = { messages, max_tokens: o.maxTokens };
  if (o.temperature != null) payload.temperature = o.temperature;
  if (o.stream) payload.stream = true;
  const r = facts.kind === 'reasoning' ? facts.reasoning : undefined;
  if (r?.via === 'reasoning_effort' && r.effort) payload.reasoning_effort = r.effort;
  if (r?.via === 'chat_template_kwargs' && r.kwargs && Object.keys(r.kwargs).length) payload.chat_template_kwargs = { ...r.kwargs };
  return payload;
}

type ChatShape = {
  response?: unknown;
  choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
};

/** A reasoning model's inline thinking, `<think>…</think>`, which is never part of the answer. */
const THINK_RE = /<think>[\s\S]*?<\/think>\s*|^[\s\S]*?<\/think>\s*/g;

/**
 * The answer and the units from a chat response, flat or nested under
 * `result`. The answer is the message `content` (or `response`), never
 * `reasoning_content`: a model that only reasoned has answered nothing.
 */
export function parseChat(raw: unknown, facts: ModelFacts, messages: ChatMessage[]): { text: string; units: Units } {
  const r = (raw ?? {}) as ChatShape & { result?: ChatShape };
  const pick = (s?: ChatShape): string | undefined => {
    const v = s?.choices?.[0]?.message?.content ?? s?.response;
    return typeof v === 'string' ? v : undefined;
  };
  let text = pick(r) ?? pick(r.result) ?? '';
  if (facts.kind === 'reasoning') text = text.replace(THINK_RE, '').trim();
  const usage = r.usage ?? r.result?.usage;
  const units: Units = {
    tokens_in: count(usage?.prompt_tokens) ?? estTokens(messages.map((m) => m.content).join('\n')),
    tokens_out: count(usage?.completion_tokens) ?? estTokens(text),
  };
  const cached = count(usage?.prompt_tokens_details?.cached_tokens);
  if (cached != null) units.tokens_cached = cached;
  return { text, units };
}

/** A streamed chat's units at open: the input the Worker sent. Its output is counted where the stream is settled (D762). */
export const streamOpenUnits = (messages: ChatMessage[]): Units => ({ tokens_in: estTokens(messages.map((m) => m.content).join('\n')) });

// ─────────────────────────────────────────────────────────── embeddings and audio

export const embedRequest = (text: string): Record<string, unknown> => ({ text });

export function parseEmbed(raw: unknown, text: string): { vector: number[] | null; units: Units } {
  const data = (raw as { data?: unknown })?.data;
  const vector = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as number[]) : null;
  const usage = (raw as { usage?: { prompt_tokens?: unknown } })?.usage;
  return { vector, units: { tokens_in: count(usage?.prompt_tokens) ?? estTokens(text) } };
}

/** A transcription's units: the minutes the Worker measured from the clip's bytes (`audioMinutesFromBytes`). */
export const audioUnits = (minutes: number | undefined): Units => ({ audio_minutes: Number.isFinite(minutes) && (minutes as number) > 0 ? (minutes as number) : 0 });

// ─────────────────────────────────────────────────────────── streams

/**
 * Wait at most `ms` for a stream's first chunk. On time, a stream that replays
 * that chunk and then the rest; late or empty, the stream is cancelled and
 * `null` returned, so the router can fall back as it does for a slow call.
 */
export async function firstChunkWithin(stream: ReadableStream, ms: number): Promise<ReadableStream | null> {
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), Math.max(0, ms)); });
  let first: ReadableStreamReadResult<unknown> | 'late';
  try {
    first = await Promise.race([reader.read(), late]);
  } catch {
    first = 'late';
  } finally {
    clearTimeout(timer);
  }
  if (first === 'late' || first.done) {
    reader.cancel().catch(() => {});
    return null;
  }
  const head = first.value;
  return new ReadableStream({
    start(controller) { controller.enqueue(head); },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

// ─────────────────────────────────────────────────────────── vision (PR 2)

/**
 * The images one run may send, and how large each may be. A data URI only:
 * the Worker measures what it sends, and never hands a model a URL to fetch.
 */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DATA_URI_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The decoded size of a base64 image data URI, or null when it is not one this router sends. */
export function imageBytes(uri: unknown): number | null {
  if (typeof uri !== 'string') return null;
  const m = DATA_URI_RE.exec(uri);
  if (!m) return null;
  const b64 = m[2];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Why a run's images cannot be sent, or null when every one can. */
export function imagesRefusal(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return 'no images';
  if (images.length > MAX_IMAGES) return `at most ${MAX_IMAGES} images`;
  for (const uri of images) {
    const n = imageBytes(uri);
    if (n == null) return 'each image is a base64 PNG, JPEG, WebP or GIF data URI';
    if (n > MAX_IMAGE_BYTES) return `each image is at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`;
  }
  return null;
}

/**
 * The chat with the images attached to its last user message, as content
 * parts: its text first, then each image in order. A chat with no user
 * message gets one, holding only the images.
 */
export function withImages(messages: ChatMessage[], images: string[]): WireMessage[] {
  const parts: ContentPart[] = images.map((url) => ({ type: 'image_url', image_url: { url } }));
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { at = i; break; }
  if (at < 0) return [...messages, { role: 'user', content: parts }];
  return messages.map((m, i) => (i === at ? { role: m.role, content: [{ type: 'text', text: m.content }, ...parts] } : m));
}

// ─────────────────────────────────────────────────────────── rerank (PR 2)

export interface RerankInput { query: string; contexts: string[]; topK?: number }
/** The reranker's own limits: a 512-token input (its model page), and a bound on the list a run sends. */
export const MAX_RERANK_CONTEXTS = 100;

export function rerankRefusal(r: RerankInput | undefined): string | null {
  if (!r || typeof r.query !== 'string' || !r.query.trim()) return 'a rerank needs a query';
  if (!Array.isArray(r.contexts) || !r.contexts.length || r.contexts.some((c) => typeof c !== 'string' || !c.trim())) return 'a rerank needs at least one non-empty context';
  if (r.contexts.length > MAX_RERANK_CONTEXTS) return `at most ${MAX_RERANK_CONTEXTS} contexts`;
  if (r.topK != null && (!Number.isInteger(r.topK) || r.topK < 1)) return 'top_k is a positive whole number';
  return null;
}

/** `@cf/baai/bge-reranker-base`: `{ query, contexts: [{ text }], top_k? }`, as its model page gives it. */
export function rerankRequest(r: RerankInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { query: r.query, contexts: r.contexts.map((text) => ({ text })) };
  if (r.topK != null) payload.top_k = r.topK;
  return payload;
}

export interface RankedContext { index: number; score: number }

/**
 * The ranking, best first: each entry's `id` is its context's index in the
 * request. An entry whose index is not one the request sent is dropped.
 * Units: the input the Worker sent, the query once per context, as the model
 * reads each pair.
 */
export function parseRerank(raw: unknown, r: RerankInput): { ranking: RankedContext[] | null; units: Units } {
  const src = (raw as { response?: unknown; result?: { response?: unknown } } | null);
  const list = Array.isArray(src?.response) ? src!.response : Array.isArray(src?.result?.response) ? src!.result!.response : null;
  const units: Units = { tokens_in: r.contexts.reduce((n, c) => n + estTokens(r.query) + estTokens(c), 0) };
  if (!list) return { ranking: null, units };
  const ranking: RankedContext[] = [];
  for (const e of list as Array<{ id?: unknown; score?: unknown }>) {
    const index = typeof e?.id === 'number' ? e.id : NaN;
    const score = typeof e?.score === 'number' ? e.score : NaN;
    if (Number.isInteger(index) && index >= 0 && index < r.contexts.length && Number.isFinite(score)) ranking.push({ index, score });
  }
  ranking.sort((a, b) => b.score - a.score);
  return { ranking, units };
}

// ─────────────────────────────────────────────────────────── translation (PR 2)

export interface TranslateInput { sourceLang?: string; targetLang: string }
/** A language code, as m2m100's page asks for one (`en`, `es`, `pt-BR`). Names are not sent. */
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

export function translateRefusal(t: TranslateInput | undefined, text: string | undefined): string | null {
  if (!t || typeof t.targetLang !== 'string' || !LANG_RE.test(t.targetLang)) return 'a translation needs a target language code';
  if (t.sourceLang != null && (typeof t.sourceLang !== 'string' || !LANG_RE.test(t.sourceLang))) return 'the source language is a language code';
  if (typeof text !== 'string' || !text.trim()) return 'a translation needs text';
  return null;
}

/** `@cf/meta/m2m100-1.2b`: `{ text, source_lang?, target_lang }`. No source is the model's default, English. */
export function translateRequest(text: string, t: TranslateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { text, target_lang: t.targetLang };
  if (t.sourceLang) payload.source_lang = t.sourceLang;
  return payload;
}

/** The translated text, flat or under `result`, and its units: tokens in and out, priced alike on its page. */
export function parseTranslate(raw: unknown, text: string): { text: string | null; units: Units } {
  const r = raw as { translated_text?: unknown; result?: { translated_text?: unknown } } | null;
  const v = r?.translated_text ?? r?.result?.translated_text;
  const out = typeof v === 'string' ? v : null;
  return { text: out, units: { tokens_in: estTokens(text), tokens_out: out == null ? 0 : estTokens(out) } };
}

// ─────────────────────────────────────────────────────────── the search index (PR 2)

/**
 * `axal-search` is 768-dimensional and was filled by BGE Base EN v1.5. Only
 * that model's vectors may be written to it: another model's 768 dimensions
 * (EmbeddingGemma's) would be accepted by the index and silently wrong.
 */
export const SEARCH_INDEX_MODEL = '@cf/baai/bge-base-en-v1.5';
export const SEARCH_INDEX_DIMENSIONS = 768;

export function searchIndexAccepts(model: string, vector: unknown): boolean {
  return model === SEARCH_INDEX_MODEL && Array.isArray(vector) && vector.length === SEARCH_INDEX_DIMENSIONS
    && vector.every((x) => typeof x === 'number' && Number.isFinite(x));
}

// ─────────────────────────────────────────────────────────── speech and voice (PR 3)

/**
 * A live transcript's units: the minutes streamed over the WebSocket, as the
 * Worker's clock measured them (`liveTranscription.settleStream`). Priced per
 * WebSocket minute (`PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET`), apart from a
 * file's `audio_minutes`.
 */
export const websocketUnits = (minutes: number): Units => ({ audio_minutes_websocket: Number.isFinite(minutes) && minutes > 0 ? minutes : 0 });

export interface SpeakInput { voice?: string; lang?: string }
/** One request's text, at most: Aura bills per 1k characters, and the router bounds what one press can cost. */
export const MAX_SPEAK_CHARS = 2000;
/** The largest audio a voice may return before it is not one sentence's speech. */
export const MAX_SPEECH_BYTES = 10 * 1024 * 1024;

/** Each Aura model's speakers, as its model page lists them. */
export const AURA_SPEAKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '@cf/deepgram/aura-1': ['angus', 'asteria', 'arcas', 'orion', 'orpheus', 'athena', 'luna', 'zeus', 'perseus', 'helios', 'hera', 'stella'],
  '@cf/deepgram/aura-2-en': ['amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena', 'atlas', 'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia', 'helena', 'hera', 'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna', 'mars', 'minerva', 'neptune', 'odysseus', 'ophelia', 'orion', 'orpheus', 'pandora', 'phoebe', 'pluto', 'saturn', 'selene', 'thalia', 'theia', 'vesta', 'zeus'],
  '@cf/deepgram/aura-2-es': ['sirio', 'nestor', 'carina', 'celeste', 'alvaro', 'diana', 'aquila', 'selena', 'estrella', 'javier'],
});
const VOICE_RE = /^[a-z]{2,20}$/;
const LANG2_RE = /^[a-z]{2}$/;

export function speakRefusal(s: SpeakInput | undefined, text: string | undefined): string | null {
  if (!s || typeof s !== 'object') return 'a voice run needs its options';
  if (typeof text !== 'string' || !text.trim()) return 'a voice run needs text';
  if (text.length > MAX_SPEAK_CHARS) return `at most ${MAX_SPEAK_CHARS} characters`;
  if (s.voice != null && (typeof s.voice !== 'string' || !VOICE_RE.test(s.voice))) return 'the voice is a speaker name';
  if (s.lang != null && (typeof s.lang !== 'string' || !LANG2_RE.test(s.lang))) return 'the language is a two-letter code';
  return null;
}

/**
 * The request a voice takes: Aura's `{ text, speaker?, encoding: 'mp3' }`, or
 * MeloTTS's `{ prompt, lang? }`. A speaker the model does not list is refused
 * (null), so the chain moves on rather than speaking in another voice; MeloTTS
 * has one voice per language and lists no speaker, so any named one is refused.
 */
export function speakRequest(model: string, text: string, s: SpeakInput): Record<string, unknown> | null {
  const speakers = AURA_SPEAKERS[model];
  if (speakers) {
    if (s.voice != null && !speakers.includes(s.voice)) return null;
    return { text, encoding: 'mp3', ...(s.voice ? { speaker: s.voice } : {}) };
  }
  if (s.voice != null) return null;
  return { prompt: text, ...(s.lang ? { lang: s.lang } : {}) };
}

/** The mime type a voice's bytes are, from their first bytes: MP3 (ID3 or frame sync) or WAV; else MP3, which both models default to. */
export function speechMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';
  return 'audio/mpeg';
}

/**
 * The audio a voice returned: a stream (Aura), bytes, or `{ audio: base64 }`
 * (MeloTTS), flat or under `result`. Null when there is none, or when it is
 * larger than `MAX_SPEECH_BYTES` (the stream is cancelled there).
 */
/** A voice's answer: its audio bytes and their mime type. */
export interface SpeechAudio { bytes: Uint8Array; mime: string }

export async function readSpeech(raw: unknown): Promise<SpeechAudio | null> {
  let bytes: Uint8Array | null = null;
  const r = raw as { audio?: unknown; result?: { audio?: unknown } } | null;
  const b64 = typeof r?.audio === 'string' ? r.audio : typeof r?.result?.audio === 'string' ? r.result.audio : null;
  if (b64 != null) {
    try {
      const bin = atob(b64);
      if (bin.length > MAX_SPEECH_BYTES) return null;
      bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    } catch { return null; }
  } else if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw);
  } else if (raw && typeof (raw as ReadableStream).getReader === 'function') {
    const reader = (raw as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SPEECH_BYTES) { reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
    bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  }
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_BYTES) return null;
  return { bytes, mime: speechMime(bytes) };
}
