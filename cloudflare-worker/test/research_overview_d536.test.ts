/**
 * D536 (#1082) — `GET /api/research/overview`, on real SQLite.
 *
 * The tables come from the migrations that create them (their CREATE
 * statements only; 365's 1,076 seed rows are left out so counts are the
 * test's own). Pins: the sign-in gate; each section's query; each section's
 * failure reported on its own; no stub-derived index read; an empty store as
 * "not recorded" with the reason, never a zero; and no `advisor_note`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_overview_d536.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import researchOverview, {
  demandOverSupply, SIZE_BANDS, INDEX_PENDING_REASON, GOVERNMENT_REASON, crosswalkCounts, buildOpportunity,
} from '../src/routes/research_overview.ts';
import { EUR_SOURCE } from '../src/services/researchFundDirectory.ts';
import { mapFundHq } from '../src/services/researchTaxonomy.ts';
import '../src/services/market_intel/sources/index.ts';
import { SECTORS } from '../src/services/market_intel/aggregator.ts';
import { LIVE_INDEX_BASIS, NO_LIVE_SOURCE_REASON, STUB_CITATION_PREFIX } from '../src/services/market_intel/liveRows.ts';
import { periodKey, WINDOW_DAYS } from '../src/services/market_intel/scoring.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 7;

/** The CREATE statements of a migration, without its seed rows. */
function ddl(file: string): string {
  return readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8')
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s))
    .map((s) => `${s};`)
    .join('\n');
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  for (const f of ['228_research_company_directory.sql', '229_research_market_directory.sql',
    '365_research_eurotech_fund_directory.sql', '136_signals.sql', '030_market_intel.sql']) db.exec(ddl(f));
  db.exec(readFileSync(resolve(here, '../sql/migrations/379_market_intel_index_basis.sql'), 'utf8'));
  // The crosswalk (D533): its tables and its country and market-sector rows, no directory rows.
  db.exec(readFileSync(resolve(here, '../sql/migrations/376_research_taxonomy.sql'), 'utf8'));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fay', 'fay@axal.example')`).run(USER);
  return db;
}

function company(db: InstanceType<typeof DatabaseSync>, uid: string, country: string | null, sector: string | null) {
  db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, 'https://www.wikidata.org/wiki/Q1', '2026-09-30')`,
  ).run(uid, uid, `https://${uid}.example`, country, sector);
}

function fund(db: InstanceType<typeof DatabaseSync>, uid: string, hq: string | null, sizeCents: number | null, year: number | null, focus: string | null, source = EUR_SOURCE) {
  db.prepare(
    `INSERT INTO research_fund_directory (uid, name, hq, fund_size_cents, fund_year, sector_focus, source_name, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'https://example.org/sheet', '2026-09-28')`,
  ).run(uid, uid, hq, sizeCents, year, focus, source);
}

function signal(db: InstanceType<typeof DatabaseSync>, id: string, status: string, updated: string) {
  db.prepare(
    `INSERT INTO signals (id, type, title, thesis, region, country, sector, niche, market_cap_band, advisor_note, status, updated_at)
     VALUES (?, 'thesis', ?, 'a thesis', 'Europe', 'DE', 'Fintech', 'payments', 'small', 'ADVISOR-NOTE-SENTINEL', ?, ?)`,
  ).run(id, `Signal ${id}`, status, updated);
}

function index(db: InstanceType<typeof DatabaseSync>, sector: string, dimension: string, value: number, delta: number | null, basis: string | null = LIVE_INDEX_BASIS) {
  db.prepare(
    `INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, delta_pct, source_count, basis)
     VALUES (?, 'global', ?, ?, ?, ?, 2, ?)`,
  ).run(sector, periodKey(), dimension, value, delta, basis);
}

function seeded() {
  const db = fixture();
  company(db, 'a', 'Germany', 'Fintech');
  company(db, 'b', 'Germany', 'fintech ');
  company(db, 'c', 'France', 'Robotics');
  company(db, 'd', '', null);
  db.prepare(`INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of) VALUES ('fintech', 'Fintech', 2, 'Axal', 'discovery', '2026-09-29')`).run();
  fund(db, 'f1', 'Germany', 10_000_000_00, 2025, 'Fintech');
  fund(db, 'f2', 'Germany', 150_000_000_00, 2024, 'fintech');
  fund(db, 'f3', 'France', 2_000_000_000_00, 2010, 'Deep tech');
  signal(db, 's-old', 'active', '2026-09-01 10:00:00');
  signal(db, 's-new', 'active', '2026-10-02 10:00:00');
  signal(db, 's-gone', 'archived', '2026-10-03 10:00:00');
  return db;
}

