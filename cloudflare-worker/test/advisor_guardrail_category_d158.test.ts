/**
 * D158 — the guardrail category is stored, and the two definitions of the table
 * it is stored in agree.
 *
 * WHY THE TWO-DEFINITIONS TEST IS THE ONE THAT MATTERS. `advisor_turn_audit`
 * is declared twice: migration 043's lineage, and `ensureAuditSchema`'s
 * `CREATE TABLE IF NOT EXISTS`. A CREATE-IF-NOT-EXISTS cannot add a column to
 * an existing table, so a migration alone leaves the bootstrap stale and the
 * shape you get depends on which ran first — the `metrics_snapshots` collision
 * (#183, #202). Nothing guarded that before; this does.
 *
 * REAL SQLITE, NOT A SQL-TEXT STUB. What is asserted is what the statements DO
 * to rows — a column reaching the insert, a pre-270 database being migrated in
 * place by the bootstrap, a null staying null. A stub that matched SQL text
 * would pass against a shape production does not have.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/270_advisor_guardrail_category.sql');
const GUARDRAILS = read('cloudflare-worker/src/services/advisor/guardrails.ts');
const ADVISOR = read('cloudflare-worker/src/routes/advisor.ts');
const ROUTER = read('cloudflare-worker/src/services/aiRouter.ts');
const SECURITY = read('cloudflare-worker/src/routes/admin_security.ts');

/** The table as migration 043 declares it — the shape that predates D158. */
const PRE_270 = `CREATE TABLE advisor_turn_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  model TEXT,
  prompt_hash TEXT NOT NULL,
  tool_calls_json TEXT,
  ai_spend_usd REAL NOT NULL DEFAULT 0,
  safety_score REAL,
  sanitisation_actions_json TEXT,
  refusal_reason TEXT,
  shadow_flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const cols = (db: InstanceType<typeof DatabaseSync>) =>
  new Set((db.prepare(`PRAGMA table_info(advisor_turn_audit)`).all() as any[]).map((r) => r.name));

test('the migration adds the column to a database that predates it, and moves no rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(PRE_270);
  db.exec(`INSERT INTO advisor_turn_audit (user_id, prompt_hash, refusal_reason)
           VALUES (7, 'abc', 'safety_block')`);
  assert.ok(!cols(db).has('guardrail_category'), 'the fixture is not the pre-270 shape');

  db.exec(MIGRATION);

  assert.ok(cols(db).has('guardrail_category'), 'the migration did not add the column');
  const row = db.prepare('SELECT * FROM advisor_turn_audit WHERE id = 1').get() as any;
  assert.equal(row.refusal_reason, 'safety_block', 'the existing row was disturbed');
  // THE ROW READS UNKNOWN, NOT SAFE. Production carries 121 such rows, 8 of
  // them refusals. A null rendered as a verdict would be a claim nothing made.
  assert.equal(row.guardrail_category, null, 'an un-backfilled row acquired a category');
});

test('the runtime bootstrap declares the same column, and repairs a table that predates it', () => {
  // The bootstrap's CREATE, sliced from the source rather than restated — a
  // copy here would test the copy.
  const at = GUARDRAILS.indexOf('CREATE TABLE IF NOT EXISTS advisor_turn_audit');
  assert.ok(at > 0, 'the runtime bootstrap is gone');
  const ddl = GUARDRAILS.slice(at, GUARDRAILS.indexOf('"', at));
  assert.match(ddl, /guardrail_category TEXT/,
    'the bootstrap CREATE lost the column — a fresh database would disagree with migration 270');

  // And the half a CREATE cannot do: the PRAGMA-guarded ADD COLUMN.
  assert.match(GUARDRAILS, /PRAGMA table_info\(advisor_turn_audit\)/,
    'nothing repairs a database whose table predates the column');
  assert.match(GUARDRAILS, /ALTER TABLE advisor_turn_audit ADD COLUMN guardrail_category TEXT/,
    'the bootstrap cannot add the column to an existing table');

  // The two definitions must agree on every column, which is the property the
  // #183/#202 collision came from nobody checking.
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(ddl.replace('IF NOT EXISTS ', ''));
  const migrated = new DatabaseSync(':memory:');
  migrated.exec(PRE_270);
  migrated.exec(MIGRATION);
  assert.deepEqual([...cols(fresh)].sort(), [...cols(migrated)].sort(),
    'the bootstrap and the migration produce different tables');
});

test('the insert carries the column, and a null category stays null', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(PRE_270);
  db.exec(MIGRATION);
  // The statement `writeTurnAudit` runs, sliced from the source.
  const at = GUARDRAILS.indexOf('INSERT INTO advisor_turn_audit');
  const sql = GUARDRAILS.slice(at, GUARDRAILS.indexOf('`', at));
  assert.match(sql, /guardrail_category/, 'the insert does not carry the column');
  assert.equal((sql.match(/\?/g) || []).length, 11,
    'the placeholder count no longer matches the column list');

  db.prepare(sql).run(7, null, null, 'h', '[]', 0, 0.2, '[]', 'safety_block', 0, 's10');
  db.prepare(sql).run(7, null, null, 'h', '[]', 0, null, '[]', null, 0, null);
  const rows = db.prepare('SELECT guardrail_category AS c FROM advisor_turn_audit ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => r.c), ['s10', null],
    'a classified turn and an unclassified one must not be stored alike');
});

