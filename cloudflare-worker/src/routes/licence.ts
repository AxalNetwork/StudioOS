/**
 * The subsidiary administrator's read of their OWN territory licence.
 *
 * WHY THIS IS SEPARATE FROM admin_licences.ts. That file is HQ's ledger: every
 * licence, and every write. This is one licence, read-only, for the person who
 * administers it. A subsidiary admin is not a super admin — the design is
 * explicit that they have "their own profile and a different dashboard" — and
 * the cleanest expression of that is a different route with a different guard,
 * not a `role === 'admin'` branch inside HQ's endpoints.
 *
 * WHAT IT WILL NOT SHOW, and why the endpoint says so instead of leaving a
 * hole for the UI to fill. Migration 187 built the licence LEDGER and was
 * explicit that it is not the tenancy SCOPE: no account, project, deal or
 * document carries a licence_id. So accounts in territory, revenue per
 * subsidiary and the whole approval queue in the canvas cannot be computed —
 * not "are zero", cannot be computed. Every one of them would need
 * account→licence attribution.
 *
 * SEATS USED IS THE ONE THAT CAME OFF THAT LIST (D127), and only on a branch.
 * A branch does not need account→licence attribution to count its own
 * accounts: every user in its database *is* its own. So on a branch this
 * returns a number, counted from active accounts whose role is one a licence
 * sells a seat for — a definition rather than a seat ledger, which
 * `seats_used_basis` states in the payload. On HQ it stays null, because there
 * the attribution really is what is missing.
 *
 * The response therefore carries `derived_metrics_available: false` and a
 * reason — a DIFFERENT reason per tier, since the same sentence cannot be true
 * on both — in the same spirit as the fund-analytics rule: an unmeasured number
 * is unknown, and a surface that says so is worth more than one that shows a
 * plausible zero. Seats LICENSED is in the ledger and IS shown.
 *
 * Migration 190 supplies the one thing that was missing to make any of this
 * addressable: `licence_admins`, which says who administers what. Before it,
 * "which licence is this admin's?" had no answer at all.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { hydrate, type LicenceRow } from './admin_licences';
// The roles a licence sells a seat for. Imported rather than re-listed, so the
// branch overview and this page cannot disagree about what a seat is (D127).
import { SEAT_ROLES } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

/** The `branch_licence` singleton (migration 256), or null. */
type BranchLicenceRow = {
  licence_uid: string;
  licence_ref: string | null;
  legal_entity: string | null;
  brand_name: string | null;
  territory: string;
  status: string;
  seats_json: string | null;
  revenue_share_bps: number | null;
  token_split_bps: number | null;
  annual_fee_cents: number | null;
  currency: string | null;
  term_start: string | null;
  term_end: string | null;
  renewal_at: string | null;
  template_version: string | null;
  suspended_at: string | null;
  suspended_note: string | null;
  pushed_at: string;
};

/**
 * The same payload, read from the copy HQ pushed (D106, migration 256).
 *
 * WHY A BRANCH CANNOT USE THE QUERY BELOW. `licence_admins` and
 * `territory_licences` exist in a branch database — it is bootstrapped from
 * the same baseline — and they are EMPTY, because the ledger is HQ's. So the
 * normal path would answer 404 "You do not administer a territory licence" to
 * the one person on the deployment who does. That is not a missing row, it is
 * a row in another database, and the two must not read alike.
 *
 * `source` and `as_of` ride the response because everything a branch shows
 * from HQ shows its age (S6, D.10). A screen that renders this without the
 * stamp is showing a copy as though it were live.
 */
