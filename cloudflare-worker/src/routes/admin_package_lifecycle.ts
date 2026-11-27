/**
 * HQ package term lifecycle (D5025, #5025): each accepted package term's
 * state, the read-only review of a renewal, upgrade, downgrade or change
 * (part 1) with the open items of each program it ends (part 3, D5025-p3),
 * and scheduling that change for the next term, listing and
 * cancelling schedules (part 2, D5025-p2). Super Admin only; writes are
 * audited and use the Super Admin write bar.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import adminLicences from './admin_licences';
import type { RouteMount } from '../util/routeRegistry';
import { byUid } from '../services/licenceLedgerCore';
import { getPackageOffer, PackageOfferError } from '../services/packageOffers';
import { endingDependents, licenceOffers, reviewChange, standaloneGranted, termState, today } from '../services/packageLifecycle';
import { cancelPackageChange, listPackageChanges, schedulePackageChange } from '../services/packageChanges';

const r = new Hono<{ Bindings: Env }>();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function answer(c: any, e: unknown) {
  if (e instanceof PackageOfferError) return c.json({ error: e.code, message: e.sentence }, e.status);
  const mapped = mapError(c, e);
  return mapped.status === 400 ? c.json({ error: 'package_lifecycle_unavailable', message: 'The package term could not be read. Try again.' }, 500) : mapped;
}

r.get('/:uid/package-terms', async (c) => {
  try {
    await requireSuperAdmin(c);
    const uid = c.req.param('uid');
    if (!await byUid(c.env, uid)) throw new PackageOfferError(404, 'not_found', 'No licence has that id.');
    const all = await licenceOffers(c.env, uid);
    const day = today();
    const items = all.filter((o) => o.state === 'accepted').map((o) => ({
      uid: o.uid, package_key: o.package_key, package_version: o.package_version, package_name: o.package_name,
      starts_on: o.starts_on, ends_on: o.ends_on, accepted_annual_fee_cents: o.accepted_annual_fee_cents, currency: o.currency,
      state: termState(o, all, day),
    }));
    c.header('Cache-Control', 'no-store');
    return c.json({ as_of: day, items });
  } catch (e) { return answer(c, e); }
});

r.get('/:uid/package-offers/:offer/change-review', async (c) => {
  try {
    await requireSuperAdmin(c);
    const uid = c.req.param('uid');
    const proposal = await getPackageOffer(c.env, uid, c.req.param('offer'));
    if (proposal.state !== 'draft' && proposal.state !== 'offered') {
      throw new PackageOfferError(409, 'offer_not_open', 'Only a draft or offered package offer can be reviewed as a change.');
    }
    const effective = c.req.query('effective_on') ?? null;
    if (effective != null && !DAY.test(effective)) {
      throw new PackageOfferError(400, 'invalid_effective_on', 'effective_on must be a day written YYYY-MM-DD.');
    }
    const day = today();
    const review = reviewChange({
      proposal, all: await licenceOffers(c.env, uid), standaloneGranted: await standaloneGranted(c.env, uid),
      day, effectiveOn: effective,
    });
    if (effective != null && review.current_term && !(review as any).proration_quote) {
      throw new PackageOfferError(400, 'effective_outside_term', 'effective_on must fall inside the current term, in the same currency.');
    }
    // D5025-p3: the open items of each ending program, for the licence's holders. Read only.
    if ('ending_dependents' in review && review.ending_dependents) {
      review.ending_dependents = await endingDependents(c.env, uid, review.programs.ending, day, new Date().toISOString());
    }
    c.header('Cache-Control', 'no-store');
    return c.json(review);
  } catch (e) { return answer(c, e); }
});

const bodyOf = async (c: any) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new PackageOfferError(400, 'invalid_body', 'Send a JSON object.');
  return b;
};

r.get('/:uid/package-changes', async (c) => {
  try {
    await requireSuperAdmin(c);
    const uid = c.req.param('uid');
    if (!await byUid(c.env, uid)) throw new PackageOfferError(404, 'not_found', 'No licence has that id.');
    const day = today();
    c.header('Cache-Control', 'no-store');
    return c.json({ as_of: day, items: await listPackageChanges(c.env, uid, day) });
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/package-offers/:offer/schedule-change', async (c) => {
  try {
    const actor = await requireSuperAdminWriteBar(c);
    const result = await schedulePackageChange(c.env, c.req.param('uid'), c.req.param('offer'), await bodyOf(c), actor, today());
    return c.json(result, result.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/package-changes/:change/cancel', async (c) => {
  try {
    const actor = await requireSuperAdminWriteBar(c);
    return c.json(await cancelPackageChange(c.env, c.req.param('uid'), c.req.param('change'), await bodyOf(c), actor, today()));
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licences', router: r, before: [adminLicences] };
export default r;
