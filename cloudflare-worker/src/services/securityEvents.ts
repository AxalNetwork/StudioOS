/**
 * D200 — the security_events ledger: refusals and step-ups at the auth
 * boundary, recorded where HQ can count them.
 *
 * THE RULE, stated once so every writer site inherits it: THIS LEDGER RECORDS
 * REFUSALS AND STEP-UPS, NEVER A SIGN-IN SUCCESS. `activity_logs` already
 * holds `user_login`, `user_login_google`, `user_login_passkey`,
 * `user_login_magic` and `user_login_sms`, written after each successful
 * sign-in. A second copy of those here would be two ledgers counting one
 * event — the tile-versus-table disagreement D128 ended, one store over — and
 * the day one of them missed a write, HQ's Security page would carry two
 * different numbers for "sign-ins today". The one `ok` row this table admits
 * is a GRANTED STEP-UP, because `POST /auth/step-up` overwrites a single
 * column (`user_sessions.last_step_up_at`) and leaves no trail of its own.
 * `cloudflare-worker/test/security_events_d200.test.ts` asserts a successful
 * /login writes nothing here.
 *
 * NEVER THROWS, and that is the whole contract. `recordSecurityEvent` sits
 * inside refusal paths that already carry their own status (401, 403, 410).
 * A recorded refusal must never be undone by its own telemetry — the rule
 * `middleware/observability.ts` and `services/auditMirror.ts` both state —
 * so every failure here becomes a return value the caller may ignore. A
 * database that has not applied migration 282 refuses exactly as it did
 * before this file existed; the only thing that changes is that HQ's
 * counter reads "Unreadable" instead of a number.
 *
 * THE SUBJECT IS A HASH. The address a refused attempt named may belong to
 * nobody, so it is never stored: `subject_key` is `hashEmail`'s 16-hex
 * SHA-256, the key `activity_logs.actor` already uses for the same reason.
 * The network is the /24 (IPv4) or ::/48 (IPv6) bucket the login path already
 * used for `turnstile_failed`; `ipPrefix` below is that computation, lifted
 * out of the two inline copies `routes/auth.ts` carried so a third could not
 * drift from them.
 *
 * ONE ROW PER MINUTE PER (kind, factor, outcome, subject, network). The
 * INSERT is `OR IGNORE` against migration 282's UNIQUE tuple, so a burst of
 * refusals from one network against one address inside one minute is one
 * row. That bound is what makes a writer on an unauthenticated path safe to
 * ship: the table grows with distinct (subject, network, minute) triples,
 * not with attempts. `minute` and `occurred_at` are both taken from SQLite's
 * 'now' inside the one statement so they cannot straddle a boundary.
 * `detail` is not in the key: the row keeps the FIRST refusal's reason in
 * that minute, and a later refusal with a different reason from the same
 * subject and network in the same minute is the same row.
 *
 * WHAT THIS LEDGER DOES NOT COUNT, each with the reason the page shows:
 * see SECURITY_EVENTS_NOT_COUNTED. The canvas (H23) draws `key.reveal` and
 * `branch.read timeout` rows; neither is a producer this platform has, and a
 * row invented for the drawing would be a claim about an event nobody
 * measured.
 */
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';
import { branchOf } from '../util/branch';

export const SECURITY_EVENT_KINDS = ['signin', 'step_up', 'gate', 'recovery'] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export type SecurityEventOutcome = 'ok' | 'refused';

/**
 * Retention, in days. Migration 282's delete trigger carries the same number
 * as a literal (`datetime('now', '-90 days')`) and refuses any delete inside
 * it; `security_events_d200.test.ts` slices the migration off disk and
 * asserts the two agree, so changing one without the other fails the build.
 */
export const SECURITY_EVENT_RETENTION_DAYS = 90;

/**
 * What H23 draws that this ledger deliberately does not record. Rendered on
 * the Security page beside the counters so an absence reads as a decision
 * rather than an oversight.
 */
export const SECURITY_EVENTS_NOT_COUNTED: ReadonlyArray<{ what: string; reason: string }> = [
  {
    what: 'Sign-in successes',
    reason:
      'activity_logs already records every successful sign-in by factor; a second copy here would be two ledgers counting one event.',
  },
  {
    what: 'Integration key reveals',
    reason:
      'No reveal exists to record: an integration key is promoted to a Worker secret when it is saved and is never read back (D.10).',
  },
  {
    what: 'Branch read timeouts',
    reason:
      'A fan-out that cannot read a branch reports that state on the page that asked and records it nowhere; making it an event is its own producer.',
  },
  {
    what: 'Rate-limit blocks',
    reason:
      'Throttling is not a credential refusal and already has its own ledger, rate_limit_logs.',
  },
];

/**
 * The /24 (IPv4) or ::/48 (IPv6) bucket of a client address, or 'unknown'.
 *
 * ONE DEFINITION. `routes/auth.ts` carried this computation inline twice —
 * once under /register's Turnstile refusal and once under /login's — and
 * this ledger would have been the third copy. A bucket, not an address, on
 * purpose: the ledger records which NETWORK a refusal came from, which is
 * what an incident review asks, without storing an address that identifies a
 * person. 'unknown' rather than '' or null because migration 282's UNIQUE
 * tuple has to be able to collapse two refusals with no address, and a NULL
 * in a UNIQUE tuple deduplicates nothing.
 */
export function ipPrefix(ip: string | null | undefined): string {
  const raw = String(ip || '').trim();
  if (!raw) return 'unknown';
  if (raw.includes(':')) {
    const parts = raw.split(':').slice(0, 3).join(':');
    return parts ? `${parts}::/48` : 'unknown';
  }
  const octets = raw.split('.');
  if (octets.length !== 4) return 'unknown';
  return `${octets.slice(0, 3).join('.')}.0/24`;
}

