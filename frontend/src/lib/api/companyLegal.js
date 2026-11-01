// D1415 — a company as a legal entity: its legal record, sealed tax ID,
// officers and directors, locations and slug. A member reads; an owner, admin
// or founder of the company writes. `taxId({ full: true })` asks for the
// number itself, for an editor's own edit field (never for a platform admin).
// Officers are ceased and locations closed, never deleted.
// Worker: routes/company_legal.ts; the default currency (#3932) is a field of
// PATCH /api/company/:uid in routes/company.ts, read back as `default_currency`
// on GET /api/company/:uid (null is "Not recorded").
import { request } from '../api.js';

const base = (uid) => `/company/${encodeURIComponent(uid)}`;
const send = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const companyLegalApi = {
  legal: (uid) => request(`${base(uid)}/legal`),
  saveLegal: (uid, fields) => request(`${base(uid)}/legal`, send('PUT', fields)),
  taxId: (uid, { full = false } = {}) => request(`${base(uid)}/tax-id${full ? '?full=1' : ''}`),
  saveTaxId: (uid, kind, taxId) => request(`${base(uid)}/tax-id`, send('PUT', { kind, tax_id: taxId })),
  officers: (uid) => request(`${base(uid)}/officers`),
  addOfficer: (uid, officer) => request(`${base(uid)}/officers`, send('POST', officer)),
  editOfficer: (uid, officerUid, fields) => request(`${base(uid)}/officers/${encodeURIComponent(officerUid)}`, send('PATCH', fields)),
  ceaseOfficer: (uid, officerUid, ceasedOn) => request(`${base(uid)}/officers/${encodeURIComponent(officerUid)}/cease`, send('POST', ceasedOn ? { ceased_on: ceasedOn } : {})),
  locations: (uid) => request(`${base(uid)}/locations`),
  addLocation: (uid, location) => request(`${base(uid)}/locations`, send('POST', location)),
  editLocation: (uid, locUid, fields) => request(`${base(uid)}/locations/${encodeURIComponent(locUid)}`, send('PATCH', fields)),
  closeLocation: (uid, locUid, closedOn) => request(`${base(uid)}/locations/${encodeURIComponent(locUid)}/close`, send('POST', closedOn ? { closed_on: closedOn } : {})),
  setCompanySlug: (uid, slug) => request(`${base(uid)}/slug`, send('PUT', { slug })),
  // #3932: an ISO 4217 code ('EUR'), or null to clear it; a code off the list is 422 currency_invalid.
  setDefaultCurrency: (uid, code) => request(base(uid), send('PATCH', { default_currency: code })),
};
