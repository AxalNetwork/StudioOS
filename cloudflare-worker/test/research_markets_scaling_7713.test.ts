/** D7713 compares all six responses to the read-every-company computation and records every SQLite read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import markets, { marketFacets, NO_COMPANY_REASON, NO_COUNTRY_REASON } from '../src/routes/research_markets.ts';
import sectors from '../src/routes/research_sectors.ts';
import { loadOverrides, mapCompanyCountry, mapCompanySector } from '../src/services/researchTaxonomy.ts';
import { EUR_SOURCE } from '../src/services/researchFundDirectory.ts';

const size = 5040;
const secret = 'directory-read-local-fixture-secret';
const now = new Date('2026-11-19T12:00:00Z');
const app = new Hono().route('/', markets).route('/', sectors);
const paths = ['/markets', '/markets/fintech', '/geographies?with_data=0&limit=100', '/geographies/GB', '/sectors', '/sectors/fintech-defi'];
const sqlFile = (name: string) => readFileSync(new URL(`../sql/migrations/${name}.sql`, import.meta.url), 'utf8');

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const file of ['228_research_company_directory', '229_research_market_directory', '365_research_eurotech_fund_directory',
    '136_signals', '037_market_intel_v2', '103_mi_pro_subscriptions', '277_user_recovery_state',
    '202611041822_account_licences', '202611090932_shared_licences']) {
    for (const sql of splitStatements(sqlFile(file))) if (/^CREATE (TABLE|(?:UNIQUE )?INDEX)/i.test(sql)) db.exec(sql);
  }
  for (const file of ['375_research_company_directory_columns', '376_research_taxonomy', '379_market_intel_index_basis',
    '406_research_fund_sources', '202611191833_7707_market_intel_row_dates_runs', '202611220337_7708_market_intel_index_window',
    '202611250114_7713_company_directory_sector_index']) db.exec(sqlFile(file));
  // D7744: each row's own size currency and record kind (migration 202611270508_7744), stamped for the listed lists.
  db.exec(readFileSync(new URL('../sql/migrations/202611270508_7744_research_fund_size_currency_and_kind.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, is_active INTEGER, jwt_min_iat INTEGER);
    INSERT INTO users VALUES (1, 'founder', NULL, 1, NULL);
    INSERT INTO research_taxonomy_overrides (kind, raw_value, target) VALUES
      ('company_sector','Merged','payments'), ('company_sector','Merged','fintech'), ('company_sector','','fintech'),
      ('company_sector','É','autotech'), ('company_sector','É','fintech'), ('company_sector','É','fintech'), ('company_sector','bank ',''),
      ('company_country','Custom','GB'), ('company_country','Ambiguous','GB'), ('company_country','Ambiguous','US'),
      ('fund_focus','Manual fund','payments'), ('fund_hq','Manual place','GB');
    INSERT INTO research_market_directory (slug,name,company_count,source_name,source_boundary,as_of) VALUES
      ('fintech','FinTech',7,'Axal','supplied','2026-01-01'), ('payments','Payments',1,'Axal','supplied','2026-01-01'),
      ('autotech','AutoTech',9,'Axal','supplied','2026-01-01'), ('fashion','Fashion',3,'Axal','supplied','2026-01-01');
    INSERT INTO signals (id,type,title,thesis,region,country,sector,niche,market_cap_band,tags,status,updated_at)
      VALUES ('s','signal','Sample','Thesis','Europe','Custom','Finance','Payments','mid','["fintech"]','active','2026-10-02');
    INSERT INTO signal_evidence (id,signal_id,kind,title,source_key,observed_at) VALUES ('e','s','item','Sample','sample','2026-10-01');`);
  db.prepare(`INSERT INTO research_fund_directory (uid,name,hq,sector_focus,source_name,source_url,as_of)
    VALUES ('f','Sample Fund','Manual place','Manual fund',?,'https://example.org','2026-09-01')`).run(EUR_SOURCE);
  return db;
}

function seedCompanies(db: DatabaseSync) {
  const insert = db.prepare(`INSERT INTO research_company_directory
    (uid,name,website,sector,country,founded_year,employee_count,employee_as_of,last_funding_amount,last_funding_type,
      last_funding_currency,last_funding_date,as_of,source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const labels = ['bank', 'bank ', 'Merged', 'É', 'É', 'automotive industry', '', null, 'unmapped'];
  const countries = ['Custom', 'US', 'United Kingdom', 'Ambiguous', null, '', 'Japan'];
  const names = ['Élan', 'elan', 'ELAN', 'Élan', 'Zebra', 'Áurea', 'Aurea', 'Beta'];
  db.exec('BEGIN');
  for (let i = 0; i < size; i++) {
    // The composed É label sorts before its decomposed twin by first member, opposite SQLite's binary order.
    const name = i === 3 ? 'Aardvark' : names[i % names.length];
    const headcount = i === 3 ? 100 : i % 4 === 0 ? null : i % 7;
    insert.run(`c${size - i}`, name, `https://example.org/${i}`, labels[i % labels.length],
      countries[Math.floor(i / labels.length) % countries.length], 2000 + i % 21,
      headcount, i % 4 === 0 ? null : '2025-12-01', i % 3 === 0 ? 0 : null,
      i % 5 === 0 ? 'seed' : null, 'EUR', '2025-11-01', i === size - 1 ? '2026-11-18' : '2026-09-01', 'https://example.org');
  }
  db.exec('COMMIT');
}

interface Read { sql: string; count: number; args: SQLInputValue[]; columns: string[] }
function spy(db: DatabaseSync, reads: Read[]) {
  const real = d1Over(db);
  return { prepare(sql: string) {
    const statement = real.prepare(sql);
    let args: SQLInputValue[] = [];
    return {
      bind(...values: SQLInputValue[]) { args = values; statement.bind(...args); return this; },
      async all() {
        const read: Read = { sql, args, count: -1, columns: [] };
        reads.push(read);
        const result = await statement.all();
        read.count = result.results.length;
        read.columns = Object.keys(result.results[0] ?? {});
        return result;
      },
      async first() {
        const read: Read = { sql, args, count: -1, columns: [] };
        reads.push(read);
        const result = await statement.first();
        read.count = result == null ? 0 : 1;
        read.columns = Object.keys(result ?? {});
        return result;
      },
    };
  } };
}

async function get(db: DatabaseSync, path: string, token: string, reads: Read[] = []) {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, {
    JWT_SECRET: secret, ENVIRONMENT: 'development', DB: spy(db, reads),
  });
  const body = await res.json() as any;
  assert.deepEqual(reads.filter((r) => r.count < 0).map((r) => r.sql), [], 'every attempted fixture read must succeed');
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(body)}`);
  return body;
}

type OldCompany = {
  uid: string; name: string; website: string; country: string | null; sector: string | null; founded_year: number;
  employee_count: number | null; employee_as_of: string | null; last_funding_amount: number | null;
  last_funding_type: string | null; last_funding_currency: string | null; last_funding_date: string | null; as_of: string; source_url: string;
};
function counts<T>(members: T[], label: (m: T) => string) {
  const map = new Map<string, number>();
  for (const member of members) { const k = label(member); map.set(k, (map.get(k) ?? 0) + 1); }
  return [...map].sort(([a, n], [b, m]) => m - n || a.localeCompare(b));
}

/**
 * Preserve the actual non-company data from the same fixture before inserting companies. Fill every
 * company-dependent field with the prior per-row crosswalk, filters, stable comparators and DTOs.
 */
