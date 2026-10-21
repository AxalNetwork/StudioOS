/**
 * D843 (#2465) — one attributable row per MCP tool call and API-key request,
 * in `api_usage_events` (migration 524).
 *
 * A ROW NEVER FAILS THE CALL. `recordUsage` catches its own failure and logs a
 * warning with the execution id and the error's message only; the call it
 * describes still answers.
 *
 * WHAT A ROW HOLDS: who (user, API key or OAuth grant, client), where
 * (company), what (operation), how it ended (outcome and error category) and
 * how long it took. Never an argument, a result or a secret.
 *
 * UNKNOWN IS NULL. The money and model fields stay NULL until metering
 * (#2466) or a provider (#2474) passes them; a NULL means "not metered", and
 * this module never writes 0 in its place.
 */
import type { Env } from '../types';

/** Where the call came in. */
export type UsageSurface = 'mcp' | 'api';

/** How a call ended. The same four words as the `activity_logs` line. */
export type UsageOutcome = 'ok' | 'refused' | 'error' | 'rate_limited';

/**
 * The fixed list of reasons a call did not succeed (D843). The reports (#2471)
 * and the UI (#2481) read this list; a new reason is a new decision.
 */
export const USAGE_ERROR_CATEGORIES = Object.freeze([
  'auth', 'scope', 'company', 'rate_limited', 'insufficient_tokens', 'timeout', 'provider', 'invalid_input', 'internal',
] as const);
export type UsageErrorCategory = typeof USAGE_ERROR_CATEGORIES[number];

export interface UsageEvent {
  executionId: string;
  userId: number;
  surface: UsageSurface;
  operation: string;
  outcome: UsageOutcome;
  durationMs: number;
  errorCategory?: UsageErrorCategory | null;
  apiKeyUid?: string | null;
  grantId?: string | null;
  client?: string | null;
  companyId?: number | null;
  reservationUid?: string | null;
  heldMicrousd?: number | null;
  chargedMicrousd?: number | null;
  model?: string | null;
  provider?: string | null;
  connector?: string | null;
}

/** A fresh execution id: a random UUID. */
export function newExecutionId(): string {
  return crypto.randomUUID();
}

/** A whole, non-negative micro-USD amount, or NULL. Never turns "unknown" into 0. */
function microusd(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

/** Writes one row. Never throws: a failed write is a warning, and the call still answers. */
export async function recordUsage(env: Env, row: UsageEvent): Promise<boolean> {
  try {
    const category = row.outcome === 'ok' ? null
      : (row.errorCategory && (USAGE_ERROR_CATEGORIES as readonly string[]).includes(row.errorCategory) ? row.errorCategory : 'internal');
    await env.DB.prepare(
      `INSERT INTO api_usage_events
         (execution_id, user_id, api_key_uid, grant_id, client, company_id, surface, operation, outcome,
          error_category, duration_ms, reservation_uid, held_microusd, charged_microusd, model, provider, connector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.executionId, row.userId, row.apiKeyUid ?? null, row.grantId ?? null, row.client ?? null,
      row.companyId ?? null, row.surface, row.operation, row.outcome, category,
      Math.max(0, Math.round(row.durationMs)), row.reservationUid ?? null,
      microusd(row.heldMicrousd), microusd(row.chargedMicrousd),
      row.model ?? null, row.provider ?? null, row.connector ?? null,
    ).run();
    return true;
  } catch (e) {
    // A constant message; the id and the error ride as separate arguments.
    console.warn('[api-usage] could not record a usage row', row.executionId, (e as Error)?.message || 'unknown');
    return false;
  }
}
