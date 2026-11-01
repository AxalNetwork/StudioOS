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
 *   GET    /:projectUid/requests              the access-request queue (D1104)
 *   POST   /:projectUid/requests/:uid/accept  write the grant, with folders and an end date
 *   POST   /:projectUid/requests/:uid/decline a reason the investor is told
 *   POST   /:projectUid/grants/:uid/nda       the founder sends the three-way NDA (D1104)
 *   GET    /:projectUid/activity?from&to&investor&action&page   daily figures against the
 *                                             period before, per investor, and the log (D1105)
 *   GET    /:projectUid/activity.csv?from&to&investor&action    the same rows as CSV (D1105)
 *   GET    /:projectUid/checklist             per diligence item, its files and who can
 *                                             open them (D1105)
 *
 * REQUESTS AND THE FOUNDER'S NDA (D1104, migration 595). An investor's ask
 * to see the room — from a round call, or the deal page once DL9 is built —
 * is one row in `data_room_access_requests`, one open per investor and
 * venture (`services/dataRoomRequests.ts`). The owner and co-founders read
 * the queue; only the owner answers it, as only the owner shares. Accepting
 * writes the grant in the same way `POST /grants` does; a request already
 * decided answers 409 and writes nothing. The three-way NDA, which only the
 * investor could start (`/api/trust/intro/request`), the venture's founder
 * can now send for a grant: they are party A, as `pairwise_ndas` requires,
 * so an admin or a co-founder cannot send it in their name.
 *
 * WHO ON THE FOUNDER SIDE (D1103, owner question 2, answer A). The owner — the
 * account that owns the venture — does everything; admins use D1102 summary/support reads. A co-founder
 * (an accepted `project_members` row with role `cofounder`) reads the room,
 * uploads, moves and renames files and folders, matches a file to a request
 * or checklist item, opens any version and makes one current. Only the owner
 * shares, revokes, changes a grant, changes a gate (a file's or folder's
 * `visibility`, `access_tier`, `access_expires_at`) or deletes a file. A
 * co-founder's upload takes its folder's visibility and the default tier.
 * Anyone else gets 404, as before.
 *
 * ADMIN SIDE (D1102; no owner writes)
 *   GET    /:projectUid                       aggregate summary, no names/identities
 *   POST   /:projectUid/support-read          required reason; founder-visible audit
 *                                             before read-only details
 *
 * INVESTOR SIDE (holder of a grant; admins use support-read instead)
 *   GET    /shared                            rooms shared with me
 *   GET    /shared/:projectUid                the room as I may see it
 *   GET    /shared/:projectUid/evidence       the founder's shared evidence as I may see it (D1265)
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
import { markRequestAnsweredByFile } from '../services/ddRequests';
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { companyScope } from '../services/tenancyScope';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
import { mintDownloadToken } from '../services/signedDownload';
import {
  tierAdmits, investorCommitted, admittedCounts, isAccessTier, expiryMs, grantFolderScope, folderInScope, type FolderScope,
} from '../services/dataRoomAccess';
import { CHECKLIST_KEYS } from '../services/raiseCycle';
import { activityCsv, activityRead, checklistRead, investorOfGrant, parseActivityQuery, CSV_MAX_ROWS } from '../services/dataRoomActivity';
import { logCycleWrite } from '../services/cycleActivity';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { WriterError } from '../services/validateWriters';
import { DECLINE_REASON_MAX, readRequests } from '../services/dataRoomRequests';
import { deckSourceReady, sourceFile, sourceState, sourceQuote, typedFile, fileKind, enableSource, resetSourceStatements } from '../services/decks/dataroomExtract';
import { investorEvidence, RaiseEvidenceError } from '../services/raiseEvidence';

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

