/**
 * HQ · Security (Support Security · Super canvas, Y2; decision A4 renamed the
 * row from Governance).
 *
 * SUPER ADMIN ONLY, every route. This is the cross-tenant security desk: at
 * HQ scale the compliance officer and the security engineer are one headcount
 * and one page. A subsidiary admin has no security console by design (A5).
 *
 *   GET  /overview        one payload for the Security page
 *   GET  /governance      canvas H23's ledger (which completes H7's
 *                         privileged-action feed), unioned across the five
 *                         stores that actually record one
 *   POST /force-reauth    sign every active account on THIS deployment out,
 *                         with a typed reason; recorded in admin_audit_log.
 *                         D4669: branches are not reached, and the answer
 *                         lists each (services/emergencyScope.ts)
 *   POST /dsr/:userId/close   close a data-subject erasure request as
 *                         fulfilled or denied, with a typed reason (D168)
 *   GET  /sessions        D481 — active sessions and live support sessions,
 *                         the list the Sessions zone acts on
 *   POST /sessions/:id/revoke   revoke one session, with a typed reason
 *   POST /sessions/revoke       revoke the selected sessions, one reason,
 *                         one audit row per session
 *   POST /impersonations/:id/end   close a live support session's record
 *
 * WHAT IS REAL HERE. The admin action audit (`admin_audit_log`, every action,
 * newest first — the existing /monitoring/audit read allows two actions only);
 * impersonation sessions, live and recent; active sessions and MFA coverage
 * among admins; the KYC queue by status; data-subject deletion requests with
 * the statutory clock; and — since D152 — the AI guardrail counters, which
 * this page denied for months while `AiUsageTab` rendered them one click away.
 *
 * WHAT WAS NOT, AND WHAT D200 CHANGED. This header used to name three stated
 * absences: a `security_events` ledger, a sanctions screen, and backup /
 * restore-drill status. Measured, two of the three were refusals that denied
 * stores the platform has. The ledger is built now (migration 282,
 * services/securityEvents.ts) and is the fifth store /governance unions; the
 * sanctions card reads `sanctions_screenings`, which `screenUser` has written
 * since migration 035 — on request, never on a schedule, and the card says
 * so; the backup half of "Backup / DR" reads the heartbeat the nightly export
 * writes to R2. What is still genuinely absent — a restore-drill outcome the
 * platform can read, and the events the ledger deliberately does not count —
 * comes back as `{ available: false, reason }` or a `not_counted` list, so
 * the page says so in the zone the canvas draws for it instead of rendering
 * the canvas's sample rows. The AI-safety zone is the same mixed case the
 * D111 pattern produces: real figures beside a named list of what they
 * cannot say.
 *
 * FORCE RE-AUTH. `users.jwt_min_iat` is how sign-out-everywhere already works
 * per account (routes/settings.ts POST /sessions/revoke-all). Platform-wide
 * it is the same UPDATE over every active account — the caller included,
 * which the response says — behind the impersonation write bar: a TOTP
 * session, a recent step-up, then the elevation. The reason is required and
 * stored; a platform-wide sign-out with no stated cause is an incident that
 * cannot be reconstructed.
 *
 * Mounted at /api/admin/security BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import {
  IMPERSONATION_EXPIRY_MINUTES, requireSuperAdmin, requireSuperAdminWriteBar, bumpJwtMinIat, selectJwt,
} from '../auth';
import {
  listActiveSessions, countActiveSessions, listLiveImpersonations, countSupportSessions, revokeUserSession, endImpersonation,
  SESSION_TOKEN_HOURS, SESSION_BULK_LIMIT,
} from '../services/userSessions';
import {
  SESSION_STATUS_DEFINITIONS, supportSessionStatus, supportSessionLimitMinutes, parseStoredTs,
  type SupportSessionStatus,
} from '../services/sessionStatus';
import {
  securityEventIdentity, supportIdentity, userIdentity, type Identity,
} from '../services/securityIdentity';
import { loadTokenAnomalies } from '../services/tokenAnomalies';
import { logAdminAction } from '../services/adminAudit';
import { loadGuardrailCounters, loadRecentGuardVerdicts } from '../services/aiRouter';
import {
  loadSecurityEventCounts, SECURITY_EVENT_KINDS, SECURITY_EVENT_RETENTION_DAYS, SECURITY_EVENTS_NOT_COUNTED,
} from '../services/securityEvents';
import { screeningSummary } from '../services/sanctions';
import { readBackupHeartbeat, readRestoreDrill } from '../services/backup';
import { branchBindings } from '../services/branches';
import {
  emergencyScope, deploymentOutcomes, signOutOnBranches, type BranchSignOutTarget,
} from '../services/emergencyScope';
import { EMERGENCY_REASON_MIN, EMERGENCY_OP_KEY_RE } from '../rpc/branchOps';
import {
  HQ_DSR_OUTCOMES, isHqDsrOutcome, loadDsrHistory, closeDsrRequest, dsrDaysLeft, DSR_CLOCK_DAYS,
  dsrStampMs, dsrDeadlineIso, loadOpenDsrRequestIds, DSR_CLOSE_KEY_RE, loadRecentDsrClosures,
} from '../services/dsrRequests';
import { ensureAdminAuditLogTable } from './admin';

const r = new Hono<{ Bindings: Env }>();

const IMPERSONATION_LIMIT = 25;
const MIN_REASON = 8;
/** D4800 — at most this many administrators are named in the MFA finding; the count is exact regardless. */
const ADMIN_MFA_GAP_LIMIT = 50;


type Absent = { available: false; reason: string };
const absent = (reason: string): Absent => ({ available: false, reason });

/**
 * D152 — THE SENTENCE WAS WRONG ON TWO OF ITS THREE CLAUSES, AND IT IS
 * NARROWED RATHER THAN DELETED (the D111 pattern).
 *
 * It read: *"No guardrail-hit, flagged-output or token-anomaly counter is
 * stored for the AI rails."* Measured against the code:
 *
 *   · **guardrail-hit — FALSE.** `ai_usage_logs.safety_score` (migration 040)
 *     is written by `recordUsage` on every router call, and `task = 'safety'`
 *     rows are llama-guard's verdicts. They were already rolled up and already
 *     on screen — `AiUsageTab` renders them as "Guardrail safety (llama-guard)"
 *     — so this page denied a store the platform was showing one click away.
 *   · **flagged-output — FALSE.** `advisor_turn_audit.shadow_flagged`
 *     (migration 043) with its own index, written from seventeen call sites.
 *   · **token-anomaly — TRUE, and it is the only clause that survives.** The
 *     phrase occurs nowhere in the repo except this constant.
 *
 * So the zones now carry FIGURES from `loadGuardrailCounters` plus this,
 * which is what is still genuinely uncounted. One list, two zones — the same
 * argument the old comment made for one sentence, and for the same reason:
 * two literals drift the day one of them is reworded.
 */
const AI_SAFETY_NOT_COUNTED: Array<{ what: string; reason: string }> = [
  // D481 — 'Token anomalies' WAS THE FIRST ROW HERE AND IS GONE, for the reason
  // D158 removed the rule row below: the thing was built rather than
  // re-described. The block now carries `token_anomalies` from
  // services/tokenAnomalies.ts, which reads `ai_usage_logs` directly.
  //
  // The two rows that replace it are H23's own tiles, which this page had not
  // named at all — the canvas drew them with sample counts and the page drew
  // nothing, which is neither a figure nor a stated absence.
  {
    what: 'Cross-tenant refusals',
    reason: 'No store records a refusal to cross a tenant. `ai_usage_logs.refusal` names budget, kill-switch '
      + 'and model failures only, neither AI table carries a tenant column, and no branch RPC returns one — '
      + 'so the tenancy wall holding is not something this page can count.',
  },
  {
    what: 'Flagged outputs held for review',
    reason: 'Nothing holds an output for review. A shadow flag is counted above as Outputs flagged, and the '
      + 'turn it flagged was still answered; no table records a held output or its release.',
  },
  // D158 — 'Which guardrail rule fired' WAS THE SECOND ROW HERE AND IS GONE,
  // because the thing it described was fixed rather than merely re-described.
  // D152 filed the category as a producer with no store and put this row on the
  // screen saying so; migration 270 gave `advisor_turn_audit` the column,
  // `writeTurnAudit` binds it at all seventeen call sites, and
  // `loadGuardrailCounters` returns the breakdown as `enforcement.rules`. The
  // TWELFTH refusal in this programme to be re-aimed the day it stopped being
  // true — and the first one this codebase filed against itself, which is what
  // a filed measurement is supposed to lead to.
  {
    what: 'Guardrail counters by branch',
    reason: 'Neither `ai_usage_logs` nor `advisor_turn_audit` carries a branch, tenant or licence column, and no '
      + 'branch RPC returns safety counters — so these figures are platform-wide. Splitting them four ways today '
      + 'would label one deployment\'s numbers as four.',
  },
];

/**
 * The window both zones count over. One constant for the same reason the list
 * above is one list, and 7 days because that is what `loadAiUsageReport`
 * defaults to — so this page and `AiUsageTab` are counting the same days
 * rather than two figures that disagree for a reason nobody can see.
 */
const AI_SAFETY_WINDOW_DAYS = 7;

/**
 * The AI-safety block, built once and served to `/overview` as `ai_safety` and
 * to `/governance` as `guardrails`. `verdicts` and `enforcement` each carry
 * their own availability, because they come from different tables and
 * `advisor_turn_audit` is lazily bootstrapped — an unreadable table read as
 * "zero hits" is the #204 defect, and on a safety counter it is the worst
 * possible direction to be wrong in.
 */
async function aiSafetyBlock(env: Env) {
  // D481 — the token anomalies carry their own availability, their own table
  // and their own window (24 hours against the seven days before), stated in
  // their own `how`; they answer whatever the rollup below does.
  const always = {
    token_anomalies: await loadTokenAnomalies(env),
    // D4803 — SE08's "Recent guard verdicts", its own read with its own availability.
    recent_verdicts: await loadRecentGuardVerdicts(env, AI_SAFETY_WINDOW_DAYS),
    not_counted: AI_SAFETY_NOT_COUNTED,
  };
  // D4691 — `available` is earned, not asserted: a rollup that threw is the
  // whole block unreadable, with its reason, never a block of zeros.
  let counters: Awaited<ReturnType<typeof loadGuardrailCounters>>;
  try {
    counters = await loadGuardrailCounters(env, AI_SAFETY_WINDOW_DAYS);
  } catch {
    return {
      available: false as const,
      reason: 'The AI guardrail counters could not be read on this database. That is not a claim that no guarded '
        + 'call ran or that nothing was blocked.',
      ...always,
    };
  }
  return {
    available: true as const,
    window_days: counters.window_days,
    since: counters.since,
    verdicts: counters.verdicts,
    enforcement: counters.enforcement,
    guard: counters.guard, // D4522: router enforcement is separate from legacy chat.
    ...always,
  };
}

