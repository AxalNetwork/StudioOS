/**
 * D691 (S19-B, #1699) — migration 463, the stores behind Raise's records.
 *
 * Test 15 of #1699: 463 applies over a fresh bootstrap; a grep finds none of
 * its columns or tables in the baseline's or an earlier migration's
 * definition (D-t); rows written before it read today's behaviour.
 *
 * THE DATABASE IS BUILT AS `migrate-d1 --bootstrap` BUILDS ONE: the baseline,
 * then every migration after its cutoff and before 463 in order (410 and 442
 * among them), each statement skipped when the baseline already holds it, as
 * check-migration-declarations' freshBuild does. Rows are written there, as a
 * database that existed before 463 holds them, and 463 is applied last, whole,
 * and must succeed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/migration_463_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { splitStatements } from './_baseline.mjs';
import { declarationsFor } from '../../scripts/check-migration-declarations.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const FILE_463 = FILES.find((f) => migrationNumber(f) === 463) as string;
const SQL_463 = readFileSync(resolve(MIGRATIONS, FILE_463), 'utf8');
const EARLIER = FILES.filter((f) => migrationNumber(f) < 463);

/** The baseline and every post-cutoff migration before 463: a database that predates it. */
function bootstrap(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of EARLIER.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = bootstrap();
const BUILT_DDL = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                                  ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql as string);

/** A fresh copy of that database per test: its schema replayed, no rows. */
function before463(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* views and triggers that name absent objects */ } }
  return db;
}

const columnsOf = (db: DatabaseSync, table: string) =>
  new Map((db.prepare('SELECT name, "notnull" AS nn, dflt_value AS d FROM pragma_table_info(?)').all(table) as any[])
    .map((r) => [r.name, r]));

/** What 463 declares: its ADD COLUMNs and its new tables, read from the file itself. */
const MINE = declarationsFor(SQL_463);
const NEW_TABLES = ['data_room_file_versions', 'raise_prospect_events', 'raise_prospect_feedback', 'narrative_version_meta', 'use_of_funds_hires'];
const NEW_COLUMNS = [
  'pitch_deck_share_tokens.prospect_id', 'pitch_deck_share_tokens.investor_label',
  'pitch_deck_share_tokens.allow_download', 'pitch_deck_share_tokens.allow_forwarding',
  'pitch_deck_share_tokens.bound_viewer_hash',
  'data_room_files.access_tier', 'data_room_files.access_expires_at', 'data_room_files.dd_request_id',
  'raise_prospects.research_fund_uid',
];

test('463 declares exactly the issue\'s columns and tables, and none it rules out', () => {
  assert.ok(FILE_463, 'a migration numbered 463 exists');
  assert.deepEqual(MINE.alters.map((a: any) => `${a.table}.${a.column}`).sort(), [...NEW_COLUMNS].sort());
  assert.deepEqual([...MINE.tables.keys()].sort(), [...NEW_TABLES].sort());
  // Not added, each for its decision (4, 5, 6, 7).
  const declared = new Set(MINE.alters.map((a: any) => `${a.table}.${a.column}`));
  for (const t of MINE.tables.keys()) for (const c of MINE.tables.get(t)) declared.add(`${t}.${c}`);
  for (const ruled of ['pitch_deck_share_tokens.deck_version', 'data_room_grants.tier', 'cap_table_holders.prospect_id', 'narrative_version_meta.investor_type']) {
    assert.ok(!declared.has(ruled), `${ruled} is not added`);
  }
});

test('grep first (D-t): no column 463 adds is on its table in the baseline or an earlier migration, and no table it creates exists', () => {
  // Every definition before 463: the baseline's CREATE TABLEs and every earlier file's CREATEs and ADD COLUMNs.
  const earlier = new Map<string, Set<string>>();
  const note = (t: string, c: string) => { if (!earlier.has(t)) earlier.set(t, new Set()); earlier.get(t)!.add(c); };
  for (const sql of [BASELINE, ...EARLIER.map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))]) {
    const d = declarationsFor(sql);
    for (const [t, cols] of d.tables) { if (!earlier.has(t)) earlier.set(t, new Set()); for (const c of cols) note(t, c); }
    for (const a of d.alters) note(a.table, a.column);
  }
  for (const a of MINE.alters) {
    assert.ok(earlier.has(a.table), `${a.table} exists before 463`);
    assert.ok(!earlier.get(a.table)!.has(a.column), `${a.table}.${a.column} is new`);
  }
  for (const t of MINE.tables.keys()) assert.ok(!earlier.has(t), `${t} is new`);
  // The one name the issue says exists elsewhere: prospect_id, on safe_issuances (410) only.
  assert.ok(earlier.get('safe_issuances')?.has('prospect_id'));
});

test('463 applies whole over a fresh bootstrap, with 410 and 442 under it', () => {
  const db = bootstrap();
  assert.ok(columnsOf(db, 'safe_issuances').has('prospect_id'), '410 is applied');
  assert.ok(columnsOf(db, 'data_room_files').has('checklist_item'), '442 is applied');
  db.exec(SQL_463);
  for (const pair of NEW_COLUMNS) {
    const [t, c] = pair.split('.');
    assert.ok(columnsOf(db, t).has(c), `${pair} exists`);
  }
  for (const t of NEW_TABLES) {
    const cols = columnsOf(db, t);
    for (const c of ['id', 'uid', 'created_at', 'updated_at']) assert.ok(cols.has(c), `${t}.${c}`);
  }
  assert.ok(columnsOf(db, 'use_of_funds_hires').has('annual_cents'));
  assert.equal(columnsOf(db, 'use_of_funds_hires').get('currency').d, "'usd'");
});

