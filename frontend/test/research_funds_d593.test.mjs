/**
 * D593 — the Funds pages to the owner's re-exported canvas "Pages · Founder
 * Research Fund", boards F0, F1, D1–D4 and M1–M2. Rendered with
 * react-dom/server (no DOM), and read as source where only the wiring can say
 * it.
 *
 *   F0  /research/funds has two tabs: My funds (the default, no param) and
 *       Directory (N) at `?view=directory`, N the API's whole-directory
 *       `coverage.total` once a read has answered and no count before. "Add to
 *       my funds" keeps the row the POST returns, and "Open your dossier →"
 *       takes the button's place.
 *   F1  "Where the money is" above the directory's list, the overview's own
 *       `Money` section from `GET /api/research/overview`: loading draws no
 *       figure, a failed read says Unreadable, and nothing reads zero.
 *   D/M A source recorded without http(s) is shown as written; an unassessed
 *       stage and a path other than warm are muted on their tiles; the draft
 *       button is disabled up front with its reason; below lg a live fund's
 *       Pass reason card is left out.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_funds_d593.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

// Namespaces rather than named imports: a missing export is one failed test,
// not a module that will not link.
const zone = await import('../src/pages/research/FundsZone.jsx');
const directory = await import('../src/pages/research/FundDirectory.jsx');
const directoryRead = await import('../src/pages/research/fundDirectoryRead.js');
const catalog = await import('../src/pages/research/FundCatalogProfile.jsx');
const dossier = await import('../src/pages/research/FundDossier.jsx');
const dossierRead = await import('../src/pages/research/fundDossierRead.js');
const { default: ZoneDraft } = await import('../src/workspaces/ZoneDraft.jsx');

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = codeOnly(read('frontend/src/pages/research/FundsZone.jsx'));
const DOSSIER = codeOnly(read('frontend/src/pages/research/FundDossier.jsx'));

const h = React.createElement;
const html = (el, entries) => renderToStaticMarkup(h(MemoryRouter, entries ? { initialEntries: entries } : null, el));

// ── Fixtures ────────────────────────────────────────────────────────────────

const EUR = 'EuroTech VC Funds (public spreadsheet)';
const ZETA = {
  uid: 'zeta', name: 'Zeta Deep Tech', website: null, linkedin: null, hq: 'Berlin', fund_number: null,
  fund_size_cents: null, size_reason: 'Not recorded: this list records no size in a known currency',
  fund_date: null, fund_year: null, sector_focus: null, notable_lps: null, eif: null, eifo: null,
  size_currency: null, source_name: EUR, source_url: 'https://example.org/eurotech', as_of: '2026-10-04',
};
const DATA = {
  items: [ZETA], total: 1, limit: 25, offset: 0, sort: 'name',
  coverage: { total: 2616, as_of: '2026-10-04', fields: { size_eur: 1001, size_unknown_currency: 0, hq: 2500,
    website: 1200, sector_focus: 1300, fund_year: 1100, notable_lps: 800 } },
  sources: [{ name: EUR, url: 'https://example.org/eurotech', rows: 2616, as_of: '2026-10-04', size_currency: 'EUR' }],
  facets: null,
};
const MONEY = {
  status: 'ok', as_of: '2026-10-04', total_funds: 2616,
  by_hq: [{ hq: 'United Kingdom', code: 'GB', funds: 300 }], other_hq: { countries: 40, funds: 900 }, hq_unmapped: { values: 3, funds: 7 },
  by_focus: [{ focus: 'FinTech', slug: 'fintech', funds: 120 }], other_focus: { markets: 30, funds: 500 }, focus_unmapped: { values: 2, funds: 400 },
  size_currency: 'EUR', size_note: 'Sizes in euros.', size_bands: [{ band: '€25M–100M', funds: 410 }],
  vintages: [{ year: 2011, funds: 3 }, { year: 2026, funds: 40 }], vintage_range: { from: 2011, to: 2026 },
  missing: { hq: 29, focus: 996, size: 1059, vintage: 1059 },
};

/** The directory with ZETA's drawer open. */
function withDrawer(props = {}) {
  return html(h(directory.FundDirectoryView, {
    query: directoryRead.EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null,
    result: { loading: false, error: null, data: DATA }, selected: ZETA, onSelect() {}, onClose() {},
    drawer: { loading: false, error: null, data: { item: ZETA, reports: [], reports_status: 'ok' } },
    ...props,
  }));
}
const drawerOf = (out) => out.slice(out.indexOf('<aside id="fd-drawer"'), out.indexOf('</aside>'));
const tabsOf = (out) => [...out.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => ({ tag: m[0], label: m[1] }));

