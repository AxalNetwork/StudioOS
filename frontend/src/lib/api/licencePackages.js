// D5896 (#5896, part 1 (a) of #5026) — HQ's Axal VC package catalogue, read only. Board L29 of the Licences and
// Contracts v2 addendum. Worker: routes/admin_licence_packages.ts over services/licencePackagesStore.ts (D5022),
// Super Admin on HQ only.
//   GET /api/admin/licence-packages?all=1                 → { packages: [version, …] } every version, by key then newest first
//   GET /api/admin/licence-packages/:key/versions          → { package_key, versions: [version, …] } newest first, no items
//   GET /api/admin/licence-packages/:key/versions/:version → { package: { …version, items: [{ program_key, … }] } }
// The writes on that router (draft, edit, publish, retire, delete) are part 1 (b) and have no client here yet.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licencePackagesApi = {
  /** Every version of every package key (`?all=1`), drafts and retired ones included. */
  catalogue: () => request('/admin/licence-packages?all=1'),
  versions: (packageKey) => request(`/admin/licence-packages/${enc(packageKey)}/versions`),
  version: (packageKey, version) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}`),
};
