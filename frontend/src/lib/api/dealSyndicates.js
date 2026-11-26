// D6200 (#6200, DL13) — the syndicates an invited investor may join from a deal page:
//   GET /api/networkfx/syndicates?deal_id= → the open syndicates on the deal's
//   company, for an investor invited to that exact deal: lead, status, target,
//   minimum and member count, never a member's name (`routes/networkfx.ts`).
//   POST /api/networkfx/syndicates/:id/join { commitment_cents, deal_id } →
//   records a pledge bound to that deal's invitation. It moves no money.
import { request } from '../api.js';

export const dealSyndicatesApi = {
  open: (dealId) => request(`/networkfx/syndicates?deal_id=${encodeURIComponent(dealId)}`),
  join: (syndicateId, { commitmentCents, dealId }) => request(`/networkfx/syndicates/${encodeURIComponent(syndicateId)}/join`, {
    method: 'POST',
    body: JSON.stringify({ commitment_cents: commitmentCents, deal_id: dealId }),
  }),
};
