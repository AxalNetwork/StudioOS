/**
 * D7817 (#7817) — a Research Project's attachments: a saved analysis version
 * kept as a frozen copy, which a finding may cite a source of. Attach, list
 * (without the copy's body), read one, detach. Mounted at
 * `/api/research/projects` beside `research_projects.ts` (migration
 * 202611211307_7817_research_project_attachments.sql; the copy is built in
 * `services/researchProjectAttachments.ts`).
 *
 * EVERY PATH IS `/:uid/attachments…`. The router declares no static first
 * segment and no `before`, so it never takes a path another router on this
 * prefix owns (`/with-study`, `/with-comparison`, `/briefs/saved`).
 *
 * OWNER-SCOPED through `checkProjectOwner`: another member's project, analysis
 * or attachment reads as not found. An archived project refuses writes
 * (409 `project_archived`); a support session cannot write (403
 * `support_read_only`). Each write leaves a receipt without research text.
 *
 * NOT A STUDY REFERENCE. Attaching writes no `research_study_refs` row, and
 * the list reads only `research_project_attachments`.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import {
  ATTACHMENTS_PER_PROJECT, ATTACHMENT_KINDS, COPY_BYTES_LIMIT, COPY_FORMAT,
  isAttachmentKind, readAnalysisVersion, readCopy,
} from '../services/researchProjectAttachments';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner } from './research_projects';

type C = Context<{ Bindings: Env }>;
const attachments = new Hono<{ Bindings: Env }>();
const newUid = () => crypto.randomUUID().replace(/-/g, '');

const projectNotFound = (c: C) => refuse(c, 404, { code: 'project_not_found', message: 'No such research project.' });
const attachmentNotFound = (c: C) => refuse(c, 404, { code: 'attachment_not_found', message: 'No such attachment in this project.' });

function writeRefusal(c: C, user: User, project: { status: string }) {
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot change research projects.' });
  if (project.status === 'archived') return refuse(c, 409, { code: 'project_archived', message: 'Restore this project before changing its attachments.' });
  return null;
}

/** The list row: what was attached and when, never the copy's body. */
const LIST_COLUMNS = `uid, kind, object_id, object_version, title, copy_format, attached_at,
  json_extract(copy_json, '$.saved_at') AS saved_at`;
type ListRow = { uid: string; kind: string; object_id: string; object_version: number; title: string; copy_format: number; attached_at: string; saved_at: string | null };
const itemDto = (r: ListRow) => ({
  uid: r.uid, kind: r.kind, object_id: r.object_id, version: r.object_version, title: r.title,
  copy_format: r.copy_format, saved_at: r.saved_at ?? null, attached_at: r.attached_at,
});

const ownAttachment = (env: Env, projectId: number, uid: string, userId: number) => env.DB.prepare(
  `SELECT id, owner_user_id, copy_json, ${LIST_COLUMNS} FROM research_project_attachments WHERE uid = ? AND project_id = ? AND owner_user_id = ?`,
).bind(uid, projectId, userId).first<ListRow & { id: number; owner_user_id: number; copy_json: string }>();