/** SQLite's `datetime('now')` is 'YYYY-MM-DD HH:MM:SS' (UTC, no zone); D4691 — one parser, shared with the status rules. */
const parseSqlTs = (s: string | null | undefined): number => parseStoredTs(s);

/**
 * D4691 — one read, its own availability. Every figure on /overview comes
 * through this or an equivalent per-store try, so one failed store costs its
 * own tile and never the page, and never reads as an empty table or a zero.
 */
async function readPart<T>(what: string, fn: () => Promise<T>): Promise<({ available: true } & T) | Absent> {
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
async function securityEventsBlock(env: Env) {
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

const DSR_BRANCH_REASON =
  'No branch RPC returns a branch\'s erasure requests, and HQ does not fan out for them; a request raised on '
  + 'a branch is that branch\'s to answer and is visible there. Every request listed here is held on this '
  + 'database.';

/**
 * D481 — H23 draws one more tile in the KYC card and one in Backup / DR than
 * the platform records. Each comes back as a named absence with its reason,
 * never a zero and never the canvas's sample figure.
 */
const KYC_NOT_RECORDED: Array<{ what: string; reason: string }> = [
  {
    what: 'Accreditation lapsed',
    reason: 'An investor\'s accreditation status is stored, but not when it was attested or when it expires, so '
      + 'no record can be overdue for re-attestation.',
  },
];
const DR_NOT_RECORDED: Array<{ what: string; reason: string }> = [
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
const DSR_KINDS: Array<{ kind: string; recorded: boolean; reason?: string }> = [
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
function boundBranchCount(env: Env): number | null {
  try { return branchBindings(env).length; } catch { return null; }
}

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

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
      // D4675 — the instant the clock runs out, in UTC, so the rule is stated
      // rather than inferred from a day count.
      deadline_at: dsrDeadlineIso(requestedMs),
      // null rather than 0 whenever the ledger could not be read — see above.
      prior_requests: ledgerAvailable ? (seen?.prior ?? 0) : null,
      last_outcome: ledgerAvailable ? (seen?.outcome ?? null) : null,
      last_outcome_at: ledgerAvailable ? (seen?.closed_at ?? null) : null,
    };
  });

  return c.json({
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
      clock_days: DSR_CLOCK_DAYS,
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
      not_recorded: DR_NOT_RECORDED,
    },
  });
});

// ── Canvas H7 · the privileged-action feed ────────────────────────────────
//
// H7 draws ONE feed — Time · Actor · Tenant · Action · Target and reason —
// under a filter bar of five. The zone this page already shipped from canvas
// Y2 reads `admin_audit_log` alone, which is a quarter of the trail: three of
// H7's five filters have no rows at all in that table. Checking where a
// privileged action actually lands found FOUR stores.
//
//   admin_audit_log        exports, publications, circles, events, jobs,
//                          billing, integration keys, force re-auth.
//   activity_logs          role changes, activations and deactivations, KYC
//                          decisions, contract void and resend.
//   impersonation_sessions the support sessions themselves, with the reason
//                          the admin typed and when the session ended.
//   licence_events         issue, re-term, renew, suspend, reinstate,
//                          terminate — each with its note and its licence.
//
// THE SUBJECT-SIDE TWIN IS THE TRAP IN `activity_logs`. Nearly every admin
// action writes TWO rows: one whose `user_id` is the admin who acted
// (`role_changed`, `kyc_rejected_by_admin`) and one whose `user_id` is the
// person it happened to (`your_role_changed`, `kyc_rejected`). Joining the
// second as "actor" would name the subject of an action as the person who
// took it. Only the admin-side actions are read, and the twins are named
// below so the next person to widen the list knows why they are missing.
//
// TENANT IS REAL FOR EXACTLY ONE ROW TYPE. A licence event is *about* a
// licence, so it can name the subsidiary. Nothing else can: no account
// carries a licence_id (U1), so an export or a role change cannot be
// attributed to a subsidiary and comes back `tenant: null` with the reason
// rather than a blank the reader has to interpret.
const FEED_LIMIT = 60;
const DATA_ACCESS_LIMIT = 12;

/**
 * The `activity_logs` actions whose `user_id` IS the admin who acted.
 *
 * DELIBERATELY EXCLUDED, and not an oversight:
 *   your_role_changed, account_status_changed, kyc_approved, kyc_rejected,
 *   profile_reviewed_by_admin, payout_* — the subject-side twins above.
 *   admin_impersonate, admin_impersonate_extend — the same events, thinner:
 *   `impersonation_sessions` carries the reason and the end time, so the
 *   session row is read instead and these would double every entry.
 *
 * D259 ADDED `hq_branch_support_session`: HQ opening a support session on a
 * BRANCH account. That row's `details` names the branch and the branch-local
 * account id, which means nothing in HQ's `users`, so this arm (which renders
 * `details` as the Target) is the one that can show whose session it was. The
 * audit arm shows the same act with a blank Target and the reason, so under
 * "All actions" it reads as two lines, stated in D259 rather than hidden.
 *
 * NO COMMENT INSIDE THE ARRAY: `admin_governance.test.ts` counts its quote
 * marks to check the IN-list below, and an apostrophe in prose there miscounts.
 */
const ACTOR_SIDE_ACTIONS = [
  'role_changed', 'user_toggled',
  'kyc_approved_by_admin', 'kyc_bypass_granted', 'kyc_rejected_by_admin', 'kyc_document_access',
  'kyc_record_access', 'kyc_queue_access', 'partner_profile_access',
  'kyc_field_shown', 'kyc_renewals_access', 'kyc_audit_access', 'kyc_periods_changed', 'kyc_sent_to_hq', 'kyc_hq_decided',
  'kyc_case_access', 'kyc_figures_access', 'kyc_case_assigned', 'kyc_note_added', 'kyc_needs_info_by_admin', 'kyc_recheck_by_admin',
  'contract_resent', 'contract_voided',
  'hq_branch_support_session',
  'spinout_moderation',
];

/** Suspension, in each of the two stores that records one. */
const SUSPENSION_LICENCE_EVENTS = ['suspended', 'terminated'];
const SUSPENSION_ACTIVITY_ACTIONS = ['user_toggled'];

/** The five the artboard draws, in its order, each naming what it reads. */
const FEED_FILTERS = [
  { key: 'all', label: 'All actions', reads: 'every store below' },
  { key: 'impersonations', label: 'Impersonations', reads: 'impersonation_sessions' },
  { key: 'licence_changes', label: 'Licence changes', reads: 'licence_events' },
  { key: 'suspensions', label: 'Suspensions', reads: 'licence_events · activity_logs' },
  { key: 'exports', label: 'Exports', reads: 'admin_audit_log' },
  // D200 — the sixth, which H23 (completing H7) added: the ledger of refusals
  // and step-ups at the auth boundary.
  { key: 'auth', label: 'Sign-ins and step-ups', reads: 'security_events' },
];

type FeedRow = {
  key: string;
  at: string | null;
  actor: string | null;
  action: string;
  tenant: string | null;
  target: string | null;
  source: string;
  tone: 'alert' | 'warn' | 'note';
  /**
   * D4691 — who acted, in the one shape every reader on this page uses
   * (services/securityIdentity.ts): an account, a support operator on behalf
   * of an account, the platform, or — for a refused attempt — only a network.
   * `actor` above is this identity's label, kept for older readers.
   */
  actor_identity: Identity;
  /**
   * D200 — H23's fifth column. Stored for a security event; DERIVED for the
   * other four stores, because each of them writes AFTER the act it records
   * (`logAdminAction`, `logActivity`, `logEvent` — hq_security.test.mjs pins
   * that order), so a row's existence is the act having happened: `ok`. An
   * impersonation is the one whose outcome is a state, not a verdict.
   */
  outcome: string;
};

/** A person, by the best name the join gave — never a bare id passed off as one. */
const who = (name: unknown, email: unknown, id: unknown): string | null =>
  (name ? String(name) : null) || (email ? String(email) : null) || (id ? `user ${id}` : null);

/** D4691 — a feed row's two actor fields from one identity, so they cannot disagree. */
const actorOf = (identity: Identity) => ({ actor: identity.label, actor_identity: identity });

/** `filters_json` is free-form. Only a non-empty string `reason` is lifted out. */
function reasonFrom(json: unknown): string | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return typeof v?.reason === 'string' && v.reason.trim() ? v.reason.trim() : null;
  } catch { return null; }
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/**
 * A timestamp, trimmed to the minute and with the ISO 'T' flattened.
 *
 * The data-access rows are built as pre-joined sentences, and the two halves
 * come from stores that stamp differently — `impersonation_sessions` uses
 * SQLite's 'YYYY-MM-DD HH:MM:SS', `admin_audit_log` sometimes holds full ISO
 * with a 'T' and milliseconds. Side by side in one zone they read as two
 * different kinds of fact, so both are flattened to the same shape here.
 */
const stamp = (v: unknown) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
/** Whole minutes between two epochs, floored at zero. */
const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60000));

/**
 * D200 — an impersonation's outcome for the ledger column, on the same rule
 * the Data access zone below applies to its own rows: an open row past the
 * token's expiry means the record was never closed, not that somebody is
 * still inside.
 */
const OUTCOME_OF: Record<SupportSessionStatus, 'live' | 'ended' | 'not closed' | 'unknown'> = {
  live: 'live', ended: 'ended', not_closed: 'not closed', unknown: 'unknown',
};
function impersonationOutcome(i: ImpersonationRow, now: number): 'live' | 'ended' | 'not closed' | 'unknown' {
  // D4691 — the shared rule, so this column, the Data access zone, the
  // overview's count and the Sessions list cannot disagree about one row.
  return OUTCOME_OF[supportSessionStatus(i, now)];
}

