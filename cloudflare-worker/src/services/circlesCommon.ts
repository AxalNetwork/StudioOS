/**
 * Task #9 — Communities & Circles: shared shaping + validation helpers.
 *
 * `shapeCircle` maps a snake_case D1 row to the camelCase shape the SPA card
 * (frontend/src/pages/CirclesPage.jsx → CircleCard) reads. The controlled
 * vocabularies below mirror frontend/src/data/network.js (CIRCLE_TYPES /
 * ACCESS_TYPES / ACTIVITY_LEVELS) — kept in the service layer rather than a
 * lookup table (same rationale as the signals taxonomy).
 */

export const CIRCLE_TYPES = ['founder', 'investor', 'partner', 'advisor', 'city', 'topic'] as const;
export const ACCESS_TYPES = ['public', 'private'] as const;
export const ACTIVITY_LEVELS = ['active', 'growing', 'quiet', 'new'] as const;

export type CircleType = (typeof CIRCLE_TYPES)[number];
export type CircleAccess = (typeof ACCESS_TYPES)[number];
export type CircleActivity = (typeof ACTIVITY_LEVELS)[number];

function coerceEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function trimStr(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function nonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Normalize a tags input (array OR comma-separated string) to a bounded string[]. */
export function normalizeTags(v: unknown): string[] {
  let raw: unknown[] = [];
  if (Array.isArray(v)) raw = v;
  else if (typeof v === 'string') raw = v.split(',');
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t ?? '').trim().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/** URL-safe slug from a name; falls back to 'circle' when nothing survives. */
export function slugify(name: string): string {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'circle';
}

/** Ensure a slug is unique in the `circles` table (appends -2, -3, … on collision). */
export async function uniqueCircleSlug(
  db: { prepare: (q: string) => any },
  base: string,
  excludeId?: number,
): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 1000; i++) {
    const row: any = await db
      .prepare(`SELECT id FROM circles WHERE slug = ?`)
      .bind(candidate)
      .first();
    if (!row || (excludeId != null && Number(row.id) === excludeId)) return candidate;
    candidate = `${base}-${i}`;
  }
  // Extremely unlikely; append a random suffix as a last resort.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface CircleInput {
  name: string;
  type: CircleType;
  access: CircleAccess;
  activity: CircleActivity;
  tagline: string | null;
  region: string | null;
  theme: string | null;
  hostedBy: string | null;
  members: number;
  upcomingEvents: number;
  discussions: number;
  sortOrder: number;
  tags: string[];
  featured: 0 | 1;
  published: 0 | 1;
}

/**
 * Validate + normalize a create/update body. Returns { ok:false, error } when a
 * required field is missing so the route can 400 with an explicit message
 * (security-first: no silent fallback for a missing name).
 */
export function parseCircleBody(
  body: Record<string, unknown>,
): { ok: true; value: CircleInput } | { ok: false; error: string } {
  const name = trimStr(body.name, 200);
  if (!name) return { ok: false, error: 'name_required' };
  return {
    ok: true,
    value: {
      name,
      type: coerceEnum(body.type, CIRCLE_TYPES, 'founder'),
      access: coerceEnum(body.access, ACCESS_TYPES, 'public'),
      activity: coerceEnum(body.activity, ACTIVITY_LEVELS, 'new'),
      tagline: trimStr(body.tagline, 500),
      region: trimStr(body.region, 120),
      theme: trimStr(body.theme, 120),
      hostedBy: trimStr(body.hostedBy ?? body.hosted_by, 160),
      members: nonNegInt(body.members),
      upcomingEvents: nonNegInt(body.upcomingEvents ?? body.upcoming_events),
      discussions: nonNegInt(body.discussions),
      sortOrder: nonNegInt(body.sortOrder ?? body.sort_order),
      tags: normalizeTags(body.tags),
      featured: body.featured ? 1 : 0,
      published: body.published ? 1 : 0,
    },
  };
}

/** Map a D1 row → the camelCase shape the SPA card reads. */
export function shapeCircle(row: any) {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row?.tags ?? '[]');
    if (Array.isArray(parsed)) tags = parsed.map((t: unknown) => String(t));
  } catch {
    tags = [];
  }
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    type: row.type,
    access: row.access,
    tagline: row.tagline ?? null,
    region: row.region ?? null,
    theme: row.theme ?? null,
    members: Number(row.members || 0),
    activity: row.activity || 'new',
    upcomingEvents: Number(row.upcoming_events || 0),
    discussions: Number(row.discussions || 0),
    tags,
    hostedBy: row.hosted_by ?? null,
    featured: !!row.featured,
    published: !!row.published,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}
