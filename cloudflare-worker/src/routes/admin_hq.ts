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
import { fanOut, branchRead, coverage, withRegistry, type BranchResult } from '../services/branches';
import { openEscalations } from '../rpc/hqOps';
import type { BranchOverview, BranchAccountHit } from '../rpc/branchOps';
import { FREEZING_STATUSES } from '../util/authErrors';
import { ensureLastActiveColumn } from '../middleware/lastActive';
import { ticketBacklog } from '../services/supportQueues';
import {
  ACTIVE_ACCOUNT_BASIS, ANALYTICS_RANGES, GAP_SENTENCES, gapNotes, parseAnalyticsRange, seriesValues,
  weekAxis, weeklyKpi,
} from '../services/activeAccounts';
import { loadActiveAccountsByBranchWeek } from '../services/analyticsReports';

const r = new Hono<{ Bindings: Env }>();

const RENEWAL_WINDOW_DAYS = 60;
const EVENT_LIMIT = 20;
// H1 lists escalations oldest-first and links to the full board; a page that
// tried to show every open item would become the board rather than the digest.
const ESCALATION_LIMIT = 25;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** What one branch answers a search with. */
type BranchAccountSearch = { results: BranchAccountHit[]; truncated: boolean };

/** How many hits HQ asks one branch for. The RPC clamps to 50; this is its own default. */
const BRANCH_SEARCH_LIMIT = 20;

/**
 * The deployment rows `withRegistry` merges the fan-out against, so a licence
 * HQ has provisioned but holds no binding to yet reads `not_deployed` rather
 * than vanishing.
 *
 * Migration 258 not applied on this database means an empty registry, not a
 * failure: the bindings still answer and the fan-out is unaffected; only the
 * `not_deployed` rows are missing, and an empty registry produces none. Two
 * callers since D138 (`/overview` and `/admins`), which is why it is a function.
 */
async function deployedBranches(env: Env): Promise<Array<{
  code: string; hostname: string; status: string; licence_uid: string | null;
}>> {
  try {
    // D150 — `licence_uid` is selected because it is the only key that joins a
    // branch's read to the licence it trades under. Without it H1's health
    // cards could render a fan-out figure and not say whose it was, which is
    // why they rendered none at all.
    const dep = await env.DB.prepare(
      'SELECT code, hostname, status, licence_uid FROM licence_deployments ORDER BY code',
    ).all<{ code: string; hostname: string; status: string; licence_uid: string | null }>();
    return dep.results || [];
  } catch {
    return [];
  }
}

/**
 * The `?branch=<code>` scope — H12's overlay, on the wire (D153).
 *
 * WHAT THE OVERLAY IS, IN THE CANVAS'S OWN WORDS: "The overlay is not a filter
 * on an HQ table — it is one private-link read, of one branch, rendered with
 * every action removed. Each figure carries the branch and the time it was
 * read, so nothing on the screen can be mistaken for a platform total."
 *
 * So a scoped response DELIBERATELY DROPS the platform-wide fields rather than
 * sending them alongside one branch's. `accounts`, `seats_licensed`,
 * `licences`, `queue` and `events` are HQ's own ledger; carrying them in a
 * payload the page is rendering under a "Viewing as <branch>" banner is
 * precisely how a total gets read as a territory's. A page that wants them
 * asks without the parameter.
 *
 * `read_at` is HQ's clock and `as_of` is the branch's own. Both are sent
 * because they answer different questions: when this screen was filled, and
 * how old the branch's own figure was when it left.
 */
function scopeOf(c: { req: { query: (k: string) => string | undefined } }): string {
  return String(c.req.query('branch') || '').trim();
}

