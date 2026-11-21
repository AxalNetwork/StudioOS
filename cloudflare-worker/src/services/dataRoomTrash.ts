/**
 * D6073 (#6073) — the data room's 30-day Trash: Remove, the Trash read,
 * Restore, Delete now and the purge, over `data_room_files.removed_at`
 * (migration 202611152333_6073).
 *
 * REMOVE is a stamp. The row keeps its folder, gate (visibility, tier, end
 * date), checklist and request match and every version, so Restore is one
 * UPDATE. Every read an investor, an advisor or a count makes leaves a stamped
 * row out through `liveFiles` (a WHERE clause) and `tierAdmits` (a row read
 * with `SELECT *` that carries `removed_at`), so the file is gone from them the
 * moment the stamp lands.
 *
 * RESTORE brings the row back as it was. A folder deleted while the file
 * waited (`folder_id` NULL, or naming a folder that no longer exists) puts the
 * file at the top level, and the answer says so (`returned_to_top_level`).
 *
 * THE PURGE (Delete now, and the daily sweep thirty days after `removed_at`)
 * deletes the stored objects FIRST, then the rows. A failed object delete
 * leaves the row in Trash for the next sweep; deleting an object twice is a
 * no-op, so a purge interrupted anywhere is safe to run again. A copy a
 * connector delivered (Google Drive, Mercury) keeps its ledger row in
 * `connector_fed_items` with no `local_id` (D1094 "deleted stays deleted"), so a
 * re-sync never copies it again. While a Drive copy is in Trash its ledger
 * still names it, and `services/google/raise.ts` leaves it alone.
 *
 * WHO. The owner and an accepted co-founder read Trash and restore
 * (`restore`, D6071 owner question 4 option A, as #6073's acceptance states);
 * only the owner removes and deletes now (`delete`, D1103).
 */
import type { Env } from '../types';
import { logCycleWrite } from './cycleActivity';
import { forgetFile } from './dataRoomSearch';
import { bindingKey } from '../util/schemaBootstrap';
import { eraseRecordObjects } from './recordErasure';

export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;
export const SWEEP_BATCH = 200;

type Db = Env['DB'];

/* ------------------------------------------------------------------ *
 * Is the column there? (pre-migration fixtures and an old deploy)      *
 * ------------------------------------------------------------------ */

const ready = new WeakMap<object, true>();
const missing = (e: unknown) => /no such (?:table|column)|has no column named/i.test(String(e));

/**
 * True once `data_room_files.removed_at` exists. Only a missing column reads as
 * false: no file can be in Trash without it, so there is nothing to leave out.
 * Any other failure throws, so an unreadable store never drops the filter.
 */
