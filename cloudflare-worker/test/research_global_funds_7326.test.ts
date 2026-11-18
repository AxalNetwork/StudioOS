/**
 * D7326 (#7326) — verified worldwide managers extend the fund directory
 * without replacing vehicles, reviving retired IDs, or re-enabling a source.
 * Runs the committed SQL on SQLite, then reads it through the real service.
 *
 * node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *   --test cloudflare-worker/test/research_global_funds_7326.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import {
  EUR_SOURCE, SERVED_FUNDS, getFund, listDirectory, parseDirectoryQuery,
} from '../src/services/researchFundDirectory.ts';
import { loadOverrides, mapFundHq } from '../src/services/researchTaxonomy.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const MANIFEST_PATH = 'attached_assets/research-global-funds-2026-11-18.json';
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';

interface Candidate {
  uid: string;
  name: string;
  website: string;
  hq: string | null;
  hq_countries: string[];
  aliases: string[];
  hosts: string[];
  source_url: string;
  checked_on: string;
  evidence_urls: string[];
}
interface Manifest {
  source: { name: string; published_url: string; checked_on: string };
  funds: Candidate[];
  excluded: { uid: string; existing_uid: string }[];
  country_additions: { code: string; name: string; region: string }[];
  hq_overrides: { raw: string; targets: string[] }[];
}

const manifest: Manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8'));
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), 'utf8');
const migrationNames = readdirSync(MIGRATIONS).filter((name) => /_7326_research_global_funds\.sql$/.test(name));
assert.equal(migrationNames.length, 1, 'one migration owns this import');
const EXPANSION = read(migrationNames[0]);
const VEHICLES = read('202611180052_7166_research_fund_directory_vehicles.sql');
const REBUILD = read('378_research_fund_directory_rebuild.sql');
const asPlain = (rows: any[]) => rows.map((row) => ({ ...row }));
const fund = (db: DatabaseSync, uid: string) => db.prepare('SELECT * FROM research_fund_directory WHERE uid = ?').get(uid) as any;
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;
const query = (values: Record<string, string> = {}) => parseDirectoryQuery((key) => values[key]);
const apply = (db: DatabaseSync) => db.exec(EXPANSION);

function ddl(sql: string) {
  return sql.split(/;\s*\n/).map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => /^CREATE\s+(TABLE|INDEX)/i.test(statement))
    .map((statement) => `${statement};`).join('\n');
}

function emptyDirectory() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(ddl(REBUILD));
  db.exec(read('406_research_fund_sources.sql'));
  db.exec(read('413_research_fund_source_terms_review.sql'));
  db.exec(ddl(VEHICLES));
  db.exec(read('376_research_taxonomy.sql'));
  db.exec(ddl(read('229_research_market_directory.sql')));
  return db;
}

function historicalDirectory() {
  const db = emptyDirectory();
  db.exec(REBUILD);
  db.exec(read('429_research_fund_directory_shai_list.sql'));
  // The three saved-reference shapes that D7166 migrates. These stay member
  // records: adding public directory rows must never populate a shortlist.
  db.exec(`CREATE TABLE research_funds (uid TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, name TEXT, catalogue_uid TEXT);
    CREATE UNIQUE INDEX uq_research_funds_owner_catalogue ON research_funds (owner_user_id, catalogue_uid) WHERE catalogue_uid IS NOT NULL;
    CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, research_fund_uid TEXT);
    CREATE TABLE research_project_subjects (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL,
      directory_uid TEXT NOT NULL CHECK (length(directory_uid) BETWEEN 1 AND 64), UNIQUE (project_id, kind, directory_uid));
    INSERT INTO research_funds VALUES ('saved', 11, 'Dawn Capital', 'dawncapital'), ('manual', 11, 'By hand', NULL);
    INSERT INTO raise_prospects VALUES (1, 'dawncapital'), (2, NULL);
    INSERT INTO research_project_subjects VALUES (1, 7, 'fund', 'dawncapital'), (2, 7, 'company', 'dawncapital');`);
  db.exec(VEHICLES);
  return db;
}

function snapshot(db: DatabaseSync, table: string, order: string) {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all());
}

function candidate() {
  const item = manifest.funds.find((row) => row.aliases.length > 0 && row.hosts.length > 0);
  assert.ok(item, 'the curated import has a manager with identity evidence');
  return item;
}

function insertExisting(db: DatabaseSync, options: { uid: string; name: string; website?: string | null; source?: string; fundNumber?: string | null }) {
  db.prepare(`INSERT INTO research_fund_directory
    (uid, name, website, fund_number, fund_size_cents, fund_year, notable_lps, eif_flag, source_name, source_url, as_of)
    VALUES (?, ?, ?, ?, 12300000000, 2025, 'Recorded LP', 1, ?, 'https://example.org/original-evidence', '2026-01-01')`)
    .run(options.uid, options.name, options.website ?? null, options.fundNumber === undefined ? 'III' : options.fundNumber, options.source ?? EUR_SOURCE);
}

test('the checked-in migration is reproducible from the evidence manifest', () => {
  const check = spawnSync('python3', ['scripts/import-global-research-funds.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(check.status, 0, check.error?.message || check.stderr || check.stdout);
});

test('the expansion preserves every historical row, report, saved reference, move and source review', (t) => {
  const db = historicalDirectory();
  t.after(() => db.close());
  const originalFunds = asPlain(db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all());
  const untouched = [
    ['research_fund_directory_reports', 'fund_uid, period'],
    ['research_fund_directory_uid_moves', 'old_uid'],
    ['research_funds', 'uid'],
    ['raise_prospects', 'id'],
    ['research_project_subjects', 'id'],
  ].map(([table, order]) => ({ table, order, before: snapshot(db, table, order) }));
  const sources = asPlain(db.prepare('SELECT * FROM research_fund_sources ORDER BY source_name').all());
  apply(db);

  for (const before of originalFunds) assert.deepEqual({ ...fund(db, before.uid) }, before, before.uid);
  for (const held of untouched) assert.equal(snapshot(db, held.table, held.order), held.before, held.table);
  for (const before of sources) {
    const after = db.prepare('SELECT * FROM research_fund_sources WHERE source_name = ?').get(before.source_name);
    assert.deepEqual({ ...after }, before, before.source_name);
  }
  const inserted = (db.prepare('SELECT uid FROM research_fund_directory WHERE source_name = ? ORDER BY uid')
    .all(manifest.source.name) as any[]).map((row) => row.uid);
  assert.deepEqual(inserted, manifest.funds.map((row) => row.uid).sort(), 'each approved candidate adds one independently sourced row');
  for (const excluded of manifest.excluded) {
    assert.ok(fund(db, excluded.existing_uid), `covered manager ${excluded.uid} retains ${excluded.existing_uid}`);
    assert.ok(!inserted.includes(excluded.uid), `covered manager ${excluded.uid} is not added`);
  }
});

test('a replay preserves later enrichment and a later source takedown', async (t) => {
  const db = historicalDirectory();
  t.after(() => db.close());
  apply(db);
  const added = manifest.funds[0];
  assert.ok(fund(db, added.uid), 'a new row exists before the replay');
  db.prepare(`UPDATE research_fund_directory SET hq = 'Canada', sector_focus = 'Fintech', fund_number = 'Verified later',
    fund_size_cents = 987000000, notable_lps = 'Later evidence', eif_flag = 1 WHERE uid = ?`).run(added.uid);
  db.prepare(`UPDATE research_fund_sources SET verdict = 'not allowed', verdict_reason = 'Later source review',
    reviewed_on = '2026-11-19' WHERE source_name = ?`).run(manifest.source.name);
  const tables = [
    ['research_fund_directory', 'uid'], ['research_fund_sources', 'source_name'],
    ['research_countries', 'code'], ['research_taxonomy_overrides', 'kind, raw_value, target'],
  ];
  const before = tables.map(([table, order]) => snapshot(db, table, order));
  apply(db);
  assert.deepEqual(tables.map(([table, order]) => snapshot(db, table, order)), before);
  const served = db.prepare(`SELECT uid FROM ${SERVED_FUNDS} WHERE source_name = ?`).all(manifest.source.name);
  assert.deepEqual(served, [], 'a replay never makes the taken-down compilation visible again');
  const removed = await getFund(env(db), added.uid);
  assert.equal(removed?.removed?.verdict, 'not allowed');
  assert.equal(removed?.item, undefined);
});

test('served manager aliases and vehicle UID prefixes suppress duplicate manager rows', (t) => {
  const item = candidate();
  const cases = [
    { uid: 'existing-independent-vehicle', name: item.name.toUpperCase() },
    { uid: 'existing-alias-vehicle', name: item.aliases[0].toUpperCase() },
    { uid: `${item.aliases[0]}-iii`, name: 'A separately titled vehicle' },
  ];
  for (const existing of cases) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, existing);
    const before = { ...fund(db, existing.uid) };
    apply(db);
    assert.equal(fund(db, item.uid), undefined, `${existing.uid}: existing manager wins`);
    assert.deepEqual({ ...fund(db, existing.uid) }, before, 'the richer vehicle is not modified');
  }
});

test('a vehicle suffix suppresses its manager only when the recorded fund number explains it', (t) => {
  const item = candidate();
  const alias = item.aliases[0];
  const duplicates = [
    { uid: 'named-legacy-vehicle', name: `${item.name} III`, fundNumber: 'III' },
    { uid: `${alias}iv`, name: 'A separately titled vehicle', fundNumber: 'IV' },
    { uid: 'numbered-legacy-vehicle', name: `${item.name} 2`, fundNumber: '2' },
    { uid: `${alias}3`, name: 'A separately titled numeric vehicle', fundNumber: '3' },
    { uid: 'explicit-fund-vehicle', name: `${item.name} Fund IV`, fundNumber: 'IV' },
    { uid: `${alias}fundii`, name: 'A separately titled fund vehicle', fundNumber: 'II' },
  ];
  for (const existing of duplicates) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, existing);
    const before = { ...fund(db, existing.uid) };
    apply(db);
    assert.equal(fund(db, item.uid), undefined, `${existing.uid}: its declared number ties the vehicle to the manager`);
    assert.deepEqual({ ...fund(db, existing.uid) }, before, 'the richer vehicle stays intact');
  }
  const distinct = [
    { uid: `${alias}ii`, name: `${item.name} II`, fundNumber: null },
    { uid: `${alias}2`, name: `${item.name} 2`, fundNumber: '' },
    { uid: `${alias}iii`, name: `${item.name} III`, fundNumber: 'IV' },
    { uid: `${alias}partnersii`, name: `${item.name} Partners II`, fundNumber: 'II' },
  ];
  for (const existing of distinct) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, existing);
    apply(db);
    assert.ok(fund(db, item.uid), `${existing.uid}: a similar name or an unexplained number is not evidence of the same manager`);
  }
});

test('historical concatenated vehicle IDs stay represented without adding their managers again', async (t) => {
  const covered = [
    ['axal-blackbird', 'blackbirdventuresi'],
    ['axal-goldenventures', 'goldenventuresv'],
    ['axal-inoviacapital', 'inoviacapitalv'],
    ['axal-insigniaventurespartners', 'insigniaventurepartnersi'],
    ['axal-kaszek', 'kaszekventuresiii'],
    ['axal-magmaventurepartners', 'magmaiv'],
    ['axal-realventures', 'realventuresiv'],
    ['axal-sequoiacapital', 'sequoiacapitalseedfundv'],
    ['axal-sosv', 'sosvinvestmentsiii'],
    ['axal-tlcom', 'tideafricafundi'],
    ['axal-versiononeventures', 'versiononeventuresiii'],
  ];
  const db = historicalDirectory();
  t.after(() => db.close());
  const originals = new Map(covered.map(([, uid]) => [uid, { ...fund(db, uid) }]));
  for (const [managerUid, vehicleUid] of covered) {
    assert.ok(fund(db, vehicleUid), `${vehicleUid} already exists in the actual served history`);
    assert.ok(!manifest.funds.some((row) => row.uid === managerUid), `${managerUid} is not claimed as a new manager`);
    assert.ok(manifest.excluded.some((row) => row.existing_uid === vehicleUid), `${vehicleUid} explains the exclusion`);
  }
  apply(db);
  for (const [managerUid, vehicleUid] of covered) {
    assert.equal(fund(db, managerUid), undefined, managerUid);
    assert.deepEqual({ ...fund(db, vehicleUid) }, originals.get(vehicleUid), vehicleUid);
    const profile = await getFund(env(db), vehicleUid);
    assert.equal(profile?.item?.uid, vehicleUid);
    assert.notEqual(profile?.item?.source_name, manifest.source.name, 'the original vehicle keeps its evidence');
  }
});

test('website host matching handles URL variations without treating a host prefix as a match', (t) => {
  const item = candidate();
  const host = item.hosts[0];
  const matching = [
    `https://${host}/`, `http://www.${host}/portfolio`, ` HTTPS://WWW.${host.toUpperCase()}/about/ `,
    `https://${host}?language=en`, `https://${host}#about`, `https://www.${host}:443/contact`,
  ];
  for (const website of matching) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, { uid: 'unrelated-vehicle-id', name: 'Independent display name', website });
    apply(db);
    assert.equal(fund(db, item.uid), undefined, website);
  }
  const db = emptyDirectory();
  t.after(() => db.close());
  insertExisting(db, { uid: 'other-host-vehicle', name: 'Another manager', website: `https://${host}.example/` });
  apply(db);
  assert.ok(fund(db, item.uid), 'a different host beginning with the same letters must not suppress a new manager');
});

test('independent primary-source rows do not alter or republish a withheld source row', async (t) => {
  const db = emptyDirectory();
  t.after(() => db.close());
  const item = candidate();
  const withheldUid = item.aliases[0];
  insertExisting(db, { uid: withheldUid, name: item.name, website: item.website, source: DEEP });
  const before = { ...fund(db, withheldUid) };
  apply(db);
  assert.ok(fund(db, item.uid), 'verified, independent evidence is available under a new identity');
  assert.deepEqual({ ...fund(db, withheldUid) }, before, 'the withheld record is not overwritten or relabelled');
  const old = await getFund(env(db), withheldUid);
  assert.equal(old?.removed?.verdict, 'not allowed');
  assert.equal(old?.item, undefined);
  const fresh = await getFund(env(db), item.uid);
  assert.equal(fresh?.item?.source_name, manifest.source.name);
  assert.equal(fresh?.item?.source_url, item.source_url);
});

test('a held UID is never replaced and a retired UID still opens its existing vehicle', async (t) => {
  const item = candidate();
  const held = emptyDirectory();
  t.after(() => held.close());
  insertExisting(held, { uid: item.uid, name: 'A previously recorded row' });
  const before = { ...fund(held, item.uid) };
  apply(held);
  assert.deepEqual({ ...fund(held, item.uid) }, before);

  const moved = emptyDirectory();
  t.after(() => moved.close());
  insertExisting(moved, { uid: 'preserved-vehicle-iii', name: 'A separately titled vehicle' });
  moved.prepare('INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES (?,?,?)')
    .run(item.uid, 'preserved-vehicle-iii', '2026-11-18');
  apply(moved);
  assert.equal(fund(moved, item.uid), undefined, 'the candidate cannot shadow a retired identifier');
  const answer = await getFund(env(moved), item.uid);
  assert.equal(answer?.item?.uid, 'preserved-vehicle-iii');
  assert.equal(answer?.moved_from, item.uid);
});

test('every recorded HQ participates in a real country filter, including added country aliases', async (t) => {
  const db = emptyDirectory();
  t.after(() => db.close());
  apply(db);
  const binding = env(db);
  const overrides = await loadOverrides(binding);
  const countries = new Set((db.prepare('SELECT code FROM research_countries').all() as any[]).map((row) => row.code));
  const byCountry = new Map<string, string[]>();
  for (const item of manifest.funds) {
    const mapping = mapFundHq(item.hq, overrides);
    if (!item.hq) {
      assert.deepEqual(mapping.targets, [], `${item.uid}: unknown HQ stays unknown`);
      continue;
    }
    assert.ok(mapping.targets.length > 0, `${item.uid}: ${item.hq} resolves`);
    assert.deepEqual(mapping.unmatched, [], `${item.uid}: no region is passed off as a country`);
    assert.deepEqual(mapping.targets.slice().sort(), item.hq_countries.slice().sort(), `${item.uid}: the recorded countries match the evidence`);
    for (const code of mapping.targets) {
      assert.ok(countries.has(code), `${item.uid}: ${code} has a country label`);
      byCountry.set(code, [...(byCountry.get(code) || []), item.uid]);
    }
  }
  for (const added of manifest.country_additions) {
    assert.equal((db.prepare('SELECT name FROM research_countries WHERE code = ?').get(added.code) as any)?.name, added.name);
  }
  for (const added of manifest.hq_overrides) {
    assert.deepEqual(mapFundHq(added.raw, overrides).targets.slice().sort(), added.targets.slice().sort(), added.raw);
  }
  for (const [code, expected] of byCountry) {
    const response = await listDirectory(binding, query({ hq_country: code, limit: '100' }));
    assert.equal(response.total, expected.length, `${code}: country filter counts the same catalogue rows`);
    assert.deepEqual(response.items.map((row) => row.uid).sort(), expected.slice().sort(), code);
    assert.equal(response.facets.hq_country.find((facet) => facet.value === code)?.count, expected.length);
  }
});

test('country additions preserve an existing manual override, including an explicit unmapped pin', async (t) => {
  assert.ok(manifest.hq_overrides.length > 0, 'this import needs a new raw HQ mapping');
  const proposed = manifest.hq_overrides[0];
  for (const existingTargets of [[''], ['US', 'CA']]) {
    const db = emptyDirectory();
    t.after(() => db.close());
    const insert = db.prepare(`INSERT INTO research_taxonomy_overrides (kind, raw_value, target, note)
      VALUES ('fund_hq', ?, ?, 'Manual review predating the import')`);
    for (const target of existingTargets) insert.run(proposed.raw, target);
    const before = snapshot(db, 'research_taxonomy_overrides', 'kind, raw_value, target');
    apply(db);
    const held = db.prepare(`SELECT * FROM research_taxonomy_overrides WHERE kind = 'fund_hq' AND raw_value = ? ORDER BY target`).all(proposed.raw);
    const original = (JSON.parse(before) as any[]).filter((row) => row.kind === 'fund_hq' && row.raw_value === proposed.raw);
    assert.deepEqual(asPlain(held), original, 'new targets are not appended to a manually settled mapping');
    const resolved = mapFundHq(proposed.raw, await loadOverrides(env(db)));
    assert.deepEqual(resolved.targets.slice().sort(), existingTargets.filter(Boolean).sort(), 'the existing override keeps its meaning');
  }
});

test('the API exposes citations while unverified financial, vintage and LP fields remain unknown', async (t) => {
  const db = emptyDirectory();
  t.after(() => db.close());
  apply(db);
  const binding = env(db);
  const listed: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await listDirectory(binding, query({ limit: '100', offset: String(offset) }));
    listed.push(...page.items);
    if (listed.length >= page.total) break;
  }
  assert.deepEqual(listed.map((row) => row.uid).sort(), manifest.funds.map((row) => row.uid).sort());
  const byUid = new Map(manifest.funds.map((row) => [row.uid, row]));
  for (const row of listed) {
    const evidence = byUid.get(row.uid)!;
    const stored = fund(db, row.uid);
    for (const field of ['linkedin', 'fund_number', 'fund_size_cents', 'fund_date', 'quarter', 'fund_year', 'sector_focus', 'notable_lps']) {
      assert.equal(stored[field], null, `${row.uid}: stored ${field} is unknown`);
      assert.equal(row[field], null, `${row.uid}: ${field} is not guessed`);
    }
    for (const field of ['size_currency', 'eif', 'eifo']) assert.equal(row[field], null, `${row.uid}: ${field} is not guessed`);
    assert.equal(row.source.name, manifest.source.name);
    assert.equal(row.source.url, manifest.source.published_url, 'the compilation links to its evidence, not back to the directory');
    assert.equal(row.source.verdict, 'cite only');
    assert.equal(row.source_url, evidence.source_url);
    assert.equal(row.website, evidence.website);
    assert.equal(row.as_of, evidence.checked_on);
  }
  const first = manifest.funds[0];
  const profile = await getFund(binding, first.uid);
  assert.equal(profile?.item?.uid, first.uid);
  assert.equal(profile?.item?.source.url, manifest.source.published_url);
  assert.deepEqual(profile?.reports, [], 'a manager without a recorded vehicle has no invented fund reports');
});
