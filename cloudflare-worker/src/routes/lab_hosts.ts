/**
 * D377 — who hosts Spin-Out Lab office hours (migration 313).
 *
 * /spinout-lab/office-hours listed every `partners` row. The owner's rule: only
 * people who applied to the Spin-Out Lab as an Investor, Advisor or Partner and
 * whom an admin approved appear there. So:
 *
 *   applicant side  /api/spinout-lab/hosts        (labHosts)
 *     GET  /me                   the caller's bookable profiles and applications
 *     POST /apply                apply from one of the caller's OWN profiles
 *     POST /me/:uid/withdraw     withdraw the caller's own pending application
 *     GET  /directory            approved hosts only — what Office Hours lists
 *
 *   admin side      /api/admin/lab-hosts           (adminLabHosts)
 *     GET  /                     the queue, filtered by status, with counts
 *     POST /:uid/decision        approve | reject | revoke, recorded
 *
 * A HOST IS A BOOKABLE PROFILE. Founders book a real calendar, so an
 * application names one: a `partners` row (the caller's users.partner_id,
 * booked through partner office-hour slots; capacity Investor, Advisor or
 * Partner), or an `advisors` row (the caller's own, booked through advisor
 * slots; capacity Advisor). The profile is resolved from the caller's account,
 * never taken from the request, so nobody applies on someone else's profile.
 *
 * WHAT THE DIRECTORY CARRIES. What a directory card and the booking drawer
 * draw: name, company or headline, specialization, capacity, headshot, the
 * partner's own published booking guidance, and the ids the booking calls
 * need. Never an email, and nothing from the application itself (statement,
 * review note, reviewer) — those are the applicant's and the admins'.
 *
 * WHO DECIDES. `requireAdmin` — an admin, which includes every super admin.
 * Each decision is written with its reviewer and time, and recorded through
 * `logAdminAction` against the applicant as target.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';

export const HOST_CAPACITIES = ['investor', 'advisor', 'partner'] as const;
export const STATEMENT_MAX = 1000;
export const DIRECTORY_CAP = 300;
const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'revoked'] as const;

/** Which transition a decision makes, and from which status only. */
export const DECISIONS = {
  approve: { from: 'pending', to: 'approved' },
  reject: { from: 'pending', to: 'rejected' },
  revoke: { from: 'approved', to: 'revoked' },
} as const;

type Profile = { kind: 'partner' | 'advisor'; id: number; name: string; capacities: readonly string[] };

/** The bookable profiles the caller owns — the only ones they may apply with. */
async function ownProfiles(env: Env, user: any): Promise<Profile[]> {
  const out: Profile[] = [];
  if (user.partner_id != null) {
    const p = await env.DB.prepare(`SELECT id, name FROM partners WHERE id = ?`).bind(user.partner_id).first<any>();
    if (p) out.push({ kind: 'partner', id: Number(p.id), name: String(p.name), capacities: HOST_CAPACITIES });
  }
  const a = await env.DB.prepare(`SELECT id, display_name FROM advisors WHERE user_id = ?`).bind(user.id).first<any>();
  if (a) out.push({ kind: 'advisor', id: Number(a.id), name: String(a.display_name), capacities: ['advisor'] });
  return out;
}

async function body(c: any): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

/** The directory's audience: Lab founders (and active Lab members) and admins. */
function readsDirectory(user: any): boolean {
  if (user.role === 'admin' || user.role === 'founder') return true;
  return user.role === 'exploring' && Number(user.spinout_lab_active ?? 0) === 1;
}

// ------------------------------------------------------------ applicant side

export const labHosts = new Hono<{ Bindings: Env }>();