/**
 * THE SIX READS, EACH A COMPLETE LITERAL.
 *
 * The first version of this handler assembled them from `cols`/`from`/`order`
 * fragments and an `IN (${marks})` built from the arrays above, and
 * `scripts/check-sql-prepare.mjs` failed the build for it — correctly. A
 * `${…}` inside `DB.prepare(\`…\`)` lands in the query TEXT where no binding
 * protects it, and "this particular one is only a column list" is exactly the
 * argument that stops being true two edits later. Duplicating a SELECT list is
 * the cheaper half of that trade: every statement below can be read in one
 * piece and grepped for as it appears here.
 *
 * The placeholder counts in the two IN-lists are pinned by a test against the
 * arrays that fill them, so shortening `ACTOR_SIDE_ACTIONS` without editing
 * its statement fails the suite rather than the request.
 */
const FEED_AUDIT_ALL_SQL = `SELECT a.id, a.action, a.report_type, a.format, a.filters_json, a.exported_at,
          u.name AS admin_name, u.email AS admin_email, a.admin_user_id,
          t.name AS target_name, t.email AS target_email, a.viewed_user_id
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     LEFT JOIN users t ON t.id = a.viewed_user_id
    WHERE (? IS NULL OR datetime(a.exported_at) < datetime(?))
      AND (? IS NULL OR datetime(a.exported_at) >= datetime(?))
      AND (? IS NULL OR a.admin_user_id = ?)
      AND (? IS NULL OR a.action LIKE ? ESCAPE '!' OR a.report_type LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR t.name LIKE ? ESCAPE '!' OR t.email LIKE ? ESCAPE '!')
    ORDER BY datetime(a.exported_at) DESC, a.id DESC LIMIT ?`;

const FEED_AUDIT_EXPORTS_SQL = `SELECT a.id, a.action, a.report_type, a.format, a.filters_json, a.exported_at,
          u.name AS admin_name, u.email AS admin_email, a.admin_user_id,
          t.name AS target_name, t.email AS target_email, a.viewed_user_id
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     LEFT JOIN users t ON t.id = a.viewed_user_id
    WHERE a.action LIKE '%export%'
      AND (? IS NULL OR datetime(a.exported_at) < datetime(?))
      AND (? IS NULL OR datetime(a.exported_at) >= datetime(?))
      AND (? IS NULL OR a.admin_user_id = ?)
      AND (? IS NULL OR a.action LIKE ? ESCAPE '!' OR a.report_type LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR t.name LIKE ? ESCAPE '!' OR t.email LIKE ? ESCAPE '!')
    ORDER BY datetime(a.exported_at) DESC, a.id DESC LIMIT ?`;

/** Twenty-five placeholders, one per entry in ACTOR_SIDE_ACTIONS (D625 added the three identity reads; D1232 the KYC value shown, renewals, audit, periods, D1230's Send to HQ and its decision, and D1229's case, figures, assignment, note, ask for information and re-check). */
const FEED_ACTIVITY_ACTOR_SIDE_SQL = `SELECT l.id, l.action, l.details, l.created_at, l.user_id,
          u.name AS actor_name, u.email AS actor_email
     FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      AND (? IS NULL OR datetime(l.created_at) < datetime(?))
      AND (? IS NULL OR datetime(l.created_at) >= datetime(?))
      AND (? IS NULL OR l.user_id = ?)
      AND (? IS NULL OR l.action LIKE ? ESCAPE '!' OR l.details LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
    ORDER BY datetime(l.created_at) DESC, l.id DESC LIMIT ?`;

/** One placeholder, one per entry in SUSPENSION_ACTIVITY_ACTIONS. */
const FEED_ACTIVITY_SUSPENSIONS_SQL = `SELECT l.id, l.action, l.details, l.created_at, l.user_id,
          u.name AS actor_name, u.email AS actor_email
     FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action IN (?)
      AND (? IS NULL OR datetime(l.created_at) < datetime(?))
      AND (? IS NULL OR datetime(l.created_at) >= datetime(?))
      AND (? IS NULL OR l.user_id = ?)
      AND (? IS NULL OR l.action LIKE ? ESCAPE '!' OR l.details LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
    ORDER BY datetime(l.created_at) DESC, l.id DESC LIMIT ?`;

const FEED_LICENCE_ALL_SQL = `SELECT e.id, e.event, e.note, e.created_at, e.actor_user_id,
          u.name AS actor_name, u.email AS actor_email,
          l.licence_ref, l.brand_name
     FROM licence_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN territory_licences l ON l.id = e.licence_id
    WHERE (? IS NULL OR datetime(e.created_at) < datetime(?))
      AND (? IS NULL OR datetime(e.created_at) >= datetime(?))
      AND (? IS NULL OR e.actor_user_id = ?)
      AND (? IS NULL OR e.event LIKE ? ESCAPE '!' OR e.note LIKE ? ESCAPE '!' OR l.licence_ref LIKE ? ESCAPE '!' OR l.brand_name LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
    ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT ?`;

/** Two placeholders, one per entry in SUSPENSION_LICENCE_EVENTS. */
const FEED_LICENCE_SUSPENSIONS_SQL = `SELECT e.id, e.event, e.note, e.created_at, e.actor_user_id,
          u.name AS actor_name, u.email AS actor_email,
          l.licence_ref, l.brand_name
     FROM licence_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN territory_licences l ON l.id = e.licence_id
    WHERE e.event IN (?, ?)
      AND (? IS NULL OR datetime(e.created_at) < datetime(?))
      AND (? IS NULL OR datetime(e.created_at) >= datetime(?))
      AND (? IS NULL OR e.actor_user_id = ?)
      AND (? IS NULL OR e.event LIKE ? ESCAPE '!' OR e.note LIKE ? ESCAPE '!' OR l.licence_ref LIKE ? ESCAPE '!' OR l.brand_name LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
    ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT ?`;

/**
 * D200 — the fifth store. The subject joins to an account where the event
 * named one; the address a refused attempt presented is never stored, so a
 * row that resolves to nobody is its network bucket and nothing more.
 */
const FEED_SECURITY_EVENTS_SQL = `SELECT s.id, s.kind, s.factor, s.outcome, s.detail, s.user_id, s.ip_prefix,
          s.branch_code, s.occurred_at, s.support_user_id,
          u.name AS subject_name, u.email AS subject_email,
          sp.name AS support_name, sp.email AS support_email
     FROM security_events s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users sp ON sp.id = s.support_user_id
    WHERE (? IS NULL OR datetime(s.occurred_at) < datetime(?))
      AND (? IS NULL OR datetime(s.occurred_at) >= datetime(?))
      AND (? IS NULL OR s.user_id = ? OR s.support_user_id = ?)
      AND (? IS NULL OR s.outcome = ?)
      AND (? IS NULL OR s.kind LIKE ? ESCAPE '!' OR s.factor LIKE ? ESCAPE '!' OR s.detail LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR sp.name LIKE ? ESCAPE '!' OR sp.email LIKE ? ESCAPE '!')
    ORDER BY datetime(s.occurred_at) DESC, s.id DESC LIMIT ?`;

/**
 * D4803 (Events) — the impersonation sessions for the FEED, under the same
 * cursor and filters as the other four stores. The Data access zone keeps its
 * own unfiltered read of the newest sessions: a filter on the ledger must not
 * make that zone look as if nobody had acted as anyone.
 * `ended` is 1 for sessions with an end, 0 for open ones, NULL for both.
 */
const FEED_IMPERSONATIONS_SQL = `SELECT i.id, i.context, i.started_at, i.ended_at,
          a.name AS admin_name, a.email AS admin_email, i.admin_user_id,
          t.name AS target_name, t.email AS target_email, i.target_user_id
     FROM impersonation_sessions i
     LEFT JOIN users a ON a.id = i.admin_user_id
     LEFT JOIN users t ON t.id = i.target_user_id
    WHERE (? IS NULL OR datetime(i.started_at) < datetime(?))
      AND (? IS NULL OR datetime(i.started_at) >= datetime(?))
      AND (? IS NULL OR i.admin_user_id = ?)
      AND (? IS NULL OR (? = 1 AND i.ended_at IS NOT NULL) OR (? = 0 AND i.ended_at IS NULL))
      AND (? IS NULL OR i.context LIKE ? ESCAPE '!' OR a.name LIKE ? ESCAPE '!' OR a.email LIKE ? ESCAPE '!' OR t.name LIKE ? ESCAPE '!' OR t.email LIKE ? ESCAPE '!')
    ORDER BY datetime(i.started_at) DESC, i.id DESC LIMIT ?`;

type ImpersonationRow = Record<string, unknown>;

/**
 * D4803 (Events, SE03) — the ledger's cursor and its server-side filters.
 *
 * Each store applies the same four conditions in its own SQL, every value
 * bound and every timestamp normalised through `datetime()` (D124), so each
 * store still returns its OWN newest FEED_LIMIT matching rows and the merge
 * stays exact, as the whole-feed read always was:
 *
 *   before  older than this instant (the cursor; the page's last `at`)
 *   from    on or after this day, `YYYY-MM-DD`, UTC
 *   to      on or before this day, `YYYY-MM-DD`, UTC (the whole day)
 *   actor   a user id: who acted (a gate or step-up event also matches the
 *           support operator acting for that account)
 *   q       a search, matched as a substring, case-insensitively for ASCII
 *           (SQLite's LIKE), against the action, the names and emails the row
 *           joins, and the store's own text column
 *   outcome ok | refused | live | ended | not_closed
 *   source  one store's table name
 *
 * A value outside its shape is a 400 naming the field, never a quietly
 * widened read: an investigator who typed a date the server ignored would be
 * reading a list that is not the one they asked for.
 */
