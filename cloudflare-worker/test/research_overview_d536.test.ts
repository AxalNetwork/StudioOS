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

import researchOverview, { demandOverSupply, SIZE_BANDS } from '../src/routes/research_overview.ts';
import { SECTORS } from '../src/services/market_intel/aggregator.ts';
import { LIVE_INDEX_BASIS, NO_LIVE_SOURCE_REASON } from '../src/services/market_intel/liveRows.ts';
import { periodKey } from '../src/services/market_intel/scoring.ts';
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
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fay', 'fay@axal.example')`).run(USER);
  return db;
}

function company(db: InstanceType<typeof DatabaseSync>, uid: string, country: string | null, sector: string | null) {
  db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, 'https://www.wikidata.org/wiki/Q1', '2026-09-30')`,
  ).run(uid, uid, `https://${uid}.example`, country, sector);
}

function fund(db: InstanceType<typeof DatabaseSync>, uid: string, hq: string | null, sizeCents: number | null, year: number | null, focus: string | null) {
  db.prepare(
    `INSERT INTO research_fund_directory (uid, name, hq, fund_size_cents, fund_year, sector_focus, source_name, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, ?, 'EuroTech VC Funds', 'https://example.org/sheet', '2026-09-28')`,
  ).run(uid, uid, hq, sizeCents, year, focus);
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

async function get(db: InstanceType<typeof DatabaseSync>, opts: { auth?: boolean; query?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = await new SignJWT({ user_id: USER, role: 'founder' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/research/overview${opts.query ?? ''}`, { headers },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
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
  assert.match(t.market_split.reason, /not recorded yet/);
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
  assert.deepEqual(m.by_focus.map((x: any) => [x.focus.toLowerCase(), x.funds]), [['fintech', 2], ['deep tech', 1]]);
  assert.deepEqual(m.size_bands, [
    { band: SIZE_BANDS[0].band, funds: 1 }, { band: SIZE_BANDS[2].band, funds: 1 }, { band: SIZE_BANDS[4].band, funds: 1 },
  ]);
  assert.ok(m.size_bands.every((b: any) => b.funds > 0), 'a band with no fund is a zero');
  assert.deepEqual(m.recent_vintages.map((x: any) => x.year), [2025, 2024], '2010 is not recent');
  assert.match(m.size_note, /does not record/);
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
