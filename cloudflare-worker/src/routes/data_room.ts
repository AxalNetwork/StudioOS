/**
 * Data room — folders, files, per-investor grants, and an NDA gate.
 *
 * Mounted at /api/data-room. Schema: migration 184.
 *
 * FOUNDER SIDE (owner of the project)
 *   GET    /:projectUid                       folders + files (each with its download
 *                                             count) + grants + recent access + the
 *                                             last seven days counted by action
 *   POST   /:projectUid/folders               create
 *   PATCH  /:projectUid/folders/:uid          rename / re-file / change visibility;
 *                                             `apply_to_contents` carries a visibility
 *                                             change to every folder and file under it
 *   DELETE /:projectUid/folders/:uid          delete (files inside are orphaned, not lost)
 *   POST   /:projectUid/files                 upload (base64 data URI → R2)
 *   PATCH  /:projectUid/files/:uid            rename / move / change visibility
 *   DELETE /:projectUid/files/:uid            delete row + object
 *   POST   /:projectUid/grants                open the room to an investor, with an
 *                                             end date and the folders it opens
 *   PATCH  /:projectUid/grants/:uid           change a grant's end date or folders
 *   DELETE /:projectUid/grants/:uid           revoke
 *   POST   /:projectUid/files/:uid/download   the founder's own one-time link (D1103)
 *   GET    /:projectUid/files/:uid/versions   the file's versions, current first
 *   POST   /:projectUid/files/:uid/versions/:n/download   one earlier version
 *   POST   /:projectUid/files/:uid/versions/:n/current    make it current (a swap)
 *   GET    /:projectUid/preview?grant=<uid>   the room as that grant sees it; no log
 *
 * WHO ON THE FOUNDER SIDE (D1103, owner question 2, answer A). The owner — the
 * account that owns the venture, or an admin — does everything. A co-founder
 * (an accepted `project_members` row with role `cofounder`) reads the room,
 * uploads, moves and renames files and folders, matches a file to a request
 * or checklist item, opens any version and makes one current. Only the owner
 * shares, revokes, changes a grant, changes a gate (a file's or folder's
 * `visibility`, `access_tier`, `access_expires_at`) or deletes a file. A
 * co-founder's upload takes its folder's visibility and the default tier.
 * Anyone else gets 404, as before.
 *
 * INVESTOR SIDE (holder of a grant)
 *   GET    /shared                            rooms shared with me
 *   GET    /shared/:projectUid                the room as I may see it
 *   POST   /shared/:projectUid/files/:uid/download   one-time signed URL
 *
 * THE LOG (D374). `open_room`, `download`, and `blocked` — a download the NDA
 * gate refused. A refusal is evidence the founder needs ("who tried to open the
 * term sheet without signing"), so it is written like the other two. There is
 * no per-file VIEW: nothing here streams a file except as a download, so a
 * per-file count is a download count and the page labels it that way.
 *
 * THE GATE. A file is `open` or `nda`. `open` needs an active grant. `nda`
 * needs an active grant AND an active row in `pairwise_ndas` between the
 * founder who granted access and the investor — the same table `esign.ts`
 * already writes, rather than a second NDA notion invented for this surface.
 *
 * WHAT THIS DOES NOT DO, and why:
 *
 *   * No watermarking. The canvas asks for watermarked downloads; there is no
 *     PDF pipeline in the worker. A download is instead per-investor,
 *     single-use, short-TTL and logged, and the UI says exactly that rather
 *     than implying a watermark nothing applies.
 *   * No "preview" distinct from download. Streaming bytes to a browser IS
 *     giving someone the file; a preview that pretended otherwise would be
 *     security theatre.
 *   * Nothing is listed that the caller may not open. An `nda` file does not
 *     appear as a locked row to an investor without an NDA — a filename is
 *     itself information ("Series B term sheet — Acme.pdf").
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { companyScope } from '../services/tenancyScope';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
import { mintDownloadToken } from '../services/signedDownload';
import {
  tierAdmits, investorCommitted, admittedCounts, isAccessTier, expiryMs, grantFolderScope, folderInScope, type FolderScope,
} from '../services/dataRoomAccess';
import { CHECKLIST_KEYS } from '../services/raiseCycle';
import { logCycleWrite } from '../services/cycleActivity';
import { WriterError } from '../services/validateWriters';

const r = new Hono<{ Bindings: Env }>();

const VISIBILITY = new Set(['open', 'nda']);
const NAME_MAX = 200;
// A data room holds decks, models and signed PDFs. The cap is on the DECODED
// bytes: base64 inflates by 4/3, and the worker's request limit is the real
// ceiling above this.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ProjectRow = { id: number; uid: string; name: string };
type GrantRow = {
  id: number; uid: string; project_id: number;
  investor_user_id: number; granted_by_user_id: number;
  status: string; expires_at: string | null; created_at: string;
  folders_scoped?: number | null;
};

/** D1103 — who the caller is in this room. */
type RoomRole = 'owner' | 'cofounder';
type RoomAccess = { project: ProjectRow; role: RoomRole };

const OWNER_ONLY = { detail: 'Only the room’s owner can do this.', code: 'owner_only' } as const;
/** The fields that are a gate: only the owner sets them (D1103). */
const GATE_FIELDS = ['visibility', 'access_tier', 'access_expires_at', 'apply_to_contents'] as const;
const namesGate = (body: any) => GATE_FIELDS.some((k) => body?.[k] !== undefined);

/**
 * The caller's project, or null. Ownership goes through the tenancy module.
 *
 * `companyScope` wraps `projectOwnerScope` — ownership is still the outer
 * question — and narrows it to the company the switcher has selected. The id
 * comes from `resolveActiveCompany`, which checks the header against
 * `user_company_links`, so the raw client value never reaches the bind.
 */
async function ownedProject(
  env: Env, user: any, projectUid: string, companyId: number | null,
): Promise<ProjectRow | null> {
  const scope = companyScope(user, companyId, 'p');
  const row = await env.DB.prepare(
    `SELECT p.id, p.uid, p.name FROM projects p WHERE p.uid = ? AND ${scope.sql}`,
  ).bind(projectUid, ...scope.binds).first<ProjectRow>();
  return row || null;
}

/** The verified active company for this request, or null. */
function activeCompany(c: any, user: any): Promise<number | null> {
  return resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
}

/**
 * D1103 — the caller's room and their role in it: `owner` through the tenancy
 * scope above, else `cofounder` through an accepted `project_members` row of
 * that role. Null for anyone else, which every route answers as 404. A
 * membership store that cannot be read is no membership.
 */
