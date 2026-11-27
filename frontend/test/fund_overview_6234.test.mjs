/**
 * #6234 (D6234) — the Fund overview (IF0) and a fund's quarterly history (IF5):
 *
 *   · four tiles, each Not recorded with its reason when its source is absent;
 *   · the chart plots issued periods only; a missing figure is hatched, never 0;
 *   · the gap list's four rules, computed from the period records, each open row
 *     linking to where it is fixed;
 *   · the history lists every period, drafts included, and exports the series.
 *
 * Every fund, period and figure is made up. `today` is passed in; nothing reads the clock.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_overview_6234.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  CSV_HEADER, chartGroups, historyCsvRows, historyRows, overviewTiles, packGaps, periodFigures, reportingQuarter,
} from '../src/pages/investor/fundOverviewModel.js';
import FundOverviewPanel from '../src/pages/investor/FundOverviewParts.jsx';
import FundHistoryPage, { HistoryBody } from '../src/pages/investor/FundHistoryPage.jsx';
import InvestorFundLanding from '../src/pages/investor/InvestorFundLanding.jsx';
import { toCsv } from '../src/lib/csvExport.js';

const h = React.createElement;
const TODAY = new Date(Date.UTC(2026, 10, 15)); // 15 Nov 2026: the next pack reports on Q3 2026.

const FUND = { id: 7, name: 'Example Fund I', status: 'active', committed_cents: 1000000000, called_cents: 350000000, collected_cents: 328000000, capital_state: 'recorded', capital_reason: null, deployed_cents: 239000000, distributed_cents: 0, lp_count: 3 };

const pack = (o = {}) => ({ schema: 'lp_quarterly_report/1', currency: 'USD', totals: { commitments: { cents: 850000000 }, called_to_date: { cents: 255000000 }, receipts_to_date: { cents: 230000000 } }, fund_figures: { nav: { cents: null, reason: 'Not recorded: no dated mark on any position' } }, ...o });
const issueSnap = { currency: 'USD', totals: { committed_cents: 1000000000, invested_cents: 239000000, committed_reason: null, invested_reason: null } };
const Q1 = { id: 11, period: 'Q1 2026', period_start: '2026-01-01', period_end: '2026-03-31', status: 'issued', issued_at: '2026-04-14T10:00:00Z', narrative: { letter: ['Q1 letter.'] }, snapshot: pack() };
const Q2 = { id: 12, period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', status: 'issued', issued_at: '2026-07-16T10:00:00Z', narrative: { letter: ['Q2 letter.'] }, snapshot_json: JSON.stringify(issueSnap), snapshot: null };
const Q3D = { id: 13, period: 'Q3 2026', period_start: '2026-07-01', period_end: '2026-09-30', status: 'draft', issued_at: null, narrative: { letter: [] }, snapshot: null, snapshot_json: null };
const PERIODS = [Q3D, Q2, Q1];

const tile = (tiles, key) => tiles.find((t) => t.key === key);
const gap = (g, key) => g.rows.find((r) => r.key === key);

// Mutation checked: Called null drawn as 0 (fails); the unreadable reason swapped for the default (fails);
// dry powder computed from called (fails); dry powder drawn with collected missing (fails).
test('#6234 tiles: Committed, Called, Deployed, Dry powder; each Not recorded with a reason when its source is absent', () => {
  const full = overviewTiles(FUND);
  assert.deepEqual(full.map((t) => t.label), ['Committed', 'Called', 'Deployed', 'Dry powder']);
  assert.deepEqual(full.map((t) => t.cents), [1000000000, 350000000, 239000000, 89000000], 'dry powder is collected less deployed');
  assert.ok(full.every((t) => t.reason === null));

  const noCalls = overviewTiles({ ...FUND, called_cents: null, collected_cents: null, capital_state: 'not_recorded', capital_reason: 'No dated capital-call receipts are recorded.' });
  assert.equal(tile(noCalls, 'called').cents, null);
  assert.equal(tile(noCalls, 'called').reason, 'No capital call is recorded on this fund.');
  assert.equal(tile(noCalls, 'dry').cents, null);
  assert.equal(tile(noCalls, 'dry').reason, 'Needs Collected: No dated capital-call receipts are recorded.');

  const unreadable = overviewTiles({ ...FUND, called_cents: null, collected_cents: null, capital_state: 'unreadable', capital_reason: 'The ledger read failed.' });
  assert.equal(tile(unreadable, 'called').reason, 'The ledger read failed.');

  const noDeployed = overviewTiles({ ...FUND, deployed_cents: null, committed_cents: undefined });
  assert.equal(tile(noDeployed, 'deployed').reason, 'No deployed capital is recorded on the fund.');
  assert.equal(tile(noDeployed, 'dry').reason, 'Needs Deployed: no deployed capital is recorded on the fund.');
  assert.equal(tile(noDeployed, 'committed').reason, 'No commitment is recorded on this fund.');

  const zero = overviewTiles({ ...FUND, called_cents: 0 });
  assert.equal(tile(zero, 'called').cents, 0, 'a recorded 0 is a figure');
  assert.equal(tile(zero, 'called').reason, null);
});

// Mutation checked: drafts kept in chartGroups (fails); a missing figure as cents 0 (fails); hatched on a real 0 (fails);
// newest-first order (fails); the issue snapshot's invested read as Called (fails).
test('#6234 hatch rule: issued periods only, oldest first; a missing figure is hatched, a draft never plots', () => {
  const groups = chartGroups(PERIODS);
  assert.deepEqual(groups.map((g) => g.label), ['Q1 2026', 'Q2 2026'], 'the Q3 draft is not on the chart');
  const q1 = Object.fromEntries(groups[0].bars.map((b) => [b.key, b]));
  assert.equal(q1.committed.cents, 850000000);
  assert.equal(q1.called.cents, 255000000);
  assert.equal(q1.collected.cents, 230000000);
  assert.equal(q1.deployed.cents, null);
  assert.equal(q1.deployed.hatched, true, 'the pack carries no deployed figure: hatched, not 0');
  assert.equal(q1.committed.hatched, false);
  const q2 = Object.fromEntries(groups[1].bars.map((b) => [b.key, b]));
  assert.equal(q2.deployed.cents, 239000000, 'the issue snapshot carries invested as deployed');
  assert.equal(q2.called.hatched, true);
  assert.equal(q2.called.cents, null);
  const zero = chartGroups([{ ...Q1, snapshot: pack({ totals: { commitments: { cents: 0 }, called_to_date: { cents: 0 }, receipts_to_date: { cents: 0 } } }) }]);
  assert.equal(zero[0].bars[0].cents, 0);
  assert.equal(zero[0].bars[0].hatched, false, 'a measured 0 is a figure, not a gap');
  assert.deepEqual(chartGroups([Q3D]), [], 'drafts alone draw nothing');
  assert.equal(periodFigures({ status: 'issued', snapshot_json: '{nope' }).committed.reason, 'The frozen snapshot could not be read.');
});

test('#6234 the reporting quarter is the last calendar quarter that has ended', () => {
  assert.deepEqual(reportingQuarter(TODAY), { label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(reportingQuarter(new Date(Date.UTC(2026, 1, 10))), { label: 'Q4 2025', start: '2025-10-01', end: '2025-12-31' });
  assert.deepEqual(reportingQuarter(new Date(Date.UTC(2026, 3, 1))), { label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' });
});

// Mutation checked: an issued snapshot in another quarter counted (fails); a draft counted as issued (fails);
// the draft's link dropped for the zone (fails).
test('#6234 gap rule 1: an issued snapshot this quarter', () => {
  const draftOnly = gap(packGaps({ fundId: 7, periods: PERIODS, today: TODAY }), 'issued');
  assert.equal(draftOnly.done, false);
  assert.equal(draftOnly.detail, 'Q3 2026 is drafted, not issued. LPs read issued periods only.');
  assert.equal(draftOnly.href, '/funds/7/reporting/13', 'opens the draft');
  const none = gap(packGaps({ fundId: 7, periods: [Q1, Q2], today: TODAY }), 'issued');
  assert.equal(none.done, false);
  assert.equal(none.href, '/funds/reporting?fund=7');
  const issued = gap(packGaps({ fundId: 7, periods: [{ ...Q3D, status: 'issued', issued_at: '2026-10-20T09:00:00Z' }], today: TODAY }), 'issued');
  assert.equal(issued.done, true);
  assert.equal(issued.href, undefined);
});

// Mutation checked: NAV taken from a draft or another quarter (fails); a null NAV counted present (fails); ledger link dropped (fails).
test('#6234 gap rule 2: NAV present in this quarter\'s issued snapshot', () => {
  const none = gap(packGaps({ fundId: 7, periods: PERIODS, today: TODAY }), 'nav');
  assert.equal(none.done, false);
  assert.equal(none.href, '/funds/ledger?fund=7');
  const noNav = gap(packGaps({ fundId: 7, periods: [{ ...Q3D, status: 'issued', snapshot: pack() }], today: TODAY }), 'nav');
  assert.equal(noNav.done, false);
  assert.equal(noNav.detail, 'Not recorded: no dated mark on any position');
  assert.equal(noNav.href, '/funds/ledger?fund=7');
  const withNav = gap(packGaps({ fundId: 7, periods: [{ ...Q3D, status: 'issued', snapshot: pack({ fund_figures: { nav: { cents: 412345678 } } }) }], today: TODAY }), 'nav');
  assert.equal(withNav.done, true);
  assert.equal(withNav.detail, 'NAV $4,123,456.78 in the Q3 2026 snapshot.');
});

// Mutation checked: an empty letter counted written (fails); a blank paragraph counted (fails); editor link dropped (fails).
test('#6234 gap rule 3: the letter is written', () => {
  const empty = gap(packGaps({ fundId: 7, periods: PERIODS, today: TODAY }), 'letter');
  assert.equal(empty.done, false);
  assert.equal(empty.href, '/funds/7/reporting/13');
  assert.equal(gap(packGaps({ fundId: 7, periods: [{ ...Q3D, narrative: { letter: ['   '] } }], today: TODAY }), 'letter').done, false);
  assert.equal(gap(packGaps({ fundId: 7, periods: [{ ...Q3D, narrative: { letter: ['Dear LPs.'] } }], today: TODAY }), 'letter').done, true);
  assert.equal(gap(packGaps({ fundId: 7, periods: [{ ...Q3D, narrative: undefined, notes: JSON.stringify({ letter: ['From notes.'] }) }], today: TODAY }), 'letter').done, true, 'the raw notes are read too');
  assert.equal(gap(packGaps({ fundId: 7, periods: [], today: TODAY }), 'letter').href, '/funds/reporting?fund=7');
});

// Mutation checked: issued counted as delivered (fails); a delivery record ignored (fails).
test('#6234 gap rule 4: delivery recorded — issued is not delivered', () => {
  const issued = { ...Q3D, status: 'issued', issued_at: '2026-10-20T09:00:00Z' };
  const open = gap(packGaps({ fundId: 7, periods: [issued], today: TODAY }), 'delivery');
  assert.equal(open.done, false);
  assert.equal(open.detail, 'Issued is not delivered: no delivery of Q3 2026 is recorded.');
  assert.equal(open.href, '/funds/reporting?fund=7');
  assert.equal(gap(packGaps({ fundId: 7, periods: [{ ...issued, delivery_count: 3 }], today: TODAY }), 'delivery').done, true);
  assert.equal(gap(packGaps({ fundId: 7, periods: [Q3D], today: TODAY }), 'delivery').done, false, 'a draft is never delivered');
  // D6240: per-LP counts decide when the reply carries them; a D6255 receipt alone does not make a legacy period recorded.
  const legacy = { ...issued, delivery_status: 'sent', delivered_count: 2, lp_delivery: { state: 'not_recorded' } };
  assert.equal(gap(packGaps({ fundId: 7, periods: [legacy], today: TODAY }), 'delivery').done, false);
  assert.equal(gap(packGaps({ fundId: 7, periods: [{ ...legacy, lp_delivery: { state: 'recorded', delivered: 2, total: 3 } }], today: TODAY }), 'delivery').done, true);
  assert.equal(packGaps({ fundId: 7, periods: null, today: TODAY }).rows, null, 'an unreadable archive claims no row either way');
});

// Mutation checked: drafts dropped from the history (fails); a missing figure exported as 0 (fails); cents divided by hand (fails on the exact text).
test('#6234 history rows include drafts; the CSV is exact and leaves a missing figure empty', () => {
  const rows = historyRows(PERIODS);
  assert.deepEqual(rows.map((r) => [r.label, r.status]), [['Q3 2026', 'draft'], ['Q2 2026', 'issued'], ['Q1 2026', 'issued']]);
  const csv = historyCsvRows(rows);
  assert.deepEqual(CSV_HEADER.slice(0, 4), ['period', 'period_start', 'period_end', 'status']);
  assert.deepEqual(csv[2], ['Q1 2026', '2026-01-01', '2026-03-31', 'issued', '2026-04-14', 'report_pack', '8500000.00', '2550000.00', '2300000.00', null, null, null]);
  assert.deepEqual(csv[1].slice(6), ['10000000.00', null, null, '2390000.00', null, null]);
  assert.equal(csv[0][3], 'draft');
  const text = toCsv(CSV_HEADER, csv);
  assert.equal(text.split('\r\n')[3], 'Q1 2026,2026-01-01,2026-03-31,issued,2026-04-14,report_pack,8500000.00,2550000.00,2300000.00,,,');
  assert.equal(historyCsvRows(historyRows([{ ...Q1, snapshot: pack({ totals: { commitments: { cents: 123456 } } }) }]))[0][6], '1234.56');
});

/* ------------------------------------------------------------------ render */

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

