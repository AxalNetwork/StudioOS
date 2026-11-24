/** D7720 (#7720): owner-scoped study questions, persistent finding links and SQL counts.
 * Links retain their snapshots after a finding is removed; status changes never hide evidence.
 * Shared validation/SQL helpers also serve the append-only decision router.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { checkProjectOwner } from './research_projects';
import { readText } from './research_studies';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

const questions = new Hono<{ Bindings: Env }>();
export type StudyContext = Context<{ Bindings: Env }>;
type Project = NonNullable<Awaited<ReturnType<typeof checkProjectOwner>>>;
export const QUESTION_MAX = 100;
export const STUDY_LINK_MAX = 1000;
export const QUESTION_TOPICS = ['customer_definition', 'demand', 'size', 'competition', 'pricing', 'channels', 'risks'] as const;
export const QUESTION_LIMITS = { text: 1000, answer: 4000, gap_note: 2000, next_validation_action: 2000 } as const;
export const LINK_NOTE_LIMIT = 2000;
export const newStudyUid = () => crypto.randomUUID().replace(/-/g, '');
export const studyError = (c: StudyContext, code: string, status: 400 | 404 | 409 = 400) => refuse(c, status, {
  code, message: code === 'study_changed' ? 'This study or its project changed. Read it again before saving.' :
    code === 'project_not_found' ? 'No such research project.' : 'The study request could not be saved. Check its fields and read the study again.',
});
export function studyWriteRefusal(c: StudyContext, user: User, project: Project) {
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot change research studies.' });
  if (project.status === 'archived') return refuse(c, 409, { code: 'project_archived', message: 'Restore this project before changing its study.' });
  return null;
}
export async function studyBody(c: StudyContext): Promise<Record<string, unknown> | null> {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}
export const validVersion = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
export const studyVersion = (env: Env, projectId: number) => env.DB.prepare('SELECT version FROM research_studies WHERE project_id = ?').bind(projectId).first<{ version: number }>();

/** Only known constraint conflicts are translated. Transport/unexpected failures reach the error handler. */
export function studyWriteError(c: StudyContext, error: unknown) {
  const message = String(error);
  if (message.includes('study_question_limit')) return studyError(c, 'study_question_limit');
  if (message.includes('study_link_limit')) return studyError(c, 'study_link_limit');
  if (/NOT NULL constraint failed: research_study_links\.target_kind/.test(message)) return studyError(c, 'study_changed', 409);
  throw error;
}
export interface StudyLinkInput { finding_uid: string; direction: string; note: string | null }
export function parseStudyLink(value: unknown): StudyLinkInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  const note = readText('note', b.note, LINK_NOTE_LIMIT);
  if (typeof b.finding_uid !== 'string' || b.finding_uid.length < 1 || b.finding_uid.length > 64 ||
      (b.target_kind !== undefined && b.target_kind !== 'finding') ||
      !['supports', 'contradicts', 'context'].includes(String(b.direction)) || note.error) return null;
  return { finding_uid: b.finding_uid, direction: b.direction as string, note: note.value! };
}
export async function validStudyFinding(env: Env, projectId: number, uid: string) {
  return !!(await env.DB.prepare(`SELECT id FROM research_project_findings WHERE project_id = ? AND uid = ? AND (state IS NULL OR state <> 'discarded')`).bind(projectId, uid).first());
}
/** A missing finding makes the required target kind NULL, aborting a raced delete/discard in the whole batch. */
export function insertStudyLink(env: Env, projectId: number, subject: 'question' | 'decision', uid: string, link: StudyLinkInput, onlyIfChanged = false) {
  return env.DB.prepare(`INSERT INTO research_study_links
    (uid, project_id, question_id, decision_id, direction, note, target_kind, finding_id, finding_uid, finding_kind, finding_updated_at)
    SELECT ?, s.project_id, CASE WHEN s.is_question = 1 THEN s.id END, CASE WHEN s.is_question = 0 THEN s.id END,
      ?, ?, CASE WHEN f.id IS NOT NULL THEN 'finding' END, f.id, f.uid, f.kind, f.updated_at
    FROM (SELECT id, project_id, 1 AS is_question FROM research_study_questions WHERE uid = ? AND ? = 'question'
      UNION ALL SELECT id, project_id, 0 AS is_question FROM research_study_decisions WHERE uid = ? AND ? = 'decision') s
    LEFT JOIN research_project_findings f ON f.uid = ? AND f.project_id = s.project_id AND (f.state IS NULL OR f.state <> 'discarded')
    WHERE s.project_id = ? AND (? = 0 OR changes() > 0)`)
    .bind(newStudyUid(), link.direction, link.note, uid, subject, uid, subject, link.finding_uid, projectId, onlyIfChanged ? 1 : 0);
}
interface LinkRow extends Record<string, unknown> { question_id: number | null; decision_id: number | null; finding_removed: number }
export async function readStudyLinks(env: Env, projectId: number) {
  const rows = await env.DB.prepare(`SELECT l.uid, l.question_id, l.decision_id, l.direction, l.note, l.target_kind,
    l.finding_uid, l.finding_kind, l.finding_updated_at, (l.finding_id IS NULL) AS finding_removed,
    CASE WHEN l.finding_id IS NULL THEN 'finding removed' ELSE NULL END AS target_label
    FROM research_study_links l WHERE l.project_id = ? ORDER BY l.id`).bind(projectId).all<LinkRow>();
  return (rows.results || []).map((l) => ({ ...l, finding_removed: !!l.finding_removed }));
}
export async function studyQuestionResponse(env: Env, projectId: number) {
  const study = await studyVersion(env, projectId);
  if (!study) return { recorded: false, study_version: null, counts: null, questions: [] };
  const counts = await env.DB.prepare(`SELECT count(*) AS total,
    coalesce(sum(status = 'answered'), 0) AS answered, coalesce(sum(status = 'open'), 0) AS open,
    coalesce(sum(status = 'set_aside'), 0) AS set_aside,
    coalesce(sum(status = 'open' AND EXISTS (SELECT 1 FROM research_study_links l WHERE l.question_id = q.id AND l.direction = 'contradicts')), 0) AS open_with_contradicting_evidence,
    (SELECT count(*) FROM research_study_links WHERE project_id = ? AND target_kind = 'finding' AND finding_id IS NULL) AS links_with_removed_finding
    FROM research_study_questions q WHERE q.project_id = ?`).bind(projectId, projectId).first();
  const rows = await env.DB.prepare('SELECT * FROM research_study_questions WHERE project_id = ? ORDER BY position, id').bind(projectId).all<Record<string, unknown>>();
  const links = await readStudyLinks(env, projectId);
  return { recorded: true, study_version: study.version, counts,
    questions: (rows.results || []).map(({ id, project_id: _projectId, ...q }) => ({ ...q, links: links.filter((l) => l.question_id === id).map(({ question_id: _q, decision_id: _d, ...l }) => l) })) };
}
function questionFields(b: Record<string, unknown>): ({ topic: string; status: string } & Record<keyof typeof QUESTION_LIMITS, string | null>) | null {
  if (!QUESTION_TOPICS.includes(b.topic as typeof QUESTION_TOPICS[number]) || !['open', 'answered', 'set_aside'].includes(String(b.status ?? 'open'))) return null;
  const values: Record<string, string | null> = {};
  for (const [key, limit] of Object.entries(QUESTION_LIMITS)) {
    const r = readText(key, b[key], limit);
    if (r.error || (key === 'text' && !r.value)) return null;
    values[key] = r.value!;
  }
  return { ...values, topic: b.topic as string, status: (b.status ?? 'open') as string } as { topic: string; status: string } & Record<keyof typeof QUESTION_LIMITS, string | null>;
}
const questionRow = (env: Env, pid: number, uid: string) => env.DB.prepare('SELECT id, version FROM research_study_questions WHERE project_id = ? AND uid = ?').bind(pid, uid).first<{ id: number; version: number }>();
const fenceQuestion = (env: Env, pid: number, uid: string, version: number, owner: number) => env.DB.prepare(`UPDATE research_study_questions SET version = version + 1, updated_at = datetime('now') WHERE project_id = ? AND uid = ? AND version = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')`).bind(pid, uid, version, owner);

