/**
 * GP application review — admin routes for the Spin-Out Fund I LP queue.
 *
 *   GET   /api/admin/lp-applications          — the review queue + counts
 *   PATCH /api/admin/lp-applications/:id      — record a decision / note
 *
 * The applicant's half already existed (GET/POST /api/spinout-lab/lp-application
 * in routes/spinout_lab.ts) and migration 165 already carried `status`,
 * `reviewed_by`, `reviewed_at` and `review_note` — its index comment even says
 * "the GP's review queue reads status-first". The queue itself was never built,
 * so those columns had no writer. This is that writer.
 *
 * Every route is requireAdmin. There is no partner or investor read path: the
 * queue contains other applicants' contact details, stated commitments and
 * internal review notes, so it is admin-only by construction rather than by a
 * role check bolted on per handler.
 *
 * On approval and access — the one thing not to get wrong here: approving an
 * application does NOT grant LP reporting access. The access ladder derives
 * from `limited_partners`; see the long note at the top of
 * services/lpApplicationReview.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { lpSelfScope } from '../services/tenancyScope';
import {
  validateTransition, presentQueueRow, summarize, downstreamEffects,
  OPEN_STATUSES, isReviewStatus,
} from '../services/lpApplicationReview';

const adminLpApplications = new Hono<{ Bindings: Env }>();

// The fund the LP workspace ships today. Kept as the DEFAULT rather than the
// only value: `lp_applications.fund_slug` has always been per-fund (migration
// 165 keyed its unique index on it precisely so a second fund would not collide
// with the first), and `vc_funds.slug` carries the real handles. The queue
// hardcoded this one, so a Fund II application would have been written to the
// table and then been invisible to every reviewer.
const DEFAULT_FUND_SLUG = 'spinout-fund-i';

/**
 * Funds the selector can offer.
 *
 * Union of the funds that actually HAVE applications and the funds that exist
 * in `vc_funds`, so a newly-created fund appears before its first application
 * arrives, and an application against a fund since renamed or deleted is still
 * reachable rather than orphaned. Never throws — a missing vc_funds table
 * degrades to whatever the applications themselves name.
 */
async function listFunds(env: Env, appSlugs: string[]) {
  const seen = new Map<string, string>();
  for (const slug of appSlugs) if (slug) seen.set(slug, slug);
  try {
    const res = await env.DB.prepare(
      'SELECT slug, name FROM vc_funds WHERE slug IS NOT NULL ORDER BY created_at ASC',
    ).all();
    for (const r of ((res && res.results) || []) as any[]) {
      if (r?.slug) seen.set(String(r.slug), String(r.name || r.slug));
    }
  } catch { /* table absent — application slugs alone are a usable list */ }
  if (!seen.has(DEFAULT_FUND_SLUG)) seen.set(DEFAULT_FUND_SLUG, DEFAULT_FUND_SLUG);
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}

/**
 * The queue.
 *
 * Joins `users` for the applicant's identity and self-joins it again for the
 * reviewer's display name, so the list renders "Reviewed by Hana Kaur" without
 * a second round trip per row.
 *
 * LEFT JOIN on the reviewer, not INNER: an unreviewed application has
 * `reviewed_by IS NULL`, and an inner join would silently drop exactly the
 * rows the GP most needs to see.
 *
 * `?status=` filters to one status; omitted returns everything and lets the
 * client segment, which keeps the counts stable while the GP switches tabs.
 */
adminLpApplications.get('/', async (c) => {
  await requireAdmin(c);
  const statusParam = c.req.query('status');
  const fundSlug = (c.req.query('fund') || '').trim() || DEFAULT_FUND_SLUG;

  try {
    const res = await c.env.DB.prepare(
      `SELECT a.*,
              u.name  AS applicant_name,
              u.email AS email,
              r.name  AS reviewer_name
         FROM lp_applications a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN users r ON r.id = a.reviewed_by
        WHERE a.fund_slug = ?
        ORDER BY a.created_at ASC`,
    ).bind(fundSlug).all();

    const now = Date.now();
    const all = ((res && res.results) || [])
      .map((row: any) => presentQueueRow(row, now))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Counts are computed over EVERYTHING, before filtering — a tab showing
    // "Approved 12" must keep saying 12 while the GP is looking at "New".
    const counts = summarize(all);

    const applications = !statusParam
      ? all
      : statusParam === 'open'
        ? all.filter((r) => OPEN_STATUSES.includes(r.status))
        : isReviewStatus(statusParam)
          ? all.filter((r) => r.status === statusParam)
          : all;

    // Fund list is derived from EVERY application row, not just this fund's,
    // so switching funds never empties the picker you switched with.
    let funds: Array<{ slug: string; name: string }> = [];
    try {
      const slugRes = await c.env.DB.prepare(
        'SELECT DISTINCT fund_slug FROM lp_applications',
      ).all();
      const slugs = ((slugRes && slugRes.results) || []).map((r: any) => String(r.fund_slug || ''));
      funds = await listFunds(c.env, slugs);
    } catch { funds = [{ slug: DEFAULT_FUND_SLUG, name: DEFAULT_FUND_SLUG }]; }

    return c.json({ ok: true, applications, counts, fund_slug: fundSlug, funds });
  } catch (e) {
    // A queue that cannot be read must not render as an empty queue — that
    // reads as "no applications waiting" and is how a submission goes unseen.
    console.error('[admin] lp-applications list failed:', (e as Error).message);
    return c.json({ error: 'Could not load the application queue.' }, 503);
  }
});

