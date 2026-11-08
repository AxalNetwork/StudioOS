/**
 * D4563 (#4563) — HQ Contracts › Corporate Governance, over
 * `services/governance.ts` (migration 202611062154).
 *
 *   GET   /api/admin/governance                     → { entities: [{ key, name, documents, withheld }], categories, statuses, super_admin }
 *   GET   /api/admin/governance/linkable            → { templates: [{ slug, title, category }], envelopes: [{ id, title, completed_at }] }
 *   POST  /api/admin/governance/documents           { entity_key, category, title, effective_date?, confidential?, template_slug?, envelope_id? } → { document }
 *   GET   /api/admin/governance/documents/:uid      → { document, versions }
 *   PATCH /api/admin/governance/documents/:uid      { title?, effective_date?, status?, confidential?, template_slug?, envelope_id? } → { document }
 *   POST  /api/admin/governance/documents/:uid/versions   multipart: file (PDF or .docx, ≤ 25 MB), signed?, note? → { document, version }
 *   GET   /api/admin/governance/documents/:uid/versions/:n/file[?download=1]   the file (inline for preview, attachment to download)
 *   GET   /api/admin/governance/ownership           → { entities: [{ key, name, ownership, updated_at }] }        Super Admin only
 *   PUT   /api/admin/governance/ownership/:entity   { ownership: [{ holder, interest?, percent?, note? }] }        Super Admin only
 *
 * Who: HQ's admins (`requireHqAuthoring`; a branch Worker answers 403). A
 * confidential document is the Super Admin's alone: another admin's list
 * counts it as `withheld`, and every read, file or write of it is 404. The
 * ownership metadata is the Super Admin's alone (403 for anyone else).
 *
 * Every write and every file read of a confidential document leaves one
 * `logAdminAction` row with the uid, entity, category and status only: never a
 * title, a file name or a file's contents. Bound SQL throughout.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireHqAuthoring } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import {
  DOCX, GOVERNANCE_CATEGORIES, GOVERNANCE_ENTITIES, GOVERNANCE_STATUSES, MAX_FILE_BYTES, PDF, canMove, dateOf, docView, entityName,
  envelopeExists, executedEvidence, isCategory, isEntity, isStatus, ownershipOf, readDoc, readVersions, sha256Hex, sniffDocument,
  templateExists, versionKey, versionView, type DocRow, type GovernanceEntity,
} from '../services/governance';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

const governance = new Hono<{ Bindings: Env }>();
const UID = /^[0-9a-f-]{36}$/;
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function hq(c: any) {
  const user = await requireHqAuthoring(c);
  return { user, superAdmin: isSuperAdmin(user as any) };
}
const audit = (c: any, user: any, action: string, details: Record<string, unknown>) =>
  logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
const notFound = (c: any) => refuse(c, 404, { code: 'document_not_found', message: 'That governance document is not available.' });

/** The document a request names, when this admin may see it; a confidential one is invisible to all but the Super Admin. */
async function visible(c: any, superAdmin: boolean): Promise<DocRow | Response> {
  const uid = c.req.param('uid');
  if (!UID.test(String(uid))) return notFound(c);
  const doc = await readDoc(c.env, uid);
  if (!doc || (Number(doc.confidential) === 1 && !superAdmin)) return notFound(c);
  return doc;
}

governance.get('/', async (c) => {
  const { superAdmin } = await hq(c);
  const docs = (await c.env.DB.prepare('SELECT * FROM governance_documents ORDER BY entity_key, category, COALESCE(effective_date, created_at) DESC, id DESC').all<DocRow>()).results || [];
  const latest = new Map<string, any>();
  const counts = new Map<string, number>();
  const rows = (await c.env.DB.prepare(
    `SELECT v.* FROM governance_document_versions v
      JOIN (SELECT document_uid, MAX(version) AS v FROM governance_document_versions GROUP BY document_uid) m
        ON m.document_uid = v.document_uid AND m.v = v.version`,
  ).all<any>()).results || [];
  for (const r of rows) latest.set(r.document_uid, r);
  const cnt = (await c.env.DB.prepare('SELECT document_uid, COUNT(*) AS n FROM governance_document_versions GROUP BY document_uid').all<any>()).results || [];
  for (const r of cnt) counts.set(r.document_uid, Number(r.n));
  const entities = GOVERNANCE_ENTITIES.map((key) => {
    const mine = (docs as DocRow[]).filter((d) => d.entity_key === key);
    const shown = mine.filter((d) => superAdmin || Number(d.confidential) !== 1);
    return { key, name: entityName(key), documents: shown.map((d) => docView(d, latest.get(d.uid) ?? null, counts.get(d.uid) ?? 0)), withheld: mine.length - shown.length };
  });
  return c.json({ entities, categories: GOVERNANCE_CATEGORIES, statuses: GOVERNANCE_STATUSES, super_admin: superAdmin });
});