async function mount(element, routes) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const url = String(u);
    for (const [re, answer] of routes) if (re.test(url)) return answer(url);
    return json({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/funds?fund=7'] }, element)));
  await act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const all = () => walk(container);
  const byId = (id) => all().find((n) => props(n)['data-testid'] === id);
  return {
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => !!byId(id),
    href: (id) => props(byId(id)).href ?? null,
    props: (id) => props(byId(id)),
    nodes: (pred) => all().filter((n) => pred(props(n), n)),
    async click(id) { await act(async () => { props(byId(id)).onClick?.(); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, prev); restore(); },
  };
}

const periodsRoute = (items, status = 200) => [/\/api\/funds\/7\/report-periods/, () => (status === 200 ? json({ ok: true, items }) : json({ error: 'unreadable' }, status))];

// Mutation checked: the panel unmounted from the landing (fails); hatched rects drawn as zero bars (fails);
// the draft plotted (fails); gap links lost (fails); the Gaps filter showing done rows (fails); a done row with a link (fails).
test('#6234 mounted overview: tiles with reasons, hatched gaps on the chart, no draft, gap links, filters', async () => {
  const v = await mount(h(FundOverviewPanel, { fund: { ...FUND, collected_cents: null, capital_reason: 'No dated capital-call receipts are recorded.' }, today: TODAY }), [periodsRoute([{ ...Q3D, narrative: { letter: ['Draft letter.'] } }, Q2, Q1])]);
  try {
    assert.match(v.textOf('tile-committed'), /\$10,000,000\.00/);
    assert.equal(v.textOf('tile-dry-reason'), 'Not recordedNeeds Collected: No dated capital-call receipts are recorded.');
    const groups = v.nodes((p) => p['data-group'] != null).map((n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))[1]['data-group']);
    assert.deepEqual(groups, ['Q1 2026', 'Q2 2026'], 'issued only');
    const hatched = v.nodes((p) => p['data-hatched'] === 'true').map((n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))[1]['data-series']);
    assert.deepEqual(hatched.sort(), ['called', 'collected', 'deployed'], 'Q1 deployed; Q2 called and collected');
    assert.equal(v.href('link-fund-history'), '/funds/history?fund=7');
    assert.equal(v.props('gap-issued')['data-done'], 'false');
    assert.equal(v.href('gap-issued-fix'), '/funds/7/reporting/13');
    assert.equal(v.href('gap-nav-fix'), '/funds/ledger?fund=7');
    assert.equal(v.props('gap-letter')['data-done'], 'true', 'the Q3 draft has its letter');
    assert.equal(v.has('gap-letter-fix'), false, 'a done row links nowhere');
    assert.equal(v.href('gap-delivery-fix'), '/funds/reporting?fund=7');
    await v.click('filter-overview-gaps');
    assert.equal(v.has('fund-overview-chart'), false, 'Gaps shows the gap list alone');
    assert.equal(v.has('tile-committed'), false);
    assert.equal(v.has('gap-issued'), true);
    assert.equal(v.has('gap-letter'), false, 'Gaps lists open rows only');
    await v.click('filter-overview-quarter');
    assert.equal(v.has('fund-quarter-periods'), true);
    assert.match(v.textOf('fund-quarter-periods'), /Q3 2026\s*Draft/);
    await v.click('filter-overview-overview');
    assert.equal(v.has('fund-overview-chart'), true);
  } finally { await v.close(); }
});

