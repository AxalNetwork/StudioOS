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
 */
import type { Env } from '../types';

export const ACCESS_TIERS = ['invited', 'committed', 'nobody'] as const;
export type AccessTier = typeof ACCESS_TIERS[number];
export const isAccessTier = (v: unknown): v is AccessTier => typeof v === 'string' && (ACCESS_TIERS as readonly string[]).includes(v);

export type TieredFile = { access_tier?: string | null; access_expires_at?: string | null };

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
export function tierAdmits(f: TieredFile, committed: boolean, now: number = Date.now()): boolean {
  const tier = f.access_tier == null || f.access_tier === '' ? 'invited' : f.access_tier;
  if (tier === 'nobody') return false;
  if (tier === 'committed' && !committed) return false;
  if (tier !== 'invited' && tier !== 'committed') return false;
  if (f.access_expires_at != null && String(f.access_expires_at).trim() !== '') {
    const at = expiryMs(f.access_expires_at);
    if (at == null || at <= now) return false;
  }
  return true;
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
export async function admittedCounts(env: Env, projectId: number, committed: boolean, nda: boolean): Promise<{ total: number; open: number }> {
  const res = await env.DB.prepare(
    'SELECT visibility, access_tier, access_expires_at FROM data_room_files WHERE project_id = ?',
  ).bind(projectId).all<{ visibility: string; access_tier: string | null; access_expires_at: string | null }>();
  const now = Date.now();
  const admitted = (res.results || []).filter((f) => tierAdmits(f, committed, now));
  return { total: admitted.length, open: admitted.filter((f) => f.visibility === 'open' || nda).length };
}