async function stampLicence<T>(env: Env, one: BranchResult<T>): Promise<BranchResult<T>> {
  const reg = await deployedBranches(env);
  const row = reg.find((x) => String(x.code).toLowerCase() === one.code);
  if (row?.licence_uid) one.licence_uid = String(row.licence_uid);
  return one;
}

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // D153 — ONE BRANCH, READ ONCE, INSTEAD OF THE FAN-OUT. Not the fan-out
  // filtered afterwards: a filtered fan-out would still call every other
  // branch, and the read HQ performed is exactly what the overlay's banner
  // claims it performed.
  const scoped = scopeOf(c);
  if (scoped) {
    const one = await stampLicence(env, await branchRead<BranchOverview>(env, scoped, 'overview'));
    return c.json({
      scope: {
        branch: one.code,
        binding: one.binding,
        status: one.status,
        licence_uid: one.licence_uid ?? null,
        as_of: one.as_of ?? null,
        read_at: new Date().toISOString(),
        ...(one.reason ? { reason: one.reason } : {}),
      },
      branches: [one],
      branches_coverage: coverage([one]),
    });
  }

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
  //
  // D204 — THE READ LIVES IN `services/supportQueues.ts` NOW, beside the one
  // definition of an open ticket that HQ Support also counts by. Two statements
  // each deciding what "open" means is how this tile and the Support desk would
  // come to disagree; there is one, and both pages call it.
  let queue: { available: true; by_status: Record<string, number>; open: number }
    | { available: false; reason: string };
  try {
    const b = await ticketBacklog(env);
    queue = { available: true, by_status: b.by_status, open: b.open };
  } catch {
    queue = { available: false, reason: 'The tickets table could not be read on this database.' };
  }

  // D108 — every branch, in parallel, under one deadline, with a per-branch
  // state so one unreachable territory does not empty the page. Merged with
  // the deployment registry so a licence HQ has provisioned but has no binding
  // to yet reads `not_deployed` rather than vanishing.
  const registry = await deployedBranches(env);
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

/**
 * GET /admins — H9 · Team, the first screen whose SUBJECT is the admin accounts.
 *
 * WHY IT EXISTS (D138). The owner's sentence is "HQ needs to be able to
 * supervise all admins." Five merged PRs built every power that implies — open
 * (D134), freeze (D135), the two screens that work a notice (D136), the push
 * that reaches a branch (D137) — and there was no screen anywhere whose subject
 * was the administrators. Supervising meant opening one licence at a time:
 * /admin/licences → a licence → Administrators → Notices. "Who is frozen right
 * now" could not be asked, only assembled.
 *
 * THE ROLE FILTER IS SERVER-SIDE, AND THAT IS THE DEFECT THIS CLOSES.
 * `SuperAdminHolders.jsx` fed its grant picker from `GET /admin/users` with no
 * arguments — `ORDER BY created_at DESC LIMIT 100` — and filtered that PAGE to
 * `role === 'admin'` in the browser. Admins are among the OLDEST accounts, so
 * past a hundred rows an admin is simply absent from the list, and the picker
 * reads "No other admin to hand it to" about a database that has several. In a
 * picker, absence is not a display problem: the elevation cannot be granted at
 * all. The query below has no LIMIT because it has a predicate — admins are one
 * per licence plus HQ, not a directory — which is the same shape
 * `routes/users.ts` already runs for `?role=`.
 *
 * WHY IT IS SUPER-ADMIN-ONLY. D132's header states the rule and D133 applied it
 * to four more routes: a route that reads another admin's licence, ladder state
 * and last-active is a cross-admin read whatever it renders, and gating some of
 * them is gating none of them.
 *
 * THE LADDER IS READ AS A CLAIM SOMEBODY MADE, NEVER INFERRED FROM SILENCE.
 * `admin_notices` is migration 264 and a database that has not applied it must
 * render `ladder_readable: false` with its reason — NOT four rungs of "clear".
 * `auth.ts`'s own freeze gate says why in the same words: being frozen is a
 * claim somebody made, and inferring its absence from an unreadable table is
 * how a screen comes to report the opposite of the truth. It is also the D133
 * lesson twice over — two fixtures narrower than the schema once had seven
 * tests reporting "HQ has not pushed this branch its licence" about a row
 * sitting in front of them.
 *
 * THE GROUPS ARE H9'S OWN MODEL. The canvas: "There is no global accounts
 * table. HQ asks each branch over its private link and groups what comes back,
 * so a search result is really four answers and a fifth for HQ-held accounts —
 * and when one branch does not answer, its group says so instead of showing
 * zero." So the HQ roster is complete and always returned, and `q` is what HQ
 * ASKS THE BRANCHES; the fan-out's three states (`ok` / `unreadable` /
 * `not_deployed`) come through untouched. With no branch provisioned `branches`
 * is [], every admin is HQ-held, and that is true rather than empty.
 */