async function roomProject(c: any, user: any, projectUid: string): Promise<RoomAccess | null> {
  const owned = await ownedProject(c.env, user, projectUid, await activeCompany(c, user));
  if (owned) return { project: owned, role: 'owner' };
  try {
    const row = await c.env.DB.prepare(
      `SELECT p.id, p.uid, p.name FROM projects p
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'accepted' AND pm.role = 'cofounder'
        WHERE p.uid = ? AND p.deleted_at IS NULL`,
    ).bind(user.id, projectUid).first() as ProjectRow | null;
    return row ? { project: row, role: 'cofounder' } : null;
  } catch {
    return null;
  }
}

/** An active, unexpired grant for this investor on this project, or null. */
export async function activeGrant(env: Env, projectId: number, userId: number): Promise<GrantRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM data_room_grants
      WHERE project_id = ? AND investor_user_id = ? AND status = 'active'
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
  ).bind(projectId, userId).first<GrantRow>();
  return row || null;
}

/**
 * Whether the NDA between the granting founder and this investor is live.
 *
 * Migration 025 fixes party_a as the founder and party_b as the investor, and
 * the seeder enforces it so the UNIQUE constraint works — so this is a direct
 * two-column lookup rather than an OR over both orderings. Checking both ways
 * round would quietly accept a row the rest of the system considers malformed.
 */
export async function ndaActive(env: Env, founderUserId: number, investorUserId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM pairwise_ndas
      WHERE party_a_user_id = ? AND party_b_user_id = ? AND status = 'active'
        AND (valid_until IS NULL OR datetime(valid_until) > datetime('now'))`,
  ).bind(founderUserId, investorUserId).first();
  return !!row;
}

/** The NDA belongs to the venture founder, independently of who shared it. */
export async function projectNdaActive(env: Env, projectId: number, investorUserId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM pairwise_ndas n
       JOIN users owner ON owner.id = n.party_a_user_id
       JOIN projects p ON p.founder_id = owner.founder_id
      WHERE p.id = ? AND n.party_b_user_id = ? AND n.status = 'active'
        AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))`,
  ).bind(projectId, investorUserId).first();
  return !!row;
}

