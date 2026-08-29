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
import { hydrate, type LicenceRow } from './admin_licences';

const r = new Hono<{ Bindings: Env }>();

/** Said once, in one place, so the two callers below cannot word it differently. */
const DERIVED_UNAVAILABLE = {
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
