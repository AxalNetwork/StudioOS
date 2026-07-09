/**
 * Phase 0.1 / Task #74 / Task #9 — relax the legacy `users.role` CHECK
 * constraint so it accepts newer roles ('investor', 'advisor', 'exploring').
 * SQLite/D1 has no ALTER TABLE DROP/MODIFY CONSTRAINT, so on an existing prod
 * DB the table must be rebuilt.
 *
 * Extracted from `ensureInvestorSchema` in index.ts so this loss-of-data path
 * is unit-testable in isolation.
 *
 * The new table DDL is derived from the LIVE definition (sqlite_master) and we
 * rewrite ONLY the role CHECK to also accept the new role. Every column,
 * default, FK, UNIQUE/CHECK and (replayed) index is preserved — nothing is
 * hardcoded, so no founder/investor/subscription/PII/linkedin/public-id data
 * or index is lost when the rebuild commits.
 *
 * Statement order is load-bearing (learned from two distinct prod failures):
 *
 * 1. The classic CREATE users_new → copy → DROP users → RENAME sequence fails
 *    on any DB with a VIEW over users (prod has `partner_summary`): ALTER
 *    TABLE ... RENAME re-validates every schema object and aborts with
 *    "error in view partner_summary: no such table: main.users" because
 *    `users` was just dropped. So: NO RENAME. The final table is CREATEd
 *    directly under its real name, and views are never touched.
 *
 * 2. With foreign keys enforced (D1 enforces them), `DROP TABLE users` runs an
 *    implicit DELETE of every row, incrementing the deferred-FK violation
 *    counter for every child row that references a user. That counter is only
 *    decremented by INSERTs into the table the constraints name — `users` —
 *    so rows copied into `users_new` BEFORE the drop never resolve them and
 *    the batch dies at commit with "FOREIGN KEY constraint failed" (D1: "DB
 *    was reset and rolled back"). So the data is snapshotted to a temp table
 *    first, and the copy-back into the recreated `users` happens AFTER the
 *    drop — those inserts bring the violation counter back to zero before
 *    commit. `PRAGMA defer_foreign_keys = TRUE` (first statement, applies to
 *    the batch's implicit transaction) is what keeps the mid-batch violations
 *    from failing immediately.
 *
 * The whole batch is one atomic transaction: any failure rolls back to the
 * pre-rebuild state (observed twice on prod — no data was ever lost).
 *
 * sqlite_sequence: users is AUTOINCREMENT. The copy-back sets seq =
 * max(copied id), but if the previously-highest user was deleted the old seq
 * was HIGHER — without restoring it, a future signup could silently reuse a
 * deleted user's id (and inherit any stale child rows pointing at it). So the
 * old seq is captured up-front and restored when it exceeds the recomputed one.
 */
import type { Env } from '../types';

export interface UsersRoleRebuildResult {
  /** True if the table was rebuilt; false when the role CHECK already accepts the role. */
  rebuilt: boolean;
}

const TMP = 'users_rebuild_tmp';

async function rebuildUsersRoleCheckFor(env: Env, role: string): Promise<UsersRoleRebuildResult> {
  const tbl = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ sql: string }>();
  const ddl = (tbl?.sql || '');
  const needsRebuild = ddl.includes("CHECK") && ddl.includes("'partner'") && !ddl.includes(`'${role}'`);
  if (!needsRebuild) return { rebuilt: false };

  // Rewrite ONLY the role CHECK. The quoted token 'partner' appears solely in
  // the role CHECK, so the single replace is targeted and safe regardless of
  // which of the other rebuilds already ran (all anchor on 'partner'). The
  // table name is untouched — the DDL is replayed under the real name.
  const newTableDdl = ddl.replace("'partner'", `'partner', '${role}'`);
  // Copy the FULL current column set (read fresh — columns may have just been
  // added by an earlier ALTER). Old and new share every column, so the
  // snapshot/copy-back round trip is loss-free.
  const freshCols = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const colList = (freshCols.results || []).map(r => r.name).join(', ');
  // Replay EVERY explicit index that existed on users. DROP TABLE removes the
  // table and all its indexes; auto-indexes (UNIQUE/PK) have sql=NULL and are
  // recreated by the CREATE TABLE itself, so we only replay the user-defined
  // ones (sql IS NOT NULL). Their stored SQL targets `users`, which is the
  // recreated table's name.
  const idxRows = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL"
  ).all<{ sql: string }>();
  const idxStmts = (idxRows.results || [])
    .map(r => r.sql)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map(s => env.DB.prepare(s));
  // Capture the AUTOINCREMENT high-water mark so it can be restored if the
  // copy-back recomputes a lower one (see header). sqlite_sequence exists on
  // any DB where users itself is AUTOINCREMENT; guard anyway for dev DBs.
  let oldSeq: number | null = null;
  try {
    const seqRow = await env.DB.prepare(
      "SELECT seq FROM sqlite_sequence WHERE name='users'"
    ).first<{ seq: number }>();
    if (seqRow && typeof seqRow.seq === 'number') oldSeq = seqRow.seq;
  } catch { /* no sqlite_sequence table — nothing to restore */ }
  // sqlite_sequence has no unique constraint, so UPSERT syntax is unavailable:
  // UPDATE the existing row when the recomputed seq is lower, and INSERT one
  // when the copy-back inserted zero rows (empty users table) and left no row.
  const seqStmts = oldSeq === null ? [] : [
    env.DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name='users' AND seq < ?").bind(oldSeq, oldSeq),
    env.DB.prepare(
      "INSERT INTO sqlite_sequence (name, seq) SELECT 'users', ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='users')"
    ).bind(oldSeq),
  ];

  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = TRUE"),
    env.DB.prepare(`DROP TABLE IF EXISTS ${TMP}`),
    env.DB.prepare(`CREATE TABLE ${TMP} AS SELECT ${colList} FROM users`),
    env.DB.prepare("DROP TABLE users"),
    env.DB.prepare(newTableDdl),
    env.DB.prepare(`INSERT INTO users (${colList}) SELECT ${colList} FROM ${TMP}`),
    env.DB.prepare(`DROP TABLE ${TMP}`),
    ...idxStmts,
    ...seqStmts,
  ]);
  return { rebuilt: true };
}

/** Phase 0.1 — relax the users.role CHECK so 'investor' is accepted. */
export async function rebuildUsersRoleCheckForInvestor(env: Env): Promise<UsersRoleRebuildResult> {
  return rebuildUsersRoleCheckFor(env, 'investor');
}

/** Task #74 — relax the users.role CHECK so 'advisor' is accepted (Mentor→Advisor rename). */
export async function rebuildUsersRoleCheckForAdvisor(env: Env): Promise<UsersRoleRebuildResult> {
  return rebuildUsersRoleCheckFor(env, 'advisor');
}

/** Task #9 — relax the users.role CHECK so 'exploring' is accepted (onboarding holding state). */
export async function rebuildUsersRoleCheckForExploring(env: Env): Promise<UsersRoleRebuildResult> {
  return rebuildUsersRoleCheckFor(env, 'exploring');
}
