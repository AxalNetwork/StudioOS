/**
 * D7714 (#7714) — the country import builder: what it leaves out, what it keeps,
 * and every refusal, each naming its row. Synthetic figures only.
 *
 *   node --test scripts/lib/countryImport.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CountryImportError, MAX_ROWS, buildCountryImport, parseAgain, parseCatalogue, parseConsistency, parseCsv, parseSource,
} from './countryImport.mjs';

const SCRIPT = resolve(import.meta.dirname, '..', 'build-country-import.mjs');

/** A synthetic profile as `GET /countries` returns it. */
const profile = (code, revision, extra = {}) => ({
  country_code: code, country_name: `Country ${code}`, revision,
  population: null, population_status: 'not_recorded', population_source: null, population_source_ref: null, population_as_of: null,
  ppp_gdp_per_capita: null, ppp_status: 'not_recorded', ppp_source: null, ppp_source_ref: null, ppp_as_of: null,
  startup_ecosystem_score: null, startup_ecosystem_rank: null, startup_score_status: 'not_recorded', startup_source: null, startup_source_ref: null, startup_as_of: null,
  ...extra,
});
const READ = {
  countries: [
    profile('AA', 4, { ppp_gdp_per_capita: 41_000, ppp_status: 'recorded', ppp_source: 'Synthetic PPP', ppp_source_ref: 'ref-1', ppp_as_of: '2024-12-31' }),
    profile('BB', 0),
    profile('CC', 7, { startup_ecosystem_rank: 12, startup_ecosystem_score: 5_000, startup_score_status: 'recorded', startup_source: 'Synthetic score', startup_as_of: '2025-06-01' }),
  ],
  total: 3,
};
const catalogue = () => parseCatalogue(READ);
const row = (country, field, value, extra = {}) => ({ country, field, value, status: 'recorded', source: 'Synthetic PPP', reference: 'ref-1', as_of: '2024-12-31', ...extra });
const build = (rows, opts = {}) => buildCountryImport({ rows, catalogue: catalogue(), reason: 'Synthetic refresh', ...opts });
const refusal = (rows, opts = {}) => {
  try { build(rows, opts); } catch (e) { assert.ok(e instanceof CountryImportError, String(e)); return e.problems; }
  assert.fail('expected a refusal');
};

test('a row equal to the profile in value, status, source, reference and as-of date is left out; any difference keeps it', () => {
  const out = build([
    row('AA', 'ppp_gdp_per_capita', 41_000),
    row('BB', 'population', 900_000, { source: 'Synthetic pop' }),
  ]);
  assert.deepEqual(out.left_out, [{ row: 1, key: 'AA:ppp_gdp_per_capita' }]);
  assert.deepEqual(out.body.observations.map((o) => `${o.country_code}:${o.field}`), ['BB:population']);
  assert.deepEqual(out.body.expected_revisions, { BB: 0 });
  assert.equal(out.body.reason, 'Synthetic refresh');
  for (const [k, v] of [['value', 41_001], ['status', 'provisional'], ['source', 'Other'], ['reference', 'ref-2'], ['reference', ''], ['as_of', '2025-01-01']]) {
    const kept = build([row('AA', 'ppp_gdp_per_capita', 41_000, { [k]: v, ...(k === 'value' ? { value: v } : {}) })]);
    assert.equal(kept.body?.observations.length, 1, `a different ${k} keeps the row`);
    assert.deepEqual(kept.body.expected_revisions, { AA: 4 });
  }
});

test('a field the consistency read reports, or one named again, is kept even when unchanged', () => {
  const reported = parseConsistency({ checked: { countries: 3, fields: 12 }, findings: [{ country_code: 'AA', field: 'ppp_gdp_per_capita', kind: 'value_without_history' }] });
  const viaRead = build([row('AA', 'ppp_gdp_per_capita', 41_000)], { reported });
  assert.equal(viaRead.body.observations.length, 1);
  assert.deepEqual(viaRead.kept_reported, ['AA:ppp_gdp_per_capita']);
  const viaAgain = build([row('AA', 'ppp_gdp_per_capita', 41_000)], { again: parseAgain('AA:ppp_gdp_per_capita') });
  assert.equal(viaAgain.body.observations.length, 1);
  assert.equal(build([row('AA', 'ppp_gdp_per_capita', 41_000)], { again: parseAgain('AA:population') }).body, null, 'another field named again does not keep this one');
});

test('a rank holds only its value on the profile, so an equal rank is left out and a changed one kept', () => {
  assert.equal(build([row('CC', 'startup_ecosystem_rank', 12, { source: 'Rank list' })]).body, null);
  assert.equal(build([row('CC', 'startup_ecosystem_rank', 11, { source: 'Rank list' })]).body.observations[0].value, 11);
});

test('nothing to import gives no body', () => {
  const out = build([row('AA', 'ppp_gdp_per_capita', 41_000)]);
  assert.equal(out.body, null);
});

