import { refusalError, request } from '../api.js';

/**
 * D4563 (#4563): HQ Contracts › Corporate Governance (`routes/admin_governance.ts`).
 * list()            -> { entities: [{ key, name, documents: Doc[], withheld }], categories: [{ key, label }], statuses, super_admin }
 * linkable()        -> { templates: [{ slug, title, category }], envelopes: [{ id, title, completed_at }] } (completed envelopes only)
 * create(body)      -> { document }. body: { entity_key, category, title, effective_date?, confidential?, template_slug?, envelope_id? }
 * read(uid)         -> { document, versions }
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
  update: (uid, body) => request(doc(uid), { method: 'PATCH', body: JSON.stringify(body) }),
  uploadVersion: (uid, { file: upload, signed = false, note = '' } = {}) => {
    const fd = new FormData();
    fd.append('file', upload);
    if (signed) fd.append('signed', 'true');
    if (note) fd.append('note', note);
    return request(`${doc(uid)}/versions`, { method: 'POST', body: fd });
  },
  file,
  ownership: () => request(`${base}/ownership`),
  setOwnership: (entity, ownership) => request(`${base}/ownership/${encodeURIComponent(entity)}`, { method: 'PUT', body: JSON.stringify({ ownership }) }),
};