test('the category travels with the score at every audit write', () => {
  // THE RULE, SWEPT RATHER THAN COUNTED. Seventeen `writeTurnAudit` call sites;
  // seven have a `safety` result in scope and ten do not. Every line binding a
  // score binds a category of the matching kind — and because the interface
  // field is REQUIRED, the typechecker refuses an eighteenth site that omits
  // it, which is a guard that cannot be forgotten to run.
  const withScore = ADVISOR.split('\n').filter((l) => l.includes('safetyScore: safety.score'));
  const withNull = ADVISOR.split('\n').filter((l) => l.includes('safetyScore: null'));
  assert.ok(withScore.length >= 7, `expected the sites that classify, found ${withScore.length}`);
  assert.ok(withNull.length >= 10, `expected the sites that do not, found ${withNull.length}`);
  for (const l of withScore) {
    assert.match(l, /guardrailCategory: safety\.category/,
      `an audit write with a safety result drops the category: ${l.trim().slice(0, 70)}`);
  }
  for (const l of withNull) {
    assert.match(l, /guardrailCategory: null/,
      `an audit write without a safety result invents a category: ${l.trim().slice(0, 70)}`);
  }
  assert.match(GUARDRAILS, /guardrailCategory: string \| null;/,
    'the field became optional, so the compiler stopped enforcing the rule above');
});

test('the stored value has a reader on the day it is stored', () => {
  // The eleventh producer-with-no-reader in this programme is not allowed to
  // become the twelfth by being written and never read.
  assert.match(ROUTER, /GROUP BY COALESCE\(guardrail_category, ''\)/,
    'nothing reads the category back');
  assert.match(ROUTER, /rules: catRows\.filter/, 'the rollup stopped returning the breakdown');
  assert.match(ROUTER, /unclassified: catRows\.find/,
    'un-categorised turns stopped being counted separately');
  // A rule is an S-code; everything else describes the classification.
  assert.match(ROUTER, /const isRule = \(c: string\) => \/\^s\\d\+\$\/\.test\(c\)/,
    'the rule/state split is gone — a router failure would read as a rule that fired');
});

test('the refusal that said this could not be counted is gone, and the others stay', () => {
  // D152 filed the category as uncounted and put a row on HQ's Security page
  // saying so. D158 makes that row false, so it is removed rather than reworded
  // — the twelfth refusal in this programme to be re-aimed the day it stopped
  // being true, and the first the codebase had filed against itself.
  assert.doesNotMatch(SECURITY, /what: 'Which guardrail rule fired'/,
    'the panel still refuses a breakdown it now serves');
  for (const what of ['Token anomalies', 'Guardrail counters by branch']) {
    assert.ok(SECURITY.includes(`what: '${what}'`),
      `${what} lost its row without the absence being closed`);
  }
});