export async function logAccess(env: Env, projectId: number, userId: number, action: string, fileId: number | null) {
  try {
    await env.DB.prepare(
      `INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, fileId, userId, action, nowIso()).run();
  } catch (e) {
    // The log is evidence, not a gate: a failed insert must not deny a
    // download the caller is entitled to. It is loud in the tail instead.
    console.error('[data_room] access log insert failed', e);
  }
}

/**
 * D691 decision 6 — the access fields a file write may carry, checked:
 * a tier from the three, an expiry date, a `dd_request_id` that is a request
 * of this venture's own `dd_cases` (else 404), and a checklist item the room
 * knows. Only the fields the body names are returned.
 */
type AccessValues = Partial<Record<'access_tier' | 'access_expires_at' | 'dd_request_id' | 'checklist_item', string | number | null>>;
async function accessFields(env: Env, projectId: number, body: any): Promise<{ values: AccessValues } | { refusal: string; status: number }> {
  const values: AccessValues = {};
  if (body.access_tier !== undefined) {
    if (!isAccessTier(body.access_tier)) return { refusal: 'access_tier must be invited, committed or nobody', status: 400 };
    values.access_tier = body.access_tier;
  }
  if (body.access_expires_at !== undefined) {
    if (body.access_expires_at === null || body.access_expires_at === '') values.access_expires_at = null;
    else if (typeof body.access_expires_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.access_expires_at) || expiryMs(body.access_expires_at) == null) {
      return { refusal: 'access_expires_at must be a date (YYYY-MM-DD)', status: 400 };
    } else values.access_expires_at = body.access_expires_at;
  }
  if (body.dd_request_id !== undefined) {
    if (body.dd_request_id === null) values.dd_request_id = null;
    else {
      const id = Number(body.dd_request_id);
      const row = Number.isInteger(id) && id > 0 ? await env.DB.prepare(
        `SELECT r.id FROM dd_requests r JOIN dd_cases k ON k.id = r.case_id
          WHERE r.id = ? AND k.subject_type = 'project' AND k.subject_id = ?`,
      ).bind(id, projectId).first<{ id: number }>() : null;
      if (!row) return { refusal: 'Request not found', status: 404 };
      values.dd_request_id = Number(row.id);
    }
  }
  if (body.checklist_item !== undefined) {
    if (body.checklist_item === null) values.checklist_item = null;
    else if (typeof body.checklist_item !== 'string' || !CHECKLIST_KEYS.has(body.checklist_item)) return { refusal: 'Unknown checklist item', status: 400 };
    else values.checklist_item = body.checklist_item;
  }
  return { values };
}

/** The top-level folder of this name, created on first use. */
async function topFolder(env: Env, projectId: number, name: string): Promise<number> {
  const found = await env.DB.prepare(
    'SELECT id FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ? ORDER BY id LIMIT 1',
  ).bind(projectId, name).first<{ id: number }>();
  if (found) return Number(found.id);
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO data_room_folders (uid, project_id, parent_id, name, visibility, display_order, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'open', 0, ?, ?)`,
  ).bind(uid, projectId, name, nowIso(), nowIso()).run();
  const made = await env.DB.prepare('SELECT id FROM data_room_folders WHERE uid = ?').bind(uid).first<{ id: number }>();
  return Number(made?.id);
}

function badVisibility(v: unknown): boolean {
  return v !== undefined && !VISIBILITY.has(String(v));
}

/* ------------------------------------------------------------------ *
 * Investor side — registered FIRST so `/shared` is not swallowed by    *
 * `/:projectUid`. Hono matches in declaration order.                   *
 * ------------------------------------------------------------------ */

r.get('/shared', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT g.id AS grant_id, g.uid AS grant_uid, g.created_at, g.expires_at, g.project_id,
              p.uid AS project_uid, p.name AS project_name
         FROM data_room_grants g
         JOIN projects p ON p.id = g.project_id
        WHERE g.investor_user_id = ? AND g.status = 'active'
          AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))
        ORDER BY g.created_at DESC`,
    ).bind(user.id).all<any>();
    // D691 decision 6 — the count is what this investor's tier admits, so a
    // committed-only, private or expired file is never counted.
    const items = [];
    for (const { project_id, grant_id, ...r } of rows.results || []) {
      const committed = await investorCommitted(c.env, Number(project_id), user.id);
      // D1103 — and only what the grant's folders hold.
      const folders = await grantFolderScope(c.env, Number(grant_id));
      items.push({ ...r, file_count: (await admittedCounts(c.env, Number(project_id), committed, true, folders)).total });
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.get('/shared/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ?')
      .bind(c.req.param('projectUid')).first<ProjectRow>();
    // A project with no grant and a project that does not exist answer the
    // same way. Distinguishing them tells an investor which companies are on
    // the platform.
    const grant = project ? await activeGrant(c.env, project.id, user.id) : null;
    if (!project || !grant) return c.json({ detail: 'Data room not found' }, 404);

    const view = await investorView(c.env, project, grant, user.id);
    await logAccess(c.env, project.id, user.id, 'open_room', null);
    // The investor never learns how much the grant hides.
    const room: Partial<typeof view> = { ...view };
    delete room.hidden_from_grant;
    return c.json(room);
  } catch (e) { return mapError(c, e); }
});

/**
 * The room as one grant's investor may see it: the investor read's whole
 * filter, in one place, so `/shared/:projectUid` and the founder's preview
 * (D1103) cannot drift apart. The tier and expiry first, then the grant's
 * folders, then the NDA gate. Writes nothing.
 *
 * `hidden_from_grant` counts the files the tier, the expiry or the folders
 * hide. Only the preview returns it, and as a number: a file the grant cannot
 * open is never named.
 */
async function investorView(env: Env, project: ProjectRow, grant: GrantRow, investorUserId: number) {
  const nda = await projectNdaActive(env, project.id, investorUserId);
  const folders = await env.DB.prepare(
    `SELECT uid, name, parent_id, id, visibility, display_order
       FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name`,
  ).bind(project.id).all<any>();
  const files = await env.DB.prepare(
    `SELECT uid, name, folder_id, content_type, size_bytes, visibility, created_at, access_tier, access_expires_at
       FROM data_room_files WHERE project_id = ? ORDER BY name`,
  ).bind(project.id).all<any>();

  // D691 decision 6 — the tier and expiry first: a file they hide is neither
  // listed nor counted. D1103 — then the grant's folders. The NDA gate then
  // applies to what is left.
  const committed = await investorCommitted(env, project.id, investorUserId);
  const scope: FolderScope = await grantFolderScope(env, grant.id);
  const now = Date.now();
  const all = files.results || [];
  const admitted = all.filter((f) => tierAdmits(f, committed, now, scope))
    .map(({ access_tier, access_expires_at, ...rest }) => rest);
  const visible = (v: string) => v === 'open' || nda;
  // Filenames are withheld, not greyed out — see the header note.
  const openFiles = admitted.filter((f) => visible(f.visibility));
  const openFolders = (folders.results || []).filter((f) => visible(f.visibility) && folderInScope(f.id, scope));
  const withheld = admitted.length - openFiles.length;

  return {
    project: { uid: project.uid, name: project.name },
    nda_signed: nda,
    folders: openFolders.map(({ id, ...rest }) => rest),
    files: openFiles.map((f) => ({ ...f, folder_uid: folderUid(folders.results || [], f.folder_id) })),
    // A count, never the names. The investor is told something is behind the
    // NDA so the gate is not invisible; what it is stays private.
    withheld_behind_nda: withheld,
    hidden_from_grant: all.length - admitted.length,
  };
}

function folderUid(folders: any[], folderId: number | null): string | null {
  if (folderId == null) return null;
  const f = folders.find((x) => x.id === folderId);
  return f ? f.uid : null;
}

r.post('/shared/:projectUid/files/:uid/download', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const project = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ?')
      .bind(c.req.param('projectUid')).first<ProjectRow>();
    const grant = project ? await activeGrant(c.env, project.id, user.id) : null;
    if (!project || !grant) return c.json({ detail: 'Data room not found' }, 404);

    const file = await c.env.DB.prepare(
      'SELECT id, uid, name, r2_key, visibility, access_tier, access_expires_at, folder_id FROM data_room_files WHERE uid = ? AND project_id = ?',
    ).bind(c.req.param('uid'), project.id).first<any>();
    // D691 decision 6 — a file the tier or its expiry hides answers as one that
    // is not there: its existence is not confirmed. D1103 — so does a file
    // outside the grant's folders.
    if (!file || !tierAdmits(file, await investorCommitted(c.env, project.id, user.id), Date.now(), await grantFolderScope(c.env, grant.id))) {
      return c.json({ detail: 'File not found' }, 404);
    }

    // The gate is re-checked HERE, not inherited from the listing. A uid
    // captured while an NDA was live must stop working when it lapses.
    if (file.visibility === 'nda' && !(await projectNdaActive(c.env, project.id, user.id))) {
      // Logged before the refusal (D374): the founder's activity log filters
      // Blocked, and an attempt nobody recorded is one they cannot see.
      await logAccess(c.env, project.id, user.id, 'blocked', file.id);
      return c.json({ detail: 'This file requires a signed NDA' }, 403);
    }

    const { token, expires_at } = await mintDownloadToken(c.env, {
      key: file.r2_key,
      audience: `data_room:${project.uid}`,
      userId: user.id,
      ttlSec: 120,
    });
    await logAccess(c.env, project.id, user.id, 'download', file.id);
    return c.json({ url: `/api/files/dl/${token}`, expires_at, name: file.name });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * Founder side                                                         *
 * ------------------------------------------------------------------ */

r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;

    const folders = await c.env.DB.prepare(
      `SELECT id, uid, name, parent_id, visibility, display_order
         FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name`,
    ).bind(project.id).all<any>();
    // `downloads` is counted from the log, per file. It is a download count
    // and never a view count — no per-file view is logged (header note).
    const files = await c.env.DB.prepare(
      `SELECT f.id, f.uid, f.name, f.folder_id, f.content_type, f.size_bytes, f.visibility, f.created_at,
              f.access_tier, f.access_expires_at,
              (SELECT COUNT(*) FROM data_room_access_log l
                WHERE l.file_id = f.id AND l.project_id = f.project_id AND l.action = 'download') AS downloads
         FROM data_room_files f WHERE f.project_id = ? ORDER BY f.name`,
    ).bind(project.id).all<any>();
    const grants = await c.env.DB.prepare(
      `SELECT g.id, g.uid, g.status, g.created_at, g.expires_at, g.folders_scoped,
              u.email AS investor_email, u.name AS investor_name,
              granter.name AS granted_by_name, granter.role AS granted_by_role,
              EXISTS (
                SELECT 1 FROM pairwise_ndas n
                 WHERE n.party_a_user_id IN (SELECT owner.id FROM users owner WHERE owner.founder_id = p.founder_id)
                   AND n.party_b_user_id = g.investor_user_id
                   AND n.status = 'active'
                   AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
              ) AS nda_signed,
              -- D691 decision 6: the investor is a committed prospect of this
              -- venture, the match a committed-only file is opened by.
              EXISTS (
                SELECT 1 FROM raise_prospects rp
                 WHERE rp.project_id = g.project_id AND rp.stage = 'committed'
                   AND rp.email IS NOT NULL AND u.email IS NOT NULL
                   AND LOWER(rp.email) = LOWER(u.email)
              ) AS committed
         FROM data_room_grants g
         JOIN users u ON u.id = g.investor_user_id
         JOIN projects p ON p.id = g.project_id
         LEFT JOIN users granter ON granter.id = g.granted_by_user_id
        WHERE g.project_id = ? ORDER BY g.created_at DESC`,
    ).bind(project.id).all<any>();
    const reportShares = await reportSharesOf(c.env, project.id);
    const access = await c.env.DB.prepare(
      `SELECT l.action, l.created_at, u.email AS user_email, u.name AS user_name,
              f.name AS file_name, f.visibility AS file_visibility
         FROM data_room_access_log l
         JOIN users u ON u.id = l.user_id
         LEFT JOIN data_room_files f ON f.id = l.file_id
        WHERE l.project_id = ? ORDER BY l.created_at DESC LIMIT 50`,
    ).bind(project.id).all<any>();
    // The last seven days, counted in SQL over the whole log — not the length
    // of the fifty rows above, which would stop at fifty. `created_at` is
    // written as an ISO string (`nowIso`), so the column is normalised with
    // datetime() before it is compared (D124).
    const weekRows = await c.env.DB.prepare(
      `SELECT action, COUNT(*) AS n FROM data_room_access_log
        WHERE project_id = ? AND datetime(created_at) > datetime('now', '-7 days')
        GROUP BY action`,
    ).bind(project.id).all<{ action: string; n: number }>();
    const weekOf = (action: string) => {
      const hit = (weekRows.results || []).find((w) => w.action === action);
      return hit ? Number(hit.n) : 0;
    };

    const scopes = await grantScopesOf(c.env, project.id);

    return c.json({
      project: { uid: project.uid, name: project.name },
      // D1103 — what the caller may do here: `owner` shares and sets gates.
      role: room.role,
      folders: folders.results || [],
      files: files.results || [],
      grants: (grants.results || []).map(({ id, folders_scoped, ...g }) => ({
        ...g, nda_signed: !!g.nda_signed,
        // D1103 — null opens every folder; else the uids it opens. Unreadable
        // is said, never drawn as every folder or none.
        ...(Number(folders_scoped) !== 1 ? { folders: null }
          : scopes ? { folders: scopes.get(Number(id)) ?? [] } : { folders: null, folders_unreadable: true }),
      })),
      report_shares: reportShares,
      recent_access: access.results || [],
      // A real count of a table this route owns: an action with no row in the
      // window is zero events, not an unknown.
      week: { opened: weekOf('open_room'), downloaded: weekOf('download'), blocked: weekOf('blocked') },
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/folders', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ detail: 'name is required' }, 400);
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);
    if (room.role !== 'owner' && namesGate(body)) return c.json(OWNER_ONLY, 403);

    // A parent must belong to the SAME project, or a folder could be re-homed
    // into another founder's tree by uid.
    let parentId: number | null = null;
    if (body.parent_uid) {
      const parent = await c.env.DB.prepare(
        'SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?',
      ).bind(String(body.parent_uid), project.id).first<{ id: number }>();
      if (!parent) return c.json({ detail: 'Parent folder not found' }, 404);
      parentId = parent.id;
    }

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO data_room_folders
         (uid, project_id, parent_id, name, visibility, display_order, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, project.id, parentId, name.slice(0, NAME_MAX),
           body.visibility ? String(body.visibility) : 'open',
           Number(body.display_order) || 0, user.id, nowIso(), nowIso()).run();
    return c.json({ uid }, 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/:projectUid/folders/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    const body = await c.req.json().catch(() => ({} as any));
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);
    // D1103 — a co-founder organises; only the owner changes a gate.
    if (room.role !== 'owner' && namesGate(body)) return c.json(OWNER_ONLY, 403);

    const sets: string[] = []; const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).slice(0, NAME_MAX)); }
    if (body.visibility !== undefined) { sets.push('visibility = ?'); params.push(String(body.visibility)); }
    if (body.display_order !== undefined) { sets.push('display_order = ?'); params.push(Number(body.display_order) || 0); }
    if (!sets.length) return c.json({ detail: 'nothing to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());

    // project_id in the WHERE, not just the uid: the uid alone would let one
    // founder patch another's folder.
    const update = c.env.DB.prepare(
      `UPDATE data_room_folders SET ${sets.join(', ')} WHERE uid = ? AND project_id = ?`,
    ).bind(...params, c.req.param('uid'), project.id);

    // A folder's gate is the folder's NAME only — every file keeps its own
    // visibility, and that is what the download checks. So "mark this folder
    // NDA" means nothing to the files inside unless it is carried to them, and
    // `apply_to_contents` is that: one batch sets the folder, every folder
    // under it, and every file in any of them. The tree walk is bounded by
    // project_id at each step, so it cannot leave this founder's room.
    if (body.apply_to_contents === true && body.visibility !== undefined) {
      const vis = String(body.visibility);
      // The same walk in both statements, written out rather than spliced in,
      // so each query text is a literal. SQLite needs no RECURSIVE keyword for
      // a CTE that names itself; `tree` is that CTE, not a table.
      const [res] = await c.env.DB.batch([
        update,
        c.env.DB.prepare(
          `WITH tree AS (
             SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?
             UNION ALL
             SELECT f.id FROM data_room_folders f JOIN tree t ON f.parent_id = t.id WHERE f.project_id = ?
           )
           UPDATE data_room_folders SET visibility = ?, updated_at = ?
             WHERE project_id = ? AND id IN (SELECT id FROM tree)`,
        ).bind(c.req.param('uid'), project.id, project.id, vis, nowIso(), project.id),
        c.env.DB.prepare(
          `WITH tree AS (
             SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?
             UNION ALL
             SELECT f.id FROM data_room_folders f JOIN tree t ON f.parent_id = t.id WHERE f.project_id = ?
           )
           UPDATE data_room_files SET visibility = ?, updated_at = ?
             WHERE project_id = ? AND folder_id IN (SELECT id FROM tree)`,
        ).bind(c.req.param('uid'), project.id, project.id, vis, nowIso(), project.id),
      ]);
      if (!(res as any).meta?.changes) return c.json({ detail: 'Folder not found' }, 404);
      return c.json({ ok: true });
    }

    const res = await update.run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'Folder not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/folders/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    // D1103 — the folder leaves every grant's scope with it, by hand, since D1
    // may run with foreign keys off. A scoped grant left naming nothing opens
    // nothing (migration 594).
    const [, res] = await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM data_room_grant_folders
          WHERE folder_id IN (SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?)`,
      ).bind(c.req.param('uid'), project.id),
      c.env.DB.prepare(
        'DELETE FROM data_room_folders WHERE uid = ? AND project_id = ?',
      ).bind(c.req.param('uid'), project.id),
    ]);
    if (!(res as any).meta?.changes) return c.json({ detail: 'Folder not found' }, 404);
    // Migration 184 sets data_room_files.folder_id ON DELETE SET NULL, so the
    // files land at the room root rather than disappearing with the folder.
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/files', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;

    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ detail: 'name is required' }, 400);
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);
    if (room.role !== 'owner' && namesGate(body)) return c.json(OWNER_ONLY, 403);

    const dataUri = String(body.data || '');
    const comma = dataUri.indexOf(',');
    if (!dataUri.startsWith('data:') || comma < 0) {
      return c.json({ detail: 'data must be a base64 data URI' }, 400);
    }
    const declaredMime = dataUri.slice(5, dataUri.indexOf(';')) || 'application/octet-stream';
    let bytes: Uint8Array;
    try {
      const bin = atob(dataUri.slice(comma + 1));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch { return c.json({ detail: 'invalid base64' }, 400); }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return c.json({ detail: 'too_large', max_bytes: MAX_FILE_BYTES }, 413);
    }

    const access = await accessFields(c.env, project.id, body);
    if ('refusal' in access) return c.json({ detail: access.refusal }, access.status as any);

    let folderId: number | null = null;
    // D1103 — a co-founder's upload takes its folder's visibility, never a gate of its own.
    let folderVisibility = 'open';
    if (body.folder_uid) {
      const folder = await c.env.DB.prepare(
        'SELECT id, visibility FROM data_room_folders WHERE uid = ? AND project_id = ?',
      ).bind(String(body.folder_uid), project.id).first<{ id: number; visibility: string }>();
      if (!folder) return c.json({ detail: 'Folder not found' }, 404);
      folderId = folder.id;
      folderVisibility = VISIBILITY.has(String(folder.visibility)) ? String(folder.visibility) : 'nda';
    } else if (typeof body.folder_name === 'string' && body.folder_name.trim()) {
      // D691 — Upload names a top-level folder, created on first use.
      folderId = await topFolder(c.env, project.id, body.folder_name.trim().slice(0, NAME_MAX));
    }

    // The key is derived, never taken from the request: a caller-supplied key
    // is a path-traversal write into another project's prefix.
    const uid = newUid();
    const key = `data-room/${project.uid}/${uid}`;
    await c.env.FILES.put(key, bytes, {
      httpMetadata: { contentType: declaredMime },
      customMetadata: { project_uid: project.uid, uploaded_by: String(user.id) },
    });

    const ins = await c.env.DB.prepare(
      `INSERT INTO data_room_files
         (uid, project_id, folder_id, name, r2_key, content_type, size_bytes,
          visibility, uploaded_by_user_id, created_at, updated_at,
          access_tier, access_expires_at, dd_request_id, checklist_item)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, project.id, folderId, name.slice(0, NAME_MAX), key, declaredMime,
           bytes.byteLength, body.visibility ? String(body.visibility) : room.role === 'owner' ? 'open' : folderVisibility,
           user.id, nowIso(), nowIso(),
           access.values.access_tier ?? 'invited', access.values.access_expires_at ?? null,
           access.values.dd_request_id ?? null, access.values.checklist_item ?? null).run();
    // D691 decision 12 — the file's record logs its upload. No file name: a
    // filename is itself information.
    const fileId = Number((ins as any)?.meta?.last_row_id) || null;
    if (fileId != null) {
      await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
        entityId: fileId, action: 'file_uploaded', summary: `File uploaded; access ${access.values.access_tier ?? 'invited'}` });
    }
    return c.json({ uid, size_bytes: bytes.byteLength }, 201);
  } catch (e) { return mapError(c, e); }
});

/**
 * D691 (#1700) — Replace: the Raise file record's `replace` action. The
 * current object becomes the file's next `data_room_file_versions` row and
 * stays in storage; the new bytes take its place under a key derived the way
 * the upload derives it, inside `data-room/<project uid>/`, so the delete's
 * prefix check still holds. `MAX_FILE_BYTES` applies. The closing PR's
 * multipart action passes the file.
 */
export async function replaceDataRoomFile(
  env: Env,
  a: { project: { id: number; uid: string }; userId: number; fileId: number; bytes: Uint8Array; contentType: string | null },
): Promise<{ id: number; version: number; size_bytes: number }> {
  const { project } = a;
  if (!env.FILES) throw new WriterError(503, 'storage_not_configured');
  if (!(a.bytes instanceof Uint8Array) || a.bytes.byteLength === 0) throw new WriterError(400, 'The file is empty');
  if (a.bytes.byteLength > MAX_FILE_BYTES) throw new WriterError(413, 'too_large');
  const file = await env.DB.prepare(
    'SELECT id, r2_key, content_type, size_bytes, uploaded_by_user_id FROM data_room_files WHERE id = ? AND project_id = ?',
  ).bind(a.fileId, project.id).first<{ id: number; r2_key: string; content_type: string | null; size_bytes: number | null; uploaded_by_user_id: number | null }>();
  if (!file) throw new WriterError(404, 'File not found');
  const last = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM data_room_file_versions WHERE file_id = ?')
    .bind(file.id).first<{ v: number }>();
  const version = Number(last?.v ?? 0) + 1;
  const contentType = typeof a.contentType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) ? a.contentType : 'application/octet-stream';

  // The key is derived, never taken from the request.
  const uid = newUid();
  const key = `data-room/${project.uid}/${uid}`;
  await env.FILES.put(key, a.bytes, {
    httpMetadata: { contentType },
    customMetadata: { project_uid: project.uid, uploaded_by: String(a.userId) },
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(file.id, version, file.r2_key, file.content_type, file.size_bytes, file.uploaded_by_user_id),
    env.DB.prepare(
      `UPDATE data_room_files SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by_user_id = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    ).bind(key, contentType, a.bytes.byteLength, a.userId, nowIso(), file.id, project.id),
  ]);
  await logCycleWrite(env, { projectId: project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: file.id, action: 'file_replaced', summary: `File replaced; version ${version} kept` });
  return { id: file.id, version, size_bytes: a.bytes.byteLength };
}

