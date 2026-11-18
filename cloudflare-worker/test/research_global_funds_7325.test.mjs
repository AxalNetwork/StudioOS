/** D7325: official-source manifest, duplicate-safe migration and country facets on real SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mapFundHq, mapFundFocus, loadOverrides } from '../src/services/researchTaxonomy.ts';
import { citeSource, presentFund } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrations = new URL('../sql/migrations/', import.meta.url);
const read = name => readFileSync(new URL(name, migrations), 'utf8');
const manifest = () => JSON.parse(readFileSync(new URL('../../data/research-funds/global-managers-2026-11-18.json', import.meta.url), 'utf8'));
const migrationFile = () => readdirSync(migrations).find(n => /^\d{12}_7325_.*\.sql$/.test(n));
const verifiedReport = () => JSON.parse(execFileSync('python3', ['scripts/import-global-funds.py', '--stem', migrationFile().slice(0, -4), '--check'], {
  cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
}));
const source = 'Axal VC — verified fund manager websites';
const python = `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('global_funds','scripts/import-global-funds.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=json.load(sys.stdin)
try:
 if p.get('validate_only'): m.validate(p['rows']); print(json.dumps({'valid':True}))
 else:
  sql,report=m.render(p['rows'],'202611181400_7325_synthetic',p.get('existing',[]))
  print(json.dumps({'sql':sql,'report':report}))
except ValueError as e:
 print(str(e),file=sys.stderr);sys.exit(1)
`;
const generate = (rows, existing = []) => JSON.parse(execFileSync('python3', ['-c', python], {
  cwd: root, input: JSON.stringify({ rows, existing }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}));
const synthetic = (name, website, extra = {}) => ({
  name, website, hq_country: null, region: 'Synthetic', source_url: website,
  evidence: [{ url: website, claim: 'Synthetic primary-source evidence for the importer test.' }],
  sector_focus: null, stage: null, cheque_range: null, aliases: [], verified_on: '2026-11-18', ...extra,
});

function fresh() {
  const db = new DatabaseSync(':memory:');
  // Read the real schema, stopping before the first data statement.
  db.exec(read('378_research_fund_directory_rebuild.sql').split('\nINSERT OR REPLACE')[0]);
  db.exec(read('406_research_fund_sources.sql'));
  db.exec(read('413_research_fund_source_terms_review.sql'));
  db.exec(read('376_research_taxonomy.sql'));
  db.exec(read('202611180052_7166_research_fund_directory_vehicles.sql').split('\nINSERT OR REPLACE')[0]);
  return db;
}
function add(db, uid, name, website = null, sourceName = 'EuroTech VC Funds (public spreadsheet)') {
  db.prepare(`INSERT INTO research_fund_directory
    (uid,name,website,fund_number,fund_size_cents,notable_lps,source_name,source_url,as_of)
    VALUES (?,?,?,'II',123456789,'Synthetic known LP',?,'https://source.example.test/','2026-11-01')`).run(uid, name, website, sourceName);
}
const all = db => db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all();

test('the committed migration is exactly reproducible from the reviewed manifest', () => {
  const filename = migrationFile();
  assert.ok(filename, 'a timestamped migration for this issue exists');
  const report = verifiedReport();
  assert.equal(report.verified, manifest().length);
  assert.ok(report.new_managers > 0, 'the source manifest expands the catalogue');
});

test('invalid facts and uncited identities are rejected before SQL is emitted', () => {
  const row = synthetic('Fixture Capital', 'https://fixture.example.test/');
  const invalid = [
    { ...row, name: '' }, { ...row, name: '投資基金' }, { ...row, name: '---' },
    { ...row, website: 'javascript:alert(1)' },
    { ...row, source_url: 'https://missing.example.test/' },
    { ...row, hq_country: 'Worldwide' }, { ...row, verified_on: '2026-02-30' },
    { ...row, aliases: 'Former Name' }, { ...row, evidence: [] },
    { ...row, evidence: [{ url: 'https://unrelated.example.test/', claim: 'Not its own website.' }] },
    { ...row, sector_focus: 123 },
  ];
  const validate = rows => spawnSync('python3', ['-c', python], { cwd: root, encoding: 'utf8', input: JSON.stringify({ rows, validate_only: true }) });
  assert.equal(validate([row]).status, 0);
  assert.equal(validate([{ ...row, source_url: 'https://jobs.fixture.example.test/', evidence: [{ url: 'https://jobs.fixture.example.test/', claim: 'Official manager subdomain.' }] }]).status, 0);
  for (const bad of invalid) assert.equal(validate([bad]).status, 1, JSON.stringify(bad));
  assert.equal(validate([row, { ...row }]).status, 1, 'same manager cannot appear twice');
});

test('generation recognizes vehicles, rebrand aliases, diacritics and canonical website hosts', () => {
  const rows = [
    synthetic('Newbrand Capital', 'https://newbrand.example.test/', { aliases: ['Oldbrand Capital'] }),
    synthetic('Málaga Ventures', 'https://malaga.example.test/'),
    synthetic('Site Capital', 'https://site.example.test/'),
    synthetic('Fixture Fund', 'https://fixture-fund.example.test/'),
    synthetic('Genuinely New', 'https://new.example.test/'),
  ];
  const existing = [
    { uid: 'old-fund-ii', name: 'Oldbrand Capital Fund II', website: null },
    { uid: 'malaga', name: 'Malaga Ventures', website: null },
    { uid: 'site', name: 'Different Display Name', website: 'HTTP://WWW.SITE.EXAMPLE.TEST/about?lang=en' },
    { uid: 'fixture-fund-ii', name: 'Fixture Fund II', website: null },
  ];
  const result = generate(rows, existing);
  assert.deepEqual(result.report.existing_managers.map(r => r.name).sort(), ['Fixture Fund', 'Málaga Ventures', 'Newbrand Capital', 'Site Capital'].sort());
  assert.match(result.sql, /Genuinely New/);
  assert.doesNotMatch(result.sql, /SELECT 'global-newbrandcapital'/);
  assert.match(generate([rows[0]], []).sql, /SELECT 'global-newbrandcapital'/, 'same record is eligible without an existing manager');
});

test('two new candidates connected by a rebrand alias produce one manager record', () => {
  const renamed = synthetic('Newbrand Capital', 'https://newbrand.example.test/', { aliases: ['Oldbrand Capital'] });
  const old = synthetic('Oldbrand Capital', 'https://oldbrand.example.test/');
  const result = generate([renamed, old]);
  assert.deepEqual(result.report.existing_managers, [{ name: old.name, existing_uids: ['global-newbrandcapital'] }]);
  assert.doesNotMatch(result.sql, /SELECT 'global-oldbrandcapital'/);
  assert.match(generate([{ ...renamed, aliases: [] }, old]).sql, /SELECT 'global-oldbrandcapital'/, 'without evidence connecting them both identities remain separate');
});

const duplicateRows = [
  synthetic('Alpha Capital', 'https://alpha.example.test/'),
  synthetic('Rebranded Ventures', 'https://rebranded.example.test/', { aliases: ['Old Brand Ventures'] }),
  synthetic('Unrelated Manager', 'https://different.example.test/'),
];
function duplicateFixture() {
  const db = fresh();
  add(db, 'alpha-ii', 'Alpha old display', 'HTTP://WWW.ALPHA.EXAMPLE.TEST/funds?view=all');
  add(db, 'oldbrand-ii', 'Old-Brand Ventures Fund II');
  db.prepare('UPDATE research_fund_directory SET fund_number=NULL WHERE uid=?').run('oldbrand-ii');
  return db;
}
function assertNoDuplicates(db) {
  assert.equal(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-alphacapital'), undefined);
  assert.equal(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-rebrandedventures'), undefined);
  assert.ok(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-unrelatedmanager'));
}

test('runtime duplicate checks protect records that arrived after generation, without overwriting richer rows', () => {
  const db = duplicateFixture();
  const before = all(db);
  db.exec(generate(duplicateRows).sql);
  assertNoDuplicates(db);
  assert.deepEqual(all(db).filter(r => r.source_name !== source), before);
  db.close();
});

test('runtime and offline host matches agree for explicit ports and DNS dots while distinct subdomains remain distinct', () => {
  const row = synthetic('Host Fixture Capital', 'https://fixture.example.test/');
  const { sql } = generate([row]);
  const variants = [
    ['https://fixture.example.test:443/', false],
    ['https://fixture.example.test:8080/about?view=all', false],
    ['https://fixture.example.test./', false],
    ['HTTP://WWW.FIXTURE.EXAMPLE.TEST.:8080/#about', false],
    ['https://sub.fixture.example.test/', true],
    ['https://fixture.example.test.unrelated.test/', true],
    ['https://sub.www.fixture.example.test/', true],
    ['https://fixture.example.testish/', true],
  ];
  for (const [website, shouldInsert] of variants) {
    const db = fresh();
    add(db, 'prior-manager', 'Different display name', website);
    assert.equal(generate([row], [{ uid: 'prior-manager', name: 'Different display name', website }]).report.new_managers, shouldInsert ? 1 : 0, website);
    db.exec(sql);
    assert.equal(Boolean(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-hostfixturecapital')), shouldInsert, website);
    db.close();
  }
  const db = fresh();
  add(db, 'prior-manager', 'Different display name', variants[0][0]);
  const mutant = sql.replaceAll('[/?#:]*', '[/?#]*');
  assert.notEqual(mutant, sql);
  db.exec(mutant);
  assert.throws(() => assert.equal(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-hostfixturecapital'), undefined), assert.AssertionError);
  db.close();
});

test('withheld third-party rows stay withheld while independent evidence is separately cited', () => {
  const db = fresh();
  const denied = 'Deep Tech Investors Mapping (public spreadsheet)';
  add(db, 'withheld', 'Independent Capital', 'https://independent.example.test/', denied);
  const previous = all(db);
  db.exec(generate([synthetic('Independent Capital', 'https://independent.example.test/')]).sql);
  const old = db.prepare('SELECT * FROM research_fund_directory WHERE uid=?').get('withheld');
  assert.deepEqual(old, previous[0]);
  assert.equal(db.prepare('SELECT verdict FROM research_fund_sources WHERE source_name=?').get(denied).verdict, 'not allowed');
  const served = db.prepare(`SELECT name,source_name FROM research_fund_directory f WHERE NOT EXISTS
    (SELECT 1 FROM research_fund_sources s WHERE s.source_name=f.source_name AND s.verdict='not allowed')`).all();
  assert.deepEqual(served.map(r => [r.name, r.source_name]), [['Independent Capital', source]]);
  db.close();
});

test('a later retired manager UID stays retired even when the canonical vehicle changes name and website', () => {
  const db = fresh();
  const { sql } = generate([synthetic('Retired Fixture Capital', 'https://retired.example.test/')]);
  db.exec(sql);
  db.exec(`UPDATE research_fund_directory SET uid='canonical-vehicle-ii',name='Renamed Vehicle',website='https://renamed.example.test/'
    WHERE uid='global-retiredfixturecapital';
    INSERT INTO research_fund_directory_uid_moves(old_uid,new_uid,moved_on)
    VALUES('global-retiredfixturecapital','canonical-vehicle-ii','2026-11-18');`);
  const snapshot = JSON.stringify(all(db));
  const retired = () => assert.equal(db.prepare('SELECT uid FROM research_fund_directory WHERE uid=?').get('global-retiredfixturecapital'), undefined);
  db.exec(sql);
  retired();
  assert.equal(JSON.stringify(all(db)), snapshot);
  assert.equal(db.prepare('SELECT new_uid FROM research_fund_directory_uid_moves WHERE old_uid=?').get('global-retiredfixturecapital').new_uid, 'canonical-vehicle-ii');
  const mutant = sql.replace(/AND NOT EXISTS \(SELECT 1 FROM research_fund_directory_uid_moves WHERE old_uid='global-retiredfixturecapital'\)/, '');
  assert.notEqual(mutant, sql);
  db.exec(mutant);
  assert.throws(retired, assert.AssertionError, 'removing the retired-UID guard must revive the old row');
  db.close();
});

test('replay preserves source takedowns and leaves every unknown financial fact unknown', () => {
  const db = fresh();
  const row = synthetic('Unknown Facts Capital', 'https://unknown.example.test/');
  const { sql } = generate([row]);
  db.exec(sql);
  const fund = all(db)[0];
  const unknown = ['hq','linkedin','fund_number','fund_size_cents','fund_date','quarter','fund_year','sector_focus','notable_lps'];
  for (const field of unknown) assert.equal(fund[field], null, field);
  assert.equal(presentFund(fund).eif, null);
  assert.equal(presentFund(fund).eifo, null);
  const review = db.prepare('SELECT * FROM research_fund_sources WHERE source_name=?').get(source);
  assert.equal(citeSource(source, fund.source_url, review).url, row.source_url);
  assert.equal(review.published_url, null);
  db.prepare("UPDATE research_fund_sources SET verdict='not allowed',verdict_reason='Synthetic later withdrawal' WHERE source_name=?").run(source);
  const before = JSON.stringify([all(db), db.prepare('SELECT * FROM research_fund_sources ORDER BY source_name').all()]);
  db.exec(sql);
  assert.equal(JSON.stringify([all(db), db.prepare('SELECT * FROM research_fund_sources ORDER BY source_name').all()]), before);
  db.close();
});

test('new countries use the canonical crosswalk and never override an existing manual decision', async () => {
  const db = fresh();
  const rows = [synthetic('Country Fund', 'https://country.example.test/', { hq_country: 'Ghana' })];
  const { sql } = generate(rows);
  db.exec(sql);
  assert.equal(db.prepare('SELECT code FROM research_countries WHERE name=?').get('Ghana').code, 'GH');
  assert.deepEqual(mapFundHq('Ghana', await loadOverrides({ DB: d1Over(db) })).targets, ['GH']);
  db.exec("DELETE FROM research_taxonomy_overrides WHERE kind='fund_hq' AND raw_value='Ghana'; INSERT INTO research_taxonomy_overrides(kind,raw_value,target) VALUES('fund_hq','Ghana','')");
  db.exec(sql);
  assert.deepEqual(mapFundHq('Ghana', await loadOverrides({ DB: d1Over(db) })).targets, []);
  db.close();
});

test('cited sector spellings reach existing filters without inventing a narrower healthcare mandate', () => {
  const db = fresh();
  db.exec(generate([synthetic('Sector Fund', 'https://sector.example.test/', { sector_focus: 'Artificial intelligence; ClimateTech; Healthcare' })]).sql);
  const value = all(db)[0].sector_focus;
  assert.equal(value, 'AI, climate tech, Healthcare');
  assert.deepEqual(mapFundFocus(value).targets.sort(), ['ai', 'climatetech-cleantech']);
  assert.ok(mapFundFocus(value).unmatched.includes('Healthcare'));
  assert.notDeepEqual(mapFundFocus('Artificial intelligence; ClimateTech; Healthcare').targets.sort(), ['ai', 'climatetech-cleantech']);
  db.close();
});

test('the actual catalogue migration preserves old vehicles, reports and saved references, and replays without change', async () => {
  const db = fresh();
  db.exec(read('378_research_fund_directory_rebuild.sql'));
  db.exec(read('429_research_fund_directory_shai_list.sql'));
  db.exec(`CREATE TABLE research_funds(uid TEXT,owner_user_id INTEGER,name TEXT,catalogue_uid TEXT);
    CREATE TABLE raise_prospects(id INTEGER,research_fund_uid TEXT);
    CREATE TABLE research_project_subjects(id INTEGER,project_id INTEGER,kind TEXT,directory_uid TEXT);
    INSERT INTO research_funds VALUES('saved',1,'Dawn Capital','dawncapital');
    INSERT INTO raise_prospects VALUES(1,'dawncapital');
    INSERT INTO research_project_subjects VALUES(1,1,'fund','dawncapital');`);
  db.exec(read('202611180052_7166_research_fund_directory_vehicles.sql'));
  const old = all(db);
  const references = () => JSON.stringify([
    db.prepare('SELECT * FROM research_fund_directory_reports ORDER BY fund_uid,period').all(),
    db.prepare('SELECT * FROM research_funds').all(), db.prepare('SELECT * FROM raise_prospects').all(),
    db.prepare('SELECT * FROM research_project_subjects').all(),
  ]);
  const beforeReferences = references();
  const sql = read(migrationFile());
  db.exec(sql);
  assert.deepEqual(all(db).filter(r => r.source_name !== source), old);
  assert.equal(references(), beforeReferences);
  const added = all(db).filter(r => r.source_name === source);
  const report = verifiedReport();
  const excluded = new Set(report.existing_managers.map(r => r.name));
  const expected = manifest().filter(r => !excluded.has(r.name)).map(r => r.name).sort();
  assert.deepEqual(added.map(r => r.name).sort(), expected, 'offline identity decisions and runtime guards agree');
  assert.equal(added.length, report.new_managers);
  const byName = new Map(manifest().map(r => [r.name, r]));
  const overrides = await loadOverrides({ DB: d1Over(db) });
  for (const fund of added) {
    const input = byName.get(fund.name);
    assert.ok(input, fund.name);
    assert.equal(fund.source_url, input.source_url);
    assert.equal(fund.website, input.website);
    if (fund.hq) assert.ok(mapFundHq(fund.hq, overrides).targets.length > 0, `${fund.name}: country maps`);
  }
  const snapshot = JSON.stringify(all(db));
  db.exec(sql);
  assert.equal(JSON.stringify(all(db)), snapshot);
  assert.equal(references(), beforeReferences);
  db.close();
});

test('mutation checks: removing duplicate protection, inventing zero size and replacing source verdicts fail their invariants', () => {
  const guarded = generate(duplicateRows).sql;
  const unguarded = guarded.replace(/WHERE NOT EXISTS \(SELECT 1 FROM \(SELECT d\.source_name[\s\S]*?;\n/g, 'WHERE 1=1;\n');
  assert.notEqual(unguarded, guarded, 'the mutation must actually change SQL');
  const duplicate = duplicateFixture();
  duplicate.exec(unguarded);
  assert.throws(() => assertNoDuplicates(duplicate), assert.AssertionError);
  duplicate.close();
  const db = fresh();
  const { sql } = generate([synthetic('Mutation Fund', 'https://mutation.example.test/')]);
  db.exec(sql);
  db.prepare('UPDATE research_fund_directory SET fund_size_cents=0 WHERE source_name=?').run(source);
  assert.throws(() => assert.equal(all(db)[0].fund_size_cents, null), assert.AssertionError);
  db.prepare("UPDATE research_fund_sources SET verdict='not allowed' WHERE source_name=?").run(source);
  db.exec(sql.replace('INSERT OR IGNORE INTO research_fund_sources', 'INSERT OR REPLACE INTO research_fund_sources'));
  assert.throws(() => assert.equal(db.prepare('SELECT verdict FROM research_fund_sources WHERE source_name=?').get(source).verdict, 'not allowed'), assert.AssertionError);
  db.close();
});