test('a row written before 463 reads today\'s behaviour: any browser, Save as PDF, invited access, no investor', () => {
  const db = before463();
  db.exec(`INSERT INTO projects (id, name) VALUES (3, 'Kestrel Labs')`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, view_limit) VALUES (1, 7, 'h-old', '2026-11-01 00:00:00', 1)`);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key, visibility) VALUES (1, 'f-old', 3, 'Old file', 'k/old', 'nda')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (1, 'p-old', 3, 'Old Fund', 'to_contact')`);
  db.exec(SQL_463);
  const tok = db.prepare('SELECT allow_download, allow_forwarding, bound_viewer_hash, prospect_id, investor_label, view_limit FROM pitch_deck_share_tokens WHERE id = 1').get() as any;
  assert.deepEqual({ ...tok }, { allow_download: 1, allow_forwarding: 1, bound_viewer_hash: null, prospect_id: null, investor_label: null, view_limit: 1 });
  const file = db.prepare('SELECT access_tier, access_expires_at, dd_request_id, visibility FROM data_room_files WHERE id = 1').get() as any;
  assert.deepEqual({ ...file }, { access_tier: 'invited', access_expires_at: null, dd_request_id: null, visibility: 'nda' });
  assert.equal((db.prepare('SELECT research_fund_uid FROM raise_prospects WHERE id = 1').get() as any).research_fund_uid, null);
});

test('the CHECKs hold each closed list, and a new table row gets its own uid', () => {
  const db = before463();
  db.exec(SQL_463);
  db.exec(`INSERT INTO projects (id, name) VALUES (3, 'Kestrel Labs')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name) VALUES (5, 'p5', 3, 'Harbour Seed Fund')`);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key) VALUES (12, 'f12', 3, 'Board deck', 'k/12')`);
  const refused = (sql: string) => assert.throws(() => db.exec(sql), /CHECK constraint failed/, sql);

  refused(`INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, allow_download) VALUES (7, 'a', '2026-11-01', 2)`);
  refused(`INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, allow_forwarding) VALUES (7, 'b', '2026-11-01', -1)`);
  refused(`UPDATE data_room_files SET access_tier = 'public' WHERE id = 12`);
  refused(`INSERT INTO raise_prospect_events (prospect_id, kind) VALUES (5, 'lunch')`);
  refused(`INSERT INTO narrative_version_meta (project_id, version, start_from) VALUES (3, 1, 'draft')`);
  refused(`INSERT INTO use_of_funds_hires (project_id, category_key, role) VALUES (3, 'team', 'Engineer')`);

  for (const tier of ['invited', 'committed', 'nobody']) db.exec(`UPDATE data_room_files SET access_tier = '${tier}' WHERE id = 12`);
  for (const kind of ['meeting', 'intro', 'email', 'call', 'note']) db.exec(`INSERT INTO raise_prospect_events (prospect_id, kind) VALUES (5, '${kind}')`);
  for (const key of ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve']) {
    db.exec(`INSERT INTO use_of_funds_hires (project_id, category_key, role) VALUES (3, '${key}', 'Hire')`);
  }
  db.exec(`INSERT INTO narrative_version_meta (project_id, version) VALUES (3, 1)`);
  assert.equal((db.prepare('SELECT start_from FROM narrative_version_meta WHERE version = 1').get() as any).start_from, 'live');
  assert.throws(() => db.exec(`INSERT INTO narrative_version_meta (project_id, version) VALUES (3, 1)`), /UNIQUE/);
  db.exec(`INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (12, 1, 'k/12/v1')`);
  assert.throws(() => db.exec(`INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (12, 1, 'k/12/v1b')`), /UNIQUE/);
  db.exec(`INSERT INTO raise_prospect_feedback (prospect_id, objection) VALUES (5, 'Too early for us')`);
  assert.throws(() => db.exec(`INSERT INTO raise_prospect_feedback (prospect_id) VALUES (5)`), /NOT NULL/);

  const uids = (db.prepare(`SELECT uid FROM raise_prospect_events UNION ALL SELECT uid FROM use_of_funds_hires
                            UNION ALL SELECT uid FROM narrative_version_meta UNION ALL SELECT uid FROM data_room_file_versions
                            UNION ALL SELECT uid FROM raise_prospect_feedback`).all() as any[]).map((r) => r.uid);
  assert.equal(uids.length, 13);
  for (const u of uids) assert.match(u, /^[0-9a-f]{32}$/);
  assert.equal(new Set(uids).size, uids.length);
});

test('a prospect\'s events and feedback go with it, and a deleted prospect clears the link it was named on', () => {
  const db = before463();
  db.exec(SQL_463);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO projects (id, name) VALUES (3, 'Kestrel Labs')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name) VALUES (5, 'p5', 3, 'Harbour Seed Fund')`);
  db.exec(`INSERT INTO raise_prospect_events (prospect_id, kind) VALUES (5, 'call')`);
  db.exec(`INSERT INTO raise_prospect_feedback (prospect_id, objection) VALUES (5, 'Market size')`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, prospect_id) VALUES (41, 7, 'h41', '9999-12-31 23:59:59', 5)`);
  db.exec('DELETE FROM raise_prospects WHERE id = 5');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM raise_prospect_events').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM raise_prospect_feedback').get() as any).n, 0);
  assert.equal((db.prepare('SELECT prospect_id FROM pitch_deck_share_tokens WHERE id = 41').get() as any).prospect_id, null);
});
