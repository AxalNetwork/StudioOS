/**
 * D1415 (#3697) — slugs per scope (migration 685).
 *
 * A company slug is unique among companies; a project slug is unique within
 * its company, or among standalone projects. A slug that was retired stays in
 * `slug_history` and keeps pointing at its target for ever (owner question C,
 * answer a), so nobody else may claim it. Existing rows keep `slug = NULL` and
 * are addressed by uid (company) or id (project).
 */
import type { Env } from '../types';

export const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** Path segments a slug may not take: `settings` is D1140's, the rest are the scopes' own words. */
export const RESERVED_SLUGS = new Set(['settings', 'new', 'c', 'p', 'projects', 'funds', 'engagements', 'invitations']);

export type SlugKind = 'company' | 'project';
export type SlugCheck = { ok: true; slug: string } | { ok: false; status: 400; code: 'slug_invalid' | 'slug_reserved' };

/** Shape and reserved words only; whether it is free is `slugHolder`'s question. */
export function checkSlug(raw: unknown): SlugCheck {
  if (typeof raw !== 'string') return { ok: false, status: 400, code: 'slug_invalid' };
  const slug = raw.trim().toLowerCase();
  if (!SLUG_SHAPE.test(slug)) return { ok: false, status: 400, code: 'slug_invalid' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, status: 400, code: 'slug_reserved' };
  return { ok: true, slug };
}

/**
 * Who holds `slug` in this scope, current or retired: the target's id, or
 * null when it is free. `scopeCompanyId` matters for projects only.
 */
export async function slugHolder(env: Env, kind: SlugKind, slug: string, scopeCompanyId: number | null = null): Promise<number | null> {
  let current: { id: number } | null;
  if (kind === 'company') {
    current = await env.DB.prepare('SELECT id FROM company_profiles WHERE slug = ?').bind(slug).first<{ id: number }>();
  } else if (scopeCompanyId == null) {
    current = await env.DB.prepare('SELECT id FROM projects WHERE company_id IS NULL AND slug = ?').bind(slug).first<{ id: number }>();
  } else {
    current = await env.DB.prepare('SELECT id FROM projects WHERE company_id = ? AND slug = ?').bind(scopeCompanyId, slug).first<{ id: number }>();
  }
  if (current) return Number(current.id);
  const retired = await env.DB.prepare(
    'SELECT target_id FROM slug_history WHERE kind = ? AND ifnull(scope_company_id, 0) = ? AND slug = ?',
  ).bind(kind, kind === 'company' ? 0 : (scopeCompanyId ?? 0), slug).first<{ target_id: number }>();
  return retired ? Number(retired.target_id) : null;
}

/**
 * The statement that retires `slug` for `targetId`. Bound, not run: it goes in
 * the same batch as the rename, so a rename without its history cannot land.
 * Retiring a slug the same target already retired once is a no-op.
 */
export function retireSlug(env: Env, kind: SlugKind, slug: string, targetId: number, scopeCompanyId: number | null, by: number) {
  return env.DB.prepare(
    `INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).bind(kind, kind === 'company' ? null : scopeCompanyId, slug, targetId, by);
}

export const companyPath = (c: { uid: string; slug: string | null }) => `/c/${c.slug ?? c.uid}`;

/**
 * A project's canonical path. `company` is the company it sits in (its slug or
 * uid), or null for a standalone project.
 */
export function projectPath(p: { id: number; slug: string | null }, company: { uid: string; slug: string | null } | null): string {
  const own = p.slug ?? String(p.id);
  return company ? `${companyPath(company)}/p/${own}` : `/p/${own}`;
}

/** A name as a slug: lower case, ASCII letters and digits, single hyphens; '' when nothing is left. */
export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
}

/**
 * A free slug made from `name` in this scope: the slugified name, then `-2`,
 * `-3`… on a clash or a reserved word. Null when the name yields no slug or
 * fifty tries all clash; the row is then addressed by uid or id, as rows from
 * before migration 685 are.
 */
export async function generateSlug(env: Env, kind: SlugKind, name: string, scopeCompanyId: number | null = null): Promise<string | null> {
  const base = slugify(name);
  if (!base) return null;
  for (let n = 1; n <= 50; n += 1) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${base.slice(0, 50 - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!checkSlug(candidate).ok) continue;
    if ((await slugHolder(env, kind, candidate, scopeCompanyId)) == null) return candidate;
  }
  return null;
}

/**
 * D1591 (#3858) — the live check's suggestion for a taken slug: the first of
 * `<base>-2` … `<base>-20` that has a valid shape and is free in this scope,
 * or null. `base` is already a valid slug; for a slug the member typed it
 * gives the same next address `generateSlug` would, without slugifying again.
 */
export async function nextFreeSlug(env: Env, kind: SlugKind, base: string, scopeCompanyId: number | null = null): Promise<string | null> {
  for (let n = 2; n <= 20; n += 1) {
    const candidate = checkSlug(`${base}-${n}`);
    if (!candidate.ok) continue;
    if ((await slugHolder(env, kind, candidate.slug, scopeCompanyId)) == null) return candidate.slug;
  }
  return null;
}