const app = new Hono<any>();
app.route('/api/research/overview', researchOverview);
// The production app answers requireAuth's 'Unauthorized' with 401; so does this one.
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, msg === 'Unauthorized' ? 401 : 500);
});

async function get(db: InstanceType<typeof DatabaseSync>, opts: { auth?: boolean; query?: string; DB?: any } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = await new SignJWT({ user_id: USER, role: 'founder' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/research/overview${opts.query ?? ''}`, { headers },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: opts.DB ?? d1Over(db) });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as any, text };
}

test('the overview is signed-in only', async () => {
  const r = await get(seeded(), { auth: false });
  assert.equal(r.status, 401);
});

test('totals: each count with its source and as-of date', async () => {
  const { status, body } = await get(seeded());
  assert.equal(status, 200);
  const t = body.totals;
  assert.equal(t.status, 'ok');
  assert.deepEqual([t.companies.value, t.companies.as_of], [4, '2026-09-30']);
  assert.deepEqual([t.markets.value, t.markets.as_of], [1, '2026-09-29']);
  assert.deepEqual([t.funds.value, t.funds.as_of], [3, '2026-09-28']);
  assert.equal(t.countries.value, 2, 'a blank country is not a country');
  assert.equal(t.sectors.value, 2, '"Fintech" and "fintech " are one label');
  assert.match(t.companies.source, /Wikidata/);
  assert.equal(t.market_split.value, null);
  assert.match(t.market_split.reason, /No source records ownership/);
});

test('an empty store is "not recorded" with the reason, never a zero', async () => {
  const { body } = await get(fixture());
  for (const k of ['companies', 'markets', 'funds', 'countries', 'sectors']) {
    assert.equal(body.totals[k].value, null, `${k} printed a zero`);
    assert.ok(body.totals[k].reason, `${k} gave no reason`);
  }
  for (const k of ['heat', 'demand_vs_supply', 'competition', 'money', 'signals']) {
    assert.equal(body[k].status, 'not_recorded', `${k}`);
    assert.ok(body[k].reason);
  }
  assert.equal(body.heat.reason, NO_LIVE_SOURCE_REASON);
});

test('competition: companies per sector label and per country, largest first', async () => {
  const { body } = await get(seeded());
  const c = body.competition;
  assert.equal(c.status, 'ok');
  assert.deepEqual(c.by_sector.map((x: any) => [x.label.toLowerCase(), x.companies]), [['fintech', 2], ['robotics', 1]]);
  assert.deepEqual(c.by_country.map((x: any) => [x.country, x.companies]), [['Germany', 2], ['France', 1]]);
  assert.equal(c.as_of, '2026-09-30');
});

test('money: funds per HQ and focus, size bands with no empty band, and recent vintages only', async () => {
  const { body } = await get(seeded());
  const m = body.money;
  assert.equal(m.status, 'ok');
  assert.deepEqual(m.by_hq.map((x: any) => [x.hq, x.funds]), [['Germany', 2], ['France', 1]]);
  assert.deepEqual(m.by_focus.map((x: any) => [x.slug, x.funds]), [['fintech', 2], ['deeptech', 1]]);
  assert.deepEqual(m.size_bands, [
    { band: SIZE_BANDS[0].band, funds: 1 }, { band: SIZE_BANDS[2].band, funds: 1 }, { band: SIZE_BANDS[4].band, funds: 1 },
  ]);
  assert.ok(m.size_bands.every((b: any) => b.funds > 0), 'a band with no fund is a zero');
  assert.deepEqual(m.recent_vintages.map((x: any) => x.year), [2025, 2024], '2010 is not recent');
  assert.match(m.size_note, /euros/);
  assert.equal(m.size_currency, 'EUR');
});

test('the top parameter is clamped and bound', async () => {
  const one = await get(seeded(), { query: '?top=1' });
  assert.equal(one.body.top, 1);
  assert.equal(one.body.competition.by_country.length, 1);
  assert.equal((await get(seeded(), { query: '?top=999' })).body.top, 25);
  assert.equal((await get(seeded(), { query: "?top=1;DROP TABLE signals" })).body.top, 1);
  assert.equal((await get(seeded(), { query: '?top=abc' })).body.top, 10);
});

test('signals: the latest active ones, and never the advisor note', async () => {
  const { body, text } = await get(seeded());
  assert.equal(body.signals.status, 'ok');
  assert.deepEqual(body.signals.items.map((s: any) => s.id), ['s-new', 's-old'], 'an archived signal is not active');
  assert.ok(!text.includes('ADVISOR-NOTE-SENTINEL'), 'advisor_note reached the response');
  assert.ok(!text.includes('advisor_note'));
  assert.match(body.signals.source, /hand-written/);
});

test('heat: live index rows only; a stub-derived row is never read', async () => {
  const db = seeded();
  index(db, SECTORS[0], 'demand', 70, 12, null); // stub-derived: no basis
  let { body } = await get(db);
  assert.equal(body.heat.status, 'not_recorded', 'a stub-derived index was read');
  index(db, SECTORS[1], 'demand', 64, 8);
  ({ body } = await get(db));
  assert.equal(body.heat.status, 'ok');
  assert.equal(body.heat.period_status, 'month_to_date');
  assert.equal(body.heat.sectors.length, SECTORS.length);
  const s0 = body.heat.sectors.find((s: any) => s.sector === SECTORS[0]);
  const s1 = body.heat.sectors.find((s: any) => s.sector === SECTORS[1]);
  assert.deepEqual(s0.dimensions.demand, { value: null, delta_pct: null, source_count: 0, reason: NO_LIVE_SOURCE_REASON });
  assert.deepEqual(s1.dimensions.demand, { value: 64, delta_pct: 8, source_count: 2 });
  assert.equal(s1.dimensions.supply.value, null);
});

/** A live observation (cited by its provider, not the stub page) `ageDays` old. */
function liveRow(db: InstanceType<typeof DatabaseSync>, sector: string, ageDays: number, citation = 'https://openalex.org/W1') {
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES ('openalex', ?, 'global', 'research', 0.6, 'count', ?, ?)`,
  ).run(sector, new Date(Date.now() - ageDays * 86_400_000).toISOString(), citation);
}

const indexRows = (db: InstanceType<typeof DatabaseSync>) =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM market_intel_indexes WHERE period_key = ? AND basis = ?`).get(periodKey(), LIVE_INDEX_BASIS) as any).n);

test('heat: live observations with this month\'s index not yet computed are computed on the read, like the sector compass', async () => {
  const db = seeded();
  liveRow(db, SECTORS[0], 1);
  assert.equal(indexRows(db), 0, 'the month starts with no index row');
  const { body } = await get(db);
  assert.equal(body.heat.status, 'ok', JSON.stringify(body.heat));
  const s0 = body.heat.sectors.find((s: any) => s.sector === SECTORS[0]);
  assert.equal(typeof s0.dimensions.research.value, 'number');
  assert.ok(indexRows(db) > 0, 'the computed index was stored');
  assert.notEqual(body.demand_vs_supply.reason, NO_LIVE_SOURCE_REASON);
});

test('heat: when the index cannot be computed on the read, both sections say it is pending, not that no source reported', async () => {
  const db = seeded();
  liveRow(db, SECTORS[0], 1);
  const DB = { ...d1Over(db), batch: async () => { throw new Error('D1_ERROR: batch failed'); } };
  const { status, body } = await get(db, { DB });
  assert.equal(status, 200);
  for (const k of ['heat', 'demand_vs_supply']) {
    assert.deepEqual(body[k], { status: 'not_recorded', reason: INDEX_PENDING_REASON }, k);
  }
});

test('heat: a compute on the read that still writes no index row reads as pending too', async () => {
  const db = seeded();
  // A live observation from a source the registry no longer knows: scored, it contributes nothing.
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES ('retired_source', ?, 'global', 'research', 0.6, 'count', ?, 'https://example.org/obs/1')`,
  ).run(SECTORS[0], new Date(Date.now() - 86_400_000).toISOString());
  const { body } = await get(db);
  assert.equal(indexRows(db), 0);
  assert.deepEqual(body.heat, { status: 'not_recorded', reason: INDEX_PENDING_REASON });
});

