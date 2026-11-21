/**
 * D7743 (#7743) — the fund statement store: every source's statement about a
 * fund in its own words, money facts apart, stage and geography terms, and
 * the one served read.
 *
 * Real SQLite with foreign keys ON (the shared schema loader turns them off,
 * so this file opens its own database): the directory as migration 378
 * declares it, 406's sources table, 7166's uid moves, 7167's vehicle facts and
 * this issue's migration, run whole. Every fund name, list and wording here is
 * invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_observations_7743.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { STAGES } from '../src/services/companyProfileFields.ts';
import {
  MONEY_FACTS, RESEARCH_REGIONS, ROUND_STAGES, compareStatements, normaliseGeography, normaliseStage,
  observationStatements, readAmount, readFundStatements, type ObservationInput,
} from '../src/services/researchFundObservations.ts';

const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const M7743 = 'migrations/202611191932_7743_research_fund_observations.sql';

const CITE = 'Harbour Lantern Fund Index';
const OPEN = 'Quill Meadow Investor Notes';
const DOWN = 'Slate Orchard Fund Sheet';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(sql('migrations/406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  const m378 = sql('migrations/378_research_fund_directory_rebuild.sql');
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory_reports \(.*?\);/)![0]);
  db.exec(sql('migrations/202611180052_7166_research_fund_directory_vehicles.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory_uid_moves \(.*?\);/)![0]);
  db.exec(sql('migrations/202611180053_7167_research_fund_vehicle_facts.sql'));
  db.exec(sql(M7743));
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
  db.exec(`INSERT INTO research_fund_sources (source_name,title,publisher,published_url,terms_status,terms_quote,evidence_url,evidence,verdict,verdict_reason,reviewed_on) VALUES
    ('${CITE}','Harbour Lantern','A publisher','https://list.example/hl','not found',NULL,NULL,'e','cite only','r','2026-11-01'),
    ('${OPEN}','Quill Meadow','A publisher','https://list.example/qm','found','Reuse is welcome.','https://list.example/qm/terms','e','republish allowed','r','2026-11-01'),
    ('${DOWN}','Slate Orchard','A publisher','https://list.example/so','not found',NULL,NULL,'e','not allowed','r','2026-11-01')`);
  db.exec(`INSERT INTO research_fund_directory (uid,name,source_name,source_url,as_of) VALUES
    ('pinecrest-ii','Pinecrest Ventures II','${CITE}','https://repo.example/hl.csv','2026-11-01'),
    ('marrow-i','Marrow Bay Capital I','${CITE}','https://repo.example/hl.csv','2026-11-01')`);
  return { db, env: { DB: d1Over(db) } as any };
}
type F = ReturnType<typeof fixture>;

const BASE = { source_url: 'https://list.example/row', imported_on: '2026-11-19', method: 'rule' as const };
function write(f: F, inputs: Partial<ObservationInput>[]) {
  const w = observationStatements(f.env.DB, inputs.map((i) => ({ ...BASE, ...i }) as ObservationInput));
  return f.env.DB.batch(w.statements).then(() => w);
}

let seq = 0;
/** A raw INSERT, for the CHECKs the writer never reaches. */
function insert(f: F, cols: Record<string, unknown>) {
  const row = { fund_uid: 'pinecrest-ii', fact: 'initial_cheque', wording: 'An invented cheque line', source_name: CITE,
    source_record_ref: `r-${++seq}`, imported_on: '2026-11-19', method: 'rule', ...cols };
  const keys = Object.keys(row);
  f.db.prepare(`INSERT INTO research_fund_observations (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...(Object.values(row) as any[]));
}
const rows = (f: F, where = '1=1') => f.db.prepare(`SELECT * FROM research_fund_observations WHERE ${where} ORDER BY id`).all() as any[];

test('two sources state one fact for one fund; a second row for the same source record is refused', async () => {
  const f = fixture();
  await write(f, [
    { fund_uid: 'pinecrest-ii', fact: 'manager_name', wording: 'Pinecrest Partners', source_name: CITE, source_record_ref: 'hl-12' },
    { fund_uid: 'pinecrest-ii', fact: 'manager_name', wording: 'Pinecrest Partners LLP', source_name: OPEN, source_record_ref: 'qm-3' },
  ]);
  assert.deepEqual(rows(f).map((r) => [r.source_name, r.wording]), [[CITE, 'Pinecrest Partners'], [OPEN, 'Pinecrest Partners LLP']]);
  assert.throws(() => insert(f, { fact: 'manager_name', wording: 'Pinecrest again', source_record_ref: 'hl-12' }), /UNIQUE/);
});

test('a statement whose list has no terms review row is refused', () => {
  const f = fixture();
  assert.throws(() => insert(f, { fact: 'manager_name', wording: 'Pinecrest Partners', source_name: 'An unreviewed list',
    qualifier: null, currency_basis: null }), /FOREIGN KEY/);
});

test('a dollar-symbol range keeps its wording, both bounds, no currency and basis symbol_only; an ISO code outside EUR, USD and GBP is kept', async () => {
  const f = fixture();
  const dollar = readAmount('initial_cheque', '$250k - $1m');
  assert.deepEqual(dollar, { fact: 'initial_cheque', qualifier: 'range', min_cents: 25_000_000, max_cents: 100_000_000,
    point_cents: null, currency: null, currency_basis: 'symbol_only', review_flags: null });
  await write(f, [
    { fund_uid: 'pinecrest-ii', fact: 'initial_cheque', wording: '$250k - $1m', source_name: CITE, source_record_ref: 'hl-1' },
    { fund_uid: 'marrow-i', fact: 'initial_cheque', wording: 'CHF 250k - 1m', source_name: CITE, source_record_ref: 'hl-2' },
  ]);
  const [a, b] = rows(f);
  assert.deepEqual([a.wording, a.qualifier, a.min_cents, a.max_cents, a.point_cents, a.currency, a.currency_basis],
    ['$250k - $1m', 'range', 25_000_000, 100_000_000, null, null, 'symbol_only']);
  assert.deepEqual([b.wording, b.qualifier, b.min_cents, b.max_cents, b.currency, b.currency_basis],
    ['CHF 250k - 1m', 'range', 25_000_000, 100_000_000, 'CHF', 'stated']);
});

test('an average first cheque is one point amount; giving it a min or a max is refused', () => {
  const f = fixture();
  const r = readAmount('initial_cheque', 'Average first cheque €400k');
  assert.deepEqual([r.qualifier, r.point_cents, r.min_cents, r.max_cents, r.currency_basis], ['average_first', 40_000_000, null, null, 'symbol_only']);
  assert.deepEqual([readAmount('initial_cheque', 'Typically €300k').qualifier, readAmount('initial_cheque', 'Typically €300k').point_cents], ['typical', 30_000_000]);
  insert(f, { qualifier: 'average_first', point_cents: 40_000_000, currency_basis: 'symbol_only' });
  assert.throws(() => insert(f, { qualifier: 'average_first', point_cents: 40_000_000, min_cents: 1, currency_basis: 'symbol_only' }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'average_first', point_cents: 40_000_000, max_cents: 1, currency_basis: 'symbol_only' }), /CHECK/);
});

test('amounts must match their qualifier: lower bound with a max, upper bound with a min, min above max, and as_stated with an amount are refused', () => {
  const f = fixture();
  const ok = { currency_basis: 'not_stated' };
  insert(f, { ...ok, qualifier: 'lower_bound', min_cents: 100 });
  insert(f, { ...ok, qualifier: 'upper_bound', max_cents: 100 });
  insert(f, { ...ok, qualifier: 'range', min_cents: 100, max_cents: 100 });
  insert(f, { ...ok, qualifier: 'as_stated' });
  assert.throws(() => insert(f, { ...ok, qualifier: 'lower_bound', min_cents: 100, max_cents: 200 }), /CHECK/);
  assert.throws(() => insert(f, { ...ok, qualifier: 'upper_bound', min_cents: 100, max_cents: 200 }), /CHECK/);
  assert.throws(() => insert(f, { ...ok, qualifier: 'range', min_cents: 300, max_cents: 200 }), /CHECK/);
  assert.throws(() => insert(f, { ...ok, qualifier: 'as_stated', point_cents: 100 }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'exact', point_cents: 100 }), /CHECK/, 'a money fact without a basis');
});

test('a currency code needs basis stated or reviewed: with symbol_only it is refused, and stated without a code is refused', () => {
  const f = fixture();
  insert(f, { qualifier: 'exact', point_cents: 100, currency: 'SEK', currency_basis: 'stated' });
  insert(f, { qualifier: 'exact', point_cents: 100, currency: 'SEK', currency_basis: 'reviewed' });
  assert.throws(() => insert(f, { qualifier: 'exact', point_cents: 100, currency: 'USD', currency_basis: 'symbol_only' }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'exact', point_cents: 100, currency: null, currency_basis: 'stated' }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'exact', point_cents: 100, currency: 'usd', currency_basis: 'stated' }), /CHECK/);
});

test('each of the four flagged forms is stored as_stated with its flag, and a flagged row with an amount is refused', async () => {
  const f = fixture();
  const forms: [string, string, string | null, string][] = [
    ['two', '€1m k', null, 'two_units'],
    ['heading', '$2m', 'Ticket size (EUR)', 'symbol_heading_conflict'],
    ['question', '€500k?', null, 'trailing_question_mark'],
    ['many', '€1m, €3m', null, 'multiple_amounts'],
  ];
  await write(f, forms.map(([ref, wording, heading]) => ({ fund_uid: 'pinecrest-ii', fact: 'initial_cheque' as const, wording, heading, source_name: CITE, source_record_ref: ref })));
  const got = rows(f).map((r) => [r.wording, r.qualifier, r.min_cents, r.max_cents, r.point_cents, JSON.parse(r.review_flags)]);
  assert.deepEqual(got, forms.map(([, wording, , flag]) => [wording, 'as_stated', null, null, null, [flag]]));
  assert.equal(rows(f, "wording = '$2m'")[0].currency_basis, 'conflicting');
  assert.throws(() => insert(f, { qualifier: 'exact', point_cents: 100, currency_basis: 'not_stated', review_flags: '["two_units"]' }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'as_stated', currency_basis: 'not_stated', review_flags: '["a_flag_nobody_named"]' }), /CHECK/);
  assert.throws(() => insert(f, { qualifier: 'as_stated', currency_basis: 'not_stated', review_flags: '[]' }), /CHECK/);
});

test('an amount, qualifier or basis on a text fact is refused', () => {
  const f = fixture();
  insert(f, { fact: 'traction_requirement', wording: 'Some paying customers' });
  assert.throws(() => insert(f, { fact: 'traction_requirement', wording: 'Over €1m', point_cents: 100 }), /CHECK/);
  assert.throws(() => insert(f, { fact: 'traction_requirement', wording: 'Over €1m', qualifier: 'as_stated', currency_basis: 'not_stated' }), /CHECK/);
});

test('a cheque, a capital figure, an AUM and a revenue threshold from one record are four rows; readAmount returns the fact it was given', async () => {
  const f = fixture();
  for (const fact of MONEY_FACTS) assert.equal(readAmount(fact, '€5m').fact, fact);
  await write(f, [
    { fact: 'initial_cheque', wording: 'Up to €750k' },
    { fact: 'stated_fund_capital', wording: '€60m' },
    { fact: 'manager_aum', wording: 'EUR 1.2bn' },
    { fact: 'revenue_threshold', wording: 'Minimum €1m ARR' },
  ].map((x) => ({ ...x, fund_uid: 'pinecrest-ii', source_name: CITE, source_record_ref: 'hl-row-40' })) as Partial<ObservationInput>[]);
  const got = rows(f).map((r) => [r.fact, r.qualifier, r.min_cents, r.max_cents, r.point_cents, r.currency, r.currency_basis]);
  assert.deepEqual(got, [
    ['initial_cheque', 'upper_bound', null, 75_000_000, null, null, 'symbol_only'],
    ['stated_fund_capital', 'exact', null, null, 6_000_000_000, null, 'symbol_only'],
    ['manager_aum', 'exact', null, null, 120_000_000_000, 'EUR', 'stated'],
    ['revenue_threshold', 'lower_bound', 100_000_000, null, null, null, 'symbol_only'],
  ]);
});

test('readAmount: unrecognised words are as_stated with no amounts; a bare heading code is heading_only with no currency', () => {
  assert.deepEqual(readAmount('initial_cheque', 'Flexible, depends on the round'),
    { fact: 'initial_cheque', qualifier: 'as_stated', min_cents: null, max_cents: null, point_cents: null, currency: null, currency_basis: 'not_stated', review_flags: null });
  const h = readAmount('initial_cheque', '1-2m', 'Cheque (EUR)');
  assert.deepEqual([h.qualifier, h.min_cents, h.max_cents, h.currency, h.currency_basis], ['range', 100_000_000, 200_000_000, null, 'heading_only']);
  assert.equal(readAmount('initial_cheque', '€1.5mm').point_cents, 150_000_000, 'mm is one unit, not two');
});

test('stage: a list gives one term per item, a range every round between its ends, broad terms stay broad, an unmapped wording is counted', async () => {
  assert.deepEqual(ROUND_STAGES, ['pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'growth']);
  for (const s of ROUND_STAGES) assert.ok((STAGES as readonly string[]).includes(s));
  assert.deepEqual(normaliseStage('Pre-Seed, Seed, Series A'), { terms: ['pre_seed', 'seed', 'series_a'], unmatched: [] });
  assert.deepEqual(normaliseStage('Seed to Series B'), { terms: ['seed', 'series_a', 'series_b'], unmatched: [] });
  assert.deepEqual(normaliseStage('Series B – Pre-seed'), { terms: ['pre_seed', 'seed', 'series_a', 'series_b'], unmatched: [] });
  assert.deepEqual(normaliseStage('Seed to Series Q'), { terms: ['seed'], unmatched: ['Series Q'] });
  assert.deepEqual(normaliseStage('Early stage'), { terms: ['early_stage'], unmatched: [] });
  assert.deepEqual(normaliseStage('Whenever the founders are ready'), { terms: [], unmatched: ['Whenever the founders are ready'] });

  const f = fixture();
  const w = await write(f, [
    { fund_uid: 'pinecrest-ii', fact: 'investment_stage', wording: 'Pre-Seed, Seed, Series A', source_name: CITE, source_record_ref: 's1' },
    { fund_uid: 'marrow-i', fact: 'investment_stage', wording: 'Early stage', source_name: CITE, source_record_ref: 's2' },
    { fund_uid: 'marrow-i', fact: 'investment_stage', wording: 'Whenever the founders are ready', source_name: OPEN, source_record_ref: 's3' },
  ]);
  assert.deepEqual(w.unmapped, { stage: 1, geography: 0 });
  const terms = f.db.prepare(`SELECT o.source_record_ref AS ref, t.term FROM research_fund_observation_terms t
    JOIN research_fund_observations o ON o.id = t.observation_id ORDER BY o.id, t.term`).all() as any[];
  assert.deepEqual(terms.map((t) => [t.ref, t.term]), [['s1', 'pre_seed'], ['s1', 'seed'], ['s1', 'series_a'], ['s2', 'early_stage']]);
  assert.equal(rows(f, "source_record_ref = 's3'")[0].wording, 'Whenever the founders are ready');
});

test('geography: a country, a region and an unknown place give one of each; the regions are research_countries\' seven', async () => {
  const check = sql('migrations/376_research_taxonomy.sql').match(/region TEXT NOT NULL CHECK \(region IN \(([^)]*)\)\)/)![1];
  assert.deepEqual([...RESEARCH_REGIONS].sort(), check.split(',').map((s) => s.trim().replace(/'/g, '')).sort());
  assert.deepEqual(normaliseGeography('Germany, Latin America, Atlantis'), { countries: ['DE'], regions: ['Latin America'], unmatched: ['Atlantis'] });
  assert.deepEqual(normaliseGeography('Europe').countries, [], 'a region is never expanded into countries');

  const f = fixture();
  const w = await write(f, [{ fund_uid: 'pinecrest-ii', fact: 'investment_geography', wording: 'Germany, Latin America, Atlantis', source_name: CITE, source_record_ref: 'g1' }]);
  assert.deepEqual(w.unmapped, { stage: 0, geography: 1 });
  assert.deepEqual(f.db.prepare('SELECT vocabulary, term FROM research_fund_observation_terms ORDER BY vocabulary').all().map((r: any) => [r.vocabulary, r.term]),
    [['country', 'DE'], ['region', 'Latin America']]);
});

test('a stage term on a description row, or a country term on a stage row, is refused; a statement keeps its fact', async () => {
  const f = fixture();
  await write(f, [
    { fund_uid: 'pinecrest-ii', fact: 'description', wording: 'An invented fund that backs seed rounds.', source_name: OPEN, source_record_ref: 'd1' },
    { fund_uid: 'pinecrest-ii', fact: 'investment_stage', wording: 'Seed', source_name: OPEN, source_record_ref: 'd2' },
  ]);
  const [desc, stage] = rows(f);
  assert.throws(() => f.db.prepare("INSERT INTO research_fund_observation_terms VALUES (?, 'stage', 'seed')").run(desc.id), /stage term needs an investment_stage/);
  assert.throws(() => f.db.prepare("INSERT INTO research_fund_observation_terms VALUES (?, 'country', 'DE')").run(stage.id), /country or region term/);
  assert.throws(() => f.db.prepare("UPDATE research_fund_observation_terms SET observation_id = ? WHERE observation_id = ?").run(desc.id, stage.id), /stage term needs/);
  assert.throws(() => f.db.prepare("UPDATE research_fund_observations SET fact = 'interests' WHERE id = ?").run(stage.id), /fact never changes/);
});

test('deleting the fund\'s directory row leaves its statements', async () => {
  const f = fixture();
  await write(f, [{ fund_uid: 'marrow-i', fact: 'manager_name', wording: 'Marrow Bay Partners', source_name: CITE, source_record_ref: 'm1' }]);
  f.db.exec("DELETE FROM research_fund_directory WHERE uid = 'marrow-i'");
  assert.equal(rows(f, "fund_uid = 'marrow-i'").length, 1);
});

test('the writer replaces a re-imported record and its terms rather than adding a row', async () => {
  const f = fixture();
  const one = { fund_uid: 'pinecrest-ii', fact: 'investment_stage' as const, source_name: CITE, source_record_ref: 'again' };
  await write(f, [{ ...one, wording: 'Seed' }]);
  await write(f, [{ ...one, wording: 'Series A' }]);
  assert.deepEqual(rows(f).map((r) => r.wording), ['Series A']);
  assert.deepEqual(f.db.prepare('SELECT term FROM research_fund_observation_terms').all().map((r: any) => r.term), ['series_a']);
});

test('the served read: a withdrawn list and a cite-only description are left out, the record reference never served, history apart, old rows as statements, moved uids one hop', async () => {
  const f = fixture();
  await write(f, [
    { fund_uid: 'pinecrest-ii', fact: 'manager_name', wording: 'Pinecrest Partners', source_name: DOWN, source_record_ref: 'x1' },
    { fund_uid: 'pinecrest-ii', fact: 'description', wording: 'An invented cite-only summary.', source_name: CITE, source_record_ref: 'x2' },
    { fund_uid: 'pinecrest-ii', fact: 'description', wording: 'An invented reusable summary.', source_name: OPEN, source_record_ref: 'x3', reported_on: '2026-05-01' },
    { fund_uid: 'pinecrest-ii', fact: 'stated_fund_capital', wording: '€40m', source_name: CITE, source_record_ref: 'x4', reported_on: '2021-03-01', period_start: '2021-01-01', period_end: '2021-12-31' },
    { fund_uid: 'pinecrest-old', fact: 'investment_stage', wording: 'Seed', source_name: CITE, source_record_ref: 'x5', reported_on: '2026-08-01' },
  ]);
  f.db.exec("INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES ('pinecrest-old','pinecrest-ii','2026-11-18')");
  f.db.exec(`INSERT INTO research_fund_vehicle_facts (fund_uid,field,value_text,min_cents,max_cents,currency,source_name,source_url,reported_on,imported_on) VALUES
    ('pinecrest-ii','initial_cheque',NULL,10000000,50000000,'EUR','${CITE}',NULL,NULL,'2026-10-04'),
    ('pinecrest-ii','investment_geography','Nordics',NULL,NULL,NULL,'${DOWN}',NULL,NULL,'2026-10-04')`);

  const got = (await readFundStatements(f.env, ['pinecrest-ii'])).get('pinecrest-ii')!;
  const brief = (s: any) => [s.origin, s.fact, s.wording, s.source_name];
  assert.deepEqual(got.current.map(brief), [
    ['statement', 'investment_stage', 'Seed', CITE],
    ['statement', 'description', 'An invented reusable summary.', OPEN],
    ['vehicle_fact', 'initial_cheque', null, CITE],
  ]);
  assert.deepEqual(got.current[0].terms, [{ vocabulary: 'stage', term: 'seed' }]);
  assert.deepEqual(got.current[2], {
    origin: 'vehicle_fact', fund_uid: 'pinecrest-ii', fact: 'initial_cheque', wording: null, source_name: CITE, source_url: null,
    verdict: 'cite only', reported_on: null, period_start: null, period_end: null, imported_on: '2026-10-04', method: null,
    qualifier: 'range', min_cents: 10_000_000, max_cents: 50_000_000, point_cents: null, currency: 'EUR', currency_basis: null,
    review_flags: null, terms: [],
  });
  assert.deepEqual(got.past.map(brief), [['statement', 'stated_fund_capital', '€40m', CITE]]);
  const served = JSON.stringify(got);
  for (const hidden of ['source_record_ref', 'promoted_by_user_id', 'x4', 'Pinecrest Partners', 'cite-only summary']) assert.ok(!served.includes(hidden), hidden);
  assert.equal((await readFundStatements(f.env, ['pinecrest-old'])).size, 0, 'a moved statement reads under its new uid only');
});

test('statement order: latest reported first, undated last, then latest imported, then list name', () => {
  const s = (reported_on: string | null, imported_on: string | null, source_name: string) => ({ reported_on, imported_on, source_name });
  const list = [s(null, '2026-11-02', 'B'), s('2025-01-01', '2026-11-01', 'B'), s('2026-01-01', '2026-11-01', 'B'),
    s('2025-01-01', '2026-11-03', 'B'), s('2025-01-01', '2026-11-03', 'A'), s(null, '2026-11-09', 'C')];
  assert.deepEqual([...list].sort(compareStatements), [
    s('2026-01-01', '2026-11-01', 'B'), s('2025-01-01', '2026-11-03', 'A'), s('2025-01-01', '2026-11-03', 'B'),
    s('2025-01-01', '2026-11-01', 'B'), s(null, '2026-11-09', 'C'), s(null, '2026-11-02', 'B'),
  ]);
});