governance.get('/linkable', async (c) => {
  await hq(c);
  const templates = (await c.env.DB.prepare('SELECT slug, title, category FROM legal_templates WHERE is_active = 1 ORDER BY title LIMIT 300').all<any>().catch(() => ({ results: [] }))).results || [];
  // Completed envelopes only, by title and date: never a signer's name or email.
  const envelopes = (await c.env.DB.prepare("SELECT id, document_title AS title, completed_at FROM esign_envelopes WHERE status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 100").all<any>().catch(() => ({ results: [] }))).results || [];
  return c.json({ templates, envelopes: envelopes.map((e: any) => ({ id: Number(e.id), title: e.title, completed_at: e.completed_at })) });
});

/** The link fields of a body, checked; an unknown template or envelope is refused, never stored. */
async function linksOf(c: any, b: any): Promise<{ template_slug?: string | null; envelope_id?: number | null } | Response> {
  const out: { template_slug?: string | null; envelope_id?: number | null } = {};
  if (b.template_slug !== undefined) {
    if (b.template_slug === null || b.template_slug === '') out.template_slug = null;
    else if (typeof b.template_slug !== 'string' || !(await templateExists(c.env, b.template_slug))) return refuse(c, 422, { code: 'template_not_found', message: 'That template is not in the library. Nothing was saved.' });
    else out.template_slug = b.template_slug;
  }
  if (b.envelope_id !== undefined) {
    if (b.envelope_id === null || b.envelope_id === '') out.envelope_id = null;
    else if (!Number.isSafeInteger(Number(b.envelope_id)) || !(await envelopeExists(c.env, Number(b.envelope_id)))) return refuse(c, 422, { code: 'envelope_not_found', message: 'That envelope does not exist. Nothing was saved.' });
    else out.envelope_id = Number(b.envelope_id);
  }
  return out;
}

governance.post('/documents', async (c) => {
  const { user, superAdmin } = await hq(c);
  const b = await c.req.json().catch(() => ({} as any));
  if (!isEntity(b.entity_key)) return c.json({ error: 'entity_key must be holdings, management or gp' }, 400);
  if (!isCategory(b.category)) return c.json({ error: `category must be one of ${GOVERNANCE_CATEGORIES.map((x) => x.key).join(', ')}` }, 400);
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
  if (!title) return c.json({ error: 'title is required' }, 400);
  const effective = b.effective_date == null || b.effective_date === '' ? null : dateOf(b.effective_date);
  if (b.effective_date && !effective) return c.json({ error: 'effective_date must be a date, YYYY-MM-DD' }, 400);
  // Confidential by default for the Super Admin; another admin's documents are not confidential, and only the Super Admin may make one so.
  const confidential = b.confidential === undefined ? superAdmin : b.confidential === true;
  if (confidential && !superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin can keep a confidential governance document.' });
  const links = await linksOf(c, b);
  if (links instanceof Response) return links;
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO governance_documents (uid, entity_key, category, title, status, effective_date, confidential, template_slug, envelope_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, b.entity_key, b.category, title, effective, confidential ? 1 : 0, links.template_slug ?? null, links.envelope_id ?? null, Number(user.id), Number(user.id)).run();
  await audit(c, user, 'governance_document_created', { uid, entity: b.entity_key, category: b.category, status: 'draft', confidential });
  const doc = (await readDoc(c.env, uid))!;
  return c.json({ document: docView(doc, null, 0) }, 201);
});

governance.get('/documents/:uid', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const versions = await readVersions(c.env, doc.uid);
  if (Number(doc.confidential) === 1) await audit(c, user, 'governance_document_viewed', { uid: doc.uid, entity: doc.entity_key, category: doc.category });
  return c.json({ document: docView(doc, versions[0] ?? null, versions.length), versions: versions.map(versionView) });
});