test('heat: only stub rows, or live rows older than the window, still read "no live source" and compute nothing', async () => {
  const db = seeded();
  liveRow(db, SECTORS[0], 1, `${STUB_CITATION_PREFIX}openalex`);
  liveRow(db, SECTORS[1], WINDOW_DAYS + 2);
  const DB = { ...d1Over(db), batch: async () => { throw new Error('no compute expected'); } };
  const { body } = await get(db, { DB });
  for (const k of ['heat', 'demand_vs_supply']) {
    assert.deepEqual(body[k], { status: 'not_recorded', reason: NO_LIVE_SOURCE_REASON }, k);
  }
});

test('demand against supply: only sectors whose live demand rises faster than supply', async () => {
  const db = seeded();
  const [a, b, c] = SECTORS;
  index(db, a, 'demand', 70, 15); index(db, a, 'supply', 50, 5);   // listed, gap 10
  index(db, b, 'demand', 60, 2);  index(db, b, 'supply', 55, 6);   // supply faster: left out
  index(db, c, 'demand', 65, 9);  index(db, c, 'supply', 40, null); // no supply change: left out
  const { body } = await get(db);
  assert.equal(body.demand_vs_supply.status, 'ok');
  assert.deepEqual(body.demand_vs_supply.sectors, [
    { sector: a, demand: 70, supply: 50, demand_delta_pct: 15, supply_delta_pct: 5, gap_pct: 10 },
  ]);
});