// ── F0: the two tabs ────────────────────────────────────────────────────────

test('F0: the Directory tab counts the whole directory once read, and names no count before', () => {
  const { directoryTabLabel, directoryTotalOf } = directoryRead;
  assert.equal(directoryTabLabel(2616), 'Directory (2,616)');
  assert.equal(directoryTabLabel(0), 'Directory (0)', 'an answered, empty directory is a fact about the store');
  assert.equal(directoryTabLabel(null), 'Directory');
  assert.equal(directoryTabLabel(undefined), 'Directory');
  // N is `coverage.total`, the whole directory, never the filtered page's `total`.
  const answered = { loading: false, error: null, data: { ...DATA, total: 7 } };
  assert.equal(directoryTotalOf(answered), 2616);
  assert.equal(directoryTotalOf({ loading: true, error: null, data: null }), null, 'a count before the first answer');
  assert.equal(directoryTotalOf({ loading: false, error: 'Unreadable', data: null }), null, 'a failed read is not a count');
  assert.equal(directoryTotalOf({ ...answered, loading: true }), 2616, 'a refetch keeps the answer on screen, as the header does');
  assert.equal(directoryTotalOf({ loading: false, error: null, data: { total: 7 } }), null, 'no coverage, no count');
});

test('F0: an accessible tablist — My funds first and selected by default, Directory with its count', () => {
  const mine = html(h(zone.FundsTabs, { tab: 'mine', directoryTotal: null }));
  assert.match(mine, /<div role="tablist" aria-label="Funds"/);
  const [own, dir] = tabsOf(mine);
  assert.deepEqual([own?.label, dir?.label], ['My funds', 'Directory'], 'a count was named before the directory answered');
  assert.match(own.tag, /aria-selected="true"/);
  assert.match(dir.tag, /aria-selected="false"/);
  assert.match(own.tag, /aria-controls="funds-panel-mine"/);
  assert.match(dir.tag, /aria-controls="funds-panel-directory"/);
  assert.match(own.tag, /tabindex="0"/, 'Tab must reach the selected tab');
  assert.match(dir.tag, /tabindex="-1"/, 'the arrow keys, not Tab, move to the other tab');

  const out = html(h(zone.FundsTabs, { tab: 'directory', directoryTotal: 2616 }));
  const counted = tabsOf(out);
  assert.deepEqual(counted.map((t) => t.label), ['My funds', 'Directory (2,616)']);
  assert.match(counted[1].tag, /aria-selected="true"/);
  // Every colour on the tabs has its dark pair.
  const classes = (tag) => tag.match(/class="([^"]*)"/)[1].split(/\s+/);
  const on = classes(counted[1].tag);
  assert.ok(['border-violet-700', 'dark:border-violet-400', 'text-violet-800', 'dark:text-violet-200'].every((c) => on.includes(c)),
    `the selected tab lost a colour or its dark pair: ${on.join(' ')}`);
  const off = classes(counted[0].tag);
  assert.ok(['text-axal-muted', 'dark:text-gray-400', 'dark:hover:text-gray-100'].every((c) => off.includes(c)),
    `the other tab lost a colour or its dark pair: ${off.join(' ')}`);
  assert.match(out, /role="tablist"[^>]*class="[^"]*border-axal-hairline dark:border-gray-800/);
});

test('F0: ?view=directory selects the directory, anything else My funds, and a switch replaces the URL', () => {
  const p = (s) => new URLSearchParams(s);
  assert.equal(zone.fundsTabOf(p('')), 'mine');
  assert.equal(zone.fundsTabOf(p('view=directory')), 'directory');
  assert.equal(zone.fundsTabOf(p('view=Directory')), 'mine');
  assert.equal(zone.fundsTabOf(p('view=list')), 'mine');
  assert.equal(zone.fundsSearchFor(p('sheets=connected'), 'directory').toString(), 'sheets=connected&view=directory');
  assert.equal(zone.fundsSearchFor(p('view=directory&x=1'), 'mine').toString(), 'x=1', 'My funds carries no param');
  assert.match(ZONE, /const pick = \(key\) => setParams\(fundsSearchFor\(params, key\), \{ replace: true \}\);/,
    'a tab switch must replace the URL, not push a history entry');
  assert.match(ZONE, /const tab = fundsTabOf\(params\);/);
});

