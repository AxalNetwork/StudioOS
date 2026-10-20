// D799 (#2232) — the Administrator's requests to HQ: a renewal, a term change,
// more seats, a delegate admin, notice of non-renewal, and the older kinds.
// One path on either tier: on HQ the Worker writes HQ's ledger, on a branch it
// hands the call to the branch's "To HQ" lane. HQ's answer arrives in the bell.
// Worker: routes/licence_requests.ts.
import { request } from '../api.js';

export const licenceRequestsApi = {
  /** This licence's requests and HQ's answers, with the kinds this licence offers. */
  list: () => request('/licence/mine/requests'),
  /** `{ kind, subject, detail?, request? }`; `request` carries the kind's own fields. */
  raise: ({ kind, subject, detail, request: fields } = {}) => request('/licence/mine/requests', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      subject,
      ...(detail !== undefined ? { detail } : {}),
      ...(fields !== undefined ? { request: fields } : {}),
    }),
  }),
};
