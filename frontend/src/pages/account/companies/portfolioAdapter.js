/**
 * D1413 (#3696) — THE SEAM between the Portfolio screens and the Worker.
 *
 * Every read and write the Portfolio pages make that is not D1136's own
 * (`accountCompaniesApi`) comes through this file, in `agentsAdapter.js`'s
 * style (D1497): a call answers `{ available: true, value }` or
 * `{ available: false, reason }`, with `notFound`, `refused` or `unreadable`
 * saying why. Nothing here turns a failed read into "none": an empty list is
 * a fact only the Worker states.
 *
 * WIRED, each on a route that is on main:
 *   switcher, settingsScope, resolve, setProjectSlug    D1415 part 2  `accountPortfolioApi`
 *   legal, saveLegal, taxId, saveTaxId, officers,
 *   addOfficer, ceaseOfficer, addLocation,
 *   closeLocation, setCompanySlug                       D1415 part 1, D1593  `companyLegalApi`
 *   documents, uploadDocument, downloadDocument          D1592  `companyDocumentsApi`
 *   slugCheck                                           D1591  `slugsApi`
 *   projectAgents                                       D1496 (#3840), through Team's seam
 *
 * STILL UNAVAILABLE, a one-line body until its route lands. The builder adds
 * the client method in the same PR as the route and replaces only the body:
 *
 *   #3932  defaultCurrency   Company settings › General's "Default currency"
 *                            row reads "Coming later", never "USD" (owner Q4)
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 */
import { accountPortfolioApi } from '../../../lib/api/accountPortfolio.js';
import { companyLegalApi } from '../../../lib/api/companyLegal.js';
import { companyDocumentsApi } from '../../../lib/api/companyDocuments.js';
import { slugsApi } from '../../../lib/api/slugs.js';
import { listAgents } from '../../team/agentsAdapter.js';

/** What a seam answers before its route exists: the reason and the issue it waits on. */
export const unavailable = (reason, waitsOn = null) => ({ available: false, reason, waitsOn });

/**
 * A client call, as the pages read it. 404 is "not yours" (the Worker answers
 * an unknown company and one you are not in the same way); 403 a refusal;
 * 400/409 a refusal in the Worker's own words, never echoing what was sent;
 * anything else "could not be read".
 */
export async function through(call) {
  try {
    return { available: true, value: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    const code = e?.code || e?.data?.code || e?.data?.error || null;
    if (status === 404) return { available: false, notFound: true, code, reason: 'This is not yours to open.' };
    if (status === 403) return { available: false, refused: true, code, reason: e?.message || 'Only an admin of this company can change this.' };
    if ((status === 400 || status === 409 || status === 422) && code) return { available: false, refused: true, code, reason: e?.message || 'That could not be saved.' };
    return { available: false, unreadable: true, code, reason: 'could not be read' };
  }
}

// ---------------------------------------------------------------- D1415 part 2: wired

/** `GET /api/account/switcher` → companies with their projects, `standalone`, `elsewhere`, each a block. */
export const switcher = () => through(() => accountPortfolioApi.switcher());
/** `GET /api/account/settings-scope` → the tabs that apply to a selection. */
export const settingsScope = (q) => through(() => accountPortfolioApi.settingsScope(q));
/** `GET /api/account/resolve?path=` → `{ kind, company_uid, project_id, canonical_path, redirected }`. */
export const resolve = (path) => through(() => accountPortfolioApi.resolve(path));
/** `PUT /api/projects/:id/slug`. */
export const setProjectSlug = (id, slug) => through(() => accountPortfolioApi.setProjectSlug(id, slug));

// ---------------------------------------------------------------- D1415 part 1 and D1593: wired

/** `GET /api/company/:uid/legal` → the legal fields, `registered_agent_name`, and each address, the tax ID, officers and locations as blocks. */
export const legal = (uid) => through(() => companyLegalApi.legal(uid));
/** `PUT /api/company/:uid/legal` (partial; null clears). */
export const saveLegal = (uid, fields) => through(() => companyLegalApi.saveLegal(uid, fields));
/** `GET /api/company/:uid/tax-id[?full=1]`: the number itself only for an editor's own edit field. */
export const taxId = (uid, opts) => through(() => companyLegalApi.taxId(uid, opts));
export const saveTaxId = (uid, kind, value) => through(() => companyLegalApi.saveTaxId(uid, kind, value));
export const officers = (uid) => through(() => companyLegalApi.officers(uid));
export const addOfficer = (uid, officer) => through(() => companyLegalApi.addOfficer(uid, officer));
export const ceaseOfficer = (uid, officerUid) => through(() => companyLegalApi.ceaseOfficer(uid, officerUid));
export const addLocation = (uid, location) => through(() => companyLegalApi.addLocation(uid, location));
export const editLocation = (uid, locUid, fields) => through(() => companyLegalApi.editLocation(uid, locUid, fields));
export const closeLocation = (uid, locUid) => through(() => companyLegalApi.closeLocation(uid, locUid));
export const setCompanySlug = (uid, slug) => through(() => companyLegalApi.setCompanySlug(uid, slug));

// ---------------------------------------------------------------- D1592: wired

/** `GET /api/company/:uid/documents` → `{ slots, other, ventures, can_upload }`. */
export const documents = (uid) => through(() => companyDocumentsApi.list(uid));
export const uploadDocument = (uid, body) => through(() => companyDocumentsApi.upload(uid, body));
export const downloadDocument = (uid, docUid) => through(() => companyDocumentsApi.download(uid, docUid));

// ---------------------------------------------------------------- D1591: wired

/** `GET /api/account/slug-check` → `{ available, reason, suggestion, path }`; it never names who holds a slug. */
export const slugCheck = (q) => through(() => slugsApi.check(q));

// ---------------------------------------------------------------- D1496 (#3840): through Team's seam

/** A project's agents (PF6c "Agents"), as Team's seam reads them: unavailable while agents are switched off. */
export async function projectAgents(id) {
  const out = await listAgents('project', id);
  if (!out.available) return out;
  const agents = Array.isArray(out.value?.agents) ? out.value.agents : null;
  return agents ? { available: true, value: agents.length } : { available: false, unreadable: true, reason: 'could not be read' };
}

// ---------------------------------------------------------------- #3932: unavailable

export const CURRENCY_LATER = 'Coming later';
/** Company settings › General's "Default currency" (owner Q4): no column exists until #3932. */
export const defaultCurrency = (/* uid */) => Promise.resolve(unavailable(CURRENCY_LATER, '#3932'));