export interface SecurityEventInput {
  kind: SecurityEventKind;
  factor: string;
  outcome: SecurityEventOutcome;
  /** The refusal's own code — never free text, never the message a user saw. */
  detail?: string | null;
  userId?: number | null;
  /** Hashed before it is stored; the address itself never reaches the row. */
  email?: string | null;
  /** Bucketed before it is stored; the address itself never reaches the row. */
  ip?: string | null;
}

export type SecurityEventResult =
  | { recorded: true; deduped: false }
  | { recorded: false; deduped: true }
  | { recorded: false; deduped: false; reason: string };

const INSERT_SQL = `INSERT OR IGNORE INTO security_events
  (kind, factor, outcome, detail, user_id, subject_key, ip_prefix, branch_code, minute, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M', 'now'), datetime('now'))`;

/**
 * Record one refusal or step-up. Never throws; a failure is a return value.
 *
 * `branchOf` THROWS on a malformed BRANCH_CODE, deliberately (`util/branch.ts`:
 * a branch Worker that quietly ran as HQ would serve HQ's console over branch
 * data). It is called inside the try so that a malformed code costs a dropped
 * event, not a failed refusal — the same reasoning `observability.ts` gives
 * for its own write.
 */
export async function recordSecurityEvent(env: Env, ev: SecurityEventInput): Promise<SecurityEventResult> {
  try {
    if (!env?.DB) return { recorded: false, deduped: false, reason: 'no database binding' };
    if (!(SECURITY_EVENT_KINDS as readonly string[]).includes(ev.kind)) {
      return { recorded: false, deduped: false, reason: `unknown kind ${String(ev.kind)}` };
    }
    if (ev.outcome !== 'ok' && ev.outcome !== 'refused') {
      return { recorded: false, deduped: false, reason: `unknown outcome ${String(ev.outcome)}` };
    }
    const factor = String(ev.factor || '').trim();
    if (!factor) return { recorded: false, deduped: false, reason: 'factor is required' };
    const subjectKey = ev.email ? await hashEmail(ev.email) : '';
    const branch = branchOf(env) || 'hq';
    const res = await env.DB.prepare(INSERT_SQL)
      .bind(
        ev.kind,
        factor,
        ev.outcome,
        ev.detail ? String(ev.detail).slice(0, 80) : null,
        typeof ev.userId === 'number' && Number.isFinite(ev.userId) ? ev.userId : null,
        subjectKey,
        ipPrefix(ev.ip),
        branch,
      )
      .run();
    const changes = Number(res?.meta?.changes ?? 0);
    if (changes === 0) return { recorded: false, deduped: true };
    return { recorded: true, deduped: false };
  } catch (e) {
    // A recorded refusal must never be undone by its own telemetry.
    console.warn('[securityEvents] record failed', e instanceof Error ? e.message : String(e));
    return { recorded: false, deduped: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type PruneResult = { readable: true; deleted: number } | { readable: false; reason: string };

/**
 * The nightly sweep. Deletes only what migration 282's trigger admits — rows
 * older than SECURITY_EVENT_RETENTION_DAYS — and never anything younger; the
 * two comparisons are complementary by construction (`<` here, `>=` in the
 * trigger, on the same `datetime()` normalisation).
 *
 * `datetime(occurred_at)` on the left because that is the column named in
 * `scripts/check-timestamp-comparisons.mjs`'s TTL list, added in the same
 * commit that created it: a bare `occurred_at < datetime(...)` compares a
 * SQL-format stamp lexically against a value that may not share its format,
 * which is the D124/D125/D160 class this guard exists for.
 */
export async function pruneSecurityEvents(env: Env): Promise<PruneResult> {
  try {
    const res = await env.DB.prepare(
      `DELETE FROM security_events WHERE datetime(occurred_at) < datetime('now', ?)`,
    )
      .bind(`-${SECURITY_EVENT_RETENTION_DAYS} days`)
      .run();
    return { readable: true, deleted: Number(res?.meta?.changes ?? 0) };
  } catch (e) {
    return { readable: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type SecurityEventCounts =
  | { available: true; today: number; failed_signins_24h: number }
  | { available: false; reason: string };

/**
 * The two figures HQ's Security page draws: rows written since midnight UTC
 * (H23's `N rows today`) and refused sign-ins in the last 24 hours (the
 * "Failed sign-ins" stat that rendered `null` under a store that did not
 * exist).
 *
 * UNREADABLE IS NOT ZERO. A database without migration 282 — or one whose
 * read fails — answers `available: false` with the reason, never `today: 0`:
 * "nothing was refused today" and "the ledger could not be read" are
 * different claims, and only the first is a statement about the platform.
 */
export async function loadSecurityEventCounts(env: Env): Promise<SecurityEventCounts> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN datetime(occurred_at) >= datetime('now', 'start of day') THEN 1 ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE WHEN kind = 'signin' AND outcome = 'refused'
                            AND datetime(occurred_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS failed_signins_24h
       FROM security_events`,
    ).first<{ today: number; failed_signins_24h: number }>();
    if (!row) return { available: false, reason: 'The security_events ledger answered no row.' };
    return {
      available: true,
      today: Number(row.today ?? 0),
      failed_signins_24h: Number(row.failed_signins_24h ?? 0),
    };
  } catch (e) {
    return {
      available: false,
      reason: `The security_events ledger could not be read (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
}
