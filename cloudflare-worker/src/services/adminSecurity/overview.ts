/**
 * D4708 (#4708) — `/api/admin/security/overview`'s one payload, read store by store: each part carries its own
 * availability, so one failed store costs its own tile and never the page. Moved from `routes/admin_security.ts`
 * unchanged; the route keeps the gate and only sends what this returns.
 */
import type { Env } from '../../types';
import { countSupportSessions, countActiveSessions, SESSION_TOKEN_HOURS } from '../userSessions';
import { SESSION_STATUS_DEFINITIONS, supportSessionStatus } from '../sessionStatus';
import { supportIdentity } from '../securityIdentity';
import {
  loadSecurityEventCounts, SECURITY_EVENT_KINDS, SECURITY_EVENT_RETENTION_DAYS, SECURITY_EVENTS_NOT_COUNTED,
} from '../securityEvents';
import { screeningSummary } from '../sanctions';
import { readBackupHeartbeat, readRestoreDrill, readRestoreDrillHistory } from '../backup';
import { branchBindings } from '../branches';
import {
  loadDsrHistory, dsrDaysLeft, dsrOverdue, DSR_CLOCK_RULE, DSR_CLOCK_LABEL,
  dsrStampMs, dsrDeadlineIso, loadOpenDsrRequestIds, loadRecentDsrClosures,
} from '../dsrRequests';
import { freshnessFor } from '../securitySourceFreshness';
import { absent, type Absent } from './contract';
import { aiSafetyBlock } from './aiSafety';

export const IMPERSONATION_LIMIT = 25;
/** D4800 — at most this many administrators are named in the MFA finding; the count is exact regardless. */
export const ADMIN_MFA_GAP_LIMIT = 50;

/**
 * D4691 — one read, its own availability. Every figure on /overview comes
 * through this or an equivalent per-store try, so one failed store costs its
 * own tile and never the page, and never reads as an empty table or a zero.
 */
export async function readPart<T>(what: string, fn: () => Promise<T>): Promise<({ available: true } & T) | Absent> {
  try {
    return { available: true, ...(await fn()) };
  } catch {
    return absent(`${what} could not be read on this database. This is not a claim that there are none.`);
  }
}

/**
 * D200 — the `security_events` block on /overview. The counts come from the
 * service so the SQL has one home (the same argument `aiSafetyBlock` makes for
 * `loadGuardrailCounters`), and an unreadable ledger keeps the retention, the
 * kinds and the not-counted list — those are facts about the design, not about
 * the database — while carrying NO `today` figure.
 */
export async function securityEventsBlock(env: Env) {
  const counts = await loadSecurityEventCounts(env);
  const shape = {
    retention_days: SECURITY_EVENT_RETENTION_DAYS,
    kinds: SECURITY_EVENT_KINDS,
    not_counted: SECURITY_EVENTS_NOT_COUNTED,
    feed: '/api/admin/security/governance?filter=auth',
  };
  if (!counts.available) return { available: false as const, reason: counts.reason, ...shape };
  return {
    available: true as const,
    today: counts.today,
    failed_signins_24h: counts.failed_signins_24h,
    ...shape,
  };
}

export const DSR_BRANCH_REASON =
  'No branch RPC returns a branch\'s erasure requests, and HQ does not fan out for them; a request raised on '
  + 'a branch is that branch\'s to answer and is visible there. Every request listed here is held on this '
  + 'database.';

/**
 * D481 — H23 draws one more tile in the KYC card and one in Backup / DR than
 * the platform records. Each comes back as a named absence with its reason,
 * never a zero and never the canvas's sample figure.
 */
export const KYC_NOT_RECORDED: Array<{ what: string; reason: string }> = [
  {
    what: 'Accreditation lapsed',
    reason: 'An investor\'s accreditation status is stored, but not when it was attested or when it expires, so '
      + 'no record can be overdue for re-attestation.',
  },
];
export const DR_NOT_RECORDED: Array<{ what: string; reason: string }> = [
  {
    what: 'Failover test',
    reason: 'No standby exists to fail over to: HQ runs on one Worker and one D1 database, and no failover '
      + 'exercise is run or written anywhere. The restore drill is the recovery the platform has, and it writes '
      + 'its own marker.',
  },
];

