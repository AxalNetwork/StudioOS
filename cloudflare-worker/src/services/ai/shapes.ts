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

/** The kinds of model the router can run. PR 1 builds `text` and `reasoning`; D761's later parts add the rest. */
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

const DEFAULT_FACTS: ModelFacts = Object.freeze({ kind: 'text', context_window: null, paid_only: false }) as ModelFacts;

function interimFacts(model: string): ModelFacts | null {
  const reasoning = REASONING_CONTROLS[model];
  return reasoning ? { kind: 'reasoning', context_window: null, paid_only: false, reasoning } : null;
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

// ─────────────────────────────────────────────────────────── timeouts

/** #1874 §7: each class's limit, for the whole call or, streamed, for its first chunk. */
export const TIMEOUT_MS = Object.freeze({ chat: 8_000, reasoning: 30_000, long_context: 30_000, image: 60_000 });
export type TimeoutClass = keyof typeof TIMEOUT_MS;
/** An input at or above this many tokens is long context, whatever the model. */
export const LONG_CONTEXT_TOKENS = 32_000;

export function timeoutClass(facts: ModelFacts, inputTokens: number): TimeoutClass {
  if (facts.kind === 'image') return 'image';
  if (facts.kind === 'reasoning') return 'reasoning';
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
}

const estTokens = (s: string): number => (s ? Math.max(1, Math.ceil(s.length / 4)) : 0);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// ─────────────────────────────────────────────────────────── text and reasoning

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** The chat request for a text or reasoning model. A reasoning control is sent only when it names a value. */
export function chatRequest(facts: ModelFacts, messages: ChatMessage[], o: { maxTokens: number; temperature?: number; stream?: boolean }): Record<string, unknown> {
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