test('demandOverSupply orders by the gap and never ranks a missing pair', () => {
  const rows = [
    { sector: SECTORS[0], dimension: 'demand', value: 1, delta_pct: 4, source_count: 1 },
    { sector: SECTORS[0], dimension: 'supply', value: 1, delta_pct: 1, source_count: 1 },
    { sector: SECTORS[1], dimension: 'demand', value: 1, delta_pct: 9, source_count: 1 },
    { sector: SECTORS[1], dimension: 'supply', value: 1, delta_pct: 1, source_count: 1 },
    { sector: SECTORS[2], dimension: 'demand', value: 1, delta_pct: 9, source_count: 1 },
  ];
  assert.deepEqual(demandOverSupply(rows).map((r) => r.sector), [SECTORS[1], SECTORS[0]]);
});

test('each section reports its own failure; the others still answer', async () => {
  for (const [table, broken] of [
    ['research_fund_directory', ['money']],
    ['signals', ['signals']],
    ['market_intel_indexes', ['heat', 'demand_vs_supply']],
  ] as const) {
    const db = seeded();
    index(db, SECTORS[0], 'demand', 70, 15); index(db, SECTORS[0], 'supply', 50, 5);
    db.exec(`DROP TABLE ${table}`);
    const { status, body } = await get(db);
    assert.equal(status, 200, `dropping ${table} failed the whole read`);
    for (const k of ['totals', 'heat', 'demand_vs_supply', 'competition', 'money', 'signals']) {
      if ((broken as readonly string[]).includes(k)) {
        assert.deepEqual(body[k], { status: 'unreadable', reason: 'Unreadable' }, `${k} with ${table} gone`);
      } else {
        assert.equal(body[k].status, 'ok', `${k} broke when ${table} was gone`);
      }
    }
  }
});

test('totals: a store that cannot be read is "Unreadable" on its own line; the other totals still count', async () => {
  const db = seeded();
  db.exec('DROP TABLE research_market_directory');
  const { body } = await get(db);
  assert.equal(body.totals.status, 'ok');
  assert.deepEqual(body.totals.markets, { value: null, as_of: null, source: body.totals.markets.source, reason: 'Unreadable' });
  assert.equal(body.totals.companies.value, 4);
  assert.equal(body.totals.funds.value, 3);
});

// ---------------------------------------------------------------------------
// Follow-up (S1 on #1082): the overview additions the panel reads.
// ---------------------------------------------------------------------------

function indexAt(db: InstanceType<typeof DatabaseSync>, sector: string, period: string, computedAt: string, basis: string | null = LIVE_INDEX_BASIS) {
  db.prepare(
    `INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, delta_pct, source_count, basis, computed_at)
     VALUES (?, 'global', ?, 'demand', 50, NULL, 1, ?, ?)`,
  ).run(sector, period, basis, computedAt);
}

