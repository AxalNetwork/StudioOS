/**
 * D7179 (#7179, the three ◇ items of D7045) — what one company-directory list
 * call costs, and what its summary does and does not say.
 *
 *   summary cost      `directoryShape` recounts coverage and facets on every
 *                     list call. Pinned here: one list call is six reads (the
 *                     taxonomy overrides, the filtered count, the page, and
 *                     three whole-directory aggregates); `country_code` adds
 *                     the crosswalk's one. A seventh read on the plain call,
 *                     or a filter reaching an aggregate, fails. The measured
 *                     time is in D7179.md, taken outside the test (D5614: no
 *                     clock in a test).
 *   filtered facets   not drawn: coverage and facets are the whole directory's
 *                     under every filter, and the page says so.
 *   freshness         the directory reports no refresh date, so the summary
 *                     carries none; "Last refreshed" stays a dependency.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_directory_summary_7179.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { listCompanies, parseCompanyQuery } from '../src/services/researchCompanyDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (file: string) => readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8');
const creates = (file: string) => migration(file)
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
  .map((s) => `${s};`).join('\n');

const COUNTRIES = ['Germany', 'France', 'United States', 'Netherlands', 'Spain'];
const SECTORS = ['robotics', 'software industry', 'Energy storage', null];

function fixture(n = 120) {
  const db = new DatabaseSync(':memory:');
  db.exec(creates('228_research_company_directory.sql'));
  db.exec(migration('375_research_company_directory_columns.sql'));
  db.exec(migration('229_research_market_directory.sql'));
  db.exec(migration('376_research_taxonomy.sql'));
  const ins = db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, founded_year, sector, source_url, as_of,
       funding_total, funding_currency, revenue, revenue_currency, employee_count)
     VALUES (?, ?, ?, ?, ?, ?, 'https://www.wikidata.org/wiki/Q1', '2026-10-04', ?, ?, ?, ?, ?)`,
  );
  for (let k = 0; k < n; k += 1) {
    const funded = k % 3 === 0;
    ins.run(`c${k}`, `Company ${k}`, k % 7 ? `https://c${k}.example` : '', COUNTRIES[k % COUNTRIES.length],
      k % 11 ? 1990 + (k % 35) : null, SECTORS[k % SECTORS.length],
      funded ? 1_000_000 + k : null, funded ? (k % 2 ? 'USD' : 'EUR') : null,
      k % 5 === 0 ? 250_000 : null, k % 5 === 0 ? 'EUR' : null, k % 4 === 0 ? 10 + k : null);
  }
  return db;
}

/** The D1 binding, recording every statement a call prepares. */
function counting(db: InstanceType<typeof DatabaseSync>) {
  const inner = d1Over(db);
  const seen: string[] = [];
  return { seen, env: { DB: { ...inner, prepare: (sql: string) => { seen.push(sql.replace(/\s+/g, ' ').trim()); return inner.prepare(sql); } } } as any };
}

const query = (qs: string) => {
  const p = new URLSearchParams(qs);
  return parseCompanyQuery((k) => p.get(k) ?? undefined);
};

/** A whole-directory aggregate: reads the table, binds nothing, filters by nothing the request sent. */
const isWholeDirectory = (sql: string) => /FROM research_company_directory/.test(sql) && !sql.includes('?') && !/SELECT DISTINCT country/.test(sql);

test('summary cost: a list call is six reads, three of them whole-directory aggregates', async () => {
  const { seen, env } = counting(fixture());
  await listCompanies(env, query('q=company&founded_from=2000&founded_to=2020&has=funding&sort=-funding&limit=25&offset=25'));
  assert.equal(seen.length, 6, `one list call prepared:\n${seen.join('\n')}`);
  assert.equal(seen.filter(isWholeDirectory).length, 3, 'coverage, sector facets and country facets, each over the whole directory');
  assert.equal(seen.filter((s) => /research_taxonomy_overrides/.test(s)).length, 1, 'the overrides are read once');
  assert.equal(seen.filter((s) => /^SELECT COUNT\(\*\) AS n FROM research_company_directory WHERE/.test(s)).length, 1, 'one filtered count');
  assert.equal(seen.filter((s) => /LIMIT \? OFFSET \?$/.test(s)).length, 1, 'one page');
});

test('summary cost: country_code adds the crosswalk read and nothing else', async () => {
  const { seen, env } = counting(fixture());
  await listCompanies(env, query('country_code=DE'));
  assert.equal(seen.length, 7, `one list call prepared:\n${seen.join('\n')}`);
  assert.equal(seen.filter((s) => /SELECT DISTINCT country AS v/.test(s)).length, 1);
  assert.equal(seen.filter(isWholeDirectory).length, 3);
});

test('filtered facets are not drawn: coverage and facets are the whole directory under every filter', async () => {
  const db = fixture();
  const whole = await listCompanies({ DB: d1Over(db) } as any, query(''));
  assert.equal(whole.total, 120);
  for (const qs of ['country=Germany', 'sector_label=robotics', 'sector_label=none', 'has=funding,revenue', 'founded_from=2000&founded_to=2005', 'q=Company 1', 'country_code=FR']) {
    const r = await listCompanies({ DB: d1Over(db) } as any, query(qs));
    assert.ok(r.total < whole.total, `${qs} narrows the results`);
    assert.deepEqual(r.facets, whole.facets, `${qs}: the facet counts stay whole-directory`);
    assert.deepEqual(r.coverage, whole.coverage, `${qs}: coverage stays whole-directory`);
  }
});

test('freshness: the summary reports no refresh date, so none is shown', async () => {
  const r = await listCompanies({ DB: d1Over(fixture()) } as any, query(''));
  assert.deepEqual(Object.keys(r.coverage).sort(), ['fields', 'of']);
  const dated = /refresh|updated|as_of|fresh|last_read/i;
  assert.deepEqual(Object.keys(r).filter((k) => dated.test(k)), [], 'the list response names no refresh date');
  assert.deepEqual(Object.keys(r.facets).filter((k) => dated.test(k)), []);
});