type TeamAdminRow = {
  id: number; uid: string | null; email: string; name: string | null;
  is_active: number; last_active_at: string | null; created_at: string;
};

type TeamLicenceRow = {
  user_id: number; admin_role: string; uid: string;
  licence_ref: string | null; brand_name: string | null; status: string | null;
};

type TeamNoticeRow = {
  user_id: number; status: string; n: number;
  oldest_respond_by: string | null; oldest_froze_at: string | null;
};

/**
 * The statuses a notice is still OPEN in — the four rungs the ladder can be on.
 *
 * TYPED AS A FOUR-TUPLE, and the SQL below writes its four `?` as literal text
 * rather than joining them from this array. `check-sql-prepare` refuses a `${}`
 * inside `DB.prepare(\`…\`)` even when it could only ever emit placeholders —
 * the same refusal D128's search hit — and it is right to: a guard that made an
 * exception for "provably safe" interpolation would have to judge that at every
 * site. `util/authErrors.ts` states the compensating rule for its own tuple:
 * typing the length means adding a fifth status is a COMPILE error at the bind
 * site rather than a silent under-bind, and a test counts the placeholders
 * against it so the two cannot drift.
 */
const OPEN_NOTICE_STATUSES: readonly ['overdue', 'rejected', 'responded', 'issued'] =
  [...FREEZING_STATUSES, 'responded', 'issued'];

/**
 * Worst first, and the same ordering the SPA sorts by (`lib/notices.js`).
 * Frozen outranks waiting-on-HQ outranks waiting-on-them, because that is the
 * order in which somebody has to do something.
 */
function rungOf(statuses: Set<string>): 'frozen' | 'awaiting_review' | 'notified' | 'clear' {
  for (const s of FREEZING_STATUSES) if (statuses.has(s)) return 'frozen';
  if (statuses.has('responded')) return 'awaiting_review';
  if (statuses.has('issued')) return 'notified';
  return 'clear';
}

