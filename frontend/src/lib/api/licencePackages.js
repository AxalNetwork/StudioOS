// D5896 (#5896, part 1 (a) of #5026) — HQ's Axal VC package catalogue, read only. Board L29 of the Licences and
// Contracts v2 addendum. Worker: routes/admin_licence_packages.ts over services/licencePackagesStore.ts (D5022),
// Super Admin on HQ only.
//   GET /api/admin/licence-packages?all=1                 → { packages: [version, …] } every version, by key then newest first
//   GET /api/admin/licence-packages/:key/versions          → { package_key, versions: [version, …] } newest first, no items
//   GET /api/admin/licence-packages/:key/versions/:version → { package: { …version, items: [{ program_key, … }] } }
// D5897 (#5897, part 1 (b)) — the writes, all behind the Super Admin write bar:
//   POST /api/admin/licence-packages                               a new key's DRAFT v1        → 201 { package }
//   POST /api/admin/licence-packages/:key/versions                 the key's next DRAFT        → 201 { package }
//   PUT  /api/admin/licence-packages/:key/versions/:version        edit a DRAFT                → { package }
//   POST /api/admin/licence-packages/:key/versions/:version/publish  draft → active, { reason } → { package, retired_version }
//   POST /api/admin/licence-packages/:key/versions/:version/retire   active → retired, { reason } → { package }
// DELETE of a draft is on the router but L29 draws no door to it, so it has no client (D5897 §4).
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licencePackagesApi = {
  /** Every version of every package key (`?all=1`), drafts and retired ones included. */
  catalogue: () => request('/admin/licence-packages?all=1'),
  versions: (packageKey) => request(`/admin/licence-packages/${enc(packageKey)}/versions`),
  version: (packageKey, version) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}`),
  /** A new package key's draft v1: `{ package_key, name, …fields, items }`. */
  create: (body) => request('/admin/licence-packages', { method: 'POST', body: JSON.stringify(body) }),
  /** The key's next draft version, with its fields and programs. */
  draftNext: (packageKey, body) => request(`/admin/licence-packages/${enc(packageKey)}/versions`, { method: 'POST', body: JSON.stringify(body) }),
  /** Edit a draft version's fields and composition; the Worker refuses an active or retired one. */
  editDraft: (packageKey, version, body) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}`, { method: 'PUT', body: JSON.stringify(body) }),
  publish: (packageKey, version, reason) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}/publish`, { method: 'POST', body: JSON.stringify({ reason }) }),
  retire: (packageKey, version, reason) => request(`/admin/licence-packages/${enc(packageKey)}/versions/${enc(version)}/retire`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
