/**
 * D7178 (#7178, canvas #7044) — who may read Research › Companies: a held Founder or Advisor licence, an active
 * Spin-Out Lab, or an admin. The same rule the SPA's route guard applies to `/research/companies*`
 * (`guard(labRoles(['admin', 'founder', 'advisor']))` with RoleGuard reading the held licences, D4473), so a direct
 * link, an in-app link and the Worker give one answer. A support session reads as the member it supports: the
 * principal is that member, so their licences decide.
 */
import type { Context } from 'hono';
import type { User } from '../types';
import { holdsLicence } from './accountLicences';
import { refuse } from '../util/refusal';

/** The licences that open Companies. */
export const COMPANIES_LICENCES = ['founder', 'advisor'] as const;

/** True when `user` may read the company directory and its profiles. Reads the hydrated `licences` (auth.ts). */
export function admitsCompanies(user: Pick<User, 'role' | 'spinout_lab_active'> & { licences?: readonly string[] }): boolean {
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  if (Number(user.spinout_lab_active ?? 0) === 1) return true;
  return COMPANIES_LICENCES.some((licence) => holdsLicence(user, licence));
}

/** The 403 an account without the rule gets: our sentence, never the company it asked for. */
export function refuseCompanies(c: Context<any>): Response {
  return refuse(c, 403, {
    code: 'companies_licence_required',
    message: 'Companies is open to Founder and Advisor licences. This account holds neither.',
  });
}
