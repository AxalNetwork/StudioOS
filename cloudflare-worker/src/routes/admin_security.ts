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
 *   POST /force-reauth    sign every active account out, everywhere, with a
 *                         typed reason; recorded in admin_audit_log
 *   POST /dsr/:userId/close   close a data-subject erasure request as
 *                         fulfilled or denied, with a typed reason (D168)
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
import { IMPERSONATION_EXPIRY_MINUTES, requireSuperAdmin, requireSuperAdminWriteBar, bumpJwtMinIat } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { loadGuardrailCounters } from '../services/aiRouter';
import {
  loadSecurityEventCounts, SECURITY_EVENT_KINDS, SECURITY_EVENT_RETENTION_DAYS, SECURITY_EVENTS_NOT_COUNTED,
} from '../services/securityEvents';
import { screeningSummary } from '../services/sanctions';
import { readBackupHeartbeat, RESTORE_DRILL_REASON } from '../services/backup';
import { branchBindings } from '../services/branches';
import {
  HQ_DSR_OUTCOMES, isHqDsrOutcome, loadDsrHistory, closeDsrRequest, dsrDaysLeft, DSR_CLOCK_DAYS,
} from '../services/dsrRequests';

const r = new Hono<{ Bindings: Env }>();

const IMPERSONATION_LIMIT = 25;
const SESSION_WINDOW_DAYS = 30;
const MIN_REASON = 8;


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
  {
    what: 'Token anomalies',
    reason: 'Nothing watches per-account token consumption for a spike. Spend is capped per user per day and '
      + 'per month, and a cap being hit is recorded as a refusal — but a refusal is a limit reached, not an '
      + 'anomaly detected.',
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
  const counters = await loadGuardrailCounters(env, AI_SAFETY_WINDOW_DAYS);
  return {
    available: true,
    window_days: counters.window_days,
    since: counters.since,
    verdicts: counters.verdicts,
    enforcement: counters.enforcement,
    not_counted: AI_SAFETY_NOT_COUNTED,
  };
}