r.get('/admins', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // D153 — THE SCOPED READ HAPPENS BEFORE HQ'S OWN ROSTER, not after it. Under
  // the overlay the subject is one branch's accounts, so HQ's complete
  // administrator list is not narrowed here, it is not read at all: sending it
  // beside one branch's rows is what would make the overlay a filter on an HQ
  // table, which is the one thing H12 says it is not.
  const scopedTeam = scopeOf(c);
  if (scopedTeam) {
    const asked = String(c.req.query('q') || '').trim();
    const one = await stampLicence(env, await branchRead<BranchAccountSearch>(
      env, scopedTeam, 'searchAccounts', [asked, BRANCH_SEARCH_LIMIT],
    ));
    return c.json({
      scope: {
        branch: one.code,
        binding: one.binding,
        status: one.status,
        licence_uid: one.licence_uid ?? null,
        as_of: one.as_of ?? null,
        read_at: new Date().toISOString(),
        asked,
        ...(one.reason ? { reason: one.reason } : {}),
      },
      branches: [one],
      branches_coverage: coverage([one]),
    });
  }
  // `last_active_at` is a runtime-added column on databases older than
  // migration 049's helper (see its header). Selecting it without this is the
  // "no such column" 500 that #203 was written about.
  await ensureLastActiveColumn(env);

  const admins = await env.DB.prepare(
    `SELECT id, uid, email, name, is_active, last_active_at, created_at
       FROM users
      WHERE role = 'admin'
      ORDER BY created_at ASC`,
  ).all<TeamAdminRow>();
  const rows = admins.results || [];

  // One licence per admin — `licence_admins` is UNIQUE(user_id) by migration
  // 190's own decision, so this Map cannot lose a row to a collision. Read
  // user→licence, which is the direction no route read before: D134's
  // `GET /:uid/admins` reads licence→users, one licence at a time, which is
  // exactly the per-licence walk this screen exists to replace.
  const byUser = new Map<number, TeamLicenceRow>();
  let licencesReadable = true;
  let licencesReason: string | null = null;
  try {
    const held = await env.DB.prepare(
      `SELECT la.user_id, la.admin_role, tl.uid, tl.licence_ref, tl.brand_name, tl.status
         FROM licence_admins la JOIN territory_licences tl ON tl.id = la.licence_id`,
    ).all<TeamLicenceRow>();
    for (const row of held.results || []) byUser.set(Number(row.user_id), row);
  } catch (e) {
    licencesReadable = false;
    licencesReason = 'The licence ledger could not be read, so which licence each administrator '
      + `holds is unknown rather than none: ${(e as Error).message}`;
  }

  // The ladder, per admin. `GROUP BY user_id, status` rides
  // `idx_admin_notices_user(user_id, status)`, which migration 264 created for
  // the addressee's own list and the freeze gate — this is the first read of it
  // for a THIRD party, and it needs no new index.
  const noticesByUser = new Map<number, { statuses: Set<string>; open: number; respond_by: string | null; froze_at: string | null }>();
  let ladderReadable = true;
  let ladderReason: string | null = null;
  try {
    const notices = await env.DB.prepare(
      `SELECT user_id, status, COUNT(*) AS n,
              MIN(respond_by) AS oldest_respond_by,
              MIN(froze_at) AS oldest_froze_at
         FROM admin_notices
        WHERE status IN (?, ?, ?, ?)
        GROUP BY user_id, status`,
    ).bind(...OPEN_NOTICE_STATUSES).all<TeamNoticeRow>();
    for (const row of notices.results || []) {
      const id = Number(row.user_id);
      const acc = noticesByUser.get(id) || { statuses: new Set<string>(), open: 0, respond_by: null, froze_at: null };
      acc.statuses.add(String(row.status));
      acc.open += Number(row.n) || 0;
      // The EARLIEST deadline and the EARLIEST freeze, because what a
      // supervisor needs is the oldest unanswered thing, not the newest.
      if (row.oldest_respond_by && (!acc.respond_by || row.oldest_respond_by < acc.respond_by)) acc.respond_by = row.oldest_respond_by;
      if (row.oldest_froze_at && (!acc.froze_at || row.oldest_froze_at < acc.froze_at)) acc.froze_at = row.oldest_froze_at;
      noticesByUser.set(id, acc);
    }
  } catch (e) {
    ladderReadable = false;
    ladderReason = 'The compliance ladder could not be read on this database, so no rung is shown. '
      + 'An unreadable notices table is not a clear ladder: being under notice is a claim somebody '
      + `made, and a screen that inferred "clear" from silence would say the opposite of the truth (${(e as Error).message}).`;
  }

  // The elevation. One row per holder; `super_admins` is the side table
  // migration 199 moved it to because `users` sits at D1's 100-column cap.
  const holders = new Set<number>();
  let holdersReadable = true;
  try {
    const held = await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    for (const row of held.results || []) holders.add(Number(row.user_id));
  } catch { holdersReadable = false; }

  const items = rows.map((u) => {
    const licence = byUser.get(Number(u.id)) || null;
    const ladder = noticesByUser.get(Number(u.id)) || null;
    return {
      user_id: u.id,
      uid: u.uid,
      email: u.email,
      name: u.name,
      is_active: Number(u.is_active) === 1 ? 1 : 0,
      last_active_at: u.last_active_at,
      created_at: u.created_at,
      super_admin: holders.has(Number(u.id)) ? 1 : 0,
      // Every account on HQ's own database is HQ-held. It is a fact about where
      // the row lives, not a placeholder: a branch's accounts live on the
      // branch's database and reach this screen through the fan-out below.
      branch: null as string | null,
      licence: licence
        ? {
          uid: licence.uid,
          licence_ref: licence.licence_ref,
          brand_name: licence.brand_name,
          status: licence.status,
          admin_role: licence.admin_role,
        }
        : null,
      ...(ladderReadable
        ? {
          rung: rungOf(ladder?.statuses || new Set<string>()),
          open_notices: ladder?.open || 0,
          respond_by: ladder?.respond_by || null,
          froze_at: ladder?.froze_at || null,
        }
        : {}),
    };
  });

  // H9's branch groups. `q` is what HQ ASKS each branch: a branch cannot be
  // listed exhaustively from here (D.2 — its accounts are on its own database),
  // so an unasked branch answers nothing and says so rather than rendering as
  // an empty territory.
  const q = String(c.req.query('q') || '').trim();
  const registry = await deployedBranches(env);
  const branches = q
    ? withRegistry(await fanOut<BranchAccountSearch>(env, 'searchAccounts', [q, BRANCH_SEARCH_LIMIT]), registry)
    : withRegistry([], registry);

  return c.json({
    // The HQ-held group: every administrator on this database, complete. The
    // page filters it in the browser, which is honest HERE and was the defect
    // THERE: filtering a complete list narrows it, filtering a page hides rows.
    items,
    total: items.length,
    active: items.filter((x) => x.is_active === 1).length,
    holders_available: holdersReadable,
    licences_available: licencesReadable,
    ...(licencesReadable ? {} : { licences_reason: licencesReason }),
    ladder_readable: ladderReadable,
    ...(ladderReadable ? {} : { ladder_reason: ladderReason }),
    searched: q.length > 0,
    branches,
    branches_coverage: coverage(branches),
  });
});

