/**
 * D851 (#2474): the one shape every model-provider adapter has. An adapter is
 * pure: it builds the provider's HTTP request from plain values and reads the
 * provider's answer back into plain values. It never reads `env`, never holds
 * or settles, and never logs. `../../aiProviders.ts` does the calling, the
 * hold, the settlement and the usage row, the same way for every provider.
 */
import type { ProviderUnit } from '../catalogue';

export interface ProviderMessage { role: 'user' | 'assistant'; content: string }

/** What a run asks of a model. */
export interface ProviderRequest {
  system?: string;
  messages: readonly ProviderMessage[];
  maxTokens: number;
  temperature?: number;
}

/** The HTTP request an adapter builds. The key travels in a header and nowhere else. */
export interface ProviderHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Why a provider did not answer, read from its status and error body:
 * - `auth`: the platform key was refused (401, 403);
 * - `invalid`: the request was refused as malformed or too large (400, 404, 413, 422);
 * - `billing`: the platform's own provider account cannot pay (402);
 * - `rate_limited`: over the provider's rate limit (429), retryable;
 * - `spend_limit`: the platform's provider account hit its spend cap (429, not retryable);
 * - `overloaded`: the provider is overloaded (529), retryable;
 * - `server`: the provider failed (5xx), or its answer could not be read.
 *
 * D4556 (#4556) adds three, which only the AI Gateway path reads today:
 * - `refused`: the model declined the request (a `refusal`, or a content
 *   filter); permanent, never retried;
 * - `timeout`: no answer within the limit. The provider may still have done the
 *   work, so a timeout is never read as "no work done";
 * - `unknown`: the call failed in a way that does not say whether it reached the
 *   provider. Never retried, for the same reason.
 */
export type ProviderErrorKind = 'auth' | 'invalid' | 'billing' | 'rate_limited' | 'spend_limit' | 'overloaded' | 'server'
  | 'refused' | 'timeout' | 'unknown';

export type ProviderOutcome =
  | {
    ok: true;
    output: string;
    /** The provider's own counts, or null when it reported none it could be read from. Never guessed. */
    usage: Record<ProviderUnit, number> | null;
    requestId: string | null;
  }
  | { ok: false; error: ProviderErrorKind; status: number; retryAfterSec: number | null; requestId: string | null };

export interface ProviderAdapter {
  build(apiModel: string, req: ProviderRequest, apiKey: string): ProviderHttpRequest;
  /** Read a response: its status, its parsed JSON body (null when it was not JSON) and a header reader. */
  read(status: number, body: unknown, header: (name: string) => string | null): ProviderOutcome;
}

/**
 * D4556 (#4556): a third-party model reached through AI Gateway on the Workers
 * AI binding (`env.AI.run(model, input, { gateway })`, Path A). There is no key:
 * Cloudflare holds the provider's credential (Unified Billing). The adapter is as
 * pure as `ProviderAdapter`: it builds the model's input object and reads the raw
 * response (`returnRawResponse`) back into plain values.
 *
 * `completion` says whether the provider may have done billable work:
 * `none` when the gateway refused before the provider ran (auth, balance, rate
 * limit, a malformed request), `unknown` otherwise (a timeout, a 5xx from
 * upstream, a 2xx whose body could not be read). `unknown` is reconciled from the
 * gateway's log, never assumed to be zero.
 */
export type GatewayOutcome =
  | {
    ok: true;
    output: string;
    /** Reported counts per priced unit, or null when none could be read. Never guessed. */
    usage: Record<string, number> | null;
    /** Reasoning tokens, already inside `tokens_out`; recorded, never billed twice. */
    reasoningTokens: number | null;
    /** The model the answer names (`model` in the body), so the run can pin it. */
    servedModel: string | null;
    /** `gatewayMetadata.keySource`: `Unified` is Cloudflare's credential. */
    keySource: string | null;
    finishReason: string | null;
    /** The gateway's log id (`cf-aig-log-id`), for reconciliation. */
    logId: string | null;
  }
  | {
    ok: false;
    error: ProviderErrorKind;
    status: number;
    /** AI Gateway's numeric error code (2018, 7005, …), when the body carried one. */
    code: number | null;
    retryAfterSec: number | null;
    completion: 'none' | 'unknown';
    logId: string | null;
    /** A refused answer's reported usage, recorded for reconciliation; null otherwise. */
    usage: Record<string, number> | null;
  };

export interface GatewayAdapter {
  /** The model's own input object, passed straight to `env.AI.run` (never wrapped in `input`). */
  input(req: ProviderRequest): Record<string, unknown>;
  read(status: number, body: unknown, header: (name: string) => string | null): GatewayOutcome;
}
