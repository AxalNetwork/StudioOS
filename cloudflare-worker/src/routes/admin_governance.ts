/**
 * D4563 (#4563) — HQ Contracts › Corporate Governance, over
 * `services/governance.ts` (migration 202611062154).
 *
 *   GET   /api/admin/governance                     → { entities: [{ key, name, documents, withheld, attention }], categories, statuses, super_admin, group }
 *         `attention` (D4811 part 2, `services/governanceAttention.ts`): the entity's expected records, each with its
 *         state, its counts and its facts; `group`: the intercompany links read from the ownership rows, nothing else.
 *   GET   /api/admin/governance/linkable            → { templates: [{ slug, title, category }], envelopes: [{ id, title, completed_at }] }
 *   POST  /api/admin/governance/documents           { entity_key, category, title, effective_date?, confidential?, template_slug?, envelope_id? } → { document }
 *   GET   /api/admin/governance/documents/:uid      → { document, versions }
 *   GET   /api/admin/governance/documents/:uid/activity → { uid, events: [{ action, line, at, actor, version }] }   D4811 part 5
 *   GET   /api/admin/governance/documents/:uid/related → { uid, dependants, governed_by, banner: { affected, version, dismissed } }   D4811 part 8
 *   POST  /api/admin/governance/documents/:uid/related { kind: 'governance' | 'template' | 'agreement', ref } → { relation }
 *   GET   /api/admin/governance/governing?kind=template|agreement&ref=… → { governing: [...] }   D4811 part 19
 *   POST  /api/admin/governance/documents/:uid/related/:id/reviewed { note? } → { relation }
 *   POST  /api/admin/governance/documents/:uid/related/dismiss → { banner }   hides the banner for this admin only
 *   POST  /api/admin/governance/documents/:uid/related/:id/unlink { reason } → { unlinked: { id, kind }, banner }   D4811 part 21
 *   PATCH /api/admin/governance/documents/:uid      { title?, effective_date?, status?, confidential?, template_slug?, envelope_id? } → { document }
 *         D4811 part 6: status executed or archived also needs { reason, confirm: 'EXECUTED'|'ARCHIVE' } and a recent step-up;
 *         executed needs { evidence: { kind: 'version', version } | { kind: 'envelope' } } (`services/governanceHighRisk.ts`).
 *   POST  /api/admin/governance/documents/:uid/versions   multipart: file (PDF or .docx, ≤ 25 MB), signed?, note? → { document, version }
 *         D4811 part 12: a signed copy (signed=true) also needs signed_on (YYYY-MM-DD, not after today), signatory and attest=true.
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
import { isSuperAdmin, requireHqAuthoring, requireStepUp } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { entityJurisdiction } from '../services/crossBorder';
import {
  DOCX, GOVERNANCE_CATEGORIES, GOVERNANCE_ENTITIES, GOVERNANCE_STATUSES, MAX_FILE_BYTES, PDF, canMove, dateOf, docView, entityName,
  envelopeExists, isCategory, isEntity, isStatus, ownershipOf, readDoc, readVersions, sha256Hex, sniffDocument,
  templateExists, versionKey, versionView, type DocRow, type GovernanceEntity, signedCopyOf, approvedVersions, copyOfChoice,
} from '../services/governance';
import { entityAttention, groupOf, type DocFacts } from '../services/governanceAttention';
import { GOVERNANCE_ACTIONS, eventOf } from '../services/governanceActivity';
import {
  bannerOf, baselineVersion, flagOf, isRelationKind, noteOf, triggerVersion, unlinkReasonOf, UNLINK_REASON_MAX, UNLINK_REASON_MIN, type RelationRow,
} from '../services/governanceRelations';
import { confirmationOf, evidenceOf, isHighRisk } from '../services/governanceHighRisk';
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
  // D4811: every document (confidential ones too) feeds the attention view, which says of a record only what this viewer may know.
  const facts: DocFacts[] = (docs as DocRow[]).map((row) => ({ row, versions: counts.get(row.uid) ?? 0, latestVersion: latest.get(row.uid) ? Number(latest.get(row.uid).version) : null }));
  const entities = GOVERNANCE_ENTITIES.map((key) => {
    const mine = (docs as DocRow[]).filter((d) => d.entity_key === key);
    const shown = mine.filter((d) => superAdmin || Number(d.confidential) !== 1);
    return {
      key, name: entityName(key), jurisdiction: entityJurisdiction(key), documents: shown.map((d) => docView(d, latest.get(d.uid) ?? null, counts.get(d.uid) ?? 0)), withheld: mine.length - shown.length,
      attention: entityAttention(key, facts, superAdmin),
    };
  });
  const profiles = (await c.env.DB.prepare('SELECT entity_key, ownership_json FROM governance_entity_profiles').all<any>().catch(() => ({ results: [] }))).results || [];
  return c.json({ entities, categories: GOVERNANCE_CATEGORIES, statuses: GOVERNANCE_STATUSES, super_admin: superAdmin, group: groupOf(profiles as any[]) });
});

governance.get('/linkable', async (c) => {
  await hq(c);
  const templates = (await c.env.DB.prepare('SELECT slug, title, category FROM legal_templates WHERE is_active = 1 ORDER BY title LIMIT 300').all<any>().catch(() => ({ results: [] }))).results || [];
  // Completed envelopes only, by title and date: never a signer's name or email.
  const envelopes = (await c.env.DB.prepare("SELECT id, document_title AS title, completed_at FROM esign_envelopes WHERE status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 100").all<any>().catch(() => ({ results: [] }))).results || [];
  return c.json({ templates, envelopes: envelopes.map((e: any) => ({ id: Number(e.id), title: e.title, completed_at: e.completed_at })) });
});

/** Whether an envelope has completed: the only envelope that can show a record was executed. */
async function envelopeCompleted(env: Env, id: number): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS ok FROM esign_envelopes WHERE id = ? AND status = 'completed'").bind(id).first().catch(() => null));
}

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
  const approved = await approvedVersions(c.env, doc.uid);
  return c.json({ document: docView(doc, versions[0] ?? null, versions.length), versions: versions.map((v) => versionView(v, approved)) });
});

