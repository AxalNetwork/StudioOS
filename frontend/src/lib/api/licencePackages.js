// D5896 (#5896, part 1 (a) of #5026) — HQ's Axal VC package catalogue, read only. Board L29 of the Licences and
// Contracts v2 addendum. Worker: routes/admin_licence_packages.ts over services/licencePackagesStore.ts (D5022),
// Super Admin on HQ only.
//   GET /api/admin/licence-packages?all=1                 → { packages: [version, …] } every version, by key then newest first
//   GET /api/admin/licence-packages/:key/versions          → { package_key, versions: [version, …] } newest first, no items
//   GET /api/admin/licence-packages/:key/versions/:version → { package: { …version, items: [{ program_key, … }] } }
// The writes on that router (draft, edit, publish, retire, delete) are part 1 (b) and have no client here yet.
// D5898 (#5898, part 1 (c)) adds one read of routes/admin_package_pricing.ts (D5023, Super Admin on HQ):
//   GET /api/admin/licences/:uid/package-pricing?package=&version= → { licence_uid, snapshot, country_index_ppm,
//        index_reason, model_version, packages: [recommendation, …] }; a preview, it writes nothing.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licencePackagesApi = {
  /** Every version of every package key (`?all=1`), drafts and retired ones included. */
  catalogue: () => request('/admin/licence-packages?all=1'),
  versions: (packageKey) => request(`/admin/licence-packages/${enc(packageKey)}/versions`),
  version: (packageKey, version) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}`),
  /** Every active package priced for one licence, or one named version (`{ package, version }`), from its latest country recommendation. */
  pricing: (licenceUid, { package: key, version } = {}) => request(`/admin/licences/${enc(licenceUid)}/package-pricing${pricingQuery({ package: key, version })}`),
};

/** `?package=&version=`: a version only with its package, as the Worker requires. */
export function pricingQuery({ package: key, version } = {}) {
  const q = new URLSearchParams();
  if (key) q.set('package', key);
  if (key && version != null && version !== '') q.set('version', String(version));
  const t = q.toString();
  return t ? `?${t}` : '';
}
