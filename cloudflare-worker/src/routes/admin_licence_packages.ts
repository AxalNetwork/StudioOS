/**
 * D5022 (#5022, part 1 of #5021) — HQ's versioned package catalogue: `program_packages` and
 * `program_package_items` (migration 202611091023, `services/licencePackagesStore.ts`). Mounted at
 * `/api/admin/licence-packages`. Super Admin only, HQ only (`requireSuperAdmin`/`requireSuperAdminWriteBar`
 * already refuse a branch — D106).
 *
 *   GET    /                                       active versions, one per key — or every version with ?all=1
 *   GET    /:packageKey                             the key's active version and its programs           (404 if none active)
 *   GET    /:packageKey/versions                    every version of the key, newest first
 *   GET    /:packageKey/versions/:version            one version and its programs
 *   POST   /                                         a new package key's DRAFT v1, with its programs      (write bar)
 *   POST   /:packageKey/versions                     the key's next DRAFT version, with its programs      (write bar)
 *   PUT    /:packageKey/versions/:version            edit a DRAFT version's fields and composition         (write bar)
 *   POST   /:packageKey/versions/:version/publish    draft → active, retiring the key's active version    (write bar, reason)
 *   POST   /:packageKey/versions/:version/retire     active → retired, without a successor                (write bar, reason)
 *   DELETE /:packageKey/versions/:version            a DRAFT only                                          (write bar, reason)
 *
 * An active or retired version is never edited: its commercial fields and its composition are frozen by the
 * migration's triggers, and this router refuses before reaching them (D5022's acceptance criteria — "Package
 * versions are immutable after activation"). Every write is audited with its actor, time and reason.
 *
 * NO LICENCE READS THIS YET. #5024 is where a licence accepts a version and freezes it; retiring a key here
 * changes no licence, because nothing yet points a licence at one (this file's decision, D5022, says why that
 * is a scoping boundary and not an oversight).
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import {
  PackageError, activePackageDetail, createPackage, deleteDraftVersion, draftNextVersion, isPackageKey, listPackages,
  listVersions, publishVersion, retireVersion, unknownProgramKeys, updateDraftVersion, validatePackageInput, versionDetail,
} from '../services/licencePackagesStore';

type C = Context<{ Bindings: Env }>;
const packages = new Hono<{ Bindings: Env }>();

function answer(c: C, e: unknown) {
  if (e instanceof PackageError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}

const actorOf = (u: { id: number; email?: string | null }) => `user:${u.id}`;

/** A reason a person wrote: 3–500 characters after trimming, or null. */
function reasonOf(body: unknown): string | null {
  const raw = (body as Record<string, unknown> | null)?.reason;
  const r = typeof raw === 'string' ? raw.trim() : '';
  return r.length >= 3 && r.length <= 500 ? r : null;
}
const noReason = (c: C) => refuse(c, 400, { code: 'reason_required', message: 'Say why, in 3 to 500 characters.' });

function versionParam(c: C): number | null {
  const v = Number(c.req.param('version'));
  return Number.isInteger(v) && v >= 1 ? v : null;
}
const badVersion = (c: C) => refuse(c, 400, { code: 'invalid_version', message: 'version must be a positive integer.' });

/** Validates the body and that every item names a program the registry actually holds, in one pass. */
async function validatedInput(c: C, env: Env) {
  const body = await c.req.json().catch(() => null);
  const v = validatePackageInput(body);
  if (!v.ok) return { ok: false as const, response: refuse(c, 400, { code: 'invalid_package', message: 'The package has fields to fix.', extra: { fields: v.errors } }) };
  const unknown = await unknownProgramKeys(env, v.value.items);
  if (unknown.length) {
    return { ok: false as const, response: refuse(c, 400, { code: 'unknown_program_key', message: `No program has the key ${unknown.join(', ')}.`, extra: { program_keys: unknown } }) };
  }
  return { ok: true as const, value: v.value };
}

packages.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const all = c.req.query('all') === '1' || c.req.query('all') === 'true';
    return c.json({ packages: await listPackages(c.env, { all }) });
  } catch (e) { return answer(c, e); }
});

packages.post('/', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const packageKey = typeof body?.package_key === 'string' ? body.package_key.trim() : '';
    if (!isPackageKey(packageKey)) return refuse(c, 400, { code: 'invalid_package_key', message: 'package_key is 1-60 lower-case letters, digits, hyphens or underscores.' });
    const v = validatePackageInput(body);
    if (!v.ok) return refuse(c, 400, { code: 'invalid_package', message: 'The package has fields to fix.', extra: { fields: v.errors } });
    const unknown = await unknownProgramKeys(c.env, v.value.items);
    if (unknown.length) return refuse(c, 400, { code: 'unknown_program_key', message: `No program has the key ${unknown.join(', ')}.`, extra: { program_keys: unknown } });
    const pkg = await createPackage(c.env, packageKey, v.value, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_drafted', { package_key: packageKey, version: 1 });
    return c.json({ package: pkg }, 201);
  } catch (e) { return answer(c, e); }
});

packages.get('/:packageKey', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({ package: await activePackageDetail(c.env, c.req.param('packageKey')) });
  } catch (e) { return answer(c, e); }
});

packages.get('/:packageKey/versions', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({ package_key: c.req.param('packageKey'), versions: await listVersions(c.env, c.req.param('packageKey')) });
  } catch (e) { return answer(c, e); }
});

packages.post('/:packageKey/versions', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const packageKey = c.req.param('packageKey');
    const v = await validatedInput(c, c.env);
    if (!v.ok) return v.response;
    const pkg = await draftNextVersion(c.env, packageKey, v.value, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_drafted', { package_key: packageKey, version: pkg.version });
    return c.json({ package: pkg }, 201);
  } catch (e) { return answer(c, e); }
});

packages.get('/:packageKey/versions/:version', async (c) => {
  try {
    await requireSuperAdmin(c);
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    return c.json({ package: await versionDetail(c.env, c.req.param('packageKey'), version) });
  } catch (e) { return answer(c, e); }
});

packages.put('/:packageKey/versions/:version', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const packageKey = c.req.param('packageKey');
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    const v = await validatedInput(c, c.env);
    if (!v.ok) return v.response;
    const pkg = await updateDraftVersion(c.env, packageKey, version, v.value);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_edited', { package_key: packageKey, version });
    return c.json({ package: pkg });
  } catch (e) { return answer(c, e); }
});

packages.post('/:packageKey/versions/:version/publish', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const packageKey = c.req.param('packageKey');
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    const { package: pkg, retired_version } = await publishVersion(c.env, packageKey, version, actorOf(admin));
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_published', { package_key: packageKey, version, retired_version, reason });
    return c.json({ package: pkg, retired_version });
  } catch (e) { return answer(c, e); }
});

packages.post('/:packageKey/versions/:version/retire', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const packageKey = c.req.param('packageKey');
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    const pkg = await retireVersion(c.env, packageKey, version);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_retired', { package_key: packageKey, version, reason });
    return c.json({ package: pkg });
  } catch (e) { return answer(c, e); }
});

packages.delete('/:packageKey/versions/:version', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const packageKey = c.req.param('packageKey');
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    const reason = reasonOf(await c.req.json().catch(() => null));
    if (!reason) return noReason(c);
    await deleteDraftVersion(c.env, packageKey, version);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_package_draft_deleted', { package_key: packageKey, version, reason });
    return c.json({ ok: true });
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licence-packages', router: packages };

export default packages;
