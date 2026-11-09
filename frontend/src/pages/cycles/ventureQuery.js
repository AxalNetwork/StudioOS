/**
 * D5074 (#5074) — the canonical venture context's pure rules: which venture
 * an address names, the one query form every generated link uses, where a
 * legacy address is redirected to, and the context a project record gives.
 * The route helpers (`useProject` in `CycleRoute.jsx`, `VentureContext.jsx`)
 * own this; a feature component never parses the query for its venture.
 *
 * THE ONE FORM. A generated URL names its venture as `?project_id=<number>`.
 *
 * LEGACY INPUT, ACCEPTED AND REDIRECTED. `?project=<number>` (the Worker's
 * `next.href` links and older pages) and a project UID in either key
 * (`?project=<uid>`, `?project_id=<uid>`) name the same venture. The route
 * answers one of them with a replace to the canonical form, keeping every
 * other query key and the hash.
 */

export const VENTURE_PARAM = 'project_id';
export const LEGACY_VENTURE_PARAMS = Object.freeze(['project']);

const ID = /^[1-9]\d{0,15}$/;
// A project UID: letters, digits, `_` or `-`, never all digits (that is an id).
const UID = /^(?!\d+$)[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

const paramsOf = (search) => (search instanceof URLSearchParams
  ? new URLSearchParams(search)
  : new URLSearchParams(String(search || '').replace(/^\?/, '')));

/**
 * What the address names: `{ id, uid: null }` for a number, `{ id: null, uid }`
 * for a project UID, or null. `key` is the parameter that named it and
 * `legacy` whether that form is one the route redirects. `project_id` is read
 * before `project`; a value neither form accepts is skipped.
 */
export function ventureRef(search) {
  const q = paramsOf(search);
  for (const key of [VENTURE_PARAM, ...LEGACY_VENTURE_PARAMS]) {
    const raw = String(q.get(key) || '').trim();
    if (!raw) continue;
    if (ID.test(raw)) return { id: Number(raw), uid: null, key, legacy: key !== VENTURE_PARAM };
    if (UID.test(raw)) return { id: null, uid: raw, key, legacy: true };
  }
  return null;
}

/** The one query a generated link carries for a venture: `?project_id=N`, or '' with none. */
export function ventureSearch(projectId) {
  const id = String(projectId ?? '');
  return ID.test(id) ? `?${VENTURE_PARAM}=${id}` : '';
}

/**
 * `search` in the canonical form for `projectId`: every legacy key dropped,
 * `project_id` set (in place when it was there), every other key kept in
 * order. With no valid id the venture keys are left as they came.
 */
export function canonicalVentureSearch(search, projectId) {
  const id = String(projectId ?? '');
  const q = paramsOf(search);
  if (!ID.test(id)) { const s = q.toString(); return s ? `?${s}` : ''; }
  for (const k of LEGACY_VENTURE_PARAMS) q.delete(k);
  q.set(VENTURE_PARAM, id);
  return `?${q.toString()}`;
}

/**
 * Where a legacy address is sent once its venture is known: the same path,
 * the canonical query and the hash; null when the address is already
 * canonical or the venture is not known yet.
 */
export function legacyVentureRedirect({ pathname = '', search = '', hash = '' } = {}, projectId) {
  if (!ID.test(String(projectId ?? ''))) return null;
  const q = paramsOf(search);
  const legacyKey = LEGACY_VENTURE_PARAMS.some((k) => q.has(k));
  const ref = ventureRef(q);
  if (!legacyKey && !ref?.legacy) return null;
  // A UID or a legacy number for another venture is not this one: redirect only to what the address named.
  if (ref && ref.id != null && ref.id !== Number(projectId)) return null;
  return { pathname, search: canonicalVentureSearch(q, projectId), hash: hash || '' };
}

/** The projects list a context is resolved from: an array, or `{ items }`. */
const listOf = (projects) => (Array.isArray(projects) ? projects : (projects?.items || []));

/** The context one project record gives: its id, UID, the record, and its company's identity. */
export function ventureOf(project) {
  if (!project || !ID.test(String(project.id ?? ''))) return null;
  return {
    projectId: Number(project.id),
    projectUid: project.uid ? String(project.uid) : null,
    project,
    company: { id: project.company_id ?? null, founderId: project.founder_id ?? null, name: project.name ?? null },
  };
}

/** The venture `ref` names in the list (by id or by UID), or null. */
export function resolveVenture(projects, ref) {
  if (!ref) return null;
  const list = listOf(projects);
  const hit = ref.id != null
    ? list.find((p) => String(p?.id) === String(ref.id))
    : ref.uid ? list.find((p) => p?.uid != null && String(p.uid) === ref.uid) : null;
  return ventureOf(hit);
}