export const FEED_OUTCOMES = ['ok', 'refused', 'live', 'ended', 'not_closed'] as const;
export const FEED_SOURCES = [
  'admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events', 'security_events',
] as const;
type FeedOutcome = (typeof FEED_OUTCOMES)[number];
type FeedSource = (typeof FEED_SOURCES)[number];
export type FeedQuery = {
  upper: string | null;
  lower: string | null;
  actor: number | null;
  like: string | null;
  outcome: FeedOutcome | null;
  source: FeedSource | null;
  applied: Record<string, string | number>;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_MAX = 100;
/** `YYYY-MM-DD HH:MM:SS`, UTC: the shape `datetime()` returns, so a bound value compares as the column does. */
const sqlStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The query string as a FeedQuery, or the first field that is out of shape. */
export function parseFeedQuery(q: (k: string) => string | undefined):
  { ok: true; query: FeedQuery } | { ok: false; field: string; message: string } {
  const applied: Record<string, string | number> = {};
  const text = (k: string) => {
    const v = q(k);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  let upper: number | null = null;
  let lower: number | null = null;

  const before = text('before');
  if (before) {
    const ms = parseStoredTs(before);
    if (Number.isNaN(ms)) return { ok: false, field: 'before', message: 'The cursor is not a timestamp.' };
    upper = ms;
    applied.before = before;
  }
  const day = (k: 'from' | 'to') => {
    const v = text(k);
    if (!v) return { ok: true as const, ms: null };
    const ms = DAY_RE.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
    if (Number.isNaN(ms)) return { ok: false as const };
    applied[k] = v;
    return { ok: true as const, ms };
  };
  const from = day('from');
  if (!from.ok) return { ok: false, field: 'from', message: 'The start date must be YYYY-MM-DD.' };
  const to = day('to');
  if (!to.ok) return { ok: false, field: 'to', message: 'The end date must be YYYY-MM-DD.' };
  if (from.ms !== null) lower = from.ms;
  // `to` names a whole day, so the bound is the start of the next one.
  if (to.ms !== null) {
    const end = to.ms + 86_400_000;
    upper = upper === null ? end : Math.min(upper, end);
  }
  if (lower !== null && upper !== null && lower >= upper) {
    return { ok: false, field: 'from', message: 'The start date is after the end of the range.' };
  }

  const actorText = text('actor');
  let actor: number | null = null;
  if (actorText) {
    if (!/^[1-9]\d{0,9}$/.test(actorText)) return { ok: false, field: 'actor', message: 'The actor must be a user id.' };
    actor = Number(actorText);
    applied.actor = actor;
  }

  const search = text('q');
  let like: string | null = null;
  if (search) {
    if (search.length > SEARCH_MAX) return { ok: false, field: 'q', message: `A search is at most ${SEARCH_MAX} characters.` };
    // `!` escapes LIKE's own wildcards, so a search for "50%" finds "50%".
    like = `%${search.replace(/[!%_]/g, (ch) => `!${ch}`)}%`;
    applied.q = search;
  }

  const outcomeText = text('outcome');
  let outcome: FeedOutcome | null = null;
  if (outcomeText) {
    if (!(FEED_OUTCOMES as readonly string[]).includes(outcomeText)) {
      return { ok: false, field: 'outcome', message: `The outcome is one of ${FEED_OUTCOMES.join(', ')}.` };
    }
    outcome = outcomeText as FeedOutcome;
    applied.outcome = outcome;
  }

  const sourceText = text('source');
  let source: FeedSource | null = null;
  if (sourceText) {
    if (!(FEED_SOURCES as readonly string[]).includes(sourceText)) {
      return { ok: false, field: 'source', message: 'The source is not one of the five stores.' };
    }
    source = sourceText as FeedSource;
    applied.source = source;
  }

  return {
    ok: true,
    query: {
      upper: upper === null ? null : sqlStamp(upper),
      lower: lower === null ? null : sqlStamp(lower),
      actor, like, outcome, source, applied,
    },
  };
}

/** The binds for one store's time, actor and search conditions, in statement order. */
const timeBinds = (f: FeedQuery) => [f.upper, f.upper, f.lower, f.lower];
const actorBinds = (f: FeedQuery, n = 2) => [f.actor, ...Array(n - 1).fill(f.actor)];
const likeBinds = (f: FeedQuery, n: number) => [f.like, ...Array(n).fill(f.like)];

/**
 * Which stores a filtered read can hold a row from. Only `security_events`
 * stores an outcome; the other four are written after their act (`ok`), and an
 * impersonation's outcome is a state (live, ended, not closed).
 */
function storesFor(f: FeedQuery): Record<FeedSource, boolean> {
  const all = {
    admin_audit_log: true, activity_logs: true, impersonation_sessions: true, licence_events: true, security_events: true,
  };
  if (f.outcome === 'refused') Object.assign(all, { admin_audit_log: false, activity_logs: false, impersonation_sessions: false, licence_events: false });
  if (f.outcome === 'ok') all.impersonation_sessions = false;
  if (f.outcome === 'live' || f.outcome === 'ended' || f.outcome === 'not_closed') {
    Object.assign(all, { admin_audit_log: false, activity_logs: false, licence_events: false, security_events: false });
  }
  if (f.source) for (const k of FEED_SOURCES) if (k !== f.source) all[k] = false;
  return all;
}

/**
 * The page ends on a whole second. The cursor is the last row's time and the
 * next read takes rows strictly older, at the second `datetime()` keeps, so a
 * page cut inside a second would drop that second's remaining rows. Trailing
 * rows in the last row's second are held back to the next page — unless the
 * whole page is one second, which is returned whole and said so.
 */
export function trimToSecond<T extends { ts: number }>(rows: T[], more: boolean): { page: T[]; split: boolean } {
  if (!more || rows.length === 0) return { page: rows, split: false };
  const sec = (t: number) => (Number.isNaN(t) ? NaN : Math.floor(t / 1000));
  const last = sec(rows[rows.length - 1].ts);
  let cut = rows.length;
  while (cut > 0 && sec(rows[cut - 1].ts) === last) cut -= 1;
  return cut === 0 ? { page: rows, split: true } : { page: rows.slice(0, cut), split: false };
}

r.get('/governance', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const asked = String(c.req.query('filter') || 'all');
  // An unknown filter falls back to the whole feed rather than to nothing: a
  // stale bookmark should show more than it asked for, never less.
  const filter = FEED_FILTERS.some((f) => f.key === asked) ? asked : 'all';
  const now = Date.now();
  // D4803 — the cursor and the server-side filters. A value out of shape is
  // refused with its field, never read as a wider list than was asked for.
  const parsed = parseFeedQuery((k) => c.req.query(k));
  if (!parsed.ok) return c.json({ error: parsed.message, code: 'invalid_filter', field: parsed.field }, 400);
  const fq = parsed.query;
  const narrowed = Object.keys(fq.applied).length > 0;
  const stores = storesFor(fq);

  const readAudit = (filter === 'all' || filter === 'exports') && stores.admin_audit_log;
  const readActivity = (filter === 'all' || filter === 'suspensions') && stores.activity_logs;
  const readImpersonations = (filter === 'all' || filter === 'impersonations') && stores.impersonation_sessions;
  const readLicences = (filter === 'all' || filter === 'licence_changes' || filter === 'suspensions') && stores.licence_events;
  const readSecurity = (filter === 'all' || filter === 'auth') && stores.security_events;

  const rows: Array<FeedRow & { ts: number }> = [];
  const sources: Array<{ table: string; available: boolean; rows?: number; reason?: string }> = [];
  /**
   * Each store returns its OWN newest FEED_LIMIT and the merge keeps the
   * newest FEED_LIMIT of the union. That is exact, not an approximation: the
   * global newest N cannot hold more than N rows from any single store, so
   * no row belonging on this page was left behind in a store's tail.
   */
  let more = false;
  const took = (n: number) => { if (n >= FEED_LIMIT) more = true; return n; };

  // ── The impersonation sessions, read once ─────────────────────────────
  // The feed uses them when the filter asks; the Data access zone always
  // does. The table is created lazily (services/cohortTiming.ts), so a
  // database that has never impersonated has no table — unreadable, which is
  // reported as such rather than rendered as "none".
  let impersonations: ImpersonationRow[] | null = null;
  try {
    const res = await env.DB.prepare(
      `SELECT i.id, i.context, i.started_at, i.ended_at,
              a.name AS admin_name, a.email AS admin_email, i.admin_user_id,
              t.name AS target_name, t.email AS target_email, i.target_user_id
         FROM impersonation_sessions i
         LEFT JOIN users a ON a.id = i.admin_user_id
         LEFT JOIN users t ON t.id = i.target_user_id
        ORDER BY i.started_at DESC, i.id DESC LIMIT ?`,
    ).bind(FEED_LIMIT).all<ImpersonationRow>();
    impersonations = res.results || [];
  } catch {
    impersonations = null;
  }
  const IMPERSONATION_UNREADABLE = 'The impersonation_sessions table could not be read on this database.';

  // ── admin_audit_log ───────────────────────────────────────────────────
  if (readAudit) {
    try {
      const res = await env.DB
        .prepare(filter === 'exports' ? FEED_AUDIT_EXPORTS_SQL : FEED_AUDIT_ALL_SQL)
        .bind(...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const a of got) {
        const action = String(a.action || '');
        const reason = reasonFrom(a.filters_json);
        rows.push({
          key: `audit:${a.id}`,
          at: (a.exported_at as string) || null,
          ts: parseSqlTs(a.exported_at as string),
          ...actorOf(userIdentity(a.admin_user_id, a.admin_name, a.admin_email)),
          action,
          tenant: null,
          target: [
            who(a.target_name, a.target_email, a.viewed_user_id),
            a.report_type ? String(a.report_type) : null,
            a.format ? String(a.format) : null,
            reason ? `"${clip(reason, 160)}"` : null,
          ].filter(Boolean).join(' · ') || null,
          source: 'admin_audit_log',
          tone: action.includes('export') ? 'warn' : 'note',
          outcome: 'ok',
        });
      }
      sources.push({ table: 'admin_audit_log', available: true, rows: took(got.length) });
    } catch {
      sources.push({ table: 'admin_audit_log', available: false, reason: 'The admin action log could not be read.' });
    }
  }

  // ── activity_logs, admin-side rows only ───────────────────────────────
  if (readActivity) {
    try {
      const suspensionsOnly = filter === 'suspensions';
      const allow = suspensionsOnly ? SUSPENSION_ACTIVITY_ACTIONS : ACTOR_SIDE_ACTIONS;
      const res = await env.DB
        .prepare(suspensionsOnly ? FEED_ACTIVITY_SUSPENSIONS_SQL : FEED_ACTIVITY_ACTOR_SIDE_SQL)
        .bind(...allow, ...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 4), FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const l of got) {
        const action = String(l.action || '');
        rows.push({
          key: `activity:${l.id}`,
          at: (l.created_at as string) || null,
          ts: parseSqlTs(l.created_at as string),
          ...actorOf(userIdentity(l.user_id, l.actor_name, l.actor_email)),
          action,
          tenant: null,
          // `details` is already the sentence a person wrote at the write site.
          target: l.details ? clip(String(l.details)) : null,
          source: 'activity_logs',
          tone: SUSPENSION_ACTIVITY_ACTIONS.includes(action) ? 'alert' : 'note',
          outcome: 'ok',
        });
      }
      sources.push({ table: 'activity_logs', available: true, rows: took(got.length) });
    } catch {
      sources.push({ table: 'activity_logs', available: false, reason: 'The activity log could not be read.' });
    }
  }

  // ── impersonation_sessions ────────────────────────────────────────────
  if (readImpersonations) {
    // Unfiltered, the feed shares the Data access zone's read; narrowed, it
    // reads its own under the same conditions as the other four stores.
    let feedImpersonations: ImpersonationRow[] | null = impersonations;
    if (narrowed) {
      const ended = fq.outcome === 'ended' ? 1 : fq.outcome === 'live' || fq.outcome === 'not_closed' ? 0 : null;
      try {
        const res = await env.DB.prepare(FEED_IMPERSONATIONS_SQL)
          .bind(...timeBinds(fq), ...actorBinds(fq), ended, ended, ended, ...likeBinds(fq, 5), FEED_LIMIT)
          .all<ImpersonationRow>();
        feedImpersonations = res.results || [];
      } catch {
        feedImpersonations = null;
      }
    }
    if (feedImpersonations === null) {
      sources.push({ table: 'impersonation_sessions', available: false, reason: IMPERSONATION_UNREADABLE });
    } else {
      // An open session is live or not closed by the clock, which SQL cannot
      // tell apart; the store's own count still decides `more`.
      const wanted = fq.outcome === 'live' || fq.outcome === 'not_closed'
        ? feedImpersonations.filter((i) => impersonationOutcome(i, now) === (fq.outcome === 'live' ? 'live' : 'not closed'))
        : feedImpersonations;
      for (const i of wanted) {
        rows.push({
          key: `impersonation:${i.id}`,
          at: (i.started_at as string) || null,
          ts: parseSqlTs(i.started_at as string),
          ...actorOf(supportIdentity(
            { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
            { id: i.target_user_id, name: i.target_name, email: i.target_email },
          )),
          action: 'impersonate',
          tenant: null,
          // The reason is mandatory on the support-session dialog, so a row
          // without one is an older session rather than a policy hole.
          target: [
            who(i.target_name, i.target_email, i.target_user_id),
            i.context ? `"${clip(String(i.context), 160)}"` : null,
          ].filter(Boolean).join(' · ') || null,
          source: 'impersonation_sessions',
          tone: 'alert',
          outcome: impersonationOutcome(i, now),
        });
      }
      sources.push({ table: 'impersonation_sessions', available: true, rows: took(feedImpersonations.length) });
    }
  }

  // ── licence_events — the one store that can name a tenant ─────────────
  if (readLicences) {
    try {
      const res = filter === 'suspensions'
        ? await env.DB.prepare(FEED_LICENCE_SUSPENSIONS_SQL)
          .bind(...SUSPENSION_LICENCE_EVENTS, ...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), FEED_LIMIT)
          .all<Record<string, unknown>>()
        : await env.DB.prepare(FEED_LICENCE_ALL_SQL)
          .bind(...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const e of got) {
        const event = String(e.event || '');
        rows.push({
          key: `licence:${e.id}`,
          at: (e.created_at as string) || null,
          ts: parseSqlTs(e.created_at as string),
          ...actorOf(userIdentity(e.actor_user_id, e.actor_name, e.actor_email)),
          action: `licence ${event}`,
          // The one column that is real here, and only here.
          tenant: (e.brand_name as string) || null,
          target: [
            e.licence_ref ? String(e.licence_ref) : null,
            e.note ? `"${clip(String(e.note), 160)}"` : null,
          ].filter(Boolean).join(' · ') || null,
          source: 'licence_events',
          tone: SUSPENSION_LICENCE_EVENTS.includes(event) ? 'alert' : 'note',
          outcome: 'ok',
        });
      }
      sources.push({ table: 'licence_events', available: true, rows: took(got.length) });
    } catch {
      sources.push({ table: 'licence_events', available: false, reason: 'The licence event log could not be read.' });
    }
  }

  // ── security_events — D200, the fifth store ───────────────────────────
  if (readSecurity) {
    try {
      const secOutcome = fq.outcome === 'ok' || fq.outcome === 'refused' ? fq.outcome : null;
      const res = await env.DB.prepare(FEED_SECURITY_EVENTS_SQL)
        .bind(...timeBinds(fq), ...actorBinds(fq, 3), secOutcome, secOutcome, ...likeBinds(fq, 7), FEED_LIMIT)
        .all<Record<string, unknown>>();
      const got = res.results || [];
      for (const s of got) {
        const outcome = String(s.outcome || '');
        const branch = String(s.branch_code || 'hq');
        // D4691 — a refused sign-in or recovery step established nobody, so
        // its actor is its network and the account it named is the subject,
        // in the Target column; a gate refusal or step-up is the signed-in
        // caller's, or the support operator's on that caller's behalf.
        const { actor, subject } = securityEventIdentity(s);
        rows.push({
          key: `security:${s.id}`,
          at: (s.occurred_at as string) || null,
          ts: parseSqlTs(s.occurred_at as string),
          ...actorOf(actor),
          action: `${String(s.kind || '')}.${String(s.factor || '')}`,
          // The deployment that recorded it — a fact about where, not whose.
          tenant: branch === 'hq' ? 'HQ' : branch,
          target: [
            subject ? `named ${subject.label}` : null,
            actor.kind === 'support' && actor.on_behalf_of ? `on behalf of ${actor.on_behalf_of.label}` : null,
            s.detail ? `detail=${String(s.detail)}` : null,
          ].filter(Boolean).join(' · ') || null,
          source: 'security_events',
          tone: outcome === 'refused' ? 'alert' : 'note',
          outcome,
        });
      }
      sources.push({ table: 'security_events', available: true, rows: took(got.length) });
    } catch {
      sources.push({
        table: 'security_events',
        available: false,
        reason: 'The security_events ledger could not be read on this database.',
      });
    }
  }

  // Sort on the PARSED epoch, never the raw string: `admin_audit_log` holds
  // both 'YYYY-MM-DD HH:MM:SS' (the column default) and full ISO with a 'T'
  // (routes/admin.ts writes new Date().toISOString()), and those two forms do
  // not sort against each other lexically. A timestamp that will not parse
  // sorts LAST rather than to the epoch, which would put it on top.
  rows.sort((a, b) => {
    const av = Number.isNaN(a.ts) ? -Infinity : a.ts;
    const bv = Number.isNaN(b.ts) ? -Infinity : b.ts;
    return bv - av;
  });
  // More is held when any store filled its own page, OR when the stores
  // together returned more than one page (two stores of forty each): the rows
  // past FEED_LIMIT are real and Load older has to reach them.
  if (rows.length > FEED_LIMIT) more = true;
  const { page: kept, split } = trimToSecond(rows.slice(0, FEED_LIMIT), more);
  const page = kept.map(({ ts, ...row }) => row);
  // D4803 — Load older: the next read is everything strictly older than the
  // last row kept. No cursor when nothing older is held, or when the last row
  // has no time to continue from.
  const lastAt = more && kept.length ? kept[kept.length - 1].at : null;
  const cursor = lastAt && !Number.isNaN(parseSqlTs(lastAt)) ? { before: lastAt } : null;

  // ── H7's "Data access" zone: who saw data they do not own ─────────────
  // Impersonations and exports side by side, because the question this zone
  // asks is not "what changed" but "who read someone else's rows". Kept as
  // two halves so one unreadable store cannot make the other look complete.
  let accessImpersonations: { available: true; items: Array<Record<string, unknown>> } | Absent;
  if (impersonations === null) {
    accessImpersonations = absent(IMPERSONATION_UNREADABLE);
  } else {
    accessImpersonations = {
      available: true,
      items: impersonations.slice(0, DATA_ACCESS_LIMIT).map((i) => {
        const started = parseSqlTs(i.started_at as string);
        const ended = i.ended_at ? parseSqlTs(i.ended_at as string) : NaN;
        const status = supportSessionStatus(i, now);
        const live = status === 'live';
        const open = status !== 'ended';
        const elapsed = Number.isNaN(started) || (!open && Number.isNaN(ended))
          ? null
          : minutesBetween(started, open ? now : ended);
        // D4691 — the shared rule decides live and not-closed, as everywhere
        // else on the page. Past the first token's thirty minutes an HQ
        // session can still be live (it may have been extended, up to the
        // ceiling), so the time left is stated as an upper bound; only past
        // the session's limit is an open record "not closed" — the record was
        // never closed, NOT somebody still inside.
        let dur: string | null;
        if (status === 'not_closed') dur = 'not closed';
        else if (elapsed === null) dur = null;
        else if (!open) dur = `${elapsed}m`;
        else if (elapsed < IMPERSONATION_EXPIRY_MINUTES && Number(i.admin_user_id) !== 0) {
          dur = `${IMPERSONATION_EXPIRY_MINUTES - elapsed}m left`;
        } else dur = `at most ${Math.max(0, supportSessionLimitMinutes(i.admin_user_id) - elapsed)}m left`;
        return {
          kind: 'impersonation',
          status,
          actor: supportIdentity(
            { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
            { id: i.target_user_id, name: i.target_name, email: i.target_email },
          ),
          what: `Impersonation · ${who(i.target_name, i.target_email, i.target_user_id) || 'unknown account'}`,
          meta: [
            supportIdentity({ id: i.admin_user_id, name: i.admin_name, email: i.admin_email }, { id: i.target_user_id }).label,
            stamp(i.started_at),
            i.context ? clip(String(i.context), 120) : null,
          ].filter(Boolean).join(' · '),
          dur,
          live,
          overdue: status === 'not_closed',
        };
      }),
    };
  }

  let accessExports: { available: true; items: Array<Record<string, unknown>> } | Absent;
  try {
    const ex = await env.DB.prepare(
      `SELECT a.id, a.action, a.report_type, a.format, a.exported_at,
              u.name AS admin_name, u.email AS admin_email, a.admin_user_id
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action LIKE '%export%'
        ORDER BY a.exported_at DESC, a.id DESC LIMIT ?`,
    ).bind(DATA_ACCESS_LIMIT).all<Record<string, unknown>>();
    accessExports = {
      available: true,
      items: (ex.results || []).map((e) => ({
        kind: 'export',
        actor: userIdentity(e.admin_user_id, e.admin_name, e.admin_email),
        what: `Export · ${e.report_type ? String(e.report_type) : String(e.action || 'report')}`,
        meta: [
          userIdentity(e.admin_user_id, e.admin_name, e.admin_email).label,
          e.format ? String(e.format) : null,
          stamp(e.exported_at),
        ].filter(Boolean).join(' · '),
        // An export is a moment, not a window. It has no duration, and
        // "complete" is the artboard's own word for that.
        dur: 'complete',
        live: false,
        overdue: false,
      })),
    };
  } catch {
    accessExports = absent('The export records could not be read.');
  }

  return c.json({
    filter,
    filters: FEED_FILTERS,
    rows: page,
    limit: FEED_LIMIT,
    more,
    // D4803 — the cursor for Load older, what the server applied (so the page
    // can say which list it is showing), and whether a page ended inside one
    // second because every row on it shared that second.
    cursor,
    applied: fq.applied,
    page_split_second: split,
    outcomes: FEED_OUTCOMES,
    stores: FEED_SOURCES,
    sources,
    // What no store can say, said once rather than once per row.
    tenant_available: false,
    tenant_reason:
      'Two stores can fill this column: a licence event names its subsidiary, because it is about a licence, '
      + 'and a security event names the deployment that recorded it (HQ, or a branch code). No account carries a '
      + 'licence_id (U1), so an export, a role change or an impersonation cannot be attributed to one — those '
      + 'rows leave the column unrecorded rather than filling it with a guess.',
    data_access: {
      expiry_minutes: IMPERSONATION_EXPIRY_MINUTES,
      impersonations: accessImpersonations,
      exports: accessExports,
    },
    // H7 draws a guardrail-hit panel, and D152 gave it figures — served ONCE,
    // by /overview as `ai_safety`, with this field pointing at them.
    //
    // WHY A POINTER AND NOT A SECOND COPY OF THE BLOCK. Both payloads land on
    // the same page: `SecurityPage` fetches /overview and /governance together,
    // and the page's own header records that H7 was reconciled INTO this
    // surface rather than drawn beside it — so H7's guardrail panel IS the
    // AI-safety zone. Serving the counters here too would put two renders of
    // one rollup on one screen (the tile-vs-table disagreement D128 ended) and
    // spend a second pair of D1 reads per governance load on a field nothing
    // reads. This is the shape `audit` at the top of /overview already uses:
    // the figure in one place, a pointer to it in the other.
    guardrails: {
      counters_on: '/api/admin/security/overview',
      field: 'ai_safety',
      window_days: AI_SAFETY_WINDOW_DAYS,
      // What the counters still cannot say, from the same list they carry, so
      // a reader of this endpoint alone is not told a narrower truth than a
      // reader of the other one.
      not_counted: AI_SAFETY_NOT_COUNTED,
    },
    // H7's chrome: "Viewing as: Axal VC France · Return to HQ view".
    //
    // D153 — THE AVAILABILITY FLAG FLIPPED, AND THE SENTENCE CHANGED WITH IT.
    // (Worded without naming the old value: this file is scanned for the table
    // names it reads by matching what follows the word FROM, and a comment
    // that put a bare word after it added a phantom table to that set. Fourth
    // instance of "a lexical scan cannot tell a rule from its violation".)
    // D150 corrected this refusal's REASON (it used to blame U1, which is a
    // fact about HQ's own rows and never applied to a branch) and left the
    // refusal itself standing, correctly: the overlay was unbuilt. It is built
    // now — `?branch=` on the HQ reads, `ViewAsBranchContext` in the shell,
    // `HqViewingAsBar` above all other chrome — so the refusal is DELETED
    // rather than reworded, which is what this programme does with a reason
    // that has outlived its fact, and the ninth time a guard pinning one has
    // had to be re-aimed the day it stopped being true.
    //
    // WHAT THE SENTENCE SAYS NOW IS WHAT THE OVERLAY IS NOT, because that is
    // the part a reader of this feed can still get wrong: it is a read, not a
    // role, and nothing on it can be acted on.
    tenant_view_available: true,
    tenant_view_reason:
      'HQ can read one branch at a time through its private link, and the chrome says so while it is doing it: '
      + 'a "Viewing as <branch> — read-only" bar above every other bar, with "Return to HQ view" to leave. '
      + 'It is not a third "view as" mode beside the ROLE switch (an admin browsing as a founder) and the '
      + 'support session against ONE account: those two change who you are, and this one changes only which '
      + 'database was read. Every action is absent under it rather than disabled, because no action runs '
      + 'from it.',
  });
});

// ── D481 · the Sessions zone acts ─────────────────────────────────────────
//
// The zone said "Revoke is recorded" and had no revoke. These four routes are
// the list it acts on and the three acts. Each write is behind the same bar as
// force re-auth, for the same reason that route's docblock gives: a revoke is
// what an attacker holding an admin session reaches for to lock the real
// holder out. Each revoke writes ONE `logAdminAction` row naming the account
// whose session it was (`target_user_id`), so the governance feed's join can
// say whose session ended — and a bulk revoke writes one per session, never
// one row for "some sessions".

/** A typed reason, or the refusal that says how long it must be. */
async function reasonOf(c: any): Promise<{ reason: string; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  return { reason: String(body?.reason ?? '').trim(), body };
}
const reasonRefusal = (c: any) => c.json({
  error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
  code: 'reason_required',
}, 400);

r.get('/sessions', async (c) => {
  await requireSuperAdmin(c);
  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;

  // UNREADABLE IS A 503, NOT AN EMPTY LIST. "Nobody is signed in" is the one
  // answer a security desk must never give by accident.
  let list: Awaited<ReturnType<typeof listActiveSessions>>;
  try {
    list = await listActiveSessions(c.env, currentJti);
  } catch {
    return c.json({
      error: 'Unreadable — the user_sessions table could not be read on this database. This is not a claim '
        + 'that nobody is signed in.',
      code: 'sessions_unreadable',
    }, 503);
  }

  // The support sessions answer for themselves: a database that never
  // impersonated has no table, and that costs this half, not the list.
  let impersonations:
    | { available: true; rows: Array<Awaited<ReturnType<typeof listLiveImpersonations>>[number] & { actor: Identity }> }
    | Absent;
  try {
    const live = await listLiveImpersonations(c.env);
    impersonations = {
      available: true,
      rows: live.map((i) => ({
        ...i,
        actor: supportIdentity(
          { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
          { id: i.target_user_id, name: i.target_name, email: i.target_email },
        ),
      })),
    };
  } catch {
    impersonations = absent('The impersonation_sessions table could not be read on this database.');
  }

  return c.json({
    token_hours: SESSION_TOKEN_HOURS,
    total: list.total,
    rows: list.rows,
    impersonations,
    expiry_minutes: IMPERSONATION_EXPIRY_MINUTES,
    // D4669 — every act on this list reaches this deployment only.
    scope: emergencyScope(c.env),
    // D4691 — the same definitions /overview's tiles are counted by.
    definitions: SESSION_STATUS_DEFINITIONS,
  });
});

r.post('/sessions/:id/revoke', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'A numeric session id is required.', code: 'invalid_target' }, 400);
  }
  const { reason } = await reasonOf(c);
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  // YOUR OWN CURRENT SESSION IS NOT REVOKED FROM HERE. The row is labelled
  // Current and offers no Revoke; a request that names it anyway is refused,
  // because the act would sign the operator out mid-incident with nothing
  // recorded about why the desk went dark. Sign out is the door for that.
  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;
  if (currentJti) {
    const own = await c.env.DB.prepare(
      'SELECT id FROM user_sessions WHERE jti = ?',
    ).bind(currentJti).first<{ id: number }>();
    if (own && Number(own.id) === id) {
      return c.json({
        error: 'That is the session you are using. Sign out to end it; it is not revoked from this list.',
        code: 'own_current_session',
      }, 409);
    }
  }

  const out = await revokeUserSession(c.env, id);
  if (out.outcome === 'not_found') {
    return c.json({ error: 'No session holds that id.', code: 'session_not_found' }, 404);
  }
  if (out.outcome === 'already_revoked') {
    return c.json({
      error: `That session was already revoked${out.revoked_at ? ` at ${out.revoked_at}` : ''}. Nothing was changed.`,
      code: 'already_revoked',
    }, 409);
  }
  // `target_user_id`, never `user_id` — D159's guard, and the key the
  // governance feed's LEFT JOIN names the account by.
  await logAdminAction(c.env, actor.id, actor.email, 'security_session_revoked', {
    reason,
    target_user_id: out.user_id,
    session_id: id,
    revoked_at: out.revoked_at,
  });
  return c.json({
    ok: true,
    session_id: id,
    user_id: out.user_id,
    revoked_at: out.revoked_at,
    message: 'Revoked. That session\'s token is refused from its next request; the account\'s other sessions '
      + 'are untouched.',
    scope: emergencyScope(c.env),
  });
});

