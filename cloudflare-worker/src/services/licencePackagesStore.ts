/**
 * D5022 (#5022, part 1 of #5021) — the versioned package catalogue: `program_packages` and
 * `program_package_items` (migration 202611091023). Reads for HQ, plus the package-version lifecycle:
 * draft → active → retired.
 *
 * A COMMERCIAL CATALOGUE, NOT A LICENCE RECORD. Nothing here is accepted by, or billed to, a licence. #5024
 * builds the package OFFER and ACCEPTANCE that would read a version from here and freeze it on a licence;
 * until then this store only defines what a package version IS.
 *
 * IMMUTABILITY. A draft version may be edited, its composition included — add, remove or reorder items
 * freely. Publishing it (draft → active) freezes it: the migration's triggers refuse any later change to its
 * commercial fields or to its `program_package_items` rows, on `program_packages` itself and read through to
 * its items, so a version named on a frozen record (an offer, an agreement, D5048's `package_version`) can
 * always be read back exactly as it was offered. A change to the package is the NEXT version, never an edit
 * of this one. Publishing a draft retires the key's current active version in the same batch, so there is
 * never a moment with two active versions of one package key (the partial unique index refuses it) or with
 * none caused by a failed write.
 *
 * KEYS, NEVER LABELS. `package_key` and each item's `program_key` are the stable join keys the issue
 * requires; a version's `name` is display text and may change version to version (`core_network`'s v2 could
 * rename "Core Network" without the key moving). `program_key` is validated against the live registry
 * (`services/programRegistry.ts`) at write time, so a typo is refused before it is frozen, never after.
 */
import type { Env } from '../types';
import { isRegistryKey } from './programRegistry';

