import { request } from '../api.js';

/**
 * D1587 (#3834, deck v2 F8, owner decision R = B): the investor-side deck view
 * (`routes/deck_grants.ts`, at /api/deals).
 *
 * For the investor, on their own deal page:
 *   deck(dealId) -> { granted: false, message } or { granted: true, grant: { uid, granted_at }, venture,
 *                    deck: { title, theme, frozen: { version, as_of }, slides }, included }
 *   The cards are the granted version as the founder ticked it, with no provenance (pd24).
 * For the venture's founder:
 *   grants(dealId)  -> { grants: [{ uid, investor: { user_id, name, firm }, version, included, granted_at, withdrawn_at }],
 *                        investors: [{ user_id, company_id, name, firm }] }  (never a note, score or decision)
 *   grant(dealId, { deck_id, investor_user_id, include? }) -> { uid, version_id, investor_user_id, included }
 *   withdraw(dealId, uid) -> { withdrawn: true }
 */
const base = (dealId) => `/deals/${encodeURIComponent(dealId)}`;

export const deckGrantsApi = {
  deck: (dealId) => request(`${base(dealId)}/deck`),
  grants: (dealId) => request(`${base(dealId)}/deck-grants`),
  grant: (dealId, { deck_id, investor_user_id, include } = {}) => request(`${base(dealId)}/deck-grants`, {
    method: 'POST', body: JSON.stringify({ deck_id, investor_user_id, ...(include ? { include } : {}) }),
  }),
  withdraw: (dealId, uid) => request(`${base(dealId)}/deck-grants/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
};