questions.get('/:uid/study/questions', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  return c.json(await studyQuestionResponse(c.env, project.id));
});
questions.post('/:uid/study/questions', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  if (!(await studyVersion(c.env, project.id))) return studyError(c, 'study_not_found', 404);
  const body = await studyBody(c); const f = body && questionFields(body);
  if (!f) return studyError(c, 'invalid_question');
  const uid = newStudyUid();
  try {
    const r = await c.env.DB.prepare(`INSERT INTO research_study_questions (uid, project_id, topic, text, status, answer, gap_note, next_validation_action, position)
      SELECT ?, project_id, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM research_study_questions WHERE project_id = ?)
      FROM research_studies WHERE project_id = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')`)
      .bind(uid, f.topic, f.text, f.status, f.answer, f.gap_note, f.next_validation_action, project.id, project.id, user.id).run();
    if (!r.meta.changes) return studyError(c, 'study_changed', 409);
  } catch (e) { return studyWriteError(c, e); }
  await logAdminAction(c.env, user.id, user.email, 'research_study_question_created', { project_uid: project.uid, question_uid: uid });
  return c.json({ uid, ...await studyQuestionResponse(c.env, project.id) }, 201);
});
questions.post('/:uid/study/questions/reorder', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  if (!(await studyVersion(c.env, project.id))) return studyError(c, 'study_not_found', 404);
  const body = await studyBody(c); const order = body?.questions;
  if (!Array.isArray(order) || order.length > QUESTION_MAX || order.some((q) => !q || typeof q.uid !== 'string' || !validVersion(q.version)) || new Set(order.map((q) => q.uid)).size !== order.length) return studyError(c, 'invalid_order');
  // A single statement checks the complete versioned set before changing any row.
  const json = JSON.stringify(order.map((q) => ({ uid: q.uid, version: q.version })));
  const r = await c.env.DB.prepare(`WITH requested AS (SELECT value, CAST(key AS INTEGER) AS position FROM json_each(?))
    UPDATE research_study_questions SET position = (SELECT position FROM requested WHERE json_extract(value, '$.uid') = uid), version = version + 1, updated_at = datetime('now')
    WHERE project_id = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')
    AND (SELECT count(*) FROM research_study_questions WHERE project_id = ?) = ?
    AND (SELECT count(*) FROM requested r JOIN research_study_questions q ON q.uid = json_extract(r.value, '$.uid') AND q.version = json_extract(r.value, '$.version') WHERE q.project_id = ?) = ?`)
    .bind(json, project.id, user.id, project.id, order.length, project.id, order.length).run();
  if (Number(r.meta.changes) !== order.length) return studyError(c, 'study_changed', 409);
  await logAdminAction(c.env, user.id, user.email, 'research_study_questions_reordered', { project_uid: project.uid, count: order.length });
  return c.json(await studyQuestionResponse(c.env, project.id));
});
questions.put('/:uid/study/questions/:questionUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  const uid = c.req.param('questionUid');
  if (!(await questionRow(c.env, project.id, uid))) return studyError(c, 'question_not_found', 404);
  const body = await studyBody(c); const f = body && questionFields(body);
  if (!f || !validVersion(body?.version)) return studyError(c, 'invalid_question');
  const r = await c.env.DB.prepare(`UPDATE research_study_questions SET topic = ?, text = ?, status = ?, answer = ?, gap_note = ?, next_validation_action = ?, version = version + 1, updated_at = datetime('now') WHERE project_id = ? AND uid = ? AND version = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')`)
    .bind(f.topic, f.text, f.status, f.answer, f.gap_note, f.next_validation_action, project.id, uid, body.version, user.id).run();
  if (!r.meta.changes) return studyError(c, 'study_changed', 409);
  await logAdminAction(c.env, user.id, user.email, 'research_study_question_updated', { project_uid: project.uid, question_uid: uid, fields: Object.keys(QUESTION_LIMITS).concat(['topic', 'status']) });
  return c.json(await studyQuestionResponse(c.env, project.id));
});
questions.delete('/:uid/study/questions/:questionUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  const uid = c.req.param('questionUid'); const body = await studyBody(c);
  if (!validVersion(body?.version)) return studyError(c, 'invalid_version');
  const r = await c.env.DB.prepare(`DELETE FROM research_study_questions WHERE project_id = ? AND uid = ? AND version = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')`).bind(project.id, uid, body.version, user.id).run();
  if (!r.meta.changes) return studyError(c, 'study_changed', 409);
  await logAdminAction(c.env, user.id, user.email, 'research_study_question_removed', { project_uid: project.uid, question_uid: uid });
  return c.json(await studyQuestionResponse(c.env, project.id));
});
questions.post('/:uid/study/questions/:questionUid/links', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  const uid = c.req.param('questionUid');
  if (!(await questionRow(c.env, project.id, uid))) return studyError(c, 'question_not_found', 404);
  const body = await studyBody(c); const link = parseStudyLink(body);
  if (!link || !validVersion(body?.version)) return studyError(c, 'invalid_link');
  if (!(await validStudyFinding(c.env, project.id, link.finding_uid))) return studyError(c, 'finding_not_in_project');
  try {
    const r = await c.env.DB.batch([fenceQuestion(c.env, project.id, uid, body.version, user.id), insertStudyLink(c.env, project.id, 'question', uid, link, true)]);
    if (!r[0].meta.changes) return studyError(c, 'study_changed', 409);
  } catch (e) { return studyWriteError(c, e); }
  await logAdminAction(c.env, user.id, user.email, 'research_study_question_link_added', { project_uid: project.uid, question_uid: uid });
  return c.json(await studyQuestionResponse(c.env, project.id), 201);
});
questions.delete('/:uid/study/questions/:questionUid/links/:linkUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  const uid = c.req.param('questionUid'); const body = await studyBody(c);
  if (!validVersion(body?.version)) return studyError(c, 'invalid_version');
  const link = await c.env.DB.prepare(`SELECT l.id FROM research_study_links l JOIN research_study_questions q ON q.id = l.question_id WHERE q.project_id = ? AND q.uid = ? AND l.uid = ?`).bind(project.id, uid, c.req.param('linkUid')).first<{ id: number }>();
  if (!link) return studyError(c, 'link_not_found', 404);
  const r = await c.env.DB.batch([fenceQuestion(c.env, project.id, uid, body.version, user.id), c.env.DB.prepare('DELETE FROM research_study_links WHERE id = ? AND changes() > 0').bind(link.id)]);
  if (!r[0].meta.changes) return studyError(c, 'study_changed', 409);
  await logAdminAction(c.env, user.id, user.email, 'research_study_question_link_removed', { project_uid: project.uid, question_uid: uid, link_uid: c.req.param('linkUid') });
  return c.json(await studyQuestionResponse(c.env, project.id));
});
export const mount: RouteMount = { path: '/api/research/projects', router: questions };
export default questions;
