/**
 * D5157 (#5157) — the Research Project: create, read, list, update, archive and
 * restore a project, and attach or detach its evidence (Library documents and
 * collections) and its Ask sessions and answers. Mounted at
 * `/api/research/projects` (migration 202611092035_research_projects.sql).
 *
 * OWNER-SCOPED, LIKE EVERY RESEARCH STORE. Every read and write is
 * `WHERE owner_user_id = ?`, and a link may only name the caller's own
 * document, collection, session or answer: another owner's row is a 404, the
 * same answer as a row that does not exist.
 *
 * EVIDENCE IS READ, NOT COPIED. A project's evidence is the documents linked
 * to it directly plus the documents in its linked collections, each listed
 * once with where it came from. Index state and "in Ask" are the Library's
 * own facts (D4605), stated here so the workspace never derives its own.
 *
 * COUNTS ARE COUNTS OF LINKS, so zero is a recorded zero: a project with no
 * linked document has no evidence. "Passages used" is counted from the
 * citations of the project's Ask answers; a citation stored before
 * `document_uid` was recorded is counted as unattributed rather than dropped.
 *
 * AN ARCHIVED PROJECT IS READ-ONLY until it is restored (409
 * `project_archived`), so the archive step's review stays true.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import type { RouteMount } from '../util/routeRegistry';

const projects = new Hono<{ Bindings: Env }>();

interface ProjectRow {
  id: number; uid: string; title: string; question: string;
  objective: string | null; scope: string | null; exclusions: string | null;
  status: string; archived_at: string | null; created_at: string; updated_at: string;
}
interface EvidenceRow {
  uid: string; title: string; kind: string; content_type: string | null; source_year: number | null;
  index_state: string; index_note: string | null; chunk_count: number | null; created_at: string;
  direct: number; collections: string | null;
}

/** The limits the migration's CHECKs hold. */
export const LIMITS = { title: 160, question: 1000, objective: 2000, scope: 1000, exclusions: 1000 } as const;
const TEXT_FIELDS = ['title', 'question', 'objective', 'scope', 'exclusions'] as const;
const OPTIONAL = new Set(['objective', 'scope', 'exclusions']);
/** D4605: the index states Ask may answer from. */
const ANSWERABLE_STATES = ['indexed', 'partial'];
const LIST_SCOPES = new Set(['active', 'archived', 'all']);

const newUid = () => crypto.randomUUID().replace(/-/g, '');
/** The caller's own project by uid, or null: another owner's reads as none. */
export async function checkProjectOwner(env: Env, uid: string, userId: number) {
  return env.DB.prepare(
    `SELECT id, uid, title, question, objective, scope, exclusions, status, archived_at, created_at, updated_at
       FROM research_projects WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, userId).first<ProjectRow>();
}

const projectDto = (r: ProjectRow) => ({
  uid: r.uid, title: r.title, question: r.question,
  objective: r.objective, scope: r.scope, exclusions: r.exclusions,
  status: r.status, archived_at: r.archived_at, created_at: r.created_at, updated_at: r.updated_at,
});

/**
 * One text field from a request body. `undefined` means "not sent"; `null`
 * clears an optional field; a string is trimmed and must fit its limit.
 * Returns `{ error }` for anything else.
 */
export function readField(name: typeof TEXT_FIELDS[number], value: unknown): { value?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null || (typeof value === 'string' && !value.trim())) {
    return OPTIONAL.has(name) ? { value: null } : { error: `${name}_required` };
  }
  if (typeof value !== 'string') return { error: `invalid_${name}` };
  const text = value.trim();
  if (text.length > LIMITS[name]) return { error: `${name}_too_long` };
  return { value: text };
}

const touch = (env: Env, id: number) =>
  env.DB.prepare("UPDATE research_projects SET updated_at = datetime('now') WHERE id = ?").bind(id).run();

// ---------------------------------------------------------------------------
// The list (My Research)
// ---------------------------------------------------------------------------

projects.get('/', async (c) => {
  const user = await requireAuth(c);
  const scope = c.req.query('status') || 'active';
  if (!LIST_SCOPES.has(scope)) return c.json({ detail: 'invalid_status' }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.uid, p.title, p.question, p.objective, p.scope, p.exclusions, p.status, p.archived_at, p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM research_project_sessions s WHERE s.project_id = p.id) AS sessions,
            (SELECT COUNT(*) FROM research_project_answers a WHERE a.project_id = p.id) AS answers,
            (SELECT COUNT(*) FROM research_project_collections pc WHERE pc.project_id = p.id) AS collections
       FROM research_projects p
      WHERE p.owner_user_id = ?
        AND (? = 'all' OR (? = 'archived' AND p.status = 'archived') OR (? = 'active' AND p.status <> 'archived'))
      ORDER BY p.updated_at DESC, p.id DESC LIMIT 200`
  ).bind(user.id, scope, scope, scope).all<ProjectRow & { sessions: number; answers: number; collections: number }>();
  // Distinct evidence per project, a document in two routes counted once.
  const evidence = await c.env.DB.prepare(
    `SELECT e.project_id, COUNT(DISTINCT d.id) AS total,
            COUNT(DISTINCT CASE WHEN d.index_state IN ('indexed', 'partial') THEN d.id END) AS answerable
       FROM (SELECT pd.project_id, pd.document_id FROM research_project_documents pd
             UNION
             SELECT pc.project_id, cd.document_id FROM research_project_collections pc
               JOIN research_collection_documents cd ON cd.collection_id = pc.collection_id) e
       JOIN research_projects p ON p.id = e.project_id
       JOIN research_documents d ON d.id = e.document_id
      WHERE p.owner_user_id = ? AND d.owner_user_id = ?
      GROUP BY e.project_id`
  ).bind(user.id, user.id).all<{ project_id: number; total: number; answerable: number }>();
  const byProject = new Map((evidence.results || []).map((r) => [r.project_id, r]));
  // Archived projects are counted even when not listed, so the page can say
  // "N archived" rather than imply there are none.
  const archived = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM research_projects WHERE owner_user_id = ? AND status = 'archived'"
  ).bind(user.id).first<{ n: number }>();
  return c.json({
    status: scope,
    archived_count: Number(archived?.n || 0),
    items: (rows.results || []).map((r) => ({
      ...projectDto(r),
      counts: {
        evidence: Number(byProject.get(r.id)?.total || 0),
        answerable: Number(byProject.get(r.id)?.answerable || 0),
        collections: Number(r.collections || 0),
        sessions: Number(r.sessions || 0),
        answers: Number(r.answers || 0),
      },
    })),
  });
});

