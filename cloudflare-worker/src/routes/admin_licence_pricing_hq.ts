/**
 * D5020 (#5020) — HQ's country-pricing reads: the catalogue, a country's calculation and sources, the model versions,
 * the annual review queue and the ledger's Needs HQ pricing signals. Super Admin only, HQ only; every route reads.
 *
 *   GET /api/admin/licence-pricing/catalogue          the 49 markets: tier, index, completeness, last source update,
 *                                                     recommended annual and initial fee, regulatory class
 *                                                     ?q= &incomplete=1 &model=<uid> &allow_provisional=1
 *   GET /api/admin/licence-pricing/catalogue/:code    one market: inputs with provenance, observation history, the
 *                                                     calculation now with its trace and digest, frozen snapshots
 *                                                     ?model=<uid> &allow_provisional=1
 *   GET /api/admin/licence-pricing/model-versions     current, drafts, retired, and a dated history with usage
 *   GET /api/admin/licence-pricing/review-queue       every licence whose pricing review is due, open review row or
 *                                                     not, oldest first; licences with no pricing decision apart
 *                                                     ?within_days=0..366
 *   GET /api/admin/licence-pricing/signals            per licence: pricing review due, pricing data incomplete,
 *                                                     overridden pricing, exclusivity at risk; with counts
 *                                                     ?needs=<signal,…> &licence=<uid,…>
 *
 * Nothing here writes: a catalogue figure is calculated now and stored nowhere (`stored: false`).
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin } from '../auth';
import type { Env } from '../types';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { PricingError, countryCodeOf } from '../services/licencePricingStore';
import {
  catalogue, countryDetail, ledgerPricingStates, modelVersions, reviewQueue, signalCounts, signalsFromParam, SIGNALS,
} from '../services/licencePricingHq';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

function answer(c: C, e: unknown) {
  if (e instanceof PricingError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}

const MODEL_UID = /^[A-Za-z0-9_-]{1,64}$/;
/** `?model=`: a model uid, absent, or a refusal. */
function modelParam(c: C): { ok: true; uid: string | null } | { ok: false } {
  const raw = c.req.query('model');
  if (raw === undefined || raw === '') return { ok: true, uid: null };
  return MODEL_UID.test(raw) ? { ok: true, uid: raw } : { ok: false };
}
const badModel = (c: C) => refuse(c, 400, { code: 'invalid_model', message: 'model is a pricing model id.' });

r.get('/catalogue', async (c) => {
  try {
    await requireSuperAdmin(c);
    const m = modelParam(c);
    if (!m.ok) return badModel(c);
    const out = await catalogue(c.env, {
      q: c.req.query('q') || '', incomplete: c.req.query('incomplete') === '1', modelUid: m.uid,
      allowProvisional: c.req.query('allow_provisional') === '1',
    });
    if (m.uid && !out.model) return refuse(c, 404, { code: 'not_found', message: 'No pricing model with that id.' });
    return c.json(out);
  } catch (e) { return answer(c, e); }
});

r.get('/catalogue/:code', async (c) => {
  try {
    await requireSuperAdmin(c);
    const code = countryCodeOf(c.req.param('code'));
    if (!code) return refuse(c, 400, { code: 'invalid_country', message: 'A country is an ISO 3166-1 alpha-2 code, like FR.' });
    const m = modelParam(c);
    if (!m.ok) return badModel(c);
    const out = await countryDetail(c.env, code, { modelUid: m.uid, allowProvisional: c.req.query('allow_provisional') === '1' });
    if (!out) return refuse(c, 404, { code: 'not_found', message: `No market profile is recorded for ${code}.` });
    if (m.uid && !out.model) return refuse(c, 404, { code: 'not_found', message: 'No pricing model with that id.' });
    return c.json(out);
  } catch (e) { return answer(c, e); }
});

r.get('/model-versions', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json(await modelVersions(c.env));
  } catch (e) { return answer(c, e); }
});

r.get('/review-queue', async (c) => {
  try {
    await requireSuperAdmin(c);
    const raw = c.req.query('within_days');
    const within = raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isSafeInteger(within) || within < 0 || within > 366) {
      return refuse(c, 400, { code: 'invalid_window', message: 'within_days is a whole number of days from 0 to 366.' });
    }
    const day = today();
    return c.json(reviewQueue(await ledgerPricingStates(c.env, day), day, within));
  } catch (e) { return answer(c, e); }
});

r.get('/signals', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rawNeeds = c.req.query('needs');
    const needs = signalsFromParam(rawNeeds);
    if (rawNeeds && !needs.length) {
      return refuse(c, 400, { code: 'invalid_needs', message: `needs names one or more of ${SIGNALS.join(', ')}.` });
    }
    const rawLicences = c.req.query('licence');
    const wanted = rawLicences ? rawLicences.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (wanted && (wanted.length > 200 || wanted.some((u) => !/^[A-Za-z0-9_-]{1,64}$/.test(u)))) {
      return refuse(c, 400, { code: 'invalid_licence', message: 'licence is up to 200 licence ids, separated by commas.' });
    }
    const day = today();
    const all = await ledgerPricingStates(c.env, day);
    const scoped = wanted ? all.filter((s) => wanted.includes(s.licence_uid)) : all;
    // Two named signals narrow, as two Needs HQ chips do on the ledger.
    const items = needs.length ? scoped.filter((s) => needs.every((n) => s.signals[n] === true)) : scoped;
    return c.json({ today: day, needs, items, total: items.length, counts: signalCounts(scoped), signals: SIGNALS });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  { path: '/api/admin/licence-pricing', router: r },
];

export default r;