export const PACKAGE_STATUSES = ['draft', 'active', 'retired'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

/** A refusal with a status and a stable code, for the routes to answer with. */
export class PackageError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  /** The sentence for the person, which this module wrote; never SQLite or provider text. */
  readonly sentence: string;
  constructor(status: 400 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.sentence = sentence;
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type PackageItem = {
  program_key: string;
  included_by_default: boolean;
  position: number;
  metadata: Record<string, unknown> | null;
};

export type ProgramPackage = {
  uid: string;
  package_key: string;
  version: number;
  name: string;
  description: string | null;
  status: PackageStatus;
  currency: string;
  base_annual_fee_cents: number;
  guidance_min_cents: number | null;
  guidance_max_cents: number | null;
  floor_multiplier_ppm: number | null;
  ceiling_multiplier_ppm: number | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  created_by: string | null;
};

export type ProgramPackageWithItems = ProgramPackage & { items: PackageItem[] };

const PACKAGE_COLUMNS = `uid, package_key, version, name, description, status, currency, base_annual_fee_cents,
  guidance_min_cents, guidance_max_cents, floor_multiplier_ppm, ceiling_multiplier_ppm,
  effective_from, effective_to, created_at, created_by`;

function packageOf(r: Record<string, unknown>): ProgramPackage {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    uid: String(r.uid), package_key: String(r.package_key), version: Number(r.version),
    name: String(r.name), description: (r.description as string | null) ?? null, status: r.status as PackageStatus,
    currency: String(r.currency), base_annual_fee_cents: Number(r.base_annual_fee_cents),
    guidance_min_cents: n(r.guidance_min_cents), guidance_max_cents: n(r.guidance_max_cents),
    floor_multiplier_ppm: n(r.floor_multiplier_ppm), ceiling_multiplier_ppm: n(r.ceiling_multiplier_ppm),
    effective_from: String(r.effective_from), effective_to: (r.effective_to as string | null) ?? null,
    created_at: String(r.created_at), created_by: (r.created_by as string | null) ?? null,
  };
}

function itemOf(r: Record<string, unknown>): PackageItem {
  let metadata: Record<string, unknown> | null = null;
  if (typeof r.metadata_json === 'string') {
    try { const v = JSON.parse(r.metadata_json); if (v && typeof v === 'object' && !Array.isArray(v)) metadata = v; } catch { metadata = null; }
  }
  return {
    program_key: String(r.program_key), included_by_default: Number(r.included_by_default) === 1,
    position: Number(r.position), metadata,
  };
}

async function itemsOf(env: Env, packageUid: string): Promise<PackageItem[]> {
  const r = await env.DB.prepare(
    'SELECT program_key, included_by_default, position, metadata_json FROM program_package_items WHERE package_uid = ? ORDER BY position, program_key',
  ).bind(packageUid).all<Record<string, unknown>>();
  return (r.results || []).map(itemOf);
}

async function withItems(env: Env, row: Record<string, unknown>): Promise<ProgramPackageWithItems> {
  const p = packageOf(row);
  return { ...p, items: await itemsOf(env, p.uid) };
}

/** Active versions, one per package key — or, with `all`, every version of every key, newest first within each key. */
export async function listPackages(env: Env, opts: { all?: boolean } = {}): Promise<ProgramPackage[]> {
  const sql = opts.all
    ? `SELECT ${PACKAGE_COLUMNS} FROM program_packages ORDER BY package_key, version DESC`
    : `SELECT ${PACKAGE_COLUMNS} FROM program_packages WHERE status = 'active' ORDER BY package_key`;
  const r = await env.DB.prepare(sql).all<Record<string, unknown>>();
  return (r.results || []).map(packageOf);
}

/** The package key's active version with its items; 404 when the key is unknown or holds no active version. */
export async function activePackageDetail(env: Env, packageKey: string): Promise<ProgramPackageWithItems> {
  const row = await env.DB.prepare(`SELECT ${PACKAGE_COLUMNS} FROM program_packages WHERE package_key = ? AND status = 'active'`)
    .bind(packageKey).first<Record<string, unknown>>();
  if (!row) throw new PackageError(404, 'not_found', `No package with the key ${packageKey} has an active version.`);
  return withItems(env, row);
}

/** Every version of one package key, newest first; no items (composition is read per version). */
export async function listVersions(env: Env, packageKey: string): Promise<ProgramPackage[]> {
  const r = await env.DB.prepare(`SELECT ${PACKAGE_COLUMNS} FROM program_packages WHERE package_key = ? ORDER BY version DESC`)
    .bind(packageKey).all<Record<string, unknown>>();
  if (!r.results?.length) throw new PackageError(404, 'not_found', `No package has the key ${packageKey}.`);
  return r.results.map(packageOf);
}

/** One version of a package key, with its items; 404 when the key or version is unknown. */
export async function versionDetail(env: Env, packageKey: string, version: number): Promise<ProgramPackageWithItems> {
  const row = await env.DB.prepare(`SELECT ${PACKAGE_COLUMNS} FROM program_packages WHERE package_key = ? AND version = ?`)
    .bind(packageKey, version).first<Record<string, unknown>>();
  if (!row) throw new PackageError(404, 'not_found', `No version ${version} of ${packageKey}.`);
  return withItems(env, row);
}

/** Today's date, never before `effectiveFrom`: a version retired the same day it was published, or retired
 * before a future-dated effective_from ever arrived, must still satisfy `effective_to >= effective_from`. */
function effectiveToOf(effectiveFrom: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return today < effectiveFrom ? effectiveFrom : today;
}

async function byUidOrThrow(env: Env, uid: string): Promise<ProgramPackage> {
  const row = await env.DB.prepare(`SELECT ${PACKAGE_COLUMNS} FROM program_packages WHERE uid = ?`).bind(uid).first<Record<string, unknown>>();
  if (!row) throw new PackageError(404, 'not_found', 'No package version with that id.');
  return packageOf(row);
}

// ── Input ─────────────────────────────────────────────────────────────────

const PACKAGE_KEY_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const PACKAGE_KEY_MAX = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEMS_MAX = 50;

export type ItemInput = { program_key: string; included_by_default: boolean; metadata: Record<string, unknown> | null };
export type PackageInput = {
  name: string;
  description: string | null;
  currency: string;
  base_annual_fee_cents: number;
  guidance_min_cents: number | null;
  guidance_max_cents: number | null;
  floor_multiplier_ppm: number | null;
  ceiling_multiplier_ppm: number | null;
  effective_from: string;
  effective_to: string | null;
  items: ItemInput[];
};

export const isPackageKey = (v: unknown): v is string => typeof v === 'string' && v.length <= PACKAGE_KEY_MAX && PACKAGE_KEY_RE.test(v);

function nonNegInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * A package version's body, validated whole: money is a non-negative integer of minor units, dates are
 * YYYY-MM-DD, and every item names a registry program key once. Returns the problems keyed by field, never
 * only the first one. `program_key` existing in the live registry is checked separately (`checkProgramKeys`),
 * since it needs a database read this function does not take.
 */
export function validatePackageInput(body: unknown): { ok: true; value: PackageInput } | { ok: false; errors: Record<string, string> } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 200) errors.name = 'name is required, at most 200 characters';
  out.name = name;

  out.description = typeof b.description === 'string' && b.description.trim() ? b.description.trim().slice(0, 2000) : null;

  const currency = typeof b.currency === 'string' && b.currency.trim() ? b.currency.trim().toUpperCase() : 'EUR';
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'currency must be an ISO 4217 code';
  out.currency = currency;

  const fee = nonNegInt(b.base_annual_fee_cents);
  if (fee === null) errors.base_annual_fee_cents = 'base_annual_fee_cents must be a non-negative integer';
  out.base_annual_fee_cents = fee;

  for (const f of ['guidance_min_cents', 'guidance_max_cents', 'floor_multiplier_ppm', 'ceiling_multiplier_ppm'] as const) {
    const v = b[f];
    if (v === undefined || v === null) { out[f] = null; continue; }
    const n = nonNegInt(v);
    if (n === null) { errors[f] = `${f} must be a non-negative integer, or null`; continue; }
    out[f] = n;
  }
  if (typeof out.guidance_min_cents === 'number' && typeof out.guidance_max_cents === 'number' && out.guidance_max_cents < out.guidance_min_cents) {
    errors.guidance_max_cents = 'guidance_max_cents must be at least guidance_min_cents';
  }
  if (typeof out.floor_multiplier_ppm === 'number' && typeof out.ceiling_multiplier_ppm === 'number' && out.ceiling_multiplier_ppm < out.floor_multiplier_ppm) {
    errors.ceiling_multiplier_ppm = 'ceiling_multiplier_ppm must be at least floor_multiplier_ppm';
  }

  const eff = typeof b.effective_from === 'string' ? b.effective_from.trim() : '';
  if (!DATE.test(eff) || Number.isNaN(Date.parse(`${eff}T00:00:00Z`))) errors.effective_from = 'effective_from must be a YYYY-MM-DD date';
  out.effective_from = eff;

  if (b.effective_to === undefined || b.effective_to === null) {
    out.effective_to = null;
  } else if (typeof b.effective_to !== 'string' || !DATE.test(b.effective_to.trim()) || Number.isNaN(Date.parse(`${b.effective_to.trim()}T00:00:00Z`))) {
    errors.effective_to = 'effective_to must be a YYYY-MM-DD date, or null';
    out.effective_to = null;
  } else {
    const to = b.effective_to.trim();
    out.effective_to = to;
    if (DATE.test(eff) && to < eff) errors.effective_to = 'effective_to cannot be before effective_from';
  }

  const rawItems = Array.isArray(b.items) ? b.items : null;
  if (!rawItems || !rawItems.length || rawItems.length > ITEMS_MAX) {
    errors.items = `items is a list of 1 to ${ITEMS_MAX} programs`;
    out.items = [];
  } else {
    const items: ItemInput[] = [];
    const seen = new Set<string>();
    const bad: string[] = [];
    let dup: string | null = null;
    for (const raw of rawItems) {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const key = typeof r.program_key === 'string' ? r.program_key.trim() : '';
      if (!isRegistryKey(key)) { bad.push(String(r.program_key)); continue; }
      if (seen.has(key)) { dup = key; continue; }
      seen.add(key);
      const meta = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata as Record<string, unknown> : null;
      items.push({ program_key: key, included_by_default: r.included_by_default !== false, metadata: meta });
    }
    if (bad.length) errors.items = `not a program key: ${bad.join(', ')}`;
    else if (dup) errors.items = `${dup} is listed more than once`;
    out.items = items;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out as unknown as PackageInput };
}

