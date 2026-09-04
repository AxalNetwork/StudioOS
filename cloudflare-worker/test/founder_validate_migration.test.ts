/**
 * Migration 211 against real SQLite, and the evidence fold against real rows.
 *
 * The unit tests next door prove `verdictFor` refuses a verdict when a fit is
 * unrecorded. They cannot prove that the rows reaching it are counted right —
 * that an interview naming four matching pains counts once, that an explicit
 * `none` is not confused with a NULL, that a contradiction from a non-ICP
 * interviewee still counts. Those are fold bugs, and a fold bug produces a
 * number that is merely wrong rather than obviously broken.
 *
 * Real SQLite rather than a stub, for the reason the other migration tests give:
 * the file is DDL, and asserting that DDL does what its author thinks is the
 * whole exercise. A stub would replay my assumptions back at me.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceFor, verdictFor, isIcp } from '../src/routes/_founder_validate_helpers.ts';

const DIR = join(resolve(process.cwd()), 'cloudflare-worker', 'sql', 'migrations');
const SQL = readFileSync(join(DIR, '211_founder_validate_evidence.sql'), 'utf8');
const ddl = (s: string) => s.replace(/^\s*--[^\n]*$/gm, '');

/**
 * The tables migration 211 assumes already exist — AT THE SHAPE PRODUCTION HAS,
 * not the shape `schema.sql` shows.
 *
 * The first version of this fixture copied `CREATE TABLE discovery_interviews`
 * from `schema.sql:581`, which is the ten columns the table was born with.
 * Production has fourteen: `featured`, `validation_rating`,
 * `validation_comment` and `icp_fit` arrived by ALTER in later migrations, and
 * `schema.sql` is never updated for those. Against the stale shape, a migration
 * that re-added `icp_fit` passed every test here and would have failed the
 * deploy with "duplicate column name". The fixture below is
 * `PRAGMA table_info(discovery_interviews)` from production, verbatim.
 */
function base(): InstanceType<typeof DatabaseSync> {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      interviewee_name TEXT NOT NULL,
      interviewee_role TEXT,
      interview_date TEXT,
      notes TEXT,
      hypotheses_json TEXT,
      pains_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      featured INTEGER NOT NULL DEFAULT 0,
      validation_rating INTEGER,
      validation_comment TEXT,
      icp_fit TEXT
    );
    CREATE TABLE pain_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Verwood', 42);
  `);
  d.exec(SQL);
  return d;
}

test('the migration applies against the schema it assumes', () => {
  const d = base();
  const tables = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all().map((r: any) => r.name);
  for (const t of ['hypotheses', 'hypothesis_pain_links', 'validation_decisions',
    'interview_pain_severities']) {
    assert.ok(tables.includes(t), `${t} was not created`);
  }
  const cols = d.prepare('PRAGMA table_info(discovery_interviews)')
    .all().map((r: any) => r.name);
  for (const col of ['icp_fit', 'quote_consent', 'interviewee_company']) {
    assert.ok(cols.includes(col), `discovery_interviews.${col} was not added`);
  }
});

test('it does not re-add a column an earlier migration already added', () => {
  // The bug this fixture's docblock describes, pinned. `icp_fit` came from
  // migration 161; re-adding it here fails the deploy with "duplicate column
  // name" and the runner stops at the first bad statement, taking every later
  // migration and the Worker with it.
  assert.doesNotMatch(ddl(SQL), /ADD COLUMN\s+icp_fit\b/i,
    'icp_fit exists since migration 161 — an ALTER for it aborts the production deploy');
  // And the fixture must actually carry it, or this assertion could pass while
  // the fixture drifts back to the stale schema.sql shape.
  const d = base();
  const cols = d.prepare('PRAGMA table_info(discovery_interviews)').all().map((r: any) => r.name);
  assert.ok(cols.includes('icp_fit'), 'the fixture must model production, which has icp_fit');
  assert.equal(cols.length, 16, `production has 14 columns; 211 adds 2; fixture has ${cols.length}`);
});

test('the new interview columns default to NOT RECORDED, never to a value', () => {
  // The whole product rule in one assertion. A `DEFAULT 0` on quote_consent
  // would assert "this person declined to be quoted" about every interview
  // ever logged — a claim nobody made about anybody.
  const d = base();
  d.exec("INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (1, 'Sarah')");
  const row: any = d.prepare('SELECT icp_fit, quote_consent, interviewee_company FROM discovery_interviews').get();
  assert.equal(row.icp_fit, null);
  assert.equal(row.quote_consent, null, 'consent must default to unknown, not to refused');
  assert.equal(row.interviewee_company, null);
});

test('D1 will accept it — no transaction statements, and the tables are replayable', () => {
  // The runner aborts the whole deploy on one bad statement, and D1 rejects
  // transaction control inside a migration outright (migration 200 was
  // rewritten for exactly that).
  assert.doesNotMatch(SQL, /\b(BEGIN|COMMIT|ROLLBACK)\s+TRANSACTION\b/i);
  const code = ddl(SQL);
  assert.deepEqual(code.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || [], []);
  assert.deepEqual(code.match(/CREATE (?:UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || [], []);
  // The ALTERs are the deliberate exception and the file says so. Asserting
  // full replayability here would be asserting something false — SQLite has no
  // ADD COLUMN IF NOT EXISTS — so what is checked is that the caveat is stated.
  assert.match(SQL, /IDEMPOTENCY CAVEAT/, 'the non-idempotent ALTERs must stay documented');
});

test('nothing derived is stored', () => {
  const code = ddl(SQL);
  for (const banned of [/\bverdict\s+(TEXT|INTEGER)/i, /\blane\s+(TEXT|INTEGER)/i,
    /\bsupporting_count\b/i, /\bfor_count\b/i, /\bis_validated\b/i, /\bdeck_ready\b/i]) {
    assert.doesNotMatch(code, banned, `${banned} names a value computed at read time`);
  }
  // `validation_decisions.decision` is NOT derived — it is the founder's own
  // statement — so a blanket ban on the word would be wrong. Assert it exists.
  assert.match(code, /CREATE TABLE IF NOT EXISTS validation_decisions/);
});

test('a link cannot be duplicated, and a hypothesis code is unique per project', () => {
  const d = base();
  d.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (10, 1, 'Async handoffs')");
  d.exec("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (1, 1, 'H1', 'teams lose context')");
  d.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 10, 'supports')");
  assert.throws(
    () => d.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 10, 'supports')"),
    /UNIQUE/, 'the same link twice would double an evidence count',
  );
  // The opposite direction is a different row on purpose: a founder may record
  // that one theme both supports and cuts against a claim.
  d.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 10, 'contradicts')");
  assert.throws(
    () => d.exec("INSERT INTO hypotheses (project_id, code, claim) VALUES (1, 'H1', 'another')"),
    /UNIQUE/, 'two H1s on one project would make the handle ambiguous',
  );
});

test('deleting a project takes its board with it', () => {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      interviewee_name TEXT NOT NULL, pains_json TEXT
    );
    CREATE TABLE pain_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL
    );
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Verwood', 42);
  `);
  d.exec(SQL);
  d.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (10, 1, 'Async')");
  d.exec("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (1, 1, 'H1', 'x')");
  d.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 10, 'supports')");
  d.exec("INSERT INTO validation_decisions (project_id, decision) VALUES (1, 'proceed')");
  d.exec('DELETE FROM projects WHERE id = 1');
  for (const t of ['hypotheses', 'hypothesis_pain_links', 'validation_decisions']) {
    assert.equal((d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n, 0,
      `${t} outlived its project`);
  }
});

