/**
 * D4708 (#4708) — `/api/admin/security/governance`'s ledger: canvas H7's privileged-action feed and H23's
 * sign-in ledger, unioned across the five stores that record one, merged newest first, cut on a whole second,
 * with the Data access zone and the guardrail pointer beside it. Moved from `routes/admin_security.ts`
 * unchanged; the route keeps the gate and the query parse.
 */
import type { Env } from '../../types';
import { IMPERSONATION_EXPIRY_MINUTES } from '../../auth';
import { securityEventIdentity, supportIdentity, userIdentity, type Identity } from '../securityIdentity';
import { freshnessFor, type SecuritySource } from '../securitySourceFreshness';
import {
  FEED_OUTCOMES, FEED_SOURCES, FEED_SKIP_MAX, storesFor, timeBinds, actorBinds, likeBinds, trimToSecond, type FeedQuery,
} from './feedQuery';
import {
  IMPERSONATION_UNREADABLE, parseSqlTs, who, actorOf, reasonFrom, clip, impersonationOutcome, type ImpersonationRow,
} from './feedFormat';
import { loadDataAccess } from './dataAccess';
import { GUARDRAILS_POINTER } from './aiSafety';

/** D5247 — a freshness row's fields beside a ledger source, whose own key stays `table`. */
const withoutSource = ({ source: _s, ...rest }: { source: string } & Record<string, unknown>) => rest;

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
export const FEED_LIMIT = 60;

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
export const ACTOR_SIDE_ACTIONS = [
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
export const SUSPENSION_LICENCE_EVENTS = ['suspended', 'terminated'];
export const SUSPENSION_ACTIVITY_ACTIONS = ['user_toggled'];

/** The five the artboard draws, in its order, each naming what it reads. */
export const FEED_FILTERS = [
  { key: 'all', label: 'All actions', reads: 'every store below' },
  { key: 'impersonations', label: 'Impersonations', reads: 'impersonation_sessions' },
  { key: 'licence_changes', label: 'Licence changes', reads: 'licence_events' },
  { key: 'suspensions', label: 'Suspensions', reads: 'licence_events · activity_logs' },
  { key: 'exports', label: 'Exports', reads: 'admin_audit_log' },
  // D200 — the sixth, which H23 (completing H7) added: the ledger of refusals
  // and step-ups at the auth boundary.
  { key: 'auth', label: 'Sign-ins and step-ups', reads: 'security_events' },
];

export type FeedRow = {
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
      AND (? IS NULL OR a.action LIKE ? ESCAPE '\\' OR a.report_type LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR t.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR a.action LIKE ? ESCAPE '\\' OR a.report_type LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR t.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR l.action LIKE ? ESCAPE '\\' OR l.details LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR l.action LIKE ? ESCAPE '\\' OR l.details LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR e.event LIKE ? ESCAPE '\\' OR e.note LIKE ? ESCAPE '\\' OR l.licence_ref LIKE ? ESCAPE '\\' OR l.brand_name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR e.event LIKE ? ESCAPE '\\' OR e.note LIKE ? ESCAPE '\\' OR l.licence_ref LIKE ? ESCAPE '\\' OR l.brand_name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR s.kind LIKE ? ESCAPE '\\' OR s.factor LIKE ? ESCAPE '\\' OR s.detail LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR sp.name LIKE ? ESCAPE '\\' OR sp.email LIKE ? ESCAPE '\\')
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
      AND (? IS NULL OR i.context LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a.email LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR t.email LIKE ? ESCAPE '\\')
    ORDER BY datetime(i.started_at) DESC, i.id DESC LIMIT ?`;

/** A row's whole second (epoch ms), or NaN for a row without a time. */
const secondOf = (ts: number) => (Number.isNaN(ts) ? NaN : Math.floor(ts / 1000) * 1000);
/** A key's numeric id, the store's own `id` (every key is `<store>:<id>`). */
const idOf = (key: string) => Number(key.slice(key.indexOf(':') + 1));

/**
 * The merged order: newest second first; inside one second, by store (the key's prefix, highest first, as
 * D4699 set) and then by `id`, highest first. That is each store's own `ORDER BY datetime(...) DESC, id DESC`,
 * so the merge of the stores' pages is a prefix of the whole ledger in one order, and a page cut inside a
 * second can be continued by counting the rows shown (D4708 part 2). A row whose time will not parse sorts last.
 */
export function feedOrder(a: { ts: number; key: string }, b: { ts: number; key: string }): number {
  const as = secondOf(a.ts);
  const bs = secondOf(b.ts);
  const av = Number.isNaN(as) ? -Infinity : as;
  const bv = Number.isNaN(bs) ? -Infinity : bs;
  if (av !== bv) return bv - av;
  const ap = a.key.slice(0, a.key.indexOf(':'));
  const bp = b.key.slice(0, b.key.indexOf(':'));
  if (ap !== bp) return ap < bp ? 1 : -1;
  return idOf(b.key) - idOf(a.key) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
}

/** The filter asked for, or the whole feed. */
export function feedFilterOf(asked: string): string {
  // An unknown filter falls back to the whole feed rather than to nothing: a
  // stale bookmark should show more than it asked for, never less.
  return FEED_FILTERS.some((f) => f.key === asked) ? asked : 'all';
}

/** The ledger's reply for one filter and one parsed query, read at `now`. */
export async function loadGovernance(env: Env, filter: string, fq: FeedQuery, now: number) {
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
  // D4708 part 2 — continuing inside one second, each store also returns the rows of that second the last
  // page showed (dropped after the merge), so the same argument holds for FEED_LIMIT + skip.
  const shown = fq.skip ? fq.skip.rows : 0;
  const storeLimit = FEED_LIMIT + shown;
  const took = (n: number) => { if (n >= storeLimit) more = true; return n; };

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

  // ── admin_audit_log ───────────────────────────────────────────────────
  if (readAudit) {
    try {
      const res = await env.DB
        .prepare(filter === 'exports' ? FEED_AUDIT_EXPORTS_SQL : FEED_AUDIT_ALL_SQL)
        .bind(...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), storeLimit).all<Record<string, unknown>>();
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
        .bind(...allow, ...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 4), storeLimit).all<Record<string, unknown>>();
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
          .bind(...timeBinds(fq), ...actorBinds(fq), ended, ended, ended, ...likeBinds(fq, 5), storeLimit)
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
          .bind(...SUSPENSION_LICENCE_EVENTS, ...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), storeLimit)
          .all<Record<string, unknown>>()
        : await env.DB.prepare(FEED_LICENCE_ALL_SQL)
          .bind(...timeBinds(fq), ...actorBinds(fq), ...likeBinds(fq, 6), storeLimit).all<Record<string, unknown>>();
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
        .bind(...timeBinds(fq), ...actorBinds(fq, 3), secOutcome, secOutcome, ...likeBinds(fq, 7), storeLimit)
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
  rows.sort(feedOrder);
  // D4708 part 2 — continuing inside the cursor's second: drop the rows of that second the last page showed.
  // The order above is each store's own SQL order merged, so they are the first rows here.
  let dropped = 0;
  while (fq.skip && dropped < fq.skip.rows && dropped < rows.length && secondOf(rows[dropped].ts) === fq.skip.second) dropped += 1;
  const rest = dropped ? rows.slice(dropped) : rows;
  // More is held when any store filled its own page, OR when the stores
  // together returned more than one page (two stores of forty each): the rows
  // past FEED_LIMIT are real and Load older has to reach them.
  if (rest.length > FEED_LIMIT) more = true;
  const { page: kept, split } = trimToSecond(rest.slice(0, FEED_LIMIT), more);
  const page = kept.map(({ ts, ...row }) => row);
  // D4803 — Load older: the next read is everything strictly older than the
  // last row kept. No cursor when nothing older is held, or when the last row
  // has no time to continue from.
  const lastAt = more && kept.length ? kept[kept.length - 1].at : null;
  let cursor: { before: string; skip?: number } | null = lastAt && !Number.isNaN(parseSqlTs(lastAt)) ? { before: lastAt } : null;
  // D4708 part 2 — a page wholly inside one second continues inside it: the cursor carries how many of that
  // second's rows have been shown, counting the earlier pages of the same second, up to FEED_SKIP_MAX.
  if (cursor && split) {
    const sameSecond = fq.skip && secondOf(kept[0].ts) === fq.skip.second ? dropped : 0;
    const total = sameSecond + kept.length;
    if (total <= FEED_SKIP_MAX) cursor = { ...cursor, skip: total };
  }

  // ── H7's "Data access" zone: who saw data they do not own ─────────────
  // Impersonations and exports side by side, because the question this zone
  // asks is not "what changed" but "who read someone else's rows". Kept as
  // two halves so one unreadable store cannot make the other look complete.
  const access = await loadDataAccess(env, impersonations, now);

  // D5247 — each store this read touched gains its last good read and its own age, so the Overview can mark it
  // Stale; a store this filter did not read is not in `sources` and is not recorded.
  const fresh = await freshnessFor(env, sources.map((s) => ({ source: s.table as SecuritySource, answered: s.available })));
  const withFreshness = sources.map((s, i) => ({ ...s, ...withoutSource(fresh[i]) }));

  return {
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
    sources: withFreshness,
    // What no store can say, said once rather than once per row.
    tenant_available: false,
    tenant_reason:
      'Two stores can fill this column: a licence event names its subsidiary, because it is about a licence, '
      + 'and a security event names the deployment that recorded it (HQ, or a branch code). No account carries a '
      + 'licence_id (U1), so an export, a role change or an impersonation cannot be attributed to one — those '
      + 'rows leave the column unrecorded rather than filling it with a guess.',
    data_access: {
      expiry_minutes: IMPERSONATION_EXPIRY_MINUTES,
      impersonations: access.impersonations,
      exports: access.exports,
    },
    // H7's guardrail panel: a pointer to /overview's `ai_safety`, never a second copy (aiSafety.ts says why).
    guardrails: GUARDRAILS_POINTER,
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
  };
}