labHosts.get('/me', async (c) => {
  const user = await requireAuth(c);
  const profiles = await ownProfiles(c.env, user);
  const rows = await c.env.DB.prepare(
    `SELECT uid, host_kind, capacity, statement, status, reviewed_at, review_note, created_at, updated_at FROM lab_host_applications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
  ).bind(user.id).all<any>();
  return c.json({ profiles, applications: rows.results || [] });
});

labHosts.post('/apply', async (c) => {
  const user = await requireAuth(c);
  const b = await body(c);
  const kind = b.host_kind === 'partner' || b.host_kind === 'advisor' ? b.host_kind : null;
  if (!kind) {
    return refuse(c, 400, { code: 'host_kind_invalid', message: 'Say which of your profiles founders would book: "partner" or "advisor".' });
  }
  const profile = (await ownProfiles(c.env, user)).find((p) => p.kind === kind);
  if (!profile) {
    return refuse(c, 409, {
      code: 'no_host_profile',
      message: kind === 'partner'
        ? 'Your account has no partner profile, so there is no partner calendar founders could book. Set one up first.'
        : 'Your account has no advisor profile, so there is no advisor calendar founders could book. Set one up first.',
    });
  }
  const capacity = typeof b.capacity === 'string' ? b.capacity : '';
  if (!profile.capacities.includes(capacity)) {
    return refuse(c, 400, {
      code: 'capacity_invalid',
      message: `From a ${kind} profile you can apply as: ${profile.capacities.join(', ')}.`,
    });
  }
  const statement = typeof b.statement === 'string' ? b.statement.trim() : '';
  if (statement.length > STATEMENT_MAX) {
    return refuse(c, 400, { code: 'statement_too_long', message: `Keep it to ${STATEMENT_MAX} characters.` });
  }
  const live = await c.env.DB.prepare(
    `SELECT uid, status FROM lab_host_applications WHERE host_kind = ? AND host_id = ? AND status IN ('pending', 'approved')`,
  ).bind(kind, profile.id).first<any>();
  if (live) {
    return refuse(c, 409, {
      code: 'already_applied',
      message: live.status === 'approved'
        ? 'This profile is already approved to host Spin-Out Lab office hours.'
        : 'This profile already has an application waiting for an admin.',
      extra: { application_uid: live.uid, status: live.status },
    });
  }
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO lab_host_applications (uid, user_id, host_kind, host_id, capacity, statement) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(uid, user.id, kind, profile.id, capacity, statement || null).run();
  const row = await c.env.DB.prepare(`SELECT uid, host_kind, capacity, statement, status, reviewed_at, review_note, created_at, updated_at FROM lab_host_applications WHERE uid = ?`).bind(uid).first<any>();
  return c.json({ application: row }, 201);
});

labHosts.post('/me/:uid/withdraw', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const res = await c.env.DB.prepare(
    `UPDATE lab_host_applications SET status = 'withdrawn', updated_at = datetime('now')
      WHERE uid = ? AND user_id = ? AND status = 'pending'`,
  ).bind(uid, user.id).run();
  if (Number(res.meta?.changes ?? 0) !== 1) {
    const row = await c.env.DB.prepare(`SELECT status FROM lab_host_applications WHERE uid = ? AND user_id = ?`)
      .bind(uid, user.id).first<any>();
    if (!row) return refuse(c, 404, { code: 'application_not_found', message: 'No application of yours has that id.' });
    return refuse(c, 409, { code: 'not_pending', message: `This application is ${row.status}, so it cannot be withdrawn.` });
  }
  return c.json({ ok: true, status: 'withdrawn' });
});

/**
 * GET /directory — approved hosts only. Each is still checked against its own
 * profile: a partner whose profile is inactive, or an advisor marked inactive,
 * is not bookable and is left out even while approved.
 */
labHosts.get('/directory', async (c) => {
  const user = await requireAuth(c);
  if (!readsDirectory(user)) {
    return refuse(c, 403, { code: 'lab_only', message: 'The Spin-Out Lab office-hours directory is for Lab founders.' });
  }
  const partnerRows = await c.env.DB.prepare(
    `SELECT a.capacity, a.reviewed_at AS approved_at,
            p.id AS host_id, p.uid, p.name, p.company, p.specialization,
            p.oh_when_to_book, p.oh_stage_fit, p.oh_session_outcome, p.oh_bring_json, p.oh_guidance_updated_at
       FROM lab_host_applications a
       JOIN partners p ON p.id = a.host_id
      WHERE a.status = 'approved' AND a.host_kind = 'partner' AND COALESCE(p.status, 'active') <> 'inactive'
      ORDER BY p.name COLLATE NOCASE, p.id
      LIMIT ?`,
  ).bind(DIRECTORY_CAP).all<any>();
  const advisorRows = await c.env.DB.prepare(
    `SELECT a.capacity, a.reviewed_at AS approved_at,
            v.id AS host_id, v.uid, v.display_name AS name, v.headline, v.expertise_json, v.headshot_url
       FROM lab_host_applications a
       JOIN advisors v ON v.id = a.host_id
      WHERE a.status = 'approved' AND a.host_kind = 'advisor' AND v.is_active = 1
      ORDER BY v.display_name COLLATE NOCASE, v.id
      LIMIT ?`,
  ).bind(DIRECTORY_CAP).all<any>();
  const items = [
    ...(partnerRows.results || []).map((r) => ({ kind: 'partner' as const, ...r })),
    ...(advisorRows.results || []).map((r) => ({ kind: 'advisor' as const, ...r })),
  ].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return c.json({ items, count: items.length });
});

// ---------------------------------------------------------------- admin side

export const adminLabHosts = new Hono<{ Bindings: Env }>();

adminLabHosts.get('/', async (c) => {
  await requireAdmin(c);
  const want = c.req.query('status') || 'pending';
  const status = want === 'all' || (STATUSES as readonly string[]).includes(want) ? want : 'pending';
  const rows = await c.env.DB.prepare(
    `SELECT a.uid, a.host_kind, a.capacity, a.statement, a.status, a.reviewed_at, a.review_note, a.created_at,
            u.id AS applicant_user_id, u.name AS applicant_name, u.email AS applicant_email, u.role AS applicant_role,
            COALESCE(p.name, v.display_name) AS profile_name, p.company AS profile_company,
            rv.name AS reviewed_by_name
       FROM lab_host_applications a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN partners p ON a.host_kind = 'partner' AND p.id = a.host_id
       LEFT JOIN advisors v ON a.host_kind = 'advisor' AND v.id = a.host_id
       LEFT JOIN users rv ON rv.id = a.reviewed_by
      WHERE (? = 'all' OR a.status = ?)
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 500`,
  ).bind(status, status).all<any>();
  const counts = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM lab_host_applications GROUP BY status`,
  ).all<{ status: string; n: number }>();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of counts.results || []) byStatus[r.status] = Number(r.n);
  return c.json({ status, items: rows.results || [], counts: byStatus });
});

