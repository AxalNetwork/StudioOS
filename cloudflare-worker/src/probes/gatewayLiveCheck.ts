/**
 * D4870 part 2 (#4870): the throwaway Worker for the hosted gateway live check
 * (owner decision Q2 = A, 2026-11-14). NEVER PRODUCTION: it is the `main` of a
 * flat config `scripts/gateway-live-check.mjs` writes for `studioos-s4870-<run>`
 * on workers.dev, with the `AI` binding and nothing else, and deletes after.
 * Production's `main` stays `src/index.ts` and never imports this file.
 *
 * ONE CALL, `POST /check` with the run's token: the synthetic prompt below, on
 * `openai/gpt-5-mini` through the owner's gateway, built exactly as
 * `aiProviders.ts` `callGateway` builds it (the router's option, the payload
 * header off, the raw response), read by D4556's adapter, then that call's log
 * entry read with `logCarriesNoPayload`. The answer holds states, counts and
 * amounts only: never the answer's text, a log head or the gateway's metadata.
 */
import { chatCompletions, logCarriesNoPayload } from '../services/ai/providers/gateway';
import { GATEWAY_TEXT_MODELS } from '../services/ai/catalogue';
import { usdRatesBilledMicro } from '../services/ai/pricing';
import { providerGatewayOptionFor } from '../services/aiRouter';
import { GATEWAY_LOG_PAYLOAD_HEADER } from '../services/aiProviders';
import type { Env } from '../types';
import type { GatewayOutcome } from '../services/ai/providers/types';

/** Synthetic and public: no member, venture or account data. */
export const PROBE_REQUEST = Object.freeze({
  system: 'You answer with one word.',
  messages: Object.freeze([Object.freeze({ role: 'user' as const, content: 'Reply with the single word: ready' })]),
  maxTokens: 256,
});
const CALL_TIMEOUT_MS = 30_000;
const LOG_READS = 6;
const LOG_WAIT_MS = 3_000;

type ProbeEnv = Env & { PROBE_TOKEN?: string; CF_AI_GATEWAY_SLUG_PROVIDERS?: string; AI_GATEWAY_PROVIDERS_ZDR?: string };
type RawResponse = { status: number; headers: { get(n: string): string | null }; json(): Promise<unknown> };
type GatewayLog = { tokens_in?: number; tokens_out?: number; cost?: number; request_head?: unknown; response_head?: unknown };
type AiBinding = {
  run(model: string, input: unknown, options: Record<string, unknown>): Promise<unknown>;
  gateway(id: string): { getLog(logId: string): Promise<GatewayLog> };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sameToken(given: string | null, want: string | undefined): Promise<boolean> {
  if (!given || !want || want.length < 32) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(want)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Whether `runGatewayTextModel` would have written this call's row with `reconcile: 'gateway_log'`. */
export function reconcileMarked(out: GatewayOutcome, pinned: boolean): 0 | 1 {
  if (!out.ok) return out.completion === 'unknown' ? 1 : 0;
  return !pinned || !out.usage ? 1 : 0;
}

export async function runProbe(env: ProbeEnv, run: string, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  const m = GATEWAY_TEXT_MODELS[0];
  const slug = env.CF_AI_GATEWAY_SLUG_PROVIDERS;
  const ai = env.AI as AiBinding | undefined;
  if (!slug || env.AI_GATEWAY_PROVIDERS_ZDR !== 'on' || !ai) return { error: 'misconfigured' as const };

  const option = providerGatewayOptionFor(slug, env, { task: 'publication', userId: 0, executionId: `s4870:live:${run}` }, CALL_TIMEOUT_MS);
  const started = Date.now();
  let out: GatewayOutcome;
  try {
    const raw = await ai.run(m.id, chatCompletions.input(PROBE_REQUEST), {
      ...option, extraHeaders: { [GATEWAY_LOG_PAYLOAD_HEADER]: 'false' }, returnRawResponse: true, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    }) as RawResponse;
    const body = await raw.json().catch(() => null);
    out = chatCompletions.read(raw.status, body, (n) => raw.headers.get(n));
  } catch {
    out = { ok: false, error: 'unknown', status: 0, code: null, retryAfterSec: null, completion: 'unknown', logId: null, usage: null };
  }
  const latency = Date.now() - started;
  const pinned = out.ok && !!out.servedModel?.startsWith(m.servedModelPrefix) && out.keySource === 'Unified';

  // The log entry may land after the answer: a few bounded reads, then "absent".
  let log: { state: 'absent' | 'no_payload' | 'payload_present' | 'no_log_id'; tokens_in?: number | null; tokens_out?: number | null; cost_usd?: number | null; reads: number } = { state: 'no_log_id', reads: 0 };
  if (out.logId) {
    log = { state: 'absent', reads: 0 };
    for (let i = 0; i < LOG_READS; i++) {
      log.reads = i + 1;
      let entry: GatewayLog | null = null;
      try { entry = await ai.gateway(slug).getLog(out.logId); } catch { entry = null; }
      if (entry) {
        log = {
          state: logCarriesNoPayload(entry) ? 'no_payload' : 'payload_present', reads: i + 1,
          tokens_in: Number.isFinite(entry.tokens_in) ? entry.tokens_in! : null,
          tokens_out: Number.isFinite(entry.tokens_out) ? entry.tokens_out! : null,
          cost_usd: Number.isFinite(entry.cost) ? entry.cost! : null,
        };
        break;
      }
      if (i < LOG_READS - 1) await sleep(LOG_WAIT_MS);
    }
  }

  return {
    model: m.id,
    latency_ms: latency,
    call: out.ok
      ? { ok: true, status: 200, finish_reason: out.finishReason, output_chars: out.output.length }
      : { ok: false, status: out.status, error: out.error, completion: out.completion, code: out.code },
    pin: out.ok ? { served_model_ok: !!out.servedModel?.startsWith(m.servedModelPrefix), key_source: out.keySource } : null,
    usage: out.ok ? out.usage : null,
    reasoning_tokens: out.ok ? out.reasoningTokens : null,
    // D851's settled provider charge for the reported usage, at multiplier 1 (no member markup).
    charge: { settled_microusd: out.ok && out.usage ? usdRatesBilledMicro(m.rates, out.usage, 1) : null, rates: { ...m.rates } },
    log,
    reconcile_marked: reconcileMarked(out, pinned),
  };
}

export default {
  async fetch(req: Request, env: ProbeEnv): Promise<Response> {
    const url = new URL(req.url);
    // Never on production: the probe config sets this, production never does.
    if (env.ENVIRONMENT !== 'preview' || env.STUDIOOS_ENV === 'production') return json({ error: 'not_found' }, 404);
    if (req.method !== 'POST' || url.pathname !== '/check') return json({ error: 'not_found' }, 404);
    if (!(await sameToken(req.headers.get('x-probe-token'), env.PROBE_TOKEN))) return json({ error: 'forbidden' }, 403);
    const run = (url.searchParams.get('run') || '').replace(/[^a-z0-9]/g, '').slice(0, 20) || 'run';
    return json(await runProbe(env, run));
  },
};
