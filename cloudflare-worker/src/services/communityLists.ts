/**
 * #4717 package 4 — Admin › Community's Jobs and Circles lightboxes (CM4, CM5),
 * searched, filtered, sorted and paged in SQL.
 *
 * WHY. Both lightboxes used to read their whole dataset into the browser
 * (every page of `GET /api/admin/jobs`, all of `GET /api/admin/circles`) and
 * filter there. Opening one cost the whole table however small the page on
 * screen. These reads answer one page and the total that matched, so opening
 * a lightbox transfers 25 rows whatever the dataset's size.
 *
 * THE CONSOLES' OWN READS ARE UNCHANGED: the job board and circles keep
 * `GET /api/admin/jobs` and `GET /api/admin/circles`. These are Community's,
 * mounted beside its overview, and carry only what a lightbox row draws:
 * a posting's title, company, status, place, seniority, dates and application
 * count; a circle's name, type, access, flags and as-entered figures. Never a
 * host, an applicant or a member.
 *
 * Every statement is literal SQL with its values bound; the sort is chosen by
 * a bound key inside `CASE`, never interpolated (`check-sql-prepare`).
 */
import type { Env } from '../types';

export const LIST_PAGE_DEFAULT = 25;
export const LIST_PAGE_MAX = 100;

export const JOB_STATUSES = ['published', 'pending_review', 'draft', 'closed', 'rejected'] as const;
export const JOB_SORTS = ['applications', 'created', 'days_open', 'title'] as const;
export const CIRCLE_TYPES = ['founder', 'investor', 'partner', 'advisor', 'city', 'topic'] as const;
export const CIRCLE_ACCESS = ['public', 'private'] as const;
export const CIRCLE_SORTS = ['name', 'members'] as const;

export class ListQueryRefusal extends Error {
  code: string;
  sentence: string;
  constructor(code: string, sentence: string) { super(sentence); this.code = code; this.sentence = sentence; }
}

type Get = (key: string) => string | undefined;

const text = (v: string | undefined, max = 80) => String(v ?? '').trim().slice(0, max);

function oneOf<T extends string>(get: Get, key: string, allowed: readonly T[]): T | '' {
  const v = text(get(key), 40).toLowerCase();
  if (!v) return '';
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ListQueryRefusal(`bad_${key}`, `${key} must be one of ${allowed.join(', ')}.`);
  }
  return v as T;
}

function yesNo(get: Get, key: string): '' | 'yes' | 'no' {
  return oneOf(get, key, ['yes', 'no'] as const);
}

function paging(get: Get) {
  const lim = Math.floor(Number(get('limit')));
  const off = Math.floor(Number(get('offset')));
  return {
    limit: Number.isFinite(lim) && lim > 0 ? Math.min(LIST_PAGE_MAX, lim) : LIST_PAGE_DEFAULT,
    offset: Number.isFinite(off) && off > 0 ? off : 0,
  };
}

/** `%`, `_` and `\` are LIKE's own; a search for "C_level" means the underscore. */
const likeOf = (q: string) => (q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : '');

/* ------------------------------------------------------------------ *
 * CM4 · Job postings
 * ------------------------------------------------------------------ */

export type JobsQuery = {
  q: string; status: string; place: '' | 'remote' | 'onsite'; seniority: string;
  sort: (typeof JOB_SORTS)[number]; limit: number; offset: number;
};

export function parseJobsQuery(get: Get): JobsQuery {
  const sort = oneOf(get, 'sort', JOB_SORTS) || 'applications';
  const seniority = text(get('seniority'), 40).toLowerCase();
  if (seniority && !/^[a-z_]{1,40}$/.test(seniority)) throw new ListQueryRefusal('bad_seniority', 'seniority is not a level.');
  return {
    q: text(get('q')),
    status: oneOf(get, 'status', JOB_STATUSES),
    place: oneOf(get, 'place', ['remote', 'onsite'] as const),
    seniority,
    sort,
    ...paging(get),
  };
}

/**
 * One page of postings and the total that matched. Sorts, each ending on the
 * id so a page boundary is stable:
 *   - applications  most first, then by role;
 *   - created       newest first;
 *   - days_open     longest open first (the oldest `published_at` of a
 *                   published posting); a posting not open, or approved before
 *                   migration 609, sorts last (D1121);
 *   - title         by role.
 */
