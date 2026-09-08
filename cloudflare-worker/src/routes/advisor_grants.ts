/**
 * `/api/advisor-grants/*` — a founder opens their record to a named advisor.
 *
 * TASK #55, and the thing it unblocks is `/research/client-prep`. That zone has
 * always held half a client brief — the topic and the questions the client
 * wrote when they asked for the session — and has always said the other half
 * was closed by rule rather than absent. This is the rule changing, under the
 * founder's own hand.
 *
 * THE GATE IS TWO PARTS, AND NEITHER IS SUFFICIENT. `routes/advisors.ts:1410`
 * makes the argument for cohort assignments and it holds here exactly:
 *
 *   · The GRANT is the founder's decision, and it is revocable and expiring.
 *   · The ROLE is the eligibility that grant presumes, and it must be
 *     re-checked ON EVERY READ. Without it, an advisor who is later demoted
 *     keeps an active row and keeps reading a founder's record indefinitely.
 *
 * SCOPE IS CHECKED PER FIELD, NOT PER REQUEST. A grant with only
 * `scope_project` must not leak a data-room file or a session, so the reader
 * below assembles the payload scope by scope and states which scopes it did
 * NOT read. The brief says what it is missing rather than looking complete.
 *
 * WHAT THIS FILE DOES NOT DO. It never widens a search namespace. A shared
 * document is resolved by id through `advisor_client_document_shares`;
 * DECISIONS D37 records what happens otherwise — adding `research_doc` to
 * `ALL_ENTITY_TYPES` would publish every user's private documents to every
 * other user's global search box, "in one line that looks exactly like
 * following the existing pattern".
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { companyScope } from '../services/tenancyScope';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
import { hasActivePairwiseNda } from '../services/trust';

const grants = new Hono<{ Bindings: Env }>();

const nowIso = () => new Date().toISOString();
const newUid = () => crypto.randomUUID().replace(/-/g, '');

/** An advisor by role, right now — not "was an advisor when the grant was made". */
const isAdvisorNow = (u: any) => u?.role === 'advisor';

interface GrantRow {
  id: number; uid: string; project_id: number; advisor_user_id: number;
  granted_by_user_id: number; status: string; expires_at: string | null;
  scope_project: number; scope_data_room: number; scope_sessions: number;
  created_at: string; updated_at: string;
}

/** The founder's own project, narrowed to the company they are acting as. */
async function ownedProject(c: any, user: any, projectUid: string) {
  const companyId = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  const scope = companyScope(user, companyId, 'p');
  return c.env.DB.prepare(
    // `founder_id` is selected because the document-share writer resolves
    // ownership the way the BRIEF's join does — through `users.founder_id`,
    // not `owner_user_id = user.id`. Without it that check compared against
    // undefined and refused every document.
    `SELECT p.id, p.uid, p.name, p.sector, p.stage, p.founder_id FROM projects p WHERE p.uid = ? AND ${scope.sql}`,
  ).bind(projectUid, ...scope.binds).first();
}

/** The live grant for this advisor on this project, or null. Both parts. */
async function activeGrant(env: Env, projectId: number, advisorUserId: number) {
  return env.DB.prepare(
    `SELECT * FROM advisor_client_grants
      WHERE project_id = ? AND advisor_user_id = ? AND status = 'active'
        AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  ).bind(projectId, advisorUserId).first<GrantRow>();
}

const grantDto = (g: GrantRow, extra: Record<string, unknown> = {}) => ({
  uid: g.uid,
  status: g.status,
  expires_at: g.expires_at,
  // The three scopes, always all three, so a reader of this payload can see
  // what was NOT granted as easily as what was.
  scope_project: !!g.scope_project,
  scope_data_room: !!g.scope_data_room,
  scope_sessions: !!g.scope_sessions,
  created_at: g.created_at,
  ...extra,
});

// ---------------------------------------------------------------------------
// Founder side — grant, amend, revoke
// ---------------------------------------------------------------------------

grants.get('/:projectUid', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT g.*, u.email AS advisor_email, u.name AS advisor_name, u.role AS advisor_role
       FROM advisor_client_grants g
       JOIN users u ON u.id = g.advisor_user_id
      WHERE g.project_id = ? ORDER BY g.created_at DESC`,
  ).bind(project.id).all<any>();
  return c.json({
    items: (rows.results || []).map((r: any) => grantDto(r, {
      advisor_email: r.advisor_email,
      advisor_name: r.advisor_name,
      // The second half of the gate, surfaced: a grant to someone who is no
      // longer an advisor is inert, and the founder should see that rather
      // than believe access they revoked is still in force — or that access
      // they left open still is.
      advisor_is_advisor: r.advisor_role === 'advisor',
    })),
    project: { uid: project.uid, name: project.name },
  });
});

