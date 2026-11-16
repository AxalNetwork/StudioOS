/**
 * D6869 (#6869, the build of the #6283 brief): Add to my Library from a data room, and the founder's per-room switch.
 * Mounted at /api/room-library. Store: `research_room_refs` and `data_room_library_settings` (migration
 * 202611161204_6869); the rule for whether a reference still reaches its file is `services/roomLibrary.ts`.
 *
 * Who does what:
 *   GET    /rooms/:projectUid    an investor with an active grant on the room: whether the founder allows Library
 *                                copies, and which of the room's files are in the caller's Library (live ones).
 *                                No grant, or no such room, answers alike (404 `room_not_found`).
 *   POST   /items                { project_uid, file_uid }: an investor adds a file they can open to their Library.
 *                                The room's own gate decides, re-checked here: the grant, the file's tier and folder,
 *                                and the NDA for a file behind it. The founder's switch must be on. The Library row is
 *                                the investor's own, read only, kind `diligence`, its `r2_key` the room file's; it is
 *                                indexed in the investor's namespace and its size is not counted against their storage
 *                                (Q4: indexing is not charged). The room's activity logs `library_add`.
 *   DELETE /items/:documentUid   the investor removes it: index entries first, then the row; the room's file is never
 *                                touched. The room's activity logs `library_remove` while the room still exists.
 *   GET    /settings/:projectUid the room's founder or a cofounder: the switch and how many live references it holds.
 *   PUT    /settings/:projectUid { allow_library }: the owner only. Turning it off lapses every live reference to the
 *                                room at once (`library_off`), deleting their index entries.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { activeGrant, logAccess, projectNdaActive, roomProject } from './data_room';
import { tierAdmits, investorCommitted, grantFolderScope } from '../services/dataRoomAccess';
import { libraryAllowed, lapseRoom, reconcileRoomRefs } from '../services/roomLibrary';
import { deleteChunkedEntity } from '../services/vectorize';
import { Jobs } from '../models/jobs';
import { isSupportSession } from '../services/fundAdminAccess';

const r = new Hono<{ Bindings: Env }>();

const ROOM_NOT_FOUND = { code: 'room_not_found', message: 'No data room you can open has that name.' };
const FILE_NOT_FOUND = { code: 'file_not_found', message: 'That file is not one your access opens.' };

async function grantedRoom(env: Env, projectUid: string, userId: number) {
  const project = await env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
    .bind(projectUid).first<{ id: number; uid: string; name: string }>();
  const grant = project ? await activeGrant(env, project.id, userId) : null;
  return project && grant ? { project, grant } : null;
}

/** The caller's own room reference by its Library document uid, or null: another investor's answers as not there. */
async function requireRefOwner(env: Env, documentUid: string, userId: number) {
  return env.DB.prepare(
    `SELECT d.id, d.chunk_count, r.id AS ref_id, r.project_id, r.file_id, r.lost_at
       FROM research_documents d JOIN research_room_refs r ON r.document_id = d.id
      WHERE d.uid = ? AND d.owner_user_id = ?`,
  ).bind(documentUid, userId).first<any>();
}

