import { request } from '../api.js';

/**
 * #4201 (#4152 G1): a company's uploaded logo (`routes/company.ts`, R2 `COMPANY_LOGOS`).
 * upload(uid, file) -> the company detail, its `logo_url` now the served path. A PNG or SVG of at
 *                      most 2 MB, square or close to it (width over height 0.9–1.1); an SVG with
 *                      scripts, handlers, embedded content or outside links is refused (`svg_unsafe`).
 * remove(uid)       -> the company detail with `logo_url: null`; the stored logo is deleted.
 * #4963: both take an optional `expectedVersion`, the `profile_version` the editor loaded; a stale one is a 409
 *        `version_conflict` whose body carries the current company.
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
  servedPath: servedLogoPath,
  isStored: (uid, url) => typeof url === 'string' && url.startsWith(`${servedLogoPath(uid)}?v=`),
};