export async function listCommunityJobs(env: Env, q: JobsQuery) {
  const like = likeOf(q.q);
  const remote = q.place === 'remote' ? 1 : q.place === 'onsite' ? 0 : -1;
  const filter = [q.status, q.status, remote, remote, q.seniority, q.seniority, like, like, like];
  const rows = await env.DB.prepare(
    `SELECT j.id AS id, j.title AS title, p.name AS project_name, j.status AS status, j.remote AS remote,
            j.seniority AS seniority, j.created_at AS created_at, j.published_at AS published_at,
            (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = j.id) AS application_count
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE (? = '' OR j.status = ?)
        AND (? = -1 OR COALESCE(j.remote, 0) = ?)
        AND (? = '' OR j.seniority = ?)
        AND (? = '' OR j.title LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')
      ORDER BY
        CASE WHEN ? = 'applications' THEN application_count END DESC,
        CASE WHEN ? = 'created' THEN datetime(j.created_at) END DESC,
        CASE WHEN ? = 'days_open' THEN (CASE WHEN j.status = 'published' AND j.published_at IS NOT NULL THEN 0 ELSE 1 END) END,
        CASE WHEN ? = 'days_open' THEN datetime(j.published_at) END ASC,
        lower(j.title), j.id
      LIMIT ? OFFSET ?`,
  ).bind(...filter, q.sort, q.sort, q.sort, q.sort, q.limit, q.offset).all<Record<string, unknown>>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE (? = '' OR j.status = ?)
        AND (? = -1 OR COALESCE(j.remote, 0) = ?)
        AND (? = '' OR j.seniority = ?)
        AND (? = '' OR j.title LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')`,
  ).bind(...filter).first<{ n: number }>();
  return {
    rows: (rows.results || []).map((r) => ({
      id: Number(r.id),
      title: String(r.title ?? ''),
      project_name: r.project_name == null ? null : String(r.project_name),
      status: String(r.status ?? ''),
      remote: Number(r.remote) === 1,
      seniority: r.seniority == null ? null : String(r.seniority),
      created_at: r.created_at == null ? null : String(r.created_at),
      published_at: r.published_at == null ? null : String(r.published_at),
      application_count: Number(r.application_count) || 0,
    })),
    total: Number(total?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
  };
}

/* ------------------------------------------------------------------ *
 * CM5 · Circles
 * ------------------------------------------------------------------ */

export type CirclesQuery = {
  q: string; type: string; access: string; published: '' | 'yes' | 'no'; featured: '' | 'yes' | 'no';
  sort: (typeof CIRCLE_SORTS)[number]; limit: number; offset: number;
};

export function parseCirclesQuery(get: Get): CirclesQuery {
  return {
    q: text(get('q')),
    type: oneOf(get, 'type', CIRCLE_TYPES),
    access: oneOf(get, 'access', CIRCLE_ACCESS),
    published: yesNo(get, 'published'),
    featured: yesNo(get, 'featured'),
    sort: oneOf(get, 'sort', CIRCLE_SORTS) || 'name',
    ...paging(get),
  };
}

/** One page of circles and the total that matched: by name, or by members as an admin entered them, most first. */
export async function listCommunityCircles(env: Env, q: CirclesQuery) {
  const like = likeOf(q.q);
  const pub = q.published === 'yes' ? 1 : q.published === 'no' ? 0 : -1;
  const feat = q.featured === 'yes' ? 1 : q.featured === 'no' ? 0 : -1;
  const filter = [q.type, q.type, q.access, q.access, pub, pub, feat, feat, like, like];
  const rows = await env.DB.prepare(
    `SELECT id, name, type, access, published, featured, members, activity
       FROM circles
      WHERE (? = '' OR type = ?)
        AND (? = '' OR access = ?)
        AND (? = -1 OR COALESCE(published, 0) = ?)
        AND (? = -1 OR COALESCE(featured, 0) = ?)
        AND (? = '' OR name LIKE ? ESCAPE '\\')
      ORDER BY
        CASE WHEN ? = 'members' THEN COALESCE(members, 0) END DESC,
        lower(name), id
      LIMIT ? OFFSET ?`,
  ).bind(...filter, q.sort, q.limit, q.offset).all<Record<string, unknown>>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM circles
      WHERE (? = '' OR type = ?)
        AND (? = '' OR access = ?)
        AND (? = -1 OR COALESCE(published, 0) = ?)
        AND (? = -1 OR COALESCE(featured, 0) = ?)
        AND (? = '' OR name LIKE ? ESCAPE '\\')`,
  ).bind(...filter).first<{ n: number }>();
  return {
    rows: (rows.results || []).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      type: r.type == null ? null : String(r.type),
      access: r.access == null ? null : String(r.access),
      published: Number(r.published) === 1,
      featured: Number(r.featured) === 1,
      members: r.members == null ? null : Number(r.members),
      activity: r.activity == null ? null : String(r.activity),
    })),
    total: Number(total?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
  };
}
