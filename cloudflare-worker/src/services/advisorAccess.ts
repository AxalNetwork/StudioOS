/**
 * #4715 (D4715 part 4) — the advisor access policy, in one place.
 *
 * Every advisor route answers the same three questions, in this order:
 *
 *   1. ELIGIBILITY. Does the signed-in account hold the Advisor licence today,
 *      as its primary role or as an additional licence that has not been
 *      revoked (D4472)? `requireAuth` reloads the account on every request, so
 *      this is the CURRENT answer: a demotion or a revoked licence takes effect
 *      on the next request. An admin passes for the advisor's own profile
 *      routes; cohort reads stay licence-only (`mayHoldCohortAssignment`).
 *   2. OWNERSHIP. Is the advisor row this request acts on the account's own?
 *      An account owns the `advisors` row whose `user_id` is its id. The
 *      stored `users.advisor_id` pointer is a shortcut to that row, never a
 *      grant on its own: it is honoured only when the row it names has this
 *      account as its `user_id`.
 *   3. THE RECORD. Is the booking, engagement, deliverable or slot on that
 *      row? Each route filters by the owned row's id, never by a path id.
 *
 * A founder's side of a booking (the founder who made it) does not depend on
 * any licence and is not checked here.
 *
 * Before this module, the booking transitions and the review write compared
 * `users.advisor_id` with the booking's advisor and checked neither the
 * licence nor ownership, so an account that had lost the Advisor licence
 * could still confirm, complete, mark no-show and review as the advisor.
 */
import type { Env, User } from '../types';
import { holdsLicence } from './accountLicences';

export type OwnedAdvisorRow = { id: number; user_id: number | null; [k: string]: unknown };

/** The one refusal for an account that holds no Advisor licence. */
export const ADVISOR_LICENCE_REQUIRED = {
  code: 'advisor_licence_required',
  message: 'An advisor profile needs the Advisor licence.',
} as const;

const isAdminAccount = (user: User) => String(user.role || '').toLowerCase() === 'admin';

/** 1. Eligibility for the advisor's own profile and practice. */
export function mayActAsAdvisor(user: User): boolean {
  return holdsLicence(user, 'advisor') || isAdminAccount(user);
}

/**
 * 1 + 2. The advisor row this account may act as, or null: null when the
 * account is not eligible, or when no row has this account as its `user_id`.
 */
export async function actingAdvisor<T extends OwnedAdvisorRow = OwnedAdvisorRow>(env: Env, user: User): Promise<T | null> {
  if (!mayActAsAdvisor(user)) return null;
  const pointer = (user as any).advisor_id;
  if (pointer) {
    const row = await env.DB.prepare('SELECT * FROM advisors WHERE id = ?').bind(pointer).first<T>();
    if (row?.user_id === user.id) return row;
  }
  return env.DB.prepare('SELECT * FROM advisors WHERE user_id = ?').bind(user.id).first<T>();
}

/** True when this account may act as the advisor on a record held by `advisorId`. */
export async function actsForAdvisor(env: Env, user: User, advisorId: number | null | undefined): Promise<boolean> {
  if (advisorId == null) return false;
  const own = await actingAdvisor(env, user);
  return !!own && Number(own.id) === Number(advisorId);
}