r.patch('/:projectUid/files/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    const body = await c.req.json().catch(() => ({} as any));
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);
    // D1103 — a co-founder renames, moves and matches; only the owner changes a gate.
    if (room.role !== 'owner' && namesGate(body)) return c.json(OWNER_ONLY, 403);
    const access = await accessFields(c.env, project.id, body);
    if ('refusal' in access) return c.json({ detail: access.refusal }, access.status as any);

    const sets: string[] = []; const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).slice(0, NAME_MAX)); }
    // D691 decision 6 — the file's tier, its expiry, and the request or checklist item it answers.
    for (const col of ['access_tier', 'access_expires_at', 'dd_request_id', 'checklist_item'] as const) {
      if (col in access.values) { sets.push(`${col} = ?`); params.push(access.values[col]); }
    }
    if (body.visibility !== undefined) { sets.push('visibility = ?'); params.push(String(body.visibility)); }
    if (body.folder_uid !== undefined) {
      if (body.folder_uid === null) { sets.push('folder_id = ?'); params.push(null); }
      else {
        const folder = await c.env.DB.prepare(
          'SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?',
        ).bind(String(body.folder_uid), project.id).first<{ id: number }>();
        if (!folder) return c.json({ detail: 'Folder not found' }, 404);
        sets.push('folder_id = ?'); params.push(folder.id);
      }
    }
    if (!sets.length) return c.json({ detail: 'nothing to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());

    const res = await c.env.DB.prepare(
      `UPDATE data_room_files SET ${sets.join(', ')} WHERE uid = ? AND project_id = ? RETURNING id`,
    ).bind(...params, c.req.param('uid'), project.id).first<{ id: number }>();
    if (!res) return c.json({ detail: 'File not found' }, 404);
    // D691 decision 12 — one row on the file's record, naming the fields changed.
    const fields = sets.slice(0, -1).map((x) => x.split(' ')[0].replace(/_id$/, '').replace(/_/g, ' '));
    await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: Number(res.id), action: 'file_updated', summary: `File edited: ${fields.join(', ')}` });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/files/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const removed = await removeDataRoomFile(c.env, { project, userId: Number(user.id), uid: c.req.param('uid') });
    if (!removed) return c.json({ detail: 'File not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * D1103 (#2983) — the founder's own files: download, versions, preview *
 * ------------------------------------------------------------------ */

const FOUNDER_LINK_TTL_SEC = 120;
type FileRow = { id: number; uid: string; name: string; r2_key: string; content_type: string | null; size_bytes: number | null; uploaded_by_user_id: number | null; updated_at: string | null };

async function roomFile(env: Env, projectId: number, uid: string): Promise<FileRow | null> {
  return (await env.DB.prepare(
    `SELECT id, uid, name, r2_key, content_type, size_bytes, uploaded_by_user_id, updated_at
       FROM data_room_files WHERE uid = ? AND project_id = ?`,
  ).bind(uid, projectId).first<FileRow>()) || null;
}

/** A version number from the path: a positive integer, else null. */
const versionOf = (raw: string): number | null => (/^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null);

/**
 * The founder's one-time link: the investor download's 120-second, single-use
 * token, for an object inside this venture's prefix only. It is logged on the
 * file's record as the founder's own event (`logCycleWrite`), never in
 * `data_room_access_log`, so it is never counted as an investor's download.
 */
async function founderLink(env: Env, project: ProjectRow, userId: number, file: FileRow, key: string, version: number | null) {
  if (!key.startsWith(`data-room/${project.uid}/`)) throw new WriterError(404, 'File not found');
  const { token, expires_at } = await mintDownloadToken(env, {
    key, audience: `data_room_founder:${project.uid}`, userId, ttlSec: FOUNDER_LINK_TTL_SEC,
  });
  await logCycleWrite(env, { projectId: project.id, userId, cycle: 'raise', module: 'data-room',
    entityId: file.id, action: 'file_downloaded', summary: version == null ? 'Current version downloaded by the venture' : `Version ${version} downloaded by the venture` });
  return { url: `/api/files/dl/${token}`, expires_at, name: file.name, version };
}

r.post('/:projectUid/files/:uid/download', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const file = await roomFile(c.env, room.project.id, c.req.param('uid'));
    if (!file) return c.json({ detail: 'File not found' }, 404);
    return c.json(await founderLink(c.env, room.project, Number(user.id), file, file.r2_key, null));
  } catch (e) { return mapError(c, e); }
});