/**
 * H15's four tiles that no store can fill, each with the measurement that
 * says so. Sent on the payload, not written into the page (D131).
 */
const HQ_ANALYTICS_NOT_RECORDED = [
  {
    key: 'activation',
    label: 'Activation',
    reason:
      'H15 draws a funnel — invited, signed in, agreement signed, active in week two. No step of it is '
      + 'recorded as an event HQ can count across branches, and each branch keeps its own accounts in '
      + 'its own database.',
  },
  {
    key: 'approval_age',
    label: 'Median approval age',
    reason:
      'A branch\'s approval queues live in that branch\'s database, and no branch pushes a decision '
      + 'time to HQ. Each branch\'s Analytics page times the queues it can.',
  },
  {
    key: 'token_spend',
    label: 'Token spend against limit',
    reason:
      'Only Eadwyn\'s two gatewayed task classes carry branch metadata to the AI Gateway (D261); '
      + 'every other model call carries none, and nothing reads the gateway\'s logs back into HQ. '
      + 'So spend cannot be split by branch here, and no licence carries a token limit to set it against.',
  },
  {
    key: 'revenue_by_stream',
    label: 'Revenue by stream',
    reason:
      'No branch reports usage to HQ yet — reportUsage has no caller (#354). The canvas also draws '
      + 'programme fees and perks as streams; neither is income this platform records.',
  },
] as const;

/**
 * Every deployment HQ provisioned, with the licence it trades under.
 *
 * ITS OWN READ, NOT `deployedBranches()`, because that one answers `[]` when
 * the registry cannot be read — which is right for a fan-out that has nothing
 * to call and wrong here, where "no branch" and "the list could not be read"
 * put different lines on a chart.
 */
async function registryForAnalytics(env: Env): Promise<
  | { readable: true; rows: Array<{ code: string; deploy_status: string; brand_name: string | null; licence_status: string | null; suspended_at: string | null }> }
  | { readable: false; reason: string }
> {
  try {
    const q = await env.DB.prepare(
      `SELECT d.code, d.status AS deploy_status, l.brand_name, l.status AS licence_status, l.suspended_at
         FROM licence_deployments d
         LEFT JOIN territory_licences l ON l.uid = d.licence_uid
        ORDER BY d.code`,
    ).all<{ code: string; deploy_status: string; brand_name: string | null; licence_status: string | null; suspended_at: string | null }>();
    return { readable: true, rows: q.results || [] };
  } catch (e) {
    return {
      readable: false,
      reason:
        'The deployment registry could not be read (migration 258), so branches with no traffic cannot '
        + `be listed and only codes the metrics store recorded are drawn: ${(e as Error)?.message || 'unknown'}.`,
    };
  }
}

