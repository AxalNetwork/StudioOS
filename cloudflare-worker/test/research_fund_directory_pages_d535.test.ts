/**
 * D535 (#1081), steps 4–5 — what the Funds pages read from the directory API,
 * on real SQLite: `coverage`, `sources`, `facets` (each facet's counts apply
 * every other active filter, not its own), `none` for hq_country, focus and
 * vintage, the euro size bands, and report sizes only in a known currency.
 *
 * Tables: migration 365's and 229's CREATE statements, all of 376.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_directory_pages_d535.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { EUR_SOURCE, SIZE_BANDS } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 11;
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';

function ddl(file: string): string {
  return readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8')
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
    .map((s) => `${s};`).join('\n');
}

type Fund = { uid: string; name: string; hq?: string | null; size_eur_m?: number | null; year?: number | null;
  focus?: string | null; lps?: string | null; eif?: number; eifo?: number; source?: string; website?: string | null };

const FUNDS: Fund[] = [
  { uid: 'alpha', name: 'Alpha Ventures', hq: 'Berlin', size_eur_m: 50, year: 2021, focus: 'Fintech · AI', lps: 'EIF', eif: 1, website: 'https://alpha.example' },
  { uid: 'beta', name: 'Beta Capital', hq: 'Germany', size_eur_m: 300, year: 2024, focus: 'Robotics', lps: 'Family offices' },
  { uid: 'gamma', name: 'Gamma Partners', hq: 'London', size_eur_m: 120, year: 2019, focus: 'Fintech', eifo: 1, lps: 'EIFO' },
  { uid: 'delta', name: 'Delta Growth', hq: 'Bay Area, Israel', size_eur_m: 10, year: 2025, focus: 'Healthtech' },
  { uid: 'eps', name: 'Eps Fund', hq: 'Paris', size_eur_m: null, year: null, focus: null },
  // A list with no size in a known currency, even when the column holds a number.
  { uid: 'zeta', name: 'Zeta Deep Tech', hq: 'Berlin', size_eur_m: 999, year: 2023, focus: 'Deep Tech', source: DEEP },
  // Blank HQ and focus: "none". Exactly €25M: the lower edge of 25–50, never also in "under 25".
  { uid: 'eta', name: 'Eta Seed', hq: '  ', size_eur_m: 25, year: 2024, focus: '', lps: 'Family offices' },
  // An HQ and a focus the crosswalk places nowhere: recorded, so not "none".
  { uid: 'theta', name: 'Theta Fund', hq: 'Atlantis', size_eur_m: 600, year: 2024, focus: 'Generalist' },
];

function fixture(funds: Fund[] = FUNDS) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  // D597: each list's terms review; the route serves fund rows only through it.
  db.exec(readFileSync(resolve(here, '../sql/migrations/406_research_fund_sources.sql'), 'utf8'));
  db.exec(readFileSync(resolve(here, '../sql/migrations/376_research_taxonomy.sql'), 'utf8'));
  db.exec(ddl('229_research_market_directory.sql'));
  db.prepare(`INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of)
              VALUES ('fintech', 'Fintech', 1, 'test', 'test', '2026-09-30')`).run();
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@axal.example')`).run(USER);
  const ins = db.prepare(
    `INSERT INTO research_fund_directory (uid, name, website, hq, fund_size_cents, fund_year, sector_focus, notable_lps,
       eif_flag, eifo_flag, source_name, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const f of funds) {
    const deep = f.source === DEEP;
    ins.run(f.uid, f.name, f.website ?? null, f.hq ?? null, f.size_eur_m == null ? null : f.size_eur_m * 1_000_000 * 100,
      f.year ?? null, f.focus ?? null, f.lps ?? null, f.eif ?? 0, f.eifo ?? 0, f.source ?? EUR_SOURCE,
      deep ? 'https://example.org/deep' : 'https://example.org/eurotech', deep ? '2026-09-01' : '2026-10-04');
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, msg === 'Unauthorized' ? 401 : 500);
});

async function get(db: InstanceType<typeof DatabaseSync>, path: string) {
  const token = await new SignJWT({ user_id: USER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}
const uids = (b: any) => b.items.map((i: any) => i.uid);
const facet = (list: any[], value: string) => list.find((x: any) => x.value === value)?.count;

test('coverage counts each field over the whole directory, whatever the filters', async () => {
  const db = fixture();
  for (const path of ['/fund-directory', '/fund-directory?hq_country=DE&eif=1']) {
    const { status, body } = await get(db, path);
    assert.equal(status, 200);
    assert.equal(body.coverage.total, 8, `${path}: coverage is of the whole directory`);
    assert.equal(body.coverage.as_of, '2026-10-04');
    assert.deepEqual(body.coverage.fields, {
      size_eur: 6, size_unknown_currency: 1, hq: 7, website: 1, linkedin: 0,
      sector_focus: 6, fund_year: 7, notable_lps: 4, fund_number: 0,
    });
  }
});

test('sources: each list, its rows, and whether its sizes are in a known currency', async () => {
  const { body } = await get(fixture(), '/fund-directory');
  // D597 adds each list's review to these (research_fund_terms_d597.test.ts pins it).
  const steps45 = ({ name, url, rows, as_of, size_currency }: Record<string, unknown>) => ({ name, url, rows, as_of, size_currency });
  assert.deepEqual(body.sources.map(steps45), [
    { name: EUR_SOURCE, url: 'https://example.org/eurotech', rows: 7, as_of: '2026-10-04', size_currency: 'EUR' },
    { name: DEEP, url: 'https://example.org/deep', rows: 1, as_of: '2026-09-01', size_currency: null },
  ]);
  assert.match(body.source, /EuroTech/, 'the step 2–3 `source` string stays');
});

test('"none" is an empty field: hq_country, focus and vintage', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=none')).body), ['eta'], 'blank HQ is none; "Atlantis" is recorded');
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=NONE')).body), ['eta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?focus=none')).body), ['eps', 'eta'], 'NULL and blank focus; "Generalist" is recorded');
  assert.deepEqual(uids((await get(db, '/fund-directory?vintage=none')).body), ['eps']);
  assert.deepEqual(uids((await get(db, '/fund-directory?vintage=2024')).body), ['beta', 'eta', 'theta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?vintage=none&hq_country=none')).body), [], 'none filters combine');
  const both = await get(db, '/fund-directory?vintage=2024&vintage_from=2020');
  assert.deepEqual([both.status, both.body.field], [400, 'vintage']);
  assert.equal((await get(db, '/fund-directory?vintage=soon')).status, 400);
});

test('facets: options with counts; "none" listed; labels from the countries and markets tables', async () => {
  const { body } = await get(fixture(), '/fund-directory');
  const f = body.facets;
  assert.equal(facet(f.hq_country, 'DE'), 3, 'Berlin, Germany and the Deep Tech row in Berlin');
  assert.equal(f.hq_country.find((x: any) => x.value === 'DE').label, 'Germany');
  assert.deepEqual([facet(f.hq_country, 'US'), facet(f.hq_country, 'IL')], [1, 1], 'two countries in one HQ count under both');
  assert.deepEqual(f.hq_country.at(-1), { value: 'none', label: 'HQ not recorded', count: 1 });
  assert.ok(body.facets_unmapped.hq_country >= 1, '"Atlantis" is recorded and placed nowhere');
  assert.equal(facet(f.focus, 'fintech'), 2);
  assert.equal(f.focus.find((x: any) => x.value === 'fintech').label, 'Fintech');
  assert.equal(facet(f.focus, 'ai'), 1);
  assert.deepEqual(f.focus.at(-1), { value: 'none', label: 'Focus not recorded', count: 2 });
  assert.equal(body.facets_unmapped.focus, 1, '"Generalist" is not a market');
  assert.deepEqual(f.vintage.map((x: any) => [x.value, x.count]),
    [['2025', 1], ['2024', 3], ['2023', 1], ['2021', 1], ['2019', 1], ['none', 1]]);
  assert.deepEqual(f.eif, { backed: 1, not_backed: 3, unknown: 4 }, 'a 0 flag with no LP text is unknown');
  assert.deepEqual(f.eifo, { backed: 1, not_backed: 3, unknown: 4 });
  assert.match(body.facets_basis, /every other active filter/);
});

test('a facet applies every other filter but not its own', async () => {
  const { body } = await get(fixture(), '/fund-directory?hq_country=DE');
  assert.equal(body.total, 3);
  assert.equal(facet(body.facets.hq_country, 'US'), 1, 'the HQ options stay listed under an HQ filter');
  assert.equal(facet(body.facets.hq_country, 'none'), 1);
  assert.equal(facet(body.facets.focus, 'fintech'), 1, 'focus counts narrow to the German funds');
  assert.equal(facet(body.facets.focus, 'none'), 0);
  assert.deepEqual(body.facets.vintage.map((x: any) => [x.value, x.count]), [['2024', 1], ['2023', 1], ['2021', 1], ['none', 0]]);
  assert.deepEqual(body.facets.eif, { backed: 1, not_backed: 1, unknown: 1 });
  const eif = await get(fixture(), '/fund-directory?eif=1');
  assert.deepEqual(eif.body.facets.eif, { backed: 1, not_backed: 3, unknown: 4 }, 'the EIF counts ignore the EIF filter');
  assert.equal(eif.body.facets.eifo.backed, 0, 'and the EIFO counts honour it');
});

test('size bands: euro rows only, half-open, never mixed with a list whose currency is unknown', async () => {
  const db = fixture();
  const all = (await get(db, '/fund-directory')).body;
  assert.deepEqual(all.facets.size_band.map((x: any) => [x.value, x.count]),
    [['lt25', 1], ['25-50', 1], ['50-100', 1], ['100-250', 1], ['250-500', 1], ['500+', 1]]);
  assert.equal(all.facets.size_not_comparable, 2, 'no size, or a size in an unrecorded currency');
  assert.deepEqual(SIZE_BANDS.map((b) => b.value), all.facets.size_band.map((x: any) => x.value));
  assert.deepEqual(uids((await get(db, '/fund-directory?size_band=lt25')).body), ['delta'], '€25M is not under €25M');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_band=25-50')).body), ['eta'], '€25M is in 25–50; €50M is not');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_band=500%2B')).body), ['theta'], 'the 999 in an unknown currency is in no band');
  assert.equal((await get(db, '/fund-directory?size_band=huge')).status, 400);
  const mix = await get(db, '/fund-directory?size_band=lt25&size_min=1');
  assert.deepEqual([mix.status, mix.body.field], [400, 'size_band']);
  const de = (await get(db, '/fund-directory?hq_country=DE')).body.facets;
  assert.deepEqual([facet(de.size_band, '50-100'), facet(de.size_band, '250-500'), de.size_not_comparable], [1, 1, 1]);
});

test('paging under a sort: total counts every match, the page is the slice', async () => {
  const { body } = await get(fixture(), '/fund-directory?sort=-size&limit=2&offset=1');
  assert.deepEqual([body.total, body.limit, body.offset, body.sort], [8, 2, 1, '-size']);
  assert.deepEqual(uids(body), ['beta', 'gamma'], 'theta, then beta and gamma; the unknown-currency 999 is not the largest');
  const last = (await get(fixture(), '/fund-directory?sort=-size&offset=6')).body;
  assert.deepEqual(uids(last).sort(), ['eps', 'zeta'], 'rows with no euro size come last');
});

test('a fund page shows report sizes only in a known currency', async () => {
  const db = fixture();
  const rep = db.prepare(`INSERT INTO research_fund_directory_reports (fund_uid, period, report_date, fund_size_cents, source_url)
                          VALUES (?, '2025-Q4', '2025-12-31', 5000000000, 'https://example.org/sheet')`);
  rep.run('alpha');
  rep.run('zeta');
  const eur = (await get(db, '/fund-directory/alpha')).body;
  assert.deepEqual([eur.reports[0].fund_size_cents, eur.reports[0].size_currency], [5000000000, 'EUR']);
  const deep = (await get(db, '/fund-directory/zeta')).body;
  assert.deepEqual([deep.reports[0].fund_size_cents, deep.reports[0].size_currency], [null, null]);
  assert.equal(deep.reports[0].period, '2025-Q4', 'the period is still listed');
});
