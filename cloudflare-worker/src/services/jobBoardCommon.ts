/**
 * Task #68 — Public Job Board: shared taxonomy + slug + serialization helpers.
 *
 * shapeJobPosting NEVER includes applicant data — applicant PII (email, links,
 * resume) is only ever returned by the founder/admin-gated applicants
 * endpoints via shapeJobApplication. Keep this invariant.
 */
import type { Env } from '../types';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'intern', 'contract'] as const;
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
 * Founder/admin-only application projection. Includes applicant PII + a
 * `has_resume` flag (the resume itself is fetched via a separate signed
 * one-time download endpoint, never inlined here). `member_profile` fields are
 * populated by a LEFT JOIN on users so a since-registered applicant surfaces
 * their platform account.
 */
export function shapeJobApplication(row: any) {
  if (!row) return null;
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
    // Present only once the applicant has a platform account (LEFT JOIN users).
    member: row.user_id
      ? {
          id: row.member_id ?? row.user_id,
          name: row.member_name ?? null,
          email: row.member_email ?? null,
          role: row.member_role ?? null,
        }
      : null,
  };
}
