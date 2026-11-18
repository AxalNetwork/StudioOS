/**
 * D6052 (#6052): inviting a raise prospect who has no Axal account, through Contacts' one invite path.
 *
 * `POST /api/contacts/invite` with a `prospect_id` sends the invitation and records it in
 * `raise_prospect_invites` (who invited whom, when, to which address, whether it left). This module holds the
 * rules that route and the Call for Capital's audience step share: who may invite, how soon an invitation may
 * be sent again, and the read that links an account to its invitation once one exists. Linking adds nobody to
 * a call: a call's audience still takes only an active investor whose KYC is approved (services/roundCalls.ts).
 */
import type { Env, User } from '../types';
import { holdsLicence } from './accountLicences';

/** One sent invitation per prospect in this many hours; a failed send does not count. */
export const PROSPECT_INVITE_GAP_HOURS = 24;

/** The reason the button gives when the viewer cannot invite. */
export const INVITE_ROLE_REASON = 'Only the venture’s founder can invite an investor to Axal.';

/** The founder who owns the venture. Staff, members and Spin-Out Lab accounts cannot invite. */
export function canInviteProspect(user: Pick<User, 'role' | 'founder_id'> & { licences?: readonly string[] }, project: { founder_id: number | null }): boolean {
  return user.role !== 'admin' && holdsLicence(user, 'founder') && user.founder_id != null && project.founder_id != null
    && Number(project.founder_id) === Number(user.founder_id);
}

/** The earliest `invited_at` that still blocks a new invitation, as an ISO string. */
export function inviteCutoff(at: string): string {
  return new Date(Date.parse(at) - PROSPECT_INVITE_GAP_HOURS * 3600_000).toISOString();
}

/**
 * Stamp each sent, unlinked invitation of the venture whose address now has an account. The address was
 * lower-cased when the invitation was written, and the account is matched the same way.
 */
export async function linkAcceptedInvites(env: Env, projectId: number, at: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE raise_prospect_invites
        SET accepted_user_id = (SELECT u.id FROM users u WHERE LOWER(u.email) = raise_prospect_invites.email ORDER BY u.id LIMIT 1),
            accepted_at = ?
      WHERE project_id = ? AND email_sent = 1 AND accepted_user_id IS NULL
        AND EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = raise_prospect_invites.email)`,
  ).bind(at, projectId).run();
}

export type ProspectInviteState = {
  prospect_id: number;
  /** Whether the pipeline holds an address for the prospect. The address itself is not returned. */
  has_email: boolean;
  /** The latest invitation that left, or null. */
  invited_at: string | null;
  /** When an account with the invited address was linked, or null. */
  joined_at: string | null;
};

/** Each prospect of the venture with its invitation state, after linking any account that now exists. */
export async function prospectInviteStates(env: Env, projectId: number, at: string): Promise<ProspectInviteState[]> {
  await linkAcceptedInvites(env, projectId, at);
  const rows = await env.DB.prepare(
    `SELECT p.id AS prospect_id,
            CASE WHEN p.email IS NOT NULL AND TRIM(p.email) <> '' THEN 1 ELSE 0 END AS has_email,
            (SELECT MAX(i.invited_at) FROM raise_prospect_invites i WHERE i.prospect_id = p.id AND i.email_sent = 1) AS invited_at,
            (SELECT MIN(i.accepted_at) FROM raise_prospect_invites i WHERE i.prospect_id = p.id AND i.accepted_user_id IS NOT NULL) AS joined_at
       FROM raise_prospects p WHERE p.project_id = ? ORDER BY p.id`,
  ).bind(projectId).all<{ prospect_id: number; has_email: number; invited_at: string | null; joined_at: string | null }>();
  return (rows.results || []).map(r => ({ prospect_id: Number(r.prospect_id), has_email: Number(r.has_email) === 1,
    invited_at: r.invited_at ?? null, joined_at: r.joined_at ?? null }));
}
