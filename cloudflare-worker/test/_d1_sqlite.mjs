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
 *
 * IT ALSO REPORTS `meta.last_row_id`, and that one was MISSING until D190.
 * `routes/customer_chat.ts:229` reads it to key the message it is about to
 * write to the thread it has just created; with the field absent the shim
 * handed back `undefined`, the message bound a null `thread_id`, and the
 * write landed nowhere while every call still resolved. That is D187's M6
 * shape exactly — a restored statement that writes no row — so a shim that
 * cannot carry the id cannot see the defect it exists to catch. node:sqlite
 * returns it as `lastInsertRowid`, a BigInt, which Number() narrows.
 */
function meta(info) {
  return {
    changes: Number(info?.changes ?? 0),
    last_row_id: Number(info?.lastInsertRowid ?? 0),
  };
}

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
        return { results: [], success: true, meta: meta(info) };
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
        return { success: true, meta: meta(info) };
      } catch {
        // A RETURNING clause makes node:sqlite treat it as a reader.
        return { success: true, results: stmt.all(...binds), meta: { changes: 0, last_row_id: 0 } };
      }
    },
  };
}

/**
 * Wrap a database this caller already built. `makeD1` applies one blob of DDL
 * and is the common case; a fixture assembled statement by statement — the
 * baseline plus every post-cutoff migration, each in its own try/catch — has
 * no such blob, so it builds the DatabaseSync itself and binds it here rather
 * than growing a second copy of the binding below.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {object} the D1 binding surface the worker uses
 */
export function d1Over(db) {
  return {
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
        // The same answer as `run()`, synchronously — `batch` needs every
        // statement to execute before control returns to the event loop.
        runSync: () => {
          const st = get();
          try {
            return { success: true, meta: meta(st.run(...binds)) };
          } catch (e) {
            // A RETURNING clause makes node:sqlite treat it as a reader; any
            // other error is real and aborts the batch.
            if (!/RETURNING/i.test(sql)) throw e;
            return { success: true, results: st.all(...binds), meta: { changes: 0, last_row_id: 0 } };
          }
        },
      };
      return api;
    },
    // ONE TRANSACTION, LIKE D1 (D370). D1 runs a batch as a single
    // transaction: every statement or none, and nothing from another request
    // lands between them. This used to `await` each statement in turn, so two
    // batches in flight at once interleaved statement by statement — a
    // fixture looser than production, which let a test "prove" a race that D1
    // cannot have, and could not prove the absence of one it can. Each
    // statement now runs synchronously inside a savepoint, so no other
    // request's code can run until the batch has committed or rolled back.
    async batch(stmts) {
      const list = stmts || [];
      db.exec('SAVEPOINT d1_batch');
      try {
        const out = list.map((s) => s.runSync());
        db.exec('RELEASE d1_batch');
        return out;
      } catch (e) {
        db.exec('ROLLBACK TO d1_batch');
        db.exec('RELEASE d1_batch');
        throw e;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
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
  return { DB: d1Over(db), db };
}
