// D6699 (#6699) — HQ editing the formation catalogue in a draft, its sources
// and checks, and the restricted places. Worker:
// routes/admin_formation_catalogue.ts (/api/admin/formation/catalogue).
// Editing is HQ authoring; restricted-place changes are the Super Admin's.
// Every write takes a `reason`. Pausing a form is formationCatalogueApi (D6693).
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/formation/catalogue';
const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const adminFormationCatalogueApi = {
  // { versions: [{ version, status, is_current, notes, created_at, published_at, … }] }, newest first
  versions: () => request(`${BASE}/versions`),
  // { version, content: { countries, forms, facts, fees, pack, questions, scenarios, rules } (each row with its
  //   `revision`), content_sha256, rules_sha256, form_templates: [{ form_key, templates_sha256, templates }] }
  version: (version) => request(`${BASE}/versions/${enc(version)}`),
  // { from, to, totals, changes: [{ entity, change: added|removed|changed, key, fields: [{ field, from, to }] }] }
  // against the current published version unless `against` names another.
  diff: (version, against) => request(`${BASE}/versions/${enc(version)}/diff${against ? `?against=${enc(against)}` : ''}`),
  // { stale: [...], disputed: [...], max_age_days, fresh_since }
  attention: (version) => request(`${BASE}/versions/${enc(version)}/attention`),
  // A draft copied from the current version: { version, from_version, content_sha256 }
  createDraft: (reason) => request(`${BASE}/drafts`, json('POST', { reason })),
  // entity: countries | forms | facts | fees | pack | questions | scenarios | rules.
  // `revision` is the row's revision as read, or null to create it; a stale one answers 409 revision_conflict.
  saveRow: (version, entity, { key, fields, revision = null, reason }) =>
    request(`${BASE}/drafts/${enc(version)}/${enc(entity)}`, json('PUT', { key, fields, revision, reason })),
  removeRow: (version, entity, { key, revision, reason }) =>
    request(`${BASE}/drafts/${enc(version)}/${enc(entity)}`, json('DELETE', { key, revision, reason })),
  sources: () => request(`${BASE}/sources`),
  addSource: ({ kind, title, url = null, publisher = null, reason }) =>
    request(`${BASE}/sources`, json('POST', { kind, title, url, publisher, reason })),
  // outcome: unchanged | changed | unreachable; the checker is the signed-in admin.
  recordSourceCheck: (sourceId, { checked_on, outcome, note = null, reason }) =>
    request(`${BASE}/sources/${enc(sourceId)}/checks`, json('POST', { checked_on, outcome, note, reason })),
  restrictedPlaces: () => request(`${BASE}/restricted`),
  // Super Admin: kind (sanctioned | not_served | counsel_only), source_id and checked_on are required.
  addRestrictedPlace: ({ place, kind, source_id, checked_on, note = null, reason }) =>
    request(`${BASE}/restricted`, json('POST', { place, kind, source_id, checked_on, note, reason })),
  editRestrictedPlace: (id, { kind, source_id, checked_on, note = null, reason }) =>
    request(`${BASE}/restricted/${enc(id)}`, json('PATCH', { kind, source_id, checked_on, note, reason })),
  removeRestrictedPlace: (id, reason) => request(`${BASE}/restricted/${enc(id)}`, json('DELETE', { reason })),
};
