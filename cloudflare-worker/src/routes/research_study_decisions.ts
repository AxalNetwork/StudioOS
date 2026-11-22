/** D7720 (#7720): append a study decision and its initial evidence in one D1 batch.
 * There are deliberately no update/delete/link-mutation routes for a decision.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { checkProjectOwner } from './research_projects';
import { readText } from './research_studies';
import { logAdminAction } from '../services/adminAudit';
import type { RouteMount } from '../util/routeRegistry';
import { insertStudyLink, newStudyUid, parseStudyLink, readStudyLinks, studyBody, studyError, studyVersion, studyWriteError, studyWriteRefusal, validStudyFinding, validVersion } from './research_study_questions';

const decisions = new Hono<{ Bindings: Env }>();
export const DECISION_TEXT_LIMIT = 4000;
/** Bounds each transactional save, below D1's per-invocation query limit. */
export const DECISION_LINK_MAX = 20;
export const DECISION_OUTCOMES = ['enter', 'do_not_enter', 'test_further'] as const;
async function response(env: Env, projectId: number) {
  const study = await studyVersion(env, projectId);
  if (!study) return { recorded: false, study_version: null, current: null, decisions: [] };
  const rows = await env.DB.prepare('SELECT * FROM research_study_decisions WHERE project_id = ? ORDER BY id DESC').bind(projectId).all<Record<string, unknown>>();
  const links = await readStudyLinks(env, projectId);
  const items = (rows.results || []).map(({ id, project_id: _pid, ...d }) => ({ ...d, links: links.filter((l) => l.decision_id === id).map(({ question_id: _q, decision_id: _d, ...l }) => l) }));
  return { recorded: true, study_version: study.version, current: items[0] ?? null, decisions: items };
}
decisions.get('/:uid/study/decisions', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  return c.json(await response(c.env, project.id));
});
decisions.post('/:uid/study/decisions', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return studyError(c, 'project_not_found', 404);
  const refused = studyWriteRefusal(c, user, project); if (refused) return refused;
  if (!(await studyVersion(c.env, project.id))) return studyError(c, 'study_not_found', 404);
  const b = await studyBody(c);
  if (!b || !validVersion(b.version) || !DECISION_OUTCOMES.includes(b.outcome as typeof DECISION_OUTCOMES[number])) return studyError(c, 'invalid_decision');
  const rationale = readText('rationale', b.rationale, DECISION_TEXT_LIMIT);
  const assumptions = readText('reversing_assumptions', b.reversing_assumptions, DECISION_TEXT_LIMIT);
  const raw = b.links ?? [];
  if (!rationale.value || rationale.error || assumptions.error || !Array.isArray(raw) || raw.length > DECISION_LINK_MAX) return studyError(c, 'invalid_decision');
  const links = raw.map(parseStudyLink);
  if (links.some((l) => !l)) return studyError(c, 'invalid_link');
  for (const link of links) if (!(await validStudyFinding(c.env, project.id, link!.finding_uid))) return studyError(c, 'finding_not_in_project');
  const uid = newStudyUid();
  try {
    const r = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE research_studies SET version = version + 1, updated_at = datetime('now') WHERE project_id = ? AND version = ? AND EXISTS (SELECT 1 FROM research_projects p WHERE p.id = project_id AND p.owner_user_id = ? AND p.status <> 'archived')`).bind(project.id, b.version, user.id),
      c.env.DB.prepare(`INSERT INTO research_study_decisions (uid, project_id, outcome, rationale, reversing_assumptions, created_by)
        SELECT ?, project_id, ?, ?, ?, ? FROM research_studies WHERE project_id = ? AND changes() > 0`)
        .bind(uid, b.outcome, rationale.value, assumptions.value, user.id, project.id),
      ...links.map((link) => insertStudyLink(c.env, project.id, 'decision', uid, link!)),
    ]);
    if (!r[0].meta.changes) return studyError(c, 'study_changed', 409);
  } catch (e) { return studyWriteError(c, e); }
  await logAdminAction(c.env, user.id, user.email, 'research_study_decision_recorded', { project_uid: project.uid, decision_uid: uid, link_count: links.length });
  return c.json(await response(c.env, project.id), 201);
});
export const mount: RouteMount = { path: '/api/research/projects', router: decisions };
export default decisions;