/**
 * D4811 part 5 — GET /api/admin/governance/documents/:uid/activity: the
 * record's audit trail for its workspace (`services/governanceActivity.ts`),
 * newest first, at most 200. The same visibility as the record: a
 * confidential one is the Super Admin's alone (404 for anyone else), and
 * reading its trail is logged as a view, as reading the record is.
 */
governance.get('/documents/:uid/activity', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const rows = (await c.env.DB.prepare(
    `SELECT a.action, a.details, a.created_at, a.user_id, u.name AS actor_name
       FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action IN (SELECT value FROM json_each(?))
        AND CASE WHEN json_valid(a.details) = 1 THEN json_extract(a.details, '$.uid') END = ?
      ORDER BY a.id DESC LIMIT 200`,
  ).bind(JSON.stringify(GOVERNANCE_ACTIONS), doc.uid).all<any>()).results || [];
  if (Number(doc.confidential) === 1) await audit(c, user, 'governance_document_viewed', { uid: doc.uid, entity: doc.entity_key, category: doc.category });
  const events = rows.map(eventOf).filter(Boolean);
  return c.json({ uid: doc.uid, events, limit: 200 });
});

/**
 * D4811 part 8 — related documents (board CT-11, `services/governanceRelations.ts`).
 * The same visibility as the record. A dependant the viewer may not open (a
 * confidential record, for anyone but the Super Admin) is listed as Restricted,
 * with no title, reference or note. Links are references: nothing in a
 * dependant is ever changed here.
 */
/**
 * D4811 part 19: an agreement a governance record may govern, by the uid the
 * Contracts desk uses: a legacy document's uid or an envelope's uuid. Its
 * title and stored status, or null when there is none.
 */
async function agreementOf(env: Env, uid: string): Promise<{ title: string; status: string } | null> {
  const d = await env.DB.prepare('SELECT title, status FROM documents WHERE uid = ?').bind(uid).first<any>().catch(() => null);
  if (d) return { title: String(d.title), status: String(d.status) };
  const e = await env.DB.prepare('SELECT document_title, status FROM esign_envelopes WHERE envelope_uuid = ?').bind(uid).first<any>().catch(() => null);
  return e ? { title: String(e.document_title), status: String(e.status) } : null;
}