/** SQLite's `datetime('now')` is 'YYYY-MM-DD HH:MM:SS' (UTC, no zone). */
function parseSqlTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
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
  const auditTotal = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first<{ n: number }>();

  // Impersonation: the table is created lazily by services/cohortTiming.ts on
  // first use, so a database that has never impersonated has no table. That
  // is "no sessions", but reported as unreadable rather than guessed at.
  let impersonations: { available: true; active: number; recent: Record<string, unknown>[] } | Absent;
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
    const active = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM impersonation_sessions WHERE ended_at IS NULL',
    ).first<{ n: number }>();
    impersonations = { available: true, active: Number(active?.n) || 0, recent: recent.results || [] };
  } catch {
    impersonations = absent('The impersonation_sessions table could not be read on this database.');
  }

  // Sessions: one row per JWT mint (routes/settings.ts). "Active" is a row not
  // revoked and seen inside the window; a token's own expiry is not stored
  // here, so the window is the honest bound.
  let sessions: { available: true; active: number; window_days: number } | Absent;
  try {
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_sessions
        WHERE revoked_at IS NULL AND last_seen_at >= datetime('now', ?)`,
    ).bind(`-${SESSION_WINDOW_DAYS} days`).first<{ n: number }>();
    sessions = { available: true, active: Number(active?.n) || 0, window_days: SESSION_WINDOW_DAYS };
  } catch {
    sessions = absent('The user_sessions table could not be read on this database.');
  }

  const admins = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN tfa_methods IS NOT NULL AND tfa_methods <> '[]' THEN 1 ELSE 0 END) AS with_mfa
       FROM users WHERE LOWER(role) = 'admin' AND is_active = 1`,
  ).first<{ total: number; with_mfa: number }>();

  const kycRows = await env.DB.prepare(
    'SELECT kyc_status, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY kyc_status',
  ).all<{ kyc_status: string | null; n: number }>();
  const kyc: Record<string, number> = {};
  for (const row of kycRows.results || []) kyc[String(row.kyc_status ?? 'not_started')] = Number(row.n) || 0;

  const dsrRows = await env.DB.prepare(
    `SELECT id, email, name, role, deletion_requested_at FROM users
      WHERE deletion_requested_at IS NOT NULL
      ORDER BY deletion_requested_at ASC`,
  ).all<{ id: number; email: string; name: string; role: string; deletion_requested_at: string }>();

  // D168 — WHAT EACH SUBJECT HAS ASKED BEFORE. `users.deletion_requested_at`
  // is still the one source of "open" (see migration 272), so the list above
  // is unchanged; this read only adds history, and a repeat request has to be
  // visible as one or HQ reads a third ask as a first. Its unreadable state is
  // its own — see `loadDsrHistory`, which is where the reason for that lives.
  const ledger = await loadDsrHistory(env);
  const ledgerAvailable = ledger.available;
  const ledgerReason = ledger.available ? null : ledger.reason;

  const now = Date.now();
  const dsr = (dsrRows.results || []).map((u) => {
    const seen = ledger.available ? ledger.byUser.get(u.id) : undefined;
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      requested_at: u.deletion_requested_at,
      // null when the timestamp cannot be parsed: an unknown clock is not a
      // clock at zero. The arithmetic lives in the service so it can fail a
      // test — it had never had one.
      days_left: dsrDaysLeft(parseSqlTs(u.deletion_requested_at), now),
      // null rather than 0 whenever the ledger could not be read — see above.
      prior_requests: ledgerAvailable ? (seen?.prior ?? 0) : null,
      last_outcome: ledgerAvailable ? (seen?.outcome ?? null) : null,
      last_outcome_at: ledgerAvailable ? (seen?.closed_at ?? null) : null,
    };
  });

  return c.json({
    audit: { total: Number(auditTotal?.n) || 0, feed: '/api/admin/security/governance' },
    impersonations,
    sessions,
    mfa: { admins_total: Number(admins?.total) || 0, admins_with_mfa: Number(admins?.with_mfa) || 0 },
    kyc,
    dsr: {
      clock_days: DSR_CLOCK_DAYS,
      rows: dsr,
      // D200 — H23 draws the DSR clocks "by territory · runs against the
      // holding branch". Every request this database holds is HQ-held by
      // construction, so the grouping has one group, and the second field says
      // why there is not a second: no branch RPC returns a branch's erasure
      // requests, and the brief forbids fanning out for one.
      by_branch: [{ branch: 'HQ-held', open: dsr.length }],
      branches: { bound: boundBranchCount(env), reason: DSR_BRANCH_REASON },
      ledger_available: ledgerAvailable,
      ...(ledgerReason ? { ledger_reason: ledgerReason } : {}),
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
    // unbound, absent when nothing was ever written, present with its stamp);
    // the drill half stays a stated absence for the runtime reason in
    // RESTORE_DRILL_REASON. Never one green light inferred from the other.
    backup_dr: {
      backup: await readBackupHeartbeat(env, 'd1'),
      drill: absent(RESTORE_DRILL_REASON),
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
 */
const ACTOR_SIDE_ACTIONS = [
  'role_changed', 'user_toggled',
  'kyc_approved_by_admin', 'kyc_bypass_granted', 'kyc_rejected_by_admin', 'kyc_document_access',
  'contract_resent', 'contract_voided',
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
function impersonationOutcome(i: ImpersonationRow, now: number): 'live' | 'ended' | 'not closed' {
  if (i.ended_at) return 'ended';
  const started = parseSqlTs(i.started_at as string);
  const elapsed = Number.isNaN(started) ? null : minutesBetween(started, now);
  return elapsed !== null && elapsed >= IMPERSONATION_EXPIRY_MINUTES ? 'not closed' : 'live';
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
    ORDER BY a.exported_at DESC, a.id DESC LIMIT ?`;

const FEED_AUDIT_EXPORTS_SQL = `SELECT a.id, a.action, a.report_type, a.format, a.filters_json, a.exported_at,
          u.name AS admin_name, u.email AS admin_email, a.admin_user_id,
          t.name AS target_name, t.email AS target_email, a.viewed_user_id
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     LEFT JOIN users t ON t.id = a.viewed_user_id
    WHERE a.action LIKE '%export%'
    ORDER BY a.exported_at DESC, a.id DESC LIMIT ?`;

/** Eight placeholders, one per entry in ACTOR_SIDE_ACTIONS. */
const FEED_ACTIVITY_ACTOR_SIDE_SQL = `SELECT l.id, l.action, l.details, l.created_at, l.user_id,
          u.name AS actor_name, u.email AS actor_email
     FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action IN (?, ?, ?, ?, ?, ?, ?, ?)
    ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;

/** One placeholder, one per entry in SUSPENSION_ACTIVITY_ACTIONS. */
const FEED_ACTIVITY_SUSPENSIONS_SQL = `SELECT l.id, l.action, l.details, l.created_at, l.user_id,
          u.name AS actor_name, u.email AS actor_email
     FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action IN (?)
    ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;

const FEED_LICENCE_ALL_SQL = `SELECT e.id, e.event, e.note, e.created_at, e.actor_user_id,
          u.name AS actor_name, u.email AS actor_email,
          l.licence_ref, l.brand_name
     FROM licence_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN territory_licences l ON l.id = e.licence_id
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`;

/** Two placeholders, one per entry in SUSPENSION_LICENCE_EVENTS. */
const FEED_LICENCE_SUSPENSIONS_SQL = `SELECT e.id, e.event, e.note, e.created_at, e.actor_user_id,
          u.name AS actor_name, u.email AS actor_email,
          l.licence_ref, l.brand_name
     FROM licence_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN territory_licences l ON l.id = e.licence_id
    WHERE e.event IN (?, ?)
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`;

/**
 * D200 — the fifth store. The subject joins to an account where the event
 * named one; the address a refused attempt presented is never stored, so a
 * row that resolves to nobody is its network bucket and nothing more.
 */
const FEED_SECURITY_EVENTS_SQL = `SELECT s.id, s.kind, s.factor, s.outcome, s.detail, s.user_id, s.ip_prefix,
          s.branch_code, s.occurred_at,
          u.name AS subject_name, u.email AS subject_email
     FROM security_events s
     LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.occurred_at DESC, s.id DESC LIMIT ?`;

type ImpersonationRow = Record<string, unknown>;

r.get('/governance', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const asked = String(c.req.query('filter') || 'all');
  // An unknown filter falls back to the whole feed rather than to nothing: a
  // stale bookmark should show more than it asked for, never less.
  const filter = FEED_FILTERS.some((f) => f.key === asked) ? asked : 'all';
  const now = Date.now();

  const readAudit = filter === 'all' || filter === 'exports';
  const readActivity = filter === 'all' || filter === 'suspensions';
  const readImpersonations = filter === 'all' || filter === 'impersonations';
  const readLicences = filter === 'all' || filter === 'licence_changes' || filter === 'suspensions';
  const readSecurity = filter === 'all' || filter === 'auth';

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
        .bind(FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const a of got) {
        const action = String(a.action || '');
        const reason = reasonFrom(a.filters_json);
        rows.push({
          key: `audit:${a.id}`,
          at: (a.exported_at as string) || null,
          ts: parseSqlTs(a.exported_at as string),
          actor: who(a.admin_name, a.admin_email, a.admin_user_id),
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
        .bind(...allow, FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const l of got) {
        const action = String(l.action || '');
        rows.push({
          key: `activity:${l.id}`,
          at: (l.created_at as string) || null,
          ts: parseSqlTs(l.created_at as string),
          actor: who(l.actor_name, l.actor_email, l.user_id),
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
    if (impersonations === null) {
      sources.push({ table: 'impersonation_sessions', available: false, reason: IMPERSONATION_UNREADABLE });
    } else {
      for (const i of impersonations) {
        rows.push({
          key: `impersonation:${i.id}`,
          at: (i.started_at as string) || null,
          ts: parseSqlTs(i.started_at as string),
          actor: who(i.admin_name, i.admin_email, i.admin_user_id),
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
      sources.push({ table: 'impersonation_sessions', available: true, rows: took(impersonations.length) });
    }
  }

  // ── licence_events — the one store that can name a tenant ─────────────
  if (readLicences) {
    try {
      const res = filter === 'suspensions'
        ? await env.DB.prepare(FEED_LICENCE_SUSPENSIONS_SQL)
          .bind(...SUSPENSION_LICENCE_EVENTS, FEED_LIMIT).all<Record<string, unknown>>()
        : await env.DB.prepare(FEED_LICENCE_ALL_SQL)
          .bind(FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const e of got) {
        const event = String(e.event || '');
        rows.push({
          key: `licence:${e.id}`,
          at: (e.created_at as string) || null,
          ts: parseSqlTs(e.created_at as string),
          actor: who(e.actor_name, e.actor_email, e.actor_user_id),
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
      const res = await env.DB.prepare(FEED_SECURITY_EVENTS_SQL).bind(FEED_LIMIT).all<Record<string, unknown>>();
      const got = res.results || [];
      for (const s of got) {
        const outcome = String(s.outcome || '');
        const branch = String(s.branch_code || 'hq');
        rows.push({
          key: `security:${s.id}`,
          at: (s.occurred_at as string) || null,
          ts: parseSqlTs(s.occurred_at as string),
          // A subject that resolved to an account is named; one that did not
          // is its network, because the address a refused attempt presented
          // was hashed before it reached the row and is not recoverable.
          actor: who(s.subject_name, s.subject_email, s.user_id) || `network ${String(s.ip_prefix || 'unknown')}`,
          action: `${String(s.kind || '')}.${String(s.factor || '')}`,
          // The deployment that recorded it — a fact about where, not whose.
          tenant: branch === 'hq' ? 'HQ' : branch,
          target: s.detail ? `detail=${String(s.detail)}` : null,
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
  const page = rows.slice(0, FEED_LIMIT).map(({ ts, ...row }) => row);

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
        const live = !i.ended_at;
        const elapsed = Number.isNaN(started) || (!live && Number.isNaN(ended))
          ? null
          : minutesBetween(started, live ? now : ended);
        let dur: string | null;
        if (elapsed === null) dur = null;
        else if (!live) dur = `${elapsed}m`;
        else if (elapsed >= IMPERSONATION_EXPIRY_MINUTES) {
          // The token expired at thirty minutes; closing the row is a
          // best-effort write on the way out (routes/admin.ts), so an open
          // row past the limit means the record was never closed, NOT that
          // somebody is still inside. "0m left" would claim the opposite.
          dur = 'not closed';
        } else dur = `${IMPERSONATION_EXPIRY_MINUTES - elapsed}m left`;
        return {
          kind: 'impersonation',
          what: `Impersonation · ${who(i.target_name, i.target_email, i.target_user_id) || 'unknown account'}`,
          meta: [
            who(i.admin_name, i.admin_email, i.admin_user_id),
            stamp(i.started_at),
            i.context ? clip(String(i.context), 120) : null,
          ].filter(Boolean).join(' · '),
          dur,
          live,
          overdue: Boolean(live && elapsed !== null && elapsed >= IMPERSONATION_EXPIRY_MINUTES),
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
        what: `Export · ${e.report_type ? String(e.report_type) : String(e.action || 'report')}`,
        meta: [
          who(e.admin_name, e.admin_email, e.admin_user_id),
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

  const revokedAt = await bumpJwtMinIat(c.env, uid);

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
    message: `${target.name || target.email} has been signed out of every session. They will need to sign in again.`,
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
  const result = await c.env.DB.prepare(
    'UPDATE users SET jwt_min_iat = ? WHERE is_active = 1',
  ).bind(nowSec).run();
  const affected = Number(result.meta?.changes ?? 0);

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
    message: 'Every active account has been signed out everywhere, including yours. Sign in again with your authenticator.',
  });
});

/**
 * D168 — CLOSE A DATA-SUBJECT REQUEST.
 *
 * THE DEFECT THIS EXISTS FOR. Before this route, `users.deletion_requested_at`
 * was written only by the subject (routes/settings.ts request and cancel),
 * read here against a statutory 30-day clock, and rendered by SecurityPage in
 * amber with an overdue count — and this file declared four handlers, none of
 * which could act on one. The only way a row left HQ's list was the subject
 * cancelling. HQ watched a legal deadline it had no way to stop.
 *
 * SAME BAR AS FORCE RE-AUTH, and for a reason of its own rather than by
 * symmetry: closing a request stops a statutory clock and writes the record
 * a regulator would read. A cheaper gate would make the one act whose whole
 * value is its trustworthiness the easiest one in this file to perform.
 *
 * BOTH HALVES MOVE IN ONE BATCH. The ledger row and `users.deletion_requested_at`
 * are the record and the open flag; if either moved alone they would disagree,
 * and the disagreement would be invisible — one screen would show a closed
 * request still open, or an open request nobody can see. If the batch cannot
 * run, NOTHING moves and the refusal says why: clearing the flag with no
 * record is strictly worse than failing.
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

  // REFUSE AN ABSENT TARGET rather than reporting a close of nobody — the same
  // rule /force-reauth/:userId states above, and it bites harder here: the
  // audit row would name a subject who does not exist against a statutory act.
  const target = await c.env.DB.prepare(
    'SELECT id, email, name, deletion_requested_at FROM users WHERE id = ?',
  ).bind(uid).first<{ id: number; email: string; name: string | null; deletion_requested_at: string | null }>();
  if (!target) {
    return c.json({ error: 'No account holds that id.', code: 'user_not_found' }, 404);
  }
  if (!target.deletion_requested_at) {
    return c.json({
      error: 'That account has no open erasure request. One may have been closed already, or the subject '
        + 'may have cancelled it themselves.',
      code: 'no_open_request',
    }, 409);
  }

  const subject = target.name || target.email;
  try {
    await closeDsrRequest(c.env, { userId: uid, actorUserId: actor.id, outcome, reason });
  } catch (e) {
    return c.json({
      error: 'The request ledger could not be written, so nothing was changed — the request is still open. '
        + `Migration 272 creates \`dsr_requests\`. (${(e as Error).message})`,
      code: 'ledger_unavailable',
    }, 503);
  }

  // `target_user_id` is the key `logAdminAction` reads for `viewed_user_id`,
  // and it is what lets the governance feed's LEFT JOIN name the subject.
  // Spelt `user_id` it would record a statutory act with a blank Target —
  // which is why D159's guard refuses that spelling at every call site.
  await logAdminAction(c.env, actor.id, actor.email, 'dsr_request_closed', {
    reason,
    target_user_id: uid,
    outcome,
  });

  return c.json({
    ok: true,
    user_id: uid,
    email: target.email,
    outcome,
    requested_at: target.deletion_requested_at,
    // THE RESPONSE SAYS WHAT WAS AND WAS NOT DONE. `fulfilled` records that
    // the manual erasure happened; this platform performs none, and a message
    // implying otherwise would be the false claim the outcome list exists to
    // avoid.
    message: outcome === 'fulfilled'
      ? `Recorded: ${subject}'s erasure request was fulfilled. This stops the statutory clock and records who `
        + 'closed it and why. It does not itself erase anything — the erasure is the manual act you are recording.'
      : `Recorded: ${subject}'s erasure request was denied, with your reason stored against it. The statutory `
        + 'clock has stopped; they can make a new request.',
  });
});

export default r;
