/**
 * D1595 (#3868) — three write gates, each shared by its own route and by
 * Fill with Eadwyn's scope for the same table (`services/fills/scopes.ts`),
 * so a fill trigger and the form's Save answer one question one way.
 *
 *   supportBookIds   routes/portfolio_support.ts `scopeFor`: the projects an
 *                    investor may log support against (their accessible book)
 *   offeringOwned    routes/services.ts `ensureOwnerOr404`: an offering's
 *                    owner, narrowed by the active company; an admin passes
 *   myPerk           routes/perks.ts: a partner's own listing, narrowed by
 *                    the active company
 *
 * Moved here with no change of behaviour. `companyId` is always the caller's
 * VERIFIED active company (`activeCompanyFor` / `investorActiveCompany`), or
 * null when none is selected. Every statement is literal; every value is bound.
 */
import type { Env, User } from '../types';
import { investorProjectIds } from '../routes/_investorProjectScope';

/**
 * The caller's accessible book for the support ledger. `ids` is null for an
 * operator (no narrowing); `empty` means a set with nothing in it, which every
 * caller must answer WITHOUT reaching a query.
 */
export async function supportBookIds(env: Env, user: User, companyId: number | null): Promise<{ ids: number[] | null; empty: boolean }> {
  const ids = await investorProjectIds(env, user, companyId);
  return { ids, empty: ids != null && ids.length === 0 };
}

/** Whether a project is in that book: `empty` is checked first, so an empty set never falls through to the operator branch. */
export const inSupportBook = (book: { ids: number[] | null; empty: boolean }, projectId: number) =>
  !book.empty && (book.ids == null || book.ids.includes(Number(projectId)));

export interface OfferingRow { id: number; owner_user_id: number; company_id?: number | null; [k: string]: unknown }

/**
 * The write gate for an offering's PUT and DELETE. The company test runs only
 * AFTER ownership has been established, and an admin is exempt from both. A
 * NULL company on the row means the owner recorded no agency for it, and it
 * stays editable under any of theirs.
 */
export async function offeringOwned<T extends OfferingRow = OfferingRow>(env: Env, id: number, user: User, companyId: number | null): Promise<T | null> {
  const row = await env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?').bind(id).first<T>();
  if (!row) return null;
  if (String(user.role || '') === 'admin') return row;
  if (row.owner_user_id !== user.id) return null;
  const owning = row.company_id ?? null;
  if (companyId !== null && owning !== null && owning !== companyId) return null;
  return row;
}

/**
 * The listing a partner owns, or null. Ownership is the first key; company
 * scoping narrows within it, so it can only ever narrow the caller's OWN
 * listings. A listing with no company stays theirs under all of them.
 */
export async function myPerk<T = Record<string, unknown>>(env: Env, uid: string, userId: number, companyId: number | null = null): Promise<T | null> {
  // Two full literals, never a clause dropped into the query text.
  if (companyId === null) {
    return await env.DB.prepare('SELECT * FROM perks WHERE uid = ? AND partner_user_id = ?').bind(uid, userId).first<T>();
  }
  return await env.DB.prepare(
    `SELECT * FROM perks
      WHERE uid = ? AND partner_user_id = ?
        AND (company_id = ? OR company_id IS NULL)`,
  ).bind(uid, userId, companyId).first<T>();
}
