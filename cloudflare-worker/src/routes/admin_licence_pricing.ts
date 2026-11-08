/**
 * D5014 (#5014) — HQ country pricing: pricing models, country market profiles
 * and the pricing decisions recorded on a licence. Super Admin only, HQ only.
 *
 *   GET  /api/admin/licence-pricing/models                  every model, active first
 *   GET  /api/admin/licence-pricing/models/:uid
 *   POST /api/admin/licence-pricing/models                  a new DRAFT       (write bar)
 *   PUT  /api/admin/licence-pricing/models/:uid             edit a DRAFT      (write bar)
 *   POST /api/admin/licence-pricing/models/:uid/activate    draft → active, retiring the active one (write bar, reason)
 *   POST /api/admin/licence-pricing/models/:uid/retire      active → retired  (write bar, reason)
 *   DELETE /api/admin/licence-pricing/models/:uid           a DRAFT only      (write bar, reason)
 *   GET  /api/admin/licence-pricing/countries               ?q= &incomplete=1
 *   GET  /api/admin/licence-pricing/countries/:code         the profile and its latest snapshots
 *   GET  /api/admin/licences/:uid/pricing-decisions         what HQ accepted or overrode for a licence
 *
 * An active model is never edited: its calculation fields are frozen by the
 * migration's trigger, and this router refuses before reaching it. Every write
 * is audited with its actor, time and reason.
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { byUid } from '../services/licenceLedgerCore';
import adminLicences from './admin_licences';
import type { RouteMount } from '../util/routeRegistry';
import {
  PricingError, activateModel, countryCodeOf, createDraftModel, decisionsForLicence, deleteDraftModel, getCountry, getModel,
  listCountries, listModels, recentSnapshots, retireModel, updateDraftModel, validateModelInput,
} from '../services/licencePricingStore';

type C = Context<{ Bindings: Env }>;
const pricing = new Hono<{ Bindings: Env }>();
const decisions = new Hono<{ Bindings: Env }>();

/** A reason a person wrote: 3–500 characters after trimming, or null. */
function reasonOf(body: unknown): string | null {
  const raw = (body as Record<string, unknown> | null)?.reason;
  const r = typeof raw === 'string' ? raw.trim() : '';
  return r.length >= 3 && r.length <= 500 ? r : null;
}
const noReason = (c: C) => refuse(c, 400, { code: 'reason_required', message: 'Say why, in 3 to 500 characters.' });

function answer(c: C, e: unknown) {
  if (e instanceof PricingError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}

const actorOf = (u: { id: number; email?: string | null }) => `user:${u.id}`;

pricing.get('/models', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({ models: await listModels(c.env) });
  } catch (e) { return answer(c, e); }
});

pricing.get('/models/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const model = await getModel(c.env, c.req.param('uid'));
    if (!model) return refuse(c, 404, { code: 'not_found', message: 'No pricing model with that id.' });
    return c.json({ model });
  } catch (e) { return answer(c, e); }
});

pricing.post('/models', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const body = await c.req.json().catch(() => null);
    const v = validateModelInput(body);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_model', message: 'The pricing model has fields to fix.', extra: { fields: v.errors } });
    const model = await createDraftModel(c.env, v.value, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_model_drafted', { model_uid: model.uid, version: model.version });
    return c.json({ model }, 201);
  } catch (e) { return answer(c, e); }
});

pricing.put('/models/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const body = await c.req.json().catch(() => null);
    const v = validateModelInput(body);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_model', message: 'The pricing model has fields to fix.', extra: { fields: v.errors } });
    const model = await updateDraftModel(c.env, c.req.param('uid'), v.value);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_model_edited', { model_uid: model.uid, version: model.version });
    return c.json({ model });
  } catch (e) { return answer(c, e); }
});

pricing.post('/models/:uid/activate', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    const { model, retired } = await activateModel(c.env, c.req.param('uid'), actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_model_activated', { model_uid: model.uid, version: model.version, retired_model_uid: retired, reason });
    return c.json({ model, retired_model_uid: retired });
  } catch (e) { return answer(c, e); }
});

pricing.post('/models/:uid/retire', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    const model = await retireModel(c.env, c.req.param('uid'));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_model_retired', { model_uid: model.uid, version: model.version, reason });
    return c.json({ model });
  } catch (e) { return answer(c, e); }
});

pricing.delete('/models/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    const uid = c.req.param('uid');
    await deleteDraftModel(c.env, uid);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_model_draft_deleted', { model_uid: uid, reason });
    return c.json({ ok: true });
  } catch (e) { return answer(c, e); }
});

pricing.get('/countries', async (c) => {
  try {
    await requireSuperAdmin(c);
    const countries = await listCountries(c.env, { q: c.req.query('q') || '', incomplete: c.req.query('incomplete') === '1' });
    return c.json({ countries, total: countries.length });
  } catch (e) { return answer(c, e); }
});

pricing.get('/countries/:code', async (c) => {
  try {
    await requireSuperAdmin(c);
    const code = countryCodeOf(c.req.param('code'));
    if (!code) return refuse(c, 400, { code: 'invalid_country', message: 'A country is an ISO 3166-1 alpha-2 code, like FR.' });
    const profile = await getCountry(c.env, code);
    if (!profile) return refuse(c, 404, { code: 'not_found', message: `No market profile is recorded for ${code}.` });
    return c.json({ profile, snapshots: await recentSnapshots(c.env, code) });
  } catch (e) { return answer(c, e); }
});

decisions.get('/:uid/pricing-decisions', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, { code: 'not_found', message: 'No licence with that id.' });
    return c.json({ licence_uid: licence.uid, decisions: await decisionsForLicence(c.env, licence.uid) });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  { path: '/api/admin/licence-pricing', router: pricing },
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see this path first.
  { path: '/api/admin/licences', router: decisions, before: [adminLicences] },
];

export default pricing;
