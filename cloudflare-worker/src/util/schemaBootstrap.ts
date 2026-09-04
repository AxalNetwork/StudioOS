/**
 * Run a self-healing schema bootstrap against a `users` table that is FULL.
 *
 * WHY THIS EXISTS. `users` sits at D1's hard 100-column limit — verified
 * against production 2026-09-04, `max(cid) + 1 = 100` — and
 * `documentation/architecture/GOTCHAS.md` records what that does to an
 * `ALTER TABLE users ADD COLUMN`: it fails with
 *
 *     too many columns on sqlite_altertab_users
 *
 * Six bootstraps in this worker were written to tolerate exactly one failure,
 * `duplicate column`, and to rethrow everything else. That was correct while
 * the table had room. It stopped being correct the moment it filled up, and
 * the reason it fails is worth stating because it is not the obvious one:
 * SQLite checks the column-count limit in `sqlite3AddColumn()` BEFORE it
 * checks for a duplicate name, so on a full table an ALTER for a column that
 * ALREADY EXISTS reports "too many columns", never "duplicate column". A
 * guard written to skip duplicates therefore rethrows on a statement that had
 * nothing to do — and, because it rethrows before setting its `_migrated`
 * flag, it rethrows again on the next request, and every request after that,
 * for the life of every isolate.
 *
 * That is what took `/api/introductions/*` down. Its router-level
 * `use('*')` middleware calls `ensureInvestorPaywallSchema`, whose eleven
 * `investor_*` columns are all ALREADY PRESENT in production. Nothing needed
 * doing; the bootstrap threw anyway; every introductions endpoint returned
 * 500 for every role, which is why `intro_propositions` and
 * `intro_credit_ledger` are both still empty.
 *
 * THE FIX IS TO ASK FIRST. Read the table's columns once, skip the ALTERs
 * whose column is already there, and run the rest. In production that leaves
 * zero ALTERs and the bootstrap simply succeeds.
 *
 * WHAT IT DOES NOT DO is swallow the cap error. If a column is genuinely
 * MISSING and the table is genuinely full, the code that follows would read a
 * column that does not exist, and a bootstrap that returned quietly would
 * hand it a silent wrong answer. So that case throws — with a message naming
 * the column, the limit and the remedy (a side table keyed by `user_id`, the
 * pattern `mi_pro_subscriptions` and `super_admins` already use) instead of
 * the bare `too many columns` that started this.
 */
import type { Env } from '../types';

/** Per-DB-binding column cache. One isolate has one DB, so this is per-isolate. */
const columnCache = new WeakMap<object, Map<string, Set<string>>>();

const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/i;

/** Columns `table` currently has, read once per binding and remembered. */
export async function tableColumns(env: Env, table: string): Promise<Set<string>> {
  const key = env.DB as unknown as object;
  let byTable = columnCache.get(key);
  if (!byTable) { byTable = new Map(); columnCache.set(key, byTable); }
  const hit = byTable.get(table);
  if (hit) return hit;

  const cols = new Set<string>();
  try {
    // pragma_table_info is a table-valued function, so the name binds as a
    // parameter — no interpolation, and an unknown table yields zero rows
    // rather than an error.
    const r = await env.DB.prepare('SELECT name FROM pragma_table_info(?)')
      .bind(table).all<{ name: string }>();
    for (const row of r.results || []) cols.add(String(row.name));
  } catch {
    // A cold or non-SQLite binding: return empty and let the statements
    // themselves decide. Deliberately NOT cached, so a later call retries.
    return cols;
  }
  // An empty answer is never a real table — a table with zero columns cannot
  // exist — so it means "could not tell", and caching it would remember a
  // table created later as permanently empty. Same reasoning as the catch.
  if (cols.size > 0) byTable.set(table, cols);
  return cols;
}

/** Forget what we know about `table` — call after an ALTER actually adds one. */
function forget(env: Env, table: string): void {
  columnCache.get(env.DB as unknown as object)?.delete(table);
}

/**
 * Run `stmts` in order, skipping `ADD COLUMN` statements whose column already
 * exists. Tolerates a duplicate-column race; refuses, loudly, to continue past
 * a column that is missing on a table with no room left.
 */
export async function runSchemaBootstrap(env: Env, stmts: readonly string[]): Promise<void> {
  for (const s of stmts) {
    const m = ADD_COLUMN.exec(s);
    if (m) {
      const [, table, column] = m;
      if ((await tableColumns(env, table)).has(column)) continue;
      try {
        await env.DB.prepare(s).run();
        forget(env, table);
      } catch (e) {
        const msg = (e as Error).message || '';
        // Another isolate won the race between our read and our write.
        if (/duplicate column|already exists/i.test(msg)) { forget(env, table); continue; }
        if (/too many columns/i.test(msg)) {
          throw new Error(
            `${table}.${column} cannot be added: ${table} is at D1's 100-column limit `
            + `(${msg}). This column has to live in a side table keyed by user_id — see `
            + 'mi_pro_subscriptions and super_admins for the pattern, and '
            + 'documentation/architecture/GOTCHAS.md for why.',
          );
        }
        throw e;
      }
      continue;
    }
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/duplicate column|already exists/i.test(msg)) continue;
      throw e;
    }
  }
}