projects.post('/', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  const question = readField('question', body.question);
  if (question.error || question.value == null) return c.json({ detail: question.error || 'question_required' }, 400);
  // The title defaults to the question, cut at a word inside the limit.
  const titleIn = body.title === undefined || body.title === null || body.title === '' ? undefined : body.title;
  const title = titleIn === undefined ? { value: defaultTitle(question.value) } : readField('title', titleIn);
  if (title.error) return c.json({ detail: title.error }, 400);
  const fields: Record<string, string | null> = {};
  for (const name of ['objective', 'scope', 'exclusions'] as const) {
    const f = readField(name, body[name]);
    if (f.error) return c.json({ detail: f.error }, 400);
    fields[name] = f.value ?? null;
  }
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_projects (uid, owner_user_id, title, question, objective, scope, exclusions, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uid, user.id, title.value, question.value, fields.objective, fields.scope, fields.exclusions, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_project_created', { project_uid: uid });
  const row = await checkProjectOwner(c.env, uid, user.id);
  return c.json({ item: row ? projectDto(row) : { uid } }, 201);
});

/** The question as a title: whole words, at most the title limit. */
export function defaultTitle(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ');
  if (text.length <= LIMITS.title) return text;
  const cut = text.slice(0, LIMITS.title - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// One project (the workspace)
// ---------------------------------------------------------------------------

projects.get('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  const evidence = await c.env.DB.prepare(
    `SELECT d.uid, d.title, d.kind, d.content_type, d.source_year, d.index_state, d.index_note, d.chunk_count, d.created_at,
            MAX(CASE WHEN e.via_collection IS NULL THEN 1 ELSE 0 END) AS direct,
            GROUP_CONCAT(e.via_collection, char(31)) AS collections
       FROM (SELECT pd.document_id, NULL AS via_collection FROM research_project_documents pd WHERE pd.project_id = ?
             UNION ALL
             SELECT cd.document_id, col.name FROM research_project_collections pc
               JOIN research_collections col ON col.id = pc.collection_id AND col.owner_user_id = ?
               JOIN research_collection_documents cd ON cd.collection_id = pc.collection_id
              WHERE pc.project_id = ?) e
       JOIN research_documents d ON d.id = e.document_id AND d.owner_user_id = ?
      GROUP BY d.id
      ORDER BY d.created_at DESC, d.id DESC`
  ).bind(row.id, user.id, row.id, user.id).all<EvidenceRow>();
  const collections = await c.env.DB.prepare(
    `SELECT col.uid, col.name,
            (SELECT COUNT(*) FROM research_collection_documents cd WHERE cd.collection_id = col.id) AS documents
       FROM research_project_collections pc
       JOIN research_collections col ON col.id = pc.collection_id
      WHERE pc.project_id = ? AND col.owner_user_id = ?
      ORDER BY col.name`
  ).bind(row.id, user.id).all<{ uid: string; name: string; documents: number }>();
  const sessions = await c.env.DB.prepare(
    `SELECT s.uid, s.last_asked_at, s.created_at,
            (SELECT COUNT(*) FROM research_ask_answers a WHERE a.session_id = s.id) AS answers
       FROM research_project_sessions ps
       JOIN research_ask_sessions s ON s.id = ps.session_id
      WHERE ps.project_id = ? AND s.owner_user_id = ?
      ORDER BY s.id DESC`
  ).bind(row.id, user.id).all<{ uid: string; last_asked_at: string | null; created_at: string; answers: number }>();
  // The project's answers: those linked one by one, and every answer in a
  // linked session. Their citations give "passages used".
  const answers = await c.env.DB.prepare(
    `SELECT a.uid, a.question, a.reason, a.saved, a.citations, a.created_at,
            EXISTS (SELECT 1 FROM research_project_answers pa WHERE pa.project_id = ? AND pa.answer_id = a.id) AS linked
       FROM research_ask_answers a
      WHERE a.owner_user_id = ?
        AND (a.id IN (SELECT answer_id FROM research_project_answers WHERE project_id = ?)
             OR a.session_id IN (SELECT session_id FROM research_project_sessions WHERE project_id = ?))
      ORDER BY a.id DESC LIMIT 500`
  ).bind(row.id, user.id, row.id, row.id).all<{ uid: string; question: string; reason: string; saved: number; citations: string; created_at: string; linked: number }>();
  const { used, unattributed } = passagesUsed((answers.results || []).map((a) => a.citations));
  return c.json({
    item: projectDto(row),
    evidence: (evidence.results || []).map((d) => ({
      uid: d.uid, title: d.title, kind: d.kind, content_type: d.content_type, source_year: d.source_year ?? null,
      index_state: d.index_state, index_note: d.index_note, chunk_count: d.chunk_count, created_at: d.created_at,
      source: 'own', in_ask: ANSWERABLE_STATES.includes(d.index_state),
      direct: Boolean(d.direct),
      via_collections: d.collections ? [...new Set(d.collections.split('\u001f'))].sort() : [],
      passages_used: used.get(d.uid) || 0,
    })),
    passages_unattributed: unattributed,
    collections: (collections.results || []).map((r) => ({ uid: r.uid, name: r.name, documents: Number(r.documents || 0) })),
    sessions: (sessions.results || []).map((r) => ({ uid: r.uid, last_asked_at: r.last_asked_at, created_at: r.created_at, answers: Number(r.answers || 0) })),
    answers: (answers.results || []).map((a) => ({
      uid: a.uid, question: a.question, reason: a.reason, saved: Boolean(a.saved), created_at: a.created_at, linked: Boolean(a.linked),
    })),
  });
});