test('F0: the page draws the tab its URL names, and both panels stay mounted', () => {
  const at = (url) => html(h(zone.default, { role: 'founder' }), [url]);
  const panel = (out, key) => {
    const at = out.indexOf(`<div role="tabpanel" id="funds-panel-${key}"`);
    return at < 0 ? '' : out.slice(at, out.indexOf('>', at) + 1);
  };

  const mine = at('/research/funds');
  assert.match(panel(mine, 'mine'), /aria-labelledby="funds-tab-mine"/);
  assert.doesNotMatch(panel(mine, 'mine'), /hidden/);
  assert.match(panel(mine, 'directory'), /hidden=""/);
  assert.match(mine, /data-testid="fund-directory"/, 'the directory must stay mounted: its read is the tab’s count');
  assert.doesNotMatch(mine, /data-testid="funds-money-band"/, 'the overview is read before the Directory tab is opened');

  const dir = at('/research/funds?view=directory');
  assert.match(panel(dir, 'mine'), /hidden=""/);
  assert.match(panel(dir, 'directory'), /aria-labelledby="funds-tab-directory"/);
  assert.doesNotMatch(panel(dir, 'directory'), /hidden/);
  assert.match(dir, /data-testid="funds-money-band" data-state="loading"/);
  assert.deepEqual(tabsOf(dir).map((t) => t.label), ['My funds', 'Directory'], 'no count before the directory answers');
});

test('F0: My funds is the list as it was, with its zone toolbar and filters', () => {
  const mineAt = ZONE.indexOf('id="funds-panel-mine"');
  const dirAt = ZONE.indexOf('id="funds-panel-directory"');
  const toolbar = ZONE.indexOf('<ZoneToolbar');
  assert.ok(mineAt > 0 && dirAt > mineAt, 'the two panels are gone');
  assert.ok(toolbar > mineAt && toolbar < dirAt, 'the zone toolbar left the My funds panel');
  for (const part of ['<ZoneHeading', 'label="Researched"', 'title="No fund is on your list yet"', 'Add a fund', '<StatedLimit']) {
    const at = ZONE.indexOf(part);
    assert.ok(at > mineAt && at < dirAt, `${part} left the My funds panel`);
  }
  assert.ok(ZONE.indexOf('<FundDirectory ') > dirAt, 'the directory is not on the Directory tab');
  assert.doesNotMatch(ZONE, /2,032|2032/, 'the canvas’s stale count is written into the page');
});

// ── F0: Add to my funds, then the dossier ──────────────────────────────────

test('F0: the drawer offers "Add to my funds", and once the fund is on the list, "Open your dossier →"', () => {
  const offer = drawerOf(withDrawer({ onAdd() {} }));
  const add = offer.match(/<button[^>]*>Add to my funds<\/button>/)?.[0];
  assert.ok(add, 'the drawer has no "Add to my funds" button');
  assert.doesNotMatch(add, /\sdisabled=""/);
  assert.doesNotMatch(offer, /Add to my list|Open your dossier/);

  const there = drawerOf(withDrawer({ onAdd() {}, isAdded: () => true, dossierOf: (x) => (x.uid === 'zeta' ? 'rf 7/x' : null) }));
  assert.match(there, /<a[^>]*href="\/research\/funds\/rf%207%2Fx"[^>]*>Open your dossier →<\/a>/);
  assert.doesNotMatch(there, /Add to my funds|On your list/, 'the link takes the button’s place');

  const page = withDrawer({ isAdded: () => true });
  const rows = renderedText(page.slice(page.indexOf('<tbody'), page.indexOf('</tbody>')));
  assert.match(rows, /^Zeta Deep TechIn My funds/, 'the row says where the fund now is');
});

