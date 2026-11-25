/** D8605 (#8605): the Network-to-Research bridge keeps its Research targets as plain uids; fund re-imports carry links. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const MIGRATIONS = new URL('../sql/migrations/', import.meta.url);
const OLD = readFileSync(new URL('202611191414_7672_network_directory.sql', MIGRATIONS), 'utf8');
const NEW = readFileSync(new URL('202611251148_8605_network_research_links_soft_refs.sql', MIGRATIONS), 'utf8');
const IMPORTER = fileURLToPath(new URL('../../scripts/import-research-funds.py', import.meta.url));
const LIST = 'Synthetic fund list 8605';
const THIS = '202611251148_8605_network_research_links_soft_refs.sql';
const EURO = 'EuroTech VC Funds (public spreadsheet)';
const SHAI = 'Shai Goldman — new VC funds at/below $200M';
const at = '2026-11-25T00:00:00Z';

/** The fresh schema, foreign keys on, with one Network organisation, its source record and a reviewer. */
function fresh() {
  const d = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(d);
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`INSERT INTO network_directory_sources (uid,name,url) VALUES ('src-8605','Synthetic source','https://network.example.test');
    INSERT INTO network_directory_entries (uid,kind,source_uid,source_external_id,display_name,observed_at)
      VALUES ('org-8605','organization','src-8605','ext-org','Example Capital','${at}'),
             ('person-8605','person','src-8605','ext-person','Example Person','${at}');
    INSERT INTO network_directory_source_records (uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,observed_at)
      VALUES ('rec-org','src-8605','ext-org','h','d','org-8605','organization','accept','${at}'),
             ('rec-person','src-8605','ext-person','h','d','person-8605','person','accept','${at}');`);
  d.prepare("INSERT INTO users (id,uid,email,name,role) VALUES (860501,'8605-reviewer','reviewer@synthetic.invalid','Example Reviewer','admin')").run();
  return d;
}
const fund = (d, uid, source = LIST) => d.prepare('INSERT OR REPLACE INTO research_fund_directory (uid,name,source_name,source_url,as_of) VALUES (?,?,?,?,?)')
  .run(uid, `Example ${uid}`, source, 'https://example.test/list', at);
const company = (d, uid) => d.prepare('INSERT INTO research_company_directory (uid,name,website,source_name,source_url,as_of) VALUES (?,?,?,?,?,?)')
  .run(uid, `Example ${uid}`, 'https://example.test', 'Synthetic fixture', 'https://example.test/evidence', at);