// ---------------------------------------------------------------------------

test('the fold counts interviews, not pain matches', () => {
  const links = [
    { pain_group_id: 10, direction: 'supports' },
    { pain_group_id: 11, direction: 'supports' },
  ];
  // One interviewee who named both themes must count once, not twice.
  const e = evidenceFor(links, [{ icp_fit: 'strong', groups: new Set([10, 11]) }]);
  assert.equal(e.supporting, 1, 'a talkative interviewee must not outvote a room');
});

test('the For/Against asymmetry holds against rows', () => {
  const links = [
    { pain_group_id: 10, direction: 'supports' },
    { pain_group_id: 20, direction: 'contradicts' },
  ];
  const e = evidenceFor(links, [
    { icp_fit: 'strong', groups: new Set([10]) },   // ICP, supports → For
    { icp_fit: 'partial', groups: new Set([10]) },  // ICP, supports → For
    { icp_fit: 'none', groups: new Set([10]) },     // recorded non-ICP → neither
    { icp_fit: null, groups: new Set([10]) },       // unknown → the third count
    { icp_fit: 'none', groups: new Set([20]) },     // anyone at all can contradict
    { icp_fit: null, groups: new Set([20]) },       // including an unknown fit
  ]);
  assert.deepEqual(e, { supporting: 2, contradicting: 2, fitUnrecorded: 1 });
  // The `none` interview is the one that must not be confused with a NULL:
  // "we checked, they were not our customer" is a recorded fact.
  assert.equal(isIcp('none'), false);
  assert.equal(isIcp(null), false);
});

test('rows with no fit recorded make the verdict unknowable, not "unproven"', () => {
  // The end-to-end version of the rule. Five supporters, none of whom has a
  // fit recorded: the naive answer is "0 for, unproven"; the true answer is
  // that nobody has said who these people were.
  const links = [{ pain_group_id: 10, direction: 'supports' }];
  const e = evidenceFor(links, Array.from({ length: 5 }, () => ({
    icp_fit: null, groups: new Set([10]),
  })));
  assert.deepEqual(e, { supporting: 0, contradicting: 0, fitUnrecorded: 5 });
  assert.equal(verdictFor(e), null,
    'five unknown-fit supporters is not evidence of absence');
});

test('an interview that touches nothing is not evidence either way', () => {
  const links = [{ pain_group_id: 10, direction: 'supports' }];
  const e = evidenceFor(links, [{ icp_fit: null, groups: new Set([99]) }]);
  assert.deepEqual(e, { supporting: 0, contradicting: 0, fitUnrecorded: 0 },
    'an unrelated interview must not inflate the unknown count either');
  assert.equal(verdictFor(e), 'unproven', 'with nothing touching it, unproven is honest');
});
