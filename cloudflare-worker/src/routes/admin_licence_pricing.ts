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
 * D5016 (#5016), maintaining the catalogue (write bar, reason, expected revision):
 *   PATCH /api/admin/licence-pricing/countries/:code                       name, region, currency, regulatory class, notes
 *   POST  /api/admin/licence-pricing/countries/:code/observations          a sourced value becomes the field's current value
 *   PUT   /api/admin/licence-pricing/countries/:code/fields/:field/status  mark provisional, or not recorded (clears it)
 *   POST  /api/admin/licence-pricing/countries/import                      a dataset of observations, all or none per country
 *   GET   /api/admin/licence-pricing/countries/:code/observations          the field history, newest first
 *   POST  /api/admin/licence-pricing/countries/:code/preview               a recommendation calculated now; nothing is stored
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
  OBSERVED_FIELDS, importObservations, observationsFor, recordObservation, revisionOf, setFieldStatus, updateDetails,
  validateDetails, validateObservation, type ObservationInput, type ObservedField,
} from '../services/licencePricingCatalogue';
import { previewRecommendation } from '../services/licencePricingSnapshots';
import {
  PricingError, activateModel, activeModel, countryCodeOf, createDraftModel, decisionsForLicence, deleteDraftModel, getCountry, getModel,
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


// ── D5016: maintaining the catalogue ─────────────────────────────────────────

const noRevision = (c: C) => refuse(c, 400, { code: 'expected_revision_required', message: 'Name the profile revision you read (expected_revision).' });
const codeOr400 = (c: C) => countryCodeOf(c.req.param('code'));
const badCountry = (c: C) => refuse(c, 400, { code: 'invalid_country', message: 'A country is an ISO 3166-1 alpha-2 code, like FR.' });

pricing.patch('/countries/:code', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const code = codeOr400(c);
    if (!code) return badCountry(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const expected = revisionOf(body?.expected_revision);
    if (expected === null) return noRevision(c);
    const fields = Object.fromEntries(Object.entries(body || {}).filter(([k]) => k !== 'expected_revision' && k !== 'reason'));
    const v = validateDetails(fields);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_profile', message: 'The profile has fields to fix.', extra: { fields: v.errors } });
    const profile = await updateDetails(c.env, code, v.value, expected, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_profile_updated', { country_code: code, changed: Object.keys(v.value), revision: profile.revision, reason });
    return c.json({ profile });
  } catch (e) { return answer(c, e); }
});

pricing.post('/countries/import', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const raw = Array.isArray(body?.observations) ? body!.observations as unknown[] : [];
    if (!raw.length || raw.length > 500) return refuse(c, 400, { code: 'invalid_import', message: 'An import holds 1 to 500 observations.' });
    const rows: ObservationInput[] = [];
    const errors: Array<{ row: number; fields: Record<string, string> }> = [];
    raw.forEach((r, i) => { const v = validateObservation(r); if (v.ok) rows.push(v.value); else errors.push({ row: i, fields: v.errors }); });
    if (errors.length) return refuse(c, 400, { code: 'invalid_import', message: 'Some observations have fields to fix; nothing was imported.', extra: { rows: errors } });
    const expectedRaw = (body?.expected_revisions && typeof body.expected_revisions === 'object' ? body.expected_revisions : {}) as Record<string, unknown>;
    const expected: Record<string, number> = {};
    for (const [k, v] of Object.entries(expectedRaw)) { const r = revisionOf(v); if (r !== null) expected[k.toUpperCase()] = r; }
    const result = await importObservations(c.env, rows, expected, actorOf(admin), reason);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_observations_imported', { applied: result.applied, conflicts: result.conflicts.map((x) => x.country_code), rows: rows.length, reason });
    return c.json(result, result.conflicts.length ? 207 : 200);
  } catch (e) { return answer(c, e); }
});

pricing.post('/countries/:code/observations', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const code = codeOr400(c);
    if (!code) return badCountry(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const expected = revisionOf(body?.expected_revision);
    if (expected === null) return noRevision(c);
    const v = validateObservation({ ...(body || {}), country_code: code });
    if (!v.ok) return refuse(c, 400, { code: 'invalid_observation', message: 'The observation has fields to fix.', extra: { fields: v.errors } });
    const profile = await recordObservation(c.env, v.value, expected, actorOf(admin), reason);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_observation_recorded', {
      country_code: code, field: v.value.field, status: v.value.status, source: v.value.source, as_of: v.value.as_of, revision: profile.revision, reason,
    });
    return c.json({ profile }, 201);
  } catch (e) { return answer(c, e); }
});

pricing.put('/countries/:code/fields/:field/status', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const code = codeOr400(c);
    if (!code) return badCountry(c);
    const field = c.req.param('field') as ObservedField;
    if (!(OBSERVED_FIELDS as readonly string[]).includes(field)) return refuse(c, 404, { code: 'not_found', message: 'No such field.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const expected = revisionOf(body?.expected_revision);
    if (expected === null) return noRevision(c);
    const status = body?.status;
    if (status !== 'provisional' && status !== 'not_recorded') return refuse(c, 400, { code: 'invalid_status', message: 'status must be provisional or not_recorded.' });
    const profile = await setFieldStatus(c.env, code, field, status, expected, actorOf(admin), reason);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_pricing_field_status_set', { country_code: code, field, status, revision: profile.revision, reason });
    return c.json({ profile });
  } catch (e) { return answer(c, e); }
});

pricing.get('/countries/:code/observations', async (c) => {
  try {
    await requireSuperAdmin(c);
    const code = codeOr400(c);
    if (!code) return badCountry(c);
    const f = c.req.query('field');
    if (f && !(OBSERVED_FIELDS as readonly string[]).includes(f)) return refuse(c, 400, { code: 'invalid_field', message: `field must be one of ${OBSERVED_FIELDS.join(', ')}.` });
    if (!(await getCountry(c.env, code))) return refuse(c, 404, { code: 'not_found', message: `No market profile is recorded for ${code}.` });
    return c.json({ country_code: code, observations: await observationsFor(c.env, code, (f as ObservedField) || null) });
  } catch (e) { return answer(c, e); }
});

// A preview writes nothing, so it needs Super Admin, not the write bar. Without a model it uses the active one.
pricing.post('/countries/:code/preview', async (c) => {
  try {
    await requireSuperAdmin(c);
    const code = codeOr400(c);
    if (!code) return badCountry(c);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    let modelUid = typeof body?.model_uid === 'string' ? body.model_uid : null;
    if (!modelUid) {
      const active = await activeModel(c.env);
      if (!active) return refuse(c, 409, { code: 'no_active_model', message: 'No pricing model is active; name a draft to preview with it, or activate one.' });
      modelUid = active.uid;
    }
    const p = await previewRecommendation(c.env, { modelUid, countryCode: code, allowProvisional: body?.allow_provisional === true });
    return c.json({ recommendation: p.recommendation, source_digest: p.source_digest, model: { uid: p.model.uid, version: p.model.version, status: p.model.status }, profile_revision: p.profile.revision, stored: false });
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