function link(d, uid, { companyUid = null, fundUid = null, kind = fundUid ? 'fund_manager' : 'company', status = 'reviewed', org = 'org-8605', record = 'rec-org', reviewer = 860501 } = {}) {
  return d.prepare(`INSERT INTO network_directory_research_links
      (uid,organization_uid,company_directory_uid,fund_directory_uid,target_kind,source_record_uid,reviewed_by_user_id,reviewed_at,evidence_url,status)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, org, companyUid, fundUid, kind, record, reviewer, at, 'https://example.test/evidence', status);
}
const row = (d, uid) => d.prepare('SELECT fund_directory_uid AS fund, company_directory_uid AS company, status FROM network_directory_research_links WHERE uid = ?').get(uid);
const parents = (d) => d.prepare("SELECT DISTINCT \"table\" AS t FROM pragma_foreign_key_list('network_directory_research_links') ORDER BY t").all().map((r) => r.t);
/** What the importer writes after a list's delete and insert. */
const reimport = (d, uids) => {
  d.exec(`DELETE FROM research_fund_directory WHERE source_name = '${LIST}'`);
  for (const uid of uids) fund(d, uid);
};
function importerStatements(withMoves) {
  const code = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('import_research_funds', sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
print(json.dumps(mod.bridge_statements(with_moves=sys.argv[2] == '1')))`;
  const r = spawnSync('python3', ['-I', '-c', code, IMPORTER, withMoves ? '1' : '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const run = (d, statements) => { for (const s of statements) d.exec(s); };

test('the bridge names no catalogue table, and keeps its other foreign keys', () => {
  const d = fresh();
  assert.deepEqual(parents(d), ['network_directory_entries', 'network_directory_source_records', 'users']);
  const indexes = d.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='network_directory_research_links' AND sql IS NOT NULL ORDER BY name").all();
  assert.deepEqual(indexes.map((i) => i.name), ['idx_network_directory_research_company', 'idx_network_directory_research_fund']);
  assert.ok(indexes.every((i) => /^CREATE UNIQUE INDEX/.test(i.sql) && /WHERE \w+_directory_uid IS NOT NULL$/.test(i.sql)));
  d.close();
});

test('the rebuilt table is the 7672 table with the two catalogue references gone and needs_review added, nothing else', () => {
  const d = fresh();
  const shape = () => d.prepare("SELECT sql FROM sqlite_master WHERE name = 'network_directory_research_links'").get().sql.replace(/\s+/g, ' ').trim();
  const now = shape();
  d.exec('DROP TABLE network_directory_research_links'); d.exec(OLD);
  let expected = shape();
  for (const [from, to] of [
    [' REFERENCES research_company_directory(uid)', ''],
    [' REFERENCES research_fund_directory(uid)', ''],
    ["CHECK (status IN ('reviewed', 'withdrawn'))", "CHECK (status IN ('reviewed', 'needs_review', 'withdrawn'))"],
  ]) {
    assert.ok(expected.includes(from), from);
    expected = expected.replace(from, to);
  }
  assert.equal(now, expected);
  d.close();
});

test('a fund list re-import with a link in place fails on the 7672 shape and succeeds on this one', () => {
  const old = fresh();
  old.exec('DROP TABLE network_directory_research_links'); old.exec(OLD);
  fund(old, 'mgr-a'); link(old, 'l-a', { fundUid: 'mgr-a' });
  assert.throws(() => reimport(old, ['mgr-a']), /FOREIGN KEY/, 'the defect this issue removes');
  old.close();

  const d = fresh();
  fund(d, 'mgr-a'); link(d, 'l-a', { fundUid: 'mgr-a' });
  company(d, 'co-a'); link(d, 'l-co', { companyUid: 'co-a' });
  reimport(d, ['mgr-a']);
  d.exec("DELETE FROM research_company_directory WHERE uid = 'co-a'");
  assert.deepEqual({ ...row(d, 'l-a') }, { fund: 'mgr-a', company: null, status: 'reviewed' });
  assert.deepEqual({ ...row(d, 'l-co') }, { fund: null, company: 'co-a', status: 'reviewed' }, 'a deleted company leaves its link, which a reader treats as needing review');
  d.close();
});

test('the rebuild copies every row and column back from the 7672 shape', () => {
  const d = fresh();
  d.exec('DROP TABLE network_directory_research_links'); d.exec(OLD);
  fund(d, 'mgr-a'); company(d, 'co-a');
  link(d, 'l-a', { fundUid: 'mgr-a', kind: 'managed_fund_vehicle' });
  link(d, 'l-co', { companyUid: 'co-a', status: 'withdrawn' });
  const before = d.prepare('SELECT * FROM network_directory_research_links ORDER BY uid').all();
  d.exec(NEW);
  assert.deepEqual(d.prepare('SELECT * FROM network_directory_research_links ORDER BY uid').all(), before);
  assert.deepEqual(parents(d), ['network_directory_entries', 'network_directory_source_records', 'users']);
  assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'network_directory_research_links_copy_8605'").get().n, 0);
  assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND tbl_name='network_directory_research_links' AND sql IS NOT NULL").get().n, 2);
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
  d.exec(NEW);
  assert.deepEqual(d.prepare('SELECT * FROM network_directory_research_links ORDER BY uid').all(), before, 'the file replays to the same rows');
  d.close();
});

test('every other rule the bridge had still refuses what it refused', () => {
  const d = fresh();
  fund(d, 'mgr-a'); fund(d, 'mgr-b'); company(d, 'co-a'); company(d, 'co-b');
  link(d, 'l-a', { fundUid: 'mgr-a' });
  link(d, 'l-co', { companyUid: 'co-a' });
  link(d, 'l-orphan', { fundUid: 'not-in-the-catalogue' });
  assert.equal(row(d, 'l-orphan').fund, 'not-in-the-catalogue', 'a plain reference: an absent target is stored, and the importer marks it');
  link(d, 'l-review', { companyUid: 'co-b', status: 'needs_review' });
  assert.throws(() => link(d, 'x1', { fundUid: 'mgr-b', status: 'stale' }), /CHECK/);
  assert.throws(() => link(d, 'x2', { companyUid: 'co-x', fundUid: 'mgr-b' }), /CHECK/);
  assert.throws(() => link(d, 'x3', { kind: 'company' }), /CHECK/);
  assert.throws(() => link(d, 'x4', { companyUid: 'co-x', kind: 'fund_manager' }), /CHECK/);
  assert.throws(() => link(d, 'x5', { fundUid: 'mgr-a' }), /UNIQUE/);
  assert.throws(() => link(d, 'x6', { companyUid: 'co-a' }), /UNIQUE/);
  assert.throws(() => link(d, 'x7', { fundUid: 'mgr-b', org: 'person-8605', record: 'rec-person' }), /FOREIGN KEY/, 'a person is not an organisation');
  assert.throws(() => link(d, 'x8', { fundUid: 'mgr-b', org: 'org-absent' }), /FOREIGN KEY/);
  assert.throws(() => link(d, 'x9', { fundUid: 'mgr-b', record: 'rec-person' }), /FOREIGN KEY/, 'evidence from another entry');
  assert.throws(() => link(d, 'x10', { fundUid: 'mgr-b', reviewer: 999999 }), /FOREIGN KEY/);
  assert.throws(() => link(d, 'x11', { fundUid: 'mgr-b', reviewer: null }), /NOT NULL/);
  d.close();
});

test("the importer's statements carry moved links for review, never collide, and replay to the same rows", () => {
  const d = fresh();
  // 'still-listed' moved once, but this import lists it again: a move counts only when its old uid is gone.
  // 'stale-old' has a move to a uid this import does not list; 'gone-share' and 'still-listed-2' move to one uid, and only the first is gone.
  const moves = { 'mgr-old': 'mgr-old-i', 'shared-x': 'target-taken', 'twin-1': 'twin-new', 'twin-2': 'twin-new', 'withdrawn-old': 'withdrawn-new', 'still-listed': 'still-listed-ii',
    'stale-old': 'never-listed', 'gone-share': 'shared-new', 'still-listed-2': 'shared-new' };
  for (const [from, to] of Object.entries(moves)) d.prepare('INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES (?,?,?)').run(from, to, '2026-11-25');
  for (const uid of [...Object.keys(moves), 'target-taken', 'gone-fund', 'gone-2', 'kept-fund']) fund(d, uid);
  company(d, 'co-a');
  link(d, 'moved', { fundUid: 'mgr-old' });
  link(d, 'blocked', { fundUid: 'shared-x' });
  link(d, 'holder', { fundUid: 'target-taken', kind: 'managed_fund_vehicle' });
  link(d, 'twin-a', { fundUid: 'twin-1' });
  link(d, 'twin-b', { fundUid: 'twin-2' });
  link(d, 'withdrawn', { fundUid: 'withdrawn-old', status: 'withdrawn' });
  link(d, 'gone', { fundUid: 'gone-fund' });
  link(d, 'withdrawn-gone', { fundUid: 'gone-2', status: 'withdrawn' });
  link(d, 'still', { fundUid: 'still-listed' });
  link(d, 'stale', { fundUid: 'stale-old' });
  link(d, 'share-gone', { fundUid: 'gone-share' });
  link(d, 'share-still', { fundUid: 'still-listed-2' });
  link(d, 'kept', { fundUid: 'kept-fund' });
  link(d, 'company', { companyUid: 'co-a' });
  // The list comes back with every move applied and one fund dropped.
  reimport(d, ['mgr-old-i', 'target-taken', 'twin-new', 'withdrawn-new', 'kept-fund', 'still-listed', 'still-listed-ii', 'shared-new', 'still-listed-2']);
  const statements = importerStatements(true);
  assert.equal(statements.length, 2);
  run(d, statements);
  const expected = {
    moved: { fund: 'mgr-old-i', company: null, status: 'needs_review' },
    blocked: { fund: 'shared-x', company: null, status: 'needs_review' },
    holder: { fund: 'target-taken', company: null, status: 'reviewed' },
    'twin-a': { fund: 'twin-1', company: null, status: 'needs_review' },
    'twin-b': { fund: 'twin-2', company: null, status: 'needs_review' },
    withdrawn: { fund: 'withdrawn-new', company: null, status: 'withdrawn' },
    gone: { fund: 'gone-fund', company: null, status: 'needs_review' },
    'withdrawn-gone': { fund: 'gone-2', company: null, status: 'withdrawn' },
    still: { fund: 'still-listed', company: null, status: 'reviewed' },
    stale: { fund: 'stale-old', company: null, status: 'needs_review' },
    'share-gone': { fund: 'shared-new', company: null, status: 'needs_review' },
    'share-still': { fund: 'still-listed-2', company: null, status: 'reviewed' },
    kept: { fund: 'kept-fund', company: null, status: 'reviewed' },
    company: { fund: null, company: 'co-a', status: 'reviewed' },
  };
  const all = () => Object.fromEntries(Object.keys(expected).map((uid) => [uid, { ...row(d, uid) }]));
  assert.deepEqual(all(), expected);
  run(d, statements);
  assert.deepEqual(all(), expected, 'a replay changes nothing');
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
  d.close();
});

test("a list with no moves only marks links whose fund left it, and an empty bridge takes both statements", () => {
  const d = fresh();
  const statements = importerStatements(false);
  assert.equal(statements.length, 1);
  run(d, statements); run(d, importerStatements(true));
  assert.equal(d.prepare('SELECT count(*) n FROM network_directory_research_links').get().n, 0);
  fund(d, 'stays'); fund(d, 'leaves');
  link(d, 'stays', { fundUid: 'stays' }); link(d, 'leaves', { fundUid: 'leaves' });
  reimport(d, ['stays']);
  run(d, statements);
  assert.equal(row(d, 'stays').status, 'reviewed');
  assert.equal(row(d, 'leaves').status, 'needs_review');
  d.close();
});

/** Both writers' real output and the CLI's file names, from the importer itself. */
function writers(euroStem, shaiStem) {
  const code = `import contextlib, importlib.util, io, json, sys, tempfile
from datetime import date
from pathlib import Path
spec = importlib.util.spec_from_file_location('import_research_funds', sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
today = date(2026, 11, 25)
euro, _ = mod.eurotech_vehicle_migration(today, sys.argv[2])
refused, root = [], mod.ROOT
with tempfile.TemporaryDirectory() as tmp:
    out = Path(tmp) / 'shai.sql'
    mod.write_shai_migration(mod.shai_directory(today)[0], out, sys.argv[3], today.isoformat())
    shai = out.read_text()
    folder = Path(tmp) / 'cloudflare-worker/sql/migrations'
    folder.mkdir(parents=True)
    mod.ROOT = Path(tmp)
    try:
        for command in ('shai-migration', 'eurotech-migration'):
            for bad in ('768', '202611191414_7672_x', '202611251148_8605_x'):
                try:
                    mod.main_shai([command, bad]); refused.append(False)
                except SystemExit:
                    refused.append(True)
        with contextlib.redirect_stdout(io.StringIO()):
            mod.main_shai(['shai-migration', sys.argv[3]])
            mod.main_shai(['eurotech-migration', sys.argv[2]])
    finally:
        mod.ROOT = root
    written = sorted(p.name for p in folder.iterdir())
print(json.dumps({'euro': euro, 'shai': shai, 'refused': refused, 'written': written}))`;
  const r = spawnSync('python3', ['-I', '-c', code, IMPORTER, euroStem, shaiStem], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const inserted = (text) => [...text.matchAll(/INSERT OR REPLACE INTO research_fund_directory \(uid,[^)]*\) VALUES \('([^']+)'/g)].map((m) => m[1]);

test('both list writers carry the bridge statements, and the CLI only names a file that runs after this migration', () => {
  const euroStem = '202611251149_8605_research_fund_directory_eurotech', shaiStem = '202611251150_8605_research_fund_directory_shai_list';
  const { euro, shai, refused, written } = writers(euroStem, shaiStem);
  assert.deepEqual(refused, [true, true, true, true, true, true], 'a number or a stem stamped before or at this migration is refused');
  assert.deepEqual(written, [`${euroStem}.sql`, `${shaiStem}.sql`]);
  for (const name of written) assert.ok(compareMigrations(name, THIS) > 0, `${name} runs after ${THIS}`);

  const d = fresh();
  const move = d.prepare(`SELECT m.old_uid AS old, m.new_uid AS new FROM research_fund_directory_uid_moves m
    WHERE NOT EXISTS (SELECT 1 FROM research_fund_directory x WHERE x.uid = m.old_uid) ORDER BY m.old_uid`).all()
    .find((m) => euro.includes(`VALUES ('${m.new}',`));
  assert.ok(move, 'a recorded EuroTech move whose new uid the list writes');
  // A kept link sits on a listed uid that no recorded move targets, so the move above cannot be held back by it.
  const targets = new Set(d.prepare('SELECT new_uid FROM research_fund_directory_uid_moves').all().map((m) => m.new_uid));
  const euroKept = inserted(euro).find((uid) => !targets.has(uid)), shaiKept = inserted(shai).find((uid) => !targets.has(uid));
  fund(d, 'euro-dropped-8605', EURO); fund(d, 'shai-dropped-8605', SHAI);
  link(d, 'euro-moved', { fundUid: move.old });
  link(d, 'euro-dropped', { fundUid: 'euro-dropped-8605' });
  link(d, 'euro-kept', { fundUid: euroKept });
  link(d, 'shai-dropped', { fundUid: 'shai-dropped-8605' });
  link(d, 'shai-kept', { fundUid: shaiKept });
  const expected = {
    'euro-moved': { fund: move.new, company: null, status: 'needs_review' },
    'euro-dropped': { fund: 'euro-dropped-8605', company: null, status: 'needs_review' },
    'euro-kept': { fund: euroKept, company: null, status: 'reviewed' },
    'shai-dropped': { fund: 'shai-dropped-8605', company: null, status: 'needs_review' },
    'shai-kept': { fund: shaiKept, company: null, status: 'reviewed' },
  };
  const all = () => Object.fromEntries(Object.keys(expected).map((uid) => [uid, { ...row(d, uid) }]));
  d.exec(euro); d.exec(shai);
  assert.deepEqual(all(), expected);
  d.exec(euro); d.exec(shai);
  assert.deepEqual(all(), expected, 'a replay of either file changes nothing');
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
  d.close();
});