/**
 * The file's versions, the current one first. The current one is the file's
 * own row; each earlier one is a `data_room_file_versions` row (Replace keeps
 * the bytes it replaced). A size or uploader nobody recorded is null, never 0.
 */
r.get('/:projectUid/files/:uid/versions', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const file = await roomFile(c.env, room.project.id, c.req.param('uid'));
    if (!file) return c.json({ detail: 'File not found' }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT v.version, v.content_type, v.size_bytes, v.created_at, u.name AS uploaded_by_name
         FROM data_room_file_versions v LEFT JOIN users u ON u.id = v.uploaded_by
        WHERE v.file_id = ? ORDER BY v.version DESC`,
    ).bind(file.id).all<any>();
    const uploader = file.uploaded_by_user_id == null ? null : await c.env.DB.prepare('SELECT name FROM users WHERE id = ?')
      .bind(file.uploaded_by_user_id).first<{ name: string | null }>();
    return c.json({
      file: { uid: file.uid, name: file.name },
      current: { content_type: file.content_type, size_bytes: file.size_bytes, uploaded_by_name: uploader?.name ?? null, updated_at: file.updated_at },
      versions: (rows.results || []).map((v) => ({
        version: Number(v.version), content_type: v.content_type ?? null, size_bytes: v.size_bytes ?? null,
        uploaded_by_name: v.uploaded_by_name ?? null, created_at: v.created_at,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/files/:uid/versions/:n/download', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const file = await roomFile(c.env, room.project.id, c.req.param('uid'));
    const n = versionOf(c.req.param('n'));
    const version = file && n != null ? await c.env.DB.prepare(
      'SELECT r2_key FROM data_room_file_versions WHERE file_id = ? AND version = ?',
    ).bind(file.id, n).first<{ r2_key: string }>() : null;
    if (!file || !version) return c.json({ detail: 'Version not found' }, 404);
    return c.json(await founderLink(c.env, room.project, Number(user.id), file, version.r2_key, n));
  } catch (e) { return mapError(c, e); }
});

/**
 * Make an earlier version current: a SWAP, so nothing is lost. The file's row
 * takes version n's object, type, size and uploader, and version n's row takes
 * what was current. Both writes are one batch, guarded on the key each row
 * held when read, so two swaps at once cannot leave one object on both rows.
 * Logged on the file's record.
 */
r.post('/:projectUid/files/:uid/versions/:n/current', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    const file = await roomFile(c.env, project.id, c.req.param('uid'));
    const n = versionOf(c.req.param('n'));
    const version = file && n != null ? await c.env.DB.prepare(
      'SELECT id, r2_key, content_type, size_bytes, uploaded_by FROM data_room_file_versions WHERE file_id = ? AND version = ?',
    ).bind(file.id, n).first<{ id: number; r2_key: string; content_type: string | null; size_bytes: number | null; uploaded_by: number | null }>() : null;
    if (!file || !version) return c.json({ detail: 'Version not found' }, 404);
    if (!version.r2_key.startsWith(`data-room/${project.uid}/`)) return c.json({ detail: 'Version not found' }, 404);
    const at = nowIso();
    const [toFile, toVersion] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE data_room_files SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by_user_id = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND r2_key = ?`,
      ).bind(version.r2_key, version.content_type, version.size_bytes, version.uploaded_by, at, file.id, project.id, file.r2_key),
      c.env.DB.prepare(
        `UPDATE data_room_file_versions SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by = ?, updated_at = ?
          WHERE id = ? AND r2_key = ?
            AND EXISTS (SELECT 1 FROM data_room_files WHERE id = ? AND r2_key = ?)`,
      ).bind(file.r2_key, file.content_type, file.size_bytes, file.uploaded_by_user_id, at, version.id, version.r2_key, file.id, version.r2_key),
    ]);
    if (!(toFile as any).meta?.changes || !(toVersion as any).meta?.changes) {
      return c.json({ detail: 'The file changed while this was saved. Read it again and retry.', code: 'version_conflict' }, 409);
    }
    await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: file.id, action: 'version_made_current', summary: `Version ${n} made current; the one it replaced is kept as version ${n}` });
    return c.json({ ok: true, version: n });
  } catch (e) { return mapError(c, e); }
});