/** Every item's `program_key` must name a program the registry actually holds. Returns the unknown ones, if any. */
export async function unknownProgramKeys(env: Env, items: ItemInput[]): Promise<string[]> {
  if (!items.length) return [];
  const keys = items.map((i) => i.program_key);
  const r = await env.DB.prepare(`SELECT key FROM programs WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string }>();
  const known = new Set((r.results || []).map((x) => x.key));
  return keys.filter((k) => !known.has(k));
}

function itemStatements(env: Env, packageUid: string, items: ItemInput[]) {
  return items.map((it, i) => env.DB.prepare(
    `INSERT INTO program_package_items (package_uid, program_key, included_by_default, position, metadata_json) VALUES (?, ?, ?, ?, ?)`,
  ).bind(packageUid, it.program_key, it.included_by_default ? 1 : 0, i + 1, it.metadata ? JSON.stringify(it.metadata) : null));
}

/** Creates a brand-new package key as its DRAFT v1. 409 `package_key_taken` if the key already exists (any version). */
export async function createPackage(env: Env, packageKey: string, input: PackageInput, actor: string | null): Promise<ProgramPackageWithItems> {
  const existing = await env.DB.prepare('SELECT 1 AS n FROM program_packages WHERE package_key = ? LIMIT 1').bind(packageKey).first<{ n: number }>();
  if (existing) throw new PackageError(409, 'package_key_taken', `A package with the key ${packageKey} already exists.`);
  const uid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO program_packages (uid, package_key, version, name, description, status, currency, base_annual_fee_cents,
         guidance_min_cents, guidance_max_cents, floor_multiplier_ppm, ceiling_multiplier_ppm, effective_from, effective_to,
         created_at, created_by)
       VALUES (?, ?, 1, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, packageKey, input.name, input.description, input.currency, input.base_annual_fee_cents,
      input.guidance_min_cents, input.guidance_max_cents, input.floor_multiplier_ppm, input.ceiling_multiplier_ppm,
      input.effective_from, input.effective_to, new Date().toISOString(), actor),
    ...itemStatements(env, uid, input.items),
  ]);
  return (await versionDetail(env, packageKey, 1));
}

/** Drafts the next version of an existing package key. 404 if the key does not exist. */
export async function draftNextVersion(env: Env, packageKey: string, input: PackageInput, actor: string | null): Promise<ProgramPackageWithItems> {
  const latest = await env.DB.prepare('SELECT MAX(version) AS v FROM program_packages WHERE package_key = ?').bind(packageKey).first<{ v: number | null }>();
  if (!latest?.v) throw new PackageError(404, 'not_found', `No package has the key ${packageKey}.`);
  const next = Number(latest.v) + 1;
  const uid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO program_packages (uid, package_key, version, name, description, status, currency, base_annual_fee_cents,
         guidance_min_cents, guidance_max_cents, floor_multiplier_ppm, ceiling_multiplier_ppm, effective_from, effective_to,
         created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, packageKey, next, input.name, input.description, input.currency, input.base_annual_fee_cents,
      input.guidance_min_cents, input.guidance_max_cents, input.floor_multiplier_ppm, input.ceiling_multiplier_ppm,
      input.effective_from, input.effective_to, new Date().toISOString(), actor),
    ...itemStatements(env, uid, input.items),
  ]);
  return versionDetail(env, packageKey, next);
}

/** Edits a DRAFT version's fields and replaces its composition. An active or retired version is refused here, before the triggers would refuse it too. */
export async function updateDraftVersion(env: Env, packageKey: string, version: number, input: PackageInput): Promise<ProgramPackageWithItems> {
  const before = await env.DB.prepare('SELECT uid, status FROM program_packages WHERE package_key = ? AND version = ?')
    .bind(packageKey, version).first<{ uid: string; status: PackageStatus }>();
  if (!before) throw new PackageError(404, 'not_found', `No version ${version} of ${packageKey}.`);
  if (before.status !== 'draft') {
    throw new PackageError(409, 'package_version_immutable', `${packageKey} v${version} is ${before.status}; publish a new version instead of editing it.`);
  }
  const res = await env.DB.prepare(
    `UPDATE program_packages SET name = ?, description = ?, currency = ?, base_annual_fee_cents = ?, guidance_min_cents = ?,
       guidance_max_cents = ?, floor_multiplier_ppm = ?, ceiling_multiplier_ppm = ?, effective_from = ?, effective_to = ?
     WHERE uid = ? AND status = 'draft'`,
  ).bind(input.name, input.description, input.currency, input.base_annual_fee_cents, input.guidance_min_cents,
    input.guidance_max_cents, input.floor_multiplier_ppm, input.ceiling_multiplier_ppm, input.effective_from, input.effective_to,
    before.uid).run();
  if (!res.meta?.changes) throw new PackageError(409, 'package_version_immutable', `${packageKey} v${version} was published while you edited it; publish a new version.`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM program_package_items WHERE package_uid = ?').bind(before.uid),
    ...itemStatements(env, before.uid, input.items),
  ]);
  return versionDetail(env, packageKey, version);
}

/**
 * Publishes a draft: it becomes ACTIVE, and the key's current active version (if any) is retired, in one
 * batch. The retire is conditioned on the draft still being a draft, so a draft already published (or
 * deleted) by another request leaves the current active version alone.
 */
export async function publishVersion(env: Env, packageKey: string, version: number, actor: string): Promise<{ package: ProgramPackageWithItems; retired_version: number | null }> {
  const before = await env.DB.prepare('SELECT uid, status FROM program_packages WHERE package_key = ? AND version = ?')
    .bind(packageKey, version).first<{ uid: string; status: PackageStatus }>();
  if (!before) throw new PackageError(404, 'not_found', `No version ${version} of ${packageKey}.`);
  if (before.status !== 'draft') throw new PackageError(409, 'not_draft', `${packageKey} v${version} is already ${before.status}.`);
  if (!(await itemsOf(env, before.uid)).length) throw new PackageError(409, 'no_items', `${packageKey} v${version} has no programs; add at least one before publishing.`);
  const previouslyActive = await env.DB.prepare("SELECT version, effective_from FROM program_packages WHERE package_key = ? AND status = 'active'")
    .bind(packageKey).first<{ version: number; effective_from: string }>();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE program_packages SET status = 'retired', effective_to = ?
        WHERE package_key = ? AND status = 'active' AND EXISTS (SELECT 1 FROM program_packages d WHERE d.uid = ? AND d.status = 'draft')`,
    ).bind(previouslyActive ? effectiveToOf(previouslyActive.effective_from) : null, packageKey, before.uid),
    env.DB.prepare(`UPDATE program_packages SET status = 'active' WHERE uid = ? AND status = 'draft'`).bind(before.uid),
  ]);
  if (!results[1]?.meta?.changes) throw new PackageError(409, 'not_draft', `${packageKey} v${version} is no longer a draft.`);
  return { package: await versionDetail(env, packageKey, version), retired_version: results[0]?.meta?.changes ? previouslyActive?.version ?? null : null };
}