attachments.get('/:uid/attachments', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return projectNotFound(c);
  const rows = await c.env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM research_project_attachments WHERE project_id = ? AND owner_user_id = ? ORDER BY id DESC`,
  ).bind(project.id, user.id).all<ListRow>();
  return c.json({ items: (rows.results || []).map(itemDto), limit: ATTACHMENTS_PER_PROJECT, kinds: ATTACHMENT_KINDS });
});

attachments.post('/:uid/attachments', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return projectNotFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(c, 400, { code: 'invalid_body', message: 'Send the kind, the analysis and its version.' });
  if (!isAttachmentKind(body.kind)) return refuse(c, 400, { code: 'invalid_kind', message: `Kind is one of ${ATTACHMENT_KINDS.join(', ')}.` });
  const objectId = typeof body.object_id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(body.object_id) ? body.object_id : null;
  const version = Number.isSafeInteger(body.version) && (body.version as number) >= 1 ? body.version as number : null;
  if (!objectId || !version) return refuse(c, 400, { code: 'invalid_version', message: 'Name the analysis and a saved version number.' });

  // The same project, analysis and version attached again is the attachment on record.
  const existing = await c.env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM research_project_attachments WHERE project_id = ? AND owner_user_id = ? AND kind = ? AND object_id = ? AND object_version = ?`,
  ).bind(project.id, user.id, body.kind, objectId, version).first<ListRow>();
  if (existing) return c.json({ item: itemDto(existing), created: false }, 200);

  let copy;
  try {
    copy = await readAnalysisVersion(c.env, user.id, objectId, version);
  } catch (raw) {
    return refuse(c, 503, { code: 'analysis_unreadable', message: 'The saved analysis could not be read. Nothing was attached.', raw });
  }
  if (!copy) return refuse(c, 404, { code: 'analysis_not_found', message: 'No completed analysis of yours at that version.' });
  const copyJson = JSON.stringify(copy);
  if (new TextEncoder().encode(copyJson).length > COPY_BYTES_LIMIT) {
    return refuse(c, 413, { code: 'copy_too_large', message: `This version is larger than ${COPY_BYTES_LIMIT / 1024} KB, the most a project keeps. Nothing was attached.` });
  }
  const uid = newUid();
  // The cap is checked in the insert itself, so two attaches at once cannot pass it together.
  const made = await c.env.DB.prepare(
    `INSERT INTO research_project_attachments (uid, project_id, owner_user_id, kind, object_id, object_version, title, copy_format, copy_json, attached_by)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM research_project_attachments WHERE project_id = ?) < ?
     ON CONFLICT(project_id, kind, object_id, object_version) DO NOTHING
     RETURNING ${LIST_COLUMNS}`,
  ).bind(uid, project.id, user.id, body.kind, objectId, version, copy.title, COPY_FORMAT, copyJson, user.id, project.id, ATTACHMENTS_PER_PROJECT).first<ListRow>();
  if (!made) {
    const raced = await c.env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM research_project_attachments WHERE project_id = ? AND owner_user_id = ? AND kind = ? AND object_id = ? AND object_version = ?`,
    ).bind(project.id, user.id, body.kind, objectId, version).first<ListRow>();
    if (raced) return c.json({ item: itemDto(raced), created: false }, 200);
    return refuse(c, 409, { code: 'attachment_limit', message: `A project keeps at most ${ATTACHMENTS_PER_PROJECT} attachments. Detach one first.` });
  }
  await logAdminAction(c.env, user.id, user.email, 'research_project_attachment_added', {
    project_uid: project.uid, attachment_uid: uid, kind: body.kind, object_id: objectId, version,
  });
  return c.json({ item: itemDto(made), created: true }, 201);
});

attachments.get('/:uid/attachments/:attachmentUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return projectNotFound(c);
  const row = await ownAttachment(c.env, project.id, c.req.param('attachmentUid'), user.id);
  const copy = row ? readCopy(row, user.id) : null;
  if (!row || !copy) return attachmentNotFound(c);
  return c.json({ item: { ...itemDto(row), copy } });
});

attachments.delete('/:uid/attachments/:attachmentUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return projectNotFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const row = await ownAttachment(c.env, project.id, c.req.param('attachmentUid'), user.id);
  if (!row) return attachmentNotFound(c);
  // Findings and their frozen citations stay; only the link to the copy goes.
  // `updated_at` is never written here: a detach is not a change of text.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE research_project_finding_citations SET attachment_id = NULL WHERE attachment_id = ?').bind(row.id),
    c.env.DB.prepare('UPDATE research_project_findings SET attachment_id = NULL WHERE attachment_id = ? AND owner_user_id = ?').bind(row.id, user.id),
    c.env.DB.prepare('DELETE FROM research_project_attachments WHERE id = ? AND owner_user_id = ?').bind(row.id, user.id),
  ]);
  await logAdminAction(c.env, user.id, user.email, 'research_project_attachment_removed', {
    project_uid: project.uid, attachment_uid: row.uid, kind: row.kind, object_id: row.object_id, version: row.object_version,
  });
  return c.json({ ok: true });
});

export const mount: RouteMount = { path: '/api/research/projects', router: attachments };
export default attachments;
