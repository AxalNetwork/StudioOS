/**
 * Task #68 — Public Job Board: shared taxonomy + slug + serialization helpers.
 *
 * shapeJobPosting NEVER includes applicant data — applicant PII (email, links,
 * resume) is only ever returned by the founder/admin-gated applicants
 * endpoints via shapeJobApplication. Keep this invariant.
 */
import type { Env, User } from '../types';

// D691 (#1697): Fractional is last, so every list the board draws keeps its order.
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'intern', 'contract', 'fractional'] as const;
export const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'] as const;

// Lifecycle: draft → pending_review → published (admin_published=1) | rejected;
// a published/pending role can be closed by the founder.
export const JOB_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'closed'] as const;

export function jobSlugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || `role-${crypto.randomUUID().slice(0, 8)}`;
}

/** Slugify `title`, then append -2/-3/… until unique among job_postings. */
export async function ensureUniqueJobSlug(
  env: Env,
  title: string,
  excludeId?: number,
): Promise<string> {
  const base = jobSlugify(title);
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const row: any = await env.DB.prepare(
      `SELECT id FROM job_postings WHERE slug = ? ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`,
    ).bind(...(excludeId ? [candidate, excludeId] : [candidate])).first();
    if (!row) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/** A posting is managed by its host or an admin: publishing and closing never widen past that. */
export function canManagePosting(posting: { host_user_id?: unknown } | null | undefined, user: User): boolean {
  return !!posting && (user.role === 'admin' || Number(posting.host_user_id) === Number(user.id));
}

export type PostingFields = {
  title: string;
  employment_type?: unknown;
  location_text?: string | null;
  remote?: boolean;
  seniority?: unknown;
  summary?: string | null;
  description?: string | null;
  team?: string | null;
  target_start?: string | null;
  comp_min_cents?: number | null;
  comp_max_cents?: number | null;
  comp_currency?: string | null;
  equity_pct?: number | null;
  comp_public?: 0 | 1;
};

/**
 * D691 (#1697) — the one insert of a posting, a draft hosted by `hostUserId`.
 * `/api/jobs` and Grow's Open a role both call it; each checks its own project
 * gate first.
 */
export async function createPosting(env: Env, hostUserId: number, projectId: number | null, f: PostingFields): Promise<any> {
  const slug = await ensureUniqueJobSlug(env, f.title);
  const ins: any = await env.DB.prepare(
    `INSERT INTO job_postings
       (slug, host_user_id, project_id, title, employment_type, location_text, remote, seniority, summary, description, status,
        team, target_start, comp_min_cents, comp_max_cents, comp_currency, equity_pct, comp_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    slug, hostUserId, projectId, f.title, normalizeEmploymentType(f.employment_type), f.location_text ?? null, f.remote ? 1 : 0,
    normalizeSeniority(f.seniority), f.summary ?? null, f.description ?? null,
    f.team ?? null, f.target_start ?? null, f.comp_min_cents ?? null, f.comp_max_cents ?? null, f.comp_currency ?? null, f.equity_pct ?? null,
    f.comp_public === 1 ? 1 : 0,
  ).run();
  return env.DB.prepare('SELECT * FROM job_postings WHERE id = ?').bind(Number(ins?.meta?.last_row_id)).first();
}

export type PostingOutcome = { ok: true; posting: any } | { ok: false; status: 400 | 403; error: 'forbidden' | 'title_required' };

/** Send a posting to the admin publish queue: every posting is public, so it always enters review. */
export async function submitForReview(env: Env, posting: any, user: User): Promise<PostingOutcome> {
  if (!canManagePosting(posting, user)) return { ok: false, status: 403, error: 'forbidden' };
  if (!String(posting.title || '').trim()) return { ok: false, status: 400, error: 'title_required' };
  await env.DB.prepare(
    `UPDATE job_postings SET status = 'pending_review', review_notes = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(posting.id).run();
  return { ok: true, posting: await env.DB.prepare('SELECT * FROM job_postings WHERE id = ?').bind(posting.id).first() };
}

/** The host or an admin closes a posting. */
export async function closePosting(env: Env, posting: any, user: User): Promise<PostingOutcome> {
  if (!canManagePosting(posting, user)) return { ok: false, status: 403, error: 'forbidden' };
  await env.DB.prepare(
    `UPDATE job_postings SET status = 'closed', admin_published = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(posting.id).run();
  return { ok: true, posting: await env.DB.prepare('SELECT * FROM job_postings WHERE id = ?').bind(posting.id).first() };
}

const TRUTHY = (v: unknown): boolean => v === 1 || v === true || v === '1';

export function normalizeEmploymentType(v: unknown): typeof EMPLOYMENT_TYPES[number] {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(String(v))
    ? (v as typeof EMPLOYMENT_TYPES[number])
    : 'full_time';
}

export function normalizeSeniority(v: unknown): typeof SENIORITIES[number] {
  return (SENIORITIES as readonly string[]).includes(String(v))
    ? (v as typeof SENIORITIES[number])
    : 'mid';
}

/**
 * Applicant-supplied links (LinkedIn / portfolio) are rendered as clickable
 * `href`s in the founder's applicants view, so an unvalidated value like
 * `javascript:…` or `data:…` is a stored link-injection / XSS vector. Accept
 * ONLY absolute http(s) URLs; anything else (bad scheme, unparseable, empty)
 * collapses to null so it is stored/rendered as "no link" rather than a live
 * hostile href. Caps length at 500 to match the column bound.
 */
export function safeHttpUrl(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return s.slice(0, 500);
}

/**
 * Builds the parameterized WHERE fragments + binds for the public job feed.
 * Extracted as a pure helper so the "search by role / startup / city" behavior
 * is unit-testable without a live DB. `q` spans role title/summary, city
 * (location_text) AND startup name (projects.name, aliased `p` in the feed
 * query). Always constrains to the published + admin-approved publish gate.
 * All columns are qualified (`j.`/`p.`) because job_postings and projects both
 * carry a `status` column — an unqualified predicate would be ambiguous.
 */
export function buildPublicJobFeedWhere(filters: {
  employmentType?: string | null;
  seniority?: string | null;
  remote?: string | null;
  q?: string | null;
}): { where: string[]; binds: unknown[] } {
  const where: string[] = [`j.status = 'published'`, 'j.admin_published = 1'];
  const binds: unknown[] = [];
  if (filters.employmentType) { where.push('j.employment_type = ?'); binds.push(filters.employmentType); }
  if (filters.seniority) { where.push('j.seniority = ?'); binds.push(filters.seniority); }
  if (filters.remote === '1') { where.push('j.remote = 1'); }
  if (filters.q) {
    where.push('(j.title LIKE ? OR j.summary LIKE ? OR j.location_text LIKE ? OR p.name LIKE ?)');
    const like = `%${filters.q}%`;
    binds.push(like, like, like, like);
  }
  return { where, binds };
}

/**
 * Public-safe job-posting projection. `includePrivate` adds owner/admin-only
 * operational fields (admin flag, review notes). NEVER includes applicant data.
 */
export function shapeJobPosting(row: any, opts: { includePrivate?: boolean } = {}) {
  if (!row) return null;
  const base: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    host_user_id: row.host_user_id ?? null,
    project_id: row.project_id ?? null,
    project_name: row.project_name ?? null,
    startup_name: row.project_name ?? null,
    title: row.title,
    employment_type: row.employment_type ?? 'full_time',
    location_text: row.location_text ?? null,
    remote: TRUTHY(row.remote),
    seniority: row.seniority ?? 'mid',
    summary: row.summary ?? null,
    description: row.description ?? null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.application_count != null) base.application_count = Number(row.application_count);
  if (opts.includePrivate) {
    base.admin_published = TRUTHY(row.admin_published);
    base.review_notes = row.review_notes ?? null;
  }
  return base;
}

/**
 * #2181 — a published posting's compensation band, for the public board, only
 * when its founder switched it on (`comp_public`, migration 507). Otherwise
 * null, and the caller sends no `compensation` key: a band saved before the
 * switch existed was saved for the record only.
 */
export function publicCompensation(row: any): { min_cents: number | null; max_cents: number | null; currency: string | null; equity_pct: number | null } | null {
  if (!row || Number(row.comp_public) !== 1 || row.status !== 'published' || !TRUTHY(row.admin_published)) return null;
  const min = row.comp_min_cents == null ? null : Number(row.comp_min_cents);
  const max = row.comp_max_cents == null ? null : Number(row.comp_max_cents);
  if (min == null && max == null) return null;
  return { min_cents: min, max_cents: max, currency: row.comp_currency ?? null, equity_pct: row.equity_pct == null ? null : Number(row.equity_pct) };
}

/**
 * Founder/admin-only application projection. Includes applicant PII + a
 * `has_resume` flag (the resume itself is fetched via a separate signed
 * one-time download endpoint, never inlined here). `member_profile` fields are
 * populated by a LEFT JOIN on users so a since-registered applicant surfaces
 * their platform account.
 */
export function shapeJobApplication(row: any) {
  if (!row) return null;
  // A matching platform account is surfaced via the applicants LEFT JOIN on
  // users (by email), so `member` appears as soon as the applicant registers —
  // even before `user_id` has been backfilled onto the application row. Gating
  // on the joined `member_id` (falling back to `user_id`) makes "profile once
  // registered" reliable rather than dependent on a prior backfill pass.
  const memberId = row.member_id ?? row.user_id ?? null;
  return {
    id: row.id,
    posting_id: row.posting_id,
    user_id: row.user_id ?? null,
    name: row.name ?? null,
    email: row.email,
    cover_note: row.cover_note ?? null,
    linkedin_url: row.linkedin_url ?? null,
    portfolio_url: row.portfolio_url ?? null,
    has_resume: !!row.resume_key,
    resume_name: row.resume_name ?? null,
    status: row.status,
    created_at: row.created_at,
    member: memberId
      ? {
          id: memberId,
          name: row.member_name ?? null,
          email: row.member_email ?? null,
          role: row.member_role ?? null,
        }
      : null,
  };
}
