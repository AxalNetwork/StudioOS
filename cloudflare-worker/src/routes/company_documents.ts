/**
 * D1592 (#3860) — a company's own documents: read, upload and download.
 * Mounted at `/api` before `companyRoutes` (`index.ts`).
 *
 *   GET  /company/:uid/documents             member  the four named slots, the
 *                                                     company's other documents, and
 *                                                     its ventures' documents the
 *                                                     caller may already read
 *   POST /company/:uid/documents             editor  multipart `file`, `kind`, `title?`
 *   GET  /company/:uid/documents/:docUid/file member  the stored bytes, as an attachment
 *
 * A COMPANY DOCUMENT is a `documents` row with `company_id` set and
 * `project_id` NULL (migration 748). Its project has no founder, so the old
 * `GET /api/legal/documents` read never shows it to anyone but an admin
 * (`canAccessFounderResource` refuses a null founder). Keep it that way.
 *
 * THE GATES are `viewerIsMember` and `canEdit` (`services/companyAccess.ts`),
 * the same rule `company.ts` uses. A non-member and an unknown uid get the same
 * 404, so the answer never says whether a company exists.
 *
 * THE VENTURES do not widen who reads a venture's document: each row passes
 * `canAccessFounderResource`, the D639 rule `GET /api/legal/documents` uses.
 * Whether company editors should read them under #3697's authority rule is an
 * owner call (D1592.md).
 *
 * STORAGE is R2 `FILES`. The bytes are put first, and the row is written only
 * after the put succeeds. Nothing is deleted: a new upload of a kind becomes
 * that slot's document and the older ones are counted in `earlier`.
 *
 * NOTHING STORED LEAVES: no answer carries `content`, the R2 key, the sha256
 * or anyone's email.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { canEdit, viewerIsMember } from '../services/companyAccess';

const r = new Hono<{ Bindings: Env }>();

/** The four named rows of the Documents card, in its order. */
export const SLOT_KINDS = ['certificate_of_incorporation', 'bylaws', 'tax_id_letter', 'registered_agent_agreement'] as const;
export const DOCUMENT_KINDS = [...SLOT_KINDS, 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const KIND_LABELS: Record<DocumentKind, string> = {
  certificate_of_incorporation: 'Certificate of incorporation',
  bylaws: 'Bylaws',
  tax_id_letter: 'Tax ID letter',
  registered_agent_agreement: 'Registered agent agreement',
  other: 'Other document',
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TEMPLATE = 'company_upload';
const MAX_TITLE = 200;

type Block<T> = { available: true; value: T } | { available: false; reason: string };
const ok = <T>(value: T): Block<T> => ({ available: true, value });
const failed = (what: string): Block<never> => ({ available: false, reason: `${what} could not be read. That is not the same as none.` });

type CompanyRow = { id: number; uid: string; archived_at: string | null };
type DocRow = { uid: string; doc_type: string; title: string; status: string; created_at: string; content: string | null; uploader_name: string | null };

export interface Doc {
  uid: string;
  kind: string;
  title: string;
  status: string;
  created_at: string;
  uploaded_by: { name: string } | null;
  has_file: boolean;
}

/** The R2 pointer a row holds, or null. Read here only; never returned. */
function pointerOf(content: string | null): { r2_key: string; content_type: string } | null {
  if (!content) return null;
  try {
    const p = JSON.parse(content);
    return p && typeof p.r2_key === 'string' && p.r2_key && typeof p.content_type === 'string' ? { r2_key: p.r2_key, content_type: p.content_type } : null;
  } catch { return null; }
}

/** What a document is to a reader: never its content, key, hash or anyone's email. */
function docOf(row: DocRow): Doc {
  return {
    uid: row.uid,
    kind: row.doc_type,
    title: row.title,
    status: row.status,
    created_at: row.created_at,
    uploaded_by: row.uploader_name ? { name: row.uploader_name } : null,
    has_file: pointerOf(row.content) !== null,
  };
}

const notFound = (c: any) => refuse(c, 404, { code: 'not_found', message: 'Company not found.' });

/** The company and whether the caller may edit it; null for an unknown uid or a non-member alike. */
async function accessOf(env: Env, uid: string, user: User): Promise<{ company: CompanyRow; editor: boolean } | null> {
  const company = await env.DB.prepare('SELECT id, uid, archived_at FROM company_profiles WHERE uid = ?').bind(uid).first<CompanyRow>();
  if (!company || !(await viewerIsMember(env, company.id, user))) return null;
  return { company, editor: await canEdit(env, company, user) };
}

/** The newest row of each named kind, and how many older ones it has. */
export async function readSlots(env: Env, companyId: number) {
  const rows = await env.DB.prepare(
    `SELECT d.uid, d.doc_type, d.title, d.status, d.created_at, d.content, u.name AS uploader_name
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.company_id = ? AND d.project_id IS NULL AND d.doc_type IN (?, ?, ?, ?)
      ORDER BY d.created_at DESC, d.id DESC`,
  ).bind(companyId, ...SLOT_KINDS).all<DocRow>();
  const list = rows.results || [];
  return SLOT_KINDS.map((kind) => {
    const of = list.filter((row) => row.doc_type === kind);
    return { kind, label: KIND_LABELS[kind], document: of[0] ? docOf(of[0]) : null, earlier: Math.max(0, of.length - 1) };
  });
}

/** Every company document that is not one of the four named kinds, newest first. */
export async function readOther(env: Env, companyId: number): Promise<Doc[]> {
  const rows = await env.DB.prepare(
    `SELECT d.uid, d.doc_type, d.title, d.status, d.created_at, d.content, u.name AS uploader_name
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.company_id = ? AND d.project_id IS NULL AND d.doc_type NOT IN (?, ?, ?, ?)
      ORDER BY d.created_at DESC, d.id DESC`,
  ).bind(companyId, ...SLOT_KINDS).all<DocRow>();
  return (rows.results || []).map(docOf);
}

/**
 * The company's ventures (not trashed), each with the documents the caller's
 * existing read allows (`canAccessFounderResource`, D639). A venture with none
 * is left out.
 */
export async function readVentures(env: Env, companyId: number, user: User) {
  const rows = await env.DB.prepare(
    `SELECT p.id AS project_id, p.name AS project_name, p.founder_id AS founder_id,
            d.uid, d.doc_type, d.title, d.status, d.created_at, d.content, u.name AS uploader_name
       FROM projects p
       JOIN documents d ON d.project_id = p.id
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE p.company_id = ? AND p.deleted_at IS NULL
      ORDER BY p.name COLLATE NOCASE, p.id, d.created_at DESC, d.id DESC`,
  ).bind(companyId).all<DocRow & { project_id: number; project_name: string; founder_id: number | null }>();
  const out: Array<{ project: { id: number; name: string }; documents: Doc[] }> = [];
  for (const row of rows.results || []) {
    if (!canAccessFounderResource(user, row.founder_id ?? null)) continue;
    let venture = out.find((v) => v.project.id === row.project_id);
    if (!venture) { venture = { project: { id: row.project_id, name: row.project_name }, documents: [] }; out.push(venture); }
    venture.documents.push(docOf(row));
  }
  return out;
}

/** The reads, replaceable in tests so one block can fail alone. */
export const reads = { readSlots, readOther, readVentures };

r.get('/company/:uid/documents', async (c) => {
  try {
    const user = await requireAuth(c);
    const access = await accessOf(c.env, c.req.param('uid'), user);
    if (!access) return notFound(c);
    const id = access.company.id;
    let slots;
    try {
      slots = await reads.readSlots(c.env, id);
    } catch (e) {
      return refuse(c, 503, { code: 'documents_unreadable', message: 'The company\'s documents could not be read. Try again in a moment.', raw: e });
    }
    const [other, ventures] = await Promise.all([
      reads.readOther(c.env, id).then(ok, (e) => { console.warn('[company_documents] other', e); return failed('Other documents'); }),
      reads.readVentures(c.env, id, user).then(ok, (e) => { console.warn('[company_documents] ventures', e); return failed('The ventures\' documents'); }),
    ]);
    return c.json({ slots, other, ventures, can_upload: access.editor && !access.company.archived_at });
  } catch (e) { return mapError(c, e); }
});

/** PDF, JPEG or PNG by its first bytes; null for anything else. */
export function sniffType(h: Uint8Array): string | null {
  if (h.length >= 5 && h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d) return 'application/pdf';
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a) return 'image/png';
  return null;
}
const ALLOWED_DECLARED = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

r.post('/company/:uid/documents', async (c) => {
  try {
    const user = await requireAuth(c);
    const access = await accessOf(c.env, c.req.param('uid'), user);
    if (!access) return notFound(c);
    if (!access.editor) return refuse(c, 403, { code: 'not_editor', message: 'Only an owner, admin or founder of this company can upload its documents.' });
    if (access.company.archived_at) return refuse(c, 409, { code: 'archived', message: 'This company is archived. Restore it before you add documents.' });

    const fileRequired = () => refuse(c, 400, { code: 'file_required', message: 'Choose a file to upload.' });
    if (!(c.req.header('content-type') || '').toLowerCase().includes('multipart/form-data')) return fileRequired();
    let form: FormData;
    try { form = await c.req.formData(); } catch { return fileRequired(); }
    const file = form.get('file') as unknown as { type?: string; size?: number; arrayBuffer?: () => Promise<ArrayBuffer> } | null;
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') return fileRequired();
    const kind = String(form.get('kind') ?? '');
    if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return refuse(c, 400, { code: 'kind_invalid', message: 'Choose what kind of document this is.' });
    if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) return refuse(c, 413, { code: 'file_too_large', message: 'The file is larger than 10 MB.' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return refuse(c, 400, { code: 'file_empty', message: 'The file is empty.' });
    if (bytes.length > MAX_UPLOAD_BYTES) return refuse(c, 413, { code: 'file_too_large', message: 'The file is larger than 10 MB.' });

    // The bytes decide the type; a declared type outside the three is refused too.
    const sniffed = sniffType(bytes);
    const declared = String(file.type || '').toLowerCase().split(';')[0].trim();
    if (!sniffed || (declared && !ALLOWED_DECLARED.has(declared))) {
      return refuse(c, 400, { code: 'file_type_invalid', message: 'Upload a PDF, JPEG or PNG file.' });
    }
    const rawTitle = String(form.get('title') ?? '').trim().slice(0, MAX_TITLE);
    const title = rawTitle || KIND_LABELS[kind as DocumentKind];

    const files = c.env.FILES;
    if (!files) return refuse(c, 503, { code: 'storage_unconfigured', message: 'Document storage is not configured on this deployment.' });
    const r2Key = `company-documents/${access.company.uid}/${crypto.randomUUID()}`;
    try {
      await files.put(r2Key, bytes, { httpMetadata: { contentType: sniffed }, customMetadata: { companyId: String(access.company.id), userId: String(user.id) } });
    } catch (e) {
      return refuse(c, 502, { code: 'storage_failed', message: 'The file could not be stored. Try again.', raw: e });
    }
    let sha256 = '';
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* the hash is metadata, best effort */ }
    const pointer = JSON.stringify({ kind: 'company_document', r2_key: r2Key, content_type: sniffed, size: bytes.length, sha256 });
    const row = await c.env.DB.prepare(
      `INSERT INTO documents (project_id, company_id, uploaded_by, title, doc_type, status, content, template_name)
       VALUES (NULL, ?, ?, ?, ?, 'generated', ?, ?) RETURNING uid`,
    ).bind(access.company.id, user.id, title, kind, pointer, UPLOAD_TEMPLATE).first<{ uid: string }>();
    const saved = await c.env.DB.prepare(
      `SELECT d.uid, d.doc_type, d.title, d.status, d.created_at, d.content, u.name AS uploader_name
         FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.uid = ?`,
    ).bind(row!.uid).first<DocRow>();
    return c.json(docOf(saved!), 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/company/:uid/documents/:docUid/file', async (c) => {
  try {
    const user = await requireAuth(c);
    const access = await accessOf(c.env, c.req.param('uid'), user);
    if (!access) return notFound(c);
    const gone = () => refuse(c, 404, { code: 'not_found', message: 'Document not found.' });
    const row = await c.env.DB.prepare(
      'SELECT content, title FROM documents WHERE uid = ? AND company_id = ? AND project_id IS NULL',
    ).bind(c.req.param('docUid'), access.company.id).first<{ content: string | null; title: string }>();
    const pointer = pointerOf(row?.content ?? null);
    if (!row || !pointer || !c.env.FILES) return gone();
    const obj = await c.env.FILES.get(pointer.r2_key);
    if (!obj) return gone();
    const ext = pointer.content_type === 'application/pdf' ? 'pdf' : pointer.content_type === 'image/png' ? 'png' : 'jpg';
    const name = `${row.title.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().slice(0, 80) || 'document'}.${ext}`;
    return new Response(obj.body, {
      headers: {
        'Content-Type': pointer.content_type,
        'Content-Disposition': `attachment; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