test('F0: an add says how it went in that fund’s drawer, and only there', () => {
  const said = drawerOf(withDrawer({ onAdd() {}, notice: { uid: 'zeta', ok: true, text: 'Zeta Deep Tech added to My funds.' } }));
  assert.match(said, /<p role="status"[^>]*>Zeta Deep Tech added to My funds\.<\/p>/);
  const failed = drawerOf(withDrawer({ onAdd() {}, notice: { uid: 'zeta', ok: false, text: 'That did not save.' } }));
  assert.match(failed, /<p role="status" class="[^"]*text-red-700 dark:text-red-300[^"]*">That did not save\.<\/p>/);
  const elsewhere = drawerOf(withDrawer({ onAdd() {}, notice: { uid: 'alpha', ok: true, text: 'Alpha Ventures added to My funds.' } }));
  assert.doesNotMatch(elsewhere, /Alpha Ventures added/, 'another fund’s add was reported in this drawer');
});

test('F0: while the founder’s list is unread or unreadable, no add is offered that could duplicate a row', () => {
  const unread = drawerOf(withDrawer({ onAdd() {}, listState: 'unreadable' }));
  assert.match(renderedText(unread), /Unreadable Your list could not be read, so this cannot tell whether the fund is on it\./);
  assert.doesNotMatch(unread, />Add to my funds</);
  const pending = drawerOf(withDrawer({ onAdd() {}, listState: 'loading' }));
  assert.match(pending, /<button[^>]*disabled=""[^>]*>Checking your list…<\/button>/);
  assert.doesNotMatch(pending, />Add to my funds</);
  // A dossier already known still opens.
  const known = drawerOf(withDrawer({ listState: 'unreadable', dossierOf: () => 'rf_1' }));
  assert.match(known, /href="\/research\/funds\/rf_1"/);
  // The zone holds the same line.
  assert.match(ZONE, /const listState = state\.error \? 'unreadable' : !data \? 'loading' : 'ok';/);
});

