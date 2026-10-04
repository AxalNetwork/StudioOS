/**
 * D533 — the Research crosswalk (services/researchTaxonomy.ts, migration 376).
 *
 * Each mapping rule answers with its provenance, an unknown value stays
 * unmapped, and a hand-made override wins over the rule. The D1 half runs
 * migration 376 itself on real SQLite, so the tables the service reads are the
 * ones the migration creates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';

import {
  COMPANY_SECTOR_RULES, COUNTRY_ALIASES, FUND_FOCUS_RULES,
  listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector,
  focusTokens, mapFundFocus, mapFundHq, mapSignalTags, marketSectorFor, normalizeLabel,
} from '../src/services/researchTaxonomy.ts';
import { SECTORS } from '../src/services/market_intel/aggregator.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/376_research_taxonomy.sql'), 'utf8');
const MARKETS: { slug: string }[] = JSON.parse(
  readFileSync(resolve(ROOT, 'frontend/src/data/marketDirectory.json'), 'utf8'),
).items;
const SLUGS = new Set(MARKETS.map((m) => m.slug));

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  return db;
}
const envOver = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;

// --- the dictionaries point at things that exist --------------------------------

test('every rule target is one of the 82 market slugs', () => {
  for (const [label, slug] of Object.entries(COMPANY_SECTOR_RULES)) {
    assert.ok(SLUGS.has(slug), `company sector "${label}" → unknown market "${slug}"`);
  }
  for (const [token, slugs] of Object.entries(FUND_FOCUS_RULES)) {
    assert.ok(slugs.length > 0, `fund focus "${token}" maps to nothing`);
    for (const slug of slugs) assert.ok(SLUGS.has(slug), `fund focus "${token}" → unknown market "${slug}"`);
  }
});

test('dictionary keys are already normalised, so every one can match', () => {
  for (const key of [...Object.keys(COMPANY_SECTOR_RULES), ...Object.keys(FUND_FOCUS_RULES), ...Object.keys(COUNTRY_ALIASES)]) {
    assert.equal(normalizeLabel(key), key, `"${key}" can never match: lookups normalise first`);
  }
});

test('every alias code is a row of research_countries', async () => {
  const codes = new Set((await listCountries(envOver(freshDb()))).map((c) => c.code));
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    assert.ok(codes.has(code), `"${alias}" → ${code}, which migration 376 does not seed`);
  }
});

test('research_market_sectors names each market slug once, and only the 12 sectors', async () => {
  const rows = await listMarketSectors(envOver(freshDb()));
  assert.deepEqual(rows.map((r) => r.market_slug).sort(), [...SLUGS].sort());
  const sectors = new Set<string>(SECTORS);
  for (const r of rows) {
    if (r.mi_sector !== null) assert.ok(sectors.has(r.mi_sector), `${r.market_slug} → "${r.mi_sector}" is not a sector`);
    assert.equal(r.method, 'manual');
  }
  assert.ok(rows.some((r) => r.mi_sector === null), 'some markets have no sector, and must say so');
});

test('marketSectorFor: a mapped slug, an unmapped slug, an unknown slug', async () => {
  const env = envOver(freshDb());
  assert.equal((await marketSectorFor(env, 'fintech'))?.mi_sector, 'Fintech / DeFi');
  const none = await marketSectorFor(env, 'fashion');
  assert.ok(none, 'fashion has a row');
  assert.equal(none!.mi_sector, null);
  assert.equal(await marketSectorFor(env, 'no-such-market'), null);
});

// --- sectors -----------------------------------------------------------------

test('a company sector maps by exact label, case and hyphens ignored, with provenance', () => {
  assert.deepEqual(mapCompanySector('Automotive Industry'), {
    raw: 'Automotive Industry', targets: ['autotech'], method: 'rule', rule: 'COMPANY_SECTOR_RULES', unmatched: [],
  });
  assert.deepEqual(mapCompanySector('E-commerce').targets, ['e-commerce']);
});

test('an unknown or partial company sector stays unmapped — no substring guessing', () => {
  for (const raw of ['conglomerate', 'public company', 'automotive', 'software industry and more', '', null]) {
    const m = mapCompanySector(raw);
    assert.deepEqual(m.targets, [], `"${raw}" was mapped to ${m.targets}`);
    assert.equal(m.method, null);
    assert.equal(m.rule, null);
  }
});

test('a fund focus list maps each token, unions the markets, and reports the rest', () => {
  const m = mapFundFocus('B2B · Fintech-&-Data · SaaS · Climate-Tech · Procurement-Genius');
  assert.deepEqual(m.targets, ['climatetech-cleantech', 'saas']);
  assert.equal(m.method, 'rule');
  // "B2B" is listed as not-a-market, so it is not reported as unknown.
  assert.deepEqual(m.unmatched, ['Fintech-&-Data', 'Procurement-Genius']);
  assert.deepEqual(mapFundFocus('Food & Ag').targets, ['agtech', 'food-and-beverage']);
});

test('Generalist and unknown focus values stay unmapped', () => {
  const g = mapFundFocus('Generalist');
  assert.deepEqual([g.targets, g.method, g.unmatched], [[], null, []]);
  const u = mapFundFocus('Death-tech · Psychedelics');
  assert.deepEqual([u.targets, u.method, u.unmatched], [[], null, ['Death-tech', 'Psychedelics']]);
  assert.deepEqual(mapFundFocus(null).targets, []);
});

// --- countries ----------------------------------------------------------------

test('a company country name maps to one ISO code', () => {
  assert.deepEqual(mapCompanyCountry('United Kingdom'), {
    raw: 'United Kingdom', targets: ['GB'], method: 'rule', rule: 'COUNTRY_ALIASES', unmatched: [],
  });
  assert.deepEqual(mapCompanyCountry("People's Republic of China").targets, ['CN']);
  assert.deepEqual(mapCompanyCountry('Colorado').targets, ['US']);
});

test('regions, placeholders and unknown places stay unmapped', () => {
  for (const raw of ['Not recorded', 'Nordic countries', 'Central America', 'Global', 'Multiple cities', 'Atlantis', 'Cambridge', null]) {
    const c = mapCompanyCountry(raw);
    assert.deepEqual([c.targets, c.method], [[], null], `company "${raw}"`);
    const h = mapFundHq(raw);
    assert.deepEqual([h.targets, h.method], [[], null], `fund "${raw}"`);
  }
});

test('a company country naming two countries is not resolved', () => {
  const m = mapCompanyCountry('Israel, UK');
  assert.deepEqual([m.targets, m.method], [[], null]);
});

test('a fund HQ maps every country it names, and reports the pieces it could not place', () => {
  assert.deepEqual(mapFundHq('Bay Area, NYC, Israel').targets, ['IL', 'US']);
  assert.deepEqual(mapFundHq('Seattle, USA / India').targets, ['IN', 'US']);
  assert.deepEqual(mapFundHq('Madrin, Spain and San Francisco').targets, ['ES', 'US']);
  assert.deepEqual(mapFundHq('US (Minneapolis and North Dakota)').targets, ['US']);
  assert.deepEqual(mapFundHq('Manchester, NH').targets, ['US'], 'whole-string alias, not Manchester UK');
  const c = mapFundHq('Cambridge, NYC');
  assert.deepEqual([c.targets, c.unmatched], [['US'], ['Cambridge']]);
  assert.deepEqual(mapFundHq('UK').targets, ['GB']);
});

// --- overrides ------------------------------------------------------------------

test('a hand-made override wins over the rule, and an empty target pins a value unmapped', async () => {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO research_taxonomy_overrides (kind, raw_value, target, note) VALUES (?, ?, ?, ?)');
  ins.run('company_sector', 'conglomerate', 'general-tech', 'reviewed by hand');
  ins.run('company_sector', 'retail', '', 'pinned unmapped');
  ins.run('fund_hq', 'Global', 'US', null);
  ins.run('fund_hq', 'Global', 'GB', null);
  const ov = await loadOverrides(envOver(db));

  assert.deepEqual(mapCompanySector('conglomerate', ov), {
    raw: 'conglomerate', targets: ['general-tech'], method: 'manual',
    rule: 'research_taxonomy_overrides:company_sector', unmatched: [],
  });
  const pinned = mapCompanySector('retail', ov);
  assert.deepEqual([pinned.targets, pinned.method], [[], 'manual']);
  assert.deepEqual(mapFundHq('Global', ov).targets.sort(), ['GB', 'US']);
  // An override for one kind does not leak into another.
  assert.deepEqual(mapCompanySector('Global', ov).targets, []);
  assert.deepEqual(mapCompanySector('retail').targets, ['retail'], 'without overrides the rule still answers');
});

test('the override table refuses a rule-made row and an unknown kind', () => {
  const db = freshDb();
  assert.throws(() => db.exec(`INSERT INTO research_taxonomy_overrides (kind, raw_value, target, method) VALUES ('fund_hq','x','US','rule')`));
  assert.throws(() => db.exec(`INSERT INTO research_taxonomy_overrides (kind, raw_value, target) VALUES ('sector','x','US')`));
  assert.throws(() => db.exec(`INSERT INTO research_countries (code, name, region) VALUES ('usa','x','Europe')`));
});

test('migration 376 runs twice without error (IF NOT EXISTS / OR IGNORE)', () => {
  const db = freshDb();
  db.exec(MIGRATION);
  const n = db.prepare('SELECT COUNT(*) AS n FROM research_market_sectors').get() as { n: number };
  assert.equal(n.n, 82);
});

test('a signal maps through its tags, never its broad sector; bad JSON stays unmapped', () => {
  const m = mapSignalTags('["payments","cross-border","fintech"]');
  assert.deepEqual([m.targets, m.method, m.unmatched], [['fintech', 'payments'], 'rule', ['cross-border']]);
  assert.deepEqual(mapSignalTags('["vertical-saas"]').targets, []);
  for (const raw of ['not json', '{"a":1}', '', null]) {
    const u = mapSignalTags(raw);
    assert.deepEqual([u.targets, u.method], [[], null], String(raw));
  }
});

test('a focus list splits on " · " (migration 365) and on ", " (migration 378)', () => {
  assert.deepEqual(focusTokens('Ed-Tech, E-Commerce, AI'), ['Ed-Tech', 'E-Commerce', 'AI']);
  assert.deepEqual(focusTokens('B2B · Fintech'), ['B2B', 'Fintech']);
  assert.deepEqual(focusTokens(null), []);
  assert.deepEqual(mapFundFocus('Ed-Tech, E-Commerce, AI, Cybersecurity, Fintech').targets,
    ['ai', 'cybersecurity', 'e-commerce', 'education', 'fintech']);
  assert.deepEqual(mapFundFocus('Crypto, Web3, Blockchain').targets, ['web3-blockchain', 'web3-crypto']);
});
