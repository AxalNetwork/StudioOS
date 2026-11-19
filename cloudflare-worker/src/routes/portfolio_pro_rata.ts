/**
 * D6908 (#6908): an investor reads their own pro rata offer in a held
 * company's live round, and the address to open that round. Mounted at
 * /api/portfolio-pro-rata. Owner answer A on D6228: investors read their own
 * pro rata offer. It feeds the Pro rata row's "What you can do" on Ownership &
 * rights (D6868, PRM18).
 *
 *   GET /:projectUid   an investor (the licence, not an admin) for a company
 *                      they hold through a confirmed commitment
 *                      (`investorHeldProjectIds`, the Positions read's held
 *                      scope). Not held and unknown answer alike (403
 *                      `not_held`), so the read does not confirm a company.
 *
 * WHAT IS LIVE. The company's `active` round on the round manager
 * (`raise_rounds`, one at most per company). None: `live_round` is null and
 * there is no action.
 *
 * WHOSE OFFER. Only the caller's own row: the round's `raise_pro_rata` row
 * whose `holder_email` is the caller's account email, compared without case.
 * No other holder's row is read, and the response never names another holder.
 *
 * WHAT IS NEVER COMPUTED. An offer is what the founder recorded
 * (`offer_cents`, `respond_by`, migration 202611161255_6908). With none, the
 * offer reads `Offer not recorded`, and nothing is derived from the holder's
 * prior stake or the round size. The round is still linked.
 *
 * THE ROUND'S ADDRESS. The company's active deal on Axal (`deals.status =
 * 'active'`, newest first) opens at `/deals/<id>`. A deal the preparation
 * guard hides from discovery (D5454, `dealHiddenFrom`: a withdrawn or archived listing) is
 * never linked. A round with no deal on Axal has no address here: `href` is
 * null with the reason, never a guessed page.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, canViewLpData } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { investorHeldProjectIds, investorActiveCompany } from './_investorProjectScope';
import { dealHiddenFrom } from '../services/dealPreparation';

const r = new Hono<{ Bindings: Env }>();

export const OFFER_NOT_RECORDED = 'Offer not recorded';
export const ROUND_NOT_ON_AXAL = 'This round has no deal page on Axal.';

const isAdminUser = (u: User) => u.role === 'admin';

/** The caller's own row in one round, by their account email. Null when they have none. */
async function canReadOwnOffer(env: Env, roundId: number, user: User) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return null;
  return env.DB.prepare(
    `SELECT state, offer_cents, respond_by, currency, taking_cents, responded_at
       FROM raise_pro_rata WHERE round_id = ? AND LOWER(holder_email) = ? LIMIT 1`,
  ).bind(roundId, email).first<any>();
}

// GET /api/portfolio-pro-rata/:projectUid
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    // HQ reads the round manager itself; this read is the investor's own.
    if (isAdminUser(user) || !canViewLpData(user)) return c.json({ detail: 'Only an investor reads their own pro rata offer.', code: 'investor_only' }, 403);
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number; uid: string; name: string }>();
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) {
      return c.json({ detail: 'You can read a pro rata offer only for a company you hold.', code: 'not_held' }, 403);
    }
    const round = await c.env.DB.prepare(
      `SELECT id, uid, name, close_date, currency FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
    ).bind(proj.id).first<any>();
    if (!round) return c.json({ project_uid: proj.uid, live_round: null, offer: null });

    const found = await c.env.DB.prepare(
      `SELECT id FROM deals WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
    ).bind(proj.id).first<{ id: number }>();
    // D5454: a withdrawn or archived listing is not offered as the live round; the round reads as having no deal page.
    const deal = found && !(await dealHiddenFrom(c.env, Number(found.id), 'discovery')) ? found : null;
    const mine = await canReadOwnOffer(c.env, Number(round.id), user);
    const recorded = mine && mine.offer_cents != null && Number(mine.offer_cents) > 0;
    return c.json({
      project_uid: proj.uid,
      live_round: {
        uid: round.uid,
        name: round.name ?? null,
        close_date: round.close_date ?? null,
        href: deal ? `/deals/${deal.id}` : null,
        href_not_recorded: deal ? null : ROUND_NOT_ON_AXAL,
      },
      offer: recorded
        ? {
            amount_cents: Number(mine.offer_cents),
            currency: String(mine.currency || round.currency || 'USD'),
            respond_by: mine.respond_by ?? null,
            state: String(mine.state || 'offered'),
            taking_cents: mine.taking_cents == null ? null : Number(mine.taking_cents),
            responded_at: mine.responded_at ?? null,
          }
        : null,
      offer_not_recorded: recorded ? null : OFFER_NOT_RECORDED,
    });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/portfolio-pro-rata', router: r };
export default r;