/**
 * The room exactly as one investor sees it: the investor read's own filter
 * (`investorView`) for that grant, with the files it hides counted, never
 * named. It writes no log row: a founder looking is not the investor opening
 * the room. A revoked or ended grant is previewed as what it opens now:
 * nothing.
 */
r.get('/:projectUid/preview', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    const grantUid = String(c.req.query('grant') || '');
    const row = grantUid ? await c.env.DB.prepare(
      'SELECT investor_user_id FROM data_room_grants WHERE uid = ? AND project_id = ?',
    ).bind(grantUid, project.id).first<{ investor_user_id: number }>() : null;
    if (!row) return c.json({ detail: 'Grant not found' }, 404);
    const grant = await activeGrant(c.env, project.id, Number(row.investor_user_id));
    if (!grant || grant.uid !== grantUid) {
      return c.json({ grant_uid: grantUid, open: false, reason: 'This grant is revoked or has ended, so it opens nothing.' });
    }
    const view = await investorView(c.env, project, grant, Number(row.investor_user_id));
    return c.json({ grant_uid: grantUid, open: true, ...view });
  } catch (e) { return mapError(c, e); }
});

/**
 * D691 (#1700) — Remove: the delete above and the Raise file record's
 * `remove` action, one writer. The file is named by its uid (this route) or
 * its id (the record), always with its venture. Its earlier versions go with
 * it. Null when it is not this venture's file.
 */