grants.post('/:projectUid', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  const body = await c.req.json<any>().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return c.json({ detail: 'An email address is required' }, 400);

  const advisor = await c.env.DB.prepare(
    'SELECT id, role FROM users WHERE LOWER(email) = ?',
  ).bind(email).first<{ id: number; role: string }>();
  // Same shape as the data room: no invitation is sent, and the screen says so
  // rather than implying one was.
  if (!advisor) return c.json({ detail: 'No account with that address' }, 404);
  if (advisor.id === user.id) return c.json({ detail: 'You already own this record' }, 400);
  if (!isAdvisorNow(advisor)) {
    return c.json({
      detail: 'That account is not an advisor. This grant opens a client record to an '
        + 'advisor specifically; granting it to another licence would not give them access, '
        + 'because every read re-checks the role.',
    }, 400);
  }

  const scopes = {
    project: body.scope_project === false ? 0 : 1,
    data_room: body.scope_data_room ? 1 : 0,
    sessions: body.scope_sessions ? 1 : 0,
  };
  const uid = newUid();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO advisor_client_grants
       (uid, project_id, advisor_user_id, granted_by_user_id, status, expires_at,
        scope_project, scope_data_room, scope_sessions, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, advisor_user_id) DO UPDATE SET
       status = 'active',
       granted_by_user_id = excluded.granted_by_user_id,
       expires_at = excluded.expires_at,
       scope_project = excluded.scope_project,
       scope_data_room = excluded.scope_data_room,
       scope_sessions = excluded.scope_sessions,
       updated_at = excluded.updated_at`,
  ).bind(
    uid, project.id, advisor.id, user.id, body.expires_at || null,
    scopes.project, scopes.data_room, scopes.sessions, now, now,
  ).run();

  const row = await c.env.DB.prepare(
    'SELECT * FROM advisor_client_grants WHERE project_id = ? AND advisor_user_id = ?',
  ).bind(project.id, advisor.id).first<GrantRow>();
  return c.json(grantDto(row as GrantRow), 201);
});

grants.delete('/:projectUid/:grantUid', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  // A STATE, NEVER A DELETE. The access log points at rows whose grant would
  // be gone, and the founder still needs to read what that advisor opened.
  const res = await c.env.DB.prepare(
    `UPDATE advisor_client_grants SET status = 'revoked', updated_at = ?
      WHERE uid = ? AND project_id = ?`,
  ).bind(nowIso(), c.req.param('grantUid'), project.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Documents the founder pushes to one advisor — task #104
// ---------------------------------------------------------------------------

/**
 * `advisor_client_document_shares` HAD A READER AND NO WRITER.
 *
 * Migration 218 shipped the table, the brief above resolves a shared document
 * through it, and `routes/research.ts` and DECISIONS D50 both say in prose that
 * nothing could write a row: "a founder still cannot push a document to an
 * advisor". `LibraryZone` renders that sentence to the user. These three
 * handlers are what makes it false.
 *
 * TASK #104 CALLED THIS "migration 218's grant table". It is not the grant
 * table: `advisor_client_grants` has had a complete writer since #82 — the
 * `INSERT … ON CONFLICT DO UPDATE` above and the revoke beside it, driven by
 * `AdvisorGrantSection`. 218 ships THREE tables, and the share table is the one
 * with the gap.
 *
 * FOUR CONDITIONS, AND THE READER DICTATES THREE OF THEM. The brief's join is
 * `s.advisor_user_id = ? AND s.status = 'active' AND d.owner_user_id IN
 * (SELECT id FROM users WHERE founder_id = ?)`, so a row that does not satisfy
 * it is a row that can never be read — worse than useless, because the founder
 * would see it listed as shared. So a share requires: the caller owns the
 * project, the document belongs to the caller, the advisor holds a live grant
 * on that project, and the advisor is an advisor NOW. The grant requirement is
 * the one the reader does not enforce and this must: the brief is the only
 * surface that reads these rows, so a share without a grant is invisible to
 * everyone.
 *
 * NO SEARCH NAMESPACE IS WIDENED, and this is where that temptation lives. Per
 * D37, adding `research_doc` to `ALL_ENTITY_TYPES` would publish every user's
 * private documents to every other user's global search box "in one line that
 * looks exactly like following the existing pattern".
 * `advisor_client_grants.test.ts` fails the build if this file so much as
 * mentions `searchSemantic`.
 */
grants.get('/:projectUid/documents', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT s.uid, s.status, s.created_at, d.uid AS document_uid, d.title, d.kind,
            u.email AS advisor_email, u.name AS advisor_name, u.role AS advisor_role
       FROM advisor_client_document_shares s
       JOIN research_documents d ON d.id = s.document_id
       JOIN users u ON u.id = s.advisor_user_id
      WHERE s.shared_by_user_id IN (SELECT id FROM users WHERE founder_id = ?)
        AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 200`,
  ).bind(project.founder_id).all<any>();
  return c.json({
    items: (rows.results || []).map((r: any) => ({
      uid: r.uid, document_uid: r.document_uid, title: r.title, kind: r.kind,
      created_at: r.created_at,
      advisor_email: r.advisor_email, advisor_name: r.advisor_name,
      // Same surfacing the grant list does: a share to someone who is no longer
      // an advisor is inert, and the founder should see that rather than
      // believe a document is being read.
      advisor_is_advisor: r.advisor_role === 'advisor',
    })),
  });
});

