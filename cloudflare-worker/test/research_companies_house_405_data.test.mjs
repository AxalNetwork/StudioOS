/** D596 (#1231): the generated October Companies House rows, after Wikidata's 403. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { listCompanies, parseCompanyQuery } from '../src/services/researchCompanyDirectory.ts';
import { mapCompanySector } from '../src/services/researchTaxonomy.ts';
import { OGL, SIC_SECTORS, SOURCE, nameKey } from '../../scripts/import-companies-house.mjs';

const migration = (n) => readFileSync(resolve(`cloudflare-worker/sql/migrations/${n}`), 'utf8');
const generated = migration('405_research_company_directory_companies_house.sql');
const statements = generated.split('\n').filter((line) => line.startsWith('INSERT OR IGNORE INTO research_company_directory'));
const PERSONAL_COLUMN = /address|officer|psc|significant|postcode|post_code|care_of|careof|person|director|birth/i;
const COLUMNS = 'uid, name, website, country, founded_year, sector, sic_codes, source_name, source_url, source_license, as_of';

function schema() {
  const db = new DatabaseSync(':memory:');
  for (const n of ['228_research_company_directory.sql', '375_research_company_directory_columns.sql',
    '376_research_taxonomy.sql', '403_research_company_directory_wikidata.sql']) db.exec(migration(n));
  return db;
}

function generatedProblems(sql) {
  const inserts = sql.split('\n').filter((line) => line.startsWith('INSERT'));
  const ids = inserts.map((line) => /^INSERT OR IGNORE INTO research_company_directory .* SELECT 'ch-([a-z0-9]{8})'/.exec(line)?.[1]);
  const problems = [];
  if (inserts.length !== 3000) problems.push('cap');
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) problems.push('company number');
  if (inserts.some((line) => !line.includes(`(${COLUMNS}) SELECT`))) problems.push('columns');
  if (inserts.some((line) => !line.includes('WHERE NOT EXISTS (SELECT 1 FROM research_company_directory d'))) problems.push('name-key guard');
  return problems;
}

function rowProblems(rows, allUk) {
  const problems = [];
  const seen = new Map();
  for (const row of allUk) {
    const key = nameKey(row.name);
    const old = seen.get(key);
    if (old && (old.source_name === SOURCE || row.source_name === SOURCE)) problems.push('duplicate UK name key');
    seen.set(key, row);
  }
  for (const row of rows) {
    if (row.source_name !== SOURCE || row.source_license !== OGL
      || row.source_url !== `https://find-and-update.company-information.service.gov.uk/company/${row.uid.slice(3).toUpperCase()}`
      || row.country !== 'United Kingdom' || row.as_of !== '2026-10-01' || row.website !== '') problems.push('source');
    if (row.funding_total != null || row.revenue != null || row.employee_count != null
      || row.valuation != null || row.last_funding_amount != null) problems.push('unsupported metric');
    if (!row.sic_codes?.split(',').some((code) => SIC_SECTORS[code] === row.sector)
      || mapCompanySector(row.sector).targets.length !== 1) problems.push('SIC mapping');
  }
  return [...new Set(problems)];
}

test('405 is the unedited generated shape: 3,000 distinct company numbers and only approved columns', () => {
  assert.deepEqual(generatedProblems(generated), []);
  assert.equal(statements.length, 3000);
  assert.deepEqual(generatedProblems(generated.replace('SELECT \'ch-00045810\'', 'SELECT \'ch-00245740\'')), ['company number']);
  assert.deepEqual(generatedProblems(generated.replace(`(${COLUMNS}) SELECT`, `(${COLUMNS}, officer) SELECT`)), ['columns']);
  assert.deepEqual(generatedProblems(generated.replace('WHERE NOT EXISTS (SELECT 1 FROM research_company_directory d', 'WHERE EXISTS (SELECT 1 FROM research_company_directory d')), ['name-key guard']);
  assert.deepEqual(generatedProblems(generated), [], 'restored source passes after every in-memory mutation');
});

test('403 then 405 inserts only source-backed UK companies, with no personal fields or fabricated metrics', () => {
  const db = schema();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_company_directory').get().n, 3300);
  db.exec(generated);
  const rows = db.prepare("SELECT * FROM research_company_directory WHERE source_name = 'Companies House'").all();
  const allUk = db.prepare("SELECT name, source_name FROM research_company_directory WHERE country = 'United Kingdom'").all();
  assert.equal(rows.length, 2986, '14 of the 3,000 register rows match an existing UK name');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_company_directory').get().n, 6286);
  assert.deepEqual(rowProblems(rows, allUk), []);
  const columns = db.prepare('PRAGMA table_info(research_company_directory)').all().map((r) => r.name);
  assert.deepEqual(columns.filter((name) => PERSONAL_COLUMN.test(name)), []);
  db.exec(statements.join('\n'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_company_directory').get().n, 6286, 'replay cannot add a company');

  const first = rows[0];
  for (const [patch, expected] of [
    [{ source_license: 'missing' }, 'source'],
    [{ source_url: 'https://example.invalid/company' }, 'source'],
    [{ website: 'https://invented.invalid' }, 'source'],
    [{ funding_total: 1 }, 'unsupported metric'],
    [{ sic_codes: '99999' }, 'SIC mapping'],
  ]) {
    assert.ok(rowProblems([{ ...first, ...patch }], allUk).includes(expected), expected);
    assert.deepEqual(rowProblems([first], allUk), [], `${expected}: original passes again`);
  }
  assert.ok(rowProblems([first], [...allUk, { name: first.name, source_name: 'Wikidata' }]).includes('duplicate UK name key'));
  assert.deepEqual(rowProblems(rows, allUk), [], 'original UK names pass again');
  db.close();
});

test('the actual directory country filter and facets count the applied Companies House rows', async () => {
  const db = schema();
  db.exec(generated);
  const env = { DB: d1Over(db) };
  const query = (params) => parseCompanyQuery((key) => params[key]);
  const gb = await listCompanies(env, query({ country_code: 'GB', limit: '1' }));
  assert.equal(gb.total, 3165);
  assert.equal(gb.coverage.of, 6286);
  assert.equal(gb.facets.countries.find((c) => c.code === 'GB')?.count, 3165);
  assert.equal(gb.facets.sector_labels.find((s) => s.label === 'bank')?.count, 104);
  const banks = await listCompanies(env, query({ country_code: 'GB', sector_label: 'bank', limit: '100' }));
  assert.ok(banks.items.some((row) => row.source_name === SOURCE && row.source_url.includes('/company/')));

  const original = db.prepare("SELECT uid, sector FROM research_company_directory WHERE source_name = 'Companies House' AND sector = 'bank' LIMIT 1").get();
  db.prepare('UPDATE research_company_directory SET country = ? WHERE uid = ?').run('France', original.uid);
  assert.equal((await listCompanies(env, query({ country_code: 'GB', limit: '1' }))).total, 3164,
    'the country assertion detects a misplaced row');
  db.prepare('UPDATE research_company_directory SET country = ? WHERE uid = ?').run('United Kingdom', original.uid);
  assert.equal((await listCompanies(env, query({ country_code: 'GB', limit: '1' }))).total, 3165);
  db.prepare('UPDATE research_company_directory SET sector = ? WHERE uid = ?').run('not mapped', original.uid);
  assert.equal((await listCompanies(env, query({ limit: '1' }))).facets.sector_labels.find((s) => s.label === 'bank')?.count, 103,
    'the sector facet assertion detects a misplaced row');
  db.prepare('UPDATE research_company_directory SET sector = ? WHERE uid = ?').run(original.sector, original.uid);
  assert.equal((await listCompanies(env, query({ limit: '1' }))).facets.sector_labels.find((s) => s.label === 'bank')?.count, 104);
  db.close();
});
