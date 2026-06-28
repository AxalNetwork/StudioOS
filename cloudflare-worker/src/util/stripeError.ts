// Task #25 — Stripe error classification for resilient billing reads.
//
// `stripeCall` throws a `StripeApiError` carrying the HTTP status and the
// parsed Stripe `error.code`/`error.type` so callers can branch on the *kind*
// of failure instead of regex-parsing a message string. The billing overview
// uses this to keep the Settings → Billing tab rendering when a single Stripe
// call fails, while still surfacing a genuine misconfiguration explicitly.

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly type: string | null;

  constructor(status: number, body: string) {
    // Preserve the legacy `stripe_error:STATUS:body` message shape so existing
    // callers that read `.message` keep working unchanged.
    super(`stripe_error:${status}:${body.slice(0, 200)}`);
    this.name = 'StripeApiError';
    this.status = status;
    let code: string | null = null;
    let type: string | null = null;
    try {
      const parsed = JSON.parse(body) as {
        error?: { code?: string; type?: string };
      };
      code = parsed.error?.code ?? null;
      type = parsed.error?.type ?? null;
    } catch {
      // Non-JSON body — leave code/type null; classification falls back to
      // status + message heuristics.
    }
    this.code = code;
    this.type = type;
  }
}

export type StripeErrorKind = 'resource_missing' | 'auth' | 'other';

// Classify a thrown Stripe error:
//   'resource_missing' — the referenced object (e.g. a customer) does not exist
//     under the active key. Classic after a test→live cutover: a stored
//     test-mode `cus_…` can't be found by a live key. Recoverable — treat as
//     "no customer".
//   'auth' — bad / expired / wrong-mode secret key. Hard misconfiguration that
//     must be surfaced, not silently swallowed.
//   'other' — anything else (transient 5xx, rate limit, etc.).
//
// Falls back to parsing the legacy `stripe_error:STATUS:body` message for any
// throw that is not a `StripeApiError`.
export function classifyStripeError(e: unknown): StripeErrorKind {
  if (e instanceof StripeApiError) {
    if (e.code === 'resource_missing') return 'resource_missing';
    if (
      e.status === 401 ||
      e.type === 'authentication_error' ||
      e.code === 'api_key_expired'
    ) {
      return 'auth';
    }
    return 'other';
  }
  const msg = (e as { message?: string } | null)?.message ?? '';
  const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
  if (m) {
    const status = Number(m[1]);
    const body = m[2];
    if (/resource_missing|No such customer/i.test(body)) return 'resource_missing';
    if (status === 401 || /authentication_error|api_key_expired|Invalid API Key/i.test(body)) {
      return 'auth';
    }
  }
  return 'other';
}

export type CoreOutcome = 'ok' | 'customer_missing' | 'unavailable';

// Decide the billing-overview outcome from the per-section failure kinds of the
// CORE sections (subscriptions, payment methods, customer, invoices). `null`
// means that section succeeded.
//   - any 'resource_missing'  → 'customer_missing' (graceful empty + self-heal)
//   - any 'auth'              → 'unavailable' (explicit, friendly-mapped error)
//   - every section failed    → 'unavailable' (don't render a misleading empty page)
//   - otherwise               → 'ok' (render, degrading any failed section to empty)
export function resolveCoreOutcome(kinds: (StripeErrorKind | null)[]): CoreOutcome {
  if (kinds.some((k) => k === 'resource_missing')) return 'customer_missing';
  if (kinds.some((k) => k === 'auth')) return 'unavailable';
  if (kinds.length > 0 && kinds.every((k) => k !== null)) return 'unavailable';
  return 'ok';
}
