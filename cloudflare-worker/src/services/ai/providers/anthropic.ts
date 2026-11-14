/**
 * D851 (#2474): Anthropic's Messages API (`POST https://api.anthropic.com/v1/messages`),
 * as `D851.md` §1 records it from Anthropic's pages, read 2026-10-21.
 *
 * - The key goes in `x-api-key`, with `anthropic-version: 2023-06-01`.
 * - The answer is the text of its `text` content blocks, in order.
 * - USAGE. `input_tokens` is the uncached input only; cache writes and cache
 *   reads are reported beside it (`cache_creation_input_tokens`,
 *   `cache_read_input_tokens`), each at its own rate. A response with no
 *   readable `input_tokens` or `output_tokens` reports no usage (null), and is
 *   never read as zero. The cache fields are 0 when absent: Anthropic omits
 *   them only when nothing was cached.
 * - ERRORS. The status decides, except a 429 whose body says
 *   `enforced_spend_limit_reached`: that is the platform account's spend cap,
 *   not a rate limit, and is not retried.
 */
import type { ProviderUnit } from '../catalogue';
import type { ProviderAdapter, ProviderErrorKind, ProviderOutcome } from './types';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

const count = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

function usageOf(u: unknown): Record<ProviderUnit, number> | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const input = count(r.input_tokens);
  const output = count(r.output_tokens);
  if (input == null || output == null) return null;
  const write = r.cache_creation_input_tokens == null ? 0 : count(r.cache_creation_input_tokens);
  const read = r.cache_read_input_tokens == null ? 0 : count(r.cache_read_input_tokens);
  if (write == null || read == null) return null;
  return { tokens_in: input, tokens_cache_write: write, tokens_cached: read, tokens_out: output };
}

function errorKind(status: number, body: unknown): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) {
    const code = (body as { error?: { details?: { error_code?: unknown } } } | null)?.error?.details?.error_code;
    return code === 'enforced_spend_limit_reached' ? 'spend_limit' : 'rate_limited';
  }
  if (status === 529) return 'overloaded';
  if (status >= 400 && status < 500) return 'invalid';
  return 'server';
}

export const anthropic: ProviderAdapter = {
  build(apiModel, req, apiKey) {
    return {
      url: ANTHROPIC_MESSAGES_URL,
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: req.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(req.temperature == null ? {} : { temperature: req.temperature }),
      }),
    };
  },

  read(status, body, header): ProviderOutcome {
    const requestId = header('request-id');
    if (status < 200 || status >= 300) {
      // Absent is unknown, never 0 (`Number(null)` is 0).
      const raw = header('retry-after');
      const retry = raw == null || raw.trim() === '' ? NaN : Number(raw);
      return { ok: false, error: errorKind(status, body), status, retryAfterSec: Number.isFinite(retry) && retry >= 0 ? retry : null, requestId };
    }
    const content = (body as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return { ok: false, error: 'server', status, retryAfterSec: null, requestId };
    const output = content
      .filter((b): b is { type: 'text'; text: string } => !!b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return { ok: true, output, usage: usageOf((body as { usage?: unknown }).usage), requestId };
  },
};
