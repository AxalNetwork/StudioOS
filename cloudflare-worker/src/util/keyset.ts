/**
 * #4701 — keyset paging for capped Pipeline lists.
 *
 * A fixed `LIMIT 200` with nothing after it answers "the first 200" as though
 * it were "all of them". This is the other half: a cursor naming the last row
 * of the page (its sort keys, never an offset, so a row written between two
 * page reads cannot shift a neighbour into the gap), and a `has_more` the
 * caller reads instead of guessing from the length.
 *
 * `scanAll` walks a whole authorized population in chunks so a total can
 * describe every row the caller may see rather than the page it was handed.
 * It reports `complete: false` when it had to stop, so a total is never
 * quietly presented as the whole.
 */

export const LIST_PAGE_DEFAULT = 200;
export const LIST_PAGE_MAX = 200;
/** Chunks one scan reads before it gives up and says so (50,000 rows). */
export const SCAN_MAX_CHUNKS = 250;

export function listLimit(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return LIST_PAGE_DEFAULT;
  return Math.min(n, LIST_PAGE_MAX);
}

export type CursorKey = string | number;

export function encodeCursor(keys: CursorKey[]): string {
  return btoa(JSON.stringify(keys)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A cursor the caller sent, or null for "from the start". A malformed one is a 400, not a restart. */
export function decodeCursor(raw: string | null | undefined, arity: number): CursorKey[] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const bad = () => new Response(JSON.stringify({ detail: 'That page cursor is not valid. Reload the list from the start.' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  if (typeof raw !== 'string' || raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw bad();
  let parsed: unknown;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    parsed = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch { throw bad(); }
  if (!Array.isArray(parsed) || parsed.length !== arity
    || !parsed.every((k) => typeof k === 'string' || (typeof k === 'number' && Number.isFinite(k)))) throw bad();
  return parsed as CursorKey[];
}

export interface KeysetPage<T> { rows: T[]; hasMore: boolean }

/** Trim the `limit + 1` row a keyset query reads, and say whether it was there. */
export function trimPage<T>(rows: T[], limit: number): KeysetPage<T> {
  return rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false };
}

/**
 * Read every page of a population, handing each chunk to `each`.
 * `fetchPage(cursor)` returns the chunk and the cursor after it (null at the end).
 */
export async function scanAll<T>(
  fetchPage: (cursor: string | null) => Promise<{ rows: T[]; next: string | null }>,
  each: (rows: T[]) => void | Promise<void>,
  maxChunks = SCAN_MAX_CHUNKS,
): Promise<{ complete: boolean }> {
  let cursor: string | null = null;
  for (let i = 0; i < maxChunks; i += 1) {
    const page = await fetchPage(cursor);
    await each(page.rows);
    if (!page.next) return { complete: true };
    cursor = page.next;
  }
  return { complete: false };
}
