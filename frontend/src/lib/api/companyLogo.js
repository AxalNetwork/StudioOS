import { request } from '../api.js';

/**
 * #4201 (#4152 G1): a company's uploaded logo (`routes/company.ts`, R2 `COMPANY_LOGOS`).
 * upload(uid, file) -> the company detail, its `logo_url` now the served path. A PNG or SVG of at
 *                      most 2 MB, square or close to it (width over height 0.9–1.1); an SVG with
 *                      scripts, handlers, embedded content or outside links is refused (`svg_unsafe`).
 * remove(uid)       -> the company detail with `logo_url: null`; the stored logo is deleted.
 * #4963: upload and remove take an optional `expectedVersion`, the `profile_version` the editor loaded; a stale one is a 409
 *        `version_conflict` whose body carries the current company.
 * saveSettings(uid, { fields, logo, remove, expectedVersion }) -> the company detail, the fields and the logo committed together (D4961),
 *        at `expectedVersion` when the editor loaded one (D4963).
 * servedPath(uid)   -> `/api/company/<uid>/logo`, the prefix every stored logo's `logo_url` has.
 * isStored(uid, url) -> true when `url` is this company's uploaded logo (else an outside URL, or none).
 * The served bytes go to the company's members only; an <img> reads them with the session cookie.
 */
const base = (uid) => `/company/${encodeURIComponent(uid)}/logo`;
const versioned = (uid, v) => (Number.isSafeInteger(v) && v > 0 ? `${base(uid)}?expected_version=${v}` : base(uid));

export const servedLogoPath = (uid) => `/api${base(uid)}`;

export const companyLogoApi = {
  upload: (uid, file, expectedVersion) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(versioned(uid, expectedVersion), { method: 'POST', body: fd });
  },
  remove: (uid, expectedVersion) => request(versioned(uid, expectedVersion), { method: 'DELETE' }),
  /**
   * D4961: one Save. The changed fields and the pending logo (a File, or `remove: true`) go as one request and
   * commit as one (`POST /company/:uid/settings`): either all of it is stored or none of it. Answers the company
   * as it now is, `viewer` included. A 4xx wrote nothing; any other failure may have, so the caller re-reads.
   * #4963: `expectedVersion` rides inside `fields` as `expected_version`.
   */
  saveSettings: (uid, { fields = {}, logo = null, remove = false, expectedVersion } = {}) => {
    const fd = new FormData();
    const body = { ...fields };
    if (Number.isSafeInteger(expectedVersion) && expectedVersion > 0) body.expected_version = expectedVersion;
    if (Object.keys(body).length) fd.append('fields', JSON.stringify(body));
    if (logo) fd.append('logo', logo);
    else if (remove) fd.append('logo_action', 'remove');
    return request(`/company/${encodeURIComponent(uid)}/settings`, { method: 'POST', body: fd });
  },
  servedPath: servedLogoPath,
  isStored: (uid, url) => typeof url === 'string' && url.startsWith(`${servedLogoPath(uid)}?v=`),
};
