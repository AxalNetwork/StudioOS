/** D7818 (#7818): owner-only, revision-checked subject notes beside #5157's Research Project subjects. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { checkProjectOwner } from './research_projects';
import type { RouteMount } from '../util/routeRegistry';
const router = new Hono<{ Bindings: Env }>();
export const SUBJECT_NOTE_STATUSES = [
  'considering',
  'shortlisted',
  'set_aside',
] as const;
export const SUBJECT_NOTE_LIMITS = {
  rationale: 4000,
  private_note: 10000,
  next_action: 1000,
} as const;
router.get('/:uid/subject-notes', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'project_not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT s.kind,s.directory_uid,n.rationale,n.private_note,n.status,n.next_action,n.due_day,n.revision,n.updated_at FROM research_project_subject_notes n JOIN research_project_subjects s ON s.id=n.subject_id WHERE s.project_id=? AND s.owner_user_id=? ORDER BY s.id`,
  )
    .bind(project.id, user.id)
    .all<any>();
  const notes: Record<string, Record<string, unknown>> = {
    company: Object.create(null),
    fund: Object.create(null),
  };
  for (const { kind, directory_uid, ...note } of rows.results || [])
    notes[kind][directory_uid] = note;
  return c.json({
    notes,
    statuses: SUBJECT_NOTE_STATUSES,
    limits: SUBJECT_NOTE_LIMITS,
  });
});
router.put('/:uid/subject-notes/:kind/:directoryUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'project_not_found' }, 404);
  if (user.support_session)
    return c.json({ detail: 'support_session_read_only' }, 403);
  if (project.archived_at || project.status === 'archived')
    return c.json({ detail: 'project_archived' }, 409);
  const kind = c.req.param('kind'),
    directoryUid = c.req.param('directoryUid');
  if (
    !['company', 'fund'].includes(kind) ||
    !directoryUid ||
    directoryUid.length > 64
  )
    return c.json({ detail: 'invalid_subject' }, 400);
  const subject = await c.env.DB.prepare(
    `SELECT s.id,n.rationale,n.private_note,n.status,n.next_action,n.due_day,n.revision FROM research_project_subjects s LEFT JOIN research_project_subject_notes n ON n.subject_id=s.id WHERE s.project_id=? AND s.owner_user_id=? AND s.kind=? AND s.directory_uid=?`,
  )
    .bind(project.id, user.id, kind, directoryUid)
    .first<any>();
  if (!subject) return c.json({ detail: 'subject_not_found' }, 404);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: 'invalid_json' }, 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !Number.isSafeInteger(body.expected_revision) ||
    body.expected_revision < 0
  )
    return c.json({ detail: 'expected_revision_required' }, 400);
  const value: any = {};
  for (const [field, limit] of Object.entries(SUBJECT_NOTE_LIMITS)) {
    const raw = body[field] === undefined ? subject[field] : body[field];
    if (
      raw != null &&
      (typeof raw !== 'string' || Array.from(raw).length > limit)
    )
      return c.json({ detail: `invalid_${field}` }, 400);
    value[field] = typeof raw === 'string' ? raw.trim() || null : null;
  }
  value.status =
    body.status === undefined ? subject.status || 'considering' : body.status;
  if (!SUBJECT_NOTE_STATUSES.includes(value.status))
    return c.json({ detail: 'invalid_status' }, 400);
  value.due_day = body.due_day === undefined ? subject.due_day : body.due_day;
  if (
    value.due_day != null &&
    (typeof value.due_day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.due_day) ||
      !Number.isFinite(Date.parse(`${value.due_day}T00:00:00Z`)) ||
      new Date(`${value.due_day}T00:00:00Z`).toISOString().slice(0, 10) !==
        value.due_day)
  )
    return c.json({ detail: 'invalid_due_day' }, 400);
  const expected = body.expected_revision;
  // The revision and owner/archive predicates are checked again by the write. D1 batch rolls back the receipt and note together.
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO research_project_subject_notes(subject_id,rationale,private_note,status,next_action,due_day)
   SELECT s.id,?,?,?,?,? FROM research_project_subjects s JOIN research_projects p ON p.id=s.project_id
   WHERE s.id=? AND p.uid=? AND p.owner_user_id=? AND s.owner_user_id=? AND p.archived_at IS NULL AND p.status!='archived'
   AND (?=0 OR EXISTS(SELECT 1 FROM research_project_subject_notes n WHERE n.subject_id=s.id))
   ON CONFLICT(subject_id) DO UPDATE SET rationale=excluded.rationale,private_note=excluded.private_note,status=excluded.status,next_action=excluded.next_action,due_day=excluded.due_day,revision=research_project_subject_notes.revision+1,updated_at=datetime('now')
   WHERE research_project_subject_notes.revision=?`,
    ).bind(
      value.rationale,
      value.private_note,
      value.status,
      value.next_action,
      value.due_day ?? null,
      subject.id,
      project.uid,
      user.id,
      user.id,
      expected,
      expected,
    ),
    c.env.DB.prepare(
      `INSERT INTO activity_logs(user_id,action,entity_type,entity_id,metadata)
   SELECT ?,'research_project_subject_notes_saved','research_project',?,? WHERE changes()=1`,
    ).bind(
      user.id,
      project.uid,
      JSON.stringify({
        project_uid: project.uid,
        kind,
        directory_uid: directoryUid,
        revision: expected + 1,
      }),
    ),
  ]);
  if (!result[0].meta?.changes)
    return c.json({ detail: 'subject_notes_conflict' }, 409);
  return c.json({ item: { ...value, revision: expected + 1 } });
});
export const mount: RouteMount = {
  path: '/api/research/projects',
  router: router,
};
export default router;
