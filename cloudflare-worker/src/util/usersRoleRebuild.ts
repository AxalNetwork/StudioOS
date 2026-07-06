/**
 * Phase 0.1 — relax the legacy `users.role` CHECK constraint that excluded
 * 'investor'. SQLite/D1 has no ALTER TABLE DROP/MODIFY CONSTRAINT, so on an
 * existing prod DB the table must be rebuilt.
 *
 * Extracted from `ensureInvestorSchema` in index.ts so this loss-of-data path
 * is unit-testable in isolation (the original lived behind a module-level
 * "ran once" guard and the whole worker bootstrap, so it could not be driven
 * deterministically from a test). Behaviour is identical to the inline block.
 *
 * The new table DDL is derived from the LIVE definition (sqlite_master) and we
 * rewrite ONLY (a) the table name → users_new and (b) the role CHECK to also
 * accept 'investor'. Every column, default, FK, UNIQUE/CHECK and (replayed)
 * index is preserved — nothing is hardcoded, so no founder/investor/
 * subscription/PII/linkedin/public-id data or index is lost when the rebuild
 * commits.
 */
import type { Env } from '../types';

export interface UsersRoleRebuildResult {
  /** True if the table was rebuilt; false when the role CHECK already accepts 'investor'. */
  rebuilt: boolean;
}

export async function rebuildUsersRoleCheckForInvestor(env: Env): Promise<UsersRoleRebuildResult> {
  const tbl = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ sql: string }>();
  const ddl = (tbl?.sql || '');
  const needsRebuild = ddl.includes("CHECK") && ddl.includes("'partner'") && !ddl.includes("'investor'");
  if (!needsRebuild) return { rebuilt: false };

  // Rewrite only (a) the table name → users_new and (b) the role CHECK to
  // include 'investor'. The quoted token 'partner' appears solely in the
  // role CHECK, so the single replace is targeted and safe.
  const newTableDdl = ddl
    .replace(/^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)("?)users\2/i, '$1$2users_new$2')
    .replace("'partner'", "'partner', 'investor'");
  // Copy the FULL current column set (read fresh — investor_id may have just
  // been added by an earlier ALTER). New and old share every column, so the
  // copy is loss-free.
  const freshCols = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const colList = (freshCols.results || []).map(r => r.name).join(', ');
  // Replay EVERY explicit index that existed on users. DROP TABLE removes the
  // table and all its indexes; auto-indexes (UNIQUE/PK) have sql=NULL and are
  // recreated by the CREATE TABLE itself, so we only replay the user-defined
  // ones (sql IS NOT NULL). Their stored SQL targets `users`, which is valid
  // again after the RENAME.
  const idxRows = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL"
  ).all<{ sql: string }>();
  const idxStmts = (idxRows.results || [])
    .map(r => r.sql)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map(s => env.DB.prepare(s));
  // defer_foreign_keys=TRUE works inside a transaction; the old foreign_keys=
  // OFF/ON pair was a no-op inside batch()'s implicit txn, so DROP TABLE users
  // (an implicit DELETE of every row) tripped the child tables' FKs and rolled
  // the whole batch back. Deferring FK checks to commit lets DROP→RENAME finish
  // with users_new holding identical ids, so every child reference still
  // resolves at commit time.
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = TRUE"),
    env.DB.prepare(newTableDdl),
    env.DB.prepare(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`),
    env.DB.prepare("DROP TABLE users"),
    env.DB.prepare("ALTER TABLE users_new RENAME TO users"),
    ...idxStmts,
  ]);
  return { rebuilt: true };
}

/**
 * Task #74 — relax the `users.role` CHECK constraint so it accepts 'advisor'
 * (the Mentor→Advisor role rename). Identical mechanics to the investor rebuild
 * above: the new table DDL is derived from the LIVE definition (sqlite_master),
 * rewriting ONLY (a) the table name → users_new and (b) the role CHECK to also
 * accept 'advisor'. Every column, default, FK, UNIQUE/CHECK and (replayed) index
 * is preserved — nothing is hardcoded, so no data or index is lost. Idempotent:
 * a no-op once the live CHECK already lists 'advisor' (or has no CHECK at all).
 */
export async function rebuildUsersRoleCheckForAdvisor(env: Env): Promise<UsersRoleRebuildResult> {
  const tbl = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ sql: string }>();
  const ddl = (tbl?.sql || '');
  const needsRebuild = ddl.includes("CHECK") && ddl.includes("'partner'") && !ddl.includes("'advisor'");
  if (!needsRebuild) return { rebuilt: false };

  // The quoted token 'partner' appears solely in the role CHECK, so this single
  // replace is targeted and safe. If 'investor' was already inserted after
  // 'partner' by the investor rebuild, this yields "'partner', 'advisor', 'investor'".
  const newTableDdl = ddl
    .replace(/^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)("?)users\2/i, '$1$2users_new$2')
    .replace("'partner'", "'partner', 'advisor'");
  const freshCols = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const colList = (freshCols.results || []).map(r => r.name).join(', ');
  const idxRows = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL"
  ).all<{ sql: string }>();
  const idxStmts = (idxRows.results || [])
    .map(r => r.sql)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map(s => env.DB.prepare(s));
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = TRUE"),
    env.DB.prepare(newTableDdl),
    env.DB.prepare(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`),
    env.DB.prepare("DROP TABLE users"),
    env.DB.prepare("ALTER TABLE users_new RENAME TO users"),
    ...idxStmts,
  ]);
  return { rebuilt: true };
}
