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
 */
import type { Env, User } from '../types';
import { isAdmin } from '../routes/_t13t14t15_helpers';

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
