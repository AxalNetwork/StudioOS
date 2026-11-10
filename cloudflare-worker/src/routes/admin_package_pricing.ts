/**
 * D5023 (#5023, part 2 of #5021) — a package version's country-adjusted price for one licence. Super Admin, HQ
 * only (`requireSuperAdmin` / `requireSuperAdminWriteBar` already refuse a branch — D106).
 *
 *   GET  /api/admin/licences/:uid/package-pricing                     every active package priced from the licence's latest
 *                                                                      country recommendation (?package= &version= &snapshot=)
 *   POST /api/admin/licences/:uid/package-pricing/recommendations     freeze one: { package_key, version?, licence_snapshot_uid?,
 *                                                                      snapshot_reason? }  (write bar; 201 new, 200 same inputs)
 *   GET  /api/admin/licences/:uid/package-pricing/recommendations     the frozen ones, newest first (?package=)
 *
 * The GET is a preview: it writes nothing. The POST records one append-only row naming every input
 * (`services/packagePricing.ts`), so the same package version and country snapshot always answer the same
 * recommendation. Neither changes a licence, its terms or an invoice.
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { byUid } from '../services/licenceLedgerCore';
import adminLicences from './admin_licences';
import { PackageError, activePackageDetail, isPackageKey, listPackages, versionDetail } from '../services/licencePackagesStore';
import { indexOfSnapshot } from '../services/programPricing';
import {
  PackagePricingError, createRecommendation, defaultsFor, provisionalOf, recommendPackage, recommendationsFor, snapshotFor,
} from '../services/packagePricing';

type C = Context<{ Bindings: Env }>;
const packagePricing = new Hono<{ Bindings: Env }>();

function answer(c: C, e: unknown) {
  if (e instanceof PackagePricingError) return refuse(c, e.status, { code: e.code, message: e.sentence });
  if (e instanceof PackageError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}

const UID = /^[A-Za-z0-9_-]{1,64}$/;
const SNAP = /^[A-Za-z0-9-]{8,64}$/;

async function licenceOf(c: C) {
  const uid = c.req.param('uid') || '';
  if (!UID.test(uid)) return null;
  return byUid(c.env, uid);
}
const noLicence = (c: C) => refuse(c, 404, { code: 'not_found', message: 'No licence with that id.' });

function versionOf(raw: unknown): number | null | 'bad' {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 1 ? v : 'bad';
}

packagePricing.get('/:uid/package-pricing', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c);
    if (!licence) return noLicence(c);
    const key = c.req.query('package') || null;
    const version = versionOf(c.req.query('version'));
    const snapshotUid = c.req.query('snapshot') || null;
    if (key && !isPackageKey(key)) return refuse(c, 400, { code: 'invalid_package_key', message: 'package is a package key.' });
    if (version === 'bad') return refuse(c, 400, { code: 'invalid_version', message: 'version must be a positive integer.' });
    if (version !== null && !key) return refuse(c, 400, { code: 'package_required', message: 'Name the package whose version you want.' });
    if (snapshotUid && !SNAP.test(snapshotUid)) return refuse(c, 400, { code: 'invalid_snapshot', message: 'snapshot is a country recommendation id.' });
    // A preview may look at an older snapshot without a reason: it records nothing.
    const { snap, latest } = await snapshotFor(c.env, licence.uid, { uid: snapshotUid, reason: snapshotUid ? 'preview' : null });
    const idx = await indexOfSnapshot(c.env, snap);
    const provisional = provisionalOf(snap);
    const pkgs = key
      ? [version === null ? await activePackageDetail(c.env, key) : await versionDetail(c.env, key, version)]
      : await Promise.all((await listPackages(c.env)).map((p) => activePackageDetail(c.env, p.package_key)));
    const packages = await Promise.all(pkgs.map(async (p) => ({ ...recommendPackage(p, idx, await defaultsFor(c.env, p), provisional), name: p.name, status: p.status })));
    return c.json({
      licence_uid: licence.uid,
      snapshot: { uid: snap.uid, latest, created_at: snap.created_at, basis: snap.basis, components: snap.components, pricing_model_version: snap.pricing_model_version, currency: snap.currency },
      country_index_ppm: idx.ppm, index_reason: idx.reason, model_version: idx.model_version,
      packages,
    });
  } catch (e) { return answer(c, e); }
});

packagePricing.post('/:uid/package-pricing/recommendations', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await licenceOf(c);
    if (!licence) return noLicence(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const key = typeof body?.package_key === 'string' ? body.package_key : '';
    if (!isPackageKey(key)) return refuse(c, 400, { code: 'invalid_package_key', message: 'package_key is a package key.' });
    const version = versionOf(body?.version);
    if (version === 'bad') return refuse(c, 400, { code: 'invalid_version', message: 'version must be a positive integer.' });
    const snapRaw = body?.licence_snapshot_uid;
    if (snapRaw !== undefined && snapRaw !== null && !(typeof snapRaw === 'string' && SNAP.test(snapRaw))) {
      return refuse(c, 400, { code: 'invalid_snapshot', message: 'licence_snapshot_uid is a country recommendation id.' });
    }
    let reason: string | null = null;
    if (body?.snapshot_reason !== undefined && body?.snapshot_reason !== null) {
      const r = typeof body.snapshot_reason === 'string' ? body.snapshot_reason.trim() : '';
      if (r.length < 3 || r.length > 500) return refuse(c, 400, { code: 'snapshot_reason_invalid', message: 'Say why, in 3 to 500 characters.' });
      reason = r;
    }
    const pkg = version === null ? await activePackageDetail(c.env, key) : await versionDetail(c.env, key, version);
    if (pkg.status === 'draft') {
      return refuse(c, 409, { code: 'package_not_published', message: 'This package version is still a draft and can change. Publish it before pricing it for a licence.' });
    }
    const out = await createRecommendation(c.env, {
      licenceUid: licence.uid, pkg, snapshotUid: typeof snapRaw === 'string' ? snapRaw : null, snapshotReason: reason, actor: `user:${admin.id}`,
    });
    if (out.created) {
      const r = out.recommendation;
      await logAdminAction(c.env, admin.id, admin.email || '', 'package_pricing_recommended', {
        licence_uid: licence.uid, package_key: r.package_key, package_version: r.package_version, licence_snapshot_uid: r.licence_snapshot_uid,
        snapshot_is_latest: r.snapshot_is_latest, snapshot_reason: r.snapshot_reason, recommended_annual_fee_cents: r.recommended_annual_fee_cents,
        currency: r.currency,
      });
    }
    return c.json({ recommendation: out.recommendation, created: out.created }, out.created ? 201 : 200);
  } catch (e) { return answer(c, e); }
});

packagePricing.get('/:uid/package-pricing/recommendations', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c);
    if (!licence) return noLicence(c);
    const key = c.req.query('package') || null;
    if (key && !isPackageKey(key)) return refuse(c, 400, { code: 'invalid_package_key', message: 'package is a package key.' });
    const rows = await recommendationsFor(c.env, licence.uid, key);
    return c.json({ recommendations: rows, total: rows.length });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see this path first.
  { path: '/api/admin/licences', router: packagePricing, before: [adminLicences] },
];

export default packagePricing;
