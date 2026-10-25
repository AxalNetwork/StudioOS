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
 *   GET /agreements D993: the first-agreement options in their five groups,
 *                   each Ready or "Not ready: no text in the library yet",
 *                   read through the send's own resolver.
 *   POST /:ref/unbind
 *                   D993: free a profile whose address now belongs to another
 *                   account (`user_id` cleared), so that account's answers can
 *                   land in it. Super Admin with a TOTP session and a recent
 *                   step-up (`requireSuperAdminWriteBar`), a reason of 10
 *                   characters or more, logged in Governance
 *                   (`partner_profile_unbound`, `logAdminAction`).
 *
 * Each row and profile also carries the state of its first agreement's
 * envelope (D993), and the counts fill "envelopes out" from it.
 *
 * All `requireAdmin` (Admin and Super Admin alike). A profile is named by its
 * reference (migration 556) in the address and every log line, never by its
 * email. A D1 error is a 503, never an empty list. The rules (Draft, the
 * derived source) live in services/partnerProfiles.ts, shared with Approvals
 * lane 7. `/api/profiling/admin/*` stays as it was for the pages that read it.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { hashEmail } from '../util/hashEmail';
import { maskPartnerProfile } from '../services/sensitiveFields';
import { logAdminAction } from '../services/adminAudit';
import { agreementOptions } from '../services/partnerAgreements';
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

r.get('/agreements', async (c) => {
  await requireAdmin(c);
  try {
    return c.json(await agreementOptions(c.env));
  } catch (e) {
    return refuse(c, 503, { code: 'agreements_unreadable', message: 'The legal library could not be read, so readiness is unknown. Try again in a moment.', raw: e });
  }
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

/** The shortest reason an Unbind takes, as a void's (D802). */
export const UNBIND_REASON_MIN = 10;
const UNBIND_REASON_MAX = 500;

r.post('/:ref/unbind', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const ref = c.req.param('ref');
  if (!PROFILE_REF.test(ref)) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
  const body = await c.req.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < UNBIND_REASON_MIN || reason.length > UNBIND_REASON_MAX) {
    return refuse(c, 400, { code: 'reason_required', message: `Say why, in ${UNBIND_REASON_MIN} to ${UNBIND_REASON_MAX} characters. The reason is kept in Governance.` });
  }
  let previous: number;
  let holder: number | null;
  try {
    const row = await c.env.DB.prepare('SELECT email, user_id FROM partner_profiles WHERE ref = ?').bind(ref).first<any>();
    if (!row) return refuse(c, 404, { code: 'profile_not_found', message: 'No partner profile has that reference.' });
    if (row.user_id == null) {
      return refuse(c, 409, { code: 'not_bound', message: 'This profile is not bound to an account, so there is nothing to unbind.' });
    }
    previous = Number(row.user_id);
    const h = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) ORDER BY id LIMIT 1').bind(row.email).first<any>();
    holder = h?.id == null ? null : Number(h.id);
    if (holder === previous) {
      return refuse(c, 409, { code: 'address_still_theirs', message: 'The account this profile is bound to still holds its address. Unbind frees a profile only when the address belongs to another account or to none.' });
    }
    // Only the binding read above is cleared: another write in between refuses rather than unbinding someone else.
    const done = await c.env.DB.prepare('UPDATE partner_profiles SET user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE ref = ? AND user_id = ?')
      .bind(ref, previous).run();
    if (!done?.meta?.changes) {
      return refuse(c, 409, { code: 'binding_changed', message: 'The profile changed while you were looking at it. Reload and try again.' });
    }
  } catch (e) {
    return refuse(c, 503, { code: 'partner_profiles_unreadable', message: 'The partner profile could not be read, so nothing was changed. Try again in a moment.', raw: e });
  }
  await logAdminAction(c.env, admin.id, admin.email, 'partner_profile_unbound', {
    ref, target_user_id: previous, address_holder_user_id: holder, reason,
  });
  return c.json({ unbound: true, ref, previous_user_id: previous, address_holder_user_id: holder });
});

export default r;
