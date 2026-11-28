/**
 * D7929 (#7929): the SEC EDGAR company financial facts importer, over every migration and real SQLite, with no
 * network. Every response here is invented: a made-up registrant (CIK 999001, "Example Widgets Corp"), made-up
 * accessions and made-up values, in the company-concept API's JSON shape. No real SEC value or company is committed.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  conceptUrl, EDGAR_CONCEPTS, EDGAR_LIMITATIONS, EDGAR_REQUEST_GAP_MS, edgarParams, edgarUserAgent, editions, ingestSecEdgarFacts,
  restatementNote, SOURCE_ID, USER_AGENT_BINDING,
} from '../src/services/marketObservations/secEdgarFacts.ts';
import { IMPORTERS } from '../src/services/marketObservations/importers.ts';
import { coverageOf } from '../src/services/researchObservations.ts';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const CIK = '0000999001';
/** An invented identity in the shape the SEC asks for; example.org is reserved for documentation. */
const AGENT = 'Example Research Desk research-ops@example.org';
const acc = (yy: number, n: number) => `${CIK}-${yy}-${String(n).padStart(6, '0')}`;
type F = Record<string, unknown>;
const fact = (start: string | null, end: string, val: unknown, accn: string, form: string, filed: string, fy = 2024, fp = 'FY'): F =>
  ({ ...(start ? { start } : {}), end, ...(val === undefined ? {} : { val }), accn, fy, fp, form, filed });

/** FY2023 revenue was 1200 in the 10-K and restated to 1150 by a 10-K/A; FY2024 was a published zero. */
const REVENUE_FACTS = (withAmendment = true): F[] => [
  fact('2021-01-01', '2021-12-31', 800, acc(22, 9), '10-K', '2022-02-18', 2021),
  fact('2022-01-01', '2022-12-31', 1000, acc(23, 10), '10-K', '2023-02-20', 2022),
  fact('2022-01-01', '2022-12-31', 1000, acc(24, 12), '10-K', '2024-02-22', 2023),
  fact('2023-01-01', '2023-12-31', 1200, acc(24, 12), '10-K', '2024-02-22', 2023),
  fact('2023-01-01', '2023-12-31', 9999, acc(24, 20), '8-K', '2024-03-01', 2023),
  ...(withAmendment ? [
    fact('2023-01-01', '2023-12-31', 1150, acc(24, 30), '10-K/A', '2024-06-01', 2023),
    fact('2023-01-01', '2023-12-31', 1150, acc(25, 8), '10-K', '2025-02-21', 2024),
  ] : []),
  fact('2024-01-01', '2024-12-31', 0, acc(25, 8), '10-K', '2025-02-21', 2024),
  fact('2024-01-01', '2024-03-31', 300, acc(24, 40), '10-Q', '2024-05-02', 2024, 'Q1'),
  fact('2024-10-01', '2024-12-31', 310, acc(25, 8), '10-K', '2025-02-21', 2024),
  fact('2022-07-01', '2023-06-30', null, acc(23, 50), '10-KT', '2023-09-01', 2023),
];
const ASSET_FACTS: F[] = [
  fact(null, '2023-12-31', 5000, acc(24, 12), '10-K', '2024-02-22', 2023),
  fact(null, '2024-12-31', 5600, acc(25, 8), '10-K', '2025-02-21', 2024),
  fact('2024-01-01', '2024-12-31', 1, acc(25, 8), '10-K', '2025-02-21', 2024),
];
const concept = (taxonomy: string, tag: string, units: Record<string, F[]>, over: F = {}) =>
  ({ cik: 999001, taxonomy, tag, label: tag, description: 'invented', entityName: 'Example Widgets Corp', units, ...over });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ASK = { cik: '999001', concepts: ['revenues', 'assets', 'net_income'], from: 2022, to: 2024 };

function provider(withAmendment = true): (url: string) => Response {
  return url => {
    if (url === conceptUrl(CIK, 'us-gaap', 'Revenues'))
      return json(concept('us-gaap', 'Revenues', { USD: REVENUE_FACTS(withAmendment), 'USD/shares': [fact('2023-01-01', '2023-12-31', 1.5, acc(24, 12), '10-K', '2024-02-22')] }));
    if (url === conceptUrl(CIK, 'us-gaap', 'Assets')) return json(concept('us-gaap', 'Assets', { USD: ASSET_FACTS }));
    return json({ error: 'not found' }, 404);
  };
}