r.post('/sessions/revoke', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const { reason, body } = await reasonOf(c);
  const raw = Array.isArray(body?.ids) ? (body.ids as unknown[]) : null;
  if (!raw || raw.length === 0) {
    return c.json({ error: 'Select at least one session.', code: 'no_sessions' }, 400);
  }
  if (raw.length > SESSION_BULK_LIMIT) {
    return c.json({
      error: `At most ${SESSION_BULK_LIMIT} sessions can be revoked in one request.`,
      code: 'too_many_sessions',
    }, 400);
  }
  const ids = [...new Set(raw.map((v) => Number(v)))];
  if (ids.some((v) => !Number.isInteger(v) || v <= 0)) {
    return c.json({ error: 'Every session id must be a positive number.', code: 'invalid_target' }, 400);
  }
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;
  const own = currentJti
    ? await c.env.DB.prepare('SELECT id FROM user_sessions WHERE jti = ?').bind(currentJti).first<{ id: number }>()
    : null;
  if (own && ids.includes(Number(own.id))) {
    return c.json({
      error: 'The selection includes the session you are using. Deselect it; sign out to end it.',
      code: 'own_current_session',
    }, 409);
  }

  // One at a time, each audited as it lands. A batch would be atomic, but the
  // audit writer is not part of it — and an act recorded for sessions that a
  // failed batch never revoked is worse than a partial result reported row by
  // row, which is what this returns.
  const results: Array<{ id: number; outcome: string }> = [];
  for (const id of ids) {
    const out = await revokeUserSession(c.env, id);
    if (out.outcome === 'revoked') {
      await logAdminAction(c.env, actor.id, actor.email, 'security_session_revoked', {
        reason,
        target_user_id: out.user_id,
        session_id: id,
        revoked_at: out.revoked_at,
        bulk: true,
      });
    }
    results.push({ id, outcome: out.outcome });
  }
  const revoked = results.filter((x) => x.outcome === 'revoked').length;
  return c.json({
    ok: true,
    revoked,
    results,
    message: revoked === results.length
      ? `Revoked ${revoked} session${revoked === 1 ? '' : 's'}.`
      : `Revoked ${revoked} of ${results.length}. The rest were already revoked or no longer exist; each is listed.`,
    scope: emergencyScope(c.env),
  });
});