test('F0: the row the POST returns is kept, so the dossier opens before the list reloads', () => {
  const map = zone.dossierMap(
    [{ uid: 'rf_1', name: 'Alpha Ventures' }, { uid: 'rf_2', name: 'alpha-ventures' }],
    { zetadeeptech: 'rf_9', alphaventures: 'rf_stale' },
  );
  assert.equal(map.get('alphaventures'), 'rf_1', 'the list as read wins, and its first row of a name');
  assert.equal(map.get('zetadeeptech'), 'rf_9', 'a row the POST created is a dossier before the reload answers');
  assert.equal(zone.dossierMap(undefined).size, 0);
  const add = ZONE.slice(ZONE.indexOf('const addDirectoryFund'), ZONE.indexOf('const choose'));
  assert.match(add, /const row = await api\.research\.fundCreate\(\{ name: fund\.name, source_url: fund\.website \|\| null \}\);/);
  assert.match(add, /if \(row\?\.uid\) setCreated\(\(rows\) => \(\{ \.\.\.rows, \[normalizeFundName\(fund\.name\)\]: row\.uid \}\)\);/);
  assert.match(add, /if \(!fund \|\| listState !== 'ok' \|\|/);
  assert.match(add, /text: `\$\{fund\.name\} added to My funds\.`/);
  assert.match(ZONE, /const dossiers = useMemo\(\(\) => dossierMap\(items, created\), \[items, created\]\);/);
  assert.match(ZONE, /<FundDirectory researchedNames=\{researchedNames\} onAdd=\{addDirectoryFund\} busy=\{directoryBusy\}\s+dossierOf=\{dossierOf\} listState=\{listState\} notice=\{directoryNote\} onTotal=\{setDirectoryTotal\}/);
});

test('F0: the catalog profile says "Add to my funds", and its way back is the Directory tab', () => {
  const fund = { loading: false, error: null, status: 200, data: { item: ZETA, reports: [], reports_status: 'ok', source_boundary: 'Reported snapshots only.' } };
  const out = html(h(catalog.FundCatalogView, { fund, list: { loading: false, error: null, existing: null }, onAdd() {} }));
  assert.match(out, /<button[^>]*>(<svg[\s\S]*?<\/svg>)? Add to my funds<\/button>/);
  assert.match(out, /<a[^>]*href="\/research\/funds\?view=directory"[^>]*>[\s\S]*?Fund directory<\/a>/);
  // The company page's "See all N in Funds" counts directory funds, so it lands on the directory too.
  const company = read('frontend/src/pages/research/CompanyProfile.jsx');
  assert.equal((company.match(/more="\/research\/funds\?view=directory"/g) || []).length, 2);
  assert.doesNotMatch(company, /more="\/research\/funds"/);
});

// ── F1: Where the money is ──────────────────────────────────────────────────

test('F1: "Where the money is" is the overview’s own money section, drawn once read', () => {
  const out = html(h(zone.MoneyBandView, { state: { phase: 'ready', data: { money: MONEY } } }));
  assert.match(out, /data-testid="funds-money-band" data-state="ready"/);
  assert.match(out, /<section data-testid="research-overview-money">/, 'not the overview’s section, or it kept the overview’s margin');
  const t = renderedText(out);
  assert.match(t, /Where the money is/);
  assert.match(t, /United Kingdom300/);
  assert.match(t, /No HQNot recorded 29/);
  assert.match(t, /€25M–100M410/);
  assert.match(t, /research_fund_directory · 2,616 funds · as of 2026-10-04/);
});

test('F1: loading draws no figure; a failed read says Unreadable and draws no zero', () => {
  const loading = html(h(zone.MoneyBandView, { state: { phase: 'loading' } }));
  assert.match(loading, /data-state="loading"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(renderedText(loading), /Where the money is/);
  assert.doesNotMatch(renderedText(loading), /\d/, 'a figure was drawn before the read answered');
  const failures = [
    { phase: 'error' },
    { phase: 'ready', data: { money: { status: 'unreadable', reason: 'Unreadable' } } },
    { phase: 'ready', data: {} },
  ];
  for (const state of failures) {
    const out = html(h(zone.MoneyBandView, { state, onRetry() {} }));
    const t = renderedText(out);
    assert.match(out, /data-state="unreadable"/, JSON.stringify(state));
    assert.match(t, /Unreadable/);
    assert.match(t, /a failed read is not a directory with no funds/);
    assert.match(out, /<button[^>]*>Try again<\/button>/);
    assert.doesNotMatch(t, /\d/, `an unreadable band drew a figure: ${JSON.stringify(state)}`);
  }
});

test('F1: a money section with nothing recorded says Not recorded with its reason, never 0', () => {
  const state = { phase: 'ready', data: { money: { status: 'not_recorded', reason: 'The fund directory holds no fund yet' } } };
  const t = renderedText(html(h(zone.MoneyBandView, { state })));
  assert.match(t, /Not recorded · The fund directory holds no fund yet/);
  assert.doesNotMatch(t, /\d/);
});

test('F1: the band sits above the directory’s search and list, read through the existing overview method', () => {
  const out = html(h(directory.FundDirectoryView, {
    query: directoryRead.EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null, selected: null,
    onSelect() {}, onClose() {}, result: { loading: false, error: null, data: DATA },
    band: h('div', { 'data-testid': 'band-probe' }),
  }));
  const cover = out.indexOf('data-testid="fund-directory-coverage"');
  const band = out.indexOf('data-testid="band-probe"');
  const search = out.indexOf('id="fd-q"');
  const list = out.indexOf('data-testid="fund-directory-results"');
  assert.ok(cover > 0 && band > cover && search > band && list > search, 'the band is not between the coverage card and the search');
  assert.match(ZONE, /import \{ researchOverviewApi \} from '\.\.\/\.\.\/lib\/api\/researchOverview\.js';/);
  assert.match(ZONE, /import \{ Money \} from '\.\/ResearchOverviewPanel';/);
  assert.match(ZONE, /export function MoneyBand\(\{ load = researchOverviewApi\.get \}\)/);
  assert.match(ZONE, /band=\{directorySeen \? <MoneyBand \/> : null\}/);
  assert.match(ZONE, /useEffect\(\(\) => \{ if \(tab === 'directory'\) setDirectorySeen\(true\); \}, \[tab\]\);/);
});

// ── The dossier ─────────────────────────────────────────────────────────────

test('D: a source recorded without http(s) is shown as written, not as "no source URL on this row"', () => {
  const line = (value) => html(h(dossier.SourceLine, { value }));
  const bare = line('acme.vc');
  assert.match(renderedText(bare), /^acme\.vcrecorded without http\(s\), so it is not linked$/);
  assert.doesNotMatch(bare, /<a /, 'a value with no scheme is linked');
  // An http(s) value is the link it was; example.com stays a placeholder, scheme or not.
  assert.match(line('https://acme.vc'), /<a href="https:\/\/acme\.vc"[^>]*>Their site →<\/a>/);
  assert.doesNotMatch(renderedText(line('https://acme.vc')), /placeholder/);
  assert.match(renderedText(line('https://example.com')), /Their site →https:\/\/example\.com · placeholder/);
  assert.match(renderedText(line('example.com')), /^example\.com · placeholderrecorded without http\(s\)/);
  // Only a blank is Not recorded.
  for (const blank of [null, undefined, '', '   ']) {
    assert.equal(renderedText(line(blank)), 'Not recordedno source URL on this row', JSON.stringify(blank));
  }
  assert.match(DOSSIER, /<SourceLine value=\{fund\.source_url\} \/>/);
  assert.doesNotMatch(DOSSIER, /httpSource/, 'the old two-way test is still deciding the line');
});

test('D: "Stage not assessed" and a path other than warm are drawn in muted ink', () => {
  assert.deepEqual([null, undefined, 'right', 'wrong'].map(dossier.stageTileTone), ['muted', 'muted', 'ok', 'warn']);
  assert.deepEqual([null, 'cold', 'warm'].map(dossier.pathTileTone), ['muted', 'muted', 'ok']);
  const valueClass = (tone) => renderToStaticMarkup(h(dossier.Tile, { k: 'Stage', v: 'Stage not assessed', sub: 'your read, not theirs', tone }))
    .match(/<div class="([^"]*font-mono[^"]*)">Stage not assessed<\/div>/)?.[1].split(' ') || [];
  const muted = valueClass('muted');
  assert.ok(muted.includes('text-axal-muted') && muted.includes('dark:text-gray-400'), `not muted: ${muted.join(' ')}`);
  assert.ok(!muted.includes('text-axal-ink'));
  assert.ok(valueClass('ink').includes('text-axal-ink'), 'the default ink changed');
  assert.match(DOSSIER, /k="Stage"\s+v=\{stageLabel\(fund\.stage_fit\)\}\s+sub="your read, not theirs"\s+tone=\{stageTileTone\(fund\.stage_fit\)\}/);
  assert.match(DOSSIER, /k="Path"\s+v=\{pathLabel\(fund\.path\)\}\s+sub=\{[^}]*\}\s+tone=\{pathTileTone\(fund\.path\)\}/);
});

test('D: the draft button is disabled up front with its reason; a band given none is as it was', () => {
  const reason = 'Record a thesis or a note first — there is nothing to draft from.';
  const band = (extra) => renderToStaticMarkup(h(ZoneDraft, {
    surface: 'research/funds', scopeKey: 'rf_1', scoped: true, accent: 'violet',
    label: 'Proposal · pre-meeting brief', run: 'Draft the brief', empty: 'A short brief from this row alone.', ...extra,
  }));
  const blocked = band({ blocked: reason });
  const button = blocked.match(/<button[^>]*>Draft the brief<\/button>/)?.[0] || '';
  assert.match(button, /disabled=""/, 'the run is still pressable with nothing to draft from');
  const id = button.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(id, 'the disabled button does not name its reason');
  const reasonAt = blocked.indexOf(`<span id="${id}"`);
  assert.ok(reasonAt >= 0, 'the reason the button names is not drawn');
  assert.ok(blocked.startsWith(`${reason}</span>`, blocked.indexOf('>', reasonAt) + 1), 'the named span does not hold the reason');

  const open = band({});
  const openButton = open.match(/<button[^>]*>Draft the brief<\/button>/)?.[0] || '';
  assert.ok(openButton, 'the band without the prop lost its run button');
  assert.doesNotMatch(openButton, /\sdisabled=""|aria-describedby/, 'a mount that passes nothing changed');
  assert.doesNotMatch(open, /zone-draft-blocked/);
  // The press is refused in the handler too, not only by the attribute.
  const src = codeOnly(read('frontend/src/workspaces/ZoneDraft.jsx'));
  assert.match(src.slice(src.indexOf('const doRun = async'), src.indexOf('const doAccept = async')), /^\s*const doRun = async \(\) => \{\s*if \(blocked\) return;/);
  assert.match(src, /blocked = null,/, 'the prop must be optional');
});

test('D: the dossier blocks the band exactly while the saved row holds neither a thesis nor a note', () => {
  const { nothingToDraft } = dossierRead;
  assert.equal(nothingToDraft({ thesis: null, note: null }), true);
  assert.equal(nothingToDraft({ thesis: '', note: '' }), true);
  assert.equal(nothingToDraft({ thesis: 'Pre-seed climate software', note: null }), false);
  assert.equal(nothingToDraft({ thesis: null, note: 'Warm via demo day' }), false);
  assert.equal(nothingToDraft(null), false, 'no row, no band to block');
  const band = DOSSIER.slice(DOSSIER.indexOf('<ZoneDraft'), DOSSIER.indexOf('/>', DOSSIER.indexOf('<ZoneDraft')));
  assert.match(band, /blocked=\{nothingToDraft\(fund\) \? NOTHING_TO_DRAFT : null\}/);
  assert.match(band, /nothingToDraft=\{NOTHING_TO_DRAFT\}/, 'the 409 refusal lost its sentence');
  assert.match(DOSSIER, /const NOTHING_TO_DRAFT = 'Record a thesis or a note first — there is nothing to draft from\.';/);
});

test('D: below lg a live fund’s Pass reason card is left out; a passed fund’s shows at every width', () => {
  const live = dossier.passCardClass({ status: 'researching' }).split(' ');
  assert.ok(live.includes('hidden') && live.includes('lg:block'), `a live fund’s card is drawn on phones: ${live.join(' ')}`);
  const missing = dossier.passCardClass({ status: 'passed', pass_reason: null });
  assert.doesNotMatch(missing, /hidden/);
  assert.match(missing, /border-red-200 dark:border-red-800/, 'a pass with no reason lost its red edge');
  assert.equal(dossier.passCardClass({ status: 'passed', pass_reason: 'Too early — return at $30k MRR' }), '');
  assert.match(DOSSIER, /<Card data-testid="fund-dossier-pass-card" className=\{passCardClass\(fund\)\}>/);
});

// ── My funds: three silent failures found while building the tabs ─────────

test('a save note is the { ok, text } SaveNote reads, so "Added." and a failed save are shown', () => {
  // SaveNote reads `note`; a bare string passed as children drew nothing.
  assert.doesNotMatch(ZONE, /<SaveNote>\s*\{/);
  assert.match(ZONE, /setSaved\(\{ ok: true, text: 'Added\.' \}\)/);
  assert.match(ZONE, /setSaved\(\{ ok: false, text: e\?\.detail \|\| e\?\.message \|\| 'That did not save\.' \}\)/);
  assert.match(ZONE, /<SaveNote note=\{saved\} \/>/);
  // A row's own edit (stage, path, status) says so above the list it changed,
  // not under the Add form.
  const setRead = ZONE.slice(ZONE.indexOf('const setRead = async'), ZONE.indexOf('const add = async'));
  assert.match(setRead, /setRowNote\(\{ ok: false, text: e\?\.detail \|\| e\?\.message \|\| 'That did not save\.' \}\)/);
  assert.doesNotMatch(setRead, /setSaved\(/);
  const profiles = ZONE.slice(ZONE.indexOf('Fund profiles'), ZONE.indexOf('Fund profiles') + 400);
  assert.match(profiles, /<SaveNote note=\{rowNote\} \/>/);
});

test('the zone heading gets the props ZoneHeading reads, so its line and its route-in pill render', () => {
  const heading = ZONE.slice(ZONE.indexOf('<ZoneHeading'), ZONE.indexOf('<FundStat', ZONE.indexOf('<ZoneHeading')));
  assert.match(heading, /\bblurb="Thesis in their words/);
  assert.match(heading, /\baction=\{data \? <Pill/);
  assert.doesNotMatch(heading, /\b(sub|right)=/);
});

test('a stat tile draws no figure while loading, and a failed read is Unreadable, never Not recorded', () => {
  const { FundStat } = zone;
  assert.equal(typeof FundStat, 'function', 'FundStat is not exported');
  const out = (props) => renderToStaticMarkup(React.createElement(FundStat, { label: 'Researched', note: 'funds on file', ...props }));
  const loading = out({ value: undefined, phase: 'loading' });
  assert.match(loading, /aria-label="Loading"/);
  assert.doesNotMatch(loading, /Not recorded|Unreadable/);
  const failed = out({ value: undefined, phase: 'unreadable' });
  assert.match(failed, /Unreadable/);
  assert.doesNotMatch(failed, /Not recorded/);
  assert.match(out({ value: null, phase: 'ok' }), /Not recorded/);
  assert.match(out({ value: 4, phase: 'ok' }), />4</);
  // The zone passes the list's own state to every tile.
  assert.equal((ZONE.match(/<FundStat\b[^>]*?phase=\{listState\}/gs) || []).length, 4);
});