export async function trashReady(db: Db): Promise<boolean> {
  // Per D1 binding (GOTCHAS § "Schema readiness is per binding"): only a present column is remembered.
  const env = { DB: db } as Env;
  const key = bindingKey(env);
  if (ready.has(key)) return true;
  try {
    await db.prepare('SELECT removed_at, removed_by_user_id, removed_folder_name FROM data_room_files LIMIT 0').all();
    ready.set(key, true);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}

const LIVE_BARE = ' AND removed_at IS NULL';
const LIVE_F = ' AND f.removed_at IS NULL';
const LIVE_D = ' AND d.removed_at IS NULL';
const LIVE_X = ' AND x.removed_at IS NULL';
const LIVE_T = ' AND t.removed_at IS NULL';
const ALIASES = { '': LIVE_BARE, f: LIVE_F, d: LIVE_D, x: LIVE_X, t: LIVE_T } as const;

/**
 * The clause that leaves Trash out of a read: ` AND <alias>.removed_at IS NULL`
 * once the column exists, else ''. One of five fixed strings, never built from
 * input.
 */
export async function liveFiles(db: Db, alias: keyof typeof ALIASES = ''): Promise<string> {
  return (await trashReady(db)) ? ALIASES[alias] : '';
}

/* ------------------------------------------------------------------ *
 * Days left                                                            *
 * ------------------------------------------------------------------ */

const at = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const s = String(iso);
  const ms = Date.parse(/T|Z/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
};

/** When a file removed at `removedAt` is purged; null when the stamp cannot be read. */
export function purgeAt(removedAt: string | null | undefined): string | null {
  const ms = at(removedAt);
  return ms == null ? null : new Date(ms + TRASH_DAYS * DAY_MS).toISOString();
}

/** Whole days left of thirty, rounded up, never below 0; null when the stamp cannot be read. */
export function daysLeft(removedAt: string | null | undefined, now: Date): number | null {
  const ms = at(removedAt);
  if (ms == null) return null;
  return Math.max(0, Math.ceil((ms + TRASH_DAYS * DAY_MS - now.getTime()) / DAY_MS));
}

/* ------------------------------------------------------------------ *
 * Remove (soft)                                                        *
 * ------------------------------------------------------------------ */

export class TrashUnavailable extends Error {
  constructor() { super('trash_unavailable'); }
}

/**
 * Remove: the file goes to Trash. The file is named by its uid or its id,
 * always with its venture; a file already in Trash, or another venture's, is
 * null. Nothing is deleted.
 */
export async function trashFile(
  env: Env, a: { project: { id: number; uid: string }; userId: number | null; uid?: string; fileId?: number; now?: Date },
): Promise<{ id: number; removed_at: string; purge_at: string | null } | null> {
  if (!(await trashReady(env.DB))) throw new TrashUnavailable();
  const now = (a.now ?? new Date()).toISOString();
  const row = await env.DB.prepare(
    `UPDATE data_room_files
        SET removed_at = ?, removed_by_user_id = ?,
            removed_folder_name = (SELECT d.name FROM data_room_folders d WHERE d.id = data_room_files.folder_id AND d.project_id = data_room_files.project_id)
      WHERE (uid = ? OR id = ?) AND project_id = ? AND removed_at IS NULL
      RETURNING id`,
  ).bind(now, a.userId, a.uid ?? null, a.fileId ?? null, a.project.id).first<{ id: number }>();
  if (!row) return null;
  const versions = await countVersions(env, Number(row.id));
  await logCycleWrite(env, { projectId: a.project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: Number(row.id), action: 'file_removed',
    summary: `File moved to Trash for ${TRASH_DAYS} days${versions == null ? '' : ` with ${versions} earlier version${versions === 1 ? '' : 's'}`}` });
  return { id: Number(row.id), removed_at: now, purge_at: purgeAt(now) };
}

async function countVersions(env: Env, fileId: number): Promise<number | null> {
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM data_room_file_versions WHERE file_id = ?').bind(fileId).first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch (e) {
    if (missing(e)) return 0;
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The Trash read                                                       *
 * ------------------------------------------------------------------ */

export type TrashItem = {
  uid: string; name: string; size_bytes: number | null; content_type: string | null;
  folder: string | null; folder_uid: string | null; folder_gone: boolean;
  removed_at: string; removed_by_name: string | null; days_left: number | null; purge_at: string | null;
  earlier_versions: number; source_kind: string | null; source_ref: string | null;
};

/** The room's Trash, newest removal first. A size or a remover nobody recorded is null, never 0 or a name. */
export async function readTrash(env: Env, projectId: number, now: Date = new Date()): Promise<{ items: TrashItem[]; trash_days: number }> {
  if (!(await trashReady(env.DB))) return { items: [], trash_days: TRASH_DAYS };
  const rows = (await env.DB.prepare(
    `SELECT f.id, f.uid, f.name, f.size_bytes, f.content_type, f.folder_id, f.removed_at, f.removed_folder_name,
            f.source_kind, f.source_ref, d.uid AS folder_uid, d.name AS folder_name, u.name AS removed_by_name
       FROM data_room_files f
       LEFT JOIN data_room_folders d ON d.id = f.folder_id AND d.project_id = f.project_id
       LEFT JOIN users u ON u.id = f.removed_by_user_id
      WHERE f.project_id = ? AND f.removed_at IS NOT NULL
      ORDER BY f.removed_at DESC, f.id DESC`,
  ).bind(projectId).all<any>()).results || [];
  const counts = new Map<number, number>();
  if (rows.length) {
    try {
      const vs = await env.DB.prepare(
        `SELECT v.file_id, COUNT(*) AS n FROM data_room_file_versions v
           JOIN data_room_files f ON f.id = v.file_id AND f.project_id = ? AND f.removed_at IS NOT NULL
          GROUP BY v.file_id`,
      ).bind(projectId).all<{ file_id: number; n: number }>();
      for (const v of vs.results || []) counts.set(Number(v.file_id), Number(v.n));
    } catch (e) { if (!missing(e)) throw e; }
  }
  return {
    trash_days: TRASH_DAYS,
    items: rows.map((r) => ({
      uid: String(r.uid), name: String(r.name),
      size_bytes: r.size_bytes == null ? null : Number(r.size_bytes), content_type: r.content_type ?? null,
      folder: r.folder_name ?? r.removed_folder_name ?? null,
      folder_uid: r.folder_uid ?? null,
      // It was in a folder that is no longer there: Restore puts it at the top level.
      folder_gone: r.folder_uid == null && (r.folder_id != null || r.removed_folder_name != null),
      removed_at: String(r.removed_at), removed_by_name: r.removed_by_name ?? null,
      days_left: daysLeft(r.removed_at, now), purge_at: purgeAt(r.removed_at),
      earlier_versions: counts.get(Number(r.id)) ?? 0,
      source_kind: r.source_kind ?? null, source_ref: r.source_ref ?? null,
    })),
  };
}

/** How many files the room's Trash holds; null when it cannot be read. */
export async function trashCount(env: Env, projectId: number): Promise<number | null> {
  try {
    if (!(await trashReady(env.DB))) return 0;
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM data_room_files WHERE project_id = ? AND removed_at IS NOT NULL')
      .bind(projectId).first<{ n: number }>();
    const n = Number(r?.n);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Restore                                                              *
 * ------------------------------------------------------------------ */

/**
 * Restore: the file is back in the room with its gate, versions and matches.
 * Its folder is kept when it still exists in this venture; otherwise the file
 * returns to the top level. Null when no such file is in this room's Trash.
 */
export async function restoreFile(
  env: Env, a: { project: { id: number; uid: string }; userId: number | null; uid: string },
): Promise<{ id: number; uid: string; folder_uid: string | null; returned_to_top_level: boolean } | null> {
  if (!(await trashReady(env.DB))) return null;
  const row = await env.DB.prepare(
    `SELECT f.id, f.uid, f.folder_id, f.removed_folder_name, d.uid AS folder_uid
       FROM data_room_files f LEFT JOIN data_room_folders d ON d.id = f.folder_id AND d.project_id = f.project_id
      WHERE f.uid = ? AND f.project_id = ? AND f.removed_at IS NOT NULL`,
  ).bind(a.uid, a.project.id).first<{ id: number; uid: string; folder_id: number | null; removed_folder_name: string | null; folder_uid: string | null }>();
  if (!row) return null;
  const gone = row.folder_uid == null && (row.folder_id != null || row.removed_folder_name != null);
  // Guarded on the stamp, so two Restores, or a Restore racing the purge, change one row at most.
  const res = await env.DB.prepare(
    `UPDATE data_room_files
        SET removed_at = NULL, removed_by_user_id = NULL, removed_folder_name = NULL,
            folder_id = CASE WHEN EXISTS (SELECT 1 FROM data_room_folders d WHERE d.id = data_room_files.folder_id AND d.project_id = data_room_files.project_id)
                             THEN folder_id ELSE NULL END
      WHERE id = ? AND project_id = ? AND removed_at IS NOT NULL`,
  ).bind(row.id, a.project.id).run();
  if (!(res as any)?.meta?.changes) return null;
  await logCycleWrite(env, { projectId: a.project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: Number(row.id), action: 'file_restored', summary: gone ? 'File restored from Trash to the top level; its folder was deleted' : 'File restored from Trash' });
  return { id: Number(row.id), uid: String(row.uid), folder_uid: gone ? null : row.folder_uid, returned_to_top_level: gone };
}

/* ------------------------------------------------------------------ *
 * The purge: Delete now, and the sweep                                 *
 * ------------------------------------------------------------------ */

async function hasTable(db: Db, table: 'data_room_file_versions' | 'dataroom_deck_values' | 'connector_fed_items'): Promise<boolean> {
  try { await db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all(); return true; }
  catch (e) { if (missing(e)) return false; throw e; }
}

export class PurgeIncomplete extends Error {
  constructor() { super('purge_incomplete'); }
}

/**
 * Delete one file in Trash for good: its objects (current and every version,
 * inside this venture's prefix only), then its passages and vectors, then its
 * rows; a connector's ledger keeps its row with no `local_id`. Null when no such
 * file is in this room's Trash (already purged, restored, or never there).
 * Throws `PurgeIncomplete` when an object could not be deleted: the rows stay,
 * and the next sweep tries again.
 */
export async function purgeFile(
  env: Env, a: { project: { id: number; uid: string }; userId: number | null; fileId?: number; uid?: string; reason: 'delete_now' | 'expired' },
): Promise<{ id: number; versions: number } | null> {
  if (!(await trashReady(env.DB))) return null;
  const file = await env.DB.prepare(
    'SELECT id, uid, r2_key FROM data_room_files WHERE (id = ? OR uid = ?) AND project_id = ? AND removed_at IS NOT NULL',
  ).bind(a.fileId ?? null, a.uid ?? null, a.project.id).first<{ id: number; uid: string; r2_key: string }>();
  if (!file) return null;
  const withVersions = await hasTable(env.DB, 'data_room_file_versions');
  const versions = withVersions
    ? ((await env.DB.prepare('SELECT r2_key FROM data_room_file_versions WHERE file_id = ?').bind(file.id).all<{ r2_key: string }>()).results || [])
    : [];
  const prefix = `data-room/${a.project.uid}/`;
  const keys = [file.r2_key, ...versions.map((v) => v.r2_key)].filter((k) => typeof k === 'string' && k.startsWith(prefix));
  if (keys.length) {
    if (!env.FILES) throw new PurgeIncomplete();
    // D6651: a Trash purge goes through the one record-erasure path.
    try { await eraseRecordObjects(env.FILES, keys, 'purge'); }
    catch (e) {
      console.error('[data_room_trash] object delete failed; kept in Trash for the next sweep', e instanceof Error ? e.message : 'error');
      throw new PurgeIncomplete();
    }
  }
  // #3938: the passages and vectors go with it. A failure here is logged, not fatal: a passage of a
  // deleted file is never shown, since the search read joins it to its row.
  try { await forgetFile(env, { index: (env.DATAROOM_INDEX as any) ?? null }, file.id); }
  catch (e) { console.error('[data_room_trash] search index delete failed', e instanceof Error ? e.message : 'error'); }
  const [deck, ledger] = await Promise.all([hasTable(env.DB, 'dataroom_deck_values'), hasTable(env.DB, 'connector_fed_items')]);
  // D1 may run with foreign keys off, so every dependent row goes by hand, in one batch.
  const res = await env.DB.batch([
    ...(ledger ? [env.DB.prepare(
      `UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = 'data_room_files' AND local_id = ?`,
    ).bind(a.project.id, file.id)] : []),
    ...(deck ? [env.DB.prepare('DELETE FROM dataroom_deck_values WHERE project_id = ? AND file_uid = ?').bind(a.project.id, file.uid)] : []),
    ...(withVersions ? [env.DB.prepare('DELETE FROM data_room_file_versions WHERE file_id = ?').bind(file.id)] : []),
    env.DB.prepare('DELETE FROM data_room_files WHERE id = ? AND project_id = ? AND removed_at IS NOT NULL').bind(file.id, a.project.id),
  ]);
  if (!(res.at(-1) as any)?.meta?.changes) return null;
  await logCycleWrite(env, { projectId: a.project.id, userId: a.userId, cycle: 'raise', module: 'data-room',
    entityId: file.id, action: a.reason === 'delete_now' ? 'file_deleted_now' : 'file_purged',
    summary: `${a.reason === 'delete_now' ? 'File deleted from Trash' : `File deleted after ${TRASH_DAYS} days in Trash`} with ${versions.length} earlier version${versions.length === 1 ? '' : 's'}` })
    .catch(() => {});
  return { id: file.id, versions: versions.length };
}

/**
 * The daily sweep (index.ts, 04:30 UTC, beside the venture trash): every file
 * whose thirty days are up, oldest first, at most `limit` a run. Each purge is
 * its own; one that fails is counted and stays for the next run.
 */
export async function purgeExpiredTrash(env: Env, now: Date = new Date(), limit = SWEEP_BATCH): Promise<{ scanned: number; purged: number; failed: number }> {
  if (!(await trashReady(env.DB))) return { scanned: 0, purged: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY_MS).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT f.id, p.id AS project_id, p.uid AS project_uid
       FROM data_room_files f JOIN projects p ON p.id = f.project_id
      WHERE f.removed_at IS NOT NULL AND f.removed_at <= ?
      ORDER BY f.removed_at, f.id LIMIT ?`,
  ).bind(cutoff, limit).all<{ id: number; project_id: number; project_uid: string }>()).results || [];
  let purged = 0; let failed = 0;
  for (const r of rows) {
    try {
      const out = await purgeFile(env, { project: { id: Number(r.project_id), uid: String(r.project_uid) }, userId: null, fileId: Number(r.id), reason: 'expired' });
      if (out) purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: rows.length, purged, failed };
}
