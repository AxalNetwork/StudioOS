// D6238 (#6238) — one capital call: its page read, and correcting or withdrawing it (routes/funds.ts).
//
// `read` answers the call as corrected, its lines, and the receipts, comms
// and Axal notices on them, each of the last three with its own status so
// one that failed reads Unreadable. `correct` changes the due date or the
// purpose; `withdraw` withdraws a call nothing was paid against. Both are
// the Super Admin's, or the fund's GP of record's; the Worker decides.
import { request } from '../api.js';

export const fundCallsApi = {
  read: (fundId, callId) => request(`/funds/${fundId}/capital-calls/${callId}`),
  correct: (fundId, callId, data) =>
    request(`/funds/${fundId}/capital-calls/${callId}/correct`, { method: 'POST', body: JSON.stringify(data) }),
  withdraw: (fundId, callId, data) =>
    request(`/funds/${fundId}/capital-calls/${callId}/withdraw`, { method: 'POST', body: JSON.stringify(data) }),
};
