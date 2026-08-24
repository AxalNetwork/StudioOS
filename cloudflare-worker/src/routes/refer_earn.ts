import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { generateUniqueShortReferralCode } from '../services/referrals/codes';
import {
  ensureReferralSubmissionsSchema,
  createSubmission,
  listForReferrer,
  getByUid,
  listEvents,
  countsForReferrer,
  reviewSubmission,
  addReferrerContext,
  requestStrategicAccess,
  strategicAccessState,
  parseCsv,
  toWire,
  isCategory,
  isStatus,
  CATEGORY_META,
  CATEGORIES,
  STATUS_LABELS,
  CSV_IMPORT_LIMIT,
  ReferralError,
  type Category,
} from '../services/referralSubmissions';

/**
 * Refer & Earn — referral submission pipeline.
 *
 *   GET   /api/refer-earn/overview                   → code, link, categories, counts
 *   GET   /api/refer-earn/submissions                → the caller's pipeline
 *   POST  /api/refer-earn/submissions                → submit one referral
 *   GET   /api/refer-earn/submissions/:uid           → detail + timeline
 *   POST  /api/refer-earn/submissions/:uid/context   → answer "More info needed"
 *   POST  /api/refer-earn/submissions/import         → CSV bulk submit
 *   POST  /api/refer-earn/strategic-access           → request invite-only access
 *   GET   /api/refer-earn/admin/submissions          → review queue
 *   PATCH /api/refer-earn/admin/submissions/:uid     → move status / annotate
 *
 * Stripe Connect payouts were removed in the referrals redesign: rewards are
 * milestone labels settled off-platform, not transfers. The historical
 * `referral_payouts` table is intentionally left in place (see migration 175).
 */

const refer = new Hono<{ Bindings: Env }>();

interface CodedUser extends User {
  referral_code?: string | null;
  legacy_referral_code?: string | null;
}

/**
 * The caller's short referral code, minting one on first read. Reuses the
 * pre-existing `users.referral_code` column and the legacy-aware generator, so
 * links already shared under an older code keep resolving.
 */
async function ensureReferralCode(env: Env, userId: number): Promise<{ code: string; legacy: string | null }> {
  const row = await env.DB.prepare(
    `SELECT referral_code, legacy_referral_code FROM users WHERE id = ?`,
  ).bind(userId).first<CodedUser>().catch(() => null);

  const legacy = (row?.legacy_referral_code as string | null) ?? null;
  if (row?.referral_code) return { code: row.referral_code, legacy };

  const code = await generateUniqueShortReferralCode(env);
  await env.DB.prepare(`UPDATE users SET referral_code = ? WHERE id = ?`)
    .bind(code, userId).run();
  return { code, legacy };
}

function publicBase(env: Env): string {
  return (env.PUBLIC_BASE_URL as string | undefined) || 'https://axal.vc';
}

/** ReferralError → JSON, anything else rethrown for the global handler. */
function errorResponse(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof ReferralError) {
    return c.json(
      { ok: false, error: { code: e.code, message: e.message } },
      e.httpStatus as ContentfulStatusCode,
    );
  }
  throw e;
}

// ---------------------------------------------------------------------------
// Referrer surface
// ---------------------------------------------------------------------------

refer.get('/overview', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);

  const { code, legacy } = await ensureReferralCode(c.env, user.id);
  const counts = await countsForReferrer(c.env, user.id);
  const strategic = await strategicAccessState(c.env, user.id);

  return c.json({
    referral_code: code,
    legacy_referral_code: legacy,
    referral_link: `${publicBase(c.env)}/register?ref=${encodeURIComponent(code)}`,
    categories: CATEGORIES.map((k) => ({
      key: k,
      ...CATEGORY_META[k],
      // The gate the UI needs in order to decide between "Submit" and
      // "Request access" — computed here so the client never has to infer it.
      locked: k === 'strategic' && strategic !== 'granted',
    })),
    strategic_access: strategic,
    counts: {
      total: counts.total,
      converted: counts.converted,
      reward_issued: counts.rewardIssued,
      by_status: counts.byStatus,
    },
    status_labels: STATUS_LABELS,
  });
});

refer.get('/submissions', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const url = new URL(c.req.url);
  const rows = await listForReferrer(c.env, user.id, {
    status: url.searchParams.get('status') || undefined,
    category: url.searchParams.get('category') || undefined,
  });
  return c.json(rows.map((r) => toWire(r)));
});

