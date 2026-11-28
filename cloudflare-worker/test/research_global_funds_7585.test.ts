/**
 * D7585 (#7585) — the next primary-source manager import preserves the
 * existing vehicle catalogue, provenance, restrictions and member references.
 * Exercises committed SQL and real directory reads, with guard mutations held
 * only in memory; no test rewrites an applied migration or evidence snapshot.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7585: historical preservation, original
 * verification dates, independent source citation, competing manager identities, country filters
 * and in-memory guard mutations for the next worldwide import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const MANIFEST_PATH = 'attached_assets/research-global-funds-2026-11-19.json';
const GENERATOR_PATH = 'scripts/import-global-research-funds-7585.py';
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';

interface Candidate {
  uid: string; name: string; website: string; hq: string | null;
  hq_countries: string[]; aliases: string[]; hosts: string[];
  source_url: string; checked_on: string; evidence_urls: string[]; notes: string;
}
interface Manifest {
  source: { name: string; published_url: string; checked_on: string };
  funds: Candidate[];
  excluded: { name: string; decision: string; reason: string; uid?: string }[];
  country_additions: { code: string; name: string; region: string }[];
  hq_overrides: { raw: string; targets: string[] }[];
}

const manifest: Manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8'));
const priorManifest: Manifest = JSON.parse(readFileSync(resolve(ROOT, 'attached_assets/research-global-funds-2026-11-18.json'), 'utf8'));
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), 'utf8');
const EXPANSION = read('202611190015_7585_research_global_funds.sql');
const PRIOR_EXPANSION = read('202611181335_7326_research_global_funds.sql');
const VEHICLES = read('202611180052_7166_research_fund_directory_vehicles.sql');
const REBUILD = read('378_research_fund_directory_rebuild.sql');
const fund = (db: DatabaseSync, uid: string) => db.prepare('SELECT * FROM research_fund_directory WHERE uid = ?').get(uid) as any;
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;
const query = (values: Record<string, string> = {}) => parseDirectoryQuery((key) => values[key]);
const apply = (db: DatabaseSync, sql = EXPANSION) => db.exec(sql);
const sortedUids = (rows: { uid: string }[]) => rows.map((row) => row.uid).sort();

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
  db.exec(read('202611180053_7167_research_fund_vehicle_facts.sql'));
  // D7744: each row's own size currency and record kind (migration 202611270508_7744), stamped for the listed lists.
  db.exec(readFileSync(new URL('../sql/migrations/202611270508_7744_research_fund_size_currency_and_kind.sql', import.meta.url), 'utf8'));
  return db;
}

function historicalDirectory() {
  const db = emptyDirectory();
  db.exec(REBUILD);
  db.exec(read('429_research_fund_directory_shai_list.sql'));
  db.exec(`CREATE TABLE research_funds (uid TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, name TEXT, catalogue_uid TEXT);
    CREATE UNIQUE INDEX uq_research_funds_owner_catalogue ON research_funds (owner_user_id, catalogue_uid) WHERE catalogue_uid IS NOT NULL;
    CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, research_fund_uid TEXT);
    CREATE TABLE research_project_subjects (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL,
      directory_uid TEXT NOT NULL CHECK (length(directory_uid) BETWEEN 1 AND 64), UNIQUE (project_id, kind, directory_uid));
    INSERT INTO research_funds VALUES ('saved', 11, 'Dawn Capital', 'dawncapital'), ('manual', 11, 'By hand', NULL);
    INSERT INTO raise_prospects VALUES (1, 'dawncapital'), (2, NULL);
    INSERT INTO research_project_subjects VALUES (1, 7, 'fund', 'dawncapital'), (2, 7, 'company', 'dawncapital');`);
  db.exec(VEHICLES);
  db.exec(PRIOR_EXPANSION);
  // Preserve real D7167 shapes with non-empty evidence, not just empty tables.
  const vehicle = db.prepare('SELECT uid FROM research_fund_directory WHERE fund_number IS NOT NULL ORDER BY uid LIMIT 1').get() as any;
  assert.ok(vehicle, 'historical migration supplies a vehicle');
  db.prepare(`INSERT INTO research_fund_vehicle_facts
    (fund_uid,field,value_text,source_name,source_url,reported_on,imported_on)
    VALUES (?,'manager_name','Previously verified manager',?,'https://example.org/vehicle-evidence','2026-11-18','2026-11-18')`)
    .run(vehicle.uid, EUR_SOURCE);
  const report = db.prepare('SELECT fund_uid, period FROM research_fund_directory_reports ORDER BY fund_uid, period LIMIT 1').get() as any;
  assert.ok(report, 'historical migration supplies a report');
  db.prepare('UPDATE research_fund_directory_reports SET vehicle_label = ? WHERE fund_uid = ? AND period = ?')
    .run('Recorded vehicle label', report.fund_uid, report.period);
  return db;
}

function snapshot(db: DatabaseSync, table: string, order: string) {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all());
}

function candidate() {
  const item = manifest.funds.find((row) => row.aliases.length > 1) ?? manifest.funds[0];
  assert.ok(item?.aliases.length && item.hosts.length, 'the manifest supplies manager identity evidence');
  return item;
}

function insertExisting(db: DatabaseSync, options: {
  uid: string; name: string; website?: string | null; source?: string; fundNumber?: string | null;
}) {
  db.prepare(`INSERT INTO research_fund_directory
    (uid,name,website,fund_number,fund_size_cents,fund_year,notable_lps,eif_flag,source_name,source_url,as_of)
    VALUES (?,?,?,?,12300000000,2025,'Recorded LP',1,?,'https://example.org/original-evidence','2026-01-01')`)
    .run(options.uid, options.name, options.website ?? null,
      options.fundNumber === undefined ? 'III' : options.fundNumber, options.source ?? EUR_SOURCE);
}

function renderResult(data: Manifest) {
  return spawnSync('python3', ['-B', '-c',
    `import json,runpy,sys\nm=runpy.run_path(${JSON.stringify(GENERATOR_PATH)})\nprint(m['render'](json.load(sys.stdin)),end='')`],
  { cwd: ROOT, input: JSON.stringify(data), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

function render(data: Manifest) {
  const result = renderResult(data);
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}

function replaceOnce(sql: string, from: string, to: string) {
  assert.equal(sql.split(from).length, 2, `mutation target must occur once: ${from}`);
  return sql.replace(from, to);
}

test('D7585 is reproducible and uses its own compilation identity', () => {
  const check = spawnSync('python3', ['-B', GENERATOR_PATH, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(check.status, 0, check.error?.message || check.stderr || check.stdout);
  assert.notEqual(manifest.source.name, priorManifest.source.name);
  assert.notEqual(manifest.source.published_url, priorManifest.source.published_url);
  assert.ok(manifest.source.published_url.endsWith(MANIFEST_PATH));
});

test('the generator preserves actual per-record ISO dates and rejects future or malformed evidence', () => {
  for (const checkedOn of ['2026-11-18', manifest.source.checked_on]) {
    const data = structuredClone(manifest);
    data.funds = [{ ...data.funds[0], checked_on: checkedOn }];
    const db = emptyDirectory();
    try {
      apply(db, render(data));
      assert.equal(fund(db, data.funds[0].uid)?.as_of, checkedOn);
    } finally { db.close(); }
  }
  for (const checkedOn of ['2026-11-20', '2026-02-30', '20261118', '2026-W47-3']) {
    const data = structuredClone(manifest);
    data.funds[0].checked_on = checkedOn;
    assert.notEqual(renderResult(data).status, 0, checkedOn);
  }
  const wrongSource = structuredClone(manifest);
  wrongSource.source.name = priorManifest.source.name;
  assert.notEqual(renderResult(wrongSource).status, 0, 'an old source review cannot be reused');
  const missingCitation = structuredClone(manifest);
  missingCitation.funds[0].evidence_urls = ['https://example.org/unrelated-evidence'];
  assert.notEqual(renderResult(missingCitation).status, 0, 'the retained evidence must include the primary row citation');
});

test('the import preserves prior vehicles, D7167 facts, D7326 rows, member references and source reviews', (t) => {
  const db = historicalDirectory();
  t.after(() => db.close());
  const originalFunds = db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all();
  const unchanged = [
    ['research_fund_directory_reports', 'fund_uid, period'],
    ['research_fund_vehicle_facts', 'fund_uid, field'],
    ['research_fund_directory_uid_moves', 'old_uid'],
    ['research_funds', 'uid'], ['raise_prospects', 'id'], ['research_project_subjects', 'id'],
  ].map(([table, order]) => ({ table, order, before: snapshot(db, table, order) }));
  const originalSources = db.prepare('SELECT * FROM research_fund_sources ORDER BY source_name').all();
  apply(db);
  for (const before of originalFunds) assert.deepEqual({ ...fund(db, before.uid as string) }, { ...before }, String(before.uid));
  for (const held of unchanged) assert.equal(snapshot(db, held.table, held.order), held.before, held.table);
  for (const before of originalSources) {
    const after = db.prepare('SELECT * FROM research_fund_sources WHERE source_name = ?').get(before.source_name);
    assert.deepEqual({ ...after }, { ...before }, String(before.source_name));
  }
  const added = db.prepare('SELECT uid FROM research_fund_directory WHERE source_name = ?').all(manifest.source.name) as any[];
  assert.deepEqual(sortedUids(added), sortedUids(manifest.funds), 'approved candidates add exactly their own independently sourced rows');
});

test('replay preserves later enrichment and a source withdrawal', async (t) => {
  const db = historicalDirectory();
  t.after(() => db.close());
  apply(db);
  const item = candidate();
  assert.ok(fund(db, item.uid));
  db.prepare(`UPDATE research_fund_directory SET hq='Canada',sector_focus='Fintech',fund_number='Verified later',
    fund_size_cents=987000000,notable_lps='Later evidence',eif_flag=1 WHERE uid=?`).run(item.uid);
  db.prepare(`UPDATE research_fund_sources SET verdict='not allowed',verdict_reason='Later review',reviewed_on='2026-11-20'
    WHERE source_name=?`).run(manifest.source.name);
  const tables = [
    ['research_fund_directory', 'uid'], ['research_fund_sources', 'source_name'],
    ['research_fund_vehicle_facts', 'fund_uid, field'], ['research_fund_directory_reports', 'fund_uid, period'],
    ['research_countries', 'code'], ['research_taxonomy_overrides', 'kind, raw_value, target'],
  ];
  const before = tables.map(([table, order]) => snapshot(db, table, order));
  apply(db);
  assert.deepEqual(tables.map(([table, order]) => snapshot(db, table, order)), before);
  assert.deepEqual(db.prepare(`SELECT uid FROM ${SERVED_FUNDS} WHERE source_name=?`).all(manifest.source.name), []);
  const hidden = await getFund(env(db), item.uid);
  assert.equal(hidden?.removed?.verdict, 'not allowed');
  assert.equal(hidden?.item, undefined);
});

test('served aliases, declared vehicle numbers and official hosts suppress competing imports without changing them', (t) => {
  const item = candidate();
  const alias = item.aliases[0];
  const cases = [
    { uid: 'competing-manager', name: item.name.toUpperCase() },
    { uid: 'competing-alias', name: item.aliases.at(-1)!.toUpperCase() },
    { uid: `${alias}-iii`, name: 'Separately titled vehicle' },
    { uid: 'competing-named-vehicle', name: `${item.name} Fund III`, fundNumber: 'III' },
    { uid: `${alias}iv`, name: 'Separately titled concatenated vehicle', fundNumber: 'IV' },
    { uid: `${alias}fund2`, name: 'Separately titled numeric vehicle', fundNumber: '2' },
    ...[
      `https://${item.hosts[0]}/`, `http://www.${item.hosts[0]}/portfolio`,
      ` HTTPS://WWW.${item.hosts[0].toUpperCase()}/about/ `,
      `https://${item.hosts[0]}?language=en`, `https://${item.hosts[0]}#about`,
      `https://www.${item.hosts[0]}:443/contact`,
    ].map((website) => ({ uid: 'competing-host', name: 'Other display name', website })),
  ];
  for (const existing of cases) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, { ...existing, source: 'Competing independently sourced import' });
    const before = { ...fund(db, existing.uid) };
    apply(db);
    assert.equal(fund(db, item.uid), undefined, existing.uid);
    assert.deepEqual({ ...fund(db, existing.uid) }, before, 'an earlier importer keeps its vehicle facts and provenance');
  }
});

test('similar names, unexplained suffixes and host prefixes do not suppress distinct managers', (t) => {
  const item = candidate();
  const alias = item.aliases[0];
  const cases = [
    { uid: `${alias}iii`, name: `${item.name} III`, fundNumber: null },
    { uid: 'mismatched-vehicle', name: `${item.name} III`, fundNumber: 'IV' },
    { uid: `${alias}partnersii`, name: `${item.name} Partners II`, fundNumber: 'II' },
    { uid: 'similar-host', name: 'Unrelated manager', website: `https://${item.hosts[0]}.example/` },
  ];
  for (const existing of cases) {
    const db = emptyDirectory();
    t.after(() => db.close());
    insertExisting(db, existing);
    apply(db);
    assert.ok(fund(db, item.uid), existing.uid);
  }
});

test('qualified nVentures Singapore remains distinct from the unrelated NVIDIA NVentures manager', () => {
  const singapore = manifest.funds.find((row) => row.uid === 'axal-nventuressingapore');
  assert.ok(singapore, 'the reviewed Singapore manager is included');
  const distinct = (sql: string, website: string) => {
    const db = emptyDirectory();
    try {
      insertExisting(db, { uid: 'nventures', name: 'NVentures', website, fundNumber: null });
      const original = { ...fund(db, 'nventures') };
      apply(db, sql);
      assert.equal(fund(db, singapore.uid)?.website, singapore.website,
        'the other manager\'s bare display name must not suppress the Singapore identity');
      assert.deepEqual({ ...fund(db, 'nventures') }, original,
        'the existing NVIDIA manager and its provenance stay intact');
    } finally { db.close(); }
  };
  // NVIDIA's former dedicated domain redirects to this corporate page. Both
  // official URL forms identify a manager different from nventures.sg.
  for (const website of ['https://www.nventures.ai/', 'https://www.nvidia.com/en-us/startups/nventures/']) {
    assert.doesNotThrow(() => distinct(EXPANSION, website));
  }
  const ambiguous = structuredClone(manifest);
  ambiguous.funds.find((row) => row.uid === singapore.uid)!.aliases.push('nventures');
  const weakened = render(ambiguous);
  assert.throws(() => distinct(weakened, 'https://www.nventures.ai/'), { code: 'ERR_ASSERTION' },
    'reintroducing the ambiguous bare alias must fail this identity regression');
});

test('independent primary-source additions do not overwrite or republish withheld legacy rows', async (t) => {
  const db = emptyDirectory();
  t.after(() => db.close());
  const item = candidate();
  const legacyUid = item.aliases[0];
  insertExisting(db, { uid: legacyUid, name: item.name, website: item.website, source: DEEP });
  const before = { ...fund(db, legacyUid) };
  apply(db);
  assert.deepEqual({ ...fund(db, legacyUid) }, before);
  assert.equal((await getFund(env(db), legacyUid))?.removed?.verdict, 'not allowed');
  const fresh = await getFund(env(db), item.uid);
  assert.equal(fresh?.item?.source_name, manifest.source.name);
  assert.equal(fresh?.item?.source_url, item.source_url);
});

test('held UIDs remain intact even when withheld, and retired UIDs still resolve to their original vehicle', async (t) => {
  const item = candidate();
  const held = emptyDirectory();
  t.after(() => held.close());
  insertExisting(held, { uid: item.uid, name: 'A previously held identity', source: DEEP });
  const before = { ...fund(held, item.uid) };
  apply(held);
  assert.deepEqual({ ...fund(held, item.uid) }, before, 'INSERT OR IGNORE protects the primary key outside the served set too');
  const moved = emptyDirectory();
  t.after(() => moved.close());
  insertExisting(moved, { uid: 'preserved-vehicle-iii', name: 'Separately titled vehicle' });
  moved.prepare('INSERT INTO research_fund_directory_uid_moves VALUES (?,?,?)')
    .run(item.uid, 'preserved-vehicle-iii', '2026-11-18');
  apply(moved);
  assert.equal(fund(moved, item.uid), undefined);
  const answer = await getFund(env(moved), item.uid);
  assert.equal(answer?.item?.uid, 'preserved-vehicle-iii');
  assert.equal(answer?.moved_from, item.uid);
});

test('recorded HQs resolve to existing countries and real directory filters, while unknown HQ stays unknown', async (t) => {
  const db = emptyDirectory();
  t.after(() => db.close());
  apply(db);
  const binding = env(db);
  const overrides = await loadOverrides(binding);
  const countries = new Set(db.prepare('SELECT code FROM research_countries').all().map((row) => row.code));
  const byCountry = new Map<string, string[]>();
  for (const item of manifest.funds) {
    const mapped = mapFundHq(item.hq, overrides);
    assert.deepEqual(mapped.targets.slice().sort(), item.hq_countries.slice().sort(), item.uid);
    assert.deepEqual(mapped.unmatched, [], `${item.uid}: no investment region or unresolved city is passed off as a country`);
    for (const code of mapped.targets) {
      assert.ok(countries.has(code), `${item.uid}: ${code} has a country label`);
      byCountry.set(code, [...(byCountry.get(code) ?? []), item.uid]);
    }
  }
  for (const [code, uids] of byCountry) {
    const result = await listDirectory(binding, query({ hq_country: code, limit: '100' }));
    assert.equal(result.total, uids.length);
    assert.deepEqual(sortedUids(result.items), uids.slice().sort());
    assert.equal(result.facets.hq_country.find((facet) => facet.value === code)?.count, uids.length);
  }
});

test('the Georgia country qualifier preserves the existing U.S.-state geography', async () => {
  const georgia = manifest.funds.find((row) => row.hq_countries.includes('GE'));
  assert.ok(georgia, 'the reviewed Georgian headquarters has an explicit country label');
  const distinct = async (sql: string, countryRaw: string) => {
    const db = emptyDirectory();
    try {
      const before = mapFundHq('Georgia', await loadOverrides(env(db)));
      apply(db, sql);
      const overrides = await loadOverrides(env(db));
      assert.deepEqual(mapFundHq('Georgia', overrides), before,
        'a new country mapping must not reinterpret existing U.S.-state values');
      assert.deepEqual(mapFundHq(countryRaw, overrides).targets, georgia.hq_countries,
        'the qualified new headquarters resolves to its evidenced country');
    } finally { db.close(); }
  };
  await assert.doesNotReject(() => distinct(EXPANSION, georgia.hq!));
  const ambiguous = structuredClone(manifest);
  ambiguous.funds.find((row) => row.uid === georgia.uid)!.hq = 'Georgia';
  ambiguous.hq_overrides.find((row) => row.raw === georgia.hq)!.raw = 'Georgia';
  await assert.rejects(() => distinct(render(ambiguous), 'Georgia'), { code: 'ERR_ASSERTION' },
    'removing the country qualifier must fail the preservation regression');
});

test('complete HQ overrides preserve prior manual mappings and explicit unmapped pins', async (t) => {
  // Exercise the template even when the actual batch needs no new HQ override.
  const data = structuredClone(manifest);
  const raw = 'Test dual-country headquarters';
  data.hq_overrides = [{ raw, targets: ['US', 'CA'] }];
  data.funds = [{ ...data.funds[0], hq: raw, hq_countries: ['US', 'CA'] }];
  const sql = render(data);
  for (const existingTargets of [null, [''], ['US', 'GB']] as (string[] | null)[]) {
    const db = emptyDirectory();
    t.after(() => db.close());
    if (existingTargets) {
      for (const target of existingTargets) db.prepare(`INSERT INTO research_taxonomy_overrides (kind,raw_value,target,note)
        VALUES ('fund_hq',?,?,'Prior manual decision')`).run(raw, target);
    }
    apply(db, sql);
    const expected = existingTargets ? existingTargets.filter(Boolean) : ['US', 'CA'];
    assert.deepEqual(mapFundHq(raw, await loadOverrides(env(db))).targets.sort(), expected.slice().sort());
    if (!existingTargets) {
      const result = await listDirectory(env(db), query({ hq_country: 'CA' }));
      assert.deepEqual(sortedUids(result.items), [data.funds[0].uid]);
    }
  }
  const weakened = replaceOnce(sql,
    "WHERE NOT EXISTS (SELECT 1 FROM research_taxonomy_overrides o\n    WHERE o.kind = 'fund_hq' AND o.raw_value = r.raw_value)",
    'WHERE 1 = 1');
  const pin = emptyDirectory();
  t.after(() => pin.close());
  pin.prepare(`INSERT INTO research_taxonomy_overrides (kind,raw_value,target) VALUES ('fund_hq',?,'')`).run(raw);
  apply(pin, weakened);
  assert.throws(() => assert.deepEqual(pin.prepare(`SELECT target FROM research_taxonomy_overrides
    WHERE kind='fund_hq' AND raw_value=? ORDER BY target`).all(raw).map((row) => row.target), ['']),
  { code: 'ERR_ASSERTION' }, 'removing the manual-pin guard is detected');
});

test('the API exposes the new compilation and original check dates without invented vehicle or financial facts', async (t) => {
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
  assert.deepEqual(sortedUids(listed), sortedUids(manifest.funds));
  const byUid = new Map(manifest.funds.map((row) => [row.uid, row]));
  for (const row of listed) {
    const evidence = byUid.get(row.uid)!;
    const stored = fund(db, row.uid);
    for (const field of ['linkedin', 'fund_number', 'fund_size_cents', 'fund_date', 'quarter', 'fund_year', 'sector_focus', 'notable_lps']) {
      assert.equal(stored[field], null, `${row.uid}: stored ${field}`);
      assert.equal(row[field], null, `${row.uid}: API ${field}`);
    }
    for (const field of ['size_currency', 'eif', 'eifo']) assert.equal(row[field], null, `${row.uid}: ${field}`);
    assert.equal(row.source.name, manifest.source.name);
    assert.equal(row.source.url, manifest.source.published_url);
    assert.equal(row.source.verdict, 'cite only');
    assert.equal(row.source_url, evidence.source_url);
    assert.equal(row.website, evidence.website);
    assert.equal(row.as_of, evidence.checked_on);
  }
  assert.deepEqual(db.prepare('SELECT * FROM research_fund_vehicle_facts').all(), []);
  const profile = await getFund(binding, candidate().uid);
  assert.equal(profile?.item?.source.url, manifest.source.published_url);
  assert.deepEqual(profile?.reports, []);
});

test('critical preservation and identity assertions reject in-memory SQL guard mutations', () => {
  const item = candidate();
  const alias = item.aliases[0];
  type Probe = {
    label: string; from: string; to: string;
    seed: (db: DatabaseSync) => unknown;
    check: (db: DatabaseSync, before: any) => void;
  };
  const noAddition = (db: DatabaseSync) => assert.equal(fund(db, item.uid), undefined);
  const mustAdd = (db: DatabaseSync) => assert.ok(fund(db, item.uid));
  const probes: Probe[] = [
    {
      label: 'retired UID',
      from: 'WHERE NOT EXISTS (SELECT 1 FROM research_fund_directory_uid_moves m WHERE m.old_uid = c.uid)', to: 'WHERE 1 = 1',
      seed: (db) => db.prepare('INSERT INTO research_fund_directory_uid_moves VALUES (?,?,?)').run(item.uid, 'kept-vehicle', '2026-11-18'),
      check: noAddition,
    },
    {
      label: 'name alias', from: 's.name_key = a.value OR s.uid = a.value', to: 's.uid = a.value',
      seed: (db) => insertExisting(db, { uid: 'name-only', name: item.name }), check: noAddition,
    },
    {
      label: 'declared vehicle number', from: "OR (s.fund_number_key <> '' AND (", to: 'OR (0 AND (',
      seed: (db) => insertExisting(db, { uid: 'number-only', name: `${item.name} Fund III`, fundNumber: 'III' }), check: noAddition,
    },
    {
      label: 'vehicle UID prefix', from: "OR substr(s.uid,1,length(a.value)+1) = a.value||'-'", to: 'OR 0',
      seed: (db) => insertExisting(db, { uid: `${alias}-iii`, name: 'Separate display name' }), check: noAddition,
    },
    {
      label: 'exact host', from: 's.host = h.value', to: 'substr(s.host,1,length(h.value)) = h.value',
      seed: (db) => insertExisting(db, { uid: 'different-host', name: 'Another manager', website: `https://${item.hosts[0]}.example/` }), check: mustAdd,
    },
    {
      label: 'www normalization', from: "CASE WHEN substr(host,1,4) = 'www.' THEN substr(host,5) ELSE host END AS host", to: 'host AS host',
      seed: (db) => insertExisting(db, { uid: 'host-only', name: 'Separate display name', website: `https://www.${item.hosts[0]}/` }), check: noAddition,
    },
    {
      label: 'withheld source', from: "AND s.verdict = 'not allowed'", to: 'AND 0',
      seed: (db) => insertExisting(db, { uid: 'withheld-manager', name: item.name, source: DEEP }), check: mustAdd,
    },
    {
      label: 'held primary key', from: 'INSERT OR IGNORE INTO research_fund_directory\n', to: 'INSERT OR REPLACE INTO research_fund_directory\n',
      seed: (db) => {
        insertExisting(db, { uid: item.uid, name: 'Held identity', source: DEEP });
        return { ...fund(db, item.uid) };
      },
      check: (db, before) => assert.deepEqual({ ...fund(db, item.uid) }, before),
    },
    {
      label: 'source verdict', from: 'INSERT OR IGNORE INTO research_fund_sources', to: 'INSERT OR REPLACE INTO research_fund_sources',
      seed: (db) => {
        apply(db);
        db.prepare("UPDATE research_fund_sources SET verdict='not allowed' WHERE source_name=?").run(manifest.source.name);
      },
      check: (db) => assert.equal((db.prepare('SELECT verdict FROM research_fund_sources WHERE source_name=?').get(manifest.source.name) as any).verdict, 'not allowed'),
    },
    {
      label: 'unknown fund size', from: 'SELECT c.uid,c.name,c.website,NULL,c.hq,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,',
      to: 'SELECT c.uid,c.name,c.website,NULL,c.hq,NULL,0,NULL,NULL,NULL,NULL,NULL,0,0,',
      seed: () => {}, check: (db) => assert.equal(fund(db, item.uid)?.fund_size_cents, null),
    },
  ];
  for (const probe of probes) {
    const run = (sql: string) => {
      const db = emptyDirectory();
      try { const before = probe.seed(db); apply(db, sql); probe.check(db, before); }
      finally { db.close(); }
    };
    assert.doesNotThrow(() => run(EXPANSION), `${probe.label}: original SQL`);
    assert.throws(() => run(replaceOnce(EXPANSION, probe.from, probe.to)), { code: 'ERR_ASSERTION' }, `${probe.label}: mutation must fail the invariant`);
  }
});
