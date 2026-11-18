/**
 * D7171 part 2 (#7171) — Research › Markets: the header ops, the phone
 * Filters sheet and thesis strip, and the Partial state, to the canvas D7036
 * (boards RMD-01, RMD-08, RMD-09B, RMD-11).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_markets_part2_7171.test.mjs
 *
 * Sample data below is fictional.
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

import { marketListParams, readMarketQuery, thesisFrom } from '../src/pages/research/marketDirectoryQuery.js';
import {
  EXPORT_MAX, EXPORT_PAGE, THESIS_EDIT, exportControl, marketCsvHeader, marketCsvRow, newMarketResearchHref,
  readWholeView, researchSubject, runViewExport,
} from '../src/pages/research/marketDirectoryExport.js';
import {
  COUNTRIES_SHOWN, FiltersSheetBody, ThesisStrip, draftCountParams, sheetFilterCount, showLabel,
} from '../src/pages/research/MarketDirectoryPhone.jsx';
import MarketDirectoryPanel, { ThesisImpossible, ThesisPartial, thesisGate } from '../src/pages/research/MarketDirectory.jsx';
import { FOUNDER_ZONE_ACTIONS, founderZoneActions } from '../src/workspaces/founderZoneActions.js';
import { INVESTOR_ZONE_ACTIONS, investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import { ADVISOR_ZONE_ACTIONS } from '../src/workspaces/advisorZoneActions.js';
import { PARTNER_ZONE_ACTIONS } from '../src/workspaces/partnerZoneActions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const words = (markup) => String(markup).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const p = (s) => new URLSearchParams(s);

const READ_AT = '2026-11-16T09:40:00.000Z';
const market = (i, extra = {}) => ({
  slug: `m-${i}`, name: `Market ${i}`, mi_sector: 'Climate Intelligence', supplied_count: 10 + i,
  countries: { status: 'recorded', value: [{ code: 'DE', count: 2 }, { code: 'NL', count: 1 }] },
  source_count: { status: 'recorded', value: 3 },
  newest_source_at: { status: 'recorded', value: '2026-11-06T09:40:00Z' },
  sources_by_kind: { market_intel: { count: 2 }, signal_evidence: { count: 1 } },
  ...extra,
});
const BARE = market(0, {
  mi_sector: null,
  countries: { status: 'not_recorded', value: null, reason: 'No company placed' },
  source_count: { status: 'not_recorded', value: null, reason: 'No live source yet' },
  newest_source_at: { status: 'not_recorded', value: null, reason: 'No live source yet' },
});
const PROFILE = { thesis_text: 'Industrial software for operators.', sectors: ['Climate', 'Defense'], stages: ['Seed'], geos: ['DACH'], anti_thesis_sectors: [] };

/** A fake Worker: `total` markets, answering each request with its slice, and recording what it was asked. */
function worker(total) {
  const calls = [];
  const all = Array.from({ length: total }, (_, i) => market(i + 1));
  const list = async (params) => {
    calls.push(params);
    const off = params.offset || 0;
    return { items: all.slice(off, off + params.limit), total, read_at: READ_AT };
  };
  return { list, calls };
}

// ---- The header ops (RMD-01, RMD-08) ----------------------------------------------

