/**
 * D536 (#1082) — the frontend half of the Research overview: the D527 client
 * module for GET /api/research/overview, the founder desk no longer printing
 * "0 researched" for a missing count nor calling the platform's member
 * companies "the company directory", and the `ResearchOverviewPanel` (to the
 * Research · Main canvas, D546) in its four states and on its three desks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DESK = read('frontend/src/pages/founder/FounderResearchDesk.jsx');

test('researchOverview.js calls the one Worker route, and api.js re-exports it in its block', () => {
  const mod = read('frontend/src/lib/api/researchOverview.js');
  assert.match(mod, /request\(`\/research\/overview\$\{top \? `\?top=\$\{encodeURIComponent\(top\)\}` : ''\}`\)/);
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  assert.match(block, /^export \* from '\.\/api\/researchOverview\.js';$/m);
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.indexOf("app.route('/api/research/overview', researchOverview)") >= 0);
  assert.ok(index.indexOf("app.route('/api/research/overview'") < index.indexOf("app.route('/api/research', research)"),
    'the overview must be mounted before /api/research');
});

/** The helper as the desk defines it, run on its own. */
function fundCountMeta() {
  const src = DESK.match(/function fundCountMeta\(funds\) \{[\s\S]*?\n\}/)[0];
  return new Function(`${src}; return fundCountMeta;`)();
}

test('the fund card never prints a count it was not given', () => {
  assert.doesNotMatch(DESK, /researched_count \?\? 0/, 'the `?? 0` is back');
  const f = fundCountMeta();
  assert.equal(f(undefined), 'Not recorded');
  assert.equal(f({}), 'Not recorded');
  assert.equal(f({ researched_count: null }), 'Not recorded');
  assert.equal(f({ researched_count: 'n/a' }), 'Not recorded');
  assert.equal(f({ researched_count: 3 }), '3 researched');
  assert.equal(f({ researched_count: 0 }), '0 researched', 'an empty store is a fact about the store');
  assert.match(DESK, /meta=\{sourceMeta\('funds', fundCountMeta\(data\.funds\)\)\}/);
});

test('the Company profiles card says it counts platform companies, not the research directory', () => {
  const card = DESK.slice(DESK.indexOf('id="a7-companies"'), DESK.indexOf('</section>', DESK.indexOf('id="a7-companies"')));
  // The count stays `N returned` (research_zone_states pins it, zero included);
  // the card's text names what it counts.
  assert.match(card, /These are the companies on the platform, not the research directory/);
  assert.match(card, /No company on the platform is visible to you yet; the research directory is under Companies/);
  assert.doesNotMatch(card, /available from the company directory/, 'member companies were called the directory');
});

// ---------------------------------------------------------------------------
// The panel (S1 on #1082, the Research · Main canvas, D546). Rendered with
// react-dom/server in its four states; mounted on the three research desks.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_overview_d536.test.mjs
// ---------------------------------------------------------------------------

const PANEL = read('frontend/src/pages/research/ResearchOverviewPanel.jsx');
const { ResearchOverviewView, nothingRecorded, countOf, Delta } = await import('../src/pages/research/ResearchOverviewPanel.jsx');
const { renderedText } = await import('./_renderedText.mjs');
const { codeOnly } = await import('./_codeOnly.mjs');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const html = (state) => renderToStaticMarkup(createElement(ResearchOverviewView, { state }));
const text = (state) => renderedText(html(state));
const SECTORS = ['Agentic B2B', 'Bio-Automation'];
const NR = { status: 'not_recorded', reason: 'No live source yet for this sector' };