// GET /api/room-library/rooms/:projectUid — the caller's Library state for one room.
r.get('/rooms/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    c.header('Cache-Control', 'no-store');
    if (user.role === 'admin') return refuse(c, 404, ROOM_NOT_FOUND);
    const room = await grantedRoom(c.env, c.req.param('projectUid'), user.id);
    if (!room) return refuse(c, 404, ROOM_NOT_FOUND);
    await reconcileRoomRefs(c.env, user.id);
    const rows = await c.env.DB.prepare(
      `SELECT f.uid AS file_uid, d.uid AS document_uid, r.added_at
         FROM research_room_refs r JOIN research_documents d ON d.id = r.document_id JOIN data_room_files f ON f.id = r.file_id
        WHERE r.owner_user_id = ? AND r.project_id = ? AND r.lost_at IS NULL ORDER BY r.added_at DESC`,
    ).bind(user.id, room.project.id).all<any>();
    return c.json({ allowed: await libraryAllowed(c.env, room.project.id), items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// POST /api/room-library/items — { project_uid, file_uid }
r.post('/items', async (c) => {
  try {
    const user = await requireAuth(c);
    if (user.role === 'admin') return refuse(c, 403, { code: 'investor_only', message: 'Only an investor with access to the room adds its files to their Library.' });
    if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session', message: 'A support session cannot add to someone’s Library.' });
    const body = await c.req.json().catch(() => ({} as any));
    const room = await grantedRoom(c.env, String(body?.project_uid ?? ''), user.id);
    if (!room) return refuse(c, 404, ROOM_NOT_FOUND);
    if (!(await libraryAllowed(c.env, room.project.id))) {
      return refuse(c, 403, { code: 'library_off', message: 'The founder does not let investors add this room’s files to their Library.' });
    }
    const file = await c.env.DB.prepare(
      `SELECT id, uid, name, r2_key, content_type, visibility, access_tier, access_expires_at, folder_id
         FROM data_room_files WHERE uid = ? AND project_id = ?`,
    ).bind(String(body?.file_uid ?? ''), room.project.id).first<any>();
    // The room's own rule, re-checked here: a file its tier, expiry or folders hide answers as one that is not there.
    if (!file || !tierAdmits(file, await investorCommitted(c.env, room.project.id, user.id), Date.now(), await grantFolderScope(c.env, room.grant.id))) {
      return refuse(c, 404, FILE_NOT_FOUND);
    }
    if (file.visibility === 'nda' && !(await projectNdaActive(c.env, room.project.id, user.id))) {
      await logAccess(c.env, room.project.id, user.id, 'blocked', file.id);
      return refuse(c, 403, { code: 'nda_required', message: 'This file is behind the NDA. Sign it in the room first.' });
    }
    const existing = await c.env.DB.prepare(
      `SELECT d.uid FROM research_room_refs r JOIN research_documents d ON d.id = r.document_id
        WHERE r.owner_user_id = ? AND r.file_id = ? AND r.lost_at IS NULL`,
    ).bind(user.id, file.id).first<{ uid: string }>();
    if (existing) return refuse(c, 409, { code: 'already_added', message: 'This file is already in your Library.', extra: { document_uid: existing.uid } });

    const uid = newUid();
    const now = nowIso();
    const title = String(file.name || 'Data-room file').replace(/\.[^.]+$/, '').slice(0, 200) || 'Data-room file';
    // `size_bytes` stays NULL: the bytes are the room's, not the investor's, so they count against no one's storage.
    const ins = await c.env.DB.prepare(
      `INSERT INTO research_documents (uid, owner_user_id, title, kind, r2_key, content_type, size_bytes, index_state, created_at, updated_at)
       VALUES (?, ?, ?, 'diligence', ?, ?, NULL, 'pending', ?, ?)`,
    ).bind(uid, user.id, title, file.r2_key, file.content_type ?? null, now, now).run();
    const documentId = Number((ins as any).meta?.last_row_id);
    try {
      await c.env.DB.prepare(
        `INSERT INTO research_room_refs (document_id, owner_user_id, project_id, file_id, grant_id, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(documentId, user.id, room.project.id, file.id, room.grant.id, now).run();
    } catch (e) {
      // Two adds at once: the partial unique index keeps one; the second row goes.
      await c.env.DB.prepare('DELETE FROM research_documents WHERE id = ?').bind(documentId).run();
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message || ''))) {
        return refuse(c, 409, { code: 'already_added', message: 'This file is already in your Library.' });
      }
      throw e;
    }
    try { await Jobs.enqueue(c.env, 'embed_entity', { type: 'research_doc', id: documentId }); } catch { /* #5350's sweep re-queues a pending row */ }
    await logAccess(c.env, room.project.id, user.id, 'library_add', file.id);
    return c.json({ document_uid: uid, file_uid: file.uid, title, index_state: 'pending', added_at: now }, 201);
  } catch (e) { return mapError(c, e); }
});

// DELETE /api/room-library/items/:documentUid — the investor removes a room file from their Library.
r.delete('/items/:documentUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const row = await requireRefOwner(c.env, c.req.param('documentUid'), user.id);
    if (!row) return refuse(c, 404, { code: 'not_found', message: 'That file is not in your Library.' });
    // Index entries first, so the text is never answerable after the row is gone; the room's file is not touched.
    await deleteChunkedEntity(c.env, 'research_doc', Number(row.id), row.chunk_count);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM research_room_refs WHERE id = ?').bind(row.ref_id),
      c.env.DB.prepare('DELETE FROM research_documents WHERE id = ?').bind(row.id),
    ]);
    const stillThere = await c.env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?').bind(row.file_id, row.project_id).first();
    await logAccess(c.env, Number(row.project_id), user.id, 'library_remove', stillThere ? Number(row.file_id) : null);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// GET /api/room-library/settings/:projectUid — the founder's switch.
r.get('/settings/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const access = await roomProject(c, user, c.req.param('projectUid'));
    if (!access) return refuse(c, 404, ROOM_NOT_FOUND);
    const live = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM research_room_refs WHERE project_id = ? AND lost_at IS NULL')
      .bind(access.project.id).first<{ n: number }>();
    return c.json({ allow_library: await libraryAllowed(c.env, access.project.id), live_references: Number(live?.n) || 0, can_change: access.role === 'owner' });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/room-library/settings/:projectUid — { allow_library: boolean }, the room's owner only.
r.put('/settings/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const access = await roomProject(c, user, c.req.param('projectUid'));
    if (!access) return refuse(c, 404, ROOM_NOT_FOUND);
    if (access.role !== 'owner') return refuse(c, 403, { code: 'owner_only', message: 'Only the room’s owner can do this.' });
    const body = await c.req.json().catch(() => ({} as any));
    if (typeof body?.allow_library !== 'boolean') return refuse(c, 400, { code: 'bad_allow_library', message: 'Say whether the switch is on or off.' });
    await c.env.DB.prepare(
      `INSERT INTO data_room_library_settings (project_id, allow_library, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET allow_library = excluded.allow_library, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(access.project.id, body.allow_library ? 1 : 0, user.id, nowIso()).run();
    const lapsed = body.allow_library ? 0 : await lapseRoom(c.env, access.project.id, 'library_off');
    return c.json({ allow_library: body.allow_library, lapsed });
  } catch (e) { return mapError(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/room-library', router: r };