governance.patch('/documents/:uid', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const b = await c.req.json().catch(() => ({} as any));
  // The row as it will be written: every field starts as stored, and one fixed, fully bound UPDATE writes it.
  const next = { title: doc.title, effective_date: doc.effective_date, confidential: Number(doc.confidential), template_slug: doc.template_slug,
    envelope_id: doc.envelope_id, executed_version: doc.executed_version, status: doc.status };
  let changed = false;
  if (b.title !== undefined) {
    const t = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
    if (!t) return c.json({ error: 'title cannot be empty' }, 400);
    next.title = t; changed = true;
  }
  if (b.effective_date !== undefined) {
    const d = b.effective_date === null || b.effective_date === '' ? null : dateOf(b.effective_date);
    if (b.effective_date && !d) return c.json({ error: 'effective_date must be a date, YYYY-MM-DD' }, 400);
    next.effective_date = d; changed = true;
  }
  if (b.confidential !== undefined) {
    if (!superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin can change who sees a governance document.' });
    next.confidential = b.confidential === true ? 1 : 0; changed = true;
  }
  const links = await linksOf(c, b);
  if (links instanceof Response) return links;
  // An executed document's envelope is what it names as signed: it stays while the document is executed.
  const staysExecuted = doc.status === 'executed' && (b.status === undefined || b.status === 'executed');
  if (staysExecuted && links.envelope_id !== undefined && links.envelope_id !== (doc.envelope_id == null ? null : Number(doc.envelope_id))) {
    return refuse(c, 409, { code: 'executed_link_locked', message: 'An executed document keeps the envelope it was signed in. Archive it to change it. Nothing was saved.' });
  }
  if (links.template_slug !== undefined) { next.template_slug = links.template_slug; changed = true; }
  if (links.envelope_id !== undefined) { next.envelope_id = links.envelope_id; changed = true; }
  let status = doc.status;
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return c.json({ error: `status must be one of ${GOVERNANCE_STATUSES.join(', ')}` }, 400);
    if (!canMove(doc.status, b.status)) return refuse(c, 409, { code: 'status_move_refused', message: `A ${doc.status} document cannot move to ${b.status}. Nothing was saved.` });
    if (b.status === 'executed' && doc.status !== 'executed') {
      // An unsigned draft is never marked executed: a signed version, or a completed envelope (the one being linked counts), names what was signed.
      const evidence = await executedEvidence(c.env, { ...doc, envelope_id: links.envelope_id !== undefined ? links.envelope_id : doc.envelope_id }, await readVersions(c.env, doc.uid));
      if (!evidence) return refuse(c, 409, { code: 'not_signed', message: 'Upload the signed copy, or link the signed envelope, before marking this document executed. Nothing was saved.' });
      next.executed_version = evidence.version;
      if (evidence.envelope != null && links.envelope_id === undefined) next.envelope_id = evidence.envelope;
    }
    next.status = b.status; changed = true;
    status = b.status;
  }
  if (!changed) return c.json({ error: 'nothing to change' }, 400);
  await c.env.DB.prepare(
    `UPDATE governance_documents SET title = ?, effective_date = ?, confidential = ?, template_slug = ?, envelope_id = ?,
       executed_version = ?, status = ?, updated_by = ?, updated_at = ? WHERE uid = ?`,
  ).bind(next.title, next.effective_date, next.confidential, next.template_slug, next.envelope_id,
    next.executed_version, next.status, Number(user.id), now(), doc.uid).run();
  await audit(c, user, b.status !== undefined && b.status !== doc.status ? 'governance_document_status' : 'governance_document_updated', {
    uid: doc.uid, entity: doc.entity_key, category: doc.category, from: doc.status, status, fields: Object.keys(b).filter((k) => b[k] !== undefined),
  });
  const saved = (await readDoc(c.env, doc.uid))!;
  const versions = await readVersions(c.env, doc.uid);
  return c.json({ document: docView(saved, versions[0] ?? null, versions.length) });
});