// Mutation checked: an unreadable archive drawn as "no issued snapshot" (fails); an empty archive drawn as unreadable (fails).
test('#6234 mounted overview: empty and unreadable archives say different things', async () => {
  const empty = await mount(h(FundOverviewPanel, { fund: FUND, today: TODAY }), [periodsRoute([])]);
  try {
    assert.match(empty.textOf('text-chart-empty'), /No issued quarterly snapshot/);
    assert.doesNotMatch(empty.text(), /could not be read/);
  } finally { await empty.close(); }
  const broken = await mount(h(FundOverviewPanel, { fund: FUND, today: TODAY }), [periodsRoute([], 503)]);
  try {
    assert.match(broken.textOf('fund-overview-chart'), /The reporting archive could not be read\. This is not a claim that nothing was issued\./);
    assert.match(broken.textOf('fund-pack-gaps'), /No gap is claimed open or closed/);
    assert.equal(broken.has('text-chart-empty'), false);
    assert.match(broken.textOf('tile-committed'), /\$10,000,000\.00/, 'the tiles stand when the archive fails');
  } finally { await broken.close(); }
});

test('#6234 the landing mounts the overview panel for the chosen fund', async () => {
  const v = await mount(h(InvestorFundLanding, { fundUnlocked: true }), [
    [/\/api\/funds\/analytics/, () => json({ items: [FUND], totals: null, unavailable: {} })],
    periodsRoute(PERIODS),
    [/\/api\/capital\/calls/, () => json([])],
    [/\/api\/funds\/7\/lps/, () => json({ items: [] })],
  ]);
  try {
    assert.equal(v.has('fund-overview-panel'), true);
    assert.match(v.textOf('tile-deployed'), /\$2,390,000\.00/);
    assert.equal(v.href('link-fund-history'), '/funds/history?fund=7');
  } finally { await v.close(); }
});

