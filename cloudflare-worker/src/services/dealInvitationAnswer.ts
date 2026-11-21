/**
 * D6425 (#6425): the one notice a studio gets when an investor answers its deal
 * invitation, sent by `POST /api/deals/:id/invitations/respond` and by a Deal flow
 * pass that answers the invitation (`services/dealFlow.ts` `passDeal`), so the two
 * never drift. Best effort: a notice that cannot be sent never undoes the answer.
 */
import type { Env } from '../types';

export type InvitationResponse = 'interested' | 'passed';

export async function notifyInvitationAnswer(env: Env, a: {
  inviterId: number | null | undefined; investorName: string | null | undefined; dealId: number; response: InvitationResponse;
}): Promise<void> {
  try {
    if (!a.inviterId) return;
    const { notify } = await import('./notify');
    const who = a.investorName || 'An investor';
    await notify(env, {
      userId: a.inviterId,
      type: 'deal_invitation_response',
      title: `${who} is ${a.response} in a deal`,
      body: `${who} responded '${a.response}' to your invitation.`,
      link: `/deals/${a.dealId}`,
      payload: { deal_id: a.dealId, response: a.response },
      channels: ['in_app'],
      category: 'deals',
    });
  } catch (e) {
    console.warn('[deals] invitation response notify failed', (e as Error)?.message);
  }
}
