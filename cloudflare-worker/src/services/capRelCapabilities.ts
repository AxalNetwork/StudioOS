/**
 * D5074 slice 4 (#5074): Capital relationships' capabilities, computed once from who the caller is on the venture.
 *
 * The module read (`GET /api/cycles/raise/modules/capital-relationships`) returns this map, in both its modes (the
 * working read for the venture's owner and co-founders, the counts-only summary for staff), and the Worker refuses
 * from the same function: `scope` in `routes/cycle_raise.ts` refuses every capital request outside `work` for a
 * non-staff caller (403 `Forbidden`); the support-read write refuses outside `support_read` (403 `admin_required`);
 * the founder's list of reasoned reads refuses outside `support_reads`. The page draws its states from the map and
 * never from the account. The Worker stays the enforcement boundary.
 *
 * | Capability              | Owner, co-founder | Staff (admin, the Super Admin on HQ) | Investor, advisor, anyone else |
 * |-------------------------|-------------------|--------------------------------------|--------------------------------|
 * | `work`                  | yes               | no                                   | no (no read at all)            |
 * | `support_reads`         | yes               | no                                   | no                             |
 * | `support_read`          | no                | yes                                  | no                             |
 * | `admin_reason_required` | no                | yes                                  | no                             |
 *
 * `work` is every tab's read and write: the pipeline, Calls, Match (and its rank), Outreach, Commitments, Activity,
 * Closing and the prospects. `support_reads` is the founder's list of who read the pipeline with a reason (D1464).
 * `support_read` is the reasoned, read-only support view; `admin_reason_required` says it opens only with a reason the
 * founder sees. A support session is refused before any of this (`support_session_refused`), so it never reads a map.
 */
import type { User } from '../types';
import type { ProjectRef } from '../routes/_founder_validate_helpers';
import type { Env } from '../types';
import { capitalCanWork, capitalStaff } from './capRelAccess';

export const CAPREL_CAPABILITIES = ['work', 'support_reads', 'support_read', 'admin_reason_required'] as const;
export type CapRelCapability = typeof CAPREL_CAPABILITIES[number];
export type CapRelCapabilities = Record<CapRelCapability, boolean>;

export type CapRelStanding = {
  /** The account is staff (an admin, or the Super Admin on HQ). */
  staff: boolean;
  /** The venture's owner or an accepted co-founder (`capitalCanWork`); never staff or an investor. */
  worker: boolean;
};

/** The map, from the standing alone. Pure: the read and the writes give it the same standing. */
export function capRelCapabilities(s: CapRelStanding): CapRelCapabilities {
  const works = !s.staff && s.worker;
  return { work: works, support_reads: works, support_read: s.staff, admin_reason_required: s.staff };
}

/** True only for a `true` in the map: no map, an unknown key or any other value allows nothing. */
export const capRelCan = (caps: Partial<Record<string, unknown>> | null | undefined, key: CapRelCapability) => caps?.[key] === true;

/** Who the caller is on this venture's Capital relationships. Throws `CapitalAccessError` when access cannot be read. */
export async function capRelStanding(env: Env, project: ProjectRef, user: User): Promise<CapRelStanding> {
  const staff = capitalStaff(user);
  return { staff, worker: staff ? false : await capitalCanWork(env, project, user) };
}
