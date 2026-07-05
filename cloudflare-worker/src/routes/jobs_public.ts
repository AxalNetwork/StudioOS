/**
 * Task #68 — Public Job Board: public routes. No auth.
 *
 * Mounted at /api/public (alongside events_public) so it sits OUTSIDE the auth
 * layer and the /api/admin CF-Access perimeter. Read endpoints are open; the
 * apply endpoint is Turnstile-gated exactly like routes/contact.ts + events
 * (fails OPEN in dev/preview, closed in prod when the secret is set) and is
 * additionally throttled per-IP (best-effort KV) and de-duped by a UNIQUE
 * (posting_id, email) constraint.
 *
 * Public feed predicate (mirrors the events publish gate, MINUS the unlisted
 * escape hatch): status = 'published' AND admin_published = 1. A posting is
 * public only after an admin approves it — there is no by-slug admittance for
 * un-approved roles.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyTurnstile } from '../services/turnstile';
import { ensureJobBoardSchema } from '../services/jobBoardSchema';
import { shapeJobPosting, safeHttpUrl, buildPublicJobFeedWhere } from '../services/jobBoardCommon';
import { putResumeFromDataUri } from '../services/r2';
import { notify } from '../services/notify';

const jobsPublic = new Hono<{ Bindings: Env }>();

jobsPublic.use('*', async (c, next) => {
  await ensureJobBoardSchema(c.env);
  await next();
});

const APPLY_IP_CAP = 10; // applications per IP per hour (best-effort)

function clampInt(v: string | null, def: number, max: number): number {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(Math.floor(n), max);
}

async function resolveUserIdByEmail(env: Env, email: string): Promise<number | null> {
  const r: any = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).bind(email).first();
  return r ? Number(r.id) : null;
}

// Best-effort per-IP throttle via the TOKENS KV. Fails OPEN (never blocks a
// legitimate applicant because KV is missing/erroring) — Turnstile + the UNIQUE
// constraint remain the hard defenses.
async function ipThrottleExceeded(env: Env, ip: string | undefined): Promise<boolean> {
  if (!ip || !env.TOKENS) return false;
  const key = `jobapply:${ip}`;
  try {
    const cur = Number((await env.TOKENS.get(key)) || 0);
    if (cur >= APPLY_IP_CAP) return true;
    await env.TOKENS.put(key, String(cur + 1), { expirationTtl: 3600 });
    return false;
  } catch {
    return false;
  }
}

// ── GET /jobs — public feed ────────────────────────────────────────────────
jobsPublic.get('/jobs', async (c) => {
  const limit = clampInt(c.req.query('limit') ?? null, 20, 100);
  const offset = clampInt(c.req.query('offset') ?? null, 0, 100000);
  const employmentType = c.req.query('employment_type');
  const seniority = c.req.query('seniority');
  const remote = c.req.query('remote');
  const q = c.req.query('q');

  // Predicate + binds built by a pure, unit-tested helper. Search spans role
  // (title/summary), city (location_text) AND startup name (projects.name via
  // the LEFT JOIN below) per the spec's "search by role/startup/city" ask.
  const { where, binds } = buildPublicJobFeedWhere({ employmentType, seniority, remote, q });

  const rows = await c.env.DB.prepare(
    `SELECT j.*, p.name AS project_name
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE ${where.join(' AND ')}
      ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  return c.json({ jobs: (rows.results || []).map((r) => shapeJobPosting(r)) });
});

// ── GET /jobs/:slug — public detail ────────────────────────────────────────
jobsPublic.get('/jobs/:slug', async (c) => {
  const slug = c.req.param('slug');
  const job: any = await c.env.DB.prepare(
    `SELECT j.*, p.name AS project_name
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE j.slug = ? AND j.status = 'published' AND j.admin_published = 1`,
  ).bind(slug).first();
  if (!job) return c.json({ error: 'not_found' }, 404);
  return c.json({ job: shapeJobPosting(job) });
});

// ── POST /jobs/:slug/apply — public application (Turnstile) ─────────────────
jobsPublic.post('/jobs/:slug/apply', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const ok = await verifyTurnstile(c.env, String(body.turnstile_token || body.turnstileToken || ''), clientIp);
  if (!ok) return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);

  const email = String(body.email || '').trim().toLowerCase();
  const name = body.name ? String(body.name).trim().slice(0, 200) : null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'invalid_email' }, 400);

  if (await ipThrottleExceeded(c.env, clientIp)) return c.json({ error: 'rate_limited' }, 429);

  const job: any = await c.env.DB.prepare(
    `SELECT * FROM job_postings WHERE slug = ? AND status = 'published' AND admin_published = 1`,
  ).bind(slug).first();
  if (!job) return c.json({ error: 'not_found' }, 404);

  // Already applied? (case-insensitive de-dupe backs the UNIQUE constraint).
  const existing: any = await c.env.DB.prepare(
    `SELECT id FROM job_applications WHERE posting_id = ? AND lower(email) = lower(?) LIMIT 1`,
  ).bind(job.id, email).first();
  if (existing) return c.json({ error: 'already_applied', code: 'already_applied' }, 409);

  // Optional resume: PDF data URI → private R2 (never a public URL). A storage
  // failure is explicit — we do NOT silently drop the file.
  let resumeKey: string | null = null;
  let resumeName: string | null = null;
  if (body.resume_data_uri) {
    if (!c.env.FILES) return c.json({ error: 'storage_not_configured' }, 503);
    try {
      const meta = await putResumeFromDataUri(c.env, Number(job.id), String(body.resume_data_uri));
      resumeKey = meta.file_key;
      resumeName = body.resume_name ? String(body.resume_name).slice(0, 255) : `${slug}.pdf`;
    } catch (e) {
      return c.json({ error: 'resume_rejected', message: (e as Error).message }, 400);
    }
  }

  const coverNote = body.cover_note ? String(body.cover_note).slice(0, 5000) : null;
  // Only accept absolute http(s) links — collapse javascript:/data:/garbage to
  // null so a hostile value can never be stored and later rendered as a live
  // href in the founder's applicants view (stored link-injection / XSS).
  const linkedin = safeHttpUrl(body.linkedin_url);
  const portfolio = safeHttpUrl(body.portfolio_url);
  const userId = await resolveUserIdByEmail(c.env, email);

  try {
    await c.env.DB.prepare(
      `INSERT INTO job_applications
         (posting_id, user_id, name, email, cover_note, linkedin_url, portfolio_url, resume_key, resume_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(job.id, userId, name, email, coverNote, linkedin, portfolio, resumeKey, resumeName).run();
  } catch (e) {
    // UNIQUE(posting_id, email) race → treat as already applied.
    if (String((e as Error).message).toLowerCase().includes('unique')) {
      return c.json({ error: 'already_applied', code: 'already_applied' }, 409);
    }
    throw e;
  }

  // Notify the founder (best-effort) that a new application landed.
  if (job.host_user_id) {
    await notify(c.env, {
      userId: Number(job.host_user_id), type: 'job_application', category: 'jobs',
      title: `New application: ${job.title}`,
      link: `/jobs/${job.id}/manage`, payload: { posting_id: job.id },
    }).catch(() => {});
  }

  // Signal to the SPA whether this applicant already has a platform account, so
  // it can route them to sign-in vs register-to-track-your-application.
  return c.json({ ok: true, has_account: userId != null }, 201);
});

export default jobsPublic;
