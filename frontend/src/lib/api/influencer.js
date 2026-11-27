// D4289 P7 (#4296) — the member's Influencer section: their membership, handle, links, offers, payout checklist and analytics.
// Every path is a mounted Worker route; nothing here computes a figure.
//   GET  /api/influencer/me                      → { membership | null, application | null, reapply_after, consent_version }   (routes/influencer.ts)
//   GET  /api/influencer/tiers                   → { tiers: [{ tier, label, percentage_bps, duration_invoices, currency }] }
//   GET  /api/influencer/me/handle               → { handle, url, line, next_change_at, status }
//   PUT  /api/influencer/me/handle               { handle?, line? }
//   GET  /api/influencer/me/links                → { handle, links: [{ uid, channel, utm_campaign, url }] }
//   POST /api/influencer/me/links                { channel, utm_campaign? } → 201 { link }
//   DELETE /api/influencer/me/links/:uid         → 204 (archived)
//   GET  /api/influencer/me/offers               → { offers: [...] }     (routes/influencer_offers.ts, IN3)
//   POST /api/influencer/me/offers/request       { message } "Ask HQ for an offer"
//   GET  /api/influencer/me/payout-readiness     → { influencer, ready, currency, minimum_cents, items }   (routes/influencer_payouts.ts, IN4)
//   GET  /api/influencer/me/tax-form             → { status, form_type, submitted_at, decided_at, reason }
//   POST /api/influencer/me/tax-form             { form_type: 'w9' | 'w8ben', file: data URI }
//   POST /api/influencer/me/terms/accept         { version }
//   GET  /api/influencer/me/analytics?from&to&channel&grain=week   (routes/influencer_analytics.ts)
// The payout request itself is `api.payoutRequest` (`POST /api/network/payout/request`) in `../api.js`.
import { request } from '../api.js';

const enc = encodeURIComponent;

/** `?from&to&channel&grain=week`, leaving out what is not given. */
export function analyticsQuery({ from, to, channel } = {}) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (channel) q.set('channel', channel);
  q.set('grain', 'week');
  return q.toString();
}

export const influencerApi = {
  me: () => request('/influencer/me'),
  tiers: () => request('/influencer/tiers'),
  handle: () => request('/influencer/me/handle'),
  setHandle: (body) => request('/influencer/me/handle', { method: 'PUT', body: JSON.stringify(body) }),
  links: () => request('/influencer/me/links'),
  addLink: (body) => request('/influencer/me/links', { method: 'POST', body: JSON.stringify(body) }),
  archiveLink: (uid) => request(`/influencer/me/links/${enc(uid)}`, { method: 'DELETE' }),
  offers: () => request('/influencer/me/offers'),
  requestOffer: (message) => request('/influencer/me/offers/request', { method: 'POST', body: JSON.stringify({ message }) }),
  payoutReadiness: () => request('/influencer/me/payout-readiness'),
  taxForm: () => request('/influencer/me/tax-form'),
  submitTaxForm: (body) => request('/influencer/me/tax-form', { method: 'POST', body: JSON.stringify(body) }),
  acceptTerms: (version) => request('/influencer/me/terms/accept', { method: 'POST', body: JSON.stringify({ version }) }),
  analytics: (opts) => request(`/influencer/me/analytics?${analyticsQuery(opts)}`),
};
