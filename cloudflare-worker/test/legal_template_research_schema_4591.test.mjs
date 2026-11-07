/**
 * #4591 (R2-03, option B) — a database built from the committed provisioning
 * files alone has the five legal-template research objects production has,
 * with the same columns, defaults, unique constraints, foreign keys, index and
 * view, and does not have `axal_group_entity_draft_facts`, which the owner
 * decided is not intended.
 *
 * The build is the post-deploy parity check's own (`buildFresh` over
 * `schema_baseline.sql` plus `postCutoffMigrations()`), so this test and
 * `scripts/check-baseline-drift.mjs` look at the same database. Production's
 * DDL below is the text the deploy job's parity step printed from production's
 * sqlite_master (schema only, no rows).
 *
 *   node --test cloudflare-worker/test/legal_template_research_schema_4591.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = '202611071051_declare_legal_template_research.sql';

/** Production's DDL for the five, as its sqlite_master holds it. */
const PRODUCTION = {
  'table:legal_template_research_drafts': "CREATE TABLE legal_template_research_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, template_slug TEXT NOT NULL, jurisdiction TEXT NOT NULL, draft_body_md TEXT NOT NULL DEFAULT '', review_notes TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending_counsel_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(template_id,jurisdiction), FOREIGN KEY(template_id) REFERENCES legal_templates(id))",
  'table:legal_template_proposals': "CREATE TABLE legal_template_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, entity TEXT NOT NULL, priority TEXT NOT NULL, kind TEXT NOT NULL, draft_body_md TEXT NOT NULL, source_urls_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending_counsel_review', created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  'table:legal_template_review_events': "CREATE TABLE legal_template_review_events (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, review_type TEXT NOT NULL, jurisdiction TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer TEXT, source_reference TEXT, review_due_at TEXT, reviewed_at TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(template_id) REFERENCES legal_templates(id))",
  'index:idx_legal_template_review_events_status': 'CREATE INDEX idx_legal_template_review_events_status ON legal_template_review_events(status,template_id)',
  'view:legal_template_research_queue': 'CREATE VIEW legal_template_research_queue AS SELECT t.id AS template_id,t.slug,t.title,t.category,t.version AS live_version,t.is_stub,d.status AS research_status,d.jurisdiction,d.review_notes,d.citations_json,length(d.draft_body_md) AS draft_chars,d.updated_at FROM legal_templates t JOIN legal_template_research_drafts d ON d.template_id=t.id',
};
const NOT_INTENDED = 'axal_group_entity_draft_facts';

const fresh = () => buildFresh(BASELINE, postCutoffMigrations(new URL(root).pathname).map((m) => m.sql));
const master = (db, name) => db.prepare('SELECT type, name, sql FROM sqlite_master WHERE name = ?').get(name);
/** name, type, NOT NULL, default, primary key: what a column is. */
const columns = (db, table) => db.prepare('SELECT name, type, "notnull" AS nn, dflt_value AS dflt, pk FROM pragma_table_info(?) ORDER BY cid').all(table)
  .map((c) => [c.name, c.type, c.nn, c.dflt, c.pk]);
/** Each unique index's columns, in order: what a UNIQUE constraint is. */
const uniques = (db, table) => db.prepare("SELECT name FROM pragma_index_list(?) WHERE \"unique\" = 1 AND origin = 'u'").all(table)
  .map(({ name }) => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(name).map((c) => c.name)).sort();
const foreignKeys = (db, table) => db.prepare('SELECT "table" AS target, "from" AS col, "to" AS ref FROM pragma_foreign_key_list(?)').all(table)
  .map((f) => [f.col, f.target, f.ref]);

function verify(db) {
  // Every object exists, written exactly as production's sqlite_master holds it.
  for (const [key, sql] of Object.entries(PRODUCTION)) {
    const [type, name] = key.split(':');
    const row = master(db, name);
    assert.ok(row, `${key} exists`);
    assert.equal(row.type, type, key);
    assert.equal(row.sql, sql, `${key} is production's DDL`);
  }

  assert.deepEqual(columns(db, 'legal_template_research_drafts'), [
    ['id', 'INTEGER', 0, null, 1],
    ['template_id', 'INTEGER', 1, null, 0],
    ['template_slug', 'TEXT', 1, null, 0],
    ['jurisdiction', 'TEXT', 1, null, 0],
    ['draft_body_md', 'TEXT', 1, "''", 0],
    ['review_notes', 'TEXT', 1, null, 0],
    ['citations_json', 'TEXT', 1, "'[]'", 0],
    ['status', 'TEXT', 1, "'pending_counsel_review'", 0],
    ['created_at', 'TEXT', 1, 'CURRENT_TIMESTAMP', 0],
    ['updated_at', 'TEXT', 1, 'CURRENT_TIMESTAMP', 0],
  ]);
  assert.deepEqual(columns(db, 'legal_template_proposals'), [
    ['id', 'INTEGER', 0, null, 1],
    ['slug', 'TEXT', 1, null, 0],
    ['title', 'TEXT', 1, null, 0],
    ['entity', 'TEXT', 1, null, 0],
    ['priority', 'TEXT', 1, null, 0],
    ['kind', 'TEXT', 1, null, 0],
    ['draft_body_md', 'TEXT', 1, null, 0],
    ['source_urls_json', 'TEXT', 1, "'[]'", 0],
    ['status', 'TEXT', 1, "'pending_counsel_review'", 0],
    ['created_at', 'TEXT', 0, 'CURRENT_TIMESTAMP', 0],
  ]);
  assert.deepEqual(columns(db, 'legal_template_review_events'), [
    ['id', 'INTEGER', 0, null, 1],
    ['template_id', 'INTEGER', 1, null, 0],
    ['review_type', 'TEXT', 1, null, 0],
    ['jurisdiction', 'TEXT', 0, null, 0],
    ['status', 'TEXT', 1, "'pending'", 0],
    ['reviewer', 'TEXT', 0, null, 0],
    ['source_reference', 'TEXT', 0, null, 0],
    ['review_due_at', 'TEXT', 0, null, 0],
    ['reviewed_at', 'TEXT', 0, null, 0],
    ['notes', 'TEXT', 0, null, 0],
    ['created_at', 'TEXT', 0, 'CURRENT_TIMESTAMP', 0],
  ]);

  // The unique constraints and the foreign keys.
  assert.deepEqual(uniques(db, 'legal_template_research_drafts'), [['template_id', 'jurisdiction']]);
  assert.deepEqual(uniques(db, 'legal_template_proposals'), [['slug']]);
  assert.deepEqual(uniques(db, 'legal_template_review_events'), []);
  assert.deepEqual(foreignKeys(db, 'legal_template_research_drafts'), [['template_id', 'legal_templates', 'id']]);
  assert.deepEqual(foreignKeys(db, 'legal_template_review_events'), [['template_id', 'legal_templates', 'id']]);
  assert.deepEqual(foreignKeys(db, 'legal_template_proposals'), []);

  // The index, by its columns in order.
  assert.deepEqual(db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all('idx_legal_template_review_events_status').map((c) => c.name),
    ['status', 'template_id']);

  // The view: its columns, and that it reads through to legal_templates.
  assert.deepEqual(db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all('legal_template_research_queue').map((c) => c.name), [
    'template_id', 'slug', 'title', 'category', 'live_version', 'is_stub', 'research_status',
    'jurisdiction', 'review_notes', 'citations_json', 'draft_chars', 'updated_at',
  ]);

  // The table the owner decided is not intended is not declared anywhere.
  assert.equal(master(db, NOT_INTENDED), undefined, `${NOT_INTENDED} is absent`);
}