governance.post('/documents/:uid/versions', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  if (doc.status === 'executed' || doc.status === 'archived') return refuse(c, 409, { code: 'document_closed', message: `A ${doc.status} document takes no new version. Nothing was uploaded.` });
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'File storage is not available here. Nothing was uploaded.' });
  const len = Number(c.req.header('content-length') || 0);
  if (len > MAX_FILE_BYTES + 64 * 1024) return refuse(c, 413, { code: 'file_too_large', message: 'A governance document is at most 25 MB. Nothing was uploaded.' });
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (!bytes.length) return c.json({ error: 'the file is empty' }, 400);
  if (bytes.length > MAX_FILE_BYTES) return refuse(c, 413, { code: 'file_too_large', message: 'A governance document is at most 25 MB. Nothing was uploaded.' });
  const type = sniffDocument(bytes);
  if (!type) return refuse(c, 415, { code: 'unsupported_file', message: 'Upload a PDF or a Word (.docx) document. Nothing was uploaded.' });
  const signed = String(form?.get('signed') ?? '') === 'true';
  const noteRaw = form?.get('note');
  const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 500) : null;
  const sha = await sha256Hex(bytes);
  const last = await c.env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM governance_document_versions WHERE document_uid = ?').bind(doc.uid).first<{ v: number }>();
  const version = Number(last?.v ?? 0) + 1;
  const key = versionKey(doc.entity_key as GovernanceEntity, doc.uid, version, type);
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { governance_uid: doc.uid, version: String(version) } });
  try {
    await c.env.DB.prepare(
      `INSERT INTO governance_document_versions (document_uid, version, signed, r2_key, file_sha256, file_bytes, content_type, note, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(doc.uid, version, signed ? 1 : 0, key, sha, bytes.length, type, note, Number(user.id)).run();
  } catch {
    // Another upload took this number first: its row stands, and this file is not recorded.
    await c.env.FILES.delete(key).catch(() => {});
    return refuse(c, 409, { code: 'version_conflict', message: 'Another version was uploaded at the same moment. Reload and upload again.' });
  }
  await c.env.DB.prepare('UPDATE governance_documents SET updated_by = ?, updated_at = ? WHERE uid = ?').bind(Number(user.id), now(), doc.uid).run();
  await audit(c, user, 'governance_version_uploaded', { uid: doc.uid, entity: doc.entity_key, category: doc.category, version, signed, bytes: bytes.length });
  const versions = await readVersions(c.env, doc.uid);
  return c.json({ document: docView((await readDoc(c.env, doc.uid))!, versions[0] ?? null, versions.length), version: versionView(versions[0]) }, 201);
});

governance.get('/documents/:uid/versions/:n/file', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const n = Number(c.req.param('n'));
  if (!Number.isSafeInteger(n) || n < 1) return notFound(c);
  const v = await c.env.DB.prepare('SELECT * FROM governance_document_versions WHERE document_uid = ? AND version = ?').bind(doc.uid, n).first<any>();
  if (!v || !c.env.FILES) return notFound(c);
  const object = await c.env.FILES.get(v.r2_key);
  if (!object) return refuse(c, 503, { code: 'file_unreadable', message: 'This version\'s file could not be read. Try again.' });
  const download = c.req.query('download') === '1';
  await audit(c, user, download ? 'governance_file_downloaded' : 'governance_file_previewed', { uid: doc.uid, entity: doc.entity_key, category: doc.category, version: n });
  const ext = v.content_type === PDF ? 'pdf' : v.content_type === DOCX ? 'docx' : 'bin';
  return new Response(object.body, {
    headers: {
      'content-type': v.content_type,
      'content-disposition': `${download || v.content_type !== PDF ? 'attachment' : 'inline'}; filename="${doc.entity_key}-${doc.category}-v${n}.${ext}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

governance.get('/ownership', async (c) => {
  const { superAdmin } = await hq(c);
  if (!superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin can read the entities\' ownership.' });
  const rows = (await c.env.DB.prepare('SELECT entity_key, ownership_json, updated_at FROM governance_entity_profiles').all<any>()).results || [];
  const by = new Map(rows.map((r: any) => [r.entity_key, r]));
  return c.json({
    entities: GOVERNANCE_ENTITIES.map((key) => {
      const r: any = by.get(key);
      let ownership: unknown[] = [];
      try { ownership = r ? JSON.parse(r.ownership_json) : []; } catch { ownership = []; }
      return { key, name: entityName(key), ownership, updated_at: r?.updated_at ?? null };
    }),
  });
});

governance.put('/ownership/:entity', async (c) => {
  const { user, superAdmin } = await hq(c);
  if (!superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin can change the entities\' ownership.' });
  const entity = c.req.param('entity');
  if (!isEntity(entity)) return c.json({ error: 'entity must be holdings, management or gp' }, 400);
  const b = await c.req.json().catch(() => ({} as any));
  const got = ownershipOf(b.ownership);
  if (!got.ok) return c.json({ error: got.error }, 400);
  await c.env.DB.prepare(
    `INSERT INTO governance_entity_profiles (entity_key, ownership_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_key) DO UPDATE SET ownership_json = excluded.ownership_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(entity, JSON.stringify(got.rows), Number(user.id), now()).run();
  await audit(c, user, 'governance_ownership_updated', { entity, rows: got.rows.length });
  return c.json({ key: entity, name: entityName(entity), ownership: got.rows });
});

export default governance;
export const mount: RouteMount = { path: '/api/admin/governance', router: governance };