/** D1102 — the same owner-only policy for the room and its shared record door. */
export function dataRoomOwner(project: { founder_id: number | null }, user: { role: string; founder_id?: number | null }): boolean {
  return user.role === 'founder' && typeof user.founder_id === 'number'
    && Number.isSafeInteger(user.founder_id) && user.founder_id > 0 && project.founder_id === user.founder_id;
}

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
  // D1102 — this is the venture owner's workspace, never an admin wildcard.
  if (user.role !== 'founder') return null;
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
  if (user.role === 'admin') return null;
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
          WHERE r.id = ? AND k.subject_type = 'project' AND k.subject_id = ? AND r.withdrawn_at IS NULL`,
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
    if (user.role === 'admin') return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
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
    if (user.role === 'admin') return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
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

// D1265 (#3288): the founder's shared Raise evidence, as this investor may see it. Who counts as an
// investor in the raise, the NDA, each item's sharing, the file gate and quote consent are all
// `investorEvidence`'s; an outsider and a missing venture answer alike. Each open logs `open_evidence`.
r.get('/shared/:projectUid/evidence', async (c) => {
  try {
    const user = await requireAuth(c);
    if (user.role === 'admin') return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number }>();
    if (!project) return c.json({ detail: 'Data room not found' }, 404);
    return c.json(await investorEvidence(c.env, project.id, user.id));
  } catch (e) {
    if (e instanceof RaiseEvidenceError) return e.code === 'not_found' ? c.json({ detail: 'Data room not found' }, 404) : c.json({ code: e.code, detail: e.sentence }, e.status);
    return mapError(c, e);
  }
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
    if (user.role === 'admin') return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
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

/** The same detail read for the owner and a reasoned, audited support read. */
async function roomDetails(env: Env, project: ProjectRow, role: RoomRole | 'support' = 'owner') {
    const folders = await env.DB.prepare(
      `SELECT id, uid, name, parent_id, visibility, display_order
         FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name`,
    ).bind(project.id).all<any>();
    // `downloads` is counted from the log, per file. It is a download count
    // and never a view count — no per-file view is logged (header note).
    const files = await env.DB.prepare(
      `SELECT f.id, f.uid, f.name, f.folder_id, f.content_type, f.size_bytes, f.visibility, f.created_at,
              f.access_tier, f.access_expires_at, f.source_kind, f.source_ref,
              (SELECT COUNT(*) FROM data_room_access_log l
                WHERE l.file_id = f.id AND l.project_id = f.project_id AND l.action = 'download') AS downloads
         FROM data_room_files f WHERE f.project_id = ? ORDER BY f.name`,
    ).bind(project.id).all<any>();
    const grants = await env.DB.prepare(
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
              -- D1107: an NDA out for signature between the pair, so Access says "Waiting for signatures".
              EXISTS (
                SELECT 1 FROM pairwise_ndas n
                 WHERE n.party_a_user_id IN (SELECT owner.id FROM users owner WHERE owner.founder_id = p.founder_id)
                   AND n.party_b_user_id = g.investor_user_id
                   AND n.status = 'pending'
              ) AS nda_pending,
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
    const reportShares = await reportSharesOf(env, project.id);
    const access = await env.DB.prepare(
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
    const weekRows = await env.DB.prepare(
      `SELECT action, COUNT(*) AS n FROM data_room_access_log
        WHERE project_id = ? AND datetime(created_at) > datetime('now', '-7 days')
        GROUP BY action`,
    ).bind(project.id).all<{ action: string; n: number }>();
    const weekOf = (action: string) => {
      const hit = (weekRows.results || []).find((w) => w.action === action);
      return hit ? Number(hit.n) : 0;
    };

    const scopes = await grantScopesOf(env, project.id);

    const deckSourcesAvailable = await deckSourceReady(env);
    const deckFiles = deckSourcesAvailable ? await env.DB.prepare('SELECT * FROM data_room_files WHERE project_id = ?').bind(project.id).all<any>() : null;
    const states = new Map((deckFiles?.results || []).map(f => [f.uid, sourceState(f)]));
    return {
      deck_sources_available: deckSourcesAvailable,
      project: { uid: project.uid, name: project.name },
      // D1103 — what the caller may do here: `owner` shares and sets gates.
      role,
      folders: folders.results || [],
      files: (files.results || []).map(f => ({ ...f, ...(states.get(f.uid) || {}) })),
      grants: (grants.results || []).map(({ id, folders_scoped, ...g }) => ({
        ...g, nda_signed: !!g.nda_signed, nda_pending: !g.nda_signed && !!g.nda_pending,
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
    };
}

/** Admin reads load identifiers and aggregates only, never file or investor names. */
async function summaryProject(env: Env, uid: string) {
  return env.DB.prepare('SELECT id, uid, founder_id FROM projects WHERE uid = ? AND deleted_at IS NULL')
    .bind(uid).first<{ id: number; uid: string; founder_id: number | null }>();
}

async function summaryBlock(read: () => Promise<Record<string, unknown>>) {
  try { return { available: true, ...await read() }; }
  catch { return { available: false, reason: 'This part of the data room summary could not be read.' }; }
}
function countOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid summary count');
  return value;
}
/** Also the data-room card an admin reads on the Raise overview (`cycle_raise.ts`, D1102 part 2). */
export async function roomSummary(env: Env, project: { id: number; uid: string }) {
  const [files, folders, grants] = await Promise.all([
    summaryBlock(async () => {
      const result: { success?: boolean; results?: { visibility: string; checklist_item: string | null; n: number }[] } = await env.DB.prepare(
        'SELECT visibility, checklist_item, COUNT(*) AS n FROM data_room_files WHERE project_id = ? GROUP BY visibility, checklist_item',
      ).bind(project.id).all();
      if (result.success === false || !Array.isArray(result.results)) throw new Error('Summary unavailable');
      let total = 0, open = 0, nda = 0, matched = 0;
      const covered = new Set<string>();
      for (const row of result.results) {
        const n = countOf(row.n); total += n;
        if (row.visibility === 'open') open += n;
        if (row.visibility === 'nda') nda += n;
        if (row.checklist_item && CHECKLIST_KEYS.has(row.checklist_item)) { matched += n; covered.add(row.checklist_item); }
      }
      return { total, open, nda, other_gates: total - open - nda,
        coverage: { covered_items: covered.size, total_items: CHECKLIST_KEYS.size, matched_files: matched,
          definition: 'Recorded checklist tags; this does not claim an investor can open the files.' } };
    }),
    summaryBlock(async () => {
      const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM data_room_folders WHERE project_id = ?')
        .bind(project.id).first<{ total: number }>();
      return { total: countOf(row?.total) };
    }),
    summaryBlock(async () => {
      const result: { success?: boolean; results?: { bucket: string; n: number }[] } = await env.DB.prepare(
        `SELECT CASE
           WHEN status = 'active' AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) THEN 'active'
           WHEN status = 'active' AND datetime(expires_at) <= datetime('now') THEN 'expired'
           WHEN status = 'revoked' THEN 'revoked' ELSE 'unknown' END AS bucket, COUNT(*) AS n
         FROM data_room_grants WHERE project_id = ? GROUP BY bucket`,
      ).bind(project.id).all();
      if (result.success === false || !Array.isArray(result.results)) throw new Error('Summary unavailable');
      const counts = { total: 0, active: 0, expired: 0, revoked: 0, unknown: 0 };
      for (const row of result.results) {
        if (!['active', 'expired', 'revoked', 'unknown'].includes(row.bucket)) throw new Error('Summary unavailable');
        const n = countOf(row.n); counts.total += n; counts[row.bucket as 'active' | 'expired' | 'revoked' | 'unknown'] += n;
      }
      return counts;
    }),
  ]);
  const coverage = files.available && 'coverage' in files ? { available: true, ...files.coverage as Record<string, unknown> }
    : { available: false, reason: 'Checklist coverage could not be read.' };
  // Do not return checklist keys, file identifiers, contact details or activity rows.
  const { coverage: _coverage, ...fileCounts } = files as typeof files & { coverage?: unknown };
  return { mode: 'summary', read_only: true, project: { uid: project.uid }, files: fileCounts, folders, coverage, grants };
}

r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (user.role === 'admin') {
      await requireAdmin(c);
      const project = await summaryProject(c.env, c.req.param('projectUid'));
      if (!project) return c.json({ detail: 'Project not found' }, 404);
      return c.json(await roomSummary(c.env, project));
    }
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    return c.json(await roomDetails(c.env, room.project, room.role));
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/support-read', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 500) return refuse(c, 400, {
      code: 'support_reason_required', message: 'Give a support reason between 1 and 500 characters. The founder will see it.',
    });
    const project = await summaryProject(c.env, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const owners: { success?: boolean; results?: { id: number }[] } = await c.env.DB.prepare(
      "SELECT id FROM users WHERE founder_id = ? AND role = 'founder'",
    ).bind(project.founder_id).all();
    if (owners.success === false || !Array.isArray(owners.results)) throw new Error('Support owner unreadable');
    if (owners.results.length !== 1) return refuse(c, 409, {
      code: 'support_owner_unresolved', message: 'Support access cannot be recorded for this venture owner.',
    });
    const ownerId = Number(owners.results[0].id);
    // Fail closed: /activity is per-user, so this row belongs to the founder.
    // Its actor still names the admin. Record it BEFORE loading private detail.
    const audit = await c.env.DB.prepare(
      `INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor)
       VALUES (?, ?, 'raise.data-room', NULL, 'data_room_support_read', ?, ?)`,
    ).bind(project.id, ownerId, JSON.stringify({ admin_user_id: admin.id, reason, read_only: true }), `user:${admin.id}`).run();
    if (!audit.success || audit.meta.changes !== 1) throw new Error('Support audit unavailable');
    await logAdminAction(c.env, Number(admin.id), admin.email || '', 'data_room_support_read', {
      project_id: project.id, target_user_id: ownerId, reason, read_only: true,
    });
    const detail = await roomDetails(c.env, { ...project, name: '' }, 'support');
    // Fetching the name belongs to the audited detail read, not the summary.
    const named = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(project.id).first<{ name: string }>();
    return c.json({ ...detail, project: { uid: project.uid, name: named?.name ?? null }, mode: 'support', read_only: true });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Admin required')) return mapError(c, e);
    return refuse(c, 503, { code: 'support_read_unavailable', message: 'Support access could not be recorded or the room could not be read. Try again.' });
  }
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
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    const { project } = room;

    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);

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

    const { uid } = await storeDataRoomFile(c.env, {
      project, user, folderId, name, bytes, contentType: declaredMime,
      visibility: body.visibility ? String(body.visibility) : room.role === 'owner' ? 'nda' : folderVisibility,
      access: access.values,
    });
    return c.json({ uid, size_bytes: bytes.byteLength }, 201);
  } catch (e) { return mapError(c, e); }
});

/**
 * The upload's storage step: the storage guard, the object under a key the
 * Worker derives (`data-room/<project uid>/<uid>`, never taken from the
 * request), the `data_room_files` row, its log line and the storage notice.
 * The upload route calls it, and so does a Notion snapshot (D1089), so a file
 * reaches the room one way only. The caller has checked who may write and what
 * the gate is.
 */
export async function storeDataRoomFile(env: Env, a: {
  project: { id: number; uid: string }; user: { id: number; role: string }; folderId: number | null; name: string;
  bytes: Uint8Array; contentType: string; visibility: string;
  access: Partial<Record<'access_tier' | 'access_expires_at' | 'dd_request_id' | 'checklist_item', string | number | null>>;
}): Promise<{ id: number | null; uid: string }> {
  const { project, user, bytes } = a;
  if (!env.FILES) throw new WriterError(503, 'storage_not_configured');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new WriterError(413, 'too_large');
  // D1170 — a data room file counts to the venture's owner (D1169 §1).
  const storage = await assertStorageRoom(env, { projectId: project.id }, bytes.byteLength, user);
  const uid = newUid();
  const key = `data-room/${project.uid}/${uid}`;
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType: a.contentType },
    customMetadata: { project_uid: project.uid, uploaded_by: String(user.id) },
  });
  const ins = await env.DB.prepare(
    `INSERT INTO data_room_files
       (uid, project_id, folder_id, name, r2_key, content_type, size_bytes,
        visibility, uploaded_by_user_id, created_at, updated_at,
        access_tier, access_expires_at, dd_request_id, checklist_item)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, project.id, a.folderId, a.name.slice(0, NAME_MAX), key, a.contentType,
         bytes.byteLength, a.visibility, user.id, nowIso(), nowIso(),
         a.access.access_tier ?? 'invited', a.access.access_expires_at ?? null,
         a.access.dd_request_id ?? null, a.access.checklist_item ?? null).run();
  // D691 decision 12 — the file's record logs its upload. No file name: a
  // filename is itself information.
  const fileId = Number((ins as any)?.meta?.last_row_id) || null;
  if (fileId != null) {
    await logCycleWrite(env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: fileId, action: 'file_uploaded', summary: `File uploaded; access ${a.access.access_tier ?? 'invited'}` });
  }
  // D1248 — a file uploaded as a request's answer answers it.
  if (a.access.dd_request_id != null) await markRequestAnsweredByFile(env, Number(a.access.dd_request_id), Number(user.id));
  await noteStorageLanded(env, storage);
  return { id: fileId, uid };
}

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
  a: { project: { id: number; uid: string }; userId: number; fileId: number; bytes: Uint8Array; contentType: string | null; caller?: { id: number; role: string } | null },
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

  // D1170 — the kept version still counts, so the new object is weighed whole.
  const room = await assertStorageRoom(env, { projectId: project.id }, a.bytes.byteLength, a.caller ?? { id: a.userId, role: 'member' });
  // The key is derived, never taken from the request.
  const uid = newUid();
  const key = `data-room/${project.uid}/${uid}`;
  await env.FILES.put(key, a.bytes, {
    httpMetadata: { contentType },
    customMetadata: { project_uid: project.uid, uploaded_by: String(a.userId) },
  });
  const deckReady = await deckSourceReady(env);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(file.id, version, file.r2_key, file.content_type, file.size_bytes, file.uploaded_by_user_id),
    env.DB.prepare(
      `UPDATE data_room_files SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by_user_id = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    ).bind(key, contentType, a.bytes.byteLength, a.userId, nowIso(), file.id, project.id),
    ...(deckReady ? resetSourceStatements(env, file.id, project.id, key, null, a.userId) : []),
  ]);
  await logCycleWrite(env, { projectId: project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: file.id, action: 'file_replaced', summary: `File replaced; version ${version} kept` });
  await noteStorageLanded(env, room);
  return { id: file.id, version, size_bytes: a.bytes.byteLength };
}

/** D1602: an explicit owner opt-in; quotes never open the object. */
r.put('/:projectUid/files/:uid/deck-source', async (c) => {
  try {
    const user = await requireAuth(c);
    if (user.role === 'admin') return c.json({ code: 'support_read_required', detail: 'Use an audited support read.' }, 403);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    if (!await deckSourceReady(c.env)) return c.json({ code: 'deck_sources_unavailable', detail: 'Deck sources are not available yet.' }, 503);
    const file = await sourceFile(c.env, room.project.id, c.req.param('uid'));
    if (!file) return c.json({ detail: 'File not found' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') return c.json({ code: 'invalid_enabled', detail: 'Choose whether this file is a deck source.' }, 400);
    if (!body.enabled) {
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE data_room_files SET deck_source = 0, deck_source_token = NULL, deck_extract_state = NULL,
          deck_extract_started_at = NULL, deck_extract_queued_at = NULL, deck_source_as_of = NULL, deck_source_user_id = NULL, deck_source_quote = NULL WHERE id = ? AND project_id = ?`).bind(file.id, room.project.id),
        c.env.DB.prepare('DELETE FROM dataroom_deck_values WHERE project_id = ? AND file_uid = ?').bind(room.project.id, file.uid),
      ]);
    } else {
      if (!fileKind(file)) return c.json({ code: 'unsupported_file', detail: 'Use CSV, XLSX, PDF or DOCX.' }, 400);
      // A repeated save must not buy a second run. An unreadable extraction can be retried deliberately.
      if (file.deck_source && sourceState(file).extraction.state !== 'unreadable') return c.json(sourceState(file));
      let approved = null;
      if (typedFile(file)) {
        const quote = await sourceQuote(c.env, file, Number(user.id));
        if (!quote.ok) return c.json({ code: 'extraction_unavailable', detail: quote.error }, 503);
        if (body.confirm_quote !== quote.confirm_quote) return c.json({ code: 'quote_required', detail: 'Confirm the extraction cost before continuing.', quote }, 402);
        approved = { model: quote.model, hold_microusd: quote.hold_microusd };
      }
      if (!await enableSource(c.env, file, Number(user.id), approved)) return c.json({ code: 'version_conflict', detail: 'The file changed. Read it again before retrying.' }, 409);
    }
    await logCycleWrite(c.env, { projectId: room.project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: file.id, action: body.enabled ? 'deck_source_enabled' : 'deck_source_disabled', summary: body.enabled ? 'Deck source enabled' : 'Deck source withdrawn' });
    return c.json(sourceState((await sourceFile(c.env, room.project.id, file.uid))!));
  } catch (e) { return mapError(c, e); }
});

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
    // D1248 — a file matched to a request answers it.
    if (access.values.dd_request_id != null) await markRequestAnsweredByFile(c.env, Number(access.values.dd_request_id), Number(user.id));
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
  // Null for an object outside this venture's prefix: the route answers 404.
  if (!key.startsWith(`data-room/${project.uid}/`)) return null;
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
    const link = await founderLink(c.env, room.project, Number(user.id), file, file.r2_key, null);
    return link ? c.json(link) : c.json({ detail: 'File not found' }, 404);
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
    const link = await founderLink(c.env, room.project, Number(user.id), file, version.r2_key, n);
    return link ? c.json(link) : c.json({ detail: 'Version not found' }, 404);
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
    const deckReady = await deckSourceReady(c.env);
    // Tie invalidation to this successful swap, not another writer's identical target key.
    const swapToken = crypto.randomUUID();
    const fileSwap = deckReady ? c.env.DB.prepare(
      `UPDATE data_room_files SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by_user_id = ?, updated_at = ?, deck_source_token = ?
        WHERE id = ? AND project_id = ? AND r2_key = ?`,
    ).bind(version.r2_key, version.content_type, version.size_bytes, version.uploaded_by, at, swapToken, file.id, project.id, file.r2_key) : c.env.DB.prepare(
      `UPDATE data_room_files SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by_user_id = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND r2_key = ?`,
    ).bind(version.r2_key, version.content_type, version.size_bytes, version.uploaded_by, at, file.id, project.id, file.r2_key);
    const [toFile, toVersion] = await c.env.DB.batch([
      fileSwap,
      c.env.DB.prepare(
        `UPDATE data_room_file_versions SET r2_key = ?, content_type = ?, size_bytes = ?, uploaded_by = ?, updated_at = ?
          WHERE id = ? AND r2_key = ?
            AND EXISTS (SELECT 1 FROM data_room_files WHERE id = ? AND r2_key = ?)`,
      ).bind(file.r2_key, file.content_type, file.size_bytes, file.uploaded_by_user_id, at, version.id, version.r2_key, file.id, version.r2_key),
      ...(deckReady ? resetSourceStatements(c.env, file.id, project.id, version.r2_key, swapToken, Number(user.id)) : []),
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
  const deckReady = await deckSourceReady(env);
  await env.DB.batch([
    ...(deckReady ? [env.DB.prepare('DELETE FROM dataroom_deck_values WHERE project_id = ? AND file_uid IN (SELECT uid FROM data_room_files WHERE id = ?)').bind(project.id, file.id)] : []),
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
// ─────────────────────────────────────────────── activity and checklist (D1105)

/**
 * The room and the investor a query names, for the activity reads: the
 * owner's or a co-founder's room (404 otherwise, as every founder route), and
 * a grant uid of this venture (404 `unknown_investor` otherwise).
 */
async function activityTarget(c: any) {
  const user = await requireAuth(c);
  const room = await roomProject(c, user, c.req.param('projectUid'));
  if (!room) return { refused: c.json({ detail: 'Project not found' }, 404) };
  const parsed = parseActivityQuery((k) => c.req.query(k), nowIso().slice(0, 10));
  if (!parsed.ok) return { refused: c.json({ code: parsed.code, detail: parsed.detail }, 400) };
  let userId: number | null = null;
  if (parsed.q.investor) {
    const g = await investorOfGrant(c.env, room.project.id, parsed.q.investor);
    if (!g) return { refused: c.json({ code: 'unknown_investor', detail: 'This room has no such grant.' }, 404) };
    userId = Number(g.investor_user_id);
  }
  return { room, q: parsed.q, userId };
}

r.get('/:projectUid/activity', async (c) => {
  try {
    const t = await activityTarget(c);
    if ('refused' in t) return t.refused;
    return c.json(await activityRead(c.env, t.room.project.id, t.q, t.userId));
  } catch (e) { return mapError(c, e); }
});

r.get('/:projectUid/activity.csv', async (c) => {
  try {
    const t = await activityTarget(c);
    if ('refused' in t) return t.refused;
    const out = await activityCsv(c.env, t.room.project.id, t.q, t.userId);
    if ('tooMany' in out) {
      return refuse(c, 413, {
        code: 'too_many_rows',
        message: `This period holds ${out.tooMany} events, more than one file takes (${CSV_MAX_ROWS}). Choose a shorter period, an investor or an action.`,
        extra: { code: 'too_many_rows' },
      });
    }
    return new Response(out.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="data-room-activity-${t.q.from}-to-${t.q.to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/:projectUid/checklist', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    return c.json(await checklistRead(c.env, room.project.id));
  } catch (e) { return mapError(c, e); }
});

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
    // Checked before the address is looked up, so a refusal says nothing about who has an account.
    const fields = await grantFields(c.env, project.id, body);
    if ('refusal' in fields) return c.json({ detail: fields.refusal }, fields.status);
    // D1107 (DR7): Share picks one of this venture's own prospects, named by its uid; the
    // address is read here, never taken from the page. Another venture's prospect is 404.
    let email = String(body.email || '').trim().toLowerCase();
    if (body.prospect !== undefined) {
      const uid = typeof body.prospect === 'string' && body.prospect.length > 0 && body.prospect.length <= 64 ? body.prospect : null;
      const prospect = uid ? await c.env.DB.prepare('SELECT email FROM raise_prospects WHERE uid = ? AND project_id = ?')
        .bind(uid, project.id).first<{ email: string | null }>() : null;
      if (!prospect) return c.json({ detail: 'Investor not found in Capital relationships' }, 404);
      email = String(prospect.email || '').trim().toLowerCase();
      if (!email) return c.json({ detail: 'This investor has no email in Capital relationships. Add one there to share the room.', code: 'no_email' }, 400);
    }
    if (!email) return c.json({ detail: 'email is required' }, 400);

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

/**
 * D1107 (DR7) — whom Share offers: this venture's prospects in Capital
 * relationships (#2457), each with its stage and whether an email is on file.
 * The owner's only, as sharing is. Whether an address has a StudioOS account
 * is never said, as `POST /grants` never says it.
 */
r.get('/:projectUid/share-candidates', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const rows = (await c.env.DB.prepare(
      `SELECT uid, name, firm, stage, email FROM raise_prospects
        WHERE project_id = ? ORDER BY COALESCE(firm, name, email), id LIMIT 500`,
    ).bind(room.project.id).all<{ uid: string; name: string | null; firm: string | null; stage: string | null; email: string | null }>()).results || [];
    return c.json({
      candidates: rows.map((r) => ({
        uid: r.uid, name: r.name ?? null, firm: r.firm ?? null, stage: r.stage ?? null,
        email: r.email ? String(r.email).trim() || null : null,
      })),
    });
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

/* ------------------------------------------------------------------ *
 * D1104 — the access-request queue, and the founder's NDA
 * ------------------------------------------------------------------ */

const REQUESTS_UNREADABLE = { detail: 'The access requests could not be read. This is not a claim that nobody asked; try again in a moment.', code: 'requests_unreadable' } as const;
const REQUEST_DECIDED = { detail: 'This request has already been answered.', code: 'request_decided' } as const;

/** The owner and co-founders read the queue; anyone else gets 404, as for the room. */
r.get('/:projectUid/requests', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    let requests;
    try { requests = await readRequests(c.env, room.project.id); }
    catch (e) {
      console.warn('[data_room] access requests unreadable:', (e as Error)?.message);
      return c.json(REQUESTS_UNREADABLE, 503);
    }
    // D1107 (DR9): the venture's diligence requests and the files matched to each. Its own block:
    // a failure here never blanks the access requests.
    let diligence: unknown[] | null = null;
    try { diligence = await diligenceOf(c.env, room.project.id); }
    catch (e) { console.warn('[data_room] diligence requests unreadable:', (e as Error)?.message); }
    return c.json({ requests, open: requests.filter((q) => q.state === 'open').length, can_answer: room.role === 'owner',
      diligence, ...(diligence === null ? { diligence_unreadable: true } : {}) });
  } catch (e) { return mapError(c, e); }
});

/**
 * D1107 — this venture's diligence requests (`dd_requests` on its project
 * case), newest first, each with the room's files matched to it. Only the
 * founder-visible columns: the title, the state and its dates (migration 167's
 * invariant). No case internals, no reviewer.
 */
async function diligenceOf(env: Env, projectId: number) {
  const reqs = (await env.DB.prepare(
    `SELECT r.id, r.title, r.state, r.due_date, r.created_at, r.responded_at, r.reviewed_at
       FROM dd_requests r JOIN dd_cases k ON k.id = r.case_id
      WHERE k.subject_type = 'project' AND k.subject_id = ? AND r.withdrawn_at IS NULL
      ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
  ).bind(projectId).all<{ id: number; title: string; state: string | null; due_date: string | null; created_at: string; responded_at: string | null; reviewed_at: string | null }>()).results || [];
  const files = (await env.DB.prepare(
    'SELECT uid, name, dd_request_id FROM data_room_files WHERE project_id = ? AND dd_request_id IS NOT NULL ORDER BY name',
  ).bind(projectId).all<{ uid: string; name: string; dd_request_id: number }>()).results || [];
  return reqs.map((r) => ({
    id: Number(r.id), title: r.title, state: r.state || 'requested', due_date: r.due_date ?? null, created_at: r.created_at,
    responded_at: r.responded_at ?? null, reviewed_at: r.reviewed_at ?? null,
    files: files.filter((f) => Number(f.dd_request_id) === Number(r.id)).map((f) => ({ uid: f.uid, name: f.name })),
  }));
}

/** The request this route names, on this venture; null when there is none. */
async function requestOf(env: Env, projectId: number, uid: string) {
  return env.DB.prepare(
    'SELECT id, uid, investor_user_id, state FROM data_room_access_requests WHERE uid = ? AND project_id = ?',
  ).bind(uid, projectId).first<{ id: number; uid: string; investor_user_id: number; state: string }>();
}

/**
 * Accept: the request is claimed first (open → accepted, by this owner, at
 * this instant), so two presses or a decline in between can never both win;
 * then the grant is written as `POST /grants` writes it. If the grant write
 * fails, the claim is put back and nothing is granted.
 */
r.post('/:projectUid/requests/:uid/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const { project } = room;
    const body = await c.req.json().catch(() => ({} as any));
    const fields = await grantFields(c.env, project.id, body);
    if ('refusal' in fields) return c.json({ detail: fields.refusal }, fields.status);
    const found = await requestOf(c.env, project.id, c.req.param('uid'));
    if (!found) return c.json({ detail: 'Request not found' }, 404);

    // The claim is the check: only an open request moves, so a decided one answers 409.
    const at = nowIso();
    const claimed = await c.env.DB.prepare(
      `UPDATE data_room_access_requests SET state = 'accepted', decided_by = ?, decided_at = ?
        WHERE id = ? AND state = 'open'`,
    ).bind(user.id, at, found.id).run();
    if (Number((claimed as any).meta?.changes) !== 1) return c.json(REQUEST_DECIDED, 409);

    const investorId = Number(found.investor_user_id);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO data_room_grants
             (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
           ON CONFLICT (project_id, investor_user_id) DO UPDATE SET
             status = 'active', granted_by_user_id = excluded.granted_by_user_id,
             expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
        ).bind(newUid(), project.id, investorId, user.id, fields.values.expires_at ?? null, at, at),
        ...(fields.values.folders !== undefined ? scopeStatements(c.env, 'investor', [project.id, investorId], fields.values.folders) : []),
      ]);
    } catch (e) {
      await c.env.DB.prepare(
        `UPDATE data_room_access_requests SET state = 'open', decided_by = NULL, decided_at = NULL
          WHERE id = ? AND state = 'accepted' AND decided_by = ? AND decided_at = ?`,
      ).bind(found.id, user.id, at).run().catch(() => {});
      throw e;
    }
    await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: found.id, action: 'access_request_accepted', summary: 'Access request accepted; the room was shared' });
    await tellInvestor(c.env, investorId, 'Your data room request was accepted',
      `${project.name || 'The venture'} opened its data room to you.`, '/research/diligence');
    return c.json({ ok: true, state: 'accepted' });
  } catch (e) { return mapError(c, e); }
});

/** Decline: a reason of 1 to 500 characters, kept on the request and told to the investor; never logged. */
r.post('/:projectUid/requests/:uid/decline', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const { project } = room;
    const body = await c.req.json().catch(() => ({} as any));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > DECLINE_REASON_MAX) {
      return c.json({ detail: `Say why, in 1 to ${DECLINE_REASON_MAX} characters. The investor is told.`, code: 'reason_required' }, 400);
    }
    const found = await requestOf(c.env, project.id, c.req.param('uid'));
    if (!found) return c.json({ detail: 'Request not found' }, 404);
    const res = await c.env.DB.prepare(
      `UPDATE data_room_access_requests SET state = 'declined', decided_by = ?, decided_at = ?, decline_reason = ?
        WHERE id = ? AND state = 'open'`,
    ).bind(user.id, nowIso(), reason, found.id).run();
    if (Number((res as any).meta?.changes) !== 1) return c.json(REQUEST_DECIDED, 409);
    await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: found.id, action: 'access_request_declined', summary: 'Access request declined' });
    await tellInvestor(c.env, Number(found.investor_user_id), 'Your data room request was declined',
      `${project.name || 'The venture'} declined your request to see its data room: ${reason}`, null);
    return c.json({ ok: true, state: 'declined' });
  } catch (e) { return mapError(c, e); }
});

/** The investor's inbox line. Best effort: the decision is recorded whether or not the note lands. */
async function tellInvestor(env: Env, userId: number, title: string, body: string, link: string | null) {
  try {
    const { notify } = await import('../services/notify');
    await notify(env, { userId, type: 'data_room_request', title, body, link, category: 'deals' });
  } catch (e) {
    console.warn('[data_room] request notice not sent:', (e as Error)?.message);
  }
}

/**
 * The founder sends the platform's three-way NDA for a grant (owner question
 * 4, answer A). Only the venture's founder — party A of `pairwise_ndas`, as
 * migration 025 fixes it — may send it, and only for a live grant of this
 * venture. Refused when the NDA is already live, or already out for
 * signature (a second envelope would replace the first's record mid-signing).
 * The founder gets only their own signing link back; the others are emailed.
 */
r.post('/:projectUid/grants/:uid/nda', async (c) => {
  try {
    const user = await requireAuth(c);
    const room = await roomProject(c, user, c.req.param('projectUid'));
    if (!room) return c.json({ detail: 'Project not found' }, 404);
    if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);
    const { project } = room;
    const founder = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name FROM projects p JOIN users u ON u.founder_id = p.founder_id
        WHERE p.id = ? AND u.id = ? AND u.role = 'founder'`,
    ).bind(project.id, user.id).first<{ id: number; email: string; name: string | null }>();
    if (!founder) return c.json({ detail: 'Only the venture’s founder can send the NDA: they sign it as party A.', code: 'founder_only' }, 403);
    const grant = await c.env.DB.prepare(
      `SELECT g.investor_user_id, u.email, u.name FROM data_room_grants g JOIN users u ON u.id = g.investor_user_id
        WHERE g.uid = ? AND g.project_id = ? AND g.status = 'active'
          AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))`,
    ).bind(c.req.param('uid'), project.id).first<{ investor_user_id: number; email: string; name: string | null }>();
    if (!grant) return c.json({ detail: 'Grant not found' }, 404);
    const investorId = Number(grant.investor_user_id);
    const existing = await c.env.DB.prepare(
      `SELECT status, valid_until FROM pairwise_ndas WHERE party_a_user_id = ? AND party_b_user_id = ?`,
    ).bind(founder.id, investorId).first<{ status: string; valid_until: string | null }>();
    if (await projectNdaActive(c.env, project.id, investorId) || await ndaActive(c.env, founder.id, investorId)) {
      return c.json({ detail: 'An NDA with this investor is already in force. Nothing was sent.', code: 'nda_active' }, 409);
    }
    if (existing?.status === 'pending') {
      return c.json({ detail: 'An NDA with this investor is already out for signature. Nothing was sent.', code: 'nda_pending' }, 409);
    }

    const { createThreeWayNdaEnvelope } = await import('../services/trustEnvelope');
    const { upsertPairwiseNda } = await import('../services/trust');
    let envelope;
    try {
      envelope = await createThreeWayNdaEnvelope(c.env, {
        founder: { user_id: founder.id, email: founder.email, name: founder.name || founder.email },
        investor: { user_id: investorId, email: grant.email, name: grant.name || grant.email },
        appUrl: (c.env as any).APP_URL || 'https://axal.vc',
      });
    } catch (e) {
      if ((e as Error)?.message === 'unfilled_fields') {
        return c.json({ detail: 'The NDA is not ready to send yet: Axal VC still has to complete it. Nothing was sent.', code: 'template_fields_unfilled' }, 409);
      }
      console.error('[data_room] NDA envelope not created:', (e as Error)?.name || 'error');
      return c.json({ detail: 'The NDA could not be sent for signature. Nothing was sent; try again in a moment.', code: 'envelope_creation_failed' }, 502);
    }
    await upsertPairwiseNda(c.env, founder.id, investorId, envelope.envelope_uuid);
    await logCycleWrite(c.env, { projectId: project.id, userId: Number(user.id), cycle: 'raise', module: 'data-room',
      entityId: null, action: 'nda_sent', summary: 'Three-way NDA sent to a grant holder' });
    try {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: investorId, type: 'contract_sign_request', category: 'contract_sign_request', link: '/trust',
        title: 'An NDA to sign', body: `${founder.name || 'A founder'} sent you the three-way NDA for ${project.name || 'their data room'}. Sign it in your Trust Center.`,
        payload: { envelope_uuid: envelope.envelope_uuid, founder_user_id: founder.id },
      });
    } catch (e) { console.warn('[data_room] NDA notice not sent:', (e as Error)?.message); }
    return c.json({ status: 'envelope_issued', envelope_uuid: envelope.envelope_uuid, signing_url: envelope.signing_urls.founder }, 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