function populated() {
  return {
    totals: {
      status: 'ok',
      companies: { value: 300, as_of: '2026-09-30', source: 'x' },
      markets: { value: 82, as_of: '2026-09-30', source: 'x' },
      supplied_companies: { value: 60829, as_of: '2026-09-30', source: 'x' },
      funds: { value: 2032, as_of: '2026-10-04', source: 'x' },
      fund_sources: { value: 2, as_of: '2026-10-04', source: 'x', names: [] },
      countries: { value: 49, as_of: '2026-09-30', source: 'x' },
      sectors: { value: 154, as_of: '2026-09-30', source: 'x' },
      sectors_tracked: { value: 12, as_of: '2026-10-05 04:00:00', source: 'x', sectors: [] },
      market_split: {
        value: null, reason: 'No source records ownership for each company',
        private: { value: 300, as_of: '2026-09-30', source: 'x', note: 'Listing status is not recorded per company.' },
        public: { value: 21, as_of: '2026-09-20', source: 'signal_companies' },
        government: { value: null, as_of: null, source: null, reason: 'No source lists government-owned companies yet' },
      },
    },
    heat: {
      status: 'ok', period_key: '2026-10', period_status: 'month_to_date',
      sectors: SECTORS.map((sector, i) => ({
        sector,
        dimensions: Object.fromEntries(['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'].map((d) => [d,
          i === 0 && d === 'demand' ? { value: 64, delta_pct: 8, source_count: 2 }
            : { value: null, delta_pct: null, source_count: 0, reason: 'No live source yet for this sector' }])),
      })),
    },
    demand_vs_supply: { status: 'ok', period_key: '2026-10', sectors: [{ sector: 'Agentic B2B', demand: 70, supply: 50, demand_delta_pct: 15, supply_delta_pct: 5, gap_pct: 10 }] },
    competition: {
      status: 'ok', as_of: '2026-09-30', total_companies: 300,
      by_sector: [{ label: 'software industry', companies: 40 }], other_sectors: { labels: 144, companies: 211 }, no_sector: 49,
      by_country: [{ country: 'Germany', companies: 60 }], other_countries: { countries: 39, companies: 240 }, no_country: 0,
    },
    money: {
      status: 'ok', as_of: '2026-10-04', total_funds: 2032,
      by_hq: [{ hq: 'United Kingdom', code: 'GB', funds: 300 }], other_hq: { countries: 40, funds: 900 }, hq_unmapped: { values: 3, funds: 7 },
      by_focus: [{ focus: 'FinTech', slug: 'fintech', funds: 120 }], other_focus: { markets: 30, funds: 500 }, focus_unmapped: { values: 2, funds: 400 },
      size_currency: 'EUR', size_note: 'Sizes in euros.', size_bands: [{ band: '€25M–100M', funds: 410 }],
      vintages: [{ year: 2011, funds: 3 }, { year: 2026, funds: 40 }], vintage_range: { from: 2011, to: 2026 },
      missing: { hq: 29, focus: 996, size: 1059, vintage: 1059 },
    },
    signals: {
      status: 'ok', active_count: 10, source: 'x',
      items: [
        { id: 's1', type: 'thesis', title: 'Reconciliation for small banks', sector: 'Fintech', country: 'DE', region: 'Europe',
          why_now: 'Rules changed this year', build_opportunity: { headline: 'A close tool for challenger banks' },
          confidence_score: 72, updated_at: '2026-10-02 10:00:00' },
        { id: 's2', type: 'thesis', title: 'Unscored', sector: 'Health', country: 'US', region: null,
          why_now: null, why_now_reason: 'Not recorded', build_opportunity: null, confidence_score: null,
          confidence_reason: 'Not recorded: no evidence has been scored for this signal yet', updated_at: '2026-09-01' },
      ],
    },
  };
}

function empty() {
  const nr = (reason) => ({ value: null, as_of: null, source: 'x', reason });
  return {
    totals: {
      status: 'ok', companies: nr('The company directory holds no company yet'), markets: nr('none'), supplied_companies: nr('none'),
      funds: nr('none'), fund_sources: { ...nr('none'), names: [] }, countries: nr('none'), sectors: nr('none'),
      sectors_tracked: { value: 12, as_of: null, source: 'x', sectors: [] },
      market_split: { value: null, reason: 'r', private: nr('none'), public: nr('No listed company is recorded yet'), government: { value: null, as_of: null, source: null, reason: 'No source lists government-owned companies yet' } },
    },
    heat: NR, demand_vs_supply: NR,
    competition: { status: 'not_recorded', reason: 'No company in the directory records a sector or a country' },
    money: { status: 'not_recorded', reason: 'The fund directory holds no fund yet' },
    signals: { status: 'not_recorded', reason: 'No active signal yet' },
  };
}

