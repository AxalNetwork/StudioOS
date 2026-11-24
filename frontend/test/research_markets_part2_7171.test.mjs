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
import { THESIS_EDIT, newMarketResearchHref, researchSubject } from '../src/pages/research/marketDirectoryExport.js';
import { useDirectoryExport } from '../src/pages/research/MarketDirectoryZone.jsx';
import { listedExport, readListedQuery } from '../src/pages/research/listedCompaniesRead.js';
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
const words = (markup) => String(markup).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const p = (s) => new URLSearchParams(s);

test('rendered text decodes punctuation once and keeps literal entity text', () => {
  const text = `"quoted" and 'single' & literal &quot; &#x27; &amp; &amp;quot;`;
  assert.equal(words(renderToStaticMarkup(h('span', null, text))), text);
});

const market = (i, extra = {}) => ({
  slug: `m-${i}`, name: `Market ${i}`, mi_sector: 'Climate Intelligence', supplied_count: 10 + i,
  countries: { status: 'recorded', value: [{ code: 'DE', count: 2 }, { code: 'NL', count: 1 }] },
  source_count: { status: 'recorded', value: 3 },
  newest_source_at: { status: 'recorded', value: '2026-11-06T09:40:00Z' },
  sources_by_kind: { market_intel: { count: 2 }, signal_evidence: { count: 1 } },
  ...extra,
});
const PROFILE = { thesis_text: 'Industrial software for operators.', sectors: ['Climate', 'Defense'], stages: ['Seed'], geos: ['DACH'], anti_thesis_sectors: [] };

// ---- The header ops (RMD-01, RMD-08) ----------------------------------------------