refer.post('/submissions', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  // Self-referral guard. The programme rules are explicit that self-referrals
  // are ineligible, so reject rather than silently accepting something review
  // will always throw away.
  const contact = String(body.referredContact ?? body.contact ?? '').trim().toLowerCase();
  if (contact && user.email && contact === String(user.email).toLowerCase()) {
    return c.json(
      { ok: false, error: { code: 'self_referral', message: 'You cannot refer yourself.' } },
      400,
    );
  }

  try {
    const row = await createSubmission(c.env, user.id, {
      category: (body.category as Category) ?? 'startup',
      referredName: String(body.referredName ?? body.name ?? ''),
      referredOrg: (body.referredOrg ?? body.org ?? null) as string | null,
      referredContact: (body.referredContact ?? body.contact ?? null) as string | null,
      yourRole: (body.yourRole ?? null) as string | null,
      context: (body.context ?? null) as string | null,
      source: 'form',
    });
    return c.json(toWire(row), 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

refer.get('/submissions/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const row = await getByUid(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
  const events = await listEvents(c.env, row.id);
  return c.json(toWire(row, events));
});

refer.post('/submissions/:uid/context', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const row = await addReferrerContext(
      c.env, c.req.param('uid'), user.id, String(body.note ?? ''),
    );
    const events = await listEvents(c.env, row.id);
    return c.json(toWire(row, events));
  } catch (e) {
    return errorResponse(c, e);
  }
});

/**
 * Bulk import. Every row goes through the same createSubmission path as the
 * form, so validation and the invite-only gate cannot be bypassed by pasting
 * a CSV. Partial success is reported rather than failing the whole batch —
 * one malformed row should not discard 40 good ones.
 */
refer.post('/submissions/import', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const category = isCategory(body.category) ? body.category : 'startup';

  const parsed = parseCsv(String(body.csv ?? ''));
  if (!parsed.length) {
    return c.json({ ok: false, error: { code: 'empty_csv', message: 'No rows found.' } }, 400);
  }
  if (parsed.length > CSV_IMPORT_LIMIT) {
    return c.json({
      ok: false,
      error: {
        code: 'too_many_rows',
        message: `Import up to ${CSV_IMPORT_LIMIT} rows at a time (found ${parsed.length}).`,
      },
    }, 400);
  }

  const created: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const r of parsed) {
    try {
      const row = await createSubmission(c.env, user.id, {
        category,
        referredName: r.name,
        referredOrg: r.org || null,
        context: r.context || null,
        source: 'csv',
      });
      created.push(row.uid);
    } catch (e) {
      // An invite-only rejection applies to the whole batch, so surface it
      // immediately instead of repeating it 50 times.
      if (e instanceof ReferralError && e.code === 'invite_only') return errorResponse(c, e);
      failed.push({ name: r.name, reason: e instanceof ReferralError ? e.code : 'error' });
    }
  }
  return c.json({ imported: created.length, failed }, created.length ? 201 : 400);
});

refer.post('/strategic-access', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralSubmissionsSchema(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const status = await requestStrategicAccess(c.env, user.id, (body.note ?? null) as string | null);
  return c.json({ strategic_access: status });
});

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------

refer.get('/admin/submissions', async (c) => {
  await requireAdmin(c);
  await ensureReferralSubmissionsSchema(c.env);
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 200);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (status && isStatus(status)) { where.push('s.status = ?'); binds.push(status); }
  if (category && isCategory(category)) { where.push('s.category = ?'); binds.push(category); }

  const rows = await c.env.DB.prepare(
    `SELECT s.*, u.email AS referrer_email, u.name AS referrer_name
       FROM referral_submissions s
       LEFT JOIN users u ON u.id = s.referrer_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at DESC
      LIMIT ${limit}`,
  ).bind(...binds).all<Record<string, unknown>>();

  return c.json((rows.results || []).map((r) => ({
    ...toWire(r as never),
    referrer_email: r.referrer_email ?? null,
    referrer_name: r.referrer_name ?? null,
  })));
});

refer.patch('/admin/submissions/:uid', async (c) => {
  const admin = await requireAdmin(c);
  await ensureReferralSubmissionsSchema(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const row = await reviewSubmission(c.env, c.req.param('uid'), admin.id, {
      status: body.status as string | undefined,
      note: (body.note ?? null) as string | null,
      rewardLabel: body.rewardLabel as string | null | undefined,
      nextStep: body.nextStep as string | null | undefined,
      fitNotes: body.fitNotes as string | null | undefined,
    });
    const events = await listEvents(c.env, row.id);
    return c.json(toWire(row, events));
  } catch (e) {
    return errorResponse(c, e);
  }
});

export default refer;
