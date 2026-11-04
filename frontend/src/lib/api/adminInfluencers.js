// D4298 (#4298, D4289 P9) — Admin › Programs › Influencers' reads and writes.
// Worker: routes/admin_influencers.ts (P1 #4290, P2 #4291 and this part),
// routes/influencer_offers.ts (P4 #4293) and routes/influencer_analytics.ts (P6 #4295).
// `uid` is the membership's (`influencers.uid`); `userUid` is the account's (`users.uid`),
// which the offers and analytics routes take.
//   list            GET   /admin/influencers?status=active|paused|ended|all
//                   → { influencers: [{ uid, user_uid, person, handle, tier, tier_label, status, signups, visits,
//                       paid_members, revenue, commission }], counts }; money reads { available: false, reason: 'hq_reads' }
//                       for an admin (O-MONEY A)
//   applications    GET   /admin/influencers/applications?status=open|applied|more_requested|admitted|declined|withdrawn|all
//                   → { applications: [{ uid, status, answers, consent_version, reason, created_at, applicant }], counts }
//   decide          POST  /admin/influencers/applications/:uid/decision  { admit: tier } | { decline: reason } | { more: question }
//   change          PATCH /admin/influencers/:uid  { tier?, status?, handle_takedown?: true, reason }
//   flags           GET   /admin/influencers/flags?outcome=held|refused|cleared|upheld|all  → { flags }
//   decideFlag      POST  /admin/influencers/flags/:uid/decision  { decision: clear|uphold, reason }
//   tierDefaults    GET   /admin/influencers/tier-defaults  → { tiers }
//   setTierDefault  PUT   /admin/influencers/tier-defaults/:tier  { percentage_bps?, duration_invoices?, offer_budget_cents?, currency? }
//                   (Super Admin, behind the write bar)
//   offers          GET   /admin/influencers/:userUid/offers  → { offers }
//   linkOffer       POST  /admin/influencers/:userUid/offers  { promo_id, budget_cents, currency, featured?, reason }
//                   (Super Admin, write bar; HQ makes the code in Promos first) → 201 { offer }
//   changeOffer     PATCH /admin/influencers/:userUid/offers/:offerUid  { status?, budget_cents?, featured?, reason }
import { request } from '../api.js';

const enc = encodeURIComponent;
const q = (key, value) => (value ? `?${key}=${enc(value)}` : '');

export const adminInfluencersApi = {
  list: (status = 'all') => request(`/admin/influencers${q('status', status)}`),
  applications: (status = 'open') => request(`/admin/influencers/applications${q('status', status)}`),
  decide: (uid, decision) => request(`/admin/influencers/applications/${enc(uid)}/decision`, { method: 'POST', body: JSON.stringify(decision) }),
  change: (uid, body) => request(`/admin/influencers/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  flags: (outcome = 'held') => request(`/admin/influencers/flags${q('outcome', outcome)}`),
  decideFlag: (uid, decision, reason) => request(`/admin/influencers/flags/${enc(uid)}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) }),
  tierDefaults: () => request('/admin/influencers/tier-defaults'),
  setTierDefault: (tier, body) => request(`/admin/influencers/tier-defaults/${enc(tier)}`, { method: 'PUT', body: JSON.stringify(body) }),
  offers: (userUid) => request(`/admin/influencers/${enc(userUid)}/offers`),
  linkOffer: (userUid, body) => request(`/admin/influencers/${enc(userUid)}/offers`, { method: 'POST', body: JSON.stringify(body) }),
  changeOffer: (userUid, offerUid, body) => request(`/admin/influencers/${enc(userUid)}/offers/${enc(offerUid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
