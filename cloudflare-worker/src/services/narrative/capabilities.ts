/**
 * D5074 slice 3 (#5074): the Investor narrative's capabilities, computed once from who the caller is on the venture.
 *
 * The versions read (`GET /api/cycles/raise/modules/investor-narrative/form-options`, `routes/cycle_records.ts`)
 * returns this map, and the narrative's writes refuse from the same function: `narrativeAdminGate`
 * (`./adminRead.ts`) refuses a write when `edit` is false, and the check and use-record writes
 * (`routes/cycle_raise.ts`) refuse `founder_only` when `check` is false. The page draws its controls from the map
 * and never from the account, so it cannot be shown a control the Worker then refuses. The Worker stays the
 * enforcement boundary. The likely questions' answers refuse `founder_only` from `check` too.
 *
 * | Capability              | Founder | Co-founder, other writer | Admin (with a reason) | Support session |
 * |-------------------------|---------|--------------------------|-----------------------|-----------------|
 * | `edit`                  | yes     | yes                      | no (`admin_read_only`) | yes, as the member |
 * | `check`                 | yes     | no                       | no                    | no              |
 * | `note`                  | yes     | yes                      | yes                   | yes             |
 * | `end_read`              | no      | no                       | yes                   | no              |
 * | `admin_reason_required` | no      | no                       | yes                   | no              |
 *
 * `edit` covers every narrative write: a version, a section, positioning, an objection's answer, and Eadwyn's
 * drafts. `check` covers the writes that state the records' figures: running the check against the records, using a
 * record's figure for a claim, and answering the deck's likely questions (D900). It belongs to the venture's founder,
 * as the Evidence read decides it, and never to a support session. `note` is posting a note.
 * `end_read` is ending one's own live read early. `admin_reason_required`: the narrative opens only after a reason
 * the founder sees.
 */
import type { User } from '../../types';
import { isSupportSession } from '../../integrations/providers/mercury';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../../middleware/activeCompany';
import { RaiseEvidenceError, raiseEvidenceContext } from '../raiseEvidence';

export const NARRATIVE_CAPABILITIES = ['edit', 'check', 'note', 'end_read', 'admin_reason_required'] as const;
export type NarrativeCapability = typeof NARRATIVE_CAPABILITIES[number];
export type NarrativeCapabilities = Record<NarrativeCapability, boolean>;

export type NarrativeStanding = {
  /** The account is an admin (on this deployment, or the Super Admin on HQ). */
  admin: boolean;
  /** The venture's founder, as the Evidence read decides it; false for an admin and in a support session. */
  founder: boolean;
};

const isAdminRole = (user: Pick<User, 'role'>) => String(user?.role || '').toLowerCase() === 'admin';

/** The map, from the standing alone. Pure: the read and the writes give it the same standing. */
export function narrativeCapabilities(s: NarrativeStanding): NarrativeCapabilities {
  return {
    edit: !s.admin,
    check: !s.admin && s.founder,
    note: true,
    end_read: s.admin,
    admin_reason_required: s.admin,
  };
}

/** True only for a `true` in the map: no map, an unknown key or any other value allows nothing. */
export const narrativeCan = (caps: Partial<Record<string, unknown>> | null | undefined, key: NarrativeCapability) => caps?.[key] === true;

/** Whether the caller is the venture's founder for the narrative's check (D912): never an admin, never a support session. */
export async function narrativeFounder(c: any, user: User, projectId: number): Promise<boolean> {
  if (isAdminRole(user) || await isSupportSession(c)) return false;
  try {
    const company = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
    return (await raiseEvidenceContext(c.env, user, projectId, company)).founder;
  } catch (e) {
    if (e instanceof RaiseEvidenceError) return false;
    throw e;
  }
}

/** Who the caller is on this venture's narrative. `founder` is read only when asked (the check's writes and the read). */
export async function narrativeStanding(c: any, user: User, projectId: number): Promise<NarrativeStanding> {
  const admin = isAdminRole(user);
  return { admin, founder: admin ? false : await narrativeFounder(c, user, projectId) };
}