function listed(db: InstanceType<typeof DatabaseSync>, symbol: string, updated: string) {
  db.prepare(`INSERT INTO signal_companies (symbol, name, exchange, updated_at) VALUES (?, ?, 'NYSE', ?)`).run(symbol, symbol, updated);
}

test('totals: the supplied-company sum, the fund lists, and the twelve indexed sectors with each last computed_at', async () => {
  const db = seeded();
  db.prepare(`INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of) VALUES ('robotics', 'Robotics', 5, 'Axal', 'discovery', '2026-09-30')`).run();
  fund(db, 'g1', 'USA', 5_000_000_00, 2021, 'AI', 'Deep Tech Investors Mapping (public spreadsheet)');
  indexAt(db, SECTORS[0], '2026-08', '2026-08-31 04:00:00');
  indexAt(db, SECTORS[0], '2026-09', '2026-09-30 04:00:00');
  indexAt(db, SECTORS[1], '2026-09', '2026-09-29 04:00:00', null); // stub-derived: never a date
  const t = (await get(db)).body.totals;
  assert.equal(t.supplied_companies.value, 7, 'SUM(company_count): 2 + 5');
  assert.equal(t.supplied_companies.as_of, '2026-09-30');
  assert.match(t.supplied_companies.source, /not verified/);
  assert.equal(t.markets.value, 2, 'the market count is still rows, not the sum');
  assert.equal(t.fund_sources.value, 2);
  assert.deepEqual(t.fund_sources.names, [
    { name: EUR_SOURCE, funds: 3 }, { name: 'Deep Tech Investors Mapping (public spreadsheet)', funds: 1 },
  ]);
  const tracked = t.sectors_tracked;
  assert.equal(tracked.value, 12);
  assert.deepEqual(tracked.sectors.map((s: any) => s.sector), [...SECTORS]);
  assert.deepEqual(tracked.sectors[0], { sector: SECTORS[0], last_computed_at: '2026-09-30 04:00:00' });
  assert.deepEqual(tracked.sectors[1], { sector: SECTORS[1], last_computed_at: null, reason: NO_LIVE_SOURCE_REASON });
  assert.equal(tracked.as_of, '2026-09-30 04:00:00');
  assert.equal(t.sectors.value, 2, 'the raw-label count is kept, apart from the twelve');
});

test('totals: with nothing recorded, the new totals are "not recorded" with a reason, never a zero', async () => {
  const t = (await get(fixture())).body.totals;
  for (const k of ['supplied_companies', 'fund_sources']) {
    assert.equal(t[k].value, null, `${k} printed a zero`);
    assert.ok(t[k].reason, `${k} gave no reason`);
  }
  assert.ok(t.sectors_tracked.sectors.every((s: any) => s.last_computed_at === null && s.reason === NO_LIVE_SOURCE_REASON));
  assert.equal(t.sectors_tracked.as_of, null);
});

test('the split: private is the company directory, public is signal_companies, government is not recorded', async () => {
  const db = seeded();
  listed(db, 'AAA', '2026-09-20 00:00:00');
  listed(db, 'BBB', '2026-09-25 00:00:00');
  const split = (await get(db)).body.totals.market_split;
  assert.equal(split.private.value, 4);
  assert.equal(split.private.as_of, '2026-09-30');
  assert.match(split.private.note, /Listing status is not recorded/);
  assert.deepEqual([split.public.value, split.public.as_of], [2, '2026-09-25 00:00:00']);
  assert.match(split.public.source, /signal_companies/);
  assert.deepEqual(split.government, { value: null, as_of: null, source: null, reason: GOVERNMENT_REASON });
  // An empty list of listed companies is not recorded, not zero.
  const empty = (await get(seeded())).body.totals.market_split.public;
  assert.equal(empty.value, null);
  assert.match(empty.reason, /No listed company/);
});

test('the split: an unreadable list of listed companies says so; private still counts', async () => {
  const db = seeded();
  db.exec('DROP TABLE signal_companies');
  const { body } = await get(db);
  assert.equal(body.totals.status, 'ok');
  assert.equal(body.totals.market_split.public.reason, 'Unreadable');
  assert.equal(body.totals.market_split.public.value, null);
  assert.equal(body.totals.market_split.private.value, 4);
  assert.equal(body.totals.market_split.government.value, null);
});

