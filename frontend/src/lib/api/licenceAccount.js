// D798 (#2231) — the territory licence's Administrator reads their own contract,
// statements and payment instructions, and disputes a statement. Worker:
// routes/licence.ts (/api/licence/mine/*), scoped to the caller's own licence.
// D808 (#2250) — the contract in force and pending, its PDF, "Needs you", the
// usage reports by month, and Send now.
import { request, refusalError } from '../api.js';

const enc = encodeURIComponent;

export const licenceAccountApi = {
  // The current contract, `in_force` (the latest signed), `pending` (the current one while sent, with
  // `waiting_on_you`), the superseded ones in `earlier`, and `sign_url` only while it is sent to the caller.
  contract: () => request('/licence/mine/contract'),
  // One of the caller's own contracts as the stored body's PDF (binary endpoint, not typed drift). It returns
  // the blob and its filename and creates no object URL: the caller saves it.
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
  // Issued, paid and void statements, usage reports by period and by month (`usage_months`: sent, late or due
  // against `usage_report_day`), `send_now` with its reason, and the masked `payment` (or its refusal sentence).
  statements: () => request('/licence/mine/statements'),
  // A request to HQ (an escalation); it never writes the statement's disputed amount.
  disputeStatement: (uid, cents, reason) =>
    request(`/licence/mine/statements/${enc(uid)}/dispute`, { method: 'POST', body: JSON.stringify({ cents, reason }) }),
  // "Needs you": the items in order (contract, notice, statement, seats), each with its `link`, the `count` the
  // Licences row's pill draws, and every kind that could not be checked in `unavailable`.
  needs: () => request('/licence/mine/needs'),
  // Send now, on a branch: the usage report the daily run sends, at most once per five minutes.
  sendUsageReport: () => request('/licence/mine/usage-reports/send', { method: 'POST' }),
};
