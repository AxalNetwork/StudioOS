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
 *
 * D4963 — an archived company is read-only until it is restored. `archivedRefusal`
 * is the one 409 every company write shares. D4964 — `canEdit` can take the
 * viewer's link when the caller already read the roster, and makes no query.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { isAdmin } from '../routes/_t13t14t15_helpers';
import { refusalBody } from '../util/refusal';
import { selectJwt } from '../auth';

export async function viewerIsMember(env: Env, companyId: number, viewer: User): Promise<boolean> {
  if (isAdmin(viewer)) return true;
  const link = await env.DB.prepare(
    'SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?'
  ).bind(companyId, viewer.id).first();
  return !!link;
}

type EditLink = { role_in_company: string; is_primary_admin?: number | boolean | null };

/**
 * #4964: `opts.link` is the viewer's link when the caller already read the roster (`detailDto`): `null` means no link,
 * and no query is made. Omitted, the link is read here as before. A platform admin still reads as an editor (D431).
 */
export async function canEdit(env: Env, company: { id: number }, user: User, opts: { link?: EditLink | null } = {}): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (opts.link !== undefined) return linkCanEdit(opts.link);
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
  return linkCanEdit(link);
}

/**
 * #4964: the edit rule on a link already in hand, so a reader that loaded the roster (`detailDto`) decides
 * membership and editing from the same rows instead of two more queries. `canEditAsMember` is this on its own read.
 */
export function linkCanEdit(link: EditLink | null | undefined): boolean {
  if (!link) return false;
  return !!link.is_primary_admin || ['Owner', 'Admin', 'Founder'].includes(link.role_in_company);
}

/**
 * D4963 (#4963) — ONE LIFECYCLE RULE: AN ARCHIVED COMPANY IS READ-ONLY UNTIL IT IS RESTORED.
 *
 * Every write to something the company owns refuses while `archived_at` is set, with the same status, code and
 * sentence. The one write an archived company takes is `POST /company/:uid/restore`. Reads still answer.
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

/**
 * #4964: the same answer as `viewerCapability`, from a roster the caller already loaded, so the company detail
 * makes no further query. `own` is the viewer's link, or null.
 */
export function capabilityFromLink(user: User, support: boolean, own: EditLink | null): ViewerCapability {
  const member = !!own;
  if (support) return { member, can_edit: false, read_only: true, read_only_reason: 'support_session' };
  if (linkCanEdit(own)) return { member: true, can_edit: true, read_only: false, read_only_reason: null };
  if (isAdmin(user) && !own) return { member: false, can_edit: false, read_only: true, read_only_reason: 'hq_access' };
  return { member, can_edit: false, read_only: true, read_only_reason: 'not_an_editor' };
}

/** The 403 for a denial that is not the route's own "not an editor" answer. */
export function denialBody(denial: WriteDenial) {
  return { code: denial.code, reason: denial.reason, detail: denial.message, message: denial.message };
}
