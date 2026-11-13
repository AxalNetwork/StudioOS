/**
 * D691 decision 6 (#1700) — data-room access is per file, and every read
 * outside the founder's honours it.
 *
 * A file's `access_tier` (migration 463) is:
 *   - `invited`   any active grant may see it (today's rule; the default);
 *   - `committed` only a grant whose investor is a committed prospect of this
 *                 venture: their account's email matches a `raise_prospects`
 *                 row of the venture at stage `committed`, the match
 *                 `loadProspects` already uses;
 *   - `nobody`    no one outside the founder's own reads.
 * `access_expires_at` hides the file from its date on. The NDA gate (the
 * file's `visibility`) still applies on top.
 *
 * ONE PREDICATE. The investor room (`/shared`, `/shared/:projectUid`, the
 * download), every `research.ts` room read and the advisor brief all decide
 * with `tierAdmits`, so a hidden file is never listed, never counted (totals
 * and `withheld_behind_nda` count only what it admits) and its download
 * answers 404. The founder's file tool applies the same rules in the browser
 * (`pages/raise/dataRoomRead.js`).
 *
 * D1103 (#2983) — A GRANT'S FOLDER SCOPE. A grant opens every folder, or only
 * the folders it names (migration 594, `data_room_grants.folders_scoped` with
 * one `data_room_grant_folders` row per folder). `grantFolderScope` reads it as
 * a set of folder ids, each named folder with its subfolders, or null for
 * every folder, and `tierAdmits` takes it as its fourth argument: a file
 * outside the scope, or at the room's top level under a scoped grant, is
 * admitted by nothing. Every investor reader passes its grant's scope, so the
 * one predicate still decides.
 */
import type { Env } from '../types';

export const ACCESS_TIERS = ['invited', 'committed', 'nobody'] as const;
export type AccessTier = typeof ACCESS_TIERS[number];
export const isAccessTier = (v: unknown): v is AccessTier => typeof v === 'string' && (ACCESS_TIERS as readonly string[]).includes(v);

export type TieredFile = { access_tier?: string | null; access_expires_at?: string | null; folder_id?: number | null };

/** The folders a grant opens: their ids, subfolders included, or null for every folder. */
export type FolderScope = ReadonlySet<number> | null;

/** Milliseconds for a stored `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`, read as UTC; null when unreadable. */
export function expiryMs(v: string | null | undefined): number | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a file's tier and expiry admit this reader. `committed` says
 * whether the reader is a committed prospect of the venture. An absent tier
 * reads as `invited`. An expiry that cannot be read hides the file: a date
 * nobody can check is not a promise to keep showing it.
 */
export function tierAdmits(f: TieredFile, committed: boolean, now: number = Date.now(), folders: FolderScope = null): boolean {
  const tier = f.access_tier == null || f.access_tier === '' ? 'invited' : f.access_tier;
  // `nobody`, and any value this code does not know, admits no one.
  if (tier !== 'invited' && tier !== 'committed') return false;
  if (tier === 'committed' && !committed) return false;
  if (f.access_expires_at != null && String(f.access_expires_at).trim() !== '') {
    const at = expiryMs(f.access_expires_at);
    if (at == null || at <= now) return false;
  }
  // D1103 — a scoped grant opens only its folders. A file with no folder, or a
  // reader that did not select `folder_id`, is outside every scope.
  if (folders !== null && (f.folder_id == null || !folders.has(Number(f.folder_id)))) return false;
  return true;
}

/** Whether a folder is inside the grant's scope; every folder when it is null. */
export const folderInScope = (folderId: number | null | undefined, folders: FolderScope): boolean =>
  folders === null || (folderId != null && folders.has(Number(folderId)));

/**
 * The grant's folder scope (D1103): null when it opens every folder, else the
 * ids of the folders it names and of every folder under them, inside the
 * grant's own project. Fails closed: a scope that cannot be read is an empty
 * set, which opens nothing, never the whole room.
 */
export async function grantFolderScope(env: Env, grantId: number): Promise<FolderScope> {
  try {
    const grant = await env.DB.prepare(
      'SELECT project_id, folders_scoped FROM data_room_grants WHERE id = ?',
    ).bind(grantId).first<{ project_id: number; folders_scoped: number | null }>();
    if (!grant) return new Set();
    if (Number(grant.folders_scoped) !== 1) return null;
    // The walk is bounded by the project at each step, so a folder row that
    // points into another venture's tree is never followed.
    const rows = await env.DB.prepare(
      `WITH tree AS (
         SELECT f.id FROM data_room_grant_folders gf
           JOIN data_room_folders f ON f.id = gf.folder_id AND f.project_id = ?
          WHERE gf.grant_id = ?
         UNION
         SELECT f.id FROM data_room_folders f JOIN tree t ON f.parent_id = t.id WHERE f.project_id = ?
       )
       SELECT id FROM tree`,
    ).bind(grant.project_id, grantId, grant.project_id).all<{ id: number }>();
    return new Set((rows.results || []).map((r) => Number(r.id)));
  } catch (e) {
    console.error('[data_room] folder scope unreadable', (e as Error)?.message);
    return new Set();
  }
}

/**
 * Whether this investor is a committed prospect of the venture. Fails closed:
 * a read that cannot be done (a store not yet migrated) is "not committed", so
 * a committed-only file stays hidden.
 */
export async function investorCommitted(env: Env, projectId: number, userId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS yes FROM raise_prospects rp JOIN users u ON u.id = ?
        WHERE rp.project_id = ? AND rp.stage = 'committed'
          AND rp.email IS NOT NULL AND u.email IS NOT NULL
          AND LOWER(rp.email) = LOWER(u.email)
        LIMIT 1`,
    ).bind(userId, projectId).first<{ yes: number }>();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * The room's files this reader's tier admits, counted: `total` is what the
 * tier and expiry admit, `open` what the NDA gate then lets them open.
 */
export async function admittedCounts(
  env: Env, projectId: number, committed: boolean, nda: boolean, folders: FolderScope = null,
): Promise<{ total: number; open: number }> {
  const res = await env.DB.prepare(
    'SELECT visibility, access_tier, access_expires_at, folder_id FROM data_room_files WHERE project_id = ?',
  ).bind(projectId).all<{ visibility: string; access_tier: string | null; access_expires_at: string | null; folder_id: number | null }>();
  const now = Date.now();
  const admitted = (res.results || []).filter((f) => tierAdmits(f, committed, now, folders));
  return { total: admitted.length, open: admitted.filter((f) => f.visibility === 'open' || nda).length };
}
