/**
 * D156 — the three audit tables refuse a rewrite, and the one legitimate
 * mutation still lands.
 *
 * WHY THIS IS A REAL SQLITE TEST AND NOT A SOURCE SCAN. The thing being
 * asserted is a DATABASE constraint, and the whole point of D156 is that a
 * source-level guarantee cannot hold against a writer that does not live in
 * the source — a `wrangler d1 execute`, a queue job reaching DB.prepare()
 * directly. A scan of `cloudflare-worker/src` would pass today whether or not
 * migration 269 exists, so it cannot be the guard for it. D1 IS SQLite, so
 * `node:sqlite` applies the real migration file off disk and lets the engine
 * decide. `support_session_close_d122.test.ts` makes the same argument.
 *
 * THE MIGRATION IS READ VERBATIM, NEVER RESTATED. Copying the trigger bodies
 * into this file would test the copy. The file is applied as it ships, so a
 * trigger deleted or weakened in `269_audit_immutability.sql` fails here.
 *
 * THE TABLES COME FROM THE BASELINE. All three ship in `schema_baseline.sql`,
 * so a fixture that drifts from production fails loudly rather than passing
 * against a shape nothing runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const BASELINE = readFileSync(resolve(root, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(
  resolve(root, 'cloudflare-worker/sql/migrations/269_audit_immutability.sql'), 'utf8',
);

/** Verbatim from the baseline; a literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  // `);\n` and not the first `)` — a CHECK constraint closes parentheses too.
  const end = BASELINE.indexOf(');\n', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const SEALED = ['admin_audit_log', 'licence_events', 'impersonation_sessions'] as const;

function fresh(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  // The sealed tables carry REFERENCES clauses, and node:sqlite enforces them.
  // Stub parents keep foreign keys ON rather than switching them off, so a row
  // that could not exist in production cannot exist here either.
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE territory_licences (id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO users (id) VALUES (7), (99)');
  db.exec('INSERT INTO territory_licences (id) VALUES (3)');
  for (const t of SEALED) db.exec(ddl(t));
  db.exec(MIGRATION.replace(/^INSERT OR IGNORE INTO _migrations.*$/gm, ''));
  return db;
}

/** Runs `fn` and returns the ABORT message, or fails if nothing was raised. */
function refusal(fn: () => void, what: string): string {
  try { fn(); } catch (e) { return String((e as Error).message); }
  assert.fail(`${what} was accepted — the seal is not in force`);
}

test('the migration installs six triggers and names every sealed table', () => {
  const db = fresh();
  const rows = db.prepare(
    `SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`,
  ).all() as any[];
  assert.equal(rows.length, 6, `expected six triggers, found ${rows.length}`);
  // The property, not the spelling: every sealed table carries at least one.
  for (const t of SEALED) {
    assert.ok(rows.some((r) => r.tbl_name === t), `${t} carries no trigger`);
  }
});

test('admin_audit_log refuses an update and a delete, and still accepts an insert', () => {
  const db = fresh();
  db.exec(`INSERT INTO admin_audit_log (admin_user_id, action) VALUES (7, 'export_report')`);
  assert.equal(
    (db.prepare('SELECT COUNT(*) c FROM admin_audit_log').get() as any).c, 1,
    'the seal must not stop a row being recorded',
  );
  assert.match(
    refusal(() => db.exec(`UPDATE admin_audit_log SET action = 'something_else' WHERE id = 1`),
      'rewriting an audit row'),
    /append-only/i,
  );
  assert.match(
    refusal(() => db.exec(`DELETE FROM admin_audit_log WHERE id = 1`), 'deleting an audit row'),
    /append-only/i,
  );
  assert.equal((db.prepare('SELECT action FROM admin_audit_log WHERE id = 1').get() as any).action,
    'export_report', 'the row must survive both refusals unchanged');
});

test('licence_events refuses an update and a delete, and still accepts an insert', () => {
  const db = fresh();
  db.exec(`INSERT INTO licence_events (licence_id, event) VALUES (3, 'created')`);
  assert.match(
    refusal(() => db.exec(`UPDATE licence_events SET event = 'terminated' WHERE id = 1`),
      'rewriting a licence event'),
    /append-only/i,
  );
  assert.match(
    refusal(() => db.exec(`DELETE FROM licence_events WHERE id = 1`), 'deleting a licence event'),
    /append-only/i,
  );
  assert.equal((db.prepare('SELECT event FROM licence_events WHERE id = 1').get() as any).event,
    'created', 'the row must survive both refusals unchanged');
});