export async function removeDataRoomFile(
  env: Env, a: { project: { id: number; uid: string }; userId: number | null; uid?: string; fileId?: number },
): Promise<{ id: number } | null> {
  const { project } = a;
  const file = await env.DB.prepare(
    'SELECT id, r2_key FROM data_room_files WHERE (uid = ? OR id = ?) AND project_id = ?',
  ).bind(a.uid ?? null, a.fileId ?? null, project.id).first<{ id: number; r2_key: string }>();
  if (!file) return null;
  const versions = await env.DB.prepare('SELECT r2_key FROM data_room_file_versions WHERE file_id = ?')
    .bind(file.id).all<{ r2_key: string }>();

  // Row first. A deleted object with a surviving row is a broken download;
  // a surviving object with no row is unreachable, which is merely waste.
  // D1 may run with foreign keys off, so the versions' rows go by hand.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM data_room_file_versions WHERE file_id = ?').bind(file.id),
    env.DB.prepare('DELETE FROM data_room_files WHERE id = ?').bind(file.id),
  ]);
  // Only an object inside this project's prefix is ever deleted.
  if (env.FILES && file.r2_key.startsWith(`data-room/${project.uid}/`)) {
    try { await env.FILES.delete(file.r2_key); }
    catch (e) { console.error('[data_room] R2 delete failed', e); }
  }
  for (const version of versions.results || []) {
    if (env.FILES && version.r2_key.startsWith(`data-room/${project.uid}/`)) {
      try { await env.FILES.delete(version.r2_key); }
      catch (e) { console.error('[data_room] R2 delete failed', e); }
    }
  }
  await logCycleWrite(env, { projectId: project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: file.id, action: 'file_removed', summary: `File removed with ${(versions.results || []).length} earlier versions` });
  return { id: file.id };
}

/** D1103 — each scoped grant's named folders, by grant id; null when the store cannot be read. */
async function grantScopesOf(env: Env, projectId: number): Promise<Map<number, string[]> | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT gf.grant_id, f.uid FROM data_room_grant_folders gf
         JOIN data_room_grants g ON g.id = gf.grant_id AND g.project_id = ?
         JOIN data_room_folders f ON f.id = gf.folder_id AND f.project_id = ?
        ORDER BY f.display_order, f.name`,
    ).bind(projectId, projectId).all<{ grant_id: number; uid: string }>();
    const out = new Map<number, string[]>();
    for (const r of rows.results || []) out.set(Number(r.grant_id), [...(out.get(Number(r.grant_id)) || []), String(r.uid)]);
    return out;
  } catch (e) {
    console.warn('[data_room] grant folders unreadable:', (e as Error)?.message);
    return null;
  }
}

/**
 * #1524 (D663 follow-up) — the accounts this project's scoring report was
 * shared with (D588, `lab_report_shares`), read beside the room's grants.
 *
 * ONE STORE EACH, READ TOGETHER. A grant opens the room's files; a report
 * share opens one frozen scoring report, nothing in the room. They are kept
 * as their own kind in the response, read-only here (a report share is made
 * and revoked on the Lab scoring page), so the room's Revoke can never act on
 * one and the founder still sees everyone who can read about the venture.
 *
 * `status` is the link's state now: revoked, used up (every open spent),
 * expired, or active. Null when the shares could not be read: never an empty
 * list, which would claim nobody has the report.
 */
export type ReportShare = {
  id: number; report_kind: string; audience: string; grantee_email: string; grantee_name: string | null;
  opens: number; open_limit: number; expires_at: string; created_at: string;
  status: 'active' | 'expired' | 'used_up' | 'revoked';
};

export function reportShareStatus(row: { revoked_at: string | null; opens: number; open_limit: number; expires_at: string }, nowSql: string): ReportShare['status'] {
  if (row.revoked_at) return 'revoked';
  if (Number(row.opens) >= Number(row.open_limit)) return 'used_up';
  if (String(row.expires_at) <= nowSql) return 'expired';
  return 'active';
}

async function reportSharesOf(env: Env, projectId: number): Promise<ReportShare[] | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT s.id, s.report_kind, s.audience, s.opens, s.open_limit, s.expires_at, s.revoked_at, s.created_at,
              u.email AS grantee_email, u.name AS grantee_name
         FROM lab_report_shares s JOIN users u ON u.id = s.grantee_user_id
        WHERE s.project_id = ?
        ORDER BY s.id DESC`,
    ).bind(projectId).all<any>();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return (rows.results || []).map((r) => ({
      id: Number(r.id), report_kind: r.report_kind, audience: r.audience,
      grantee_email: r.grantee_email, grantee_name: r.grantee_name ?? null,
      opens: Number(r.opens), open_limit: Number(r.open_limit), expires_at: r.expires_at, created_at: r.created_at,
      status: reportShareStatus(r, now),
    }));
  } catch (e) {
    console.warn('[data_room] report shares unreadable:', (e as Error)?.message);
    return null;
  }
}

