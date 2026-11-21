/** HQ package offer decisions, review and atomic acceptance (#5024). */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import adminLicences from './admin_licences';
import { byUid } from '../services/licenceLedgerCore';
import { PackageError } from '../services/licencePackagesStore';
import { PackagePricingError } from '../services/packagePricing';
import { acceptPackageOffer, changePackageOfferState, createPackageOffer, getPackageOffer, listPackageOffers,
  PackageOfferError, presentPackageOffer, reviewPackageOffer } from '../services/packageOffers';

const r = new Hono<{ Bindings: Env }>();
function answer(c: any, e: unknown) {
  if (e instanceof PackageOfferError) return c.json({ error: e.code, message: e.sentence, ...e.detail }, e.status);
  if (e instanceof PackageError || e instanceof PackagePricingError) return c.json({ error: e.code, message: e.sentence }, e.status);
  const mapped = mapError(c, e);
  return mapped.status === 400 ? c.json({ error: 'package_operation_unavailable', message: 'The package operation could not be confirmed. Keep its key and read it again.' }, 500) : mapped;
}
const bodyOf = async (c: any) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new PackageOfferError(400, 'invalid_body', 'Send a JSON object.');
  return b;
};

r.get('/:uid/package-offers', async (c) => {
  try {
    await requireSuperAdmin(c);
    if (!await byUid(c.env, c.req.param('uid'))) throw new PackageOfferError(404, 'not_found', 'No licence has that id.');
    return c.json({ items: await listPackageOffers(c.env, c.req.param('uid')) });
  } catch (e) { return answer(c, e); }
});
r.post('/:uid/package-offers', async (c) => {
  try {
    const actor = await requireSuperAdminWriteBar(c);
    const result = await createPackageOffer(c.env, c.req.param('uid'), await bodyOf(c), actor);
    return c.json(result, result.created ? 201 : 200);
  } catch (e) { return answer(c, e); }
});
r.get('/:uid/package-offers/:offer', async (c) => {
  try {
    await requireSuperAdmin(c);
    const offer = await getPackageOffer(c.env, c.req.param('uid'), c.req.param('offer'));
    const items = await c.env.DB.prepare('SELECT * FROM licence_package_items WHERE offer_uid = ? ORDER BY position, program_key').bind(offer.uid).all();
    return c.json({ offer: presentPackageOffer(offer), accepted_items: items.results || [] });
  } catch (e) { return answer(c, e); }
});
r.get('/:uid/package-offers/:offer/history', async (c) => {
  try {
    await requireSuperAdmin(c);
    const offer = await getPackageOffer(c.env, c.req.param('uid'), c.req.param('offer'));
    const rows = await c.env.DB.prepare('SELECT * FROM licence_package_events WHERE offer_uid = ? ORDER BY id LIMIT 200').bind(offer.uid).all();
    return c.json({ items: rows.results || [] });
  } catch (e) { return answer(c, e); }
});
r.post('/:uid/package-offers/:offer/review', async (c) => {
  try {
    await requireSuperAdmin(c);
    const { review, review_hash } = await reviewPackageOffer(c.env, c.req.param('uid'), c.req.param('offer'), await bodyOf(c));
    return c.json({ ...review, review_hash });
  } catch (e) { return answer(c, e); }
});
r.post('/:uid/package-offers/:offer/accept', async (c) => {
  try {
    const actor = await requireSuperAdminWriteBar(c);
    return c.json(await acceptPackageOffer(c.env, c.req.param('uid'), c.req.param('offer'), await bodyOf(c), actor));
  } catch (e) { return answer(c, e); }
});
const decide = (action: string) => async (c: any) => {
  try {
    const actor = await requireSuperAdminWriteBar(c);
    return c.json({ offer: await changePackageOfferState(c.env, c.req.param('uid'), c.req.param('offer'), action, await bodyOf(c), actor.id) });
  } catch (e) { return answer(c, e); }
};
r.post('/:uid/package-offers/:offer/offer', decide('offer'));
r.post('/:uid/package-offers/:offer/decline', decide('decline'));
r.post('/:uid/package-offers/:offer/expire', decide('expire'));
r.post('/:uid/package-offers/:offer/supersede', decide('supersede'));
export const mount = { path: '/api/admin/licences', router: r, before: [adminLicences] };
export default r;
