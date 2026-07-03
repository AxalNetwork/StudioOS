/**
 * Task #68 — Public Job Board: founder (authenticated) routes.
 *
 * Mounted at /api/jobs behind requireAuth. A founder posts roles against a
 * project they can write to (canAccessProject — owner OR accepted co-founder),
 * submits them for admin review, closes them, and reads applicants (the only
 * surface that returns applicant PII). Applicant resumes are fetched via an
 * on-demand, one-time signed download token (services/signedDownload.ts) —
 * never inlined into a list response.
 *
 * Applicant→member linking is done WITHOUT touching auth.ts: an application is
 * matched to a platform user by email (a) at apply-time, (b) here via a LEFT
 * JOIN when a founder reads applicants, and (c) via a best-effort backfill when
 * the applicant reads their OWN applications after registering.
 *
 * NB: unrelated to models/jobs.ts (the async work QUEUE).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { notify } from '../services/notify';
import { ensureJobBoardSchema } from '../services/jobBoardSchema';
import {
  ensureUniqueJobSlug,
  normalizeEmploymentType,
  normalizeSeniority,
  shapeJobApplication,
  shapeJobPosting,
} from '../services/jobBoardCommon';
import { canAccessProject } from '../services/projectAccess';
import { mintDownloadToken } from '../services/signedDownload';

const jobs = new Hono<{ Bindings: Env }>();

async function auth(c: any): Promise<User | Response> {
  try {
    return await requireAuth(c);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

function canManage(posting: any, user: User): boolean {
  return user.role === 'admin' || Number(posting.host_user_id) === Number(user.id);
}

async function loadPosting(env: Env, id: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM job_postings WHERE id = ?`).bind(id).first();
}

function intParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Validate an optional project_id the caller wants to attach a posting to.
// Returns null (allowed) or a Response (400 unknown project / 403 no write).
async function validateProjectId(
  c: any, user: User, projectId: number | null | undefined,
): Promise<null | Response> {
  if (projectId == null) return null;
  const project: any = await c.env.DB.prepare(
    `SELECT id, founder_id FROM projects WHERE id = ?`,
  ).bind(projectId).first();
  if (!project) return c.json({ error: 'invalid_project' }, 400);
  const allowed = await canAccessProject(c.env, user, { id: Number(project.id), founder_id: project.founder_id ?? null }, { write: true });
  if (!allowed) return c.json({ error: 'forbidden' }, 403);
  return null;
}

jobs.use('*', async (c, next) => {
  await ensureJobBoardSchema(c.env);
  await next();
});

// ── GET / — the caller's own postings ──────────────────────────────────────
jobs.get('/', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const rows = await c.env.DB.prepare(
    `SELECT j.*, p.name AS project_name,
            (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = j.id) AS application_count
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE j.host_user_id = ?
      ORDER BY j.created_at DESC`,
  ).bind(u.id).all();
  return c.json({ jobs: (rows.results || []).map((r) => shapeJobPosting(r, { includePrivate: true })) });
});

// ── GET /my-applications — the caller's applications (+ best-effort link) ────
// Registered BEFORE GET /:id so the static segment isn't captured by :id.
jobs.get('/my-applications', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  // Best-effort backfill: attach this member to any anonymous application that
  // used their email (e.g. applied before registering). Never touches auth.ts.
  if (u.email) {
    try {
      await c.env.DB.prepare(
        `UPDATE job_applications SET user_id = ?, updated_at = datetime('now')
          WHERE user_id IS NULL AND lower(email) = lower(?)`,
      ).bind(u.id, u.email).run();
    } catch (e) {
      console.warn('[jobs] my-applications backfill failed:', (e as Error).message);
    }
  }
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.posting_id, a.status, a.created_at,
            j.slug AS job_slug, j.title AS job_title, j.status AS job_status,
            p.name AS project_name
       FROM job_applications a
       JOIN job_postings j ON j.id = a.posting_id
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE a.user_id = ? OR lower(a.email) = lower(?)
      ORDER BY a.created_at DESC`,
  ).bind(u.id, u.email || '').all();
  return c.json({
    applications: (rows.results || []).map((r: any) => ({
      id: r.id,
      posting_id: r.posting_id,
      status: r.status,
      created_at: r.created_at,
      job: { slug: r.job_slug, title: r.job_title, status: r.job_status, project_name: r.project_name ?? null },
    })),
  });
});

// ── POST / — create a draft posting ────────────────────────────────────────
jobs.post('/', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const body = await c.req.json().catch(() => ({} as any));
  const title = String(body.title || '').trim();
  if (!title) return c.json({ error: 'title_required' }, 400);

  const projectId = body.project_id != null ? Number(body.project_id) : null;
  // Founder-posted roles are tied to a startup: non-admins MUST attach a project
  // they can write to. Admins may post platform-level roles without one.
  if (u.role !== 'admin' && projectId == null) return c.json({ error: 'project_required' }, 400);
  const projErr = await validateProjectId(c, u, projectId);
  if (projErr) return projErr;

  const slug = await ensureUniqueJobSlug(c.env, title);
  const ins: any = await c.env.DB.prepare(
    `INSERT INTO job_postings
       (slug, host_user_id, project_id, title, employment_type, location_text, remote, seniority, summary, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  ).bind(
    slug,
    u.id,
    projectId,
    title,
    normalizeEmploymentType(body.employment_type),
    body.location_text ? String(body.location_text).slice(0, 300) : null,
    body.remote ? 1 : 0,
    normalizeSeniority(body.seniority),
    body.summary ? String(body.summary).slice(0, 500) : null,
    body.description ? String(body.description).slice(0, 20000) : null,
  ).run();

  const created = await loadPosting(c.env, Number(ins?.meta?.last_row_id));
  return c.json({ job: shapeJobPosting(created, { includePrivate: true }) }, 201);
});

// ── GET /:id — posting detail (host/admin) ─────────────────────────────────
jobs.get('/:id', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);
  return c.json({ job: shapeJobPosting(posting, { includePrivate: true }) });
});

// ── PATCH /:id — update posting fields (host/admin) ────────────────────────
jobs.patch('/:id', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => ({} as any));
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('title' in body) {
    const t = String(body.title || '').trim();
    if (!t) return c.json({ error: 'title_required' }, 400);
    sets.push('title = ?'); binds.push(t);
  }
  if ('summary' in body) { sets.push('summary = ?'); binds.push(body.summary ? String(body.summary).slice(0, 500) : null); }
  if ('description' in body) { sets.push('description = ?'); binds.push(body.description ? String(body.description).slice(0, 20000) : null); }
  if ('location_text' in body) { sets.push('location_text = ?'); binds.push(body.location_text ? String(body.location_text).slice(0, 300) : null); }
  if ('employment_type' in body) { sets.push('employment_type = ?'); binds.push(normalizeEmploymentType(body.employment_type)); }
  if ('seniority' in body) { sets.push('seniority = ?'); binds.push(normalizeSeniority(body.seniority)); }
  if ('remote' in body) { sets.push('remote = ?'); binds.push(body.remote ? 1 : 0); }
  if ('project_id' in body) {
    const projectId = body.project_id != null ? Number(body.project_id) : null;
    // A non-admin cannot detach a role from its startup (see POST /).
    if (u.role !== 'admin' && projectId == null) return c.json({ error: 'project_required' }, 400);
    const projErr = await validateProjectId(c, u, projectId);
    if (projErr) return projErr;
    sets.push('project_id = ?'); binds.push(projectId);
  }

  if (!sets.length) return c.json({ job: shapeJobPosting(posting, { includePrivate: true }) });
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);
  await c.env.DB.prepare(`UPDATE job_postings SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/submit-review — send to the admin publish queue ───────────────
// Every posting is public, so it always enters the admin review queue.
jobs.post('/:id/submit-review', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);
  if (!String(posting.title || '').trim()) return c.json({ error: 'title_required' }, 400);
  await c.env.DB.prepare(
    `UPDATE job_postings SET status = 'pending_review', review_notes = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/close — founder closes the posting ───────────────────────────
jobs.post('/:id/close', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare(
    `UPDATE job_postings SET status = 'closed', admin_published = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

// ── GET /:id/applications — applicant list (host/admin only) ────────────────
// The ONLY surface that returns applicant PII. LEFT JOIN users so a
// since-registered applicant surfaces their platform account.
jobs.get('/:id/applications', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);
  // Deterministically link any email-only applications on THIS posting to a
  // since-registered account (same rule as my-applications, but applied when a
  // founder reads applicants) so user_id and the member profile are consistent
  // at read time — not dependent on the applicant having first re-visited their
  // own applications. Fully parameterized; only `id` is bound.
  try {
    await c.env.DB.prepare(
      `UPDATE job_applications
          SET user_id = (SELECT u.id FROM users u WHERE lower(u.email) = lower(job_applications.email)),
              updated_at = datetime('now')
        WHERE posting_id = ?
          AND user_id IS NULL
          AND EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(job_applications.email))`,
    ).bind(id).run();
  } catch (e) {
    console.warn('[jobs] applicant link backfill failed:', (e as Error).message);
  }
  const rows = await c.env.DB.prepare(
    `SELECT a.*, mu.id AS member_id, mu.name AS member_name, mu.email AS member_email, mu.role AS member_role
       FROM job_applications a
       LEFT JOIN users mu ON lower(mu.email) = lower(a.email)
      WHERE a.posting_id = ?
      ORDER BY a.created_at DESC`,
  ).bind(id).all();
  return c.json({
    job: shapeJobPosting(posting, { includePrivate: true }),
    applications: (rows.results || []).map(shapeJobApplication),
  });
});

// ── GET /:id/applications/:appId/resume — one-time signed download ──────────
// Mints a short-lived token ON DEMAND (never inlined into the list). Verifies
// the application belongs to the posting AND the caller manages the posting.
jobs.get('/:id/applications/:appId/resume', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const appId = intParam(c.req.param('appId'));
  if (!id || !appId) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  if (!canManage(posting, u)) return c.json({ error: 'forbidden' }, 403);
  const app: any = await c.env.DB.prepare(
    `SELECT id, resume_key FROM job_applications WHERE id = ? AND posting_id = ?`,
  ).bind(appId, id).first();
  if (!app) return c.json({ error: 'not_found' }, 404);
  if (!app.resume_key) return c.json({ error: 'no_resume' }, 404);
  if (!c.env.FILES) return c.json({ error: 'storage_not_configured' }, 503);
  const { token, expires_at } = await mintDownloadToken(c.env, {
    key: app.resume_key, audience: 'job_resume', userId: u.id,
  });
  return c.json({ url: `/api/files/dl/${token}`, expires_at });
});

export default jobs;
