/** D8963 (#8963): SEC EDGAR registrant adapter, its terms-review gate and the dry run that stops before SQL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  loadPrimaryEvidence, main, prepareRegisterSnapshot, primaryRecordSha256, projectPrimaryRecord,
  REGISTER_TERMS_REVIEWS, registerMigration, registerMigrationStatements, REGISTRIES, termsReviewProblem,
} from '../../scripts/import-register-companies.mjs';

const AS_OF = '2026-11-27';
const RETRIEVED = '2026-11-27T01:02:03Z';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (name) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
function database() {
  const db = new DatabaseSync(':memory:');
  const base = file('228_research_company_directory.sql');
  db.exec(base.slice(0, base.indexOf('INSERT OR IGNORE INTO research_company_directory')));
  for (const name of ['370_company_research_tables.sql', '375_research_company_directory_columns.sql', '376_research_taxonomy.sql']) db.exec(file(name));
  return db;
}
function baseline(db, existing = []) {
  return { existing, countries: db.prepare('SELECT code,name,region FROM research_countries ORDER BY code').all(),
    overrides: db.prepare('SELECT kind,raw_value,target FROM research_taxonomy_overrides').all() };
}
// Synthetic EDGAR-shaped registrant projections (example.com hosts, invented names); never source data.
function edgar(n = 1) {
  return { cik: String(100000 + n), entityType: 'operating', name: `Fixture Operating ${n} Inc.`,
    sic: '7372', sicDescription: 'Services-Prepackaged Software', stateOfIncorporation: 'DE',
    website: `www.usfixture${n}.example.com`,
    filings: { recent: { form: ['8-K', '10-Q', '10-K', '10-Q'], filingDate: ['2026-10-30', '2026-08-06', '2026-02-20', '2025-11-05'] } } };
}
function candidate(n, record = edgar(n), manifestId = 'fixture-SEC') {
  return { registry: 'SEC', source_manifest_id: manifestId, registration_id: String(100000 + n).padStart(10, '0'),
    name: `Fixture Operating ${n} Inc.`, website: `https://www.usfixture${n}.example.com`, country_code: 'US',
    sector: 'Services-Prepackaged Software', founded_year: null, primary_record_sha256: primaryRecordSha256(record) };
}
async function sources(dir, records, { host = REGISTRIES.SEC.host, id = 'fixture-SEC' } = {}) {
  const policy = REGISTRIES.SEC, proof = records.map((row) => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(join(dir, 'proof-sec.jsonl'), proof);
  const manifest = { id, registry: 'SEC', source_url: `https://${host}/Archives/edgar/daily-index/bulkdata/submissions.zip`,
    source_name: policy.name, source_license: policy.license, source_license_url: policy.licenseUrl, retrieved_at: RETRIEVED,
    records_file: 'proof-sec.jsonl', records_sha256: sha(proof), records_count: records.length,
    upstream_snapshots: [{ source_url: `https://${host}/Archives/edgar/daily-index/bulkdata/submissions.zip`, sha256: 'a'.repeat(64) }] };
  const path = join(dir, 'manifest-sec.json'); writeFileSync(path, JSON.stringify([manifest]));
  return { evidence: await loadPrimaryEvidence([path], { asOf: AS_OF }), path };
}
const prepare = (rows, old, evidence, qualityHolds = []) => prepareRegisterSnapshot(rows, old, { asOf: AS_OF, baselineObservedAt: RETRIEVED, evidence, qualityHolds });

test('D8963 an EDGAR operating company is admitted from native fields as a North American register row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-admit-')), db = database();
  try {
    const projected = projectPrimaryRecord('SEC', edgar(1), AS_OF).row;
    assert.equal(projected.registration_id, '0000100001');
    assert.equal(projected.incorporation_state, 'DE');
    assert.equal(projected.legal_form, null);
    assert.equal(projected.founded_year, null);
    assert.equal(projected.website, 'https://www.usfixture1.example.com');
    const { evidence } = await sources(dir, [edgar(1), edgar(2)]);
    const prepared = prepare([candidate(1), candidate(2)], baseline(db), evidence);
    assert.equal(prepared.accepted.length, 2);
    const [row] = prepared.accepted;
    assert.equal(row.uid, 'us-sec:0000100001');
    assert.equal(row.source_url, 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000100001');
    assert.deepEqual([row.country_code, row.country, row.region], ['US', 'United States', 'North America']);
    assert.equal(row.source_license, 'US-SEC-public-information');
    assert.match(row.country_basis, /state of incorporation/);
    assert.match(row.website_scope, /SEC EDGAR registrant record/);
    assert.deepEqual(row.unsupported_metrics, { revenue: null, valuation: null, funding_total: null, employee_count: null });
    assert.equal(prepared.report.coverage.regions['North America'], 2);
    assert.equal(prepared.report.original_worldwide_acceptance.pass, false);
    assert.equal(prepared.report.source_terms_reviews.SEC.sql_allowed, false);
    assert.equal(prepared.report.source_terms_reviews.SEC.state, 'pending');
    // Without a United States taxonomy row, the register's own country and region apply, never Europe.
    const withoutUs = baseline(db); withoutUs.countries = withoutUs.countries.filter((country) => country.code !== 'US');
    const fallback = prepare([candidate(1)], withoutUs, evidence).accepted[0];
    assert.deepEqual([fallback.country, fallback.region], ['United States', 'North America']);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D8963 people, funds, foreign or territorial filers, lapsed reporters, Form 15 terminations and passive SIC codes are held', () => {
  assert.ok(projectPrimaryRecord('SEC', edgar(), AS_OF).row);
  const cases = [
    [(r) => { r.entityType = 'other'; }, 'noncompany_legal_form'],
    [(r) => { delete r.entityType; }, 'noncompany_legal_form'],
    [(r) => { r.stateOfIncorporation = 'K3'; }, 'missing_incorporation_evidence'],
    [(r) => { r.stateOfIncorporation = 'PR'; }, 'missing_incorporation_evidence'],
    [(r) => { r.stateOfIncorporation = ''; }, 'missing_incorporation_evidence'],
    [(r) => { r.cik = '0'; }, 'invalid_registry_id'],
    [(r) => { r.cik = '12345678901'; }, 'invalid_registry_id'],
    [(r) => { delete r.filings; }, 'missing_native_filing_history'],
    [(r) => { r.filings.recent.filingDate.pop(); }, 'missing_native_filing_history'],
    [(r) => { r.filings.recent = { form: ['10-K', '8-K'], filingDate: ['2023-03-01', '2026-10-01'] }; }, 'missing_recent_corporate_activity_evidence'],
    [(r) => { r.filings.recent = { form: ['8-K', 'S-1'], filingDate: ['2026-10-01', '2026-09-01'] }; }, 'missing_recent_corporate_activity_evidence'],
    [(r) => { r.filings.recent.form.unshift('15-12G'); r.filings.recent.filingDate.unshift('2026-11-01'); }, 'inactive_or_insolvent_or_unknown_status'],
    [(r) => { r.filings.recent.form.unshift('15-15D'); r.filings.recent.filingDate.unshift('2026-08-06'); }, 'inactive_or_insolvent_or_unknown_status'],
    [(r) => { r.filings.recent.form.push('15-12B'); r.filings.recent.filingDate.push('unknown'); }, 'inactive_or_insolvent_or_unknown_status'],
    [(r) => { r.filings.recent.form.push('15-12G'); r.filings.recent.filingDate.push('2027-01-02'); }, 'inactive_or_insolvent_or_unknown_status'],
    [(r) => { r.sic = '6770'; r.sicDescription = 'Blank Checks'; }, 'passive_property_financial_or_head_office_activity'],
    [(r) => { r.sic = '6798'; r.sicDescription = 'Real Estate Investment Trusts'; }, 'passive_property_financial_or_head_office_activity'],
    [(r) => { r.sic = '6500'; r.sicDescription = 'Real Estate'; }, 'passive_property_financial_or_head_office_activity'],
    [(r) => { r.sic = '6021'; r.sicDescription = 'National Commercial Banks'; }, 'passive_property_financial_or_head_office_activity'],
    [(r) => { r.sic = ''; }, 'unknown_native_activity'],
    [(r) => { r.sicDescription = ''; }, 'unknown_native_activity'],
    [(r) => { r.website = ''; }, 'unusable_registered_website'],
    [(r) => { r.website = 'https://www.linkedin.com/company/fixture'; }, 'unusable_registered_website'],
  ];
  for (const [mutate, reason] of cases) {
    const record = edgar(); mutate(record);
    assert.equal(projectPrimaryRecord('SEC', record, AS_OF).reason, reason, JSON.stringify(record));
  }
  // A registrant that filed Form 15 and later resumed periodic reporting is current again.
  const resumed = edgar(); resumed.filings.recent.form.push('15-12G'); resumed.filings.recent.filingDate.push('2024-01-10');
  assert.ok(projectPrimaryRecord('SEC', resumed, AS_OF).row);
  const insurer = edgar(); insurer.sic = '6311'; insurer.sicDescription = 'Life Insurance';
  assert.ok(projectPrimaryRecord('SEC', insurer, AS_OF).row);
});

test('D8963 candidate claims, manifest hosts, shared identities and existing directory rows are checked for SEC rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-integrity-')), db = database();
  try {
    const { evidence } = await sources(dir, [edgar(1)]);
    for (const change of [{ registration_id: '100001' }, { name: 'Invented Corp.' }, { website: 'https://elsewhere.example.com' },
      { country_code: 'CA' }, { sector: 'Invented' }, { founded_year: 1999 }, { uid: 'us-sec:100001' }, { source_name: 'Wikidata' }]) {
      assert.equal(prepare([{ ...candidate(1), ...change }], baseline(db), evidence).accepted.length, 0, JSON.stringify(change));
    }
    const old = { uid: 'q1', name: 'Another name', country: 'United States', website: 'http://USFIXTURE1.example.com/about' };
    assert.equal(prepare([candidate(1)], baseline(db, [old]), evidence).rejected[0].reason, 'duplicate_by_domain');
    const holds = [{ decision: 'hold', reason: 'Prior review found a different operator', evidence_url: 'https://registry.example.com/review',
      identity: { registry: 'SEC', registration_id: '0000100001' } }];
    assert.match(prepare([candidate(1)], baseline(db), evidence, holds).rejected[0].reason, /^retained_quality_hold:/);
    const twin = edgar(2); twin.website = edgar(1).website;
    const shared = await sources(dir, [edgar(1), twin]);
    assert.equal(prepare([candidate(1)], baseline(db), shared.evidence).rejected[0].reason, 'shared_registered_domain_all_held');
    await sources(dir, [edgar(1)], { host: 'www.sec.gov' });
    await assert.rejects(sources(dir, [edgar(1)], { host: 'sec.example.com' }), /official source provenance/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D8963 SQL is withheld for a register whose terms review is not recorded, alone or mixed with reviewed registers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-terms-')), db = database();
  try {
    assert.equal(REGISTER_TERMS_REVIEWS.SEC.state, 'pending');
    assert.match(termsReviewProblem('SEC'), /^terms review pending: .*www\.sec\.gov/);
    for (const registry of ['BRREG', 'PRH', 'RIK']) assert.equal(termsReviewProblem(registry), null, registry);
    const reviewed = { state: 'reviewed', licence_id: REGISTRIES.SEC.license, licence_url: 'https://www.sec.gov/privacy',
      terms_url: 'https://www.sec.gov/privacy', reviewed_on: '2026-12-01', record: 'D8963 part 2' };
    assert.equal(termsReviewProblem('SEC', reviewed), null);
    for (const change of [{ licence_id: 'CC0-1.0' }, { terms_url: 'http://www.sec.gov/privacy' }, { reviewed_on: null }, { record: '' }, { state: 'not found' }]) {
      assert.ok(termsReviewProblem('SEC', { ...reviewed, ...change }), JSON.stringify(change));
    }
    assert.equal(termsReviewProblem('UNKNOWN', reviewed), 'no terms-review record');
    const { evidence } = await sources(dir, [edgar(1)]);
    const prepared = prepare([candidate(1)], baseline(db), evidence);
    assert.equal(prepared.accepted.length, 1);
    assert.throws(() => registerMigrationStatements(prepared.accepted), /SQL withheld for SEC until its source terms are reviewed/);
    assert.throws(() => registerMigration(prepared.accepted, AS_OF), /SQL withheld for SEC/);
    assert.equal(db.prepare('SELECT count(*) n FROM research_company_directory').get().n, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D8963 CLI dry run on fixtures writes the report and audit, and no SQL or statements, while SEC terms are pending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-cli-')), db = database();
  try {
    const { path } = await sources(dir, [edgar(1), edgar(2)]);
    writeFileSync(join(dir, 'candidates.json'), JSON.stringify([candidate(1), candidate(2)]));
    writeFileSync(join(dir, 'existing.json'), JSON.stringify(baseline(db)));
    writeFileSync(join(dir, 'holds.json'), '[]');
    const out = (name) => join(dir, name);
    const code = await main(['--candidates', out('candidates.json'), '--source-manifests', path, '--existing', out('existing.json'),
      '--quality-holds', out('holds.json'), '--as-of', AS_OF, '--baseline-observed-at', RETRIEVED, '--out', out('proposal.sql'),
      '--statements', out('statements.json'), '--report', out('report.json'), '--audit', out('audit.json')]);
    assert.equal(code, 2);
    assert.equal(existsSync(out('proposal.sql')), false);
    assert.equal(existsSync(out('statements.json')), false);
    const report = JSON.parse(readFileSync(out('report.json'), 'utf8'));
    assert.deepEqual(report.sql_withheld_for_terms_review, ['SEC']);
    assert.equal(report.database_writes_performed, false);
    assert.equal(report.statement_count, 0);
    assert.equal(report.accepted, 2);
    assert.equal(report.proposed_sql_sha256, undefined);
    assert.equal(JSON.parse(readFileSync(out('audit.json'), 'utf8')).admitted_rows.length, 2);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