/**
 * D481 — which kinds of data-subject request the ledger holds. The zone used
 * to print "erasure" on every row as a literal, which read as though the
 * other kinds were simply absent today; they are absent by construction.
 */
export const DSR_KINDS: Array<{ kind: string; recorded: boolean; reason?: string }> = [
  { kind: 'erasure', recorded: true },
  {
    kind: 'access',
    recorded: false,
    reason: 'The ledger records deletion requests only. An account can download its own profile and recent '
      + 'activity from Settings, but that download is not recorded as a request and runs no clock.',
  },
  {
    kind: 'portability',
    recorded: false,
    reason: 'The ledger records deletion requests only, and no request for a machine-readable copy is taken '
      + 'or timed anywhere on the platform.',
  },
];

/** How many branch Workers are bound here, or null when the env cannot be scanned. */
export function boundBranchCount(env: Env): number | null {
  try { return branchBindings(env).length; } catch { return null; }
}

/** The whole `/overview` reply, in the order the page reads it, with `sources[]` last. */
export async function loadSecurityOverview(env: Env) {
  // The COUNT only. The rows themselves moved to /governance when H7's feed
  // replaced the Y2 audit zone: reading fifty of them here and rendering none
  // is a page of D1 work per load for a table nothing draws.
  const audit = await readPart('The admin action log', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first<{ n: number }>();
    if (!row) throw new Error('no row');
    return { total: Number(row.n) || 0, feed: '/api/admin/security/governance' };
  });

  // Impersonation: the table is created lazily by services/cohortTiming.ts on
  // first use, so a database that has never impersonated has no table. That
  // is "no sessions", but reported as unreadable rather than guessed at.
  //
  // D4691 — `active` is `live` by the shared rule (services/sessionStatus.ts):
  // exactly the rows the Sessions zone lists with an End button. It used to be
  // every record with no end time, so a record nobody closed counted as a
  // live support session forever. Those are counted apart as `not_closed`.
  let impersonations:
    | { available: true; active: number; live: number; not_closed: number; open: number; recent: Record<string, unknown>[] }
    | Absent;
  try {
    const recent = await env.DB.prepare(
      `SELECT i.id, i.admin_user_id, i.target_user_id, i.context, i.started_at, i.ended_at,
              a.email AS admin_email, a.name AS admin_name, t.email AS target_email, t.name AS target_name
         FROM impersonation_sessions i
         LEFT JOIN users a ON a.id = i.admin_user_id
         LEFT JOIN users t ON t.id = i.target_user_id
        ORDER BY i.started_at DESC, i.id DESC
        LIMIT ?`,
    ).bind(IMPERSONATION_LIMIT).all<Record<string, unknown>>();
    const counts = await countSupportSessions(env);
    const now = Date.now();
    impersonations = {
      available: true,
      active: counts.live,
      live: counts.live,
      not_closed: counts.not_closed,
      open: counts.open,
      recent: (recent.results || []).map((i) => ({
        ...i,
        status: supportSessionStatus(i, now),
        actor: supportIdentity(
          { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
          { id: i.target_user_id, name: i.target_name, email: i.target_email },
        ),
      })),
    };
  } catch {
    impersonations = absent('The impersonation_sessions table could not be read on this database.');
  }

  // Sessions: one row per JWT mint (routes/settings.ts). "Active" is the
  // list's own predicate (services/userSessions.ts): not revoked, token not
  // past its lifetime, and not below the account's sign-out floor.
  let sessions: { available: true; active: number; token_hours: number } | Absent;
  try {
    sessions = { available: true, active: await countActiveSessions(env), token_hours: SESSION_TOKEN_HOURS };
  } catch {
    sessions = absent('The user_sessions table could not be read on this database.');
  }

  const mfa = await readPart('Admin MFA coverage', async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN tfa_methods IS NOT NULL AND tfa_methods <> '[]' THEN 1 ELSE 0 END) AS with_mfa
         FROM users WHERE LOWER(role) = 'admin' AND is_active = 1`,
    ).first<{ total: number; with_mfa: number }>();
    if (!row) throw new Error('no row');
    // D4800 — which administrators the gap is, so the finding can name them
    // (open question A's recommended A2). Same predicate as the count, read in
    // the same part: if the names cannot be read, the whole part is unreadable
    // rather than a count beside an empty list.
    const gap = await env.DB.prepare(
      `SELECT id, name, email
         FROM users
        WHERE LOWER(role) = 'admin' AND is_active = 1
          AND NOT (tfa_methods IS NOT NULL AND tfa_methods <> '[]')
        ORDER BY id
        LIMIT ?`,
    ).bind(ADMIN_MFA_GAP_LIMIT).all<{ id: number; name: string | null; email: string | null }>();
    return {
      admins_total: Number(row.total) || 0,
      admins_with_mfa: Number(row.with_mfa) || 0,
      admins_without_mfa: (gap.results || []).map((a) => ({ id: Number(a.id), name: a.name ?? null, email: a.email ?? null })),
    };
  });

  // D4691 — `kyc` keeps its shape (status → count) when read; an unreadable
  // queue is `kyc: null` beside `kyc_available: false` and its reason, never
  // an empty object the page would draw as a queue with nobody in it.
  let kyc: Record<string, number> | null = null;
  let kycReason: string | null = null;
  try {
    const kycRows = await env.DB.prepare(
      'SELECT kyc_status, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY kyc_status',
    ).all<{ kyc_status: string | null; n: number }>();
    kyc = {};
    for (const row of kycRows.results || []) kyc[String(row.kyc_status ?? 'not_started')] = Number(row.n) || 0;
  } catch {
    kycReason = 'The KYC queue could not be read on this database. This is not a claim that the queue is empty.';
  }

  let dsrRows: { results?: Array<{ id: number; email: string; name: string; role: string; deletion_requested_at: string }> } | null;
  try {
    dsrRows = await env.DB.prepare(
      `SELECT id, email, name, role, deletion_requested_at FROM users
        WHERE deletion_requested_at IS NOT NULL
        ORDER BY deletion_requested_at ASC`,
    ).all<{ id: number; email: string; name: string; role: string; deletion_requested_at: string }>();
  } catch {
    dsrRows = null;
  }

  // D168 — WHAT EACH SUBJECT HAS ASKED BEFORE. `users.deletion_requested_at`
  // is still the one source of "open" (see migration 272), so the list above
  // is unchanged; this read only adds history, and a repeat request has to be
  // visible as one or HQ reads a third ask as a first. Its unreadable state is
  // its own — see `loadDsrHistory`, which is where the reason for that lives.
  const ledger = await loadDsrHistory(env);
  const ledgerAvailable = ledger.available;
  const ledgerReason = ledger.available ? null : ledger.reason;
  // D4675 — the exact request each row is, so a close names what was reviewed.
  const openIds = await loadOpenDsrRequestIds(env);

  const now = Date.now();
  const dsr = (dsrRows?.results || []).map((u) => {
    const seen = ledger.available ? ledger.byUser.get(u.id) : undefined;
    const open = openIds?.get(u.id);
    const requestedMs = dsrStampMs(u.deletion_requested_at);
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      // D481 — the kind comes from the store that holds the row. Every row
      // here is read from `deletion_requested_at`, so it is an erasure
      // request, and the page prints this field rather than a literal.
      kind: 'erasure',
      requested_at: u.deletion_requested_at,
      // D4675 — the ledger row a close targets, only when it holds THIS
      // request's stamp; null for a request the ledger does not hold yet.
      request_id: open && open.requested_at === u.deletion_requested_at ? open.id : null,
      // null when the timestamp cannot be parsed: an unknown clock is not a
      // clock at zero. The arithmetic lives in the service so it can fail a
      // test — it had never had one.
      days_left: dsrDaysLeft(requestedMs, now),
      // D4675 — the instant the clock runs out (the end of the due day, UTC),
      // so the rule is stated rather than inferred from a day count.
      deadline_at: dsrDeadlineIso(requestedMs),
      // D4675 part 2 (Q2 = B): overdue from that instant. The same fact as
      // `days_left < 0`, said once so no reader has to derive it.
      overdue: dsrOverdue(requestedMs, now),
      // null rather than 0 whenever the ledger could not be read — see above.
      prior_requests: ledgerAvailable ? (seen?.prior ?? 0) : null,
      last_outcome: ledgerAvailable ? (seen?.outcome ?? null) : null,
      last_outcome_at: ledgerAvailable ? (seen?.closed_at ?? null) : null,
    };
  });

  const body = {
    audit,
    impersonations,
    sessions,
    // D4691 — the one set of status definitions every count and list here uses.
    session_definitions: SESSION_STATUS_DEFINITIONS,
    mfa,
    kyc,
    kyc_available: kyc !== null,
    ...(kycReason ? { kyc_reason: kycReason } : {}),
    kyc_not_recorded: KYC_NOT_RECORDED,
    dsr: {
      // D4691 — the open requests' own read. Unreadable is `available: false`
      // with no rows, so the page cannot show "no open request".
      available: dsrRows !== null,
      ...(dsrRows === null
        ? { reason: 'The open erasure requests could not be read on this database. This is not a claim that none are open.' }
        : {}),
      // D4675 part 2 (Q1 = B): the rule, named. It replaced `clock_days: 30`;
      // a calendar month has no fixed day count, so none is sent.
      clock: { rule: DSR_CLOCK_RULE, label: DSR_CLOCK_LABEL },
      kinds: DSR_KINDS,
      rows: dsr,
      // D200 — H23 draws the DSR clocks "by territory · runs against the
      // holding branch". Every request this database holds is HQ-held by
      // construction, so the grouping has one group, and the second field says
      // why there is not a second: no branch RPC returns a branch's erasure
      // requests, and the brief forbids fanning out for one.
      by_branch: dsrRows === null ? [] : [{ branch: 'HQ-held', open: dsr.length }],
      branches: { bound: boundBranchCount(env), reason: DSR_BRANCH_REASON },
      ledger_available: ledgerAvailable,
      ...(ledgerReason ? { ledger_reason: ledgerReason } : {}),
      // D4803 (SE06) — the requests closed in the last 90 days, with who closed
      // them; its own read and its own unreadable state.
      recent: await loadRecentDsrClosures(env),
    },
    // D200 — the ledger H23 draws: rows today and refused sign-ins in 24h,
    // with the retention, the kinds, and what it deliberately does not count.
    // Unreadable comes back with its reason and NO `today`, never a zero.
    security_events: await securityEventsBlock(env),
    ai_safety: await aiSafetyBlock(env),
    // D200 — the store's own figures. `sanctions_screenings` has existed since
    // migration 035 and `screenUser` writes one row per on-request run; the
    // old refusal here denied both. Zero runs is a measured zero and the
    // block's `how` says why; a missing table is `available: false`.
    sanctions: await screeningSummary(env),
    // D200 — two halves with their own states. The backup half reads the
    // heartbeat the nightly export writes to R2 (absent when the binding is
    // unbound, absent when nothing was ever written, present with its stamp).
    // D263 — the drill half reads the marker the drill writes on every exit
    // (unreadable, never run, last run failed, last run passed). Each reads
    // its own key; never one green light inferred from the other.
    backup_dr: {
      backup: await readBackupHeartbeat(env, 'd1'),
      // D4803 — SE09's KV snapshots card: the worker cron's own heartbeat,
      // read with the same validation. KV has no restore drill.
      kv: await readBackupHeartbeat(env, 'kv'),
      drill: await readRestoreDrill(env),
      drill_history: await readRestoreDrillHistory(env, now),
      not_recorded: DR_NOT_RECORDED,
    },
  };

  // D5247 — per store this read touched: whether it answered, the last good read, the store's own age and
  // whether it is past it. The ledger's own stores carry the same fields on /governance's `sources[]`. A
  // heartbeat or marker answered when R2 answered (one never written, or invalid, is a read that found no
  // evidence); its evidence time is the recovery point or the marker's stamp.
  const r2Answered = (state: string) => state !== 'unreadable';
  const { backup: hbD1, kv: hbKv } = body.backup_dr;
  const marker = body.backup_dr.drill;
  const sources = await freshnessFor(env, [
    { source: 'admin_audit_log', answered: body.audit.available },
    { source: 'impersonation_sessions', answered: body.impersonations.available },
    { source: 'security_events', answered: body.security_events.available },
    { source: 'sanctions_screenings', answered: body.sanctions.available },
    { source: 'backup_d1', answered: r2Answered(hbD1.state), evidence_at: hbD1.available ? hbD1.recovery_point : null },
    { source: 'backup_kv', answered: r2Answered(hbKv.state), evidence_at: hbKv.available ? hbKv.recovery_point : null },
    { source: 'restore_drill', answered: r2Answered(marker.state), evidence_at: 'at' in marker ? marker.at : null },
  ], now);

  return { ...body, sources };
}
