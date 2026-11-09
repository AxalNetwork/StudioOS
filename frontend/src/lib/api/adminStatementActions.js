// D5039 (#5039 part 2) — HQ › Revenue's governed statement actions and the scoped licence picker.
// Worker: routes/admin_statements.ts over services/statementActions.ts (Super Admin; migration 202611090909).
//   issue(uid, body)          POST /admin/statements/:uid/issue     { reason, expected_revision, idempotency_key }
//   recordPayment(uid, body)  POST /admin/statements/:uid/payments  { amount_cents, reference?, reason, expected_revision, idempotency_key }
//   void(uid, body)           POST /admin/statements/:uid/void      { reason, expected_revision, idempotency_key }
//       → { outcome: 'applied', action, statement_uid, settled, before, after, receipt, replayed };
//         the same key again returns the stored reply with replayed: true. Refusals: 400 reason_required,
//         revision_required, idempotency_key_required, bad_amount; 409 changed_since_open { current_revision,
//         current }, invalid_status, incomplete_statement, over_owed, payment_recorded, idempotency_key_reused;
//         a payment and a void are 403 step_up_required without a recent step-up, which `request` handles.
//   licencePicker(params)     GET  /admin/licence-picker?q=&cursor=&limit=
//       → { items: [{ uid, name, territory: ['FR', …] }], next_cursor|null, limit }; 400 bad_cursor
import { request } from '../api.js';

const enc = encodeURIComponent;

export const adminStatementActionsApi = {
  issue: (uid, body) => request(`/admin/statements/${enc(uid)}/issue`, { method: 'POST', body: JSON.stringify(body || {}) }),
  recordPayment: (uid, body) => request(`/admin/statements/${enc(uid)}/payments`, { method: 'POST', body: JSON.stringify(body || {}) }),
  void: (uid, body) => request(`/admin/statements/${enc(uid)}/void`, { method: 'POST', body: JSON.stringify(body || {}) }),
  licencePicker: ({ q, cursor, limit } = {}) => {
    const s = new URLSearchParams();
    if (q) s.set('q', String(q));
    if (cursor) s.set('cursor', String(cursor));
    if (limit) s.set('limit', String(limit));
    const t = s.toString();
    return request(`/admin/licence-picker${t ? `?${t}` : ''}`);
  },
};