// Mutation checked: drafts dropped from the table (fails); a missing figure shown as $0.00 (fails); export disabled with rows (fails).
test('#6234 mounted history: every period incl. drafts with its figures; empty and unreadable states', async () => {
  const fund = { id: 7, name: 'Example Fund I' };
  const v = await mount(h(HistoryBody, { fund, periods: PERIODS, today: TODAY, onRetry() {} }), []);
  try {
    assert.equal(v.props('history-row-13')['data-status'], 'draft');
    assert.equal(v.props('history-row-11')['data-status'], 'issued');
    assert.equal(v.textOf('history-11-committed'), '$8,500,000.00');
    assert.match(v.textOf('history-11-deployed'), /^Not recorded: The issued pack does not carry deployed capital\.$/);
    assert.match(v.textOf('history-12-dry'), /^Not recorded/);
    assert.equal(v.textOf('history-12-deployed'), '$2,390,000.00');
    assert.equal(v.props('button-export-series').disabled, false);
    assert.match(v.textOf('history-tile-issued'), /2/);
    assert.match(v.textOf('history-tile-latest'), /Q2 2026/);
    assert.doesNotMatch(v.text(), /\$0\.00/);
  } finally { await v.close(); }
  const empty = await mount(h(HistoryBody, { fund, periods: [], today: TODAY, onRetry() {} }), []);
  try {
    assert.match(empty.textOf('text-history-empty'), /No reporting period is recorded/);
    assert.equal(empty.props('button-export-series').disabled, true);
    assert.match(empty.textOf('history-tile-latest'), /Nothing is issued yet/);
  } finally { await empty.close(); }
  const broken = await mount(h(HistoryBody, { fund, periods: 'unreadable', today: TODAY, onRetry() {} }), []);
  try {
    assert.match(broken.textOf('history-unreadable'), /could not be read\. This is not a claim that no period exists\./);
    assert.equal(broken.has('history-table'), false);
  } finally { await broken.close(); }
});

test('#6234 history page: the fund comes from ?fund= among the funds the caller runs', async () => {
  const v = await mount(h(FundHistoryPage, { today: TODAY }), [
    periodsRoute(PERIODS),
    [/\/api\/funds(\?|$)/, () => json({ items: [{ id: 3, name: 'LP-only Fund', can_manage: false }, { id: 7, name: 'Example Fund I', can_manage: true }] })],
  ]);
  try {
    assert.equal(v.has('history-table'), true);
    assert.equal(v.href('link-history-overview'), '/funds?fund=7');
  } finally { await v.close(); }
  const none = await mount(h(FundHistoryPage, { today: TODAY }), [[/\/api\/funds(\?|$)/, () => json({ items: [] })]]);
  try {
    assert.equal(none.has('history-no-fund'), true);
  } finally { await none.close(); }
});

test('#6234 the history route is /funds/history in its own module, ahead of /funds/:fundId by specificity', () => {
  const src = readFileSync(new URL('../src/routes/fundHistory.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Route path="\/funds\/history" element=\{guard\(\['admin', 'investor'\]/);
  assert.match(src, /lazy\(\(\) => import\('\.\.\/pages\/investor\/FundHistoryPage'\)\)/);
});