async function branchLicencePayload(env: Env, code: string) {
  let row: BranchLicenceRow | null = null;
  try {
    row = await env.DB.prepare(
      `SELECT licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json,
              revenue_share_bps, token_split_bps, annual_fee_cents, currency, term_start, term_end,
              renewal_at, template_version, suspended_at, suspended_note, pushed_at
         FROM branch_licence WHERE id = 1`,
    ).first<BranchLicenceRow>();
  } catch (e) {
    // A branch whose migration 256 has not been applied. Say so rather than
    // reading as "no licence": provisioning has not finished, and the two
    // states need different answers from support.
    console.warn('[licence] branch_licence unreadable', (e as Error).message);
    return {
      error: 'licence_not_pushed',
      message: 'HQ has not pushed this branch its licence yet.',
      branch: code,
    } as const;
  }
  if (!row) {
    return {
      error: 'licence_not_pushed',
      message: 'HQ has not pushed this branch its licence yet.',
      branch: code,
    } as const;
  }

  const territories = row.territory.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  let seats: Record<string, number> = {};
  try {
    const parsed = row.seats_json ? JSON.parse(row.seats_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) seats[k] = n;
      }
    }
  } catch { seats = {}; }

  // SEATS USED, COUNTED THE ONE WAY THIS TIER CAN (D127). Its own try/catch,
  // because a failed count must not blank the licence summary beside it — the
  // whole page exists to show terms, and an unreadable `users` table is a
  // different and smaller problem. `null` on failure keeps the distinction the
  // canvas draws between "unknown" and "zero".
  //
  // NO `IN (…)` AND NO INTERPOLATION. A first draft built the placeholder list
  // with `${SEAT_ROLES.map(() => '?').join(', ')}`, which `check-sql-prepare`
  // refused — correctly, even though that particular expression can only emit
  // `?, ?, ?, ?`: the rule is that nothing reaches the query TEXT, and a rule
  // with a "provably safe" exemption is one somebody widens later. Counting by
  // role and summing in JS removes the question, and it has a better property
  // besides — this is byte-for-byte the query `branchOverview` runs, so the
  // two readers of this figure cannot drift into asking different things.
  //
  // THE BREAKDOWN IS THE SAME ROWS UN-SUMMED (D129). S2 draws one tile per
  // licence type, so the page needs used-per-type beside licensed-per-type;
  // deriving that from a total would mean a second query asking a subtly
  // different question, which is the drift the paragraph above exists to
  // prevent. `seats_used` stays the sum of exactly these entries, so the tiles
  // and the total cannot disagree — asserted rather than assumed.
  let seatsUsedHere: number | null = null;
  let seatsUsedByType: Record<string, number> | null = null;
  try {
    const seated = await env.DB.prepare(
      'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
    ).all<{ role: string; n: number }>();
    // EVERY SEAT ROLE GETS A KEY, INCLUDING THE ZEROES. A role with no active
    // account returns no row at all, and a map missing that key would make the
    // page choose between rendering nothing and inventing a zero. Here the zero
    // is measured: the query ran, the role has none. That is a different claim
    // from `seats_used_by_type: null`, which is what an unreadable table gives.
    const byType: Record<string, number> = {};
    for (const role of SEAT_ROLES) byType[role] = 0;
    let sum = 0;
    for (const row of seated.results || []) {
      const role = String(row.role);
      if (!(SEAT_ROLES as readonly string[]).includes(role)) continue;
      const n = Number(row.n) || 0;
      byType[role] = n;
      sum += n;
    }
    seatsUsedHere = sum;
    seatsUsedByType = byType;
  } catch (e) {
    console.warn('[licence] seats used unreadable', (e as Error).message);
  }

  return {
    licence: {
      uid: row.licence_uid,
      // THE KEYS ARE HQ'S, NOT THE TABLE'S. `branch_licence` stores
      // `legal_entity`; the HQ payload this is a copy of calls the same fact
      // `legal_entity_name`, and `MyLicencePage` reads the HQ name. A copy
      // that renamed its own fields would render blank on exactly the tier it
      // was built for — which is what it did until this line, and is why the
      // page's fields are read off this object in its test rather than
      // assumed to line up.
      licence_ref: row.licence_ref,
      legal_entity_name: row.legal_entity,
      brand_name: row.brand_name,
      status: row.status,
      territories,
      seats,
      seats_licensed: Object.values(seats).reduce((a, b) => a + b, 0),
      // D127 — THIS IS NOW A NUMBER, and the comment it replaces was wrong on
      // its own terms: it said "PR 5 builds `seat_assignments`", PR 5 shipped,
      // and it built none. A branch can count its own seats because every user
      // in this database *is* this branch's; what it counts is roles, which is
      // a definition rather than a seat ledger — `seats_used_basis` below says
      // so on the screen rather than leaving the number to be read as more
      // than it is.
      seats_used: seatsUsedHere,
      // D129 — what S2's four tiles read. `null` only when the count failed;
      // a role with no account is a measured 0, not a missing key.
      seats_used_by_type: seatsUsedByType,
      seats_used_basis:
        'Active accounts whose role is one a licence sells a seat for. Role is not a licensed seat: '
        + 'no seat has an id, and none is assigned or released.',
      revenue_share_bps: row.revenue_share_bps,
      token_split_bps: row.token_split_bps,
      annual_fee_cents: row.annual_fee_cents,
      currency: row.currency,
      term_start: row.term_start,
      term_end: row.term_end,
      renewal_at: row.renewal_at,
      template_version: row.template_version,
      suspended_at: row.suspended_at,
      suspended_note: row.suspended_note,
      admin_role: 'principal',
    },
    // NOT an empty history. `licence_events` is HQ's append-only trail and is
    // not pushed, so an empty array here would say "nothing has happened to
    // your licence", which is a different and false claim.
    events: [],
    events_available: false,
    events_reason:
      'The licence event trail is held at HQ and is not copied to a branch. Ask HQ for the '
      + 'history of a licence change.',
    source: 'hq_copy' as const,
    as_of: row.pushed_at,
    branch: code,
  };
}

