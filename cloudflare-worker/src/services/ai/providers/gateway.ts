/**
 * D4556 (#4556): the AI Gateway chat-completions adapter (Path A), for a
 * third-party catalogue model called on the Workers AI binding with
 * `returnRawResponse`, as `D4556.md` §2 records it from Cloudflare's pages, read
 * 2026-11-06. Pure, like every adapter here: no `env`, no hold, no log.
 *
 * - INPUT. The model's own chat-completions object, passed as the second
 *   argument to `env.AI.run` and never wrapped in `input` (Cloudflare: "AI
 *   Gateway rejects fields that the model does not accept"). `max_completion_tokens`
 *   bounds the whole output, reasoning included. No `temperature` (the GPT-5
 *   family takes only its default) and never `stream`: the slice buffers the
 *   answer so the output guard reads all of it.
 * - USAGE. `prompt_tokens` includes the cached input
 *   (`prompt_tokens_details.cached_tokens`), so the uncached input is the
 *   difference. `completion_tokens` includes the reasoning tokens. No readable
 *   `prompt_tokens` or `completion_tokens` is no usage (null), never zero. An
 *   absent cached count reads as none cached, which bills every input token at
 *   the full input rate: the default can only overcharge, never undercharge,
 *   and the row says `usage_reported`.
 * - ERRORS. By status, with AI Gateway's code where the body carries one
 *   (Cloudflare's troubleshooting page): 401 credential rejected (2009), 402 or
 *   403 "Insufficient balance" (2052, 2049) billing, other 403 auth, 429 a rate
 *   limit (2018 is Unified Billing's 200 requests a minute per gateway), 503
 *   Unified Billing unavailable (7005) or overloaded, 408/504 a timeout.
 */
import type { GatewayAdapter, GatewayOutcome, ProviderErrorKind, ProviderRequest } from './types';

const count = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The reported usage as the slice's priced units, or null when it cannot be read. */
export function chatUsage(u: unknown): { usage: Record<string, number>; reasoning: number | null } | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const prompt = count(r.prompt_tokens);
  const completion = count(r.completion_tokens);
  if (prompt == null || completion == null) return null;
  const details = r.prompt_tokens_details as Record<string, unknown> | null | undefined;
  const cached = details == null || details.cached_tokens == null ? 0 : count(details.cached_tokens);
  if (cached == null || cached > prompt) return null;
  const reasoning = count((r.completion_tokens_details as Record<string, unknown> | null | undefined)?.reasoning_tokens);
  return { usage: { tokens_in: prompt - cached, tokens_cached: cached, tokens_out: completion }, reasoning };
}

/** AI Gateway's error code, from `{ errors: [{ code }] }` or `{ error: { code } }`. */
function codeOf(body: unknown): { code: number | null; message: string } {
  const b = body as { errors?: Array<{ code?: unknown; message?: unknown }>; error?: { code?: unknown; message?: unknown } } | null;
  const first = Array.isArray(b?.errors) ? b!.errors[0] : b?.error;
  const code = Number.isSafeInteger(first?.code) ? (first!.code as number) : null;
  return { code, message: typeof first?.message === 'string' ? first.message : '' };
}

function failureOf(status: number, body: unknown): { error: ProviderErrorKind; completion: 'none' | 'unknown'; code: number | null } {
  const { code, message } = codeOf(body);
  const none = (error: ProviderErrorKind) => ({ error, completion: 'none' as const, code });
  if (status === 401) return none('auth');
  if (status === 402 || code === 2052 || code === 2021) return none('billing');
  if (status === 403) return none(/balance/i.test(message) ? 'billing' : 'auth');
  if (status === 429) return none('rate_limited');
  if (status === 503 || status === 529) return none('overloaded');
  if (status === 408 || status === 504) return { error: 'timeout', completion: 'unknown', code };
  if (status >= 400 && status < 500) return none('invalid');
  return { error: 'server', completion: 'unknown', code };
}

/** `retry-after` in seconds; absent or unreadable is unknown, never 0. */
export function retryAfterSeconds(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const chatCompletions: GatewayAdapter = {
  input(req: ProviderRequest) {
    return {
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_completion_tokens: req.maxTokens,
    };
  },

  read(status, body, header): GatewayOutcome {
    const logId = header('cf-aig-log-id');
    if (status < 200 || status >= 300) {
      const f = failureOf(status, body);
      return { ok: false, ...f, status, retryAfterSec: retryAfterSeconds(header('retry-after')), logId, usage: null };
    }
    // A 2xx the slice cannot read: the provider may have done the work.
    const unreadable: GatewayOutcome = { ok: false, error: 'server', status, code: null, retryAfterSec: null, completion: 'unknown', logId, usage: null };
    if (!body || typeof body !== 'object') return unreadable;
    const b = body as { choices?: unknown; usage?: unknown; model?: unknown; gatewayMetadata?: { keySource?: unknown } };
    const choice = Array.isArray(b.choices) ? (b.choices[0] as { message?: Record<string, unknown>; finish_reason?: unknown } | undefined) : undefined;
    if (!choice || !choice.message || typeof choice.message !== 'object') return unreadable;
    const read = chatUsage(b.usage);
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
    // The model declined: permanent, and its usage is kept for reconciliation.
    if (text(choice.message.refusal) || finishReason === 'content_filter') {
      return { ok: false, error: 'refused', status, code: null, retryAfterSec: null, completion: 'unknown', logId, usage: read?.usage ?? null };
    }
    const output = text(choice.message.content);
    if (output == null) return { ...unreadable, usage: read?.usage ?? null };
    return {
      ok: true, output, usage: read?.usage ?? null, reasoningTokens: read?.reasoning ?? null,
      servedModel: typeof b.model === 'string' ? b.model : null,
      keySource: typeof b.gatewayMetadata?.keySource === 'string' ? b.gatewayMetadata.keySource : null,
      finishReason, logId,
    };
  },
};

/**
 * A gateway log entry (`env.AI.gateway(id).getLog(logId)`, workers-types'
 * `AiGatewayLog`) carries no prompt or answer: no request or response head.
 * The owner's hosted check reads the slice's own log entries with it before the
 * switch goes on (D4556 §4); it is not called on any request path.
 */
export function logCarriesNoPayload(log: { request_head?: unknown; response_head?: unknown } | null | undefined): boolean {
  if (!log || typeof log !== 'object') return false;
  const empty = (v: unknown) => v == null || (typeof v === 'string' && v.length === 0);
  return empty(log.request_head) && empty(log.response_head);
}
