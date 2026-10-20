// D798 (#2231) — the territory licence's Administrator reads their own contract,
// statements, payment instructions and what needs them, and disputes a
// statement. Worker: routes/licence.ts (/api/licence/mine/*), scoped to the
// caller's own licence. Nothing here returns a full account number.
import { request, refusalError } from '../api.js';

const enc = encodeURIComponent;

export const licenceAccountApi = {
  // `in_force` (latest signed), `pending` (sent, unsigned), `earlier`, and `sign_url` only while it is sent to the caller.
  contract: () => request('/licence/mine/contract'),
  // One contract's PDF, printed from its stored body (binary endpoint, not typed drift). Returns the blob and its
  // filename and creates no object URL: the caller saves it.
  contractPdfBlob: async (uid) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/licence/mine/contract/${enc(uid)}/pdf`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await refusalError(res, 'The contract PDF could not be downloaded.');
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `contract-${uid}.pdf`;
    return { blob, filename };
  },
  // Issued, paid and void statements, each period's usage report (`usage`), and the masked `payment` or its refusal.
  statements: () => request('/licence/mine/statements'),
  // The Summary's "Needs you" list and the sidebar count, in order, each item with its link.
  needs: () => request('/licence/mine/needs'),
  // "Send now": a branch's own usage push. HQ answers 501 usage_branch_only.
  sendUsage: () => request('/licence/mine/usage/send', { method: 'POST' }),
  // A request to HQ (an escalation); it never writes the statement's disputed amount.
  disputeStatement: (uid, cents, reason) =>
    request(`/licence/mine/statements/${enc(uid)}/dispute`, { method: 'POST', body: JSON.stringify({ cents, reason }) }),
};
