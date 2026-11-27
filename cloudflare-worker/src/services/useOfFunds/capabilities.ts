/**
 * D5074 slice 5 (#5074): Use of funds' capabilities, computed once from who the caller is on the venture.
 *
 * The plan read (`GET /api/cycles/raise/use-of-funds/plan`) returns this map, and `routes/cycle_use_of_funds.ts`
 * refuses from the same function: every write (any method but GET) outside `edit` is refused 403
 * `support_read_only`, and Mercury's cached facts are read only under `mercury`. The page draws its edit controls,
 * the admin banner and the Mercury states from the map and never from the account. The Worker stays the enforcement
 * boundary; who may open the plan at all is still the shared Raise gate (`canWrite`: the venture's founder or an
 * admin), refused 403 `forbidden` with no map.
 *
 * | Capability     | Founder (own session) | Admin        | Support session (acting as anyone) |
 * |----------------|-----------------------|--------------|------------------------------------|
 * | `edit`         | yes                   | yes          | no (`support_read_only`)           |
 * | `mercury`      | yes                   | no           | no                                 |
 * | `admin_logged` | no                    | yes          | as the account it acts as          |
 *
 * `edit` is every plan write: the split, scenarios (and make-base), milestones, hires and the round size.
 * `mercury` is reading the founder's own Mercury figures (runway today, actual spend, cash over time).
 * `admin_logged` says the caller's changes are logged under an admin's name (the UF16 banner).
 */
import type { User } from '../../types';

export const UOF_CAPABILITIES = ['edit', 'mercury', 'admin_logged'] as const;
export type UofCapability = typeof UOF_CAPABILITIES[number];
export type UofCapabilities = Record<UofCapability, boolean>;

export type UofStanding = {
  /** The account is an admin. */
  admin: boolean;
  /** The account is the founder whose venture this is (role founder, the project's founder_id). */
  founderAccount: boolean;
  /** A support session (an impersonated token). */
  support: boolean;
};

/** The map, from the standing alone. Pure: the read and the writes give it the same standing. */
export function uofCapabilities(s: UofStanding): UofCapabilities {
  return { edit: !s.support, mercury: s.founderAccount && !s.support && !s.admin, admin_logged: s.admin };
}

/** True only for a `true` in the map: no map, an unknown key or any other value allows nothing. */
export const uofCan = (caps: Partial<Record<string, unknown>> | null | undefined, key: UofCapability) => caps?.[key] === true;

/** Who the caller is on this venture's Use of funds. */
export function uofStanding(user: User, project: { founder_id: unknown }, support: boolean): UofStanding {
  return {
    admin: String(user.role || '').toLowerCase() === 'admin',
    founderAccount: user.role === 'founder' && Number(user.founder_id) === Number(project.founder_id),
    support,
  };
}
