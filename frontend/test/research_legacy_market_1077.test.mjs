/**
 * #1077 (D533) — a market no tracked sector claims draws the Worker's answer.
 *
 * 68 of the 82 markets have no market-intelligence sector (migration 376), so
 * `/research/markets/sector/:slug` renders `LegacyMarketView` for them. It used
 * to read the bundled `marketDirectory.json` and make two calls of its own; it
 * now renders the `GET /api/research/markets/:slug` payload `resolveSectorPage`
 * already read, so it has no failure state of its own and no bundle.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_legacy_market_1077.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { LegacyMarketView } from '../src/pages/research/MarketSectorProfile.jsx';
import { resolveSectorPage } from '../src/pages/research/SectorProfile.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
/** What a reader sees, each tag read as a space (as research_markets_d593.test.mjs does). */
function words(markup) {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const text = (el) => words(html(el));

/** `GET /api/research/markets/fintech`, for a market with no tracked sector. */
const MARKET = {
  item: { slug: 'fintech', name: 'FinTech', supplied_count: 2140, as_of: '2026-09-30', supplied_label: 'Supplied by Axal for discovery; not independently verified.' },
  sector: { mi_sector: null, method: 'manual', note: null },
  index: { sector: null, reason: 'This market has no market-intelligence sector yet', series: {}, source_mix: [] },
  company_count: 3,
  companies: [
    { uid: 'Q1', name: 'Ledgerly', sector: 'financial services', country: 'France', country_code: 'FR' },
    { uid: 'Q2', name: 'Paycraft', sector: 'fintech', country: 'Germany', country_code: 'DE' },
  ],
  companies_by_country: [{ code: 'FR', name: 'France', count: 2 }, { code: null, name: null, count: 1 }],
  fund_count: 4,
  funds: [{ uid: 'f1', name: 'Northwind Ventures', hq: 'Paris' }],
  signals: [{ id: 's1', title: 'Embedded payments', thesis: 'Every SaaS sells payments.', why_now: 'Open banking', confidence_score: 70, updated_at: '2026-10-01' }],
  sub_markets: { company_sectors: [{ label: 'financial services', count: 2 }, { label: 'fintech', count: 1 }], fund_focus: [] },
};

test('the page draws the Worker\'s market: its name, the supplied count as supplied, and what the crosswalk maps here', () => {
  const t = text(h(LegacyMarketView, { market: MARKET }));
  assert.match(t, /FinTech/);
  assert.match(t, /Supplied count 2,140 Supplied by Axal for discovery; not independently verified\. As of 2026-09-30\./);
  assert.match(t, /Directory companies 3 Mapped by the crosswalk\./);
  assert.match(t, /Market size Not recorded/);
  assert.match(t, /Tracked sector Not recorded This market has no market-intelligence sector yet/);
  assert.match(t, /Showing 2 of 3\./, 'the count is the Worker\'s total, not the rows drawn');
  assert.match(t, /France · 2/);
  assert.match(t, /Country not recorded · 1/);
  assert.match(t, /Showing 1 of 4\./);
  assert.match(t, /Embedded payments/);
  assert.match(t, /Why now: Open banking · Confidence 70%/);
  assert.match(t, /financial services \(2\), fintech \(1\)/);
  const markup = html(h(LegacyMarketView, { market: MARKET }));
  assert.match(markup, /href="\/research\/companies\/company\/Q1"/);
  assert.match(markup, /href="\/research\/geographies\/FR"/);
  assert.match(markup, /href="\/research\/funds\/catalog\/f1"/);
});

test('an empty market says what is empty, and never draws growth or risk', () => {
  const empty = { ...MARKET, company_count: 0, companies: [], companies_by_country: [], fund_count: 0, funds: [], signals: [], sub_markets: { company_sectors: [], fund_focus: [] } };
  const markup = html(h(LegacyMarketView, { market: empty }));
  assert.match(markup, /data-testid="legacy-market-no-companies"/);
  assert.match(markup, /data-testid="legacy-market-no-funds"/);
  assert.match(markup, /data-testid="legacy-market-no-signals"/);
  assert.doesNotMatch(markup, /legacy-market-company-count/);
  const t = words(markup);
  assert.doesNotMatch(t, /Growth direction|Risk\b/, 'growth and risk have no store per market');
  assert.doesNotMatch(markup, /text-red-700/, 'no raw red error text: a failed read is the resolver\'s Unreadable');
  const noCount = text(h(LegacyMarketView, { market: { ...MARKET, item: { ...MARKET.item, supplied_count: null } } }));
  assert.match(noCount, /Supplied count Not recorded/);
});

test('the resolver hands the legacy page the market it read, and a failed read is never "missing"', async () => {
  const notFound = Object.assign(new Error('nf'), { status: 404 });
  const sectors = { get: async () => { throw notFound; } };
  const r = await resolveSectorPage('fintech', sectors, { get: async () => MARKET });
  assert.equal(r.kind, 'legacy');
  assert.equal(r.market, MARKET);
  await assert.rejects(() => resolveSectorPage('fintech', sectors, { get: async () => { throw Object.assign(new Error('x'), { status: 503 }); } }));
  assert.match(codeOnly(read('frontend/src/pages/research/SectorProfile.jsx')),
    /if \(state\.kind === 'legacy'\) return <LegacyPage role=\{role\} market=\{state\.market\} \/>/);
});

test('no page reads the bundled market directory, and the bundle is gone', () => {
  const src = codeOnly(read('frontend/src/pages/research/MarketSectorProfile.jsx'));
  assert.doesNotMatch(src, /marketDirectory\.json/);
  assert.doesNotMatch(src, /api\.signals\.list|companyDirectory\(/, 'the page makes calls of its own again');
  assert.equal(existsSync(resolve(ROOT, 'frontend/src/data/marketDirectory.json')), false);
});