grants.post('/:projectUid/documents', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  const body = await c.req.json<any>().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const documentUid = String(body.document_uid || '').trim();
  if (!email) return c.json({ detail: 'An email address is required' }, 400);
  if (!documentUid) return c.json({ detail: 'A document is required' }, 400);

  const advisor = await c.env.DB.prepare(
    'SELECT id, role FROM users WHERE LOWER(email) = ?',
  ).bind(email).first<{ id: number; role: string }>();
  if (!advisor) return c.json({ detail: 'No account with that address' }, 404);
  if (!isAdvisorNow(advisor)) {
    return c.json({
      detail: 'That account is not an advisor. Every read of a shared document '
        + 're-checks the role, so this share would never resolve.',
    }, 400);
  }

  // The grant is the container; a document rides inside it. Without this the
  // row would be written and then be unreadable, because the brief — the only
  // reader — is reached through the grant.
  const grant = await activeGrant(c.env, project.id, advisor.id);
  if (!grant) {
    return c.json({
      detail: 'That advisor holds no live grant on this record. Grant access first; '
        + 'a shared document is only ever read inside the client brief.',
    }, 400);
  }

  // OWNERSHIP IS RESOLVED THE WAY THE READER RESOLVES IT — through
  // `users.founder_id`, not through `owner_user_id = user.id`. A founder record
  // can be held by more than one account, and the brief's join would show a
  // document this check had refused, or refuse one it would show.
  const doc = await c.env.DB.prepare(
    `SELECT d.id FROM research_documents d
      WHERE d.uid = ?
        AND d.owner_user_id IN (SELECT id FROM users WHERE founder_id = ?)`,
  ).bind(documentUid, project.founder_id).first<{ id: number }>();
  if (!doc) return c.json({ detail: 'Document not found' }, 404);

  const uid = newUid();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO advisor_client_document_shares
       (uid, document_id, advisor_user_id, shared_by_user_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT (document_id, advisor_user_id) DO UPDATE SET
       status = 'active',
       shared_by_user_id = excluded.shared_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(uid, doc.id, advisor.id, user.id, now, now).run();

  const row = await c.env.DB.prepare(
    'SELECT uid, status, created_at FROM advisor_client_document_shares WHERE document_id = ? AND advisor_user_id = ?',
  ).bind(doc.id, advisor.id).first<any>();
  return c.json({ uid: row?.uid, document_uid: documentUid, status: row?.status, created_at: row?.created_at }, 201);
});