/**
 * Said once, in one place, so the callers cannot word it differently. Exported
 * for the HQ overview (routes/admin_hq.ts), which reports the same absence
 * platform-wide and must not develop a second phrasing of it.
 *
 * SEATS USED CAME OFF THIS LIST (D127) RATHER THAN THE LIST BEING DELETED.
 * A branch counts its own seats now, so a payload carrying both a number and a
 * sentence saying that number is "not shown" would contradict itself — which
 * is what it did for the length of one commit, caught by
 * `branch_licence_copy.test.ts`. What is still genuinely unavailable on BOTH
 * tiers is narrower, and saying the narrower true thing is the point: the
 * D111 pattern, where `budget_reason` survived in a smaller and still-true
 * form rather than being dropped.
 */
export const DERIVED_UNAVAILABLE = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Accounts in territory and revenue per subsidiary need every account to name the licence it '
    + 'belongs to. No account carries one yet — migration 187 built the licence ledger, not the '
    + 'tenancy scope — so these are not shown rather than shown as zero.',
} as const;

/**
 * The same absence on a BRANCH, where seats used is a figure and the rest is
 * not (D127).
 *
 * A branch does not need the tenancy scope to count its own accounts — every
 * user in its database is its own — so the sentence above is wrong there in
 * the one direction that matters: it would tell a branch admin their seat
 * figure is unavailable while the page beside it shows one.
 */
export const DERIVED_UNAVAILABLE_BRANCH = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Seats used is shown, counted from active accounts by role. Revenue per subsidiary is not: the '
    + 'reporting call that sends this branch\'s own billing figures to HQ is not built, so nothing '
    + 'is shown rather than a zero.',
} as const;

/**
 * The licence this user administers, or null.
 *
 * `licence_admins` has a UNIQUE index on user_id, so "the" licence is
 * well-defined by the schema rather than by this query picking one.
 */
async function licenceForUser(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT l.*, la.admin_role
       FROM licence_admins la
       JOIN territory_licences l ON l.id = la.licence_id
      WHERE la.user_id = ?`,
  ).bind(userId).first<LicenceRow & { admin_role: string }>();
}

// GET /api/licence/mine — the subsidiary dashboard's only source.
//
// 404 rather than 403 when the caller administers nothing: they are not
// forbidden from a licence, there is no licence of theirs to return, and the
// UI needs to tell those two apart.
r.get('/mine', async (c) => {
  const user = await requireAuth(c);

  // D106 — on a branch the ledger is in another database; read the copy.
  // Placed after requireAuth so an anonymous caller still gets 401 rather
  // than the branch's licence terms.
  const code = branchOf(c.env);
  if (code) {
    const payload = await branchLicencePayload(c.env, code);
    if ('error' in payload) return c.json(payload, 404);
    return c.json({ ...payload, ...DERIVED_UNAVAILABLE_BRANCH });
  }

  const row = await licenceForUser(c.env, user.id);
  if (!row) {
    return c.json({
      error: 'no_licence',
      message: 'You do not administer a territory licence.',
    }, 404);
  }
  const [licence] = await hydrate(c.env, [row]);

  // Append-only history. The whole point of licence_events is that a contract
  // dispute is exactly the case where an overwritten status is useless, so the
  // holder gets the same trail HQ does.
  const events = await c.env.DB.prepare(
    `SELECT event, note, detail_json, created_at
       FROM licence_events WHERE licence_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 50`,
  ).bind(row.id).all<{ event: string; note: string | null; detail_json: string | null; created_at: string }>();

  return c.json({
    licence: { ...licence, admin_role: row.admin_role },
    events: events.results || [],
    ...DERIVED_UNAVAILABLE,
  });
});

export default r;