/** Citations per document uid, and those stored with no document uid. */
export function passagesUsed(citationJson: Array<string | null | undefined>) {
  const used = new Map<string, number>();
  let unattributed = 0;
  for (const raw of citationJson) {
    let list: unknown;
    try { list = JSON.parse(raw || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) continue;
    for (const cite of list) {
      const uid = cite && typeof cite === 'object' ? (cite as { document_uid?: unknown }).document_uid : null;
      if (typeof uid === 'string' && uid) used.set(uid, (used.get(uid) || 0) + 1);
      else unattributed += 1;
    }
  }
  return { used, unattributed };
}

projects.patch('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  if (row.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  // Every field is written: the sent value, or the row's own. One fixed
  // statement, so no request text reaches the query.
  const next: Record<string, string | null> = {
    title: row.title, question: row.question, objective: row.objective, scope: row.scope, exclusions: row.exclusions,
  };
  const changed: string[] = [];
  for (const name of TEXT_FIELDS) {
    const f = readField(name, body[name]);
    if (f.error) return c.json({ detail: f.error }, 400);
    if (f.value !== undefined) { next[name] = f.value; changed.push(name); }
  }
  let status = row.status;
  if (body.status !== undefined) {
    // Archive has its own route, with its own review step.
    if (body.status !== 'in_progress' && body.status !== 'complete') return c.json({ detail: 'invalid_status' }, 400);
    status = body.status;
    changed.push('status');
  }
  if (!changed.length) return c.json({ detail: 'nothing_to_update' }, 400);
  await c.env.DB.prepare(
    `UPDATE research_projects
        SET title = ?, question = ?, objective = ?, scope = ?, exclusions = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND owner_user_id = ?`
  ).bind(next.title, next.question, next.objective, next.scope, next.exclusions, status, row.id, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_project_updated', { project_uid: row.uid, fields: changed });
  const saved = await checkProjectOwner(c.env, row.uid, user.id);
  return c.json({ item: saved ? projectDto(saved) : null });
});

projects.post('/:uid/archive', async (c) => {
  const user = await requireAuth(c);
  const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  if (row.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  await c.env.DB.prepare(
    "UPDATE research_projects SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).bind(row.id, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_project_archived', { project_uid: row.uid });
  const next = await checkProjectOwner(c.env, row.uid, user.id);
  return c.json({ item: next ? projectDto(next) : null });
});

projects.post('/:uid/restore', async (c) => {
  const user = await requireAuth(c);
  const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  if (row.status !== 'archived') return c.json({ detail: 'project_not_archived' }, 409);
  await c.env.DB.prepare(
    "UPDATE research_projects SET status = 'in_progress', archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).bind(row.id, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_project_restored', { project_uid: row.uid });
  const next = await checkProjectOwner(c.env, row.uid, user.id);
  return c.json({ item: next ? projectDto(next) : null });
});

// ---------------------------------------------------------------------------
// Links: documents, collections, Ask sessions and answers
// ---------------------------------------------------------------------------

/**
 * One link kind: the body field naming the row, and the three fixed
 * statements that check the row is the caller's, link it and unlink it.
 */
const LINKS = {
  documents: {
    field: 'document_uid', audit: 'document',
    owned: 'SELECT id FROM research_documents WHERE uid = ? AND owner_user_id = ?',
    insert: 'INSERT OR IGNORE INTO research_project_documents (project_id, document_id, created_by) VALUES (?, ?, ?)',
    remove: 'DELETE FROM research_project_documents WHERE project_id = ? AND document_id IN (SELECT id FROM research_documents WHERE uid = ? AND owner_user_id = ?)',
  },
  collections: {
    field: 'collection_uid', audit: 'collection',
    owned: 'SELECT id FROM research_collections WHERE uid = ? AND owner_user_id = ?',
    insert: 'INSERT OR IGNORE INTO research_project_collections (project_id, collection_id, created_by) VALUES (?, ?, ?)',
    remove: 'DELETE FROM research_project_collections WHERE project_id = ? AND collection_id IN (SELECT id FROM research_collections WHERE uid = ? AND owner_user_id = ?)',
  },
  sessions: {
    field: 'session_uid', audit: 'session',
    owned: 'SELECT id FROM research_ask_sessions WHERE uid = ? AND owner_user_id = ?',
    insert: 'INSERT OR IGNORE INTO research_project_sessions (project_id, session_id, created_by) VALUES (?, ?, ?)',
    remove: 'DELETE FROM research_project_sessions WHERE project_id = ? AND session_id IN (SELECT id FROM research_ask_sessions WHERE uid = ? AND owner_user_id = ?)',
  },
  answers: {
    field: 'answer_uid', audit: 'answer',
    owned: 'SELECT id FROM research_ask_answers WHERE uid = ? AND owner_user_id = ?',
    insert: 'INSERT OR IGNORE INTO research_project_answers (project_id, answer_id, created_by) VALUES (?, ?, ?)',
    remove: 'DELETE FROM research_project_answers WHERE project_id = ? AND answer_id IN (SELECT id FROM research_ask_answers WHERE uid = ? AND owner_user_id = ?)',
  },
} as const;

for (const [path, spec] of Object.entries(LINKS)) {
  projects.post(`/:uid/${path}`, async (c) => {
    const user = await requireAuth(c);
    const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
    if (!row) return c.json({ detail: 'not_found' }, 404);
    if (row.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
    const body = await c.req.json().catch(() => null);
    const target = body?.[spec.field];
    if (typeof target !== 'string' || !target) return c.json({ detail: `${spec.field}_required` }, 400);
    const owned = await c.env.DB.prepare(spec.owned).bind(target, user.id).first<{ id: number }>();
    if (!owned) return c.json({ detail: 'not_found' }, 404);
    const result = await c.env.DB.prepare(spec.insert).bind(row.id, owned.id, user.id).run();
    const added = Boolean(result.meta?.changes);
    if (added) {
      await touch(c.env, row.id);
      await logAdminAction(c.env, user.id, user.email, `research_project_${spec.audit}_added`, { project_uid: row.uid, [spec.field]: target });
    }
    return c.json({ ok: true, added });
  });

  projects.delete(`/:uid/${path}/:targetUid`, async (c) => {
    const user = await requireAuth(c);
    const row = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
    if (!row) return c.json({ detail: 'not_found' }, 404);
    if (row.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
    const target = c.req.param('targetUid');
    const result = await c.env.DB.prepare(spec.remove).bind(row.id, target, user.id).run();
    if (!result.meta?.changes) return c.json({ detail: 'not_found' }, 404);
    await touch(c.env, row.id);
    await logAdminAction(c.env, user.id, user.email, `research_project_${spec.audit}_removed`, { project_uid: row.uid, [spec.field]: target });
    return c.json({ ok: true });
  });
}

export const mount: RouteMount = { path: '/api/research/projects', router: projects };
export default projects;
