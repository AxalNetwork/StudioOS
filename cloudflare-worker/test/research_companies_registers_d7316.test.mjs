/** D7316 (#7316): primary-register proof integrity, conservative admission and real-schema SQL replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  loadPrimaryEvidence, main, prepareRegisterSnapshot, primaryRecordSha256, projectPrimaryRecord,
  registerMigration, registerMigrationStatements, REGISTRIES, sourceWebsite,
} from '../../scripts/import-register-companies.mjs';
import { MAX_STATEMENT_BYTES } from '../../scripts/import-wikidata-worldwide.mjs';

const AS_OF = '2026-11-19';
const RETRIEVED = '2026-11-19T01:02:03.123456+00:00';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => JSON.parse(JSON.stringify(value));
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
// These are deliberately synthetic native-register fixtures, never source data.
function native(registry, n = 1) {
  if (registry === 'BRREG') return { organisasjonsnummer: String(900000000 + n), navn: `Nordic Fixture ${n} AS`,
    organisasjonsform: { kode: 'AS' }, hjemmeside: `www.nordic${n}.example.com`, forretningsadresse: { landkode: 'NO' },
    registrertIForetaksregisteret: true, konkurs: false, underAvvikling: false, underTvangsavviklingEllerTvangsopplosning: false,
    stiftelsesdato: '2014-02-03', sisteInnsendteAarsregnskap: '2025',
    naeringskode1: { kode: '62.100', beskrivelse: 'Dataprogrammeringstjenester' } };
  if (registry === 'PRH') return { businessId: { value: `100000${n}-1`, registrationDate: '1970-01-02' },
    names: [{ name: `Finnish Fixture ${n} Oy`, type: '1', version: 1, registrationDate: '2001-01-02', endDate: null }],
    companyForms: [{ type: '16', version: 1, endDate: null }], status: '2', tradeRegisterStatus: '1', endDate: null,
    companySituations: [], registeredEntries: [{ register: '1', type: '1', registrationDate: '2001-01-02', endDate: null },
      { register: '5', type: '55', registrationDate: '2001-01-02', endDate: null }],
    website: { url: `www.finnish${n}.example.com`, registrationDate: '2003-01-02' },
    mainBusinessLine: { type: '62100', descriptions: [{ languageCode: '3', description: 'Computer programming activities' }] } };
  return { ariregistri_kood: 10000000 + n, nimi: `Baltic Fixture ${n} OÜ`, yldandmed: {
    staatus: 'R', kustutamise_kpv: null, oiguslik_vorm: 'OÜ', oiguslik_vorm_nr: 5, oigusliku_vormi_alaliik: null,
    arinimed: [{ sisu: `Baltic Fixture ${n} OÜ`, algus_kpv: '02.01.2004', lopp_kpv: null }],
    oiguslikud_vormid: [{ sisu: 'OÜ', algus_kpv: '02.01.2004', lopp_kpv: null }],
    sidevahendid: [{ liik: 'WWW', sisu: `https://baltic${n}.example.com`, algus_kpv: '02.01.2004', lopp_kpv: null }],
    teatatud_tegevusalad: [{ emtak_kood: '62101', emtak_tekstina: 'Computer programming', on_pohitegevusala: true, lopp_kpv: null }],
    esmaregistreerimise_kpv: '02.01.2004', markused_kaardil: [],
    info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025' }],
  } };
}
function candidate(registry, n, record = native(registry, n), manifestId = `fixture-${registry}`) {
  const values = registry === 'BRREG' ? { registration_id: String(900000000 + n), name: `Nordic Fixture ${n} AS`,
    website: `https://www.nordic${n}.example.com`, country_code: 'NO', sector: 'Dataprogrammeringstjenester', founded_year: 2014 }
    : registry === 'PRH' ? { registration_id: `100000${n}-1`, name: `Finnish Fixture ${n} Oy`,
      website: `https://www.finnish${n}.example.com`, country_code: 'FI', sector: 'Computer programming activities', founded_year: null }
      : { registration_id: String(10000000 + n), name: `Baltic Fixture ${n} OÜ`,
        website: `https://baltic${n}.example.com`, country_code: 'EE', sector: 'Computer programming', founded_year: null };
  return { registry, source_manifest_id: manifestId, ...values, primary_record_sha256: primaryRecordSha256(record) };
}
async function sources(dir, groups) {
  const paths = [];
  for (let i = 0; i < groups.length; i++) {
    const { registry, records, id = `fixture-${registry}` } = groups[i], policy = REGISTRIES[registry];
    const proofName = `proof-${i}.jsonl`, proof = records.map((row) => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(join(dir, proofName), proof);
    const manifest = { id, registry, source_url: `https://${policy.host}/fixture`, source_name: policy.name,
      source_license: policy.license, source_license_url: policy.licenseUrl, retrieved_at: RETRIEVED,
      records_file: proofName, records_sha256: sha(proof), records_count: records.length,
      upstream_snapshots: [{ source_url: `https://${policy.host}/fixture`, sha256: 'a'.repeat(64) }] };
    const path = join(dir, `manifest-${i}.json`); writeFileSync(path, JSON.stringify([manifest])); paths.push(path);
  }
  return { evidence: await loadPrimaryEvidence(paths, { asOf: AS_OF }), paths };
}
const prepare = (rows, old, evidence) => prepareRegisterSnapshot(rows, old, { asOf: AS_OF, baselineObservedAt: RETRIEVED, evidence, qualityHolds: [] });

test('D7316 official registers admit native corporate identities and retain unknown metrics without inferring founding dates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-proof-')), db = database();
  try {
    const types = ['BRREG', 'PRH', 'RIK'];
    const { evidence } = await sources(dir, types.map((registry) => ({ registry, records: [native(registry)] })));
    const prepared = prepare(types.map((registry) => candidate(registry, 1)), baseline(db), evidence);
    assert.equal(prepared.accepted.length, 3);
    assert.deepEqual(prepared.accepted.map((r) => [r.country_code, r.founded_year]), [['EE', null], ['FI', null], ['NO', 2014]]);
    assert.equal(prepared.report.original_worldwide_acceptance.pass, false);
    assert.equal(prepared.report.user_goal.source_admitted_target_reached, false);
    assert.ok(prepared.report.original_worldwide_acceptance.failures.some((reason) => reason.startsWith('countries')));
    for (const row of prepared.accepted) {
      assert.deepEqual(row.unsupported_metrics, { revenue: null, valuation: null, funding_total: null, employee_count: null });
      assert.match(row.website_scope, /not independently verified/);
    }
    const sql = registerMigration(prepared.accepted, AS_OF);
    db.exec(sql); db.exec(sql);
    assert.equal(db.prepare('SELECT count(*) n FROM research_company_directory').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM research_company_directory WHERE revenue IS NOT NULL OR valuation IS NOT NULL OR funding_total IS NOT NULL OR employee_count IS NOT NULL').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM company_sources').get().n, 13);
    assert.equal(db.prepare("SELECT count(*) n FROM company_sources WHERE verified_at IS NOT NULL OR source_type<>'official_registry'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM company_sources s JOIN research_company_directory d ON d.id=s.company_id WHERE s.field_name='founded_year' AND d.country<>'Norway'").get().n, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 primary file bytes and every declared candidate identity field are pinned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-integrity-')), db = database();
  try {
    const record = native('BRREG'), good = candidate('BRREG', 1);
    const { evidence, paths } = await sources(dir, [{ registry: 'BRREG', records: [record] }]);
    assert.equal(prepare([good], baseline(db), evidence).accepted.length, 1);
    for (const change of [{ name: 'Invented company AS' }, { website: 'https://elsewhere.example.com' }, { country_code: 'FI' },
      { sector: 'Invented sector' }, { founded_year: 1970 }, { primary_record_sha256: 'b'.repeat(64) }, { registration_id: '900000099' },
      { source_manifest_id: 'missing' }, { source_name: 'Wikidata' }, { source_url: 'https://www.wikidata.org/wiki/Q1' }]) {
      assert.equal(prepare([{ ...good, ...change }], baseline(db), evidence).accepted.length, 0, JSON.stringify(change));
    }
    writeFileSync(join(dir, 'proof-0.jsonl'), JSON.stringify({ ...record, navn: 'Changed after pinning' }) + '\n');
    await assert.rejects(loadPrimaryEvidence(paths, { asOf: AS_OF }), /file hash mismatch/);
    const manifest = JSON.parse(readFileSync(paths[0], 'utf8')); manifest[0].source_url = 'https://unrelated.example.com/data';
    writeFileSync(paths[0], JSON.stringify(manifest));
    await assert.rejects(loadPrimaryEvidence(paths, { asOf: AS_OF }), /official source provenance/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 status, legal form, industry and dated risk-note gates derive from primary records independently of candidate claims', () => {
  for (const [registry, mutations] of [
    ['BRREG', [
      (r) => { r.organisasjonsform.kode = 'ENK'; }, (r) => { r.konkurs = true; },
      (r) => { delete r.underAvvikling; }, (r) => { r.underTvangsavviklingEllerTvangsopplosning = true; },
      (r) => { r.naeringskode1.kode = '68.200'; }, (r) => { r.sisteInnsendteAarsregnskap = '2021'; },
    ]],
    ['PRH', [
      (r) => { r.companyForms[0].type = '26'; }, (r) => { r.status = '3'; },
      (r) => { r.companySituations = [{ registrationDate: 'invalid', endDate: null }]; },
      (r) => { r.companySituations = [{ registrationDate: '2027-01-01', endDate: 'invalid' }]; },
      (r) => { r.registeredEntries = r.registeredEntries.slice(0, 1); },
      (r) => { r.names.push({ ...r.names[0], name: 'Other current name' }); },
    ]],
    ['RIK', [
      (r) => { r.yldandmed.oiguslik_vorm = 'MTÜ'; }, (r) => { r.yldandmed.staatus = 'L'; },
      (r) => { delete r.yldandmed.markused_kaardil; },
      (r) => { r.yldandmed.markused_kaardil = [{ sisu: 'Interim bankruptcy administrator appointed', algus_kpv: 'invalid', lopp_kpv: null }]; },
      (r) => { r.yldandmed.markused_kaardil = [{ sisu: 'Unknown current legal restriction', lopp_kpv: '01.01.2027' }]; },
      (r) => { r.yldandmed.info_majandusaasta_aruannetest = []; r.yldandmed.latest_report_period_end = '2025-12-31'; },
    ]],
  ]) {
    assert.ok(projectPrimaryRecord(registry, native(registry), AS_OF).row, registry);
    for (const mutate of mutations) {
      const record = native(registry); mutate(record);
      assert.ok(projectPrimaryRecord(registry, record, AS_OF).reason, `${registry}: ${JSON.stringify(record)}`);
    }
  }
  const routine = native('RIK'); routine.yldandmed.markused_kaardil = [{ sisu: 'Kanne on tehtud äriregistri seaduse § 70 lõike 1 alusel.', lopp_kpv: null }];
  assert.ok(projectPrimaryRecord('RIK', routine, AS_OF).row);
  routine.yldandmed.markused_kaardil[0].sisu += ' Other condition.';
  assert.equal(projectPrimaryRecord('RIK', routine, AS_OF).reason, 'current_registry_card_note_requires_review');
  for (const website of ['https://facebook.com/fixture', 'www.bad_domain.example.com', 'https://account:secret@example.com', 'https://127.0.0.1', 'https://private.local',
    'https://fixture.a', 'https://fixture.1', 'https://first.example.com|https://second.example.com',
    'https://first.example.com/%7Chttps%3A%2F%2Fsecond.example.com', 'https://first.example.com/https://second.example.com',
    `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`]) assert.equal(sourceWebsite(website), null);
});

test('D7316 all shared domains and names hold across complete ledgers, including identities omitted from candidate selection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-duplicates-')), db = database();
  try {
    const first = native('BRREG', 1), second = native('BRREG', 2), third = native('BRREG', 3), fourth = native('BRREG', 4);
    second.hjemmeside = first.hjemmeside; fourth.navn = third.navn;
    const { evidence } = await sources(dir, [{ registry: 'BRREG', records: [first, second, third, fourth] }]);
    const result = prepare([candidate('BRREG', 1), candidate('BRREG', 3)], baseline(db), evidence);
    assert.equal(result.accepted.length, 0);
    assert.deepEqual(new Set(result.rejected.map((r) => r.reason)), new Set(['shared_registered_domain_all_held', 'shared_registered_name_country_all_held']));
    const other = { ...first, navn: 'Contradictory identity AS' };
    const conflict = await sources(dir, [{ registry: 'BRREG', id: 'one', records: [first] }, { registry: 'BRREG', id: 'two', records: [other] }]);
    const held = prepare([candidate('BRREG', 1, first, 'one')], baseline(db), conflict.evidence);
    assert.equal(held.rejected[0].reason, 'conflicting_primary_identity');
    const single = await sources(dir, [{ registry: 'BRREG', records: [first] }]);
    const old = { uid: 'legacy', name: 'Different name', country: 'Norway', website: 'http://www.NORDIC1.example.com:80/old' };
    assert.equal(prepare([candidate('BRREG', 1)], baseline(db, [old]), single.evidence).rejected[0].reason, 'duplicate_by_domain');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 immutable evidence handles and exact admitted objects protect both SQL emitters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-admission-')), db = database();
  try {
    const { evidence } = await sources(dir, [{ registry: 'BRREG', records: [native('BRREG')] }]);
    assert.ok(Object.isFrozen(evidence));
    assert.equal(evidence.records, undefined);
    assert.throws(() => { evidence.records = new Map(); }, TypeError);
    assert.throws(() => prepare([candidate('BRREG', 1)], baseline(db), { ...evidence }), /Verified primary source files/);
    assert.throws(() => prepareRegisterSnapshot([], baseline(db), { asOf: AS_OF, baselineObservedAt: '2026-11-18T00:00:00Z', evidence }), /same-day/);
    const prepared = prepare([candidate('BRREG', 1)], baseline(db), evidence);
    assert.throws(() => prepareRegisterSnapshot([candidate('BRREG', 1)], baseline(db), { asOf: AS_OF, baselineObservedAt: RETRIEVED, evidence }), /explicit qualityHolds/);
    const qualityHolds = [{ decision: 'hold', reason: 'Previously observed website redirects to another entity',
      evidence_url: 'https://registry.example.com/old-review', identity: { domain: 'nordic1.example.com' } }];
    const retained = prepareRegisterSnapshot([candidate('BRREG', 1)], baseline(db), { asOf: AS_OF, baselineObservedAt: RETRIEVED, evidence, qualityHolds });
    assert.equal(retained.accepted.length, 0);
    assert.match(retained.rejected[0].reason, /^retained_quality_hold:/);
    qualityHolds[0].identity = { name: 'NORDIC FIXTURE 1 AS', country_code: 'NO' };
    assert.equal(prepareRegisterSnapshot([candidate('BRREG', 1)], baseline(db), { asOf: AS_OF, baselineObservedAt: RETRIEVED, evidence, qualityHolds }).accepted.length, 0);
    assert.throws(() => { prepared.report.primary_source_manifests[0].retrieved_at = '2026-11-18T00:00:00Z'; }, TypeError);
    assert.throws(() => { prepared.accepted[0].upstream_snapshots[0].sha256 = 'b'.repeat(64); }, TypeError);
    assert.throws(() => { prepared.accepted[0].source_website_values[0] = 'https://changed.example.com'; }, TypeError);
    assert.equal(prepare([candidate('BRREG', 1)], baseline(db), evidence).accepted[0].retrieved_at, RETRIEVED);
    for (const row of [candidate('BRREG', 1), copy(prepared.accepted[0])]) assert.throws(() => registerMigrationStatements([row]), /unchanged primary-register admitted/);
    prepared.accepted[0].sector = 'Changed after admission';
    assert.throws(() => registerMigrationStatements(prepared.accepted), /unchanged primary-register admitted/);
    assert.throws(() => registerMigration(prepared.accepted, AS_OF), /unchanged primary-register admitted/);
    const fresh = prepare([candidate('BRREG', 1)], baseline(db), evidence);
    assert.ok(registerMigrationStatements(fresh.accepted).every((sql) => Buffer.byteLength(sql) < MAX_STATEMENT_BYTES));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 additive SQL preserves existing rows and cannot attach proof to a same-UID conflicting row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-sql-')), db = database();
  try {
    const { evidence } = await sources(dir, [{ registry: 'BRREG', records: [native('BRREG', 1), native('BRREG', 2)] }]);
    const prepared = prepare([candidate('BRREG', 1), candidate('BRREG', 2)], baseline(db), evidence);
    const row = prepared.accepted[0];
    db.prepare('INSERT INTO research_company_directory(uid,name,website,country,founded_year,sector,source_name,source_url,source_license,as_of,revenue) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.uid, row.name, row.website, row.country, row.founded_year, 'Manually reviewed different sector', row.source_name, row.source_url, row.source_license, row.as_of, 12345);
    db.exec(registerMigration(prepared.accepted, AS_OF));
    assert.equal(db.prepare('SELECT count(*) n FROM research_company_directory').get().n, 2);
    const kept = db.prepare('SELECT sector,revenue FROM research_company_directory WHERE uid=?').get(row.uid);
    assert.deepEqual({ ...kept }, { sector: 'Manually reviewed different sector', revenue: 12345 });
    assert.equal(db.prepare('SELECT count(*) n FROM company_sources s JOIN research_company_directory d ON d.id=s.company_id WHERE d.uid=?').get(row.uid).n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM company_sources').get().n, 5);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D7316 CLI emits only a proposal, reports failed worldwide gates honestly, and refuses to overwrite proof input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-cli-')), db = database();
  try {
    const { paths } = await sources(dir, [{ registry: 'BRREG', records: [native('BRREG')] }]);
    writeFileSync(join(dir, 'candidates.json'), JSON.stringify([candidate('BRREG', 1)]));
    writeFileSync(join(dir, 'existing.json'), JSON.stringify(baseline(db)));
    writeFileSync(join(dir, 'holds.json'), '[]');
    const args = ['--candidates', join(dir, 'candidates.json'), '--source-manifests', paths[0], '--existing', join(dir, 'existing.json'),
      '--quality-holds', join(dir, 'holds.json'), '--as-of', AS_OF, '--baseline-observed-at', RETRIEVED, '--out', join(dir, 'proposal.sql'), '--statements', join(dir, 'statements.json'),
      '--report', join(dir, 'report.json'), '--audit', join(dir, 'audit.json')];
    assert.equal(await main(args), 0);
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.database_writes_performed, false);
    assert.equal(report.original_worldwide_gate_preserved, true);
    assert.equal(report.original_worldwide_acceptance.pass, false);
    assert.equal(report.accepted, 1);
    const bad = [...args]; bad[bad.indexOf('--out') + 1] = join(dir, 'proof-0.jsonl');
    const before = readFileSync(join(dir, 'proof-0.jsonl'));
    await assert.rejects(main(bad), /must not overwrite a primary source ledger/);
    assert.deepEqual(readFileSync(join(dir, 'proof-0.jsonl')), before);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
