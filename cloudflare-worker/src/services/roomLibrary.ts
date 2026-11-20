/**
 * D6869 (#6869, the build of the #6283 brief): a data-room file in an investor's Library is a live reference that
 * follows the grant, not a copy (owner answer Q1 = A). This module holds the one rule for whether a reference still
 * reaches its file, and the reconcile that applies it.
 *
 * A REFERENCE IS LIVE while, all at once:
 *   - the room's founder has the per-room switch on (`data_room_library_settings`, off by default, Q2);
 *   - the investor's grant is active and unexpired (`activeGrant`'s rule);
 *   - the file still exists in the room;
 *   - `tierAdmits` still admits it to that grant (its tier, its expiry, the grant's folders);
 *   - and, for a file behind the NDA, the NDA is still active.
 * The first rule that fails names the reason the row then reads (Q3): `library_off`, `revoked`, `expired`, `removed`,
 * `moved` or `nda_lapsed`. A lapsed row stays, and its index entries are deleted at once, so Ask stops citing it.
 *
 * THE FILE IS FOLLOWED. A founder who replaces the file gives it a new `r2_key`; a live reference takes the new key
 * and is indexed again, so the Library reads what the room holds today.
 *
 * Every investor read of the Library and every Ask runs `reconcileRoomRefs` first, so a reference never answers past
 * the moment its grant stopped reaching the file, whether or not anything else ran in between.
 */
import type { Env } from '../types';
import { tierAdmits, investorCommitted, grantFolderScope } from './dataRoomAccess';
import { hasActiveVentureNda } from './dealAccess';
import { deleteChunkedEntity } from './vectorize';
import { liveFiles } from './dataRoomTrash';
import { Jobs } from '../models/jobs';

export const LOST_REASONS = ['revoked', 'expired', 'nda_lapsed', 'removed', 'moved', 'library_off'] as const;
export type LostReason = typeof LOST_REASONS[number];

export type RefRow = {
  ref_id: number; document_id: number; owner_user_id: number; project_id: number; file_id: number; grant_id: number;
  r2_key: string; chunk_count: number | null; index_state: string;
};

/** Whether the founder lets granted investors add this room's files to their Library. A room with no row is off. */
export async function libraryAllowed(env: Env, projectId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT allow_library FROM data_room_library_settings WHERE project_id = ?')
    .bind(projectId).first<{ allow_library: number }>();
  return Number(row?.allow_library) === 1;
}

/**
 * The reason a grant no longer reaches a file, or null while it does. `grantId` is the grant the reference was added
 * under; a new grant to the same investor after a revoke is a new door, and the old reference stays lapsed.
 */
export async function roomFileLapse(
  env: Env, a: { projectId: number; userId: number; grantId: number; fileId: number },
): Promise<{ reason: LostReason } | { reason: null; file: { id: number; r2_key: string; name: string; content_type: string | null } }> {
  if (!(await libraryAllowed(env, a.projectId))) return { reason: 'library_off' };
  const grant = await env.DB.prepare(
    `SELECT id, status, expires_at,
            CASE WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') THEN 1 ELSE 0 END AS past
       FROM data_room_grants WHERE id = ? AND project_id = ? AND investor_user_id = ?`,
  ).bind(a.grantId, a.projectId, a.userId).first<{ id: number; status: string; expires_at: string | null; past: number }>();
  if (!grant || grant.status !== 'active') return { reason: 'revoked' };
  if (Number(grant.past) === 1) return { reason: 'expired' };
  const file = await env.DB.prepare(
    `SELECT id, name, r2_key, content_type, visibility, access_tier, access_expires_at, folder_id
       FROM data_room_files WHERE id = ? AND project_id = ?${await liveFiles(env.DB)}`,
  ).bind(a.fileId, a.projectId).first<any>();
  // D6073: a file in Trash is gone from the room for investors, so its reference lapses as removed.
  if (!file) return { reason: 'removed' };
  if (!tierAdmits(file, await investorCommitted(env, a.projectId, a.userId), Date.now(), await grantFolderScope(env, grant.id))) {
    return { reason: 'moved' };
  }
  if (file.visibility === 'nda' && !(await hasActiveVentureNda(env, a.projectId, a.userId))) return { reason: 'nda_lapsed' };
  return { reason: null, file: { id: Number(file.id), r2_key: file.r2_key, name: file.name, content_type: file.content_type ?? null } };
}