test('the Markets header is the D7036 header on every licence: Export view, then New market research or Edit thesis', () => {
  const labels = (t) => t['research/markets'].map((o) => o.label);
  assert.deepEqual(labels(FOUNDER_ZONE_ACTIONS), ['Export view', 'New market research']);
  assert.deepEqual(labels(INVESTOR_ZONE_ACTIONS), ['Export view', 'Edit thesis']);
  assert.deepEqual(labels(ADVISOR_ZONE_ACTIONS), ['Export view', 'New market research']);
  assert.deepEqual(labels(PARTNER_ZONE_ACTIONS), ['Re-run stale', 'Export view', 'New market research']);
  for (const t of [FOUNDER_ZONE_ACTIONS, INVESTOR_ZONE_ACTIONS, ADVISOR_ZONE_ACTIONS, PARTNER_ZONE_ACTIONS]) {
    assert.deepEqual(t['research/markets'].find((o) => o.label === 'Export view'), { label: 'Export view', kind: 'export' },
      'Export view is the builder\'s export, so the header runs D7172\'s scoped export of the active tab: one export path');
  }
  assert.equal(FOUNDER_ZONE_ACTIONS['research/markets'][1].handler, 'newMarketResearch');
  assert.deepEqual(INVESTOR_ZONE_ACTIONS['research/markets'][1], { label: 'Edit thesis', kind: 'handler', handler: 'editThesis', primary: true });
  // My Research admits founders and admins only, so the other licences draw it disabled.
  assert.ok(ADVISOR_ZONE_ACTIONS['research/markets'][1].unbuilt);
  assert.ok(PARTNER_ZONE_ACTIONS['research/markets'][2].unbuilt);
  assert.match(read('frontend/src/routes/researchProjects.jsx'), /path="\/research\/projects" element=\{guard\(labRoles\(\['admin', 'founder'\]\)/);
});

test('the zone supplies New market research and Edit thesis, and hands the header its scoped export', () => {
  const zone = codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx'));
  for (const name of ['newMarketResearch', 'editThesis']) {
    assert.match(zone, new RegExp(`${name}: headerOps\\.handlers\\.${name},`), name);
  }
  assert.doesNotMatch(zone, /exportFilteredView/, 'no second export beside D7172\'s');
  assert.match(zone, /zoneActions\(scoped, opsHandlers\)/);
  assert.match(zone, /<MarketDirectoryPanel role=\{role\} onRead=\{setDirectoryRead\} \/>/);
  let went = null;
  const handlers = { newMarketResearch: () => { went = 'research'; }, editThesis: () => { went = 'thesis'; } };
  const f = founderZoneActions('research/markets', { handlers, view: { scoped: { label: 'Export filtered markets · 3 rows', onClick: () => {} } } });
  assert.deepEqual(f.map((a) => [a.label, a.disabled]), [['Export filtered markets · 3 rows', false], ['New market research', false]]);
  f[1].onClick();
  assert.equal(went, 'research');
  const i = investorZoneActions('research/markets', { handlers, view: { scoped: { label: 'Export filtered markets · 3 rows', onClick: () => {} } } });
  assert.deepEqual(i.map((a) => a.label), ['Export filtered markets · 3 rows', 'Edit thesis']);
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

// ---- Export view is D7172's scoped export ------------------------------------------

const ready = (total, items = [], request = {}) => ({ status: 'ready', data: { total, items }, request });

test('Export view carries the active tab\'s export: its label, its disabled states and its click', () => {
  let ran = 0;
  const header = (scoped) => founderZoneActions('research/markets', { handlers: {}, view: { scoped } })[0];
  const run = () => { ran += 1; };
  // Market directory: every market the filtered view holds, the Worker's total when one read is short.
  const dir = useDirectoryExport(ready(230, [market(1)], { q: 'energy' }), p('q=energy'));
  const live = header({ ...dir.ctl, onClick: run, busy: false });
  assert.deepEqual([live.label, live.disabled, live.busy], ['Export filtered markets · 230 rows', false, false]);
  live.onClick();
  assert.equal(ran, 1);
  assert.equal(header({ ...dir.ctl, onClick: run, busy: true }).busy, true, 'the header shows the export in progress');
  // Loading, a failed read and an empty view each say so and offer no click.
  for (const [read, label] of [
    [{ status: 'loading', data: null, request: null }, 'Export filtered markets · loading'],
    [{ status: 'unreadable', data: null, request: {} }, 'Export · not available'],
    [ready(0), 'Export filtered markets · 0 rows'],
  ]) {
    const off = header({ ...useDirectoryExport(read, p('')).ctl, onClick: run });
    assert.deepEqual([off.label, off.disabled, off.onClick], [label, true, undefined], label);
  }
  // Listed companies: the header exports that tab's page, not the directory.
  const listed = listedExport({ status: 'ready', data: { items: [{ symbol: 'A' }, { symbol: 'B' }], total: 2, limit: 50, offset: 0 } }, readListedQuery(p('tab=listed')));
  assert.equal(header({ ...listed, onClick: run }).label, 'Export this page · 2 rows');
  assert.match(codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx')),
    /const ctl = tab === 'listed' \? listedExport\(listed, view\) : directoryExport\.ctl;/);
});

test('the directory hands the export its exact request; a thesis no market can match exports nothing', () => {
  const panel = codeOnly(read('frontend/src/pages/research/MarketDirectory.jsx'));
  assert.match(panel, /onRead\?\.\(gate\.impossible\s*\? \{ status: 'ready', data: \{ total: 0, items: \[\] \}, request: listParams \}\s*: \{ \.\.\.markets, request: listParams \}\)/);
  const impossible = useDirectoryExport(ready(0, [], marketListParams(readMarketQuery(p('thesis=1')), [])), p('thesis=1'));
  assert.deepEqual([impossible.ctl.label, impossible.ctl.disabled], ['Export filtered markets · 0 rows', true]);
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
  assert.match(t, /Source freshness Any date Named evidence, reported in the last 30 days 5 Named evidence, reported 31 to 90 days ago 0 Named evidence, reported over 90 days ago \(Stale\) 1 None named 0 Source type/);
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