adminLabHosts.post('/:uid/decision', async (c) => {
  const admin = await requireAdmin(c);
  const uid = c.req.param('uid');
  const b = await body(c);
  const decision = typeof b.decision === 'string' && b.decision in DECISIONS
    ? b.decision as keyof typeof DECISIONS : null;
  if (!decision) {
    return refuse(c, 400, { code: 'decision_invalid', message: 'A decision is "approve", "reject" or "revoke".' });
  }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, STATEMENT_MAX) : '';
  const t = DECISIONS[decision];
  const res = await c.env.DB.prepare(
    `UPDATE lab_host_applications
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now')
      WHERE uid = ? AND status = ?`,
  ).bind(t.to, admin.id, note || null, uid, t.from).run();
  const row = await c.env.DB.prepare(
    `SELECT uid, user_id, host_kind, host_id, capacity, status, reviewed_at, review_note FROM lab_host_applications WHERE uid = ?`,
  ).bind(uid).first<any>();
  if (!row) return refuse(c, 404, { code: 'application_not_found', message: 'No application has that id.' });
  if (Number(res.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, {
      code: 'not_decidable',
      message: `This application is ${row.status}; ${decision} applies only to a ${t.from} one.`,
    });
  }
  await logAdminAction(c.env, admin.id, admin.email, `lab_host.${decision}`, {
    target_user_id: Number(row.user_id), application_uid: uid, host_kind: row.host_kind, capacity: row.capacity,
  });
  const { user_id: _u, host_id: _h, ...out } = row;
  return c.json({ application: out });
});
