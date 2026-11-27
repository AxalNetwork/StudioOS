/**
 * D5018 (#5018) — program prices from the country index. Super Admin, HQ only.
 *
 *   GET  /api/admin/program-pricing/defaults                    every program's reference price (active and retired versions)
 *   POST /api/admin/program-pricing/defaults/:program           publish the next version   (write bar, reason, expected_version)
 *   GET  /api/admin/program-pricing/decisions[.csv]             pricing history ?licence= &program= (JSON, or CSV to export)
 *   GET  /api/admin/licences/:uid/program-pricing               per program: base → country-adjusted → accepted, override, period
 *
 * The price itself is set where a grant's terms are: the grant and change-terms
 * writes of `admin_program_grants.ts` take a `pricing` object and record one
 * `program_pricing_decisions` row in their own batch. This router never writes
 * a grant.
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { byUid } from '../services/licenceLedgerCore';
import { csvResponse, stamp } from '../services/csv';
import adminLicences from './admin_licences';
import type { RouteMount } from '../util/routeRegistry';
import { PricingError } from '../services/licencePricingStore';
import { latestLicenceSnapshot } from '../services/licencePricingApply';
import { PROGRAMS, programNamed, readinessRefusal } from '../services/programGrants';
import {
  activeDefault, allDefaults, decisionsCsv, decisionsWhere, indexOfSnapshot, publishDefault, recommendProgramFee, validateDefaultBody,
} from '../services/programPricing';

type C = Context<{ Bindings: Env }>;
const pricing = new Hono<{ Bindings: Env }>();
const perLicence = new Hono<{ Bindings: Env }>();

function answer(c: C, e: unknown) {
  if (e instanceof PricingError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}
const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

pricing.get('/defaults', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await allDefaults(c.env);
    return c.json({
      programs: PROGRAMS.map((p) => {
        const versions = rows.filter((r) => r.program_key === p.key);
        const active = versions.find((r) => r.status === 'active') ?? null;
        return {
          program_key: p.key, name: p.name, group: p.group, locked_reason: readinessRefusal(p.key),
          active, versions,
          ...(active ? {} : { reason: 'No reference price is recorded for this program. It is not free: a fee set for it is an override.' }),
        };
      }),
      // Programs D955 added for one studio carry prices too, when HQ publishes one.
      others: rows.filter((r) => !PROGRAMS.some((p) => p.key === r.program_key)),
    });
  } catch (e) { return answer(c, e); }
});

pricing.post('/defaults/:program', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const key = c.req.param('program');
    if (!KEY.test(key)) return refuse(c, 404, { code: 'unknown_program', message: 'There is no such program.' });
    const program = await programNamed(c.env, key);
    if (!program) return refuse(c, 404, { code: 'unknown_program', message: 'There is no such program.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) return refuse(c, 400, { code: 'reason_required', message: 'Say why, in 3 to 500 characters.' });
    const expected = body?.expected_version;
    if (!(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 0)) {
      return refuse(c, 400, { code: 'expected_version_required', message: 'Name the version you read (expected_version; 0 when none is recorded).' });
    }
    const v = validateDefaultBody(body);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_price', message: 'The reference price has fields to fix.', extra: { fields: v.errors } });
    const published = await publishDefault(c.env, key, v.value, expected, reason, `user:${admin.id}`);
    await logAdminAction(c.env, admin.id, admin.email || '', 'program_pricing_default_published', {
      program_key: key, version: published.version, base_annual_fee_cents: published.base_annual_fee_cents, currency: published.currency, reason,
    });
    return c.json({ default: published }, 201);
  } catch (e) { return answer(c, e); }
});

async function decisionsFor(c: C) {
  const licence = c.req.query('licence') || null;
  const program = c.req.query('program') || null;
  if (licence && !/^[A-Za-z0-9_-]{1,64}$/.test(licence)) return { refused: refuse(c, 400, { code: 'invalid_licence', message: 'licence is a licence id.' }) };
  if (program && !KEY.test(program)) return { refused: refuse(c, 400, { code: 'invalid_program', message: 'program is a program key.' }) };
  return { rows: await decisionsWhere(c.env, { licenceUid: licence, programKey: program, limit: 1000 }), licence, program };
}

pricing.get('/decisions', async (c) => {
  try {
    await requireSuperAdmin(c);
    const r = await decisionsFor(c);
    if ('refused' in r) return r.refused;
    return c.json({ decisions: r.rows, total: r.rows.length });
  } catch (e) { return answer(c, e); }
});

pricing.get('/decisions.csv', async (c) => {
  try {
    await requireSuperAdmin(c);
    const r = await decisionsFor(c);
    if ('refused' in r) return r.refused;
    return csvResponse(decisionsCsv(r.rows), `program-pricing-${r.licence || 'all'}-${stamp()}.csv`);
  } catch (e) { return answer(c, e); }
});

perLicence.get('/:uid/program-pricing', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, { code: 'not_found', message: 'No licence with that id.' });
    const snap = await latestLicenceSnapshot(c.env, licence.uid);
    const idx = await indexOfSnapshot(c.env, snap);
    const grants = (await c.env.DB.prepare('SELECT uid, program_key, state, fee_cents, currency, starts_on, ends_on, terms_revision FROM program_grants WHERE licence_id = ?')
      .bind(licence.id).all<Record<string, any>>()).results || [];
    const history = await decisionsWhere(c.env, { licenceUid: licence.uid, limit: 1000 });
    const keys = [...PROGRAMS.map((p) => p.key), ...grants.map((g) => String(g.program_key)).filter((k) => !PROGRAMS.some((p) => p.key === k))];
    const programs = await Promise.all(keys.map(async (key) => {
      const d = await activeDefault(c.env, key);
      const rec = recommendProgramFee(d, idx);
      const g = grants.find((x) => x.program_key === key) || null;
      const latest = history.find((x) => x.program_key === key) || null;
      return {
        program_key: key,
        name: PROGRAMS.find((p) => p.key === key)?.name ?? key,
        base: d ? { version: d.version, currency: d.currency, annual_fee_cents: d.base_annual_fee_cents, initial_fee_cents: d.base_initial_fee_cents } : null,
        base_reason: d ? null : 'Not recorded: no reference price is published for this program.',
        recommendation: rec,
        accepted: latest ? {
          annual_fee_cents: latest.accepted_annual_fee_cents, initial_fee_cents: latest.accepted_initial_fee_cents, currency: latest.currency,
          decision: latest.decision, overridden: latest.decision === 'overridden', override_reason: latest.override_reason,
          effective_from: latest.effective_from, effective_to: latest.effective_to, decided_at: latest.created_at,
          pricing_model_version: latest.pricing_model_version, country_index_ppm: latest.country_index_ppm,
        } : null,
        grant: g ? { state: g.state, fee_cents: g.fee_cents ?? null, currency: g.currency ?? null, starts_on: g.starts_on ?? null, ends_on: g.ends_on ?? null, terms_revision: Number(g.terms_revision ?? 1) } : null,
        decisions: history.filter((x) => x.program_key === key).length,
      };
    }));
    return c.json({
      licence_uid: licence.uid,
      snapshot: snap ? { uid: snap.uid, created_at: snap.created_at, basis: snap.basis, pricing_model_version: snap.pricing_model_version, currency: snap.currency } : null,
      country_index_ppm: idx.ppm, index_reason: idx.reason, model_version: idx.model_version,
      programs,
    });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  { path: '/api/admin/program-pricing', router: pricing },
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see this path first.
  { path: '/api/admin/licences', router: perLicence, before: [adminLicences] },
];

export default pricing;