async function relationView(c: any, r: RelationRow & { reviewer_name?: string | null }, superAdmin: boolean, side: 'dependant' | 'governing') {
  const kind = side === 'dependant' ? r.dependent_kind : 'governance';
  const ref = side === 'dependant' ? r.dependent_ref : r.governing_uid;
  let title: string | null = null; let status: string | null = null; let entity: string | null = null; let category: string | null = null;
  let restricted = false; let missing = false;
  if (kind === 'governance') {
    const d = await readDoc(c.env, ref);
    if (!d) missing = true;
    else if (Number(d.confidential) === 1 && !superAdmin) restricted = true;
    else { title = d.title; status = d.status; entity = d.entity_key; category = d.category; }
  } else if (kind === 'agreement') {
    const a = await agreementOf(c.env, ref);
    if (!a) missing = true; else { title = a.title; status = a.status; }
  } else {
    const t = await c.env.DB.prepare('SELECT title, category FROM legal_templates WHERE slug = ? AND is_active = 1').bind(ref).first().catch(() => null);
    if (!t) missing = true; else { title = t.title; category = t.category ?? null; }
  }
  return {
    id: Number(r.id), kind, ref: restricted ? null : ref, title, status, entity_key: entity, category, restricted, missing,
    state: flagOf(r), flag_version: r.flag_version, flagged_at: r.flagged_at,
    reviewed_version: r.reviewed_version, reviewed_at: r.reviewed_at, reviewed_by: r.reviewer_name || null,
    review_note: restricted ? null : r.review_note,
  };
}

// D4811 part 19: the governance records that govern a template or an agreement (the reverse of
// /documents/:uid/related), for their workspaces. A confidential governing record is counted, never named.
governance.get('/governing', async (c) => {
  const { superAdmin } = await hq(c);
  const kind = c.req.query('kind');
  const ref = String(c.req.query('ref') || '');
  if ((kind !== 'template' && kind !== 'agreement') || !ref) return refuse(c, 422, { code: 'object_required', message: 'Name the template or agreement.' });
  const rows = (await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by
    WHERE r.dependent_kind = ? AND r.dependent_ref = ? ORDER BY r.id`).bind(kind, ref).all<any>()).results || [];
  const governing = await Promise.all(rows.map((r: any) => relationView(c, r, superAdmin, 'governing')));
  return c.json({ kind, ref, governing });
});

governance.get('/documents/:uid/related', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const own = (await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.governing_uid = ? ORDER BY r.id`).bind(doc.uid).all<any>()).results || [];
  const above = (await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.dependent_kind = 'governance' AND r.dependent_ref = ? ORDER BY r.id`).bind(doc.uid).all<any>()).results || [];
  const dismissal = await c.env.DB.prepare('SELECT flag_version FROM governance_relation_dismissals WHERE user_id = ? AND governing_uid = ?').bind(Number(user.id), doc.uid).first<{ flag_version: number }>();
  const dependants = [];
  for (const r of own) dependants.push(await relationView(c, r, superAdmin, 'dependant'));
  const governedBy = [];
  for (const r of above) governedBy.push(await relationView(c, r, superAdmin, 'governing'));
  if (Number(doc.confidential) === 1) await audit(c, user, 'governance_document_viewed', { uid: doc.uid, entity: doc.entity_key, category: doc.category });
  return c.json({ uid: doc.uid, dependants, governed_by: governedBy, banner: bannerOf(own, dismissal?.flag_version ?? null) });
});

governance.post('/documents/:uid/related', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const b = await c.req.json().catch(() => ({} as any));
  if (!isRelationKind(b.kind)) return c.json({ error: "kind must be 'governance', 'template' or 'agreement'" }, 400);
  const ref = typeof b.ref === 'string' ? b.ref.trim() : '';
  if (!ref) return c.json({ error: 'ref is required' }, 400);
  if (b.kind === 'governance') {
    if (ref === doc.uid) return refuse(c, 422, { code: 'relation_self', message: 'A record does not govern itself. Nothing was saved.' });
    const target = UID.test(ref) ? await readDoc(c.env, ref) : null;
    // A record this admin may not open is not one they can link: the same answer as a record that does not exist.
    if (!target || (Number(target.confidential) === 1 && !superAdmin)) return refuse(c, 422, { code: 'relation_target_not_found', message: 'That governance record is not available. Nothing was saved.' });
  } else if (b.kind === 'agreement') {
    if (!(await agreementOf(c.env, ref))) return refuse(c, 422, { code: 'relation_target_not_found', message: 'That agreement is not on the Contracts desk. Nothing was saved.' });
  } else if (!(await templateExists(c.env, ref))) {
    return refuse(c, 422, { code: 'relation_target_not_found', message: 'That template is not in the library. Nothing was saved.' });
  }
  const versions = await readVersions(c.env, doc.uid);
  const baseline = baselineVersion(doc.status, doc.executed_version, versions[0]?.version ?? null);
  const res = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO governance_relations (governing_uid, dependent_kind, dependent_ref, reviewed_version, created_by) VALUES (?, ?, ?, ?, ?)`,
  ).bind(doc.uid, b.kind, ref, baseline, Number(user.id)).run();
  if (!Number(res.meta?.changes ?? 0)) return refuse(c, 409, { code: 'relation_exists', message: 'That document is already linked to this record. Nothing was saved.' });
  const row = await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.governing_uid = ? AND r.dependent_kind = ? AND r.dependent_ref = ?`).bind(doc.uid, b.kind, ref).first<any>();
  await audit(c, user, 'governance_relation_added', { uid: doc.uid, entity: doc.entity_key, category: doc.category, kind: b.kind, relation: Number(row.id) });
  return c.json({ relation: await relationView(c, row, superAdmin, 'dependant') }, 201);
});

governance.post('/documents/:uid/related/dismiss', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const own = (await c.env.DB.prepare('SELECT flag_version, reviewed_version FROM governance_relations WHERE governing_uid = ?').bind(doc.uid).all<any>()).results || [];
  const banner = bannerOf(own, null);
  if (banner.version == null) return refuse(c, 409, { code: 'nothing_to_dismiss', message: 'No related document is waiting for review. Nothing was saved.' });
  await c.env.DB.prepare(
    `INSERT INTO governance_relation_dismissals (user_id, governing_uid, flag_version) VALUES (?, ?, ?)
     ON CONFLICT (user_id, governing_uid) DO UPDATE SET flag_version = excluded.flag_version, dismissed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(Number(user.id), doc.uid, banner.version).run();
  return c.json({ banner: { ...banner, dismissed: true } });
});