grants.delete('/:projectUid/documents/:shareUid', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  // A STATE, NEVER A DELETE — the same reasoning the grant revoke gives: the
  // access log points at what was read, and that record outlives the share.
  //
  // SCOPED TO THE FOUNDER RECORD, NOT THE ACCOUNT THAT SHARED. Found by
  // mutation: scoping to `shared_by_user_id = user.id` passed every test,
  // because the only caller who could reach it was already refused by
  // `ownedProject`. It was also wrong. A founder record can be held by more
  // than one account, the grant revoke beside this one is project-scoped, and
  // the brief resolves ownership through `users.founder_id` — so a co-founder
  // could see a share in the list and be unable to revoke it. One rule.
  const res = await c.env.DB.prepare(
    `UPDATE advisor_client_document_shares SET status = 'revoked', updated_at = ?
      WHERE uid = ? AND status = 'active'
        AND shared_by_user_id IN (SELECT id FROM users WHERE founder_id = ?)`,
  ).bind(nowIso(), c.req.param('shareUid'), project.founder_id).run();
  if (!res.meta?.changes) return c.json({ detail: 'Not found' }, 404);
  return c.json({ ok: true });
});

/**
 * The access log finally has a reader — the other half of task #104.
 *
 * Migration 218 built `advisor_client_access_log` as "the founder's own record
 * of an advisor's reading", and the brief has been writing `open_brief` rows
 * into it since #82. Nothing ever read them, so the record it was built to be
 * did not exist: the founder could grant access and had no way to see whether
 * it was used.
 */