test('totals: an unreadable index store marks every tracked sector "Unreadable", and only that line', async () => {
  const db = seeded();
  db.exec('DROP TABLE market_intel_indexes');
  const t = (await get(db)).body.totals;
  assert.equal(t.status, 'ok');
  assert.equal(t.sectors_tracked.reason, 'Unreadable');
  assert.ok(t.sectors_tracked.sectors.every((s: any) => s.reason === 'Unreadable' && s.last_computed_at === null));
  assert.equal(t.companies.value, 4);
});

test('competition: the "other" remainders and the companies with no label or no country', async () => {
  const db = seeded();
  company(db, 'e', 'Spain', 'Biotech');
  const c = (await get(db, { query: '?top=1' })).body.competition;
  // a,b Germany/fintech; c France/Robotics; d no country, no label; e Spain/Biotech.
  assert.equal(c.total_companies, 5);
  assert.deepEqual(c.by_sector.map((x: any) => [x.label.toLowerCase(), x.companies]), [['fintech', 2]]);
  assert.deepEqual(c.other_sectors, { labels: 2, companies: 2 });
  assert.equal(c.no_sector, 1);
  assert.deepEqual(c.by_country.map((x: any) => [x.country, x.companies]), [['Germany', 2]]);
  assert.deepEqual(c.other_countries, { countries: 2, companies: 2 });
  assert.equal(c.no_country, 1);
  const sum = (xs: any[]) => xs.reduce((n, x) => n + x.companies, 0);
  assert.equal(sum(c.by_sector) + c.other_sectors.companies + c.no_sector, c.total_companies, 'every company is counted once');
  assert.equal(sum(c.by_country) + c.other_countries.companies + c.no_country, c.total_companies);
});

test('money: HQ and focus go through the crosswalk; raw strings are never the bars', async () => {
  const db = seeded();
  fund(db, 'h1', 'Berlin', null, null, 'AI/ML, Generalist');
  fund(db, 'h2', 'Bay Area, Israel', null, null, 'Robotics');
  fund(db, 'h3', 'Cambridge', null, null, 'Generalist');
  fund(db, 'h4', '  ', null, null, null);
  const m = (await get(db, { query: '?top=2' })).body.money;
  assert.equal(m.status, 'ok');
  // Germany: f1, f2, and "Berlin". France: f3. US and IL: one fund naming both.
  assert.deepEqual(m.by_hq.map((x: any) => [x.code, x.hq, x.funds]), [['DE', 'Germany', 3], ['FR', 'France', 1]]);
  assert.ok(!m.by_hq.some((x: any) => x.hq === 'Berlin'), 'a raw HQ string reached the bars');
  assert.deepEqual(m.other_hq, { countries: 2, funds: 1 }, 'the two-country fund is one fund in "other"');
  assert.deepEqual(m.hq_unmapped, { values: 1, funds: 1 }, '"Cambridge" names two countries and is not placed');
  assert.equal(m.missing.hq, 1);
  assert.match(m.hq_basis, /crosswalk/);
  // Focus: fintech 2 (f1, f2), then ties at 1 broken by slug.
  assert.deepEqual(m.by_focus.map((x: any) => [x.slug, x.focus, x.funds]), [['fintech', 'Fintech', 2], ['ai', 'ai', 1]]);
  assert.deepEqual(m.other_focus, { markets: 2, funds: 2 }, 'deeptech and robotics, one fund each');
  assert.deepEqual(m.focus_unmapped, { values: 1, funds: 1 }, '"Generalist" is not a market');
  assert.equal(m.missing.focus, 1);
  assert.equal(m.total_funds, 7);
});

