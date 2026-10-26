/**
 * D1137 (#3017, part 3 of #2422) — a company's lifecycle: archive, restore
 * and the primary-admin transfer. Mounted at /api beside `company.ts`.
 *
 *   POST /api/company/:uid/archive   — primary admin only (owner question 3 A)
 *   POST /api/company/:uid/restore   — primary admin only
 *   POST /api/company/:uid/transfer  — { user_id, demote? }: grant primary admin
 *                                      to a member, and demote the caller when
 *                                      `demote` is true, in ONE batch
 *
 * EACH CHANGE AND ITS EVENT ARE ONE BATCH. `membershipEvent` returns a bound
 * statement; it commits with the change or not at all (migration 597).
 *
 * A TRANSFER NEVER LEAVES A COMPANY WITHOUT A PRIMARY ADMIN. Granting used to
 * be one member edit and demoting another, so a failure between them, or a
 * demote sent first, could stop halfway. Here the grant and the demote are
 * one batch, the grant first, and the target must already be a member.
 *
 * AN ARCHIVED COMPANY IS NOBODY'S ACTIVE COMPANY. It leaves
 * `GET /api/company/memberships` (unless `?include=archived`) and
 * `resolveActiveCompany` reads it as none, so nothing is scoped to it. Its
 * members, ventures and records are untouched, and Restore brings it back as
 * it was. An archived company takes no transfer: restore it first.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { membershipEvent } from '../services/companyMembershipEvents';

const r = new Hono<{ Bindings: Env }>();

type CompanyRow = { id: number; uid: string; company_name: string; archived_at: string | null; archived_by: number | null };
type LinkRow = { id: number; user_id: number; role_in_company: string; is_primary_admin: number };

async function companyOf(env: Env, uid: string): Promise<CompanyRow | null> {
  return env.DB.prepare('SELECT id, uid, company_name, archived_at, archived_by FROM company_profiles WHERE uid = ?')
    .bind(uid).first<CompanyRow>();
}

async function linkOf(env: Env, companyId: number, userId: number): Promise<LinkRow | null> {
  return env.DB.prepare(
    'SELECT id, user_id, role_in_company, is_primary_admin FROM user_company_links WHERE company_id = ? AND user_id = ?',
  ).bind(companyId, userId).first<LinkRow>();
}

/**
 * The company, with the caller proved a primary admin of it. A caller who is
 * not a member reads 404, as `GET /company/:uid` answers a non-member, so the
 * route does not confirm the company exists.
 */
async function asPrimaryAdmin(env: Env, uid: string, user: User): Promise<{ company: CompanyRow; link: LinkRow } | { status: 403 | 404; detail: string }> {
  const company = await companyOf(env, uid);
  const link = company ? await linkOf(env, company.id, user.id) : null;
  if (!company || !link) return { status: 404, detail: 'Company not found' };
  if (!link.is_primary_admin) return { status: 403, detail: 'Only a primary admin of this company can do this' };
  return { company, link };
}

const companyState = (c: { archived_at: string | null }) => ({ archived: c.archived_at != null, archived_at: c.archived_at });

r.post('/company/:uid/archive', async (c) => {
  try {
    const user = await requireAuth(c);
    const g = await asPrimaryAdmin(c.env, c.req.param('uid'), user);
    if ('status' in g) return c.json({ detail: g.detail }, g.status);
    if (g.company.archived_at) return c.json({ detail: 'This company is already archived', code: 'already_archived' }, 409);
    const at = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE company_profiles SET archived_at = ?, archived_by = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL')
        .bind(at, user.id, at, g.company.id),
      membershipEvent(c.env, { kind: 'archive', companyId: g.company.id, actorUserId: user.id, before: { archived: false }, after: { archived: true } }),
    ]);
    return c.json({ uid: g.company.uid, ...companyState({ archived_at: at }) });
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/restore', async (c) => {
  try {
    const user = await requireAuth(c);
    const g = await asPrimaryAdmin(c.env, c.req.param('uid'), user);
    if ('status' in g) return c.json({ detail: g.detail }, g.status);
    if (!g.company.archived_at) return c.json({ detail: 'This company is not archived', code: 'not_archived' }, 409);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE company_profiles SET archived_at = NULL, archived_by = NULL, updated_at = ? WHERE id = ?')
        .bind(nowIso(), g.company.id),
      membershipEvent(c.env, { kind: 'restore', companyId: g.company.id, actorUserId: user.id, before: { archived: true }, after: { archived: false } }),
    ]);
    return c.json({ uid: g.company.uid, ...companyState({ archived_at: null }) });
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/transfer', async (c) => {
  try {
    const user = await requireAuth(c);
    const g = await asPrimaryAdmin(c.env, c.req.param('uid'), user);
    if ('status' in g) return c.json({ detail: g.detail }, g.status);
    if (g.company.archived_at) return c.json({ detail: 'This company is archived. Restore it before you transfer it.', code: 'archived' }, 409);
    const body = await c.req.json().catch(() => ({} as any));
    const targetId = Number(body?.user_id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) return c.json({ detail: 'user_id is required' }, 400);
    if (body?.demote !== undefined && typeof body.demote !== 'boolean') return c.json({ detail: 'demote must be true or false' }, 400);
    const demote = body?.demote === true;
    if (targetId === user.id) return c.json({ detail: 'You are already a primary admin of this company' }, 400);
    const target = await linkOf(c.env, g.company.id, targetId);
    if (!target) return c.json({ detail: 'That person is not a member of this company' }, 404);
    if (target.is_primary_admin && !demote) return c.json({ detail: 'That member is already a primary admin', code: 'already_primary' }, 409);
    // The grant first, then the demote, in one batch: whichever way it ends,
    // the company keeps a primary admin.
    const stmts = [
      c.env.DB.prepare('UPDATE user_company_links SET is_primary_admin = 1 WHERE id = ?').bind(target.id),
      ...(demote ? [c.env.DB.prepare('UPDATE user_company_links SET is_primary_admin = 0 WHERE id = ?').bind(g.link.id)] : []),
      membershipEvent(c.env, {
        kind: 'transfer', companyId: g.company.id, actorUserId: user.id, targetUserId: targetId,
        before: { target_primary_admin: Boolean(target.is_primary_admin), actor_primary_admin: true },
        after: { target_primary_admin: true, actor_primary_admin: !demote },
      }),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ uid: g.company.uid, primary_admin_user_id: targetId, demoted: demote });
  } catch (e) { return mapError(c, e); }
});

export default r;