test('a database built from the baseline and the later migrations has the five objects exactly, and not the sixth', () => {
  const db = fresh();
  try {
    verify(db);
    // Made-up rows: the constraints hold and the view joins.
    db.prepare("INSERT INTO legal_templates (id, slug, title, category) VALUES (990007, 'test-4591-nda', 'NDA', 'gp')").run();
    db.prepare("INSERT INTO legal_template_research_drafts (template_id, template_slug, jurisdiction, review_notes) VALUES (990007, 'test-4591-nda', 'DE', 'n')").run();
    assert.throws(() => db.prepare("INSERT INTO legal_template_research_drafts (template_id, template_slug, jurisdiction, review_notes) VALUES (990007, 'test-4591-nda', 'DE', 'n')").run(), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO legal_template_research_drafts (template_id, template_slug, jurisdiction, review_notes) VALUES (990099, 'x', 'DE', 'n')").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("INSERT INTO legal_template_review_events (template_id, review_type) VALUES (990099, 'x')").run(), /FOREIGN KEY/);
    db.prepare("INSERT INTO legal_template_proposals (slug, title, entity, priority, kind, draft_body_md) VALUES ('test-4591-a', 't', 'e', 'p', 'k', 'b')").run();
    assert.throws(() => db.prepare("INSERT INTO legal_template_proposals (slug, title, entity, priority, kind, draft_body_md) VALUES ('test-4591-a', 't', 'e', 'p', 'k', 'b')").run(), /UNIQUE/);
    assert.deepEqual({ ...db.prepare('SELECT template_id, live_version, research_status, draft_chars FROM legal_template_research_queue WHERE template_id = 990007').get() },
      { template_id: 990007, live_version: 1, research_status: 'pending_counsel_review', draft_chars: 0 });
  } finally { db.close(); }
});

test('the migration alone declares the same five: a baseline without them, plus the migrations, builds the same', () => {
  // Strip the five from the baseline, as a database provisioned before this
  // change would be, and let the migration create them.
  let older = BASELINE;
  for (const sql of Object.values(PRODUCTION)) {
    assert.ok(older.includes(`${sql};`), 'the baseline holds production\'s text');
    older = older.replace(`${sql};`, '');
  }
  const db = buildFresh(older, postCutoffMigrations(new URL(root).pathname).map((m) => m.sql));
  try { verify(db); } finally { db.close(); }
});

test('the migration is append-only and a no-op where the objects already exist', () => {
  const names = postCutoffMigrations(new URL(root).pathname).map((m) => m.name);
  assert.ok(names.includes(MIGRATION), 'it is one of the files the parity check applies');
  const lastNumbered = names.reduce((at, n, i) => (/^\d{1,3}_/.test(n) ? i : at), -1);
  assert.ok(names.indexOf(MIGRATION) > lastNumbered, 'it applies after every numbered file');
  const sql = read(`cloudflare-worker/sql/migrations/${MIGRATION}`);
  const statements = sql.split('\n').filter((l) => /^CREATE /.test(l));
  assert.equal(statements.length, 5);
  for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX|VIEW) IF NOT EXISTS /, s.slice(0, 60));
  assert.doesNotMatch(sql, /\b(DROP|ALTER|INSERT|UPDATE|DELETE)\b/i, 'it only declares');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), new RegExp(NOT_INTENDED), 'the sixth is not declared');
  // Applied twice on the fresh build, nothing changes.
  const db = fresh();
  try {
    const before = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'legal_template%' OR name LIKE 'idx_legal_template%' ORDER BY name").all();
    db.exec(sql);
    const after = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'legal_template%' OR name LIKE 'idx_legal_template%' ORDER BY name").all();
    assert.deepEqual(after, before);
  } finally { db.close(); }
});