r.post('/impersonations/:id/end', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'A numeric session id is required.', code: 'invalid_target' }, 400);
  }
  const { reason } = await reasonOf(c);
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  let out: Awaited<ReturnType<typeof endImpersonation>>;
  try {
    out = await endImpersonation(c.env, id);
  } catch {
    return c.json({
      error: 'Unreadable — the impersonation_sessions table could not be read, so nothing was changed.',
      code: 'impersonations_unreadable',
    }, 503);
  }
  if (out.outcome === 'not_found') {
    return c.json({ error: 'No support session holds that id.', code: 'session_not_found' }, 404);
  }
  if (out.outcome === 'already_ended') {
    return c.json({ error: 'That support session has already ended. Nothing was changed.', code: 'already_ended' }, 409);
  }
  if (out.outcome === 'past_ceiling') {
    return c.json({
      error: 'That record is older than the support-session ceiling, so no token for it can still be valid. '
        + 'Ending it now would stamp a time it did not end at; it stays recorded as not closed.',
      code: 'past_ceiling',
    }, 409);
  }
  await logAdminAction(c.env, actor.id, actor.email, 'security_impersonation_ended', {
    reason,
    target_user_id: out.row.target_user_id,
    impersonation_session_id: id,
    support_admin_user_id: out.row.admin_user_id,
    started_at: out.row.started_at,
  });
  return c.json({
    ok: true,
    impersonation_session_id: id,
    target_user_id: out.row.target_user_id,
    // D4669 — ENDING NOW ENDS THE ACCESS. The support token names this
    // record and every request re-reads it (auth.ts `sessionStanding`), so the
    // message no longer has to explain a token outliving its session.
    message: 'The support session is ended. Its token is refused from its next request, and it can no longer '
      + 'be extended. The account holder\'s own sessions are untouched.',
    scope: emergencyScope(c.env),
  });
});

