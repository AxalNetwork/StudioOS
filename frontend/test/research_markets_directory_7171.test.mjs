/**
 * D7171 (#7171) — Research › Markets, the directory and the investor view, to
 * the canvas D7036 (boards RMD-00 to RMD-14).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_markets_directory_7171.test.mjs
 *
 * Sample data below is fictional, as on the canvas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  DIRECTORY_TABS, PAGE_SIZE, THESIS_CROSSWALK, filterChips, marketListParams, marketsBackHref, patchMarketQuery,
  readMarketQuery, sectorHref, thesisFrom, thesisMatch, thesisMatchCount, writeMarketQuery,
} from '../src/pages/research/marketDirectoryQuery.js';
import {
  AnalysisView, DirectoryBody, ResultLine, ThesisSection, ageAt, groupPage, sourcesLine,
} from '../src/pages/research/MarketDirectory.jsx';
import MarketsBack from '../src/pages/research/MarketsBack.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
// &amp; is decoded last, so no entity is decoded twice (Code Scanning js/double-escaping).
const words = (markup) => String(markup).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const p = (s) => new URLSearchParams(s);

// Fictional markets. Read time 16 Nov 2026.
const READ_AT = '2026-11-16T09:40:00.000Z';
const STORAGE = {
  slug: 'energy-storage', name: 'Energy storage', mi_sector: 'Climate Intelligence', company_count: 7, supplied_count: 312, as_of: '2026-10-01',
  countries: { status: 'recorded', value: [{ code: 'DE', count: 4 }, { code: 'NL', count: 2 }, { code: 'DK', count: 1 }] },
  // D7710: the headline is the evidence naming the market; the four sector-level sources sit beside it.
  source_count: { status: 'recorded', value: 2 },
  newest_source_at: { status: 'recorded', value: '2026-11-10 08:00:00' },
  newest_source_basis: 'reported',
  distinct_source_count: { status: 'recorded', value: 6 },
  sources_by_kind: {
    market_intel: { count: 4, newest: { status: 'recorded', value: '2025-12-31' }, basis: 'period_measured' },
    signal_evidence: { count: 2, newest: { status: 'recorded', value: '2026-11-10 08:00:00' }, basis: 'reported' },
  },
  sources: [
    { kind: 'signal_evidence', key: 'storage-auctions', rows: 2, newest: '2026-11-10 08:00:00', basis: 'reported' },
    { kind: 'market_intel', key: 'grid-filings', rows: 3, newest: '2025-12-31', basis: 'period_measured' },
  ],
};
const OLD = {
  slug: 'energy-efficiency', name: 'Energy efficiency services', mi_sector: null, company_count: 1, supplied_count: 38, as_of: '2026-10-01',
  countries: { status: 'recorded', value: [{ code: 'DE', count: 1 }] },
  source_count: { status: 'recorded', value: 1 },
  newest_source_at: { status: 'recorded', value: '2026-07-03 10:00:00' },
  newest_source_basis: 'reported',
  distinct_source_count: { status: 'recorded', value: 1 },
  sources_by_kind: {
    market_intel: { count: 0, newest: { status: 'not_recorded', value: null, reason: 'No source of this kind' }, basis: null },
    signal_evidence: { count: 1, newest: { status: 'recorded', value: '2026-07-03 10:00:00' }, basis: 'reported' },
  },
  sources: [{ kind: 'signal_evidence', key: 'efficiency-news', rows: 1, newest: '2026-07-03 10:00:00', basis: 'reported' }],
};
const SPACE = {
  slug: 'space-hardware', name: 'Space hardware', mi_sector: 'Autonomous Robotics', company_count: 0, supplied_count: 80, as_of: '2026-10-01',
  countries: { status: 'not_recorded', value: null, reason: 'No company in the directory is placed in this market' },
  // D7710: only inherited sector sources, so none named and no band.
  source_count: { status: 'not_recorded', value: null, reason: 'None named: no evidence behind an active signal names this market' },
  newest_source_at: { status: 'not_recorded', value: null, reason: 'None named: no evidence behind an active signal names this market' },
  newest_source_basis: null,
  distinct_source_count: { status: 'recorded', value: 3 },
  sources_by_kind: {
    market_intel: { count: 3, newest: { status: 'recorded', value: '2026-11-14T00:00:00Z' }, basis: 'retrieved' },
    signal_evidence: { count: 0, newest: { status: 'not_recorded', value: null, reason: 'No source of this kind' }, basis: null },
  },
  sources: [],
};
const DATA = { items: [STORAGE, OLD, SPACE], total: 82, directory_total: 82, offset: 0, limit: 25, read_at: READ_AT };
const ready = (data) => ({ status: 'ready', data });

// ---- The URL ---------------------------------------------------------------------

test('RMD-00: every view is a link; unreadable values fall back; defaults stay out of the URL', () => {
  const v = readMarketQuery(p('tab=listed&q=energy&country=de&country=NL,xx1&fresh=30&src=named&sort=newest_source:desc&view=cards&group=1&page=2&open=energy-storage&thesis=1'));
  assert.deepEqual(v, {
    tab: 'listed', q: 'energy', sort: 'newest_source:desc', view: 'cards', country: ['DE', 'NL'], fresh: '30', src: 'named',
    page: 2, grouped: true, open: 'energy-storage', thesis: true,
  });
  const bad = readMarketQuery(p('tab=gov&fresh=7&src=all&view=chart&page=-3&open=../x&country=Germany'));
  assert.deepEqual([bad.tab, bad.fresh, bad.src, bad.view, bad.page, bad.open, bad.country], ['directory', '', '', 'table', 1, '', []]);
  assert.equal(writeMarketQuery(p('keep=1'), readMarketQuery(p(''))).toString(), 'keep=1');
  assert.equal(writeMarketQuery(p(''), v).toString(),
    'tab=listed&q=energy&country=DE&country=NL&fresh=30&src=named&sort=newest_source%3Adesc&view=cards&group=1&page=2&open=energy-storage&thesis=1');
  assert.deepEqual(DIRECTORY_TABS.map((t) => t.label), ['Market directory', 'Listed companies']);
});

test('a change to what the list holds starts at page 1 and closes the row; a change of view keeps both', () => {
  const v = readMarketQuery(p('page=3&open=energy-storage'));
  assert.deepEqual([patchMarketQuery(v, { fresh: '30' }).page, patchMarketQuery(v, { fresh: '30' }).open], [1, '']);
  assert.deepEqual([patchMarketQuery(v, { view: 'cards' }).page, patchMarketQuery(v, { view: 'cards' }).open], [3, 'energy-storage']);
});

test('the Worker does the filtering: the view becomes one paged request, the thesis sectors only when asked', () => {
  const v = readMarketQuery(p('q=energy&country=DE&country=NL&fresh=30&page=3&sort=name:asc'));
  assert.deepEqual(marketListParams(v, ['Climate Intelligence']), {
    q: 'energy', sort: 'name', dir: 'asc', country: 'DE,NL', fresh: '30', src: undefined, sector: undefined,
    limit: PAGE_SIZE, offset: 2 * PAGE_SIZE,
  });
  const t = marketListParams(readMarketQuery(p('thesis=1')), ['Climate Intelligence', 'Autonomous Robotics']);
  assert.equal(t.sector, 'Climate Intelligence,Autonomous Robotics');
  assert.equal(t.offset, undefined, 'page 1 sends no offset');
  // Mutation checked: re-filtering in the browser again → the page source filters rows itself.
  const src = codeOnly(read('frontend/src/pages/research/MarketDirectory.jsx'));
  assert.doesNotMatch(src, /items\s*\.filter\(/, 'the page never re-filters the Worker\'s rows');
  assert.doesNotMatch(src, /items\s*\.sort\(/, 'nor re-sorts them');
});

test('RMD-05: the sector link carries the view with the row open; Back can only ever be the Markets directory', () => {
  const v = readMarketQuery(p('q=energy&country=DE&fresh=30'));
  assert.equal(sectorHref(STORAGE, v),
    '/research/markets/sector/climate-intelligence?market=energy-storage&from=q%3Denergy%26country%3DDE%26fresh%3D30%26open%3Denergy-storage');
  assert.equal(sectorHref(OLD, v).split('?')[0], '/research/markets/sector/energy-efficiency', 'an unmapped market opens its own page');
  const back = marketsBackHref('q=energy&country=DE&fresh=30&open=energy-storage');
  assert.equal(back.href, '/research/markets?q=energy&country=DE&fresh=30&open=energy-storage');
  assert.equal(back.words, '“energy” · Germany · named evidence, reported in the last 30 days');
  // Mutation checked: return `from` as is → the link leaves the directory.
  assert.equal(marketsBackHref('https://example.org/x').href, '/research/markets');
  assert.equal(marketsBackHref('//example.org').href, '/research/markets');
  assert.equal(marketsBackHref(null).href, '/research/markets');
  const markup = at('/research/markets/sector/climate-intelligence?from=q%3Denergy%26open%3Denergy-storage', h(MarketsBack));
  assert.match(markup, /href="\/research\/markets\?q=energy&amp;open=energy-storage"/);
  assert.match(words(markup), /Back to Markets · “energy”/);
});

test('the sector pages draw the Back link, and the redirect from a market keeps the view', () => {
  assert.match(read('frontend/src/pages/research/SectorProfile.jsx'), /<MarketsBack className="mb-3" \/>/);
  assert.match(read('frontend/src/pages/research/SectorProfile.jsx'), /&from=\$\{encodeURIComponent\(from\)\}#/);
  assert.match(read('frontend/src/pages/research/MarketSectorProfile.jsx'), /<MarketsBack \/>/);
});

test('active filters are chips, each removing only itself', () => {
  const chips = filterChips(readMarketQuery(p('q=energy&country=DE&country=NL&fresh=30')));
  assert.deepEqual(chips.map((c) => c.label), ['Search: energy', 'Country: Germany', 'Country: Netherlands', 'Named evidence: reported in the last 30 days']);
  assert.deepEqual(chips[1].patch, { country: ['NL'] });
});

// ---- The row ---------------------------------------------------------------------

test('RMD-01: five columns; ages from the read time; Stale past 90 days; Not recorded with the Worker\'s reason', () => {
  const view = readMarketQuery(p(''));
  const t = words(at('/research/markets', h(DirectoryBody, { markets: ready(DATA), view, onPatch: () => {} })));
  for (const col of ['Market and tracked sector', 'Taxonomy company count not market size', 'Countries represented', 'Sources naming it', 'Latest source']) {
    assert.ok(t.includes(col), col);
  }
  // D7710: the named count leads, the inherited count beside it; Latest says what its date measures.
  assert.match(t, /Energy storage Tracked sector Climate Intelligence 312 DE 4 · NL 2 · DK 1 3 countries 2 name this market · 4 sector-level, inherited 2026-11-10 6 days ago · date the source reports/);
  assert.match(t, /Energy efficiency services Not mapped yet · no tracked sector 38/);
  assert.match(t, /2026-07-03 135 days ago · date the source reports Stale · 135 days/);
  assert.match(t, /Not recorded · No company in the directory is placed in this market/);
  assert.match(t, /None named 3 sector-level, inherited Not recorded · None named/, 'a market with only inherited sources reads none named');
  assert.doesNotMatch(t, /Your thesis/, 'no thesis column without a thesis');
  assert.match(t, /1–3 of 82 Previous Next/);
  assert.equal(ageAt('2026-07-03 10:00:00', READ_AT), 135);
  assert.deepEqual(sourcesLine(SPACE), { head: 'None named', named: 0, sub: '3 sector-level, inherited' });
  assert.deepEqual(sourcesLine(OLD), { head: '1', named: 1, sub: 'names this market · 0 sector-level, inherited' });
});

test('RMD-04: the open row tells sector-level sources from evidence naming the market, and says what the count is not', () => {
  const view = readMarketQuery(p('open=energy-storage'));
  const markup = at('/research/markets?open=energy-storage', h(DirectoryBody, { markets: ready(DATA), view, onPatch: () => {} }));
  assert.match(markup, /aria-expanded="true" aria-controls="market-details-energy-storage"/);
  const t = words(markup);
  assert.match(t, /Germany 4 companies Netherlands 2 companies Denmark 1 company/);
  // D7710: evidence naming the market first; an annual sector figure shows the year it measures.
  assert.match(t, /Sources · 6 distinct Names this market 2 storage-auctions reported 2026-11-10 Sector-level, inherited 4 grid-filings period 2025/);
  assert.match(t, /It is a count of companies, not the size of the market\. Taxonomy as of 2026-10-01\./);
  assert.match(t, /Market size and growth Not recorded · No source we hold records market size or growth/);
  assert.match(t, /Open sector Climate Intelligence →/);
  assert.match(t, /Sources are listed up to 20; the count includes all of them/, 'six counted, two listed');
  assert.equal((markup.match(/data-testid="market-details"/g) || []).length, 2, 'once in the table, once in the phone cards');
});

test('Q2 A: grouping is a toggle over the page, the unmapped last', () => {
  assert.deepEqual(groupPage([OLD, STORAGE, SPACE]).map((g) => [g.sector, g.markets.length]),
    [['Autonomous Robotics', 1], ['Climate Intelligence', 1], [null, 1]]);
  const t = words(at('/research/markets?group=1', h(DirectoryBody, { markets: ready(DATA), view: readMarketQuery(p('group=1')), onPatch: () => {} })));
  assert.match(t, /Not mapped yet · 1 on this page/);
});

test('RMD-02: the result line says what q matched on, over the whole directory', () => {
  const t = words(at('/', h(ResultLine, { data: { ...DATA, total: 6, matched_on: { name: 3, sector: 3 } }, view: readMarketQuery(p('q=energy')) })));
  assert.equal(t, '6 markets match “energy” · Matched on the market name (3) or its tracked sector (3)');
  const all = words(at('/', h(ResultLine, { data: { ...DATA, summary: { supplied_total: 9640 } }, view: readMarketQuery(p('')) })));
  assert.equal(all, '82 markets · 9,640 companies as the taxonomy counts them · Count and sort cover all 82 markets, then the page shows 25');
});

test('RMD-06B: Analysis is dated coverage from the summary, both country reasons apart, no size or growth', () => {
  const summary = {
    markets: 82, supplied_total: 9640, fresh: { 30: 48, 90: 6, older: 7, none: 21 },
    countries: { recorded: 66, no_company: 9, no_placeable_country: 7, distinct: 23 }, tracked: { mapped: 74, unmapped: 8 },
    by_sector: [{ sector: 'Climate Intelligence', markets: 9, sector_sources: 4, newest_sector_source: { status: 'recorded', value: '2026-06-18T00:00:00Z' }, newest_sector_basis: 'retrieved', named_markets: 2 }],
    unmapped: { markets: 8, named_markets: 1 }, stale_days: 90,
  };
  const t = words(at('/', h(AnalysisView, { summary, readAt: READ_AT, asOf: '2026-10-01' })));
  assert.match(t, /Documented coverage of the 82 markets · read 2026-11-16 · taxonomy as of 2026-10-01 · counts, not market size or growth/);
  assert.match(t, /Last 30 days 48 31 to 90 days 6 Older than 90 days · Stale 7 None named \(Not recorded\) 21/);
  assert.match(t, /markets have dated evidence that names them, by the date its source reports\. Inherited sector sources set no band\./);
  assert.match(t, /No company placed \(Not recorded\) 9 No placeable country \(Not recorded\) 7/);
  assert.match(t, /Climate Intelligence 9 4 retrieved 2026-06-18 Stale · 151 days 2/);
  assert.match(t, /Not mapped yet 8 Not applicable Not applicable 1/);
});

test('states: loading, a failed read keeps the filters, an empty directory, and zero results with Clear filters', () => {
  const view = readMarketQuery(p('q=space&country=JP'));
  const body = (markets) => words(at('/', h(DirectoryBody, { markets, view, onPatch: () => {} })));
  assert.match(body({ status: 'loading', data: null }), /Reading the markets…/);
  const failed = body({ status: 'unreadable', data: null, reload: () => {} });
  assert.match(failed, /The markets could not be read\. This is not a sign there are none\. Your search and filters are kept\./);
  assert.doesNotMatch(failed, /No market/);
  assert.match(body(ready({ total: 0, directory_total: 0, items: [] })), /No markets are in the directory yet\. .* Open Listed companies/);
  assert.match(body(ready({ total: 0, directory_total: 82, items: [] })), /No market matches “space” in Japan\. A market whose countries are Not recorded cannot match a country\./);
});

// ---- The investor's thesis -------------------------------------------------------

test('Q1 A: a market matches only through the published crosswalk; keywords never match', () => {
  assert.deepEqual(thesisFrom({ thesis_text: '', sectors: [] }), { kind: 'none' });
  const t = thesisFrom({ thesis_text: 'Seed-stage energy software', sectors: ['Climate', 'Energy', 'Robotics', 'Consumer'], stages: ['Seed'], thesis_keywords: ['space'] });
  assert.equal(t.kind, 'set');
  assert.deepEqual(t.tracked, ['Climate Intelligence', 'Autonomous Robotics']);
  assert.deepEqual(thesisMatch(STORAGE, t), { kind: 'match', through: ['Climate', 'Energy'] });
  assert.deepEqual(thesisMatch(OLD, t), { kind: 'no_sector' }, 'an unmapped market cannot match');
  assert.deepEqual(thesisMatch({ ...SPACE, mi_sector: 'DevTools' }, t), { kind: 'no_match' });
  // Every crosswalk target is a tracked sector the Worker knows.
  const SECTORS = read('cloudflare-worker/src/services/market_intel/aggregator.ts');
  for (const target of Object.values(THESIS_CROSSWALK).flat()) assert.ok(SECTORS.includes(`'${target}'`), target);
  // Every profile option is in the crosswalk, even when it maps to nothing.
  const OPTIONS = read('cloudflare-worker/src/routes/investor_signals.ts').match(/const SECTOR_OPTIONS = \[([^\]]+)\]/)[1];
  for (const opt of OPTIONS.match(/'[^']+'/g).map((s) => s.slice(1, -1))) assert.ok(opt in THESIS_CROSSWALK, opt);
  assert.equal(thesisMatchCount({ by_sector: [{ sector: 'Climate Intelligence', markets: 9 }, { sector: 'DevTools', markets: 7 }] }, t), 9);
});

test('RMD-08: the match marker only on a real match; a thesis column only with a thesis', () => {
  const t = thesisFrom({ thesis_text: 'x', sectors: ['Energy'] });
  const markup = at('/', h(DirectoryBody, { markets: ready(DATA), view: readMarketQuery(p('')), onPatch: () => {}, thesis: t }));
  const w = words(markup);
  assert.match(w, /Your thesis/);
  // The table and the phone cards each mark the one match.
  assert.equal((markup.match(/data-testid="thesis-match"/g) || []).length, 2);
  assert.match(w, /✓ Matches your thesis sectors via Energy/);
  assert.match(w, /Not a thesis sector/);
  assert.match(w, /No tracked sector · no match is possible/);
});

test('RMD-08B/C: no thesis and an unreadable thesis are their own states; neither claims nothing matches', () => {
  const none = words(at('/', h(ThesisSection, { read: { status: 'ready', thesis: { kind: 'none' } } })));
  assert.match(none, /No thesis on your profile yet\. The directory works without one/);
  const bad = words(at('/', h(ThesisSection, { read: { status: 'unreadable' }, onRetry: () => {} })));
  assert.match(bad, /Unavailable Your investor profile could not be read, so no thesis matches are shown\. This is not a claim that nothing matches\. Retry/);
  const set = words(at('/', h(ThesisSection, {
    read: { status: 'ready', thesis: thesisFrom({ thesis_text: 'Industrial software', sectors: ['Energy', 'Defense'], stages: ['Seed'] }) },
    matchCount: 14, total: 82,
  })));
  assert.match(set, /How a match is made A market matches only when its tracked sector is one of your profile sectors: Energy → Climate Intelligence\. Keywords and geographies never make a match\. Defense maps to no tracked sector\./);
  assert.match(set, /14 of 82 markets match your thesis sectors Show only markets that match/);
  assert.match(set, /Market readings price an advisor’s service line and are not shown to an investor/);
});

test('RS-17: an investor is neither shown the readings nor offered the form; others keep them', () => {
  const src = codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx'));
  // Mutation checked: `showReadings = true` → an investor sees the readings card again.
  assert.match(src, /const showReadings = role !== 'investor';/);
  assert.match(src, /\{showReadings \? \(\s*<Readings/);
  assert.match(src, /showReadings \? api\.research\.marketReadings\(\) : Promise\.resolve/, 'nor is the list read for them');
});
