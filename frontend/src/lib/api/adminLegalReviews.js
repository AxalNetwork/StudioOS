import { request } from '../api.js';

/**
 * D4811 (#4811) part 16: the legal-review record and the counsel role (`routes/admin_legal_reviews.ts`).
 * list(kind, ref)             -> { object: { kind, ref, title, version, sha256 }, reviews: Review[], counsel: Counsel[], viewer: { id, counsel, super_admin } }
 * request(body)               -> { review }. body: { kind, ref, reviewer_id, review_type, jurisdiction, due_on? }
 * decide(id, body)            -> { review }. body: { decision, findings?, required_changes?, sources?, next_review_on? } (assigned counsel only; step-up)
 * counsel()                   -> { counsel: [{ user_id, name, email_hint, firm, granted_at }] }
 * grantCounsel(userId, firm)  -> { counsel } (Super Admin only)
 * revokeCounsel(userId)       -> { ok } (Super Admin only)
 */
const base = '/admin/legal-reviews';
const q = (params) => new URLSearchParams(params).toString();
export const adminLegalReviewsApi = {
  list: (kind, ref) => request(`${base}?${q({ kind, ref })}`),
  request: (body) => request(base, { method: 'POST', body: JSON.stringify(body) }),
  decide: (id, body) => request(`${base}/${Number(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  counsel: () => request(`${base}/counsel`),
  grantCounsel: (userId, firm = '') => request(`${base}/counsel`, { method: 'POST', body: JSON.stringify({ user_id: Number(userId), firm }) }),
  revokeCounsel: (userId) => request(`${base}/counsel/${Number(userId)}`, { method: 'DELETE' }),
};
