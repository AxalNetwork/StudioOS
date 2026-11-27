// D6692 (#6692, P1 of #6680) — the formation partner registry, the Worker's
// routes/admin_formation_partners.ts at /api/admin/formation/partners: HQ
// registers a partner firm, records its data terms, licences, coverage by
// country, form and service, prices and members, and the Super Admin
// verifies, suspends or ends it. `cost_minor` is the Super Admin's: it comes
// back on a price only for them, and sending it asks for the write bar.
// Money is integer minor units with a currency. No screen uses this yet (#6702).
import { request } from '../api.js';

const enc = encodeURIComponent;

export const adminFormationPartnersApi = {
  /** {status?} → {items: [{uid, status, partner, coverage_on, coverage_total, licensed_countries, members, …}]} */
  list: ({ status } = {}) => request(`/admin/formation/partners${status ? `?status=${enc(status)}` : ''}`),
  /** One partner: {data_terms, credentials, coverage (with prices), members, cost_visible, …} */
  get: (uid) => request(`/admin/formation/partners/${enc(uid)}`),
  /** {partner_uid, deal_id?}: registers an existing partner firm as a draft. */
  create: (body) => request('/admin/formation/partners', { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** {deal_id?, next_review_on?} */
  update: (uid, body) => request(`/admin/formation/partners/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  /** {data_role?, dpa_document_id?, dpa_signed_on?, transfer_mechanism?, retention_terms?, deletion_contact?, restricted_places?} */
  updateDataTerms: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/data-terms`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  /** {country, licence_type, licence_number, regulator, valid_until, evidence_document_id?, checked_on?} */
  addCredential: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/credentials`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  updateCredential: (uid, credentialUid, body) =>
    request(`/admin/formation/partners/${enc(uid)}/credentials/${enc(credentialUid)}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  /** {country, form_key, service, target_hours?, priority?}: created off. */
  addCoverage: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/coverage`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** {on?, target_hours?, priority?}: on needs a verified partner and a current licence for the country. */
  updateCoverage: (uid, coverageUid, body) =>
    request(`/admin/formation/partners/${enc(uid)}/coverage/${enc(coverageUid)}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  /** {founder_price_minor, currency, cadence, effective_from, effective_to?, cost_minor? (Super Admin)} */
  addPrice: (uid, coverageUid, body) =>
    request(`/admin/formation/partners/${enc(uid)}/coverage/${enc(coverageUid)}/prices`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  updatePrice: (uid, priceUid, body) => request(`/admin/formation/partners/${enc(uid)}/prices/${enc(priceUid)}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  /** {what_was_checked, next_review_on}: Super Admin; refused `dpa_missing` without a signed data agreement. */
  verify: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/verify`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** {reason}: Super Admin; switches every coverage row off. */
  suspend: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/suspend`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** {reason}: Super Admin; switches every coverage row off. */
  end: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/end`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  /** {user_id, role: 'lead' | 'staff'} */
  addMember: (uid, body) => request(`/admin/formation/partners/${enc(uid)}/members`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  revokeMember: (uid, memberUid) => request(`/admin/formation/partners/${enc(uid)}/members/${enc(memberUid)}/revoke`, { method: 'POST' }),
};