governance.post('/documents/:uid/related/:id/reviewed', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const id = Number(c.req.param('id'));
  const missing = () => refuse(c, 404, { code: 'relation_not_found', message: 'That related document is not linked to this record.' });
  if (!Number.isSafeInteger(id) || id < 1) return missing();
  const row = await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.id = ? AND r.governing_uid = ?`).bind(id, doc.uid).first<any>();
  if (!row) return missing();
  const view = await relationView(c, row, superAdmin, 'dependant');
  // A dependant this admin may not open is not one they can say they checked.
  if (view.restricted) return missing();
  if (view.state !== 'review_suggested') return refuse(c, 409, { code: 'relation_not_flagged', message: 'This document is not waiting for review. Nothing was saved.' });
  const b = await c.req.json().catch(() => ({} as any));
  const note = noteOf(b.note);
  if (note === false) return c.json({ error: 'note must be text of at most 500 characters' }, 400);
  await c.env.DB.prepare(
    `UPDATE governance_relations SET reviewed_version = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND governing_uid = ?`,
  ).bind(row.flag_version, Number(user.id), now(), note, id, doc.uid).run();
  await audit(c, user, 'governance_relation_reviewed', { uid: doc.uid, entity: doc.entity_key, category: doc.category, kind: row.dependent_kind, relation: id, version: row.flag_version });
  const saved = await c.env.DB.prepare(`SELECT r.*, u.name AS reviewer_name FROM governance_relations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.id = ?`).bind(id).first<any>();
  return c.json({ relation: await relationView(c, saved, superAdmin, 'dependant') });
});

/**
 * D4811 part 21 — POST /documents/:uid/related/:id/unlink { reason }: removes
 * one link (CT-11; part 8 had no unlink). The same access as linking: the
 * governing record must be one this admin may open, and a dependant they may
 * not open (a confidential record, for anyone but the Super Admin) answers
 * exactly as a link that does not exist. A reason of 10 to 500 characters is
 * kept in the audit row. Neither document is rewritten: only the reference
 * row goes, with the review state it carried. The audit rows of its linking
 * and reviews stay, so the Activity tab keeps that history; banner dismissals
 * are per record and version, not per link, so they stay too.
 */
governance.post('/documents/:uid/related/:id/unlink', async (c) => {
  const { user, superAdmin } = await hq(c);
  const doc = await visible(c, superAdmin);
  if (doc instanceof Response) return doc;
  const id = Number(c.req.param('id'));
  const missing = () => refuse(c, 404, { code: 'relation_not_found', message: 'That related document is not linked to this record. Nothing was removed.' });
  if (!Number.isSafeInteger(id) || id < 1) return missing();
  const row = await c.env.DB.prepare('SELECT * FROM governance_relations WHERE id = ? AND governing_uid = ?').bind(id, doc.uid).first<any>();
  if (!row) return missing();
  // A dependant this admin may not open is not one they can unlink: the same answer as no link at all.
  if ((await relationView(c, row, superAdmin, 'dependant')).restricted) return missing();
  const b = await c.req.json().catch(() => ({} as any));
  const reason = unlinkReasonOf(b?.reason);
  if (!reason) return refuse(c, 422, { code: 'reason_required', message: `Say why, in ${UNLINK_REASON_MIN} to ${UNLINK_REASON_MAX} characters. It is kept in the audit log. Nothing was removed.` });
  const versions = await readVersions(c.env, doc.uid);
  const res = await c.env.DB.prepare('DELETE FROM governance_relations WHERE id = ? AND governing_uid = ?').bind(id, doc.uid).run();
  if (!Number(res.meta?.changes ?? 0)) return missing();
  await audit(c, user, 'governance_relation_unlinked', {
    uid: doc.uid, entity: doc.entity_key, category: doc.category, kind: row.dependent_kind, ref: row.dependent_ref, relation: id,
    version: versions[0]?.version ?? null, flag_version: row.flag_version ?? null, reviewed_version: row.reviewed_version ?? null, reason,
  });
  const own = (await c.env.DB.prepare('SELECT flag_version, reviewed_version FROM governance_relations WHERE governing_uid = ?').bind(doc.uid).all<any>()).results || [];
  const dismissal = await c.env.DB.prepare('SELECT flag_version FROM governance_relation_dismissals WHERE user_id = ? AND governing_uid = ?').bind(Number(user.id), doc.uid).first<{ flag_version: number }>();
  return c.json({ unlinked: { id, kind: row.dependent_kind }, banner: bannerOf(own, dismissal?.flag_version ?? null) });
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
  let highRisk: { reason: string; evidence: string | null; sha256?: string | null; copyOf?: number | null } | null = null;
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return c.json({ error: `status must be one of ${GOVERNANCE_STATUSES.join(', ')}` }, 400);
    if (!canMove(doc.status, b.status)) return refuse(c, 409, { code: 'status_move_refused', message: `A ${doc.status} document cannot move to ${b.status}. Nothing was saved.` });
    // D4811 part 6: executing or archiving is high-risk: a reason, the typed word, and a recent step-up, checked here.
    if (isHighRisk(b.status) && b.status !== doc.status) {
      const confirmed = confirmationOf(b.status, b);
      if (!confirmed.ok) return refuse(c, confirmed.refusal.status, { code: confirmed.refusal.code, message: confirmed.refusal.message });
      highRisk = { reason: confirmed.reason, evidence: null };
    }
    if (b.status === 'executed' && doc.status !== 'executed') {
      // An unsigned draft is never marked executed, and the evidence is the admin's explicit choice (CT-12), never picked here.
      const versions = await readVersions(c.env, doc.uid);
      const envelopeId = links.envelope_id !== undefined ? links.envelope_id : (doc.envelope_id == null ? null : Number(doc.envelope_id));
      if (!versions.some((v) => Number(v.signed) === 1) && !(envelopeId != null && await envelopeCompleted(c.env, envelopeId))) {
        return refuse(c, 409, { code: 'not_signed', message: 'Upload the signed copy, or link the signed envelope, before marking this document executed. Nothing was saved.' });
      }
      const chosen = evidenceOf(b.evidence, versions, envelopeId, envelopeId != null && await envelopeCompleted(c.env, envelopeId));
      if (!chosen.ok) return refuse(c, chosen.refusal.status, { code: chosen.refusal.code, message: chosen.refusal.message });
      next.executed_version = chosen.evidence.version;
      if (chosen.evidence.envelope != null) next.envelope_id = chosen.evidence.envelope;
      highRisk!.evidence = chosen.evidence.version != null ? `v${chosen.evidence.version}` : `envelope #${chosen.evidence.envelope}`;
      // D4811 part 12 (CT-92 "Execution evidence"): the evidence's hash is logged with it.
      if (chosen.evidence.version != null) {
        const ev = versions.find((v) => Number(v.version) === chosen.evidence.version);
        highRisk!.sha256 = ev?.file_sha256 ?? null;
        // D4811 part 20: and the approved version the signed copy names, when it names one.
        highRisk!.copyOf = ev?.copy_of_version == null ? null : Number(ev.copy_of_version);
      }
    }
    // The step-up comes after every form check, so a mistyped word never asks for a code; a missing step-up answers 403 step_up_required.
    if (highRisk) await requireStepUp(c);
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
    uid: doc.uid, entity: doc.entity_key, category: doc.category, from: doc.status, status,
    fields: Object.keys(b).filter((k) => b[k] !== undefined && !['reason', 'confirm', 'evidence'].includes(k)),
    ...(highRisk ? { reason: highRisk.reason, evidence: highRisk.evidence, ...(highRisk.sha256 ? { evidence_sha256: highRisk.sha256 } : {}),
      ...(highRisk.copyOf != null ? { copy_of: highRisk.copyOf } : {}) } : {}),
  });
  const saved = (await readDoc(c.env, doc.uid))!;
  const versions = await readVersions(c.env, doc.uid);
  if (b.status !== undefined && b.status !== doc.status) {
    // D4811 part 8: a move to Approved or Executed at a newer version asks a person to review each dependant. Nothing in them changes.
    const v = triggerVersion(saved.status, saved.executed_version, versions[0]?.version ?? null);
    if (v != null) {
      await c.env.DB.prepare(
        `UPDATE governance_relations SET flag_version = ?, flagged_at = ? WHERE governing_uid = ? AND (flag_version IS NULL OR flag_version < ?) AND (reviewed_version IS NULL OR reviewed_version < ?)`,
      ).bind(v, now(), doc.uid, v, v).run();
    }
  }
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
  // D4811 part 12 (CT-12 B): a signed copy says when it was signed, by whom, and is attested by the uploader.
  const copy = signed ? signedCopyOf({ signed_on: form?.get('signed_on'), signatory: form?.get('signatory'), attest: form?.get('attest') }, now().slice(0, 10)) : null;
  if (copy && !copy.ok) return refuse(c, 422, { code: copy.code, message: copy.message });
  // D4811 part 20: a signed copy may name the counsel-approved version it is a copy of; a draft never can.
  let copyOf: number | null = null;
  if (signed) {
    const choice = copyOfChoice(form?.get('copy_of'), await readVersions(c.env, doc.uid), await approvedVersions(c.env, doc.uid));
    if (!choice.ok) return refuse(c, choice.status, { code: choice.code, message: choice.message });
    copyOf = choice.version;
  }
  const noteRaw = form?.get('note');
  const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 500) : null;
  const sha = await sha256Hex(bytes);
  const last = await c.env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM governance_document_versions WHERE document_uid = ?').bind(doc.uid).first<{ v: number }>();
  const version = Number(last?.v ?? 0) + 1;
  const key = versionKey(doc.entity_key as GovernanceEntity, doc.uid, version, type);
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { governance_uid: doc.uid, version: String(version) } });
  try {
    await c.env.DB.prepare(
      `INSERT INTO governance_document_versions (document_uid, version, signed, r2_key, file_sha256, file_bytes, content_type, note, uploaded_by, signed_on, signatory, attested_by, copy_of_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(doc.uid, version, signed ? 1 : 0, key, sha, bytes.length, type, note, Number(user.id),
      copy?.ok ? copy.signed_on : null, copy?.ok ? copy.signatory : null, copy?.ok ? Number(user.id) : null, copyOf).run();
  } catch {
    // Another upload took this number first: its row stands, and this file is not recorded.
    await c.env.FILES.delete(key).catch(() => {});
    return refuse(c, 409, { code: 'version_conflict', message: 'Another version was uploaded at the same moment. Reload and upload again.' });
  }
  await c.env.DB.prepare('UPDATE governance_documents SET updated_by = ?, updated_at = ? WHERE uid = ?').bind(Number(user.id), now(), doc.uid).run();
  await audit(c, user, 'governance_version_uploaded', { uid: doc.uid, entity: doc.entity_key, category: doc.category, version, signed, bytes: bytes.length, sha256: sha,
    ...(copy?.ok ? { signed_on: copy.signed_on } : {}), ...(copyOf != null ? { copy_of: copyOf } : {}) });
  const versions = await readVersions(c.env, doc.uid);
  return c.json({ document: docView((await readDoc(c.env, doc.uid))!, versions[0] ?? null, versions.length), version: versionView(versions[0], await approvedVersions(c.env, doc.uid)) }, 201);
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
