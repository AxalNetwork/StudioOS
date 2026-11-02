import type { Env } from '../types';

/**
 * D1464 (#4021): the founder's list of reasoned support reads on one record —
 * who opened it (a name and whether they read as a Studio admin or HQ), the
 * reason they gave, and when. Each row is one `activity_logs` row the record's
 * support-read route wrote before it read anything (D1102, D1191), so the
 * list is exactly what was recorded and nothing is inferred.
 *
 * `kind` is `super_admin` when the reader holds a `super_admins` row, `admin`
 * otherwise, and null when the reader's account is gone: never a guess.
 * A row whose details cannot be parsed keeps its reader and time with a null
 * reason, which the page draws as not recorded. A read that fails throws, so
 * the page says Unreadable, never an empty list.
 */
export const SUPPORT_PAGE_SIZE = 25;

export type SupportRead = {
  id: number;
  reader: { name: string | null; kind: 'admin' | 'super_admin' | null };
  reason: string | null;
  created_at: string;
  read_only: true;
};

export class SupportHistoryError extends Error {
  constructor() { super('Support reads unreadable'); }
}

/** The page of the query, 1 and up; anything else is page 1. */
export function supportPage(raw: unknown): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n <= 10_000 ? n : 1;
}

/** One record's support reads, newest first, 25 to a page. */
export async function supportReadHistory(env: Env, projectId: number, action: string, page: number) {
  let rows;
  // A read that throws is unreadable; the database's own message is never passed on.
  try { rows = await readRows(env, projectId, action, page); } catch { throw new SupportHistoryError(); }
  if ((rows as { success?: boolean }).success === false || !Array.isArray(rows.results)) throw new SupportHistoryError();
  const reads: SupportRead[] = rows.results.slice(0, SUPPORT_PAGE_SIZE).map((row) => {
    let reason: string | null = null;
    try {
      const details = JSON.parse(String(row.details ?? ''));
      reason = typeof details?.reason === 'string' && details.reason.trim() ? details.reason : null;
    } catch { /* A row whose details cannot be read keeps a null reason. */ }
    return { id: row.id, reader: { name: row.reader_name ?? null, kind: row.reader_kind ?? null }, reason, created_at: row.created_at, read_only: true };
  });
  return { page, page_size: SUPPORT_PAGE_SIZE, has_more: rows.results.length > SUPPORT_PAGE_SIZE, reads };
}

function readRows(env: Env, projectId: number, action: string, page: number) {
  return env.DB.prepare(
    `SELECT a.id, a.details, a.created_at, u.name AS reader_name,
            CASE WHEN u.id IS NULL THEN NULL
                 WHEN EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = u.id) THEN 'super_admin'
                 ELSE 'admin' END AS reader_kind
       FROM activity_logs a LEFT JOIN users u ON a.actor = 'user:' || u.id
      WHERE a.project_id = ? AND a.action = ?
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
  ).bind(projectId, action, SUPPORT_PAGE_SIZE + 1, (page - 1) * SUPPORT_PAGE_SIZE)
    .all<{ id: number; details: string | null; created_at: string; reader_name: string | null; reader_kind: 'admin' | 'super_admin' | null }>();
}
