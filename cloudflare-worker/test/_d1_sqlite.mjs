/**
 * A D1 binding backed by a real database.
 *
 * The LP route tests used to stub D1 by matching on SQL TEXT — a chain of
 * `if (sql.includes('and user_id'))` branches, each returning a hand-built row
 * set. That worked while the queries were frozen, and it stopped working the
 * moment the ownership predicate moved into `lpMembershipScope`: every branch
 * missed, every route got `[]`, and five IDOR tests went red without a single
 * behavioural change.
 *
 * Retuning those string matchers would have made the suite green and hollow.
 * A text-matching stub cannot tell a correct predicate from an incorrect one —
 * it only knows which strings it was taught. So the tests that guard against
 * serving another tenant's capital calls would have been asserting that a
 * query *looks* a certain way, which is exactly the property nobody cares
 * about.
 *
 * This runs the SQL. `node:sqlite` speaks the same dialect D1 does (D1 IS
 * SQLite), so the route's real query, with its real binds, decides which rows
 * come back. A scoping regression now fails these tests because the wrong rows
 * are returned, not because a substring moved.
 *
 * Surface implemented: the subset the worker actually uses —
 *   prepare(sql).bind(...).all() / .first() / .run(), and batch().
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * `.run()` reports `meta.changes`, which lpClaim reads to decide whether to
 * log a link. node:sqlite returns `changes` from `run()` directly.
 */
function shape(stmt, binds) {
  return {
    async all() {
      // node:sqlite throws on a non-SELECT passed to .all(); getSQL routes
      // every statement (INSERT/UPDATE included) through all(), so fall back
      // to run() and report no rows, which is what D1 does for a write.
      try {
        return { results: stmt.all(...binds), success: true };
      } catch {
        const info = stmt.run(...binds);
        return { results: [], success: true, meta: { changes: Number(info?.changes ?? 0) } };
      }
    },
    async first(col) {
      let row;
      try { row = stmt.get(...binds); } catch { stmt.run(...binds); return null; }
      if (row === undefined) return null;
      return col === undefined ? row : row?.[col] ?? null;
    },
    async run() {
      try {
        const info = stmt.run(...binds);
        return { success: true, meta: { changes: Number(info?.changes ?? 0) } };
      } catch {
        // A RETURNING clause makes node:sqlite treat it as a reader.
        return { success: true, results: stmt.all(...binds), meta: { changes: 0 } };
      }
    },
  };
}

/**
 * @param {string} schema  DDL applied once at construction.
 * @param {string} [seed]  Optional INSERTs.
 * @returns {{ DB: object, db: import('node:sqlite').DatabaseSync }}
 */
export function makeD1(schema, seed = '') {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  if (seed) db.exec(seed);

  const DB = {
    prepare(sql) {
      // Prepared lazily: a statement the route builds but never binds (or one
      // referencing a table this fixture omits) must not throw at prepare
      // time, because the routes wrap several reads in try/catch and treat a
      // throw as "table absent", which would silently pass the wrong test.
      let stmt = null;
      let binds = [];
      const get = () => (stmt ??= db.prepare(sql));
      const api = {
        bind(...a) { binds = a; return api; },
        all: async () => shape(get(), binds).all(),
        first: async (col) => shape(get(), binds).first(col),
        run: async () => shape(get(), binds).run(),
      };
      return api;
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts || []) out.push(await s.run());
      return out;
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
  return { DB, db };
}
