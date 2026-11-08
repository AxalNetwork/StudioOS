/**
 * The two company gates, in one place (D1592, #3860). They were module-private
 * in `routes/company.ts`; `company.ts` and `company_documents.ts` both import
 * them from here, so the rule is written once and never copied.
 *
 *   viewerIsMember  a platform admin, or a member of the company (a
 *                   `user_company_links` row).
 *   canEdit         a platform admin, the primary admin, or a member whose
 *                   role in the company is Owner, Admin or Founder.
 *   canEditAsMember the same without the platform admin: a company's own
 *                   editors only (D4161, for what HQ may moderate but never write).
 *
 * D4960 — WHO MAY WRITE, AND WHO IS TOLD SO. `canEdit` still decides what an
 * HQ admin may READ (a company's economics), but it no longer decides a write.
 * Every company settings write (General, Logo, Legal, Documents, Team,
 * Members, Invitations) goes through `companyWriteDenial`:
 *   - a support session writes nothing (`support_session`): it acts as the
 *     member it impersonates, and the platform's rule is that support reads;
 *   - a platform admin writes only through a seat they hold in the company
 *     (`hq_access` when they hold none): D4360's read-only frame, enforced here
 *     and not by hiding a link;
 *   - everyone else needs an Owner, Admin or Founder seat or primary admin.
 * `viewerCapability` is the same rule as a read, returned with the company so
 * the page draws what the server will accept and nothing else.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { isAdmin } from '../routes/_t13t14t15_helpers';
import { selectJwt } from '../auth';

export async function viewerIsMember(env: Env, companyId: number, viewer: User): Promise<boolean> {
  if (isAdmin(viewer)) return true;
  const link = await env.DB.prepare(
    'SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?'
  ).bind(companyId, viewer.id).first();
  return !!link;
}

export async function canEdit(env: Env, company: { id: number }, user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  return canEditAsMember(env, company, user);
}

/**
 * `canEdit` without the admin pass: only the company's own editors by their
 * link. What a company owns outright, such as its agent skills (D4161), is
 * written by its editors and never by HQ, whose admins moderate instead.
 */
export async function canEditAsMember(env: Env, company: { id: number }, user: User): Promise<boolean> {
  const link = await env.DB.prepare(
    'SELECT role_in_company, is_primary_admin FROM user_company_links WHERE company_id = ? AND user_id = ?'
  ).bind(company.id, user.id).first<{ role_in_company: string; is_primary_admin: number }>();
  if (!link) return false;
  return !!link.is_primary_admin || ['Owner', 'Admin', 'Founder'].includes(link.role_in_company);
}

export type WriteDenialReason = 'support_session' | 'hq_access' | 'not_an_editor';
export type WriteDenial = { reason: WriteDenialReason; code: string; message: string };

/** True when the request rides a support session (`impersonated_by` on the JWT, as Mercury's gate reads it). */
export async function isSupportSession(c: Context<{ Bindings: Env }>): Promise<boolean> {
  return !!(await selectJwt(c))?.payload?.impersonated_by;
}

const DENIALS: Record<WriteDenialReason, WriteDenial> = {
  support_session: { reason: 'support_session', code: 'support_session_refused', message: 'A support session can read this company but cannot change it.' },
  hq_access: { reason: 'hq_access', code: 'company_read_only', message: 'HQ reads this company. Its members make the changes here.' },
  not_an_editor: { reason: 'not_an_editor', code: 'not_an_editor', message: 'Only an Owner, Admin, Founder or the primary admin can change this.' },
};

/** Why `user` may not write `company`, or null when they may. `support` is `isSupportSession(c)`. */
export async function companyWriteDenial(env: Env, company: { id: number }, user: User, support: boolean): Promise<WriteDenial | null> {
  if (support) return DENIALS.support_session;
  if (await canEditAsMember(env, company, user)) return null;
  if (isAdmin(user) && !(await hasSeat(env, company, user))) return DENIALS.hq_access;
  return DENIALS.not_an_editor;
}

async function hasSeat(env: Env, company: { id: number }, user: User): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(company.id, user.id).first());
}

export type ViewerCapability = { member: boolean; can_edit: boolean; read_only: boolean; read_only_reason: WriteDenialReason | null };

/** What the server will let this viewer do here, for the company read. */
export async function viewerCapability(env: Env, company: { id: number }, user: User, support: boolean): Promise<ViewerCapability> {
  const denial = await companyWriteDenial(env, company, user, support);
  return { member: await hasSeat(env, company, user), can_edit: denial == null, read_only: denial != null, read_only_reason: denial?.reason ?? null };
}

/** The 403 for a denial that is not the route's own "not an editor" answer. */
export function denialBody(denial: WriteDenial) {
  return { code: denial.code, reason: denial.reason, detail: denial.message, message: denial.message };
}