/** Lapse one reference: its index entries first (so the text is never answerable after), then the row's state. */
export async function lapseRef(env: Env, ref: RefRow, reason: LostReason, now: string): Promise<void> {
  await deleteChunkedEntity(env, 'research_doc', ref.document_id, ref.chunk_count);
  await env.DB.batch([
    env.DB.prepare('UPDATE research_room_refs SET lost_at = ?, lost_reason = ? WHERE id = ? AND lost_at IS NULL').bind(now, reason, ref.ref_id),
    env.DB.prepare(
      `UPDATE research_documents SET index_state = 'source_lost', index_note = ?, chunk_count = NULL, updated_at = ? WHERE id = ?`,
    ).bind(reason, now, ref.document_id),
  ]);
}

const LIVE_REFS = `SELECT r.id AS ref_id, r.document_id, r.owner_user_id, r.project_id, r.file_id, r.grant_id,
                          d.r2_key, d.chunk_count, d.index_state
                     FROM research_room_refs r JOIN research_documents d ON d.id = r.document_id
                    WHERE r.owner_user_id = ? AND r.lost_at IS NULL`;

/**
 * Apply the rule to every live reference one investor holds. Returns how many lapsed. A failure to read one
 * reference's room leaves it as it was and is loud in the tail: the next read tries again.
 */
export async function reconcileRoomRefs(env: Env, userId: number): Promise<number> {
  const refs = ((await env.DB.prepare(LIVE_REFS).bind(userId).all<RefRow>()).results || []);
  let lapsed = 0;
  const now = new Date().toISOString();
  for (const ref of refs) {
    try {
      const out = await roomFileLapse(env, { projectId: ref.project_id, userId: ref.owner_user_id, grantId: ref.grant_id, fileId: ref.file_id });
      if (out.reason) { await lapseRef(env, ref, out.reason, now); lapsed += 1; continue; }
      if (out.file.r2_key !== ref.r2_key) {
        // The founder replaced the file: follow it, and index what the room holds now.
        await deleteChunkedEntity(env, 'research_doc', ref.document_id, ref.chunk_count);
        await env.DB.prepare(
          `UPDATE research_documents SET r2_key = ?, content_type = ?, index_state = 'pending', index_note = NULL, chunk_count = NULL, updated_at = ? WHERE id = ?`,
        ).bind(out.file.r2_key, out.file.content_type, now, ref.document_id).run();
        try { await Jobs.enqueue(env, 'embed_entity', { type: 'research_doc', id: ref.document_id }); } catch { /* #5350's sweep re-queues a pending row */ }
      }
    } catch (e) {
      console.error('[roomLibrary] reconcile failed for a reference', (e as Error)?.message);
    }
  }
  return lapsed;
}

/** Lapse every live reference to one room at once: the founder turned the switch off. */
export async function lapseRoom(env: Env, projectId: number, reason: LostReason): Promise<number> {
  const refs = ((await env.DB.prepare(
    `SELECT r.id AS ref_id, r.document_id, r.owner_user_id, r.project_id, r.file_id, r.grant_id, d.r2_key, d.chunk_count, d.index_state
       FROM research_room_refs r JOIN research_documents d ON d.id = r.document_id
      WHERE r.project_id = ? AND r.lost_at IS NULL`,
  ).bind(projectId).all<RefRow>()).results || []);
  const now = new Date().toISOString();
  for (const ref of refs) await lapseRef(env, ref, reason, now);
  return refs.length;
}

/** The room reference behind one Library document, or null when it is the investor's own upload. */
export async function refOfDocument(env: Env, documentId: number) {
  return env.DB.prepare(
    `SELECT r.id, r.project_id, r.file_id, r.grant_id, r.added_at, r.lost_at, r.lost_reason, p.uid AS project_uid, p.name AS project_name
       FROM research_room_refs r LEFT JOIN projects p ON p.id = r.project_id WHERE r.document_id = ?`,
  ).bind(documentId).first<any>();
}

/** Whether a room still holds the file a removed reference pointed at, so its activity row can name it. */
export async function roomFileStillThere(env: Env, fileId: number, projectId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?').bind(fileId, projectId).first();
  return Boolean(row);
}