test('money: sizes only where the currency is known; the full vintage range; every missing count', async () => {
  const db = seeded();
  fund(db, 'x1', 'USA', 50_000_000_00, 2012, 'AI', 'Deep Tech Investors Mapping (public spreadsheet)');
  fund(db, 'x2', 'Germany', null, null, 'Fintech');
  const m = (await get(db)).body.money;
  // f1, f2, f3 are euro rows; x1's size is in no known currency and is never banded.
  assert.deepEqual(m.size_bands, [
    { band: SIZE_BANDS[0].band, funds: 1 }, { band: SIZE_BANDS[2].band, funds: 1 }, { band: SIZE_BANDS[4].band, funds: 1 },
  ]);
  assert.match(SIZE_BANDS[1].band, /€/);
  assert.equal(m.missing.size, 2, 'the unknown-currency size and the empty one');
  assert.deepEqual(m.vintages.map((v: any) => [v.year, v.funds]), [[2010, 1], [2012, 1], [2024, 1], [2025, 1]]);
  assert.deepEqual(m.vintage_range, { from: 2010, to: 2025 });
  assert.equal(m.missing.vintage, 1);
  assert.deepEqual(m.recent_vintages.map((x: any) => x.year), [2025, 2024], 'kept for the existing reader');
  assert.equal(m.total_funds, 5);
});

test('money: an unreadable crosswalk makes the money section unreadable, and only it', async () => {
  const db = seeded();
  db.exec('DROP TABLE research_taxonomy_overrides');
  const { status, body } = await get(db);
  assert.equal(status, 200);
  assert.deepEqual(body.money, { status: 'unreadable', reason: 'Unreadable' });
  for (const k of ['totals', 'competition', 'signals']) assert.equal(body[k].status, 'ok', k);
});

test('crosswalkCounts: ranked targets, then each remaining fund once in "other" or "unmapped"', () => {
  const rows = [
    { v: 'Germany', n: 3 }, { v: 'Berlin', n: 2 }, { v: 'France', n: 4 },
    { v: 'Bay Area, Israel', n: 1 }, { v: 'Cambridge', n: 2 }, { v: 'Global', n: 1 },
  ];
  const out = crosswalkCounts(rows, (v) => mapFundHq(v), 1);
  assert.deepEqual(out.ranked, [{ key: 'DE', funds: 5 }]);
  assert.deepEqual(out.other, { targets: 3, funds: 5 }, 'FR 4 and the US/IL fund once');
  assert.deepEqual(out.unmapped, { values: 2, funds: 3 });
});

test('signals: why now, the build opportunity, region and confidence; never the advisor note', async () => {
  const db = seeded();
  db.prepare(
    `UPDATE signals SET why_now = 'Rules changed this year', confidence_score = 72,
       build_opportunity = '{"headline":"Reconciliation for small banks","wedge":"month-end close","icp":"EU challenger banks","extra":"x"}'
     WHERE id = 's-new'`,
  ).run();
  const { body, text } = await get(db);
  const s = body.signals;
  assert.equal(s.active_count, 2);
  assert.equal((await get(db, { query: '?top=1' })).body.signals.active_count, 2, 'the active count is not the page length');
  const [fresh, old] = s.items;
  assert.equal(fresh.why_now, 'Rules changed this year');
  assert.deepEqual(fresh.build_opportunity, { headline: 'Reconciliation for small banks', wedge: 'month-end close', icp: 'EU challenger banks' });
  assert.equal(fresh.region, 'Europe');
  assert.equal(fresh.confidence_score, 72);
  // The stored defaults ('' / '{}' / 0) are not a value.
  assert.equal(old.why_now, null);
  assert.equal(old.why_now_reason, 'Not recorded');
  assert.equal(old.build_opportunity, null);
  assert.equal(old.confidence_score, null, 'a 0 default printed as a confidence');
  assert.match(old.confidence_reason, /no evidence has been scored/);
  assert.ok(!text.includes('ADVISOR-NOTE-SENTINEL'));
  assert.ok(!text.includes('advisor_note'));
  const src = readFileSync(resolve(here, '../src/routes/research_overview.ts'), 'utf8');
  const sql = src.slice(src.indexOf('async function readSignals'), src.indexOf('researchOverview.get('));
  assert.doesNotMatch(sql.replace(/\/\/.*$/gm, ''), /advisor_note/, 'the signals read selects advisor_note');
});

test('buildOpportunity keeps the known text fields and nothing else', () => {
  assert.equal(buildOpportunity('{}'), null);
  assert.equal(buildOpportunity('not json'), null);
  assert.equal(buildOpportunity('[1]'), null);
  assert.equal(buildOpportunity(null), null);
  assert.deepEqual(buildOpportunity('{"headline":" A ","risks":"B","moat":3}'), { headline: 'A', risks: 'B' });
});
