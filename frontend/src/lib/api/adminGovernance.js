import { refusalError, request } from '../api.js';

/**
 * D4563 (#4563): HQ Contracts › Corporate Governance (`routes/admin_governance.ts`).
 * list()            -> { entities: [{ key, name, documents: Doc[], withheld }], categories: [{ key, label }], statuses, super_admin }
 * linkable()        -> { templates: [{ slug, title, category }], envelopes: [{ id, title, completed_at }] } (completed envelopes only)
 * create(body)      -> { document }. body: { entity_key, category, title, effective_date?, confidential?, template_slug?, envelope_id? }
 * read(uid)         -> { document, versions }
 * activity(uid)     -> { uid, events: [{ action, line, at, actor, version }] } (D4811 part 5)
 * related(uid)      -> { uid, dependants: Rel[], governed_by: Rel[], banner: { affected, version, dismissed } } (D4811 part 8)
 * relate(uid, { kind, ref }) -> { relation }. kind: 'governance' (a record's uid), 'template' (a library slug) or 'agreement' (a desk uid, part 19)
 * governing(kind, ref) -> { governing: Rel[] } (part 19: the records that govern a template or agreement)
 * markReviewed(uid, id, note) -> { relation }; dismissRelated(uid) -> { banner } (hides the banner for this admin only)
 * A Rel is { id, kind, ref, title, status, entity_key, category, restricted, missing, state, flag_version, flagged_at,
 * reviewed_version, reviewed_at, reviewed_by, review_note }; state is review_suggested, reviewed or not_affected.
 * update(uid, body) -> { document }. body: any of title, effective_date, confidential, template_slug, envelope_id, status
 * uploadVersion(uid, { file, signed, note }) -> { document, version }. A PDF or .docx of at most 25 MB.
 * file(uid, n, { download }) -> { blob, filename, type }, read only when the reader opens it; no object URL is kept.
 * ownership()       -> { entities: [{ key, name, ownership, updated_at }] } (the Super Admin's alone)
 * setOwnership(entity, rows) -> { key, name, ownership }
 * A Doc is { uid, entity_key, category, title, status, effective_date, confidential, template_slug, envelope_id,
 * executed_version, next_statuses, versions, latest, updated_at }.
 */
const base = '/admin/governance';
const doc = (uid) => `${base}/documents/${encodeURIComponent(uid)}`;

// A version's file, a binary endpoint read with the bearer header, as company documents are.
async function file(uid, version, { download = false } = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${doc(uid)}/versions/${Number(version)}/file${download ? '?download=1' : ''}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await refusalError(res, 'The file could not be read.');
  const blob = await res.blob();
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'document';
  return { blob, filename, type: res.headers.get('Content-Type') || blob.type };
}

export const adminGovernanceApi = {
  list: () => request(base),
  linkable: () => request(`${base}/linkable`),
  create: (body) => request(`${base}/documents`, { method: 'POST', body: JSON.stringify(body) }),
  read: (uid) => request(doc(uid)),
  // D4811 part 5: the record's audit trail for its workspace (GET /documents/:uid/activity).
  activity: (uid) => request(`${doc(uid)}/activity`),
  // D4811 part 8: the documents a record governs, and their review flags (board CT-11).
  related: (uid) => request(`${doc(uid)}/related`),
  relate: (uid, body) => request(`${doc(uid)}/related`, { method: 'POST', body: JSON.stringify(body) }),
  // D4811 part 19: the governance records that govern a template or an agreement.
  governing: (kind, ref) => request(`${base}/governing?${new URLSearchParams({ kind, ref })}`),
  markReviewed: (uid, id, note = '') => request(`${doc(uid)}/related/${Number(id)}/reviewed`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  dismissRelated: (uid) => request(`${doc(uid)}/related/dismiss`, { method: 'POST' }),
  update: (uid, body) => request(doc(uid), { method: 'PATCH', body: JSON.stringify(body) }),
  // D4811 part 12: a signed copy also sends signed_on, signatory and attest (CT-12 B).
  // D4811 part 20: and may name the counsel-approved version it is a copy of (copy_of).
  uploadVersion: (uid, { file: upload, signed = false, note = '', signed_on = '', signatory = '', attest = false, copy_of = '' } = {}) => {
    const fd = new FormData();
    fd.append('file', upload);
    if (signed) {
      fd.append('signed', 'true');
      fd.append('signed_on', signed_on);
      fd.append('signatory', signatory);
      if (attest) fd.append('attest', 'true');
      if (copy_of !== '' && copy_of != null) fd.append('copy_of', String(copy_of));
    }
    if (note) fd.append('note', note);
    return request(`${doc(uid)}/versions`, { method: 'POST', body: fd });
  },
  file,
  ownership: () => request(`${base}/ownership`),
  setOwnership: (entity, ownership) => request(`${base}/ownership/${encodeURIComponent(entity)}`, { method: 'PUT', body: JSON.stringify({ ownership }) }),
};
