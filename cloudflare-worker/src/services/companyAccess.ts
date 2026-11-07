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
import { refusalBody } from '../util/refusal';

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

/**
 * D4963 (#4963) — ONE LIFECYCLE RULE: AN ARCHIVED COMPANY IS READ-ONLY UNTIL IT IS RESTORED.
 *
 * Every write to something the company owns refuses while `archived_at` is set, with the same status, code and
 * sentence: General (PATCH /company/:uid and /company/me), the logo, Legal (legal, tax id, officers, locations, slug),
 * documents, compliance, Team (members, invitations, people, coverage, plan) and the venture moves into or out of it.
 * The one write an archived company takes is `POST /company/:uid/restore`. Reads still answer, so its members see
 * what they are restoring. `company_archive_gate_4963.test.ts` lists every write route
 * and asserts each refuses.
 *
 * 409 (not 410): the company exists and the request is valid; the state it is in conflicts with the change.
 * `error` and `code` both carry `archived`, because older routes answered `{ code }` and newer ones `{ error }`.
 */
export const ARCHIVED_CODE = 'archived';
export const ARCHIVED_MESSAGE = 'This company is archived. Restore it before you change it.';

export const isArchived = (company: { archived_at?: string | null } | null | undefined): boolean =>
  !!company && company.archived_at != null && company.archived_at !== '';

/** The one refusal for a write to an archived company. */
export function archivedRefusal(c: { json: (body: unknown, status: any) => Response }): Response {
  return c.json(
    refusalBody({ code: ARCHIVED_CODE, message: ARCHIVED_MESSAGE, extra: { code: ARCHIVED_CODE } }),
    409,
  );
}

/** The archived state of a company by id, for routes that hold only the id. Null when there is no such company. */
export async function archivedById(env: Env, companyId: number): Promise<boolean | null> {
  const row = await env.DB.prepare('SELECT archived_at FROM company_profiles WHERE id = ?')
    .bind(companyId).first<{ archived_at: string | null }>();
  return row ? isArchived(row) : null;
}
