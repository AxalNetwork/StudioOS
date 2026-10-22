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
 */
export type ProviderErrorKind = 'auth' | 'invalid' | 'billing' | 'rate_limited' | 'spend_limit' | 'overloaded' | 'server';

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