/**
 * POST /api/admin/security/branch-sign-out
 *
 * D4669 part 2 (#4669) — the owner's option B: HQ's emergency sign-out may
 * reach branch deployments, ON REQUEST, and each branch reports its own
 * outcome. The ordinary acts above are unchanged and still write this
 * deployment only; this is the separate act an operator chooses when an
 * incident spans branches.
 *
 * Body: `{ branches: 'all' | string[], target, reason, op_key }`, where
 * `target` is `{ kind: 'all' }` (every account on each branch named),
 * `{ kind: 'account', email }` (the person's account on each branch named, by
 * email, because HQ's ids mean nothing in another database) or
 * `{ kind: 'account', user_id }` (one account HQ found on ONE branch).
 *
 * THE SAME BAR AS SIGNING EVERYONE OUT HERE (TOTP, a recent step-up, the
 * elevation), checked before any binding is touched. The branch checks the
 * caller is HQ, the reason, the operator's name and the key itself.
 *
 * EACH BRANCH IS ITS OWN ROW, and only an answer counts:
 *   done         the branch said it acted (with how many accounts, and
 *                `replayed` when this act was already on its record);
 *   failed       the branch refused before writing: nothing changed there;
 *   unreachable  not bound, or no answer in time: whether it acted is not
 *                known, and it NEVER counts as done.
 * The act is `done` only when every branch named said done, `failed` when none
 * did, and `partial` otherwise — said as partial, never rounded either way.
 *
 * ONE KEY PER OPERATOR REQUEST. The page makes it when the dialog opens and
 * resends it on Try again, and each branch answers a key it already holds
 * with that record. So retrying a branch that timed out cannot sign anyone
 * out twice or write a second audit row there.
 *
 * GATES THAT STAY: `HQ_RPC_SECRET` must be set (409 otherwise, as for every
 * secret-carrying branch call), and a branch without a binding is reported,
 * not skipped.
 */
r.post('/branch-sign-out', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const { reason, body } = await reasonOf(c);
  if (reason.length < EMERGENCY_REASON_MIN) {
    return c.json({
      error: `A reason of at least ${EMERGENCY_REASON_MIN} characters is required. It is stored here and on every branch reached.`,
      code: 'reason_required',
    }, 400);
  }
  const opKey = String(body?.op_key ?? '');
  if (!EMERGENCY_OP_KEY_RE.test(opKey)) {
    return c.json({ error: 'The request carries no operation key, so a retry could not be recognised. Reopen the dialog.', code: 'op_key_required' }, 400);
  }

  const t = (body?.target ?? {}) as Record<string, unknown>;
  let target: BranchSignOutTarget;
  if (t.kind === 'all') {
    target = { kind: 'all' };
  } else if (t.kind === 'account' && typeof t.email === 'string' && t.email.includes('@')) {
    target = { kind: 'account', email: t.email.trim().toLowerCase().slice(0, 320) };
  } else if (t.kind === 'account' && Number.isInteger(Number(t.user_id)) && Number(t.user_id) > 0) {
    target = { kind: 'account', user_id: Number(t.user_id) };
  } else {
    return c.json({ error: 'Name the target: every account, or one account by email (or by its id on one branch).', code: 'invalid_target' }, 400);
  }

  const bound = (() => { try { return branchBindings(c.env).map((b) => b.code); } catch { return null; } })();
  if (bound === null) {
    return c.json({ error: 'Which branches are bound could not be read, so no branch was asked. Nothing changed.', code: 'branches_unreadable' }, 503);
  }
  let codes: string[];
  if (body?.branches === 'all') {
    codes = bound;
  } else if (Array.isArray(body?.branches)) {
    codes = [...new Set((body.branches as unknown[]).map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean))];
  } else {
    return c.json({ error: 'Name the branches: every bound branch, or a list of branch codes.', code: 'invalid_branches' }, 400);
  }
  if (codes.length === 0) {
    return c.json({ error: 'No branch is bound here, so there is no branch to reach. Nothing changed.', code: 'no_branch' }, 409);
  }
  if ('user_id' in target && codes.length !== 1) {
    return c.json({ error: 'An account id belongs to one branch. Name that one branch, or name the person by email.', code: 'invalid_target' }, 400);
  }
  if (!c.env.HQ_RPC_SECRET) {
    return c.json({
      error: 'HQ_RPC_SECRET is not set on this Worker, so a branch cannot tell this call from any other Worker in the account. '
        + 'Set it, then try again. No branch was asked.',
      code: 'hq_rpc_secret_unset',
    }, 409);
  }

  const result = await signOutOnBranches(c.env, codes, {
    secret: c.env.HQ_RPC_SECRET,
    hq_actor_name: String((actor as { name?: string }).name || actor.email || 'Axal VC HQ').slice(0, 200),
    reason,
    op_key: opKey,
    target,
  });

  // HQ's record of the act, after the outcome is known and whatever it is: an
  // operator's request to sign people out of other deployments is recorded
  // even when no branch answered. `logAdminAction` never throws, so its
  // failure never turns a reported outcome into an error.
  await logAdminAction(c.env, actor.id, actor.email, 'security_branch_sign_out', {
    reason,
    op_key: opKey,
    target_kind: target.kind,
    ...('email' in target ? { target_email: target.email } : {}),
    ...('user_id' in target ? { branch_user_id: target.user_id } : {}),
    outcome: result.outcome,
    branches: result.outcomes.map((o) => ({ code: o.deployment, outcome: o.outcome, affected: o.affected ?? null })),
  });

  const done = result.outcomes.filter((o) => o.outcome === 'done').length;
  const message = result.outcome === 'done'
    ? `Every branch asked (${done}) answered that it signed the ${target.kind === 'all' ? 'accounts' : 'account'} out.`
    : result.outcome === 'partial'
      ? `${done} of ${result.outcomes.length} branches answered that they acted. The others are listed with what is known; a branch that did not answer is not counted as done.`
      : 'No branch answered that it acted. Each is listed with what is known.';
  return c.json({
    ok: result.outcome === 'done',
    outcome: result.outcome,
    op_key: opKey,
    message,
    outcomes: result.outcomes,
    scope: emergencyScope(c.env),
  });
});

/**
 * ONE ACCOUNT, which is the whole point: until D165 the only revoke HQ had was
 * the platform-wide one below, so signing out a single compromised admin meant
 * signing out EVERY account on every tenant — and in a real incident the safe
 * action is then the one nobody is willing to take.
 *
 * The primitive was already per-account. `bumpJwtMinIat` writes one row and
 * `getCurrentUser` re-reads that row's floor on every request, so one bump
 * invalidates exactly that account's tokens. What was missing was a door.
 *
 * SAME BAR AS THE BULK ROUTE, and deliberately not a lower one. Signing one
 * admin out is a smaller act than signing everyone out, so a cheaper gate would
 * be defensible — and it would be wrong: this is the route an attacker who has
 * an admin session would reach for to lock the real holder out. `requireFactor`
 * + `requireStepUp` is what makes a stolen session unable to use it.
 */
