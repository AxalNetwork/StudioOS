/**
 * D4708 (#4708) — how the Security ledger and its Data access zone word a stored row: names, reasons, clipped
 * text, minute stamps, and a support session's outcome. Moved from `routes/admin_security.ts` unchanged.
 */
import { supportSessionStatus, parseStoredTs, type SupportSessionStatus } from '../sessionStatus';
import type { Identity } from '../securityIdentity';

export type ImpersonationRow = Record<string, unknown>;

/** The sentence a feed or Data access half carries when `impersonation_sessions` could not be read. */
export const IMPERSONATION_UNREADABLE = 'The impersonation_sessions table could not be read on this database.';

/** SQLite's `datetime('now')` is 'YYYY-MM-DD HH:MM:SS' (UTC, no zone); D4691 — one parser, shared with the status rules. */
export const parseSqlTs = (s: string | null | undefined): number => parseStoredTs(s);

/** A person, by the best name the join gave — never a bare id passed off as one. */
export const who = (name: unknown, email: unknown, id: unknown): string | null =>
  (name ? String(name) : null) || (email ? String(email) : null) || (id ? `user ${id}` : null);

/** D4691 — a feed row's two actor fields from one identity, so they cannot disagree. */
export const actorOf = (identity: Identity) => ({ actor: identity.label, actor_identity: identity });

/** `filters_json` is free-form. Only a non-empty string `reason` is lifted out. */
export function reasonFrom(json: unknown): string | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return typeof v?.reason === 'string' && v.reason.trim() ? v.reason.trim() : null;
  } catch { return null; }
}

export const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/**
 * A timestamp, trimmed to the minute and with the ISO 'T' flattened.
 *
 * The data-access rows are built as pre-joined sentences, and the two halves
 * come from stores that stamp differently — `impersonation_sessions` uses
 * SQLite's 'YYYY-MM-DD HH:MM:SS', `admin_audit_log` sometimes holds full ISO
 * with a 'T' and milliseconds. Side by side in one zone they read as two
 * different kinds of fact, so both are flattened to the same shape here.
 */
export const stamp = (v: unknown) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
/** Whole minutes between two epochs, floored at zero. */
export const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60000));

/**
 * D200 — an impersonation's outcome for the ledger column, on the same rule
 * the Data access zone below applies to its own rows: an open row past the
 * token's expiry means the record was never closed, not that somebody is
 * still inside.
 */
const OUTCOME_OF: Record<SupportSessionStatus, 'live' | 'ended' | 'not closed' | 'unknown'> = {
  live: 'live', ended: 'ended', not_closed: 'not closed', unknown: 'unknown',
};
export function impersonationOutcome(i: ImpersonationRow, now: number): 'live' | 'ended' | 'not closed' | 'unknown' {
  // D4691 — the shared rule, so this column, the Data access zone, the
  // overview's count and the Sessions list cannot disagree about one row.
  return OUTCOME_OF[supportSessionStatus(i, now)];
}
