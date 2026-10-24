/**
 * D990 (#2801) — Partner profiles part 1, mounted at /api/admin/partner-profiles.
 *
 *   GET /           the list: search, filters, sort and pages, with totals over
 *                   the filtered set and the filters' options. Logged as the
 *                   D625 list read (`partner_profile_list_access`).
 *   GET /counts     the tiles (waiting and its 24h / 72h bands; verified in 30
 *                   days and envelopes out once parts 2 and 4 land) and the
 *                   weekly series, each block with `available` and `reason`.
 *   GET /:ref       one profile by its reference, `ein` masked, logged as the
 *                   D612 profile read (`partner_profile_access`) by reference.
 *   GET /:ref/history   D991: the profile's captures and decisions, newest
 *                   first, paged. A decision names the admin who made it.
 *   POST /:ref/reopen   D991: back in the queue, with an optional reason. The
 *                   verdict stays in the history; nobody is told (PRF5d).
 *
 * All `requireAdmin` (Admin and Super Admin alike). A profile is named by its
 * reference (migration 556) in the address and every log line, never by its
 * email. A D1 error is a 503, never an empty list. The rules (Draft, the
 * derived source) live in services/partnerProfiles.ts, shared with Approvals
 * lane 7. `/api/profiling/admin/*` stays as it was for the pages that read it.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireBranchNotSuspended } from '../auth';
import { refuse } from '../util/refusal';
import { hashEmail } from '../util/hashEmail';
import { maskPartnerProfile } from '../services/sensitiveFields';
import { HISTORY_LIMIT_MAX, REOPEN_REASON_MAX, profileHistory, reopenProfile } from '../services/partnerProfileReview';
import {
  PROFILE_REF, listOptions, listPartnerProfiles, listedByRef, partnerProfileCounts, type ListQuery,
} from '../services/partnerProfiles';

const r = new Hono<{ Bindings: Env }>();

const LIST_PARAMS = [
  'q', 'status', 'source', 'category', 'founder_track', 'entity_type', 'agreement', 'has_account',
  'identity', 'captured_from', 'captured_to', 'reviewed_by', 'sort', 'page', 'page_size',
] as const;

async function logRead(env: Env, admin: { id: number; email: string }, action: string, details: string) {
  await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind(action, details, await hashEmail(admin.email), admin.id).run();
}

r.get('/', async (c) => {
  const admin = await requireAdmin(c);
  const query: ListQuery = {};
  for (const k of LIST_PARAMS) { const v = c.req.query(k); if (v != null) query[k] = v; }
  let result: Awaited<ReturnType<typeof listPartnerProfiles>>;
  let options: Awaited<ReturnType<typeof listOptions>>;
  try {
    result = await listPartnerProfiles(c.env, query);
    if ('error' in result) {
      return refuse(c, 400, { code: result.error, message: result.message });
    }
    options = await listOptions(c.env);
    await logRead(c.env, admin, 'partner_profile_list_access',
      `Partner profile list read count=${result.rows.length} total=${result.totals.total} page=${result.page}`);
  } catch (e) {
    return refuse(c, 503, { code: 'partner_profiles_unreadable', message: 'The partner profiles could not be read. Try again in a moment.', raw: e });
  }
  return c.json({ ...result, options });
});

r.get('/counts', async (c) => {
  await requireAdmin(c);
  return c.json(await partnerProfileCounts(c.env));
});

r.get('/:ref', async (c) => {
  const admin = await requireAdmin(c);
  const ref = c.req.param('ref');
  if (!PROFILE_REF.test(ref)) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
  try {
    const row = await c.env.DB.prepare('SELECT * FROM partner_profiles WHERE ref = ?').bind(ref).first<any>();
    if (!row) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
    const listed = await listedByRef(c.env, ref);
    const memberId = listed?.account?.user_id ?? null;
    await logRead(c.env, admin, 'partner_profile_access',
      memberId ? `Admin read partner profile ref=${ref} user_id=${memberId}` : `Admin read partner profile ref=${ref}; no user account`);
    // D634 — the tax ID leaves masked. The list's derived fields ride beside the row.
    return c.json({ ...maskPartnerProfile(row), listed });
  } catch (e) {
    return refuse(c, 503, { code: 'partner_profiles_unreadable', message: 'The partner profile could not be read. Try again in a moment.', raw: e });
  }
});

const intOr = (v: string | undefined, d: number) => (v != null && /^\d+$/.test(v) ? Number(v) : d);

r.get('/:ref/history', async (c) => {
  await requireAdmin(c);
  const ref = c.req.param('ref');
  if (!PROFILE_REF.test(ref)) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
  const limit = Math.min(HISTORY_LIMIT_MAX, Math.max(1, intOr(c.req.query('limit'), 50)));
  const offset = intOr(c.req.query('offset'), 0);
  try {
    const exists = await c.env.DB.prepare('SELECT 1 AS ok FROM partner_profiles WHERE ref = ?').bind(ref).first();
    if (!exists) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
    return c.json(await profileHistory(c.env, ref, limit, offset));
  } catch (e) {
    return refuse(c, 503, { code: 'partner_profile_history_unreadable', message: 'This profile\'s history could not be read. That is not the same as none.', raw: e });
  }
});

r.post('/:ref/reopen', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const ref = c.req.param('ref');
  if (!PROFILE_REF.test(ref)) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
  const body = await c.req.json().catch(() => ({} as any));
  const reason = typeof body?.reason === 'string' ? body.reason : null;
  if (reason && reason.trim().length > REOPEN_REASON_MAX) {
    return refuse(c, 400, { code: 'reason_too_long', message: `A reason is at most ${REOPEN_REASON_MAX} characters.` });
  }
  try {
    const result = await reopenProfile(c.env, ref, admin.id, reason);
    if (!result.ok) return refuse(c, result.status, { code: result.code, message: result.message });
    await logRead(c.env, admin, 'partner_profile_reopened', `Admin reopened partner profile ref=${ref}`);
    return c.json({ ok: true, ref, status: 'pending', reopened_at: result.reopened_at });
  } catch (e) {
    return refuse(c, 503, { code: 'partner_profiles_unreadable', message: 'The partner profile could not be reopened. Try again in a moment.', raw: e });
  }
});

export default r;