test('the Markets header is the D7036 header on every licence: Export view, then New market research or Edit thesis', () => {
  const labels = (t) => t['research/markets'].map((o) => o.label);
  assert.deepEqual(labels(FOUNDER_ZONE_ACTIONS), ['Export view', 'New market research']);
  assert.deepEqual(labels(INVESTOR_ZONE_ACTIONS), ['Export view', 'Edit thesis']);
  assert.deepEqual(labels(ADVISOR_ZONE_ACTIONS), ['Export view', 'New market research']);
  assert.deepEqual(labels(PARTNER_ZONE_ACTIONS), ['Re-run stale', 'Export view', 'New market research']);
  for (const t of [FOUNDER_ZONE_ACTIONS, INVESTOR_ZONE_ACTIONS, ADVISOR_ZONE_ACTIONS, PARTNER_ZONE_ACTIONS]) {
    assert.deepEqual(t['research/markets'].find((o) => o.label === 'Export view'), { label: 'Export view', kind: 'handler', handler: 'exportFilteredView' },
      'Export view is the page\'s, so it can page the whole view rather than write the rows loaded');
  }
  assert.equal(FOUNDER_ZONE_ACTIONS['research/markets'][1].handler, 'newMarketResearch');
  assert.deepEqual(INVESTOR_ZONE_ACTIONS['research/markets'][1], { label: 'Edit thesis', kind: 'handler', handler: 'editThesis', primary: true });
  // My Research admits founders and admins only, so the other licences draw it disabled.
  assert.ok(ADVISOR_ZONE_ACTIONS['research/markets'][1].unbuilt);
  assert.ok(PARTNER_ZONE_ACTIONS['research/markets'][2].unbuilt);
  assert.match(read('frontend/src/routes/researchProjects.jsx'), /path="\/research\/projects" element=\{guard\(labRoles\(\['admin', 'founder'\]\)/);
});

test('the zone supplies the three handlers, and the header renders them live', () => {
  const zone = codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx'));
  for (const name of ['exportFilteredView', 'newMarketResearch', 'editThesis']) {
    assert.match(zone, new RegExp(`${name}: headerOps\\.handlers\\.${name},`), name);
  }
  assert.match(zone, /<MarketDirectoryPanel role=\{role\} onData=\{setShown\} onRead=\{setDirRead\} \/>/);
  let went = null;
  const handlers = { exportFilteredView: { onClick: () => {}, disabled: false, title: 'x' }, newMarketResearch: () => { went = 'research'; }, editThesis: () => { went = 'thesis'; } };
  const f = founderZoneActions('research/markets', { handlers });
  assert.deepEqual(f.map((a) => [a.label, a.disabled]), [['Export view', false], ['New market research', false]]);
  f[1].onClick();
  assert.equal(went, 'research');
  const i = investorZoneActions('research/markets', { handlers });
  assert.deepEqual(i.map((a) => a.label), ['Export view', 'Edit thesis']);
  assert.equal(i[1].primary, true);
  i[1].onClick();
  assert.equal(went, 'thesis');
});

test('New market research opens the New research form with the market named; Edit thesis opens My thesis', () => {
  assert.equal(newMarketResearchHref('Energy storage'), '/research/projects?new=1&question=Energy%20storage');
  assert.equal(newMarketResearchHref(''), '/research/projects?new=1');
  const items = [market(1), market(2)];
  assert.equal(researchSubject(readMarketQuery(p('q=energy&open=m-2')), items), 'Market 2', 'the open row names the market');
  assert.equal(researchSubject(readMarketQuery(p('q=energy')), items), 'energy', 'no row open: the search');
  assert.equal(researchSubject(readMarketQuery(p('open=gone')), items), '', 'an open row not on the page names nothing');
  assert.equal(THESIS_EDIT, '/account/security-privacy#my-thesis');
  assert.match(read('frontend/src/pages/research/MarketHeaderOps.jsx'), /editThesis: \{ onClick: \(\) => navigate\(THESIS_EDIT\)/);
});

// ---- Export view writes the view --------------------------------------------------

test('Export view pages the exact filtered request, 100 at a time, until the Worker\'s total', async () => {
  const { list, calls } = worker(230);
  const request = marketListParams(readMarketQuery(p('q=energy&country=DE&fresh=30&sort=name:asc&page=3')), []);
  const whole = await readWholeView(list, request);
  assert.equal(whole.items.length, 230, 'every market in the view, not the 25 on screen');
  assert.equal(whole.total, 230);
  assert.deepEqual(calls.map((c) => [c.offset, c.limit]), [[undefined, EXPORT_PAGE], [100, EXPORT_PAGE], [200, EXPORT_PAGE]], 'from the first market, whatever page is shown');
  for (const c of calls) {
    assert.equal(c.q, 'energy');
    assert.equal(c.country, 'DE');
    assert.equal(c.fresh, '30');
    assert.equal(c.sort, 'name');
    assert.equal(c.dir, 'asc');
  }
  assert.deepEqual(whole.items.slice(0, 2).map((m) => m.slug), ['m-1', 'm-2'], 'in the view\'s order');
  // The thesis switch's sectors travel with the request.
  const thesis = marketListParams(readMarketQuery(p('thesis=1')), ['Climate Intelligence']);
  await readWholeView(list, thesis);
  assert.equal(calls.at(-1).sector, 'Climate Intelligence');
});

test('a view past the file limit is refused with a sentence, never cut short', async () => {
  const { list } = worker(EXPORT_MAX + 1);
  await assert.rejects(readWholeView(list, {}), (e) => e.code === 'too_many' && e.total === EXPORT_MAX + 1);
  const saved = [];
  const note = await runViewExport({ status: 'ready', data: { total: EXPORT_MAX + 1 }, request: {} }, { list, save: (x) => { saved.push(x); return true; } });
  assert.equal(note.ok, false);
  assert.match(note.text, /This view holds 5,001 markets, more than one file takes \(5,000\)\. Narrow it/);
  assert.equal(saved.length, 0);
});

test('the file carries the table\'s facts, Not recorded where no source holds one, and the thesis when there is one', async () => {
  assert.deepEqual(marketCsvHeader(), ['Market', 'Tracked sector', 'Taxonomy company count (not market size)', 'Countries represented',
    'Distinct sources', 'Sector-level sources', 'Sources naming the market', 'Latest source', 'Latest source age (days)']);
  assert.deepEqual(marketCsvRow(market(1), READ_AT), ['Market 1', 'Climate Intelligence', 11, 'DE 2; NL 1', 3, 2, 1, '2026-11-06', 10]);
  assert.deepEqual(marketCsvRow(BARE, READ_AT),
    ['Market 0', 'Not mapped yet', 10, 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  const thesis = thesisFrom(PROFILE);
  assert.equal(marketCsvHeader(thesis).at(-1), 'Your thesis');
  assert.equal(marketCsvRow(market(1), READ_AT, thesis).at(-1), 'Matches via Climate');
  assert.equal(marketCsvRow(market(1, { mi_sector: 'DevTools' }), READ_AT, thesis).at(-1), 'Not a thesis sector');
  assert.equal(marketCsvRow(BARE, READ_AT, thesis).at(-1), 'No tracked sector');

  const { list } = worker(130);
  const saved = [];
  const note = await runViewExport({ status: 'ready', data: { total: 130 }, request: {}, thesis }, { list, save: (x) => { saved.push(x); return true; } });
  assert.deepEqual(note, { ok: true, text: 'Downloaded 130 markets: every market this view holds.' });
  assert.equal(saved[0].rows.length, 130);
  assert.equal(saved[0].header.at(-1), 'Your thesis');
  assert.equal(saved[0].zone, 'markets-view');
  const failed = await runViewExport({ status: 'ready', data: { total: 3 }, request: {} }, { list: async () => { throw new Error('503'); }, save: () => true });
  assert.deepEqual(failed, { ok: false, text: 'The markets could not be read for the file, so nothing was written. Try again.' });
});

test('Export view is live only once the directory is read and holds a market', () => {
  assert.deepEqual(exportControl(null), { disabled: true, title: 'The markets are still loading.' });
  assert.equal(exportControl({ status: 'loading', data: null }).disabled, true);
  assert.deepEqual(exportControl({ status: 'unreadable', data: null }), { disabled: true, title: 'The markets could not be read, so there is nothing to write.' });
  assert.deepEqual(exportControl({ status: 'ready', data: { total: 0 } }), { disabled: true, title: 'No market is in this view.' });
  assert.deepEqual(exportControl({ status: 'ready', data: { total: 82 } }),
    { disabled: false, total: 82, title: 'Writes the 82 markets this view holds, every page, as CSV.' });
});

// ---- Phone (RMD-11) -------------------------------------------------------------------

const FACETS = {
  country: { options: [['DE', 3], ['NL', 2], ['DK', 2], ['SE', 1], ['FR', 1], ['PL', 1], ['ES', 1]].map(([code, count]) => ({ code, count })), not_recorded: 4 },
  fresh: { options: [{ value: '30', count: 5 }, { value: 'older', count: 1 }] },
  src: { options: [{ value: 'named', count: 2 }] },
};
const noop = () => {};
const sheet = (draft, count) => words(at('/research/markets', h(FiltersSheetBody, {
  draft, setDraft: noop, facets: FACETS, count, onApply: noop, onClose: noop, allCountries: false, setAllCountries: noop,
})));

test('RMD-11B: one Filters sheet, its counts, Reset, and "Show N markets" from the Worker\'s count for the draft', () => {
  const t = sheet({ country: ['DE'], fresh: '30', src: '' }, { status: 'ready', total: 2 });
  assert.match(t, /^Filters ✕ Country Germany 3 Netherlands 2 Denmark 2 Sweden 1 France 1 All 7 countries ▾ 4 markets have no recorded country and never match one\./);
  assert.match(t, /Source freshness Any date Last 30 days 5 31 to 90 days 0 Older than 90 days \(Stale\) 1 No source recorded 0 Source type/);
  assert.match(t, /Source type Any source Evidence that names the market 2/);
  assert.match(t, /Reset Show 2 markets$/);
  assert.equal(COUNTRIES_SHOWN, 5);
  // A country already chosen stays in view past the first five.
  assert.match(sheet({ country: ['ES'], fresh: '', src: '' }, { status: 'ready', total: 1 }), /France 1 Spain 1 All 7 countries ▾/);
  // No number until the Worker answers, and none when it cannot.
  assert.equal(showLabel({ status: 'loading' }), 'Show markets');
  assert.equal(showLabel({ status: 'unreadable' }), 'Show markets');
  assert.equal(showLabel({ status: 'ready', total: 1 }), 'Show 1 market');
  const markup = at('/research/markets', h(FiltersSheetBody, { draft: { country: [], fresh: '', src: '' }, setDraft: noop, facets: FACETS, count: { status: 'loading' }, onApply: noop, onClose: noop, allCountries: false, setAllCountries: noop }));
  assert.match(markup, /role="dialog" aria-modal="true" aria-labelledby="markets-filters-h"/);
  assert.match(markup, /aria-label="Close filters"/);
});

test('the sheet\'s count is asked with the page\'s own request for the draft, one row', () => {
  const view = readMarketQuery(p('q=energy&sort=name:asc&page=4&thesis=1'));
  const req = draftCountParams(view, { country: ['DE', 'NL'], fresh: '30', src: 'named' }, ['Climate Intelligence']);
  assert.deepEqual(req, { q: 'energy', sort: 'name', dir: 'asc', country: 'DE,NL', fresh: '30', src: 'named', sector: 'Climate Intelligence', limit: 1, offset: undefined });
  assert.equal(sheetFilterCount(readMarketQuery(p('country=DE&country=NL&fresh=30'))), 3);
  assert.equal(sheetFilterCount(readMarketQuery(p('q=energy'))), 0, 'search is not in the sheet');
});

test('below md the toolbar is the search, Filters and Sort; the three menus are desktop only', () => {
  const markup = at('/research/markets?country=DE&fresh=30', h(MarketDirectoryPanel, { role: 'founder' }));
  assert.match(markup, /<div class="grid grid-cols-2 gap-2 md:hidden" data-testid="markets-phone-tools">/);
  assert.match(words(markup), /Search markets or sectors Filters · 2 Sort · Taxonomy count, highest first/);
  for (const id of ['filter-country', 'filter-fresh', 'filter-src']) {
    assert.match(markup, new RegExp(`<div class="hidden md:block"><div class="relative"><span[^>]*>[^<]*</span><button[^>]*data-testid="${id}"`), id);
  }
});

test('RMD-11D/E/F: the phone thesis is one line that opens; no thesis and Unavailable keep their words', () => {
  const set = { status: 'ready', thesis: thesisFrom({ ...PROFILE, sectors: ['Climate', 'Energy', 'Robotics'] }) };
  const closed = at('/research/markets', h(ThesisStrip, { read: set, matchCount: 14, total: 82 }));
  assert.match(closed, /aria-expanded="false"/);
  assert.equal(words(closed), 'Your thesis · Climate, Energy, Robotics ▾ 14 of 82 markets match · tap to read the thesis');
  const open = words(at('/research/markets', h(ThesisStrip, { read: set, matchCount: 14, total: 82, initiallyOpen: true })));
  assert.match(open, /^Your thesis · Climate, Energy, Robotics ▴ Industrial software for operators\. Stages Seed Geographies DACH A market matches only when its tracked sector is one of your profile sectors: Climate → Climate Intelligence; Energy → Climate Intelligence; Robotics → Autonomous Robotics\./);
  assert.match(open, /Show only markets that match Edit thesis$/);
  assert.match(at('/research/markets', h(ThesisStrip, { read: set, initiallyOpen: true })), /href="\/account\/security-privacy#my-thesis"/);
  assert.equal(words(at('/research/markets', h(ThesisStrip, { read: set, total: 14, onlyMatches: true }))),
    'Your thesis · Climate, Energy, Robotics ▾ 14 markets match · showing only these · tap to read the thesis');
  assert.equal(words(at('/research/markets', h(ThesisStrip, { read: { status: 'ready', thesis: { kind: 'none' } } }))),
    'Your thesis No thesis on your profile yet. The directory works without one. Add a thesis in Settings');
  assert.match(words(at('/research/markets', h(ThesisStrip, { read: { status: 'unreadable' } }))),
    /Your thesis Unavailable .*This is not a claim that nothing matches\. Retry/);
  // The panel draws the strip below md and the full section from md.
  const panel = at('/research/markets', h(MarketDirectoryPanel, { role: 'investor' }));
  assert.match(panel, /<div class="md:hidden"><section[^>]*data-testid="markets-thesis-strip"/);
  assert.match(panel, /<div class="hidden md:block"><section[^>]*data-testid="markets-thesis"/);
  assert.doesNotMatch(at('/research/markets', h(MarketDirectoryPanel, { role: 'founder' })), /markets-thesis/);
});

// ---- Partial (RMD-09B) and the thesis switch without its profile ------------------------

test('Partial: the markets were read and the profile was not; the thesis switch is never shown as applied without it', () => {
  const v = (s) => readMarketQuery(p(s));
  const set = { status: 'ready', thesis: thesisFrom(PROFILE) };
  assert.deepEqual(thesisGate({ investor: false, view: v('thesis=1'), profileStatus: 'unreadable' }), { waiting: false, notApplied: false, impossible: false, failed: false });
  assert.deepEqual(thesisGate({ investor: true, view: v('thesis=1'), profileStatus: 'loading', thesisRead: { status: 'loading' } }),
    { failed: false, waiting: true, notApplied: false, impossible: false }, 'the list waits for the profile rather than answer the whole directory');
  assert.deepEqual(thesisGate({ investor: true, view: v(''), profileStatus: 'loading', thesisRead: { status: 'loading' } }),
    { failed: false, waiting: false, notApplied: false, impossible: false }, 'without the switch nothing waits');
  assert.deepEqual(thesisGate({ investor: true, view: v('thesis=1'), profileStatus: 'unreadable', thesisRead: { status: 'unreadable' } }),
    { failed: true, waiting: false, notApplied: true, impossible: false });
  assert.deepEqual(thesisGate({ investor: true, view: v(''), profileStatus: 'unreadable', thesisRead: { status: 'unreadable' } }),
    { failed: true, waiting: false, notApplied: false, impossible: false });
  assert.deepEqual(thesisGate({ investor: true, view: v('thesis=1'), profileStatus: 'ready', thesisRead: set }),
    { failed: false, waiting: false, notApplied: false, impossible: false });
  const unmapped = { status: 'ready', thesis: thesisFrom({ sectors: ['Defense'] }) };
  assert.equal(thesisGate({ investor: true, view: v('thesis=1'), profileStatus: 'ready', thesisRead: unmapped }).impossible, true);
  assert.equal(thesisGate({ investor: true, view: v('thesis=1'), profileStatus: 'ready', thesisRead: { status: 'ready', thesis: { kind: 'none' } } }).impossible, true);

  const banner = at('/research/markets', h(ThesisPartial, { onRetry: noop }));
  assert.match(banner, /data-platform-state="partial"/);
  assert.match(words(banner), /^Partial: 1 of 2 sources unavailable · your investor profile\. Markets are listed; the Your thesis column and its matches wait for that read\. \S* ?Retry$/);
  assert.doesNotMatch(words(banner), /not applied/, 'without the switch the banner says nothing about it');
  assert.match(words(at('/research/markets', h(ThesisPartial, { notApplied: true, onRetry: noop }))),
    /wait for that read\. “Show only markets that match” is not applied: these are the markets the other filters leave\./);
  assert.equal(words(at('/research/markets', h(ThesisImpossible, { thesis: unmapped.thesis, onShowAll: noop }))),
    'No market can match your thesis sectors. None of your profile sectors maps to a tracked sector. A market matches only through its tracked sector. Show all markets');
  // The panel wires it: the banner over a ready read, the chip marked not applied, the result line without the switch.
  const panel = codeOnly(read('frontend/src/pages/research/MarketDirectory.jsx'));
  assert.match(panel, /const partial = gate\.failed && markets\.status === 'ready' \? <ThesisPartial notApplied=\{gate\.notApplied\} onRetry=\{reloadProfile\} \/> : null;/);
  assert.match(panel, /useKeyedRead\(\(\) => researchMarketsApi\.list\(listParams\), listKey, !gate\.waiting\)/);
  assert.match(panel, /c\.key === 'thesis' && gate\.notApplied \? \{ \.\.\.c, label: `\$\{c\.label\} · not applied` \}/);
  assert.match(panel, /<ResultLine data=\{data\} view=\{shownView\} \/>/);
});