/**
 * Record a decision.
 *
 * Body: { status, review_note? }. `reviewed_by` and `reviewed_at` are stamped
 * server-side from the authenticated admin — never taken from the request, so
 * a reviewer cannot be attributed to someone else.
 *
 * The UPDATE is guarded on the CURRENT status (`AND status = ?`) so two GPs
 * acting on the same row at once cannot both win: the second write matches no
 * row and is reported as a conflict rather than silently overwriting a
 * decision the first reviewer just recorded.
 */
adminLpApplications.patch('/:id', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'Invalid application id.' }, 400);
  }

  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }

  try {
    const existing = await c.env.DB.prepare(
      // Looked up by id alone: the id is already unique across funds, and
      // pinning the fund here would 404 a decision made from a non-default
      // fund's queue.
      'SELECT id, status FROM lp_applications WHERE id = ?',
    ).bind(id).first<{ id: number; status: string }>();
    if (!existing) return c.json({ error: 'Application not found.' }, 404);

    const check = validateTransition(existing.status, body.status, body.review_note);
    if (!check.ok) return c.json({ error: check.error }, 400);

    const note = typeof body.review_note === 'string' && body.review_note.trim()
      ? body.review_note.trim()
      : null;

    const upd = await c.env.DB.prepare(
      `UPDATE lp_applications
          SET status = ?,
              reviewed_by = ?,
              reviewed_at = datetime('now'),
              review_note = COALESCE(?, review_note),
              updated_at = datetime('now')
        WHERE id = ? AND status = ?`,
    ).bind(check.status, admin.id, note, id, existing.status).run();

    // changes === 0 means the row moved between the read and the write.
    if (!upd || (upd.meta && upd.meta.changes === 0)) {
      return c.json({
        error: 'Someone else updated this application a moment ago. Reload to see the current state.',
        code: 'conflict',
      }, 409);
    }

    const row = await c.env.DB.prepare(
      `SELECT a.*, u.name AS applicant_name, u.email AS email, r.name AS reviewer_name
         FROM lp_applications a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN users r ON r.id = a.reviewed_by
        WHERE a.id = ?`,
    ).bind(id).first<any>();

    // Does this applicant actually hold an LP position? Drives the honest
    // downstream panel — approval alone never creates one.
    //
    // Asked through the SUBJECT's own membership scope, not the reviewer's:
    // `lpSelfScope` is handed the applicant, so the panel answers the same
    // question the applicant's own LP surfaces answer. `user_id = ?` alone
    // told a reviewer "no position" about a legacy LP who was, in the
    // platform's own capital-call queries, an LP — the honesty panel would
    // have been confidently wrong in the one place it exists to be right.
    //
    // No claim here on purpose. Linking an LP row to an account is the
    // account holder proving they own the address; doing it as a side effect
    // of an operator opening a review would make the audit trail say the
    // wrong thing about who claimed what.
    let hasHolding = false;
    try {
      const subjectScope = lpSelfScope({ id: Number(row?.user_id), email: row?.email ?? null });
      const lp = await c.env.DB.prepare(
        `SELECT 1 AS x FROM limited_partners lp WHERE ${subjectScope.sql} LIMIT 1`,
      ).bind(...subjectScope.binds).first<{ x: number }>();
      hasHolding = !!lp;
    } catch { /* table absent on a partial DB — absence is the safe answer */ }

    return c.json({
      ok: true,
      application: presentQueueRow(row, Date.now()),
      downstream: downstreamEffects(check.status, hasHolding),
    });
  } catch (e) {
    console.error('[admin] lp-application review failed:', (e as Error).message);
    return c.json({ error: 'Could not record the decision. Please try again.' }, 500);
  }
});

export default adminLpApplications;
