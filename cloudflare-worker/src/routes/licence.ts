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
 * document carries a licence_id. So seats USED, accounts in territory, revenue
 * per subsidiary and the whole approval queue in the canvas cannot be computed
 * — not "are zero", cannot be computed. Every one of them would need
 * account→licence attribution.
 *
 * The response therefore carries `derived_metrics_available: false` and a
 * reason, in the same spirit as the fund-analytics rule: an unmeasured number
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
      // Deliberately not computed here even on a branch. Seats USED needs
      // `seat_assignments`, which PR 5 builds; until then the reason below
      // is the honest answer on both tiers.
      seats_used: null,
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
 */
export const DERIVED_UNAVAILABLE = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Seats used, accounts in territory and revenue per subsidiary all need every account to name '
    + 'the licence it belongs to. No account carries one yet — migration 187 built the licence '
    + 'ledger, not the tenancy scope — so these are not shown rather than shown as zero.',
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
    return c.json({ ...payload, ...DERIVED_UNAVAILABLE });
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
