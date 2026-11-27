// D752 (#1891) — an investor's own proof-of-funds statements, from their own
// Mercury: what they can share it on, their checking and savings accounts,
// the share, the list with admin views, and revoke. Nothing here moves money.
// No call returns a balance; `accounts()` returns an account id for this
// request only — never store it.
// Worker: routes/mercury_attestations.ts.
import { request } from '../api.js';

export const mercuryAttestationsApi = {
  list: () => request('/mercury/attestations'),
  targets: () => request('/mercury/attestations/targets'),
  accounts: () => request('/mercury/attestations/accounts'),
  share: ({ purpose, target_id, amount_cents, account_ids, consent, consent_version }) => request('/mercury/attestations', {
    method: 'POST',
    body: JSON.stringify({ purpose, target_id, amount_cents, account_ids, consent, consent_version }),
  }),
  revoke: (uid) => request(`/mercury/attestations/${encodeURIComponent(uid)}/revoke`, { method: 'POST' }),
};
