/**
 * HQ · Home — the whole business on one screen (Admin · Super canvas, H1).
 *
 * SUPER ADMIN ONLY. This is the franchisor's overview: every licence's
 * status and territory side by side, platform-wide account and seat totals,
 * the licence event trail, and what is queued. A subsidiary admin has no
 * cross-tenant view by design; their own licence is `GET /licence/mine`.
 *
 *   GET /overview      one payload, one round trip, for the HQ Home page
 *
 * WHAT IS REAL HERE. Accounts (every active user, by role); seats licensed
 * (the ledger's own sum); licences with territories, status, renewal date
 * and seats; renewals due inside sixty days; suspended licences; the last
 * twenty licence events; the ticket queue by status when the table is
 * readable.
 *
 * WHAT IS NOT, AND WHY IT IS SAID RATHER THAN ESTIMATED. The canvas's
 * headline numbers per subsidiary — accounts, month-to-date revenue, queue
 * backlog, seat utilisation, the token P&L — all need every account to name
 * the licence it belongs to. No account does (UNRESOLVED_ITEMS U1: the
 * ledger shipped, the tenancy scope did not). The payload carries the same
 * `derived_metrics_available: false` block `GET /licence/mine` sends, so the
 * page renders "Not recorded" with the reason instead of a plausible zero.
 * "0 of 325 seats used" is a false statement about a real business.
 *
 * The tenant switcher on the page narrows CLIENT-SIDE over this payload. It
 * sends nothing back: the read-only overlay that would scope the rest of
 * the product to one tenant is a separate feature (tenancyScope.ts), and a
 * switcher that changed this page but nothing else while looking global
 * would be the half-applied scope U1 warns about.
 *
 * Mounted at /api/admin/hq BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { hydrate, type LicenceRow } from './admin_licences';
import { DERIVED_UNAVAILABLE } from './licence';
import { fanOut, coverage, withRegistry } from '../services/branches';
import { openEscalations } from '../rpc/hqOps';
import type { BranchOverview } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

const RENEWAL_WINDOW_DAYS = 60;
const EVENT_LIMIT = 20;
// H1 lists escalations oldest-first and links to the full board; a page that
// tried to show every open item would become the board rather than the digest.
const ESCALATION_LIMIT = 25;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  const roles = await env.DB.prepare(
    'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role ORDER BY n DESC',
  ).all<{ role: string; n: number }>();
  const byRole: Record<string, number> = {};
  let accountsTotal = 0;
  for (const row of roles.results || []) {
    byRole[String(row.role)] = Number(row.n) || 0;
    accountsTotal += Number(row.n) || 0;
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM territory_licences ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
                   WHEN 'pending_activation' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
       licence_ref`,
  ).all<LicenceRow>();
  const licences = await hydrate(env, rows.results || []);

  // A terminated licence holds no territory and licenses no seat. Everything
  // else — draft, pending, active, suspended — still counts: suspension does
  // not release territory (admin_licences.ts), and a draft's seats are on the
  // contract being prepared.
  const holding = licences.filter((l) => l.status !== 'terminated');
  const seatsLicensed = holding.reduce((a, l) => a + (Number(l.seats_licensed) || 0), 0);
  const countries = new Set<string>();
  for (const l of holding) for (const code of l.territories) countries.add(code);

  const today = new Date();
  const horizon = new Date(today.getTime() + RENEWAL_WINDOW_DAYS * 86400000);
  const [from, to] = [isoDate(today), isoDate(horizon)];
  const renewalsSoon = licences
    .filter((l) => (l.status === 'active' || l.status === 'suspended') && l.renews_on && l.renews_on >= from && l.renews_on <= to)
    .map((l) => ({ uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, renews_on: l.renews_on, status: l.status }));
  const suspended = licences.filter((l) => l.status === 'suspended')
    .map((l) => ({ uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, suspended_at: l.suspended_at, status_note: l.status_note }));

  const events = await env.DB.prepare(
    `SELECT e.id, e.licence_id, e.event, e.note, e.detail_json, e.actor_user_id, e.created_at,
            l.uid AS licence_uid, l.licence_ref, l.brand_name
       FROM licence_events e
       JOIN territory_licences l ON l.id = e.licence_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?`,
  ).bind(EVENT_LIMIT).all<{
    id: number; licence_id: number; event: string; note: string | null; detail_json: string | null;
    actor_user_id: number | null; created_at: string; licence_uid: string; licence_ref: string; brand_name: string;
  }>();

  // The ticket queue is platform-wide, not per tenant (U1 again). An
  // unreadable table is reported as unreadable, not as an empty queue.
  let queue: { available: true; by_status: Record<string, number>; open: number }
    | { available: false; reason: string };
  try {
    const t = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM tickets GROUP BY status',
    ).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    for (const row of t.results || []) byStatus[String(row.status)] = Number(row.n) || 0;
    queue = {
      available: true,
      by_status: byStatus,
      open: (byStatus.open || 0) + (byStatus.in_progress || 0),
    };
  } catch {
    queue = { available: false, reason: 'The tickets table could not be read on this database.' };
  }

  // D108 — every branch, in parallel, under one deadline, with a per-branch
  // state so one unreachable territory does not empty the page. Merged with
  // the deployment registry so a licence HQ has provisioned but has no binding
  // to yet reads `not_deployed` rather than vanishing.
  let registry: Array<{ code: string; hostname: string; status: string }> = [];
  try {
    const dep = await env.DB.prepare(
      'SELECT code, hostname, status FROM licence_deployments ORDER BY code',
    ).all<{ code: string; hostname: string; status: string }>();
    registry = dep.results || [];
  } catch {
    // Migration 258 not applied on this database. The bindings still answer,
    // so the fan-out below is unaffected; only the `not_deployed` rows are
    // missing, and an empty registry produces none.
    registry = [];
  }
  const branches = withRegistry(await fanOut<BranchOverview>(env, 'overview'), registry);
  const branchCoverage = coverage(branches);

  // The H1 zone that had no store until now. An unreadable table is reported
  // as unreadable rather than as an empty queue — the rule the ticket queue
  // above already follows.
  let escalations: { available: true; rows: unknown[] } | { available: false; reason: string };
  try {
    escalations = { available: true, rows: await openEscalations(env, ESCALATION_LIMIT) };
  } catch {
    escalations = {
      available: false,
      reason: 'The hq_escalations table could not be read on this database (migration 259).',
    };
  }

  return c.json({
    accounts: { total: accountsTotal, by_role: byRole, active_only: true },
    seats_licensed: seatsLicensed,
    countries_held: [...countries].sort(),
    licences,
    renewals_within_days: RENEWAL_WINDOW_DAYS,
    renewals_soon: renewalsSoon,
    suspended,
    events: events.results || [],
    queue,
    // D108 — escalations exist now (migration 259). The reason string above
    // was true and is deleted rather than reworded, the way a retired refusal
    // is handled everywhere else in this repo: a stale reason that still reads
    // plausibly is what gets cited by the next surface.
    escalations_available: escalations.available,
    ...(escalations.available ? { escalations: escalations.rows } : { escalations_reason: escalations.reason }),
    // The per-branch fan-out. `branches` is [] on an HQ with none deployed,
    // which is correct and different from "could not read them".
    branches,
    branches_coverage: branchCoverage,
    ...DERIVED_UNAVAILABLE,
  });
});

export default r;
