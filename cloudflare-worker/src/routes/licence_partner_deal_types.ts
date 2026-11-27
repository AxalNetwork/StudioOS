/**
 * D986 (#2776, part 5 of #2376) — the studio's own read of its partner deal
 * types (the canvas's GR7 locked card, "HQ sets these"). Mounted at
 * `/api/licence`, ahead of `routes/licence.ts`:
 *
 *   GET /mine/partner-deal-types
 *
 * WHO, ON EACH SIDE, as `GET /api/licence/mine` decides it:
 *   · on HQ, the Administrator bound to a licence in `licence_admins`; anyone
 *     else gets 404 `no_licence`, the same answer `/mine` gives;
 *   · on a branch, an admin of that branch, reading the copy HQ pushed.
 *
 * A licence HQ has not set reads `recorded: false` with the sentence that says
 * every type stays open until it does (D986 §3). A store or copy that cannot be
 * read is a 503, never "Not recorded".
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { catalogue, readBranchDealTypes, readHqDealTypes } from '../services/partnerDealTypes';

const r = new Hono<{ Bindings: Env }>();

r.get('/mine/partner-deal-types', async (c) => {
  const user = await requireAuth(c);
  if (branchOf(c.env)) {
    if (user.role !== 'admin') return c.json({ error: 'forbidden', message: 'Only an admin of this studio reads its licence.' }, 403);
    try {
      const copy = await readBranchDealTypes(c.env);
      return c.json(copy.state === 'recorded'
        ? { source: 'branch_copy', catalogue: catalogue(), recorded: true, types: copy.types, reason: null }
        : { source: 'branch_copy', catalogue: catalogue(), recorded: false, types: null, reason: copy.reason, state: copy.state });
    } catch (e) {
      console.warn('[licence] partner deal types copy unreadable', (e as Error).message);
      return c.json({ error: 'deal_types_unreadable', message: 'This studio\'s partner deal types could not be read.' }, 503);
    }
  }
  let licenceId: number | null;
  try {
    const row = await c.env.DB.prepare('SELECT licence_id FROM licence_admins WHERE user_id = ?')
      .bind(user.id).first<{ licence_id: number }>();
    licenceId = row ? Number(row.licence_id) : null;
  } catch (e) {
    console.warn('[licence] licence_admins unreadable', (e as Error).message);
    return c.json({ error: 'deal_types_unreadable', message: 'This studio\'s partner deal types could not be read.' }, 503);
  }
  if (licenceId === null) return c.json({ error: 'no_licence', message: 'You do not administer a territory licence.' }, 404);
  try {
    const rec = await readHqDealTypes(c.env, licenceId);
    return c.json({ source: 'hq', catalogue: catalogue(), recorded: rec.recorded, types: rec.types, reason: rec.reason, updated_at: rec.updated_at });
  } catch (e) {
    console.warn('[licence] licence_partner_deal_types unreadable', (e as Error).message);
    return c.json({ error: 'deal_types_unreadable', message: 'This studio\'s partner deal types could not be read.' }, 503);
  }
});

export default r;
