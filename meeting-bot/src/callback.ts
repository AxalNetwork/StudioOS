/**
 * D886 B2 (#2580): the callback client, over HTTP, to B1's Worker routes.
 *
 * B1 (#2579) owns the contract: an HMAC-signed callback for status, roster and
 * speaker events, and a one-time signed URL per audio chunk. Until B1
 * publishes its routes, the paths live in `CALLBACK_PATHS` and the signature
 * in `signRequest`, so aligning with B1 is a change to those two and nothing
 * else.
 *
 * Every request has a deadline and refuses redirects. An error carries the
 * HTTP status only: never a URL, a body or a header, so nothing about the
 * meeting reaches a log line through it.
 */
import type { BotEvent, CallbackTransport, StatusReport } from './types.ts';

/** PROVISIONAL until B1's contract (#2579): relative to the run's callback base URL. */
export const CALLBACK_PATHS = Object.freeze({
  status: 'status',
  events: 'events',
  chunkUrl: (seq: number) => `chunks/${seq}`,
});

export const REQUEST_TIMEOUT_MS = 30000;

/** A callback that did not go through. `status` 0 means no HTTP answer at all. */
export class TransportError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`callback_${status}`);
    this.name = 'TransportError';
    this.status = status;
  }
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * PROVISIONAL until B1: HMAC-SHA256 over `<run id>.<unix seconds>.<body>`,
 * keyed with the run's callback key, sent as three `x-axal-bot-*` headers.
 */
export async function signRequest(key: string, runId: string, body: string, nowMs: number): Promise<Record<string, string>> {
  const ts = String(Math.floor(nowMs / 1000));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${runId}.${ts}.${body}`));
  return { 'x-axal-bot-run': runId, 'x-axal-bot-ts': ts, 'x-axal-bot-signature': hex(sig) };
}

export interface HttpTransportOptions {
  /** The run's callback base, https, ending in `/`. */
  readonly baseUrl: string;
  readonly runId: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export function httpTransport(opts: HttpTransportOptions): CallbackTransport {
  const base = new URL(opts.baseUrl);
  if (base.protocol !== 'https:' || !base.pathname.endsWith('/')) throw new TransportError(0);
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const send = async (url: URL, init: RequestInit): Promise<Response> => {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new TransportError(0);
    }
    if (!res.ok) throw new TransportError(res.status);
    return res;
  };

  const post = async (path: string, payload: unknown): Promise<Response> => {
    const body = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', ...(await signRequest(opts.key, opts.runId, body, now())) };
    return send(new URL(path, base), { method: 'POST', headers, body });
  };

  return {
    async status(report: StatusReport) { await post(CALLBACK_PATHS.status, report); },
    async events(batch: readonly BotEvent[]) { await post(CALLBACK_PATHS.events, { events: batch }); },
    async putChunk(seq: number, wav: Uint8Array<ArrayBuffer>) {
      const res = await post(CALLBACK_PATHS.chunkUrl(seq), { seq, bytes: wav.byteLength });
      let target: URL;
      try {
        const { url } = (await res.json()) as { url?: unknown };
        target = new URL(String(url));
      } catch {
        throw new TransportError(0);
      }
      if (target.protocol !== 'https:') throw new TransportError(0);
      await send(target, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: wav });
    },
  };
}
