// D633 (#1391, Q2) — the Super Admin's view of one member's credits.
// Worker: routes/perks.ts — GET /perks/admin/credits/:userId reads the
// balance and ledger; POST /perks/admin/credits records an adjustment
// through the grant service (D608). Both are the Super Admin's.
import { request } from '../api.js';

export const memberCreditsApi = {
  // { member: { id, name, email, role }, balance, ledger: [...], truncated }
  read: (userId) => request(`/perks/admin/credits/${encodeURIComponent(userId)}`),
  // { user_id, delta, reason, note, source_ref } → { ok, ledger_id, delta, balance, notified }
  adjust: (body) => request('/perks/admin/credits', { method: 'POST', body: JSON.stringify(body) }),
};