/**
 * D1103 — a grant's end date and folders, checked. `expires_at` is a day
 * (`YYYY-MM-DD`), today or later, stored as the end of that day UTC so the
 * grant is open through it; null or '' clears it. `folders` is null for every
 * folder, or a non-empty list of this venture's folder uids (an unknown one is
 * 404). Only the fields the body names are returned.
 */
type GrantFields = { expires_at?: string | null; folders?: number[] | null };
async function grantFields(env: Env, projectId: number, body: any): Promise<{ values: GrantFields } | { refusal: string; status: 400 | 404 }> {
  const values: GrantFields = {};
  if (body.expires_at !== undefined) {
    if (body.expires_at === null || body.expires_at === '') values.expires_at = null;
    else {
      const day = typeof body.expires_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expires_at) ? body.expires_at : null;
      const at = day ? expiryMs(`${day} 23:59:59`) : null;
      if (!day || at == null || new Date(at).toISOString().slice(0, 10) !== day) return { refusal: 'expires_at must be a date (YYYY-MM-DD)', status: 400 };
      if (at <= Date.now()) return { refusal: 'expires_at must be today or later', status: 400 };
      values.expires_at = `${day} 23:59:59`;
    }
  }
  if (body.folders !== undefined) {
    if (body.folders === null) values.folders = null;
    else {
      if (!Array.isArray(body.folders) || !body.folders.length || body.folders.length > 200
        || !body.folders.every((u: unknown) => typeof u === 'string' && u.length > 0 && u.length <= 64)) {
        return { refusal: 'folders must be null for every folder, or a list of folder uids', status: 400 };
      }
      const ids: number[] = [];
      for (const uid of new Set<string>(body.folders)) {
        const row = await env.DB.prepare('SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?')
          .bind(uid, projectId).first<{ id: number }>();
        if (!row) return { refusal: 'Folder not found', status: 404 };
        ids.push(Number(row.id));
      }
      values.folders = ids;
    }
  }
  return { values };
}

/**
 * The statements that set a grant's folders (migration 594): its flag, then
 * its rows replaced. The grant is named by its project and either its
 * investor or its uid, the same two binds in every statement, each a literal.
 */
function scopeStatements(env: Env, by: 'investor' | 'uid', key: [number, number | string], folders: number[] | null) {
  const flag = by === 'investor'
    ? env.DB.prepare('UPDATE data_room_grants SET folders_scoped = ? WHERE project_id = ? AND investor_user_id = ?')
    : env.DB.prepare('UPDATE data_room_grants SET folders_scoped = ? WHERE project_id = ? AND uid = ?');
  const clear = by === 'investor'
    ? env.DB.prepare('DELETE FROM data_room_grant_folders WHERE grant_id IN (SELECT id FROM data_room_grants WHERE project_id = ? AND investor_user_id = ?)')
    : env.DB.prepare('DELETE FROM data_room_grant_folders WHERE grant_id IN (SELECT id FROM data_room_grants WHERE project_id = ? AND uid = ?)');
  const add = by === 'investor'
    ? 'INSERT INTO data_room_grant_folders (grant_id, folder_id, created_at) SELECT id, ?, ? FROM data_room_grants WHERE project_id = ? AND investor_user_id = ?'
    : 'INSERT INTO data_room_grant_folders (grant_id, folder_id, created_at) SELECT id, ?, ? FROM data_room_grants WHERE project_id = ? AND uid = ?';
  return [
    flag.bind(folders === null ? 0 : 1, ...key),
    clear.bind(...key),
    ...(folders || []).map((id) => env.DB.prepare(add).bind(id, nowIso(), ...key)),
  ];
}

r.post('/:projectUid/grants', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    // D1103 — only the owner shares.
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return c.json({ detail: 'email is required' }, 400);
    // Checked before the address is looked up, so a refusal says nothing about who has an account.
    const fields = await grantFields(c.env, project.id, body);
    if ('refusal' in fields) return c.json({ detail: fields.refusal }, fields.status);

    // Resolves to an EXISTING account. No invitation is sent and no row is
    // written for an unknown address. Both outcomes return the same response.
    const investor = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number }>();
    if (!investor) return c.json({ ok: true }, 201);
    if (investor.id === user.id) return c.json({ ok: true }, 201);

    const uid = newUid();
    // Re-granting a revoked investor reactivates the existing row rather than
    // failing on the UNIQUE(project_id, investor_user_id) constraint. A
    // re-grant that names no `folders` keeps the scope the row had.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO data_room_grants
           (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT (project_id, investor_user_id) DO UPDATE SET
           status = 'active', granted_by_user_id = excluded.granted_by_user_id,
           expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      ).bind(uid, project.id, investor.id, user.id, fields.values.expires_at ?? null, nowIso(), nowIso()),
      ...(fields.values.folders !== undefined ? scopeStatements(c.env, 'investor', [project.id, investor.id], fields.values.folders) : []),
    ]);
    return c.json({ ok: true }, 201);
  } catch (e) { return mapError(c, e); }
});

/** D1103 — the owner changes a grant's end date or folders from the page. */
r.patch('/:projectUid/grants/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const fields = await grantFields(c.env, project.id, body);
    if ('refusal' in fields) return c.json({ detail: fields.refusal }, fields.status);
    const { values } = fields;
    if (values.expires_at === undefined && values.folders === undefined) return c.json({ detail: 'nothing to update' }, 400);
    const grantUid = c.req.param('uid');
    const found = await c.env.DB.prepare('SELECT id FROM data_room_grants WHERE uid = ? AND project_id = ?')
      .bind(grantUid, project.id).first<{ id: number }>();
    if (!found) return c.json({ detail: 'Grant not found' }, 404);
    await c.env.DB.batch([
      values.expires_at !== undefined
        ? c.env.DB.prepare('UPDATE data_room_grants SET expires_at = ?, updated_at = ? WHERE uid = ? AND project_id = ?')
          .bind(values.expires_at, nowIso(), grantUid, project.id)
        : c.env.DB.prepare('UPDATE data_room_grants SET updated_at = ? WHERE uid = ? AND project_id = ?')
          .bind(nowIso(), grantUid, project.id),
      ...(values.folders !== undefined ? scopeStatements(c.env, 'uid', [project.id, grantUid], values.folders) : []),
    ]);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/grants/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;
    // D1103 — only the owner revokes.
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    // Revoked, not deleted: the access log points at a user whose grant is
    // gone, and the founder still needs to read what that investor opened.
    const res = await c.env.DB.prepare(
      `UPDATE data_room_grants SET status = 'revoked', updated_at = ?
        WHERE uid = ? AND project_id = ?`,
    ).bind(nowIso(), c.req.param('uid'), project.id).run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'Grant not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;
