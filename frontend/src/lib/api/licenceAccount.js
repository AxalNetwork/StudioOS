// D798 (#2231) — the territory licence's Administrator reads their own contract,
// statements and payment instructions, and disputes a statement. Worker:
// routes/licence.ts (/api/licence/mine/*), scoped to the caller's own licence.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licenceAccountApi = {
  // The stored contract, the superseded ones in `earlier`, and `sign_url` only while it is sent to the caller.
  contract: () => request('/licence/mine/contract'),
  // Issued, paid and void statements, usage reports by period, and the masked `payment` (or its refusal sentence).
  statements: () => request('/licence/mine/statements'),
  // A request to HQ (an escalation); it never writes the statement's disputed amount.
  disputeStatement: (uid, cents, reason) =>
    request(`/licence/mine/statements/${enc(uid)}/dispute`, { method: 'POST', body: JSON.stringify({ cents, reason }) }),
};