r.post('/force-reauth/:userId', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);

  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) {
    return c.json({ error: 'A numeric user id is required.', code: 'invalid_target' }, 400);
  }

  let reason = '';
  try { reason = String((await c.req.json())?.reason ?? '').trim(); } catch { reason = ''; }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }

  // REFUSE AN ABSENT TARGET rather than reporting a revoke of nobody. The UPDATE
  // would succeed with `changes: 0` and the audit row would name a user id that
  // joins to no one, which reads in HQ's feed as an act against a person who
  // does not exist.
  const target = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ?',
  ).bind(uid).first<{ id: number; email: string; name: string | null }>();
  if (!target) {
    return c.json({ error: 'No account holds that id.', code: 'user_not_found' }, 404);
  }

  // D4669 — A FAILED WRITE IS SAID, NOT THROWN. The floor is the whole act;
  // if it could not be raised nothing changed, and the operator must know
  // that rather than meet a generic error mid-incident.
  let revokedAt: number;
  try {
    revokedAt = await bumpJwtMinIat(c.env, uid);
  } catch (e) {
    console.error('[admin_security] force-reauth/:userId failed', (e as Error).message);
    return c.json({
      error: 'The sign-out could not be written, so nothing was changed: the account\'s sessions are still valid. '
        + 'Try again; if it keeps failing, revoke its sessions one by one.',
      code: 'sign_out_failed',
      outcomes: deploymentOutcomes(c.env, { outcome: 'failed' }),
      scope: emergencyScope(c.env),
    }, 503);
  }

  // `target_user_id` is the key `logAdminAction` reads for `viewed_user_id`, and
  // it is what lets the governance feed's LEFT JOIN name WHO was signed out.
  // Spelt `user_id` it would record the act with a blank Target, silently —
  // which is why D159's guard refuses that spelling at every call site.
  await logAdminAction(c.env, actor.id, actor.email, 'security_force_reauth_user', {
    reason,
    target_user_id: uid,
    revoked_at: revokedAt,
  });

  return c.json({
    ok: true,
    user_id: uid,
    email: target.email,
    revoked_at: revokedAt,
    // D4669 — "every session" on THIS deployment. An account of the same
    // person on a branch is a different account in a different database.
    message: `${target.name || target.email} has been signed out of every session on this deployment, including `
      + 'any support session opened as them. They will need to sign in again.',
    outcomes: deploymentOutcomes(c.env, { outcome: 'done', affected: 1 }),
    scope: emergencyScope(c.env),
  });
});

r.post('/force-reauth', async (c) => {
  // D165 — three hand-rolled gates became the shared bar. `requireSuperAdminWriteBar`
  // composes requireFactor('totp') -> requireStepUp -> requireSuperAdmin in that
  // order, with the argument for the order in its own docblock; this route was the
  // fourth copy of those three lines, and three copies is how one of them comes to
  // check only two. The order is now pinned where it is DEFINED rather than in each
  // copy, which is the stronger place for it.
  const actor = await requireSuperAdminWriteBar(c);

  let reason = '';
  try { reason = String((await c.req.json())?.reason ?? '').trim(); } catch { reason = ''; }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }

  // +1s so tokens issued in this same second are bounced too, exactly as the
  // per-account primitive does. Inactive accounts cannot sign in anyway.
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  let affected: number;
  try {
    const result = await c.env.DB.prepare(
      'UPDATE users SET jwt_min_iat = ? WHERE is_active = 1',
    ).bind(nowSec).run();
    affected = Number(result.meta?.changes ?? 0);
  } catch (e) {
    // D4669 — one statement, so a failure changed nothing. Said, with the
    // per-deployment answer, rather than a generic 500.
    console.error('[admin_security] force-reauth failed', (e as Error).message);
    return c.json({
      error: 'The sign-out could not be written, so nothing was changed: every session is still valid. Try again.',
      code: 'sign_out_failed',
      outcomes: deploymentOutcomes(c.env, { outcome: 'failed' }),
      scope: emergencyScope(c.env),
    }, 503);
  }

  // D165 — was a raw INSERT into admin_audit_log, which is the third copy D159
  // set out to end and missed. `filters_json` carries the same payload, so the
  // governance row is unchanged; what the shared writer adds is the `activity_logs`
  // row D159 requires of every privileged action, and what it REMOVES is a way for
  // this handler to fail after the fact: a bare `await ...run()` throws, so a failed
  // audit write turned a completed platform-wide sign-out into a 500 and told the
  // operator their act had not happened. `logAdminAction` warns and continues,
  // because a recorded act must never be undone by its own telemetry.
  await logAdminAction(c.env, actor.id, actor.email, 'security_force_reauth', {
    reason, affected, revoked_at: nowSec,
  });

  return c.json({
    ok: true,
    affected,
    revoked_at: nowSec,
    // D4669 — THIS DEPLOYMENT, and the answer says which branches it did not
    // reach. The old sentence ("everywhere") read as platform-wide while the
    // write touched one database.
    message: 'Every active account on this deployment has been signed out, including yours. Branch deployments '
      + 'are not reached by this action; each is listed. Sign in again with your authenticator.',
    outcomes: deploymentOutcomes(c.env, { outcome: 'done', affected }),
    scope: emergencyScope(c.env),
  });
});

/**
 * D168 — CLOSE A DATA-SUBJECT REQUEST.
 *
 * THE DEFECT THIS EXISTS FOR. Before this route, `users.deletion_requested_at`
 * was written only by the subject (routes/settings.ts request and cancel),
 * read here against a statutory 30-day clock, and rendered by SecurityPage in
 * amber with an overdue count — and this file declared four handlers, none of
 * which could act on one. HQ watched a legal deadline it had no way to stop.
 *
 * SAME BAR AS FORCE RE-AUTH, and for a reason of its own rather than by
 * symmetry: closing a request stops a statutory clock and writes the record
 * a regulator would read.
 *
 * D4675 — THE REVIEWED REQUEST, ONCE. The body names the request the operator
 * reviewed (`requested_at`, and `request_id` when the list had one) and a
 * `close_key` the page made once for this close. The service applies the
 * close only to that request while it is still open, writes the decision, the
 * subject's notice and both audit rows in one batch, and answers a retry of
 * the same key with the record it already made. Every answer says what is on
 * record: closed, already closed by this act, nothing written because the
 * request changed or was closed first, or unconfirmed.
 */
r.post('/dsr/:userId/close', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);

  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) {
    return c.json({ error: 'A numeric user id is required.', code: 'invalid_target' }, 400);
  }

  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  const outcome = String(body?.outcome ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  const requestedAt = typeof body?.requested_at === 'string' ? body.requested_at : '';
  const rawId = body?.request_id;
  const requestId = rawId === null || rawId === undefined ? null : Number(rawId);
  const closeKey = typeof body?.close_key === 'string' ? body.close_key : '';

  if (!isHqDsrOutcome(outcome)) {
    return c.json({
      error: `Outcome must be one of ${HQ_DSR_OUTCOMES.join(' or ')}. A withdrawal is the subject's own act and `
        + 'is recorded when they cancel, not by HQ.',
      code: 'invalid_outcome',
    }, 400);
  }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }
  if (!requestedAt || !DSR_CLOSE_KEY_RE.test(closeKey)
      || (requestId !== null && (!Number.isInteger(requestId) || requestId <= 0))) {
    return c.json({
      error: 'This close does not say which request was reviewed. Reload the Security page and close it again.',
      code: 'review_required',
    }, 400);
  }

  // REFUSE AN ABSENT TARGET rather than reporting a close of nobody: the
  // audit row would name a subject who does not exist against a statutory act.
  const target = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ?',
  ).bind(uid).first<{ id: number; email: string; name: string | null }>();
  if (!target) {
    return c.json({ error: 'No account holds that id.', code: 'user_not_found' }, 404);
  }

  const subject = target.name || target.email;
  let result;
  try {
    await ensureAdminAuditLogTable(c.env);
    // `target_user_id: uid` is how the audit row names the subject (D159);
    // the service writes it in the same batch as the decision.
    result = await closeDsrRequest(c.env, {
      userId: uid, actorUserId: actor.id, actorEmail: actor.email, outcome, reason,
      requestedAt, requestId, closeKey,
    });
  } catch (e) {
    return c.json({
      error: 'The close could not be confirmed. As far as this server can tell nothing was recorded and the '
        + 'request is still open; repeating it records it at most once. '
        + `Migration 272 creates \`dsr_requests\`. (${(e as Error).message})`,
      code: 'ledger_unavailable',
    }, 503);
  }

  if (result.status === 'unconfirmed') {
    return c.json({
      ok: false,
      code: 'outcome_unconfirmed',
      error: 'The close was sent, but whether it was recorded could not be read back. Try again: repeating '
        + 'this close records it at most once.',
    }, 202);
  }
  if (result.status === 'key_conflict') {
    return c.json({
      error: 'This close carries a key already used for a different close. Reload the page and close it again.',
      code: 'idempotency_key_conflict',
    }, 409);
  }
  if (result.status === 'stale') {
    return c.json({
      error: 'Nothing was recorded. The request you reviewed is no longer the open one: the subject withdrew it '
        + 'and asked again. Reload to review the current request.',
      code: 'stale_request',
      current_requested_at: result.current_requested_at,
    }, 409);
  }
  if (result.status === 'not_open') {
    return c.json({
      error: 'Nothing was recorded. That account has no open erasure request: it was closed first, or the '
        + 'subject cancelled it themselves.',
      code: 'no_open_request',
      last_outcome: result.last?.outcome ?? null,
      last_outcome_at: result.last?.closed_at ?? null,
    }, 409);
  }

  return c.json({
    ok: true,
    replayed: result.replayed,
    user_id: uid,
    request_id: result.row.id,
    email: target.email,
    outcome,
    requested_at: result.row.requested_at,
    // THE RESPONSE SAYS WHAT WAS AND WAS NOT DONE. `fulfilled` records that
    // the manual erasure happened; this platform performs none, and a message
    // implying otherwise would be the false claim the outcome list exists to
    // avoid.
    message: (result.replayed ? 'Already on record from your earlier attempt. ' : '') + (outcome === 'fulfilled'
      ? `Recorded: ${subject}'s erasure request was fulfilled. This stops the statutory clock and records who `
        + 'closed it and why. It does not itself erase anything — the erasure is the manual act you are recording.'
      : `Recorded: ${subject}'s erasure request was denied, with your reason stored against it. The statutory `
        + 'clock has stopped; they can make a new request.'),
  });
});

export default r;
