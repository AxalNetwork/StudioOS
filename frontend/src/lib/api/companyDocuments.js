import { refusalError, request } from '../api.js';

/**
 * D1592 (#3860): a company's documents (`routes/company_documents.ts`).
 * list(uid)      -> { slots: [{ kind, label, document: Doc | null, earlier }], other: Block<Doc[]>,
 *                     ventures: Block<[{ project: { id, name }, documents: Doc[] }]>, can_upload }
 * upload(uid, { file, kind, title }) -> Doc. Kinds: certificate_of_incorporation, bylaws, tax_id_letter,
 *                     registered_agent_agreement, other. A PDF, JPEG or PNG of at most 10 MB.
 * download(uid, docUid) -> { blob, filename }, read only when the reader taps Open; no object URL is made.
 * A Doc is { uid, kind, title, status, created_at, uploaded_by: { name } | null, has_file }: never its content.
 * A block is `{ available: true, value }` or `{ available: false, reason }`.
 */
const base = (uid) => `/company/${encodeURIComponent(uid)}/documents`;

// The stored file (a binary endpoint, read with the bearer header as the 83(b) and statement downloads are).
async function download(uid, docUid) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${base(uid)}/${encodeURIComponent(docUid)}/file`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await refusalError(res, 'The document could not be downloaded.');
  const blob = await res.blob();
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'document';
  return { blob, filename };
}

export const companyDocumentsApi = {
  list: (uid) => request(base(uid)),
  upload: (uid, { file, kind, title } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    if (title) fd.append('title', title);
    return request(base(uid), { method: 'POST', body: fd });
  },
  download,
};
