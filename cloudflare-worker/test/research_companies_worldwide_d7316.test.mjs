/** D7316 (#7316): real-schema import, provenance, replay and company-list regressions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  acceptance, candidateSha256, coverage, dedupe, defaultOutput, foundedYear, migration,
  migrationStatements, normalizeDomain, normalizeName, normalizeSnapshotRow, prepareSnapshot, readExisting, MAX_STATEMENT_BYTES,
} from '../../scripts/import-wikidata-worldwide.mjs';
import { listCompanies, parseCompanyQuery } from '../src/services/researchCompanyDirectory.ts';

const AS_OF = '2026-11-18';
const RETRIEVED = '2026-11-18T12:34:56.123456+00:00';
const migrationFile = (name) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
function database() {
  const db = new DatabaseSync(':memory:');
  const base = migrationFile('228_research_company_directory.sql');
  db.exec(base.slice(0, base.indexOf('INSERT OR IGNORE INTO research_company_directory')));
  for (const name of ['370_company_research_tables.sql', '375_research_company_directory_columns.sql', '376_research_taxonomy.sql']) db.exec(migrationFile(name));
  return db;
}
function observed(db, existing = []) {
  return { existing, countries: db.prepare('SELECT code,name,region FROM research_countries ORDER BY code').all(),
    overrides: db.prepare('SELECT kind,raw_value,target FROM research_taxonomy_overrides').all() };
}
function candidate(n, { code = 'US', country = 'United States', region = 'North America', ...extra } = {}) {
  const qid = `Q${10000000 + n}`, website = `https://c${n}.example.com/`;
  return { uid: qid.toLowerCase(), source_qid: qid, name: `Fixture ${String(n).padStart(6, '0')}`,
    website, domain: `c${n}.example.com`, country, country_code: code, region,
    source_country_qid: 'Q30', source_instance_of_qids: ['Q783794'],
    source_official_website_values: [website], source_inception_values: [], native_industries: [],
    founded_year: null, sector: null, source_name: 'Wikidata', source_url: `https://www.wikidata.org/wiki/${qid}`,
    source_license: 'CC0-1.0', retrieved_at: RETRIEVED, ...extra };
}
// Synthetic review fixtures only. Production reviews must record actual primary evidence.
function companyReview(row, extra = {}) {
  return { qid: row.source_qid, candidate_sha256: candidateSha256(row), decision: 'include', entity_kind: 'company', primary_url: `${row.website}legal`,
    reviewed_at: AS_OF, reviewed_identity: { name: row.name, website: row.website, country: row.country, country_code: row.country_code },
    notes: 'Synthetic fixture: its legal notice identifies a distinct incorporated company, not a branch, product or service.', ...extra };
}
const reviewed = (rows, extra = {}) => ({ asOf: AS_OF, companyReviews: rows.map((row) => companyReview(row)), ...extra });
function d1(db) {
  return { DB: { prepare(sql) {
    const statement = db.prepare(sql);
    const bound = (args = []) => ({
      bind: (...values) => bound(values),
      all: async () => ({ results: statement.all(...args) }),
      first: async () => statement.get(...args) ?? null,
    });
    return bound();
  } } };
}
const query = (params = {}) => parseCompanyQuery((key) => params[key]);
const counts = (rows, key) => rows.reduce((out, r) => { out[r[key]] = (out[r[key]] ?? 0) + 1; return out; }, {});

// These are synthetic fixtures only; they never enter a production source snapshot.
test('D7316 normalizes Unicode identities and rejects non-web or credentialed URLs', () => {
  assert.equal(normalizeName(' Acmé, Inc. '), normalizeName('ACME INC'));
  assert.equal(normalizeName('東京株式会社'), '東京株式会社');
  assert.notEqual(normalizeName('東京株式会社'), normalizeName('大阪株式会社'));
  assert.equal(normalizeDomain('http://www.Example.com:80/a?q=1#f'), 'example.com');
  for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://127.0.0.1', 'https://example.invalid', 'https://x.example.com:8443']) assert.equal(normalizeDomain(url), null);
});

test('D7316 requires source evidence, supports null sectors and does not invent inception precision', () => {
  const db = database();
  try {
    const old = observed(db);
    const good = candidate(1, { founded_year: 1990, source_inception_values: ['+1990-01-01T00:00:00Z'], native_industries: [{
      qid: null, label: null, source_value: 'http://www.wikidata.org/.well-known/genid/474ceed0d3e4f69b6270505c7e0c5533', value_kind: 'unresolved_source_value',
    }] });
    const prepared = prepareSnapshot([good], old, reviewed([good]));
    assert.equal(prepared.accepted.length, 1);
    assert.equal(prepared.accepted[0].founded_year, null);
    assert.equal(prepared.accepted[0].sector, null);
    assert.deepEqual(prepared.accepted[0].native_industries, good.native_industries);
    assert.equal(prepared.accepted[0].retrieved_at, RETRIEVED);
    assert.deepEqual(prepared.accepted[0].evidence_fields, ['name', 'website', 'country']);
    assert.equal(foundedYear([{ time: '+1990-01-01T00:00:00Z', precision: 8 }], AS_OF), null);
    assert.equal(foundedYear([{ time: '+1991-01-01T00:00:00Z', precision: 9 }], AS_OF), 1991);
    assert.equal(foundedYear([{ time: '+1991-01-01T00:00:00Z', precision: 9, before: 1 }], AS_OF), null);
    assert.equal(foundedYear([{ time: '+1991-01-01T00:00:00Z', precision: 9 }, { time: '+1992-01-01T00:00:00Z', precision: 11 }], AS_OF), null);
    assert.equal(foundedYear([{ time: '+2027-01-01T00:00:00Z', precision: 9 }], AS_OF), null);
    const changes = [
      { source_license: 'Proprietary' }, { source_qid: 'Q999' }, { source_country_qid: null },
      { source_country_qid: 'invalid' }, { source_dissolution_values: ['2020-01-01'] },
      { retrieved_at: '2026-02-30T00:00:00Z' }, { retrieved_at: '2026-11-18T24:00:00Z' },
      { retrieved_at: '2026-11-19T00:00:00Z' }, { sector: 'invented' },
      { source_official_website_values: [good.website, 'https://other.example.com/'] },
      { code: 'XK', country_code: 'XK' },
    ];
    for (const change of changes) assert.equal(prepareSnapshot([{ ...good, ...change }], old, reviewed([good])).accepted.length, 0, JSON.stringify(change));
  } finally { db.close(); }
});

test('D7316 admits only exact positive primary company reviews before counting coverage', () => {
  const db = database();
  try {
    const old = observed(db);
    const included = candidate(40, { source_instance_of_qids: ['Q43229'] });
    const unreviewed = candidate(41), held = candidate(42), excluded = candidate(43), changed = candidate(44);
    const noncompany = candidate(45), explicitExclusion = candidate(46);
    const input = [included, unreviewed, held, excluded, changed, noncompany, explicitExclusion];
    const reviews = [companyReview(included), companyReview(held, { decision: 'hold' }),
      companyReview(excluded, { decision: 'exclude' }),
      companyReview(changed, { reviewed_identity: { ...companyReview(changed).reviewed_identity, website: 'https://previous.example.com/' } }),
      companyReview(noncompany, { entity_kind: 'branch' }), companyReview(explicitExclusion)];
    assert.throws(() => prepareSnapshot(input, old, { asOf: AS_OF }), /--company-reviews is required/);
    const result = prepareSnapshot(input, old, { asOf: AS_OF, companyReviews: reviews,
      exclusions: [{ qid: explicitExclusion.source_qid, reason: 'confirmed public institute', evidence_url: 'https://registry.example.com/institute' }] });
    assert.deepEqual(result.accepted.map((r) => r.uid), [included.uid]);
    assert.equal(result.report.coverage.total, 1);
    assert.equal(result.report.acceptance.pass, false);
    assert.deepEqual(result.accepted[0].company_review, reviews[0]);
    assert.equal(result.accepted[0].candidate_sha256, candidateSha256(included));
    assert.equal(candidateSha256(Object.fromEntries(Object.entries(included).reverse())), candidateSha256(included));
    assert.ok(result.rejected.every((r) => /^[a-f0-9]{64}$/u.test(r.candidate_sha256)));
    assert.match(result.report.company_reviews_semantic_sha256, /^[a-f0-9]{64}$/);
    const reasons = new Map(result.rejected.map((r) => [r.uid, r.reason]));
    assert.equal(reasons.get(unreviewed.uid), 'company_review_missing');
    assert.equal(reasons.get(held.uid), 'company_review_hold');
    assert.equal(reasons.get(excluded.uid), 'company_review_exclude');
    assert.equal(reasons.get(changed.uid), 'company_review_identity_mismatch');
    assert.equal(reasons.get(noncompany.uid), 'company_review_noncompany');
    assert.match(reasons.get(explicitExclusion.uid), /^quality_exclusion:/);
    assert.equal(prepareSnapshot([unreviewed], old, { asOf: AS_OF, companyReviews: [] }).accepted.length, 0);
    for (const [key, value] of [['name', 'Changed identity'], ['website', 'https://changed.example.com/'], ['country', 'Canada'], ['country_code', 'CA']]) {
      const review = companyReview(included); review.reviewed_identity[key] = value;
      assert.equal(prepareSnapshot([included], old, { asOf: AS_OF, companyReviews: [review] }).rejected[0].reason,
        'company_review_identity_mismatch', key);
    }
    for (const change of [
      { sector: 'software', native_industries: [{ qid: 'Q7397', label: 'software' }] },
      { source_inception_statements: [{ time: '+2001-01-01T00:00:00Z', precision: 9 }] },
      { retrieved_at: '2026-11-17' },
    ]) {
      const changedSource = { ...included, ...change };
      const heldResult = prepareSnapshot([changedSource], old, reviewed([included]));
      assert.equal(heldResult.accepted.length, 0);
      assert.equal(heldResult.rejected[0].reason, 'company_review_candidate_mismatch');
      assert.equal(heldResult.rejected[0].candidate_sha256, candidateSha256(changedSource));
    }
    for (const invalid of [{ primary_url: included.source_url }, { reviewed_at: '2026-11-19' }, { notes: '' }, { candidate_sha256: undefined }]) {
      assert.throws(() => prepareSnapshot([included], old, { asOf: AS_OF, companyReviews: [companyReview(included, invalid)] }), /Invalid company review/);
    }
    assert.throws(() => prepareSnapshot([included], old, { asOf: AS_OF, companyReviews: [companyReview(included), companyReview(included)] }), /Repeated company review/);
  } finally { db.close(); }
});

test('D7316 SQL emitters reject unreviewed normalized rows and post-prepare changes', () => {
  const db = database();
  try {
    const raw = candidate(50), old = observed(db);
    const unreviewed = normalizeSnapshotRow(raw, readExisting(old), AS_OF).row;
    const forged = { ...unreviewed, company_review: companyReview(raw) };
    for (const row of [unreviewed, forged]) {
      assert.throws(() => migrationStatements([row]), /unchanged company row admitted by prepareSnapshot/);
      assert.throws(() => migration([row], AS_OF), /unchanged company row admitted by prepareSnapshot/);
    }
    const prepared = prepareSnapshot([raw], old, reviewed([raw]));
    assert.ok(migrationStatements(prepared.accepted, prepared).some((sql) => sql.includes('INSERT INTO research_company_directory')));
    const copied = JSON.parse(JSON.stringify(prepared.accepted));
    assert.throws(() => migrationStatements(copied), /unchanged company row admitted by prepareSnapshot/);
    for (const [field, value] of [['sector', 'unreviewed sector'], ['name', 'Changed company'], ['website', 'https://changed.example.com/'], ['country', 'Canada']]) {
      const fresh = prepareSnapshot([raw], old, reviewed([raw]));
      fresh.accepted[0][field] = value;
      assert.throws(() => migrationStatements(fresh.accepted, fresh), /unchanged company row admitted by prepareSnapshot/, field);
      assert.throws(() => migration(fresh.accepted, AS_OF, fresh), /unchanged company row admitted by prepareSnapshot/, field);
    }
  } finally { db.close(); }
});

test('D7316 dedupes live raw rows and incoming rows by stable ID, host and Unicode name-country', () => {
  const existing = [
    { uid: 'Q10000001', name: 'Older name', website: 'https://old.example.com', country: 'United States' },
    { uid: 'web:acme.example.com', name: 'Acmé, Inc.', website: 'http://www.acme.example.com:80/old', country: 'USA' },
    { uid: 'legacy-jp', name: '東京株式会社', website: 'https://tokyo.example.com', country: 'Japan' },
  ];
  const rows = [
    candidate(1), candidate(2, { website: 'https://acme.example.com/new' }),
    candidate(3, { name: 'ACME INC' }), candidate(4, { name: 'ACME INC', code: 'CA', country: 'Canada' }),
    candidate(5, { name: '東京株式会社', code: 'JP', country: 'Japan' }), candidate(6), candidate(6),
    candidate(7, { website: 'https://c6.example.com/other' }),
  ];
  const result = dedupe(rows, existing);
  assert.deepEqual(result.accepted.map((r) => r.uid), [candidate(4).uid, candidate(6).uid]);
  assert.deepEqual(result.report, { duplicate_by_id: 2, duplicate_by_domain: 2, duplicate_by_name_country: 2 });
  assert.deepEqual(dedupe([...rows].reverse(), existing).accepted, result.accepted);
  assert.deepEqual(dedupe(result.accepted, [...existing, ...result.accepted]).accepted, []);
});

test('D7316 preserves the live country taxonomy and exact manual overrides', () => {
  const db = database();
  try {
    const old = observed(db);
    old.overrides.push({ kind: 'company_sector', raw_value: 'Quantum computing', target: 'deeptech' });
    old.overrides.push({ kind: 'company_country', raw_value: 'georgia', target: 'GE' });
    const tr = candidate(10, { code: 'TR', country: 'Türkiye', region: 'Middle East', sector: 'quantum computing', native_industries: [{ qid: 'Q123', label: 'quantum computing' }] });
    const ge = candidate(11, { code: 'GE', country: 'Georgia', region: 'Asia' });
    const result = prepareSnapshot([tr, ge], old, reviewed([tr, ge]));
    const turkey = result.accepted.find((r) => r.country_code === 'TR');
    assert.equal(turkey.country, 'Turkey'); assert.equal(turkey.region, 'Europe');
    assert.equal(turkey.source_country_label, 'Türkiye'); assert.equal(turkey.source_region_policy, 'Middle East');
    assert.equal(turkey.market_slug, null); // Lowercase source label must not match a title-case manual override.
    assert.deepEqual(result.countries, [{ code: 'GE', name: 'Georgia', region: 'Asia' }]);
    assert.equal(result.overrides.find((r) => r.raw_value === 'Georgia')?.target, 'GE');
    const exactSource = { ...tr, sector: 'Quantum computing', native_industries: [{ qid: 'Q123', label: 'Quantum computing' }] };
    const exact = prepareSnapshot([exactSource], old, reviewed([exactSource]));
    assert.equal(exact.accepted[0].market_slug, 'deeptech');
    db.exec(migration(result.accepted, AS_OF, result));
    assert.equal(db.prepare("SELECT region FROM research_countries WHERE code='TR'").get().region, 'Europe');
    assert.equal(db.prepare("SELECT name FROM research_countries WHERE code='GE'").get().name, 'Georgia');
    assert.equal(db.prepare('SELECT count(*) AS n FROM company_sources WHERE verified_at IS NOT NULL').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM company_sources WHERE source_type<>'open_dataset' OR confidence<>'low'").get().n, 0);
    assert.deepEqual(db.prepare('SELECT DISTINCT retrieved_at FROM company_sources').all().map((r) => r.retrieved_at), [RETRIEVED]);
  } finally { db.close(); }
});

test('D7316 rejection ledger handles explicit exclusions and contradictory source identities', () => {
  const db = database();
  try {
    const a = candidate(20), b = candidate(21);
    const result = prepareSnapshot([a, b, { ...b, country_code: 'CA', country: 'Canada' }], observed(db), {
      ...reviewed([a, b]), exclusions: [{ qid: a.source_qid, reason: 'nonprofit foundation', evidence_url: 'https://source.example.com/' }],
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.rejected.filter((r) => r.reason === 'conflicting_source_identity').length, 2);
    assert.ok(result.rejected.some((r) => r.reason.startsWith('quality_exclusion:')));
    assert.throws(() => prepareSnapshot([a], [], { asOf: AS_OF }), /existing/);
    assert.throws(() => prepareSnapshot([a], observed(db), { asOf: '2026-02-30' }), /date/);
    assert.throws(() => defaultOutput('202611182460'), /migration-stamp/);
    assert.match(defaultOutput('202611181200'), /202611181200_7316_/);
  } finally { db.close(); }
});

test('D7316 failed coverage writes a review report and audit without a deployable migration', () => {
  const db = database(), dir = mkdtempSync(join(tmpdir(), 'd7316-'));
  try {
    const snapshot = join(dir, 'snapshot.json'), existing = join(dir, 'existing.json'), exclusions = join(dir, 'qa_exclusions.json'), reviews = join(dir, 'company_reviews.json');
    const out = join(dir, '202611181200_7316_worldwide.sql'), report = join(dir, 'report.json'), audit = join(dir, 'audit.json');
    writeFileSync(snapshot, JSON.stringify([candidate(30)])); writeFileSync(existing, JSON.stringify(observed(db))); writeFileSync(exclusions, '[]');
    const ledger = [companyReview(candidate(30))]; writeFileSync(reviews, JSON.stringify(ledger));
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
      new URL('../../scripts/import-wikidata-worldwide.mjs', import.meta.url).pathname,
      '--snapshot', snapshot, '--existing', existing, '--exclusions', exclusions, '--company-reviews', reviews, '--as-of', AS_OF, '--migration-stamp', '202611181200',
      '--out', out, '--report', report, '--audit', audit], { encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    assert.equal(existsSync(out), false);
    const summary = JSON.parse(readFileSync(report));
    assert.equal(summary.migration_written, false);
    assert.match(summary.snapshot_sha256, /^[a-f0-9]{64}$/);
    const sourceAudit = JSON.parse(readFileSync(audit));
    const reviewHash = createHash('sha256').update(readFileSync(reviews)).digest('hex');
    assert.equal(sourceAudit.rows[0].uid, candidate(30).uid);
    assert.deepEqual(sourceAudit.company_reviews, ledger);
    assert.equal(summary.company_reviews_sha256, reviewHash);
    assert.equal(sourceAudit.company_reviews_sha256, reviewHash);
    assert.equal(sourceAudit.company_reviews_semantic_sha256, summary.company_reviews_semantic_sha256);
    assert.ok(summary.acceptance.failures.some((s) => s.startsWith('total')));
    const noLedger = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
      new URL('../../scripts/import-wikidata-worldwide.mjs', import.meta.url).pathname,
      '--snapshot', snapshot, '--existing', existing, '--exclusions', exclusions], { encoding: 'utf8' });
    assert.equal(noLedger.status, 1); assert.match(noLedger.stderr, /--company-reviews are required/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 25k fixture imports into real schema, replays safely, and supports company pagination and facets', async (t) => {
  const db = database();
  try {
    const old = observed(db);
    const northAmerica = old.countries.filter((c) => c.region === 'North America');
    const rest = old.countries.filter((c) => c.region !== 'North America');
    const input = Array.from({ length: 25000 }, (_, i) => {
      const c = i < 1000 ? northAmerica[i % northAmerica.length] : rest[(i - 1000) % rest.length];
      return candidate(i + 100, { code: c.code, country: c.name, region: c.region,
        ...(i % 2 ? { sector: 'software', native_industries: [{ qid: 'Q7397', label: 'software' }] } : {}),
        ...(i % 7 ? {} : { source_inception_statements: [{ time: '+2001-01-01T00:00:00Z', precision: 9 }] }),
      });
    });
    const prepared = prepareSnapshot(input, old, reviewed(input));
    assert.equal(prepared.accepted.length, input.length);
    assert.equal(prepared.report.acceptance.pass, true);
    assert.equal(acceptance({ ...prepared.report.coverage, total: 24999 }).pass, false);
    assert.equal(acceptance({ ...prepared.report.coverage, largest_country_share: .351 }).pass, false);
    assert.equal(acceptance({ ...prepared.report.coverage, regions: { ...prepared.report.coverage.regions, Africa: 249 } }).pass, false);
    const statements = migrationStatements(prepared.accepted, prepared);
    assert.ok(statements.every((s) => Buffer.byteLength(s) <= MAX_STATEMENT_BYTES));
    let started = performance.now();
    for (const sql of statements) db.exec(sql); // Would fail immediately for the old nonexistent country_code column.
    const importMs = performance.now() - started;
    const expectedEvidence = prepared.accepted.reduce((n, r) => n + r.evidence_fields.length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM research_company_directory').get().n, input.length);
    assert.equal(db.prepare('SELECT count(*) AS n FROM company_sources').get().n, expectedEvidence);
    assert.equal(db.prepare('SELECT count(*) AS n FROM research_company_directory WHERE funding_total IS NOT NULL OR revenue IS NOT NULL OR employee_count IS NOT NULL OR metrics_evidence_json IS NOT NULL').get().n, 0);
    const firstUid = prepared.accepted[0].uid;
    db.prepare('UPDATE research_company_directory SET funding_total=42,metrics_evidence_json=? WHERE uid=?').run('{"existing":"preserve"}', firstUid);
    started = performance.now();
    for (const sql of statements) db.exec(sql);
    const replayMs = performance.now() - started;
    assert.equal(db.prepare('SELECT count(*) AS n FROM research_company_directory').get().n, input.length);
    assert.equal(db.prepare('SELECT count(*) AS n FROM company_sources').get().n, expectedEvidence);
    assert.equal(db.prepare('SELECT funding_total FROM research_company_directory WHERE uid=?').get(firstUid).funding_total, 42);
    const live = db.prepare('SELECT uid,name,website,country FROM research_company_directory').all();
    assert.equal(prepareSnapshot(input, { ...old, existing: live }, reviewed(input)).accepted.length, 0);
    const env = d1(db);
    started = performance.now();
    const [first, second, last, missingSector, us, founded] = await Promise.all([
      listCompanies(env, query({ limit: '100' })), listCompanies(env, query({ limit: '100', offset: '100' })),
      listCompanies(env, query({ limit: '100', offset: String(input.length - 50) })),
      listCompanies(env, query({ sector_label: 'none' })), listCompanies(env, query({ country_code: 'US' })),
      listCompanies(env, query({ sort: '-founded' })),
    ]);
    const listMs = performance.now() - started;
    t.diagnostic(JSON.stringify({ synthetic_rows: input.length, import_ms: Math.round(importMs), replay_ms: Math.round(replayMs), six_list_and_facet_calls_ms: Math.round(listMs) }));
    assert.equal(first.total, input.length); assert.equal(first.items.length, 100);
    assert.equal(second.items.length, 100); assert.equal(last.items.length, 50);
    assert.equal(new Set([...first.items, ...second.items].map((r) => r.uid)).size, 200);
    const expectedNames = [...input].sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.uid);
    assert.deepEqual(first.items.map((r) => r.uid), expectedNames.slice(0, 100));
    assert.deepEqual(last.items.map((r) => r.uid), expectedNames.slice(-50));
    const byCountry = counts(prepared.accepted, 'country_code');
    assert.equal(us.total, byCountry.US);
    assert.ok(us.items.every((r) => r.country === 'United States'));
    const nullSectors = prepared.accepted.filter((r) => r.sector === null).length;
    assert.equal(missingSector.total, nullSectors); assert.equal(first.facets.sector_none, nullSectors);
    assert.equal(first.facets.sector_labels.find((r) => r.label === 'software')?.count, input.length - nullSectors);
    assert.equal(first.facets.countries.reduce((n, r) => n + r.count, 0), input.length);
    assert.ok(first.facets.countries.every((r) => r.code && r.count === byCountry[r.code]));
    assert.ok(founded.items.every((r) => r.founded_year === 2001));
    assert.deepEqual(coverage(prepared.accepted).completeness, prepared.report.coverage.completeness);
    // SQL-time guards also protect against identities inserted after snapshot acquisition.
    const original = prepared.accepted[0], originalSource = input.find((r) => r.uid === original.uid);
    const laterDomain = { ...originalSource, uid: 'q999900001', source_qid: 'Q999900001', source_url: 'https://www.wikidata.org/wiki/Q999900001',
      name: 'Later domain duplicate', website: `http://www.${original.domain}/new`, source_official_website_values: [`http://www.${original.domain}/new`] };
    const laterName = { ...originalSource, uid: 'q999900002', source_qid: 'Q999900002', source_url: 'https://www.wikidata.org/wiki/Q999900002',
      domain: 'different.example.com', website: 'https://different.example.com/', source_official_website_values: ['https://different.example.com/'] };
    const later = prepareSnapshot([laterDomain, laterName], old, reviewed([laterDomain, laterName]));
    assert.equal(later.accepted.length, 2);
    for (const sql of migrationStatements(later.accepted, later)) db.exec(sql);
    assert.equal(db.prepare('SELECT count(*) AS n FROM research_company_directory').get().n, input.length);
  } finally { db.close(); }
});