test('panel: loading draws a skeleton and no figure', () => {
  const out = html({ phase: 'loading' });
  assert.match(out, /data-state="loading"/);
  assert.match(out, /data-testid="research-overview-loading"/);
  assert.doesNotMatch(out, /research-overview-body/);
});

test('panel: a failed request is "Unreadable", never an empty overview', () => {
  const out = html({ phase: 'error' });
  assert.match(out, /data-state="error"/);
  assert.match(renderedText(out), /The research overview could not be read\. This is not a sign that the directories are empty\./);
  assert.doesNotMatch(out, /research-overview-body/);
});

test('panel: nothing recorded reads "Not recorded" with each reason, and never a 0', () => {
  const data = empty();
  assert.equal(nothingRecorded(data), true);
  const out = html({ phase: 'ready', data });
  assert.match(out, /data-state="empty"/);
  const t = renderedText(out);
  assert.match(t, /No directory, index or signal holds a record yet/);
  assert.match(t, /No company in the directory records a sector or a country/);
  assert.match(t, /The fund directory holds no fund yet/);
  assert.match(t, /No active signal yet/);
  assert.match(t, /No live source yet for this sector/);
  // "0 to 100" is the index scale and "CC0" a licence; no other 0 may appear.
  assert.doesNotMatch(t.replace(/\b0 to 100\b/g, ''), /(^|[^\w.,])0(?![\d%]|[.,]\d)/, 'a 0 was drawn for a figure that is not recorded');
  assert.equal(nothingRecorded(populated()), false);
});

test('panel: populated draws the totals, the split, the grid, the competition, the money and the signals', () => {
  const t = text({ phase: 'ready', data: populated() });
  for (const s of ['300', '82', '60,829', '2,032', 'from 2 public fund lists', '49', 'Sectors tracked', '12',
    'last computed 2026-10-05 04:00', '21', 'listed companies']) assert.ok(t.includes(s), `missing ${s}`);
  // The grid: a live cell with its change, a cell with no live source.
  assert.match(t, /Agentic B2B64 ▲ 8\.0%Not recordedNot recorded/, 'a cell with no live source must not read 0');
  assert.match(t, /Bio-Automation(Not recorded){6}market_intel_indexes/);
  assert.match(t, /2026-10 · month to date/);
  // Demand against supply.
  assert.match(t, /\+10pp/);
  // Who is already building: the remainders and the missing counts.
  assert.match(t, /144 other labels211/);
  assert.match(t, /No sector labelNot recorded 49/);
  assert.match(t, /39 more countries240/);
  assert.match(t, /No countryNot recorded 0/, 'a recorded count of zero companies without a country is a fact about the store');
  // Where the money is: crosswalked names, remainders, unmapped, missing, currency, vintages.
  assert.match(t, /United Kingdom300/);
  assert.match(t, /Other HQs \(40 countries\)900/);
  assert.match(t, /HQ text not matched to a country7/);
  assert.match(t, /No HQNot recorded 29/);
  assert.match(t, /FinTech120/);
  assert.match(t, /€25M–100M410/);
  assert.match(t, /Size missing or in no known currencyNot recorded 1,059/);
  assert.match(t, /2011 to 2026/);
  // Signals: why now, what to build, region, confidence; the defaults are not values.
  assert.match(t, /Europe · DE/);
  assert.match(t, /Rules changed this year/);
  assert.match(t, /A close tool for challenger banks/);
  assert.match(t, /Confidence 72\/100/);
  assert.match(t, /Not recorded · US/);
  assert.match(t, /Confidence Not recorded/);
  assert.match(t, /10 active/);
});