grants.get('/:projectUid/access-log', async (c) => {
  const user = await requireAuth(c);
  const project = await ownedProject(c, user, c.req.param('projectUid'));
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT l.action, l.created_at, u.email AS advisor_email, u.name AS advisor_name,
            d.uid AS document_uid, d.title AS document_title
       FROM advisor_client_access_log l
       JOIN users u ON u.id = l.advisor_user_id
       LEFT JOIN research_documents d ON d.id = l.document_id
      WHERE l.project_id = ?
      ORDER BY l.created_at DESC LIMIT 200`,
  ).bind(project.id).all<any>();
  return c.json({ items: rows.results || [] });
});

// ---------------------------------------------------------------------------
// Advisor side — the inbox, and the brief
// ---------------------------------------------------------------------------

/**
 * Everything open to this advisor. The shape `GET /api/data-room/shared` set,
 * which is the product's entire "shared with me" mechanism.
 */
grants.get('/shared/list', async (c) => {
  const user = await requireAuth(c);
  if (!isAdvisorNow(user)) return c.json({ items: [], detail: 'Only an advisor holds client grants' });
  const rows = await c.env.DB.prepare(
    `SELECT g.uid AS grant_uid, g.created_at, g.expires_at,
            g.scope_project, g.scope_data_room, g.scope_sessions,
            p.uid AS project_uid, p.name AS project_name
       FROM advisor_client_grants g
       JOIN projects p ON p.id = g.project_id
      WHERE g.advisor_user_id = ? AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
      ORDER BY g.created_at DESC LIMIT 200`,
  ).bind(user.id).all<any>();
  return c.json({
    items: (rows.results || []).map((r: any) => ({
      grant_uid: r.grant_uid,
      project_uid: r.project_uid,
      project_name: r.project_name,
      scope_project: !!r.scope_project,
      scope_data_room: !!r.scope_data_room,
      scope_sessions: !!r.scope_sessions,
      expires_at: r.expires_at,
      created_at: r.created_at,
    })),
  });
});

/**
 * The brief for one client. TWO SIDES: the advisor's own record of what the
 * client asked for, and — under the grant, scope by scope — the client's own.
 *
 * The response names every scope it did NOT read. A brief that looked complete
 * while silently missing the half it was not granted would be the same failure
 * the zone's card has been warning about all along: half a brief presented as
 * a whole one.
 */
grants.get('/shared/:projectUid/brief', async (c) => {
  const user = await requireAuth(c);
  // PART TWO OF THE GATE, checked before anything is read.
  if (!isAdvisorNow(user)) return c.json({ detail: 'Only an advisor may open a client brief' }, 403);

  const project = await c.env.DB.prepare(
    'SELECT id, uid, name, sector, stage, founder_id FROM projects p WHERE p.uid = ? AND p.deleted_at IS NULL',
  ).bind(c.req.param('projectUid')).first<any>();
  // A missing project and a missing grant answer identically, so the endpoint
  // cannot be used to discover which projects exist.
  const grant = project ? await activeGrant(c.env, project.id, user.id) : null;
  if (!project || !grant) return c.json({ detail: 'No client record is open to you' }, 404);

  const withheld: string[] = [];

  // ── The client's own record ────────────────────────────────────────────
  const client = grant.scope_project
    ? { name: project.name, sector: project.sector, stage: project.stage }
    : null;
  if (!grant.scope_project) withheld.push('the client’s project record');

  // ── Data room, still behind the NDA where the founder put it ───────────
  let room: { open: number; withheld_behind_nda: number } | null = null;
  if (grant.scope_data_room) {
    const nda = await hasActivePairwiseNda(c.env, grant.granted_by_user_id, user.id);
    const counts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN visibility = 'open' THEN 1 ELSE 0 END) AS open_count
         FROM data_room_files WHERE project_id = ?`,
    ).bind(project.id).first<any>();
    const total = Number(counts?.total || 0);
    const open = Number(counts?.open_count || 0);
    // A count, never the names — the data room's own rule, and it does not
    // relax because the reader is an advisor rather than an investor.
    room = { open: nda ? total : open, withheld_behind_nda: nda ? 0 : total - open };
  } else {
    withheld.push('the client’s data room');
  }

  // ── Sessions with other advisors ───────────────────────────────────────
  let otherSessions: any[] = [];
  if (grant.scope_sessions) {
    const rows = await c.env.DB.prepare(
      `SELECT b.topic, b.status, b.created_at
         FROM advisor_bookings b
         JOIN users u ON u.id = b.founder_user_id
        WHERE u.founder_id = ? AND b.advisor_id IS NOT NULL
        ORDER BY b.created_at DESC LIMIT 20`,
    ).bind(project.founder_id).all<any>().catch(() => ({ results: [] as any[] }));
    otherSessions = (rows.results || []).map((r: any) => ({
      topic: r.topic, status: r.status, created_at: r.created_at,
      // Seam-marked, always. This is the client's relationship with someone
      // else, shown to this advisor because the founder ticked a box — not
      // because it is the practice's own record.
      source: 'client',
    }));
  } else {
    withheld.push('the client’s sessions with other advisors');
  }

  // ── Documents the founder pushed, by id and never by namespace ─────────
  const docs = await c.env.DB.prepare(
    `SELECT d.uid, d.title, d.kind, d.index_state, d.created_at
       FROM advisor_client_document_shares s
       JOIN research_documents d ON d.id = s.document_id
      WHERE s.advisor_user_id = ? AND s.status = 'active'
        AND d.owner_user_id IN (SELECT id FROM users WHERE founder_id = ?)
      ORDER BY d.created_at DESC LIMIT 100`,
  ).bind(user.id, project.founder_id).all<any>();

  await c.env.DB.prepare(
    `INSERT INTO advisor_client_access_log (project_id, advisor_user_id, action) VALUES (?, ?, 'open_brief')`,
  ).bind(project.id, user.id).run().catch(() => {});

  return c.json({
    project: { uid: project.uid, name: grant.scope_project ? project.name : null },
    client,
    room,
    other_sessions: otherSessions,
    shared_documents: (docs.results || []),
    scopes: {
      project: !!grant.scope_project,
      data_room: !!grant.scope_data_room,
      sessions: !!grant.scope_sessions,
    },
    // Said out loud, every time. The brief is only ever as wide as the grant,
    // and a reader must be able to see the edge of it.
    withheld,
    withheld_note: withheld.length
      ? `This brief does not include ${withheld.join(', ')}. The client chose what to open; what is missing here was not granted rather than not recorded.`
      : null,
  });
});

export default grants;