// GET /api/admin/hq/analytics?range=8w|quarter|year
//
// H15. One line per branch, and one for HQ's own deployment, of distinct
// signed-in accounts per week — read from Analytics Engine, the one store
// every Worker writes to. Aggregates, never records: no account id leaves
// this handler. Not scoped by H12's overlay: a per-branch chart already
// separates every branch, and narrowing it to one would hide the comparison
// the page is for.
r.get('/analytics', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const range = parseAnalyticsRange(c.req.query('range'));
  if (!range) {
    return c.json({
      error: 'bad_range',
      message: `range must be one of ${Object.keys(ANALYTICS_RANGES).join(', ')}.`,
    }, 400);
  }
  const axis = weekAxis(new Date().toISOString(), ANALYTICS_RANGES[range]);
  const [registry, read] = await Promise.all([
    registryForAnalytics(env),
    loadActiveAccountsByBranchWeek(env, axis),
  ]);

  let active_accounts: Record<string, unknown>;
  if (!read.available) {
    active_accounts = {
      available: false, reason: read.reason, as_of: read.as_of,
      ...(read.unreadable ? { unreadable: true } : {}),
    };
  } else {
    // HQ's own deployment first, then every registered branch — including one
    // with no traffic, whose line is blank with its reason — then any code the
    // store recorded that the registry does not know, flagged as such.
    const known = registry.readable ? registry.rows : [];
    type Drawn = {
      code: string; label: string; kind: 'hq' | 'branch' | 'unregistered';
      status: string | null; suspended_at: string | null;
    };
    const drawn: Drawn[] = [
      { code: 'hq', label: 'HQ-held', kind: 'hq', status: null, suspended_at: null },
      ...known.map((row): Drawn => ({
        code: row.code,
        label: row.brand_name || row.code,
        kind: 'branch',
        status: row.licence_status || row.deploy_status,
        suspended_at: row.suspended_at,
      })),
    ];
    // A code the store recorded that the registry lacks is only "unregistered"
    // when the registry was READ. Unreadable, nobody checked, so the line is
    // drawn as a branch and the registry's own reason says why the list is
    // the store's alone.
    const listed = new Set(drawn.map((d) => d.code));
    for (const code of [...read.fold.firstDay.keys()].sort()) {
      if (listed.has(code)) continue;
      drawn.push({
        code, label: code, kind: registry.readable ? 'unregistered' : 'branch', status: null, suspended_at: null,
      });
      listed.add(code);
    }
    // Each week carries its own gap reason (D211). The legend speaks for the
    // last complete week, so `gap_reason` is THAT week's sentence, or absent
    // when the week has a figure; the chart's foot lists every reason once.
    const last = axis.weeks.length - 2;
    const series = drawn.map((d) => {
      const v = seriesValues(read.fold, axis, d.code, read.cap_day);
      const lastGap = v.gaps[last];
      return {
        ...d,
        values: v.values,
        gaps: v.gaps,
        ...(lastGap ? { gap_reason: GAP_SENTENCES[lastGap] } : {}),
        first_day: v.first_day,
        first_week: v.first_week,
        ...(d.kind === 'unregistered'
          ? { note: 'The metrics store recorded this code and the deployment registry has no row for it.' }
          : {}),
      };
    });
    active_accounts = {
      available: true,
      as_of: read.as_of,
      series,
      gap_notes: gapNotes(series.map((x) => x.gaps)),
      kpi: weeklyKpi(axis, series),
      complete: read.cap_day === null,
      row_cap: read.row_cap,
      store_first_day: read.fold.floorDay,
      sampled: read.fold.sampled,
      ...(read.fold.sampled
        ? {
          sampled_note:
            'Analytics Engine sampled some of these rows, so each count is a floor: an account seen only '
            + 'in rows the store dropped is not counted.',
        }
        : {}),
    };
  }

  return c.json({
    range,
    weeks: axis.weeks,
    current_week: axis.current,
    last_complete_week: axis.last_complete,
    as_of: new Date().toISOString(),
    basis: ACTIVE_ACCOUNT_BASIS,
    source:
      'Analytics Engine: one row per metered request from every Worker, read here as counts. No '
      + 'account identifier leaves this read.',
    registry: registry.readable
      ? { readable: true, count: registry.rows.length }
      : { readable: false, reason: registry.reason },
    active_accounts,
    not_recorded: HQ_ANALYTICS_NOT_RECORDED,
    foot: 'Aggregates, never records.',
  });
});

export default r;