test('closing an OPEN impersonation session is permitted — the one mutation D122 needs', () => {
  const db = fresh();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context)
           VALUES (0, 41, 'hq_support:fr:looked into a failed payout')`);
  // The statement `util/supportSessionSweep.ts` runs, verbatim in shape.
  db.exec(`UPDATE impersonation_sessions
              SET ended_at = datetime(started_at, '+30 minutes')
            WHERE admin_user_id = 0 AND context LIKE 'hq_support:%' AND ended_at IS NULL`);
  const row = db.prepare('SELECT ended_at FROM impersonation_sessions WHERE id = 1').get() as any;
  assert.ok(row.ended_at, 'the sweep could not close the session — D122 is broken by the seal');
});

test('a CLOSED impersonation session cannot be re-closed, re-opened or re-attributed', () => {
  const db = fresh();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, ended_at)
           VALUES (7, 41, 'hq_support:fr:reason', '2026-09-18 10:00:00')`);
  // An end time already reported to the supervised party must not move.
  assert.match(
    refusal(() => db.exec(
      `UPDATE impersonation_sessions SET ended_at = '2026-09-18 12:00:00' WHERE id = 1`),
      're-closing a closed session'),
    /exactly one update/i,
  );
  assert.equal(
    (db.prepare('SELECT ended_at FROM impersonation_sessions WHERE id = 1').get() as any).ended_at,
    '2026-09-18 10:00:00', 'the recorded end time must survive the refusal',
  );
  // And re-opening one, which would hide a session that happened.
  assert.match(
    refusal(() => db.exec(`UPDATE impersonation_sessions SET ended_at = NULL WHERE id = 1`),
      're-opening a closed session'),
    /exactly one update/i,
  );
});

test('an update that leaves an OPEN session open is refused — closing is the only permitted one', () => {
  // The conjunct this covers is `NEW.ended_at IS NULL`, and it needs its own
  // test because the re-open case above is caught by `OLD.ended_at IS NOT NULL`
  // whether or not this one survives — an assertion that cannot fail on the
  // mutation it exists for is not a guard. The permitted mutation is stated as
  // CLOSING a session, so a statement that touches an open row and leaves it
  // open is not that statement, even when it changes nothing else.
  const db = fresh();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context)
           VALUES (7, 41, 'hq_support:fr:reason')`);
  assert.match(
    refusal(() => db.exec(
      `UPDATE impersonation_sessions SET context = context WHERE id = 1`),
      'an update that does not close the session'),
    /exactly one update/i,
  );
  assert.equal(
    (db.prepare('SELECT ended_at FROM impersonation_sessions WHERE id = 1').get() as any).ended_at,
    null, 'the session must still be open',
  );
});

test('who supported whom, and when it started, are not rewritable on an OPEN session', () => {
  const db = fresh();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at)
           VALUES (7, 41, 'hq_support:fr:reason', '2026-09-18 09:00:00')`);
  // Each field on its own, so the WHEN clause is exercised conjunct by
  // conjunct rather than by one statement that changes several at once.
  for (const [col, val] of [
    ['admin_user_id', '99'],
    ['target_user_id', '99'],
    ['started_at', `'2026-09-18 08:00:00'`],
    ['context', `'hq_support:fr:a different reason'`],
  ] as const) {
    assert.match(
      refusal(() => db.exec(
        `UPDATE impersonation_sessions SET ${col} = ${val}, ended_at = datetime('now') WHERE id = 1`),
        `rewriting ${col}`),
      /exactly one update/i,
    );
  }
  const row = db.prepare('SELECT * FROM impersonation_sessions WHERE id = 1').get() as any;
  assert.equal(row.admin_user_id, 7);
  assert.equal(row.target_user_id, 41);
  assert.equal(row.started_at, '2026-09-18 09:00:00');
  assert.equal(row.ended_at, null, 'no refused statement may have partially landed');
});

test('an impersonation session cannot be deleted', () => {
  const db = fresh();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id) VALUES (7, 41)`);
  assert.match(
    refusal(() => db.exec(`DELETE FROM impersonation_sessions WHERE id = 1`), 'deleting a session'),
    /append-only/i,
  );
});

test('the migration is idempotent and carries no transaction statement', () => {
  const db = fresh();
  // Re-running it must be a no-op rather than a duplicate-trigger error.
  db.exec(MIGRATION.replace(/^INSERT OR IGNORE INTO _migrations.*$/gm, ''));
  assert.equal(
    (db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type = 'trigger'`).get() as any).c, 6,
  );
  // The #26 lesson: D1's HTTP API rejects a transaction statement. Every
  // BEGIN here opens a TRIGGER BODY, so none of them is statement-leading.
  for (const line of MIGRATION.split('\n')) {
    assert.doesNotMatch(line, /^\s*(BEGIN\s*(TRANSACTION|DEFERRED|IMMEDIATE|EXCLUSIVE)?|COMMIT|ROLLBACK)\s*;/i,
      `a transaction statement reached the migration: ${line}`);
  }
});