test('it never rounds and never supplies a status, source or date: each refusal names its row', () => {
  const cases = [
    [row('AA', 'population', 100, { source: '' }), /source is missing/],
    [row('AA', 'population', 100, { source: undefined }), /source is missing/],
    [row('AA', 'population', 100, { as_of: '' }), /as-of date is missing/],
    [row('AA', 'population', 100, { as_of: '2024-02-30' }), /not a YYYY-MM-DD date/],
    [row('AA', 'population', '100.5'), /not an integer/],
    [row('AA', 'population', 100.5), /not an integer/],
    [row('AA', 'population', '1,000'), /not an integer/],
    [row('AA', 'population', '1e3'), /not an integer/],
    [row('AA', 'population', ''), /not an integer/],
    [row('ZZ', 'population', 100), /ZZ is not a country in the catalogue read/],
    [row('AA', 'startup_ecosystem_rank', 3, { status: 'provisional' }), /no provisional rank/],
    [row('AA', 'population', 100, { status: '' }), /status is missing/],
    [row('AA', 'population', 100, { status: 'estimated' }), /recorded or provisional/],
    [row('AA', 'gdp', 100), /field must be one of/],
    [row('AA', 'population', 0), /must be positive/],
    [row('AA', 'population', 100, { source: 'x'.repeat(201) }), /longer than 200/],
  ];
  for (const [r, re] of cases) {
    const problems = refusal([row('BB', 'population', 5), r]);
    assert.ok(problems.some((p) => p.row === 2 && re.test(p.problem)), `${re}: ${JSON.stringify(problems)}`);
    assert.ok(problems.every((p) => p.row === 2), 'the good row is not blamed');
  }
  const twice = refusal([row('BB', 'population', 5), row('BB', 'population', 6)]);
  assert.deepEqual(twice, [{ row: 2, problem: 'BB:population is also on row 1' }]);
});

test('more than 500 rows to send is refused; exactly 500 is built', () => {
  const countries = Array.from({ length: 26 * 26 }, (_, i) => profile(String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)), 1));
  const big = parseCatalogue({ countries });
  const rowsFor = (n) => Array.from({ length: n }, (_, i) => row(countries[Math.floor(i / 2)].country_code, i % 2 ? 'population' : 'ppp_gdp_per_capita', 10 + i));
  assert.equal(buildCountryImport({ rows: rowsFor(MAX_ROWS), catalogue: big, reason: 'Synthetic refresh' }).body.observations.length, MAX_ROWS);
  assert.throws(() => buildCountryImport({ rows: rowsFor(MAX_ROWS + 1), catalogue: big, reason: 'Synthetic refresh' }),
    (e) => e instanceof CountryImportError && /501 rows; the route takes at most 500/.test(e.message));
});

test('a reason is required; the saved reads must be the right reads', () => {
  assert.throws(() => build([row('BB', 'population', 5)], { reason: 'no' }), /reason of 3 to 500/);
  assert.throws(() => parseCatalogue({ countries: [{ country_code: 'AA', profile_revision: 3 }] }), /not the priced \/catalogue list/);
  assert.throws(() => parseCatalogue({}), /holds no countries/);
  assert.throws(() => parseConsistency({ findings: [] }), /not a saved GET/);
  assert.throws(() => parseAgain('AA-population'), /CODE:field pairs/);
});

test('the source file reads as CSV (quoted fields, CRLF) or JSON, values as written', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  const csv = parseSource('country,field,value,status,source,reference,as_of\nAA,population,"1200",recorded,"Synthetic, pop",,2024-12-31\n', 'x.csv');
  assert.deepEqual(csv, [{ country: 'AA', field: 'population', value: '1200', status: 'recorded', source: 'Synthetic, pop', reference: '', as_of: '2024-12-31' }]);
  assert.throws(() => parseSource('country,field,value\nAA,population,1\n', 'x.csv'), /does not name: status, source, as_of/);
  assert.deepEqual(parseSource(JSON.stringify([{ country_code: 'AA', field: 'population', value: 3, status: 'recorded', source: 's', source_ref: 'r', as_of: '2024-01-01' }]), 'x.json'),
    [{ country: 'AA', field: 'population', value: 3, status: 'recorded', source: 's', reference: 'r', as_of: '2024-01-01' }]);
  const out = build(csv);
  assert.deepEqual(out.body.observations, [{ country_code: 'AA', field: 'population', value: 1200, status: 'recorded', source: 'Synthetic, pop', source_ref: null, as_of: '2024-12-31' }]);
});

test('the command writes the body, writes no file when nothing changes, refuses a path inside the repository, and exits 1 on rows to fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'country-import-'));
  try {
    const cat = join(dir, 'countries.json');
    writeFileSync(cat, JSON.stringify(READ));
    const src = join(dir, 'source.csv');
    const out = join(dir, 'body.json');
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
    writeFileSync(src, 'country,field,value,status,source,reference,as_of\nBB,population,900000,recorded,Synthetic pop,,2024-12-31\n');
    const ok = run('--source', src, '--catalogue', cat, '--reason', 'Synthetic refresh', '--out', out);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Wrote 1 observations for 1 countries/);
    assert.ok(existsSync(out));
    rmSync(out);
    writeFileSync(src, 'country,field,value,status,source,reference,as_of\nAA,ppp_gdp_per_capita,41000,recorded,Synthetic PPP,ref-1,2024-12-31\n');
    const none = run('--source', src, '--catalogue', cat, '--reason', 'Synthetic refresh', '--out', out);
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /Nothing to import.*No file was written/);
    assert.equal(existsSync(out), false);
    const inside = run('--source', src, '--catalogue', cat, '--reason', 'Synthetic refresh', '--out', resolve(import.meta.dirname, 'body.json'));
    assert.equal(inside.status, 2);
    assert.match(inside.stderr, /outside the repository/);
    writeFileSync(src, 'country,field,value,status,source,reference,as_of\nAA,population,12.5,recorded,Synthetic pop,,2024-12-31\n');
    const bad = run('--source', src, '--catalogue', cat, '--reason', 'Synthetic refresh', '--out', out);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /row 1: value "12.5" is not an integer/);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