test('panel: government reads "Not recorded" with its reason, never a number', () => {
  const out = html({ phase: 'ready', data: populated() });
  const start = out.lastIndexOf('<', out.indexOf('data-testid="split-government"'));
  const card = renderedText(out.slice(start, out.indexOf('</section>', start)));
  assert.equal(card, 'GovernmentNot recordedNo source lists government-owned companies yet');
  assert.doesNotMatch(card, /\d/, 'the government card drew a figure');
  // And the route's government total is drawn the same way however little else is recorded.
  const e = html({ phase: 'ready', data: empty() });
  const s2 = e.lastIndexOf('<', e.indexOf('data-testid="split-government"'));
  assert.equal(renderedText(e.slice(s2, e.indexOf('</section>', s2))), 'GovernmentNot recordedNo source lists government-owned companies yet');
});

test('panel: one unreadable section says so; the others still draw', () => {
  const data = populated();
  data.money = { status: 'unreadable', reason: 'Unreadable' };
  data.totals.market_split.public = { value: null, as_of: null, source: 'x', reason: 'Unreadable' };
  const t = text({ phase: 'ready', data });
  assert.match(t, /The fund directory could not be read\. That is a failed read, not a sign that nothing is recorded\./);
  assert.match(t, /PublicListed companiesUnreadable/);
  assert.match(t, /144 other labels/, 'competition still drew');
  assert.match(t, /Rules changed this year/, 'signals still drew');
});

test('panel: a count the route did not send is "Not recorded", never 0', () => {
  assert.equal(countOf(undefined), 'Not recorded');
  assert.equal(countOf(null), 'Not recorded');
  assert.equal(countOf('n/a'), 'Not recorded');
  assert.equal(countOf(0), '0');
  assert.equal(countOf(1059), '1,059');
  const data = populated();
  delete data.competition.no_sector;
  delete data.money.missing;
  const t = text({ phase: 'ready', data });
  assert.match(t, /No sector labelNot recordedWhere they are based/, 'an absent count was printed');
  assert.match(t, /No HQNot recordedFunds by stated focus/, 'an absent count was printed');
  assert.match(t, /Vintage missingNot recordedresearch_fund_directory/, 'an absent count was printed');
  assert.doesNotMatch(PANEL, /\?\? 0/, 'the panel defaults a count to 0');
});

test('panel: never renders or names the advisor note, and its copy keeps the voice rule', () => {
  const data = populated();
  data.signals.items[0].advisor_note = 'ADVISOR-NOTE-SENTINEL';
  const out = html({ phase: 'ready', data });
  assert.ok(!out.includes('ADVISOR-NOTE-SENTINEL'));
  assert.ok(!/advisor/i.test(renderedText(out)), 'the panel drew the word advisor');
  assert.doesNotMatch(codeOnly(PANEL), /advisor_note/);
  assert.doesNotMatch(codeOnly(PANEL), /advice|recommend|fiduciary/i);
});

test('panel: mounted on the founder desk, the investor workspace and the advisor and partner board', () => {
  const desk = codeOnly(DESK);
  assert.match(desk, /^import ResearchOverviewPanel from '\.\.\/research\/ResearchOverviewPanel';$/m);
  assert.match(desk, /<ResearchOverviewPanel \/>/);
  const inv = codeOnly(read('frontend/src/pages/investor/InvestorResearchWorkspace.jsx'));
  assert.match(inv, /^import ResearchOverviewPanel from '\.\.\/research\/ResearchOverviewPanel';$/m);
  assert.match(inv, /<ResearchOverviewPanel \/>/);
  const ws = codeOnly(read('frontend/src/workspaces/ResearchWorkspace.jsx'));
  assert.match(ws, /^import ResearchOverviewPanel from '\.\.\/pages\/research\/ResearchOverviewPanel';$/m);
  const boardBranch = ws.slice(ws.indexOf('if (board) return'), ws.indexOf('</>;', ws.indexOf('if (board) return')));
  assert.match(boardBranch, /<ResearchOverviewPanel \/>[\s\S]*<BucketBoard /, 'the panel sits above the advisor and partner board');
  // The board is the advisor and partner root: both registered, so both get the panel.
  const boards = read('frontend/src/workspaces/boards/index.js');
  assert.match(boards, /'partner:\/research': researchBoard/);
  assert.match(boards, /'advisor:\/research': researchBoard/);
  // The panel reads the one overview route through its D527 module.
  assert.match(PANEL, /import \{ researchOverviewApi \} from '\.\.\/\.\.\/lib\/api\/researchOverview\.js';/);
  assert.match(PANEL, /load = researchOverviewApi\.get/);
});