async function world(t: TestContext, { enabled = true, agent = AGENT as string | null } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  if (enabled) db.exec(`UPDATE research_market_sources SET enabled=1 WHERE id='${SOURCE_ID}'`);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { ENVIRONMENT: 'development', DB: d1Over(db), ...(agent === null ? {} : { [USER_AGENT_BINDING]: agent }) } as any;
  let reply = provider();
  const calls: string[] = [], agents: (string | null)[] = [], at: number[] = [];
  let open = 0, maxOpen = 0;
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    calls.push(String(input)); agents.push(new Headers(init?.headers).get('user-agent')); at.push(performance.now());
    open++; maxOpen = Math.max(maxOpen, open);
    try { await Promise.resolve(); return reply(String(input)); } finally { open--; }
  });
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, calls, agents, at, maxOpen: () => maxOpen, stored, runs, serve: (fn: (url: string) => Response) => { reply = fn; } };
}

test('the importer is registered last under its own source and asks the company-concept API for exactly the concept', () => {
  assert.deepEqual(Object.keys(IMPORTERS), ['world-bank', 'eurostat-sbs', 'census-cbp', 'bls-ce', 'sec-edgar-facts']);
  assert.equal(IMPORTERS['sec-edgar-facts'].source_id, 'sec-edgar-facts');
  assert.equal(conceptUrl(CIK, 'us-gaap', 'Revenues'), 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000999001/us-gaap/Revenues.json');
});

test('a batch is one CIK, one to four known concepts and at most five period-end years; anything else is refused', () => {
  const now = new Date(NOW);
  assert.deepEqual(edgarParams({ cik: '999001', concepts: ['revenues'], from: 2024, to: 2026 }, now),
    { cik: CIK, concepts: ['revenues'], from: 2024, to: 2026 });
  assert.deepEqual(edgarParams({ cik: '0000999001', concepts: ['assets', 'ifrs_revenue'], from: 2009, to: 2013 }, now).from, 2009);
  for (const bad of [
    { cik: 999001, concepts: ['revenues'], from: 2022, to: 2024 }, { cik: '0', concepts: ['revenues'], from: 2022, to: 2024 },
    { cik: '12345678901', concepts: ['revenues'], from: 2022, to: 2024 }, { cik: 'CIK1', concepts: ['revenues'], from: 2022, to: 2024 },
    { cik: '1', concepts: [], from: 2022, to: 2024 }, { cik: '1', concepts: ['market_size'], from: 2022, to: 2024 },
    { cik: '1', concepts: ['revenues', 'revenues'], from: 2022, to: 2024 },
    { cik: '1', concepts: ['revenues', 'assets', 'net_income', 'operating_income', 'ifrs_revenue'], from: 2022, to: 2024 },
    { cik: '1', concepts: ['revenues'], from: 2008, to: 2010 }, { cik: '1', concepts: ['revenues'], from: 2026, to: 2027 },
    { cik: '1', concepts: ['revenues'], from: 2020, to: 2025 }, { cik: '1', concepts: ['revenues'], from: 2024, to: 2023 },
    { cik: '1', concepts: ['revenues'], from: '2022', to: 2024 }, { cik: '1', concepts: ['revenues'], from: 2022, to: 2024, ticker: 'EXW' }, null, [],
  ]) assert.throws(() => edgarParams(bad, now), (e: any) => e.code === 'invalid_sec_edgar_parameters', JSON.stringify(bad));
});

test('the User-Agent comes only from its binding and must name the requester with a contact address', () => {
  assert.equal(edgarUserAgent({ [USER_AGENT_BINDING]: `  ${AGENT} ` }), AGENT);
  for (const bad of [undefined, '', 'research-ops@example.org', 'Example Research Desk', 'Example Research Desk (no contact)',
    `Example Research Desk ${'x'.repeat(200)}@example.org`, 'Example Research\nDesk ops@example.org', 42])
    assert.equal(edgarUserAgent({ [USER_AGENT_BINDING]: bad }), null, JSON.stringify(bad));
  const code = readFileSync(new URL('../src/services/marketObservations/secEdgarFacts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /[A-Za-z0-9._%+-]+@(?!example\.org)[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'no real contact address is in the importer');
  assert.doesNotMatch(code, /from '[^']*(market_intel|import-sec-edgar|secEdgarCompanies|listedCompanies)/,
    'neither the filings-count connector nor the ticker directory is a source of financial evidence');
});

test('the migration leaves one disabled source, unexportable, and six company-reported metrics; a disabled source runs nothing', async t => {
  const w = await world(t, { enabled: false });
  const src = w.db.prepare("SELECT * FROM research_market_sources WHERE id='sec-edgar-facts'").get() as any;
  assert.equal(src.enabled, 0, 'no live activation is authorised (#7929)');
  assert.equal(src.export_allowed, null); assert.equal(src.refresh_policy, 'annual');
  assert.match(src.license_or_usage_note, /not a market size/);
  assert.match(src.license_or_usage_note, /must be confirmed before it is enabled/);
  const metrics = w.db.prepare("SELECT metric_key, definition FROM research_market_metrics WHERE source_id='sec-edgar-facts'").all() as any[];
  assert.deepEqual(metrics.map(m => m.metric_key).sort(), Object.keys(EDGAR_CONCEPTS).map(k => `edgar_${k}`).sort());
  assert.ok(metrics.every(m => /registrant/.test(m.definition) && /(never a market size|Not a market or industry figure)/.test(m.definition)));
  await assert.rejects(ingestSecEdgarFacts(w.env, ASK), (e: any) => e.code === 'source_disabled');
  assert.equal(w.calls.length, 0); assert.equal(w.runs().length, 0);
});

test('without a configured identity nothing is requested and no run is recorded', async t => {
  const w = await world(t, { agent: null });
  await assert.rejects(ingestSecEdgarFacts(w.env, ASK), (e: any) => e.code === 'sec_edgar_identity_not_configured' && e.status === 409);
  assert.equal(w.calls.length, 0); assert.equal(w.runs().length, 0); assert.equal(w.stored().length, 0);
});

test('each fact keeps its entity, accession, concept, period, unit, filing date and restatement; a replay adds nothing', async t => {
  const w = await world(t);
  const marketIntel = () => (w.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'market_intel%'").all() as any[])
    .reduce((n, r) => n + Number((w.db.prepare(`SELECT COUNT(*) AS n FROM "${r.name}"`).get() as any).n), 0);
  const before = marketIntel();
  const r = await ingestSecEdgarFacts(w.env, ASK);
  assert.deepEqual(w.calls, [conceptUrl(CIK, 'us-gaap', 'Revenues'), conceptUrl(CIK, 'us-gaap', 'Assets'), conceptUrl(CIK, 'us-gaap', 'NetIncomeLoss')]);
  assert.deepEqual(w.agents, [AGENT, AGENT, AGENT], 'every request declares the configured identity');
  assert.equal(w.maxOpen(), 1, 'one request at a time');
  for (let i = 1; i < w.at.length; i++) assert.ok(w.at[i] - w.at[i - 1] >= EDGAR_REQUEST_GAP_MS - 5, `gap ${i}: ${w.at[i] - w.at[i - 1]}`);
  assert.deepEqual([r.status, r.rows_seen, r.rows_inserted, r.rows_unchanged, r.restated, r.requests, r.failure], ['succeeded', 6, 5, 0, 1, 3, null]);
  assert.deepEqual(r.skipped, { not_reported: 1, missing_value: 1, unknown_unit: 1, conflicting: 0 });
  const rows = w.stored(), by = (identity: string, tag = 'Revenues') => rows.find(x => x.source_observation_key === `edgar:${CIK}:us-gaap:${tag}:USD:${identity}`);
  const fy23 = by('2023-01-01:2023-12-31');
  assert.deepEqual([fy23.value, fy23.vintage, fy23.published_at, fy23.period, fy23.unit, fy23.currency, fy23.scale, fy23.price_basis, fy23.observation_status],
    [1150, acc(24, 30), '2024-06-01', '2023', 'USD', 'USD', 'units', 'current_prices', 'actual'], 'the amended value, from the accession that first filed it');
  assert.equal(fy23.retrieved_at, new Date(NOW).toISOString());
  assert.deepEqual([fy23.geography_type, fy23.geography_code, fy23.statistical_unit, fy23.metric_key], ['ecosystem', `CIK${CIK}`, 'enterprise', 'edgar_revenues']);
  assert.equal(fy23.series_id, `EDGAR.${CIK}.us-gaap.Revenues.USD`);
  assert.equal(fy23.metric_label, `Example Widgets Corp (CIK ${CIK}): Revenues, as reported (us-gaap:Revenues)`);
  assert.equal(fy23.applicability_note, `Reported by Example Widgets Corp (CIK ${CIK}) in accession ${acc(24, 30)} (10-K/A, filed 2024-06-01); `
    + `period 2023-01-01 to 2023-12-31; the filing's own fiscal focus 2023 FY.`);
  assert.equal(fy23.limitations, `${EDGAR_LIMITATIONS} Restated: this value replaces 1200 USD first reported in accession ${acc(24, 12)} (10-K, filed 2024-02-22).`);
  assert.doesNotMatch(fy23.limitations, /9999/, 'an 8-K figure is neither the value nor a restatement');
  const fy22 = by('2022-01-01:2022-12-31');
  assert.deepEqual([fy22.value, fy22.vintage, fy22.published_at, fy22.limitations], [1000, acc(23, 10), '2023-02-20', EDGAR_LIMITATIONS],
    'a later filing repeating a value is not a restatement and keeps the first accession');
  assert.equal(by('2024-01-01:2024-12-31').value, 0, 'a reported zero is stored');
  assert.equal(by('2022-07-01:2023-06-30'), undefined, 'a fact with no value stores nothing, never a zero');
  assert.ok(!rows.some(x => [300, 310, 800, 1.5, 1].includes(x.value)), 'quarters, out-of-range years, per-share units and a flow under a balance are not read');
  const assets = by(':2024-12-31', 'Assets');
  assert.deepEqual([assets.value, assets.metric_key, assets.period, assets.vintage], [5600, 'edgar_assets', '2024', acc(25, 8)]);
  assert.match(assets.applicability_note, /; period at 2024-12-31;/);
  assert.ok(!rows.some(x => x.geography_type === 'country' || x.geography_type === 'region'), 'no company figure is stored as a geography');
  w.db.exec(`INSERT OR IGNORE INTO research_market_metrics (metric_key, source_id, label, definition, unit) VALUES ('edgar_revenues','sec-edgar-facts','x','x','x')`);
  assert.equal((await coverageOf(w.env, 'edgar_revenues', 'USA', NOW)).state, 'no_observation', 'a company\'s revenue never answers for the United States');
  assert.equal(marketIntel(), before, 'no market-intelligence or index write');
  const run = w.runs()[0];
  assert.deepEqual([run.status, run.rows_seen, run.rows_inserted, run.vintage], ['succeeded', 6, 5, `accession:${acc(25, 8)}`]);
  const again = await ingestSecEdgarFacts(w.env, ASK);
  assert.deepEqual([again.status, again.rows_inserted, again.rows_unchanged], ['succeeded', 0, 5]);
  assert.equal(w.stored().length, 5);
});

test('a restatement filed after an import adds one revision that supersedes the stored value and cites it', async t => {
  const w = await world(t);
  w.serve(provider(false));
  await ingestSecEdgarFacts(w.env, { ...ASK, concepts: ['revenues'] });
  const key = `edgar:${CIK}:us-gaap:Revenues:USD:2023-01-01:2023-12-31`;
  const first = w.stored().find(x => x.source_observation_key === key);
  assert.deepEqual([first.value, first.vintage, first.limitations], [1200, acc(24, 12), EDGAR_LIMITATIONS]);
  w.serve(provider(true));
  const r = await ingestSecEdgarFacts(w.env, { ...ASK, concepts: ['revenues'] });
  assert.deepEqual([r.rows_inserted, r.rows_unchanged, r.restated], [1, 2, 1]);
  const chain = w.stored().filter(x => x.source_observation_key === key);
  assert.deepEqual(chain.map(x => [x.value, x.vintage]), [[1200, acc(24, 12)], [1150, acc(24, 30)]], 'the original stays');
  assert.equal(chain[1].supersedes_observation_id, chain[0].id);
});

test('a failed or unreadable response stores nothing, keeps the last good values and reports a bounded outcome', async t => {
  const w = await world(t);
  await ingestSecEdgarFacts(w.env, ASK);
  const good = w.stored().map(x => [x.id, x.value, x.vintage]);
  const cases: [string, (url: string) => Response, string][] = [
    ['server error', () => json({}, 500), 'provider_http HTTP 500'],
    ['another entity', url => url.includes('Assets') ? json(concept('us-gaap', 'Assets', { USD: ASSET_FACTS }, { cik: 999002 })) : provider()(url), 'provider_payload'],
    ['another concept', url => url.includes('Revenues') ? json(concept('us-gaap', 'Assets', { USD: ASSET_FACTS })) : provider()(url), 'provider_payload'],
    ['a malformed accession', url => url.includes('Assets')
      ? json(concept('us-gaap', 'Assets', { USD: [fact(null, '2024-12-31', 1, '999001-25-8', '10-K', '2025-02-21')] })) : provider()(url), 'provider_payload'],
    ['not JSON', url => url.includes('Assets') ? new Response('<html>blocked</html>') : provider()(url), 'provider_payload'],
    ['more facts than one batch', url => url.includes('Revenues') ? json(concept('us-gaap', 'Revenues', { USD: Array.from({ length: 41 }, (_, i) => {
      const end = new Date(Date.UTC(2024, 0, 1 + i)), start = new Date(end.getTime() - 364 * 86_400_000);
      return fact(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), i, acc(25, 100 + i), '10-K', '2025-03-01');
    }) })) : provider()(url), 'provider_payload'],
  ];
  for (const [name, reply, failure] of cases) {
    w.serve(reply);
    const r = await ingestSecEdgarFacts(w.env, ASK);
    assert.deepEqual([r.status, r.failure, r.rows_inserted, r.rows_seen, r.restated], ['failed', failure, 0, 0, 0], name);
    assert.deepEqual(r.skipped, { not_reported: 0, missing_value: 0, unknown_unit: 0, conflicting: 0 }, name);
    assert.deepEqual(w.stored().map(x => [x.id, x.value, x.vintage]), good, `${name}: the last good values stay`);
  }
  const last = (w.db.prepare("SELECT last_error, last_success_at FROM research_market_sources WHERE id='sec-edgar-facts'").get() as any);
  assert.equal(last.last_error, 'provider_payload');
  assert.ok(last.last_success_at, 'the earlier success is still recorded');
});

test('editions follow filing order; one filing giving two values for one fact stores nothing', async t => {
  const a = fact('2023-01-01', '2023-12-31', 5, acc(24, 2), '10-K', '2024-02-01') as any;
  const b = fact('2023-01-01', '2023-12-31', 6, acc(24, 3), '10-K/A', '2024-05-01') as any;
  const c = fact('2023-01-01', '2023-12-31', 6, acc(25, 1), '10-K', '2025-02-01') as any;
  const d = fact('2023-01-01', '2023-12-31', 5, acc(25, 9), '10-K/A', '2025-06-01') as any;
  const e = editions([c, a, d, b]);
  assert.deepEqual([e.current.accn, e.prior.map(f => f.accn)], [acc(25, 9), [acc(24, 2), acc(24, 3)]], 'a value changed back is a new edition');
  assert.equal(restatementNote(e.prior, 'USD'), `Restated: this value replaces 6 USD first reported in accession ${acc(24, 3)} (10-K/A, filed 2024-05-01); `
    + `5 USD first reported in accession ${acc(24, 2)} (10-K, filed 2024-02-01).`);
  const many = Array.from({ length: 5 }, (_, i) => fact('2023-01-01', '2023-12-31', i, acc(24, 10 + i), '10-K/A', `2024-0${i + 1}-01`) as any);
  assert.match(restatementNote(many, 'USD')!, /^Restated: this value replaces 4 USD .*; 2 USD .*; and 2 earlier values\.$/);
  assert.equal(restatementNote([], 'USD'), null);
  // A filing agent's accession can sort before the company's own although it was filed later: the filing date decides.
  const own = fact('2023-01-01', '2023-12-31', 7, acc(24, 12), '10-K', '2024-02-22') as any;
  const agent = fact('2023-01-01', '2023-12-31', 8, '0000950170-24-000077', '10-K/A', '2024-06-01') as any;
  assert.deepEqual([editions([own, agent]).current.val, editions([agent, own]).current.val], [8, 8]);
  const w = await world(t);
  w.serve(url => url.includes('Revenues') ? json(concept('us-gaap', 'Revenues', { USD: [
    fact('2023-01-01', '2023-12-31', 10, acc(24, 12), '10-K', '2024-02-22'),
    fact('2023-01-01', '2023-12-31', 11, acc(24, 12), '10-K', '2024-02-22'),
    fact('2024-01-01', '2024-12-31', 12, acc(25, 8), '10-K', '2025-02-21'),
  ] })) : provider()(url));
  const r = await ingestSecEdgarFacts(w.env, { ...ASK, concepts: ['revenues'] });
  assert.deepEqual([r.status, r.rows_seen, r.rows_inserted, r.skipped.conflicting], ['succeeded', 2, 1, 1]);
  assert.deepEqual(w.stored().map(x => x.value), [12]);
});