/** Retires the active version without a successor: the package key then has no active version. */
export async function retireVersion(env: Env, packageKey: string, version: number): Promise<ProgramPackage> {
  const before = await env.DB.prepare('SELECT uid, status, effective_from FROM program_packages WHERE package_key = ? AND version = ?')
    .bind(packageKey, version).first<{ uid: string; status: PackageStatus; effective_from: string }>();
  if (!before) throw new PackageError(404, 'not_found', `No version ${version} of ${packageKey}.`);
  if (before.status !== 'active') throw new PackageError(409, 'not_active', `${packageKey} v${version} is ${before.status}, not active.`);
  const res = await env.DB.prepare(`UPDATE program_packages SET status = 'retired', effective_to = ? WHERE uid = ? AND status = 'active'`)
    .bind(effectiveToOf(before.effective_from), before.uid).run();
  if (!res.meta?.changes) throw new PackageError(409, 'not_active', `${packageKey} v${version} is no longer active.`);
  return byUidOrThrow(env, before.uid);
}

/** Deletes a DRAFT version (its items with it). Active and retired versions are history and are never deleted. */
export async function deleteDraftVersion(env: Env, packageKey: string, version: number): Promise<void> {
  const before = await env.DB.prepare('SELECT uid, status FROM program_packages WHERE package_key = ? AND version = ?')
    .bind(packageKey, version).first<{ uid: string; status: PackageStatus }>();
  if (!before) throw new PackageError(404, 'not_found', `No version ${version} of ${packageKey}.`);
  if (before.status !== 'draft') throw new PackageError(409, 'package_version_immutable', `${packageKey} v${version} is ${before.status} and is kept.`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM program_package_items WHERE package_uid = ?').bind(before.uid),
    env.DB.prepare(`DELETE FROM program_packages WHERE uid = ? AND status = 'draft'`).bind(before.uid),
  ]);
}