test('the founder desk prints "Not recorded" for every fund figure it was not sent, never ?? 0', () => {
  assert.doesNotMatch(DESK, /\?\? 0/, 'a `?? 0` is back on the founder desk');
  const src = DESK.match(/function fundFigure\(n\) \{[\s\S]*?\n\}/)[0];
  const f = new Function(`${src}; return fundFigure;`)();
  assert.equal(f(undefined), 'Not recorded');
  assert.equal(f(null), 'Not recorded');
  assert.equal(f('x'), 'Not recorded');
  assert.equal(f(0), 0);
  assert.equal(f(4), 4);
  for (const k of ['right_stage_count', 'warm_path_count', 'passed_count']) {
    assert.match(DESK, new RegExp(`\\{fundFigure\\(funds\\.${k}\\)\\}`), `${k} is printed raw`);
  }
  // The overlap keeps the literal null check founder_research_a7_contract pins, then the same helper.
  assert.match(DESK, /\{funds\.cheque_overlap_count == null \? 'Not recorded' : fundFigure\(funds\.cheque_overlap_count\)\}/);
});

test('panel: a public-company count alone is a record, so the overview is not "empty"', () => {
  const data = empty();
  data.totals.market_split.public = { value: 21, as_of: '2026-10-05', source: 'signal_companies', reason: null };
  assert.equal(nothingRecorded(data), false);
  const out = html({ phase: 'ready', data });
  assert.doesNotMatch(out, /data-state="empty"/);
  assert.doesNotMatch(renderedText(out), /No directory, index or signal holds a record yet/);
  // An unreadable public count is not a claim of emptiness either.
  data.totals.market_split.public = { value: null, as_of: null, source: 'signal_companies', reason: 'Unreadable' };
  assert.equal(nothingRecorded(data), false);
});

test('panel: an unchanged index reads "= 0.0%" with no arrow; rises and falls keep theirs', () => {
  const d = (pct) => renderedText(renderToStaticMarkup(createElement(Delta, { pct })));
  assert.equal(d(0), '= 0.0%');
  assert.equal(d(0.04), '= 0.0%', 'a change that rounds to 0.0% is drawn as a rise');
  assert.equal(d(-0.04), '= 0.0%');
  assert.equal(d(2.5), '▲ 2.5%');
  assert.equal(d(-1.2), '▼ 1.2%');
  assert.equal(d(null), '');
});

test('panel (#1077): the Public card prints the server\'s split of the two stores, and names both', () => {
  const data = populated();
  data.totals.market_split.public = {
    value: 23, as_of: '2026-10-06', source: 'signal_companies + research_public_companies (SEC EDGAR)', reason: null,
    note: '21 signal companies with their bands, and 2 from SEC EDGAR with ticker and exchange only.',
  };
  const out = html({ phase: 'ready', data });
  const card = renderedText(out.slice(out.indexOf('data-testid="split-public"'), out.indexOf('data-testid="split-government"')));
  assert.match(card, /21 signal companies with their bands, and 2 from SEC EDGAR with ticker and exchange only\./);
  assert.match(card, /signal_companies \+ SEC EDGAR/);
  assert.doesNotMatch(card, /market-cap band and employee band/, 'EDGAR rows carry no bands, so the card cannot claim every row does');
});
