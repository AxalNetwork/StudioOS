/**
 * D4805 (#4805) — a decision and everything that depends on it, in one batch.
 *
 * D1 runs a batch as one transaction. The one thing a batch cannot do is skip
 * the statements after one that lost: a `UPDATE ... WHERE state = ?` that
 * changes no row is not an error, so the history row, the entitlement change and
 * the delivery row after it would run for a decision that did not happen. This
 * module makes the loss an error, so the transaction rolls back whole:
 *
 *   [ the deciding UPDATE, guarded on the state it read,
 *     decisionGuard(env),             // fails the CHECK unless that UPDATE changed a row
 *     ...everything that depends on the decision,
 *     clearGuard(env) ]
 *
 * `decision_guard` (migration 202611071200) is an empty table with
 * `CHECK (decision_won = 1)`. `runDecision` returns `{ lost: true }` when the
 * guard is what failed, and rethrows any other failure so the caller says it in
 * its own sentence. Nothing after the guard is conditional: it runs for the
 * winner or not at all.
 */
import type { Env } from '../types';

const LOST = /decision_won/i;

/** Fails the batch unless the statement just before it changed exactly one row. */
export function decisionGuard(env: Env): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO decision_guard (decision_won) VALUES (CASE WHEN changes() = 1 THEN 1 ELSE 0 END)');
}

/** Empties the guard inside the same transaction; it only ever holds rows for that long. */
export function clearGuard(env: Env): D1PreparedStatement {
  return env.DB.prepare('DELETE FROM decision_guard');
}

export type DecisionRun = { lost: false; results: D1Result[] } | { lost: true };

/**
 * Runs a batch whose first statement is the decision and whose second is
 * `decisionGuard`. A guard that failed means the decision lost: nothing was
 * written. Any other failure is rethrown, also with nothing written.
 */
export async function runDecision(env: Env, statements: D1PreparedStatement[]): Promise<DecisionRun> {
  try {
    return { lost: false, results: await env.DB.batch(statements) };
  } catch (e) {
    if (LOST.test(e instanceof Error ? e.message : String(e))) return { lost: true };
    throw e;
  }
}