async function oldResponses(db: DatabaseSync, empty: any[]) {
  const [list, market, geography, country, sectorList, sector] = empty;
  const all = db.prepare('SELECT * FROM research_company_directory').all() as unknown as OldCompany[];
  const ov = await loadOverrides({ DB: d1Over(db) } as any);
  const targets = (c: OldCompany) => mapCompanySector(c.sector, ov).targets;
  const code = (c: OldCompany) => mapCompanyCountry(c.country, ov).targets[0] ?? null;
  const byName = (a: OldCompany, b: OldCompany) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const dto = (c: OldCompany) => ({ uid: c.uid, name: c.name, website: c.website, founded_year: c.founded_year,
    country: c.country, country_code: code(c), sector: c.sector, market: targets(c)[0] ?? null });
  const countryNames = new Map(geography.items.map((k: any) => [k.code, k.name]));
  const marketNames = new Map(list.items.map((m: any) => [m.slug, m.name]));
  const tracked = new Map(list.items.map((m: any) => [m.slug, m.mi_sector]));
  const inTracked = (c: OldCompany, name: string) => targets(c).some((slug) => tracked.get(slug) === name);

  list.companies_unmapped = all.filter((c) => !targets(c)[0]).length;
  const distinct = new Set<string>();
  const coverage = { recorded: 0, no_company: 0, no_placeable_country: 0, distinct: 0 };
  for (const m of list.items) {
    const members = all.filter((c) => targets(c)[0] === m.slug);
    m.company_count = members.length;
    const value = counts(members.filter((c) => code(c)), (c) => code(c)!).map(([code, count]) => ({ code, count }));
    for (const k of value) distinct.add(k.code);
    if (value.length) coverage.recorded++;
    else if (members.length) coverage.no_placeable_country++;
    else coverage.no_company++;
    m.countries = value.length ? { status: 'recorded', value } :
      { status: 'not_recorded', value: null, reason: members.length ? NO_COUNTRY_REASON : NO_COMPANY_REASON };
  }
  list.summary.countries = { ...coverage, distinct: distinct.size };
  list.facets = marketFacets(list.items, { q: '', country: [], fresh: '', src: '', sector: [] }, +now);

  const fin = all.filter((c) => targets(c).includes('fintech')).sort(byName);
  market.company_count = fin.length;
  market.companies = fin.slice(0, 50).map(dto);
  market.companies_by_country = counts(fin, (c) => code(c) ?? '').map(([k, count]) => ({
    code: k || null, name: countryNames.get(k) ?? null, count }));
  market.sub_markets.company_sectors = counts(fin, (c) => String(c.sector)).map(([label, count]) => ({ label, count }));

  geography.companies_unmapped = all.filter((c) => !code(c)).length;
  for (const k of geography.items) k.company_count = all.filter((c) => code(c) === k.code).length;
  country.totals.companies = all.length;
  country.as_of.companies = all.map((c) => c.as_of).filter(Boolean).sort().at(-1) ?? null;
  const here = all.filter((c) => code(c) === 'GB').sort((a, b) => (b.employee_count ?? -1) - (a.employee_count ?? -1) || byName(a, b));
  country.company_count = here.length;
  country.companies = here.slice(0, 50).map((c) => ({ ...dto(c), employee_count: c.employee_count, employee_as_of: c.employee_as_of,
    last_round: c.last_funding_amount != null || c.last_funding_type ? {
      amount: c.last_funding_amount, currency: c.last_funding_currency, date: c.last_funding_date, type: c.last_funding_type,
    } : null }));
  country.companies_by_market = counts(here, (c) => targets(c)[0] ?? '').map(([slug, count]) => ({
    slug: slug || null, name: marketNames.get(slug) ?? null, count }));
  const label = (c: OldCompany) => String(c.sector ?? '').trim();
  country.companies_by_label = counts(here.filter(label), label).map(([label, count]) => ({ label, count }));
  country.companies_without_label = here.filter((c) => !label(c)).length;

  for (const s of sectorList.items) s.company_count = all.filter((c) => inTracked(c, s.name)).length;
  const members = all.filter((c) => inTracked(c, sector.name));
  sector.company_count = members.length;
  sector.companies = [...members].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50)
    .map(({ uid, name, country, sector, founded_year, employee_count, as_of, source_url }) => ({
      uid, name, country, sector, founded_year, employee_count, as_of, source_url,
      country_code: mapCompanyCountry(country, ov).targets[0] ?? null }));
  sector.companies_by_country = counts(members, (c) => code(c) ?? '').map(([k, count]) => ({
    code: k || null, name: countryNames.get(k) ?? null, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  for (const m of sector.sub_markets) m.company_count = members.filter((c) => targets(c).includes(m.slug)).length;
  sector.sub_markets.sort((a: any, b: any) => b.company_count - a.company_count || a.name.localeCompare(b.name));
  return empty;
}

test('six complete answers match the old computation, and only matching keys and 50 records cross the detail boundary', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const db = database();
  t.after(() => db.close());
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const empty = await Promise.all(paths.map((p) => get(db, p, token)));
  seedCompanies(db);
  const expected = await oldResponses(db, empty);
  const distinctPairs = db.prepare('SELECT COUNT(*) AS n FROM (SELECT sector, country FROM research_company_directory GROUP BY sector, country)').get()!.n;
  for (const [i, path] of [...paths, '/markets?limit=1'].entries()) {
    const reads: Read[] = [];
    const actual = await get(db, path, token, reads);
    const reference = i === paths.length ? { ...expected[0], limit: 1, items: expected[0].items.slice(0, 1) } : expected[i];
    assert.deepEqual(actual, reference, path);
    const company = reads.filter((r) => /\bresearch_company_directory\b/i.test(r.sql));
    const page = Array.isArray(reference.companies);
    assert.deepEqual(company.map((r) => r.count), page ? [distinctPairs, reference.company_count, 50] : [distinctPairs], path);
    assert.ok(reads.every((r) => r.count < size), path);
    assert.match(company[0].sql, /GROUP BY sector, country/);
    if (page) {
      const columns = path === '/geographies/GB' ? ['uid', 'name', 'employee_count', 'group_index'] : ['uid', 'name', 'group_index'];
      assert.deepEqual(company[1].columns, columns, 'only ordering keys may cross for every member');
      assert.equal(company[1].args.length, 1, 'one bound array of matching raw values');
      assert.deepEqual(JSON.parse(String(company[2].args[0])), reference.companies.map((c: OldCompany) => c.uid));
    }
    for (const read of company) {
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + read.sql).all(...read.args).map((r) => String(r.detail)).join('\n');
      if (read === company[0]) assert.match(plan, /USING (?:COVERING )?INDEX idx_research_company_directory_sector_country/);
      else if (read === company[1]) assert.match(plan, /SEARCH d USING INDEX idx_research_company_directory_sector_country/);
      else assert.match(plan, /SEARCH d USING INDEX sqlite_autoindex_research_company_directory_1/);
    }
    t.diagnostic(`${path} — ${reads.length} statements, ${reads.reduce((n, r) => n + r.count, 0)} rows; directory ${company.map((r) => r.count).join(' + ')}`);
  }
});
