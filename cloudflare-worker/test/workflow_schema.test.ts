/**
 * The three tables nothing created, and the queries that assume them.
 *
 * `workflows`, `workflow_tasks` and `shared_services_log` were referenced by
 * four route files and defined nowhere — no migration, no ensureSchema, no
 * dev model. Migration 177 and `services/workflowSchema.ts` add them.
 *
 * The interesting risk now is not that the tables are missing again; the guard
 * `scripts/check-sqlite-tables.mjs` fails the build on that. It is that the
 * DDL and the queries disagree — a column the routes select that the schema
 * does not have produces exactly the same runtime "no such column" throw,
 * swallowed by exactly the same catch blocks, and looks exactly as absent.
 *
 * So the queries under test are not written here. They are READ OUT OF THE
 * ROUTE SOURCE and prepared against a real SQLite database built from the
 * shipped DDL. SQLite resolves every table and column name at prepare time, so
 * a mismatch fails here rather than in production. A query the routes stop
 * making stops being tested; a column they start selecting starts being.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeD1 } from './_d1_sqlite.mjs';
import { WORKFLOW_SCHEMA_DDL } from '../src/services/workflowSchema.ts';
import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';

/**
 * The three tables, as one hardcoded pattern rather than a list compiled into
 * a regex per name. Semgrep flags `new RegExp(...)` on a non-literal even when
 * the input is a frozen const, and it is right that there is no reason for one
 * here: this was the only use of the list, so a literal leaves nothing to
 * drift between the names and the pattern.
 */
const TOUCHES_A_SHARED_TABLE = /\b(?:workflows|workflow_tasks|shared_services_log)\b/;

/** The other tables the routes join to. Shapes only — no rows needed. */
const NEIGHBOURS = `
CREATE TABLE users    (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
`;

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(NEIGHBOURS);
  for (const stmt of WORKFLOW_SCHEMA_DDL) db.exec(stmt);
  return db;
}

const ROUTES = ['pipeline', 'networkfx', 'legalcap', 'dashboard'].map((n) => ({
  name: n,
  path: resolve(import.meta.dirname, `../src/routes/${n}.ts`),
}));

/** Every SQL string in the four routes that touches one of the three tables. */
function queriesUnderTest() {
  const out: Array<{ route: string; line: number; sql: string }> = [];
  for (const { name, path } of ROUTES) {
    for (const { body, line } of sqlStrings(readFileSync(path, 'utf8'))) {
      if (!TOUCHES_A_SHARED_TABLE.test(body)) continue;
      // getSQL's tagged template turns each ${…} into one bind. Same here, so
      // the statement SQLite sees is the statement D1 is handed.
      out.push({ route: name, line, sql: body.replace(/\$\{[^}]*\}/g, '?') });
    }
  }
  return out;
}

test('every route query over the three tables prepares against the shipped DDL', () => {
  const found = queriesUnderTest();
  // If this drops to nothing the test has stopped testing anything — most
  // likely because sqlStrings no longer recognises how the routes build SQL.
  assert.ok(found.length >= 10, `expected the four routes to carry ≥10 such queries, found ${found.length}`);

  const db = freshDb();
  const failures: string[] = [];
  for (const { route, line, sql } of found) {
    try {
      db.prepare(sql);
    } catch (e: any) {
      failures.push(`  routes/${route}.ts:${line}  ${e?.message}\n      ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.equal(failures.length, 0, `schema and queries disagree:\n${failures.join('\n')}`);
});

test('the DDL is idempotent — a second bootstrap over a live table is a no-op', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO workflows (title, template_key) VALUES ('keep me', 'k')`).run();
  for (const stmt of WORKFLOW_SCHEMA_DDL) db.exec(stmt);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM workflows`).get() as { n: number };
  assert.equal(row.n, 1, 're-running the bootstrap must not drop or duplicate rows');
});

test('find-or-create cannot produce two workflows for one template key', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name) VALUES (1, 'p')`).run();

  // Project-scoped: what pipeline and legalcap do.
  db.prepare(`INSERT INTO workflows (title, project_id, template_key) VALUES ('a', 1, 'pipeline.gate_review')`).run();
  assert.throws(
    () => db.prepare(`INSERT INTO workflows (title, project_id, template_key) VALUES ('b', 1, 'pipeline.gate_review')`).run(),
    /UNIQUE/,
    'a racing second request must not create a duplicate project workflow',
  );

  // Project-less: what networkfx does. SQLite treats NULLs as distinct, so
  // this case needs its own partial index — the reason there are two.
  db.prepare(`INSERT INTO workflows (title, template_key) VALUES ('a', 'marketplace.intros')`).run();
  assert.throws(
    () => db.prepare(`INSERT INTO workflows (title, template_key) VALUES ('b', 'marketplace.intros')`).run(),
    /UNIQUE/,
    'the project-less marketplace workflow must be unique too',
  );
});

test('a task cannot outlive the workflow it belongs to', () => {
  const db = freshDb();
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare(`INSERT INTO workflows (id, title) VALUES (7, 'w')`).run();
  db.prepare(`INSERT INTO workflow_tasks (workflow_id, title) VALUES (7, 't')`).run();
  db.prepare(`DELETE FROM workflows WHERE id = 7`).run();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM workflow_tasks`).get() as { n: number };
  assert.equal(row.n, 0, 'ON DELETE CASCADE should have taken the task with it');
});

test('the D1 binding runs the real DDL — ensureWorkflowSchema is executable, not decorative', async () => {
  const { DB } = makeD1(NEIGHBOURS);
  for (const stmt of WORKFLOW_SCHEMA_DDL) await DB.prepare(stmt).run();
  // `performed_by` is a real FK and node:sqlite enforces it, so the actor has
  // to exist — which is the point: the ledger cannot record a phantom caller.
  await DB.prepare(`INSERT INTO users (id, name, email) VALUES (3, 'a', 'a@x')`).run();
  await DB.prepare(
    `INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, 'ai_call', '{}', 3)`,
  ).run();
  const row: any = await DB.prepare(
    `SELECT COUNT(*) AS n FROM shared_services_log WHERE performed_by = ? AND action_type = 'ai_call'`,
  ).bind(3).first();
  assert.equal(Number(row?.n), 1);
});
