/**
 * HQ · Security (Support Security · Super canvas, Y2; decision A4 renamed the
 * row from Governance).
 *
 * SUPER ADMIN ONLY, every route. This is the cross-tenant security desk: at
 * HQ scale the compliance officer and the security engineer are one headcount
 * and one page. A subsidiary admin has no security console by design (A5).
 *
 *   GET  /overview        one payload for the Security page
 *   GET  /governance      canvas H7's privileged-action feed, unioned across
 *                         the four stores that actually record one
 *   POST /force-reauth    sign every active account out, everywhere, with a
 *                         typed reason; recorded in admin_audit_log
 *
 * WHAT IS REAL HERE. The admin action audit (`admin_audit_log`, every action,
 * newest first — the existing /monitoring/audit read allows two actions only);
 * impersonation sessions, live and recent; active sessions and MFA coverage
 * among admins; the KYC queue by status; data-subject deletion requests with
 * the statutory clock.
 *
 * WHAT IS NOT, AND IS NAMED RATHER THAN SAMPLED. A `security_events` ledger
 * (failed sign-ins, step-ups, permission grants, exports as one feed) — the
 * canvas calls it "the one real backend build" and it is not built; AI-safety
 * counters; a sanctions screen; backup and restore-drill status. Each comes
 * back `{ available: false, reason }` so the page says so in the zone the
 * canvas draws for it, instead of rendering the canvas's sample rows.
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
import { IMPERSONATION_EXPIRY_MINUTES, requireFactor, requireStepUp, requireSuperAdmin } from '../auth';

const r = new Hono<{ Bindings: Env }>();

const IMPERSONATION_LIMIT = 25;
const SESSION_WINDOW_DAYS = 30;
/** GDPR Art. 12(3): one month from receipt. Counted from the request, not from triage. */
const DSR_CLOCK_DAYS = 30;
const MIN_REASON = 8;

type Absent = { available: false; reason: string };
const absent = (reason: string): Absent => ({ available: false, reason });

/**
 * One sentence, two zones. `/overview` says it in the AI-safety zone and
 * `/governance` says it in H7's guardrail panel; two literals would drift the
 * day one of them is reworded, so there is one.
 */
const NO_AI_SAFETY_STORE = 'No guardrail-hit, flagged-output or token-anomaly counter is stored for the AI rails.';

/** SQLite's `datetime('now')` is 'YYYY-MM-DD HH:MM:SS' (UTC, no zone). */
function parseSqlTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
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
  const now = Date.now();
  const dsr = (dsrRows.results || []).map((u) => {
    const requested = parseSqlTs(u.deletion_requested_at);
    const elapsedDays = Number.isNaN(requested) ? null : Math.floor((now - requested) / 86400000);
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      requested_at: u.deletion_requested_at,
      // null when the timestamp cannot be parsed: an unknown clock is not a
      // clock at zero.
      days_left: elapsedDays === null ? null : DSR_CLOCK_DAYS - elapsedDays,
    };
  });

  return c.json({
    audit: { total: Number(auditTotal?.n) || 0, feed: '/api/admin/security/governance' },
    impersonations,
    sessions,
    mfa: { admins_total: Number(admins?.total) || 0, admins_with_mfa: Number(admins?.with_mfa) || 0 },
    kyc,
    dsr: { clock_days: DSR_CLOCK_DAYS, rows: dsr },
    security_events: absent(
      'No security_events ledger exists. Failed sign-ins, step-ups, permission grants and exports are not '
      + 'collected into one feed; the admin action audit below is the only trail, and it records admin actions only.',
    ),
    ai_safety: absent(NO_AI_SAFETY_STORE),
    sanctions: absent('No sanctions screening runs on the platform; KYC status is the only trust fact recorded.'),
    backup_dr: absent('No backup, restore-drill or failover record is kept where the platform can read it.'),
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
        });
      }
      sources.push({ table: 'licence_events', available: true, rows: took(got.length) });
    } catch {
      sources.push({ table: 'licence_events', available: false, reason: 'The licence event log could not be read.' });
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
      'Only a licence event can name a subsidiary, because it is about a licence. No account carries a '
      + 'licence_id (U1), so an export, a role change or an impersonation cannot be attributed to one — those '
      + 'rows leave the column unrecorded rather than filling it with a guess.',
    data_access: {
      expiry_minutes: IMPERSONATION_EXPIRY_MINUTES,
      impersonations: accessImpersonations,
      exports: accessExports,
    },
    // H7 draws a guardrail-hit panel. There is nothing behind it, and the
    // sentence is literally the one /overview uses — one constant, two zones.
    guardrails: absent(NO_AI_SAFETY_STORE),
    // H7's chrome: "Viewing as: Axal VC France · Return to HQ view".
    tenant_view_available: false,
    tenant_view_reason:
      'There is no tenant-scoped view to return from. The two "view as" modes that exist are a ROLE switch '
      + '(an admin browsing as a founder) and a support session against ONE account, each with its own exit. '
      + 'Seeing a whole subsidiary as its own admins see it needs every row to name its licence, which is U1.',
  });
});

r.post('/force-reauth', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const actor = await requireSuperAdmin(c);

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

  await c.env.DB.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
  ).bind(actor.id, 'security_force_reauth', JSON.stringify({ reason, affected, revoked_at: nowSec })).run();

  return c.json({
    ok: true,
    affected,
    revoked_at: nowSec,
    message: 'Every active account has been signed out everywhere, including yours. Sign in again with your authenticator.',
  });
});

export default r;
