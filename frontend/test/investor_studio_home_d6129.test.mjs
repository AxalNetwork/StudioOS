/**
 * D6129 (#6129, canvas D6126 SM16 to SM27): Investor Studio home v2's five
 * modules and the thesis band. The rules are `investorHomeModel.js`, pure, with
 * `today` handed in (never the clock); the tiles are rendered with the props the
 * home passes. Each module is loading, Not recorded, Unreadable or ready, and an
 * administrator's preview withholds every one.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_studio_home_d6129.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  arrivalsOf, fitOf, fundsOf, needsYouRows, returnsOf, shortDay, thesisGroups,
} from '../src/pages/investor/investorHomeModel.js';
import { INVESTOR_KEYS, investorTiles } from '../src/pages/studio/tiles/investorTiles.jsx';
import { ThesisBandView, thesisBandState } from '../src/pages/investor/InvestorThesisBand.jsx';
import { quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { FALLBACK_DEFAULTS, FALLBACK_TITLES } from '../src/pages/studio/studioFallback.js';
import { renderedText } from './_renderedText.mjs';

const TODAY = '2026-11-14';
const draw = (el) => renderedText(renderToStaticMarkup(h(MemoryRouter, null, el)));
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const PORTAL = {
  lp_holdings: [
    { id: 11, fund_id: 1, fund_name: 'Fund A', commitment_amount: 250000, invested_amount: 150000, lpa_signed: 1, lpa_signed_at: '2026-02-03', commitment_date: '2026-01-10' },
    { id: 12, fund_id: 2, fund_name: 'Fund B', commitment_amount: 100000, invested_amount: 0, lpa_signed: 0, commitment_date: '2026-11-09' },
  ],
  capital_calls_recorded: true,
  capital_calls: [
    { id: 1, fund_id: 1, limited_partner_id: 11, call_number: 1, owed_cents: 10000000, received_cents: 10000000, status: 'paid', due_date: '2026-03-01', created_at: '2026-02-10' },
    { id: 2, fund_id: 1, limited_partner_id: 11, call_number: 3, owed_cents: 5000000, received_cents: 0, status: 'pending', due_date: '2026-11-20', created_at: '2026-11-06',
      pay_instructions: { available: true, account_masked: '••••4821', reference: 'AXF1-C3-0042', bank_name: 'Bank' } },
  ],
  performance: [
    { lp_id: 11, invested_amount: 150000, tvpi: 1.18, dpi: 0.12 },
    { lp_id: 12, invested_amount: 0, tvpi: null, dpi: null },
  ],
  capital_statements_recorded: true,
  capital_statements: [{ uid: 's1', fund_id: 1, period_label: 'Q3 2026', issued_at: '2026-11-10 09:00:00' }],
  report_periods: [{ id: 7, fund_id: 1, period: 'Q3 2026', issued_at: '2026-11-04' }],
};
const NOTICES = { notices: [
  { uid: 'n1', type: 'mgmt_fee_invoice', title: 'Management Fee Invoice', fund_id: 1, limited_partner_id: 11, amount_cents: 125000, notice_date: '2026-11-06', due_date: '2026-11-30', superseded: false },
  { uid: 'n0', type: 'mgmt_fee_invoice', title: 'Old invoice', fund_id: 1, limited_partner_id: 11, amount_cents: 1, notice_date: '2026-10-01', superseded: true },
  { uid: 'n2', type: 'capital_call_notice', title: 'Capital call', fund_id: 1, limited_partner_id: 11, call_number: '3', notice_date: '2026-11-06', superseded: false },
] };
const TRUST = { obligations: [
  { obligation_key: 'kyc_v1', required: 1, status: 'pending', expires_at: '2026-12-01', created_at: '2026-11-01' },
  { obligation_key: 'tos_v1', required: 1, status: 'satisfied' },
] };
const RECORDS = { fund: PORTAL, notices: NOTICES, trust: TRUST, booklet: { status: 'open' }, inbox: { count: 2 } };

// ── Needs you (SM17) ──────────────────────────────────────────────────────────

test('Needs you: one row per thing, by due date then date added; the inbox counts every kind and comes last', () => {
  const { rows, incomplete } = needsYouRows(RECORDS, {}, TODAY);
  assert.equal(incomplete, false);
  assert.deepEqual(rows.map((r) => r.key), ['call-2', 'notice-n1', 'trust-kyc_v1', 'lpa-12', 'booklet', 'inbox']);
  const call = rows[0];
  assert.equal(call.title, 'Call 3 for Fund A: $50,000 due');
  assert.equal(call.detail, '$0 received so far · pay to account ••••4821, quote AXF1-C3-0042');
  assert.deepEqual(call.date, { text: 'Due Fri 20 Nov', sub: 'in 6 days' });
  assert.equal(call.action.label, 'Pay');
  assert.equal(call.action.to, '/spinout-lab/investor-workspace#my-notices', 'its issued notice is where it opens');
  assert.equal(rows[1].title, 'Management Fee Invoice · Fund A · $1,250');
  assert.equal(rows[1].detail, 'Fund notice issued to you Fri 6 Nov');
  assert.equal(rows[2].date.text, 'Expires Tue 1 Dec');
  assert.equal(rows[3].detail, 'Your $100,000 commitment is recorded; the LPA is not signed');
  assert.equal(rows[3].date.text, 'Added Mon 9 Nov');
  assert.equal(rows[5].title, '2 unread in your inbox');
  assert.equal(rows[5].action.to, '/inbox');
  assert.ok(!rows.some((r) => r.key.includes('n0') || r.key.includes('n2')), 'a superseded notice and a call\'s own notice are not rows of their own');
});

test('Needs you: overdue is said in words; a missing due date and missing payment details are said, not hidden', () => {
  const fund = { ...PORTAL, capital_calls: [
    { id: 5, fund_id: 1, limited_partner_id: 11, call_number: 3, owed_cents: 5000000, received_cents: 0, status: 'pending', due_date: '2026-11-11', created_at: '2026-11-01', pay_instructions: { available: true, account_masked: '••••4821', reference: 'R' } },
    { id: 6, fund_id: 2, limited_partner_id: 12, call_number: 2, owed_cents: 2000000, received_cents: 0, status: 'pending', due_date: null, created_at: '2026-11-02', pay_instructions: { available: false, message: 'no bank account is on file for Fund B.' } },
  ] };
  const { rows } = needsYouRows({ ...RECORDS, fund }, {}, TODAY);
  const late = rows.find((r) => r.key === 'call-5');
  assert.deepEqual(late.date, { overdue: true, text: 'Overdue by 3 days' });
  const undated = rows.find((r) => r.key === 'call-6');
  assert.deepEqual(undated.date, { missing: true, text: 'Due date not recorded' });
  assert.equal(undated.detail, 'Payment details are unavailable: no bank account is on file for Fund B.');
  assert.equal(undated.action.label, 'Open call');
  assert.equal(undated.pay, null);
  assert.ok(rows.indexOf(undated) > rows.indexOf(rows.find((r) => r.key === 'trust-kyc_v1')), 'an undated row sorts after every dated row');
  const noExpiry = needsYouRows({ ...RECORDS, trust: { obligations: [{ obligation_key: 'kyc_v1', required: 1, status: 'pending' }] } }, {}, TODAY).rows.find((r) => r.kind === 'trust');
  assert.deepEqual(noExpiry.date, { missing: true, text: 'No expiry recorded' });
});

test('Needs you: a failed source is Unreadable on its own with Try again, and a failed inbox count is never 0', () => {
  const tiles = investorTiles({ quick: quickStats({}), today: TODAY, records: { ...RECORDS, inbox: undefined, notices: undefined }, failures: { inbox: 'down', notices: 'down' }, retrySource: () => {} });
  assert.equal(tiles.needs_you.state, 'ready');
  const text = draw(tiles.needs_you.body);
  assert.match(text, /Unread count could not be read\. It is never shown as 0\.Try again/);
  assert.match(text, /Your fund notices could not be read\.Try again/);
  assert.match(text, /Call 3 for Fund A/, 'the sources that answered stay');
  assert.doesNotMatch(text, /0 unread/);
  const loading = investorTiles({ quick: quickStats({}), today: TODAY, records: {}, retrySource: () => {} });
  assert.equal(loading.needs_you.state, 'loading');
  const none = investorTiles({ quick: quickStats({}), today: TODAY, records: { fund: { lp_holdings: [] }, notices: { notices: [] }, trust: { obligations: [] }, booklet: null, inbox: { count: 0 } }, retrySource: () => {} });
  assert.equal(none.needs_you.state, 'empty');
  assert.match(none.needs_you.empty, /^Nothing needs you today\./);
});

test('Needs you: Pay is outlined (the header keeps the primary), and on a phone opens the payment details', () => {
  const tiles = investorTiles({ quick: quickStats({}), today: TODAY, records: RECORDS, retrySource: () => {} });
  const out = html(tiles.needs_you.body);
  assert.match(out, /data-testid="button-needs-pay-call-2"/);
  assert.match(out, /class="sm-btn sm-btn-s sm-btn-sm ihs-wide-only"[^>]*>Pay</);
  assert.doesNotMatch(out, /sm-btn-p[^"]*"[^>]*>Pay</, 'one primary per screen is the owner\'s open question; Pay is not filled');
  assert.equal(tiles.needs_you.note, '6 items · by due date, then date added');
});

// ── Funds (SM18) ──────────────────────────────────────────────────────────────

test('Funds: committed, called, received, due now and uncalled per fund, and totals that add up', () => {
  const f = fundsOf(PORTAL, TODAY);
  assert.deepEqual(f.rows.map((r) => [r.name, r.committed, r.called, r.received, r.due, r.uncalled]), [
    ['Fund A', '$250,000', '$150,000', '$100,000', '$50,000', '$100,000'],
    ['Fund B', '$100,000', '$0', '$0', '$0', '$100,000'],
  ]);
  assert.deepEqual(f.total, { committed: '$350,000', called: '$150,000', received: '$100,000', due: '$50,000', uncalled: '$200,000' });
  assert.deepEqual([f.rows[0].tvpi, f.rows[0].dpi, f.rows[0].lpa], ['1.18×', '0.12×', { signed: true, on: 'Tue 3 Feb 2026' }]);
  assert.deepEqual(f.rows[0].bar, { called: 60, received: 40 });
  assert.deepEqual([f.rows[1].noPaidIn, f.rows[1].tvpi, f.rows[1].lpa], [true, null, { signed: false }]);
  const tiles = investorTiles({ quick: quickStats({}), today: TODAY, records: RECORDS, retrySource: () => {} });
  const text = draw(tiles.fund_commitment.body);
  assert.match(text, /Fund B\$100,000\$0\$0\$0\$100,000No paid-in capital yetNot signed/);
  assert.doesNotMatch(text, /0\.00×/, 'nothing paid in is not a multiple of 0');
  assert.match(text, /All funds\$350,000\$150,000\$100,000\$50,000\$200,000Per fund only/);
  assert.match(text, /Gross\. In dollars\. As at Sat 14 Nov 2026\./);
  assert.equal(tiles.fund_commitment.note, '2 funds');
});

test('Funds: a failed calls read leaves committed and TVPI, and every call figure Unreadable, never 0', () => {
  const retried = [];
  const tiles = investorTiles({ quick: quickStats({}), today: TODAY, records: { ...RECORDS, fund: { ...PORTAL, capital_calls_recorded: false, capital_calls: [] } }, retrySource: (k) => retried.push(k) });
  const text = draw(tiles.fund_commitment.body);
  assert.match(text, /Your capital calls could not be read\. Committed and TVPI still show\.Try again/);
  assert.match(text, /Fund A\$250,000UnreadableUnreadableUnreadableUnreadableUnreadable1\.18×0\.12×/);
  assert.match(text, /All funds\$350,000UnreadableUnreadableUnreadableUnreadable/);
  const failed = investorTiles({ quick: quickStats({}), today: TODAY, records: { ...RECORDS, fund: undefined }, failures: { fund: 'x' }, retrySource: (k) => retried.push(k) });
  assert.equal(failed.fund_commitment.state, 'unreadable');
  failed.fund_commitment.onRetry();
  assert.deepEqual(retried, ['fund']);
  const none = investorTiles({ quick: quickStats({}), today: TODAY, records: { ...RECORDS, fund: { lp_holdings: [] } }, retrySource: () => {} });
  // D8731 (#8731): no commitment opens the fund brief, Axal VC Fund › Fund and terms, never /funds (Run my fund).
  assert.deepEqual([none.fund_commitment.state, none.fund_commitment.openLabel, none.fund_commitment.href], ['empty', 'See Axal VC Fund terms', '/spinout-lab/investor-workspace#fund']);
});

// ── Returns (SM19) ────────────────────────────────────────────────────────────

test('Returns: gross and dated, coverage as a sentence; Not computed carries its reason, Total loss reads −100%, a measured 0 is 0', () => {
  const r = returnsOf({
    paid_in: 1850000, distributed: 0, nav: 2310000, position_count: 9, unmarked_position_count: 2, as_of: null, as_of_default: '2026-11-14',
    returns: { irr: { value: null, state: 'unavailable', reason: 'single_flow' }, tvpi: { value: 1.38, state: 'computed' }, moic: { value: -1, state: 'total_loss' }, dpi: { value: 0, state: 'computed' } },
  });
  assert.equal(r.heading, 'Your accessible book, gross, as at Sat 14 Nov 2026 (today’s read)');
  assert.deepEqual(r.figures.map(([l, f]) => [l, f.state, f.value ?? f.reason]), [
    ['IRR', 'not_computed', 'Only one dated cash flow is recorded; a rate needs two.'],
    ['TVPI', 'value', '1.38×'], ['MOIC', 'total_loss', '−100%'], ['DPI', 'value', '0.00×'],
  ]);
  assert.deepEqual(r.flows, [['Paid in', '$1,850,000'], ['Distributed', '$0'], ['NAV', '$2,310,000']]);
  assert.equal(r.coverage, '7 of 9 positions marked; the rest carry at cost.');
  const asked = returnsOf({ as_of: '2026-09-30', returns: {}, position_count: 1, unmarked_position_count: 0 });
  assert.equal(asked.heading, 'Your accessible book, gross, as at Wed 30 Sep 2026');
  assert.equal(asked.coverage, 'All 1 position marked.');
  const tiles = investorTiles({ quick: quickStats({}), today: TODAY, records: { portfolio: { paid_in: 10, nav: 0, distributed: 0, position_count: 1, unmarked_position_count: 1, returns: { irr: { value: -1, state: 'total_loss' } } } }, retrySource: () => {} });
  assert.match(draw(tiles.returns.body), /IRR−100%Total loss/);
  assert.equal(investorTiles({ quick: quickStats({}), records: { portfolio: { position_count: 0 } } }).returns.state, 'empty');
  const failed = investorTiles({ quick: quickStats({}), records: {}, failures: { portfolio: 'x' }, retrySource: () => {} });
  assert.equal(failed.returns.state, 'unreadable');
  assert.equal(investorTiles({ quick: quickStats({}), records: {} }).returns.state, 'loading');
});

// ── Thesis fit (SM20) ─────────────────────────────────────────────────────────

const FLOW = { items: [
  { deal_id: 1, venture: 'North Co', sector: 'Robotics', stage: 'screening', ask: 1500000, can_open: true },
  { deal_id: 2, venture: 'Gone Co', sector: 'Bio', stage: 'diligence', ask: null, can_open: false },
  { deal_id: 3, venture: 'Odd Co', sector: null, stage: 'sourcing', ask: 750000, can_open: true },
  { deal_id: 4, venture: 'Passed Co', stage: 'passed' },
] };
const FIT = { items: [
  { deal_id: 1, state: 'recorded', score: 75, confidence: 1, criteria: [
    { key: 'sector', state: 'match', reason: 'The recorded value matches your thesis.' },
    { key: 'stage', state: 'outside', reason: 'The recorded value is outside your thesis.' },
    { key: 'region', state: 'not_recorded', reason: 'Market geography is not fully recorded.' },
    { key: 'ticket', state: 'not_set', reason: 'No thesis ticket range is recorded.' },
  ] },
  { deal_id: 2, state: 'unavailable', label: 'Deal unavailable', score: null },
  { deal_id: 3, state: 'unreadable', score: null },
] };

test('Thesis fit: four criterion chips with the platform\'s reasons, Deal unavailable and Unreadable · Try again; no score and no ranking', () => {
  const fit = fitOf({ flow: FLOW, fit: FIT });
  assert.equal(fit.live, 3, 'a passed deal is not live');
  assert.deepEqual(fit.rows.map((r) => [r.name, r.state]), [['North Co', 'ready'], ['Gone Co', 'unavailable'], ['Odd Co', 'unreadable']]);
  assert.deepEqual(fit.rows[0].chips.map((c) => `${c.label} · ${c.word}`), ['Sector · Match', 'Stage · Outside', 'Region · Not recorded', 'Ticket · Not set']);
  assert.deepEqual([fit.rows[0].meta, fit.rows[0].ask, fit.rows[0].to], ['Robotics · Screening', 'Ask $1,500,000', '/deals/1']);
  assert.equal(fit.rows[2].meta, 'Sector not recorded · Sourcing');
  const retried = [];
  const tiles = investorTiles({ quick: quickStats({}), records: { deals: { flow: FLOW, fit: FIT } }, retrySource: (k) => retried.push(k) });
  assert.equal(tiles.thesis_fit.note, '3 of 3 in your flow');
  const out = html(tiles.thesis_fit.body);
  const text = renderedText(out);
  assert.match(text, /Deal unavailable/);
  assert.match(text, /Odd CoIts inputs could not be readUnreadableTry again/);
  assert.match(out, /aria-label="Region · Not recorded: Market geography is not fully recorded\."/, 'the reason is in the chip\'s accessible name');
  assert.doesNotMatch(text, /75|\d%|overall|recommend/i, 'the fit read\'s score is never drawn');
  const failed = investorTiles({ quick: quickStats({}), records: {}, failures: { deals: 'x' }, retrySource: (k) => retried.push(k) });
  assert.equal(failed.thesis_fit.state, 'unreadable');
  failed.thesis_fit.onRetry();
  assert.deepEqual(retried, ['deals']);
});

test('Thesis fit: no thesis points to Settings with four Not set chips; an empty flow is empty, never a list of none', () => {
  const unset = { items: [1, 3].map((id) => ({ deal_id: id, state: 'not_set', criteria: [] })) };
  const fit = fitOf({ flow: FLOW, fit: unset });
  assert.equal(fit.notSet, true, 'deal 2 has no fit row, so it is unavailable; the readable ones decide');
  assert.equal(fitOf({ flow: FLOW, fit: FIT }).notSet, false);
  const tiles = investorTiles({ quick: quickStats({}), records: { deals: { flow: { items: FLOW.items.filter((d) => d.deal_id !== 2) }, fit: unset } } });
  assert.match(draw(tiles.thesis_fit.body), /Set a thesis to see fit on live deals.*Sector · Not set.*Stage · Not set.*Region · Not set.*Ticket · Not set.*Set it in Settings ›/s);
  const empty = investorTiles({ quick: quickStats({}), records: { deals: { flow: { items: [] }, fit: { items: [] } } } });
  assert.equal(empty.thesis_fit.state, 'empty');
});

// ── Arrivals (SM21) ───────────────────────────────────────────────────────────

test('Arrivals: one dated list, newest first, no "new" badge; each source failing says so alone', () => {
  const updates = { items: [
    { uid: 'u1', status: 'submitted', submitted_at: '2026-11-12T10:00:00Z', period: '2026-Q3', project: { name: 'Lumen' } },
    { uid: 'u2', status: 'draft', submitted_at: null, project: { name: 'Draft Co' } },
    { uid: 'u3', status: 'submitted', submitted_at: null, period: '2026-Q2', project: { name: 'Undated' } },
  ] };
  const a = arrivalsOf({ updates, fund: PORTAL });
  assert.deepEqual(a.items.map((i) => [i.title, i.date]), [
    ['Founder update · Lumen · 2026-Q3', 'Submitted Thu 12 Nov'],
    ['Capital statement · Fund A · Q3 2026', 'Issued Tue 10 Nov'],
    ['Fund report · Fund A · Q3 2026', 'Issued Wed 4 Nov'],
    ['Founder update · Undated · 2026-Q2', 'Submitted, date not recorded'],
  ]);
  assert.deepEqual(a.unreadable, []);
  const half = arrivalsOf({ updatesFailed: true, fund: { ...PORTAL, capital_statements_recorded: false, capital_statements: [] } });
  assert.deepEqual(half.unreadable, ['Founder updates', 'Capital statements']);
  const tiles = investorTiles({ quick: quickStats({}), dashboard: { proprietary_deal_flow_summary: { total: 22 } }, records: { updates, fund: PORTAL } });
  const text = draw(tiles.arrivals.body);
  assert.match(text, /22 deals offered to youA count, not dated/);
  assert.match(text, /No “new” badge: your last visit is not recorded\./);
  assert.doesNotMatch(text, /\bNew\b/);
  const both = investorTiles({ quick: quickStats({}), records: {}, failures: { updates: 'x', fund: 'y' }, retrySource: () => {} });
  assert.equal(both.arrivals.state, 'unreadable');
  const none = investorTiles({ quick: quickStats({}), records: { updates: { items: [] }, fund: { lp_holdings: [], report_periods: [], capital_statements: [] } } });
  assert.match(draw(none.arrivals.body), /Nothing has arrived yet\..*A failed read of issued reports looks the same as none issued\./s);
  assert.equal(investorTiles({ quick: quickStats({}), records: { fund: PORTAL } }).arrivals.state, 'loading');
});

// ── The thesis band (SM16, SM22c, SM25A) ──────────────────────────────────────

test('the thesis band: sectors, stages, regions and ticket chips, and a struck-through Excludes group read as Excluded', () => {
  const profile = { thesis_text: 'Seed robotics.', sectors: ['Robotics', 'Climate'], stages: ['Seed'], geos: ['Europe'], ticket_min_usd: 100000, ticket_max_usd: 500000, anti_thesis_sectors: ['Crypto'], anti_thesis_stages: ['Pre-seed'] };
  assert.deepEqual(thesisGroups(profile).map((g) => [g.label, g.chips, !!g.excluded]), [
    ['Sectors', ['Robotics', 'Climate'], false], ['Stages', ['Seed'], false], ['Regions', ['Europe'], false],
    ['Ticket', ['$100,000–$500,000'], false], ['Excludes', ['Crypto', 'Pre-seed'], true],
  ]);
  const out = html(h(ThesisBandView, { state: thesisBandState({ status: 'ready', profile }) }));
  assert.match(out, /class="ihs-chip ihs-x[^"]*" aria-label="Excluded: Crypto"/);
  assert.match(out, /class="ihs-chip ihs-x ihs-chip-extra" aria-label="Excluded: Pre-seed"/, 'chips past the fifth fold on a phone');
  assert.match(renderedText(out), /\+2 more/);
  assert.match(renderedText(out), /Edit in Settings ›/);
  const chipsOnly = thesisBandState({ status: 'ready', profile: { sectors: ['Robotics'] } });
  assert.equal(chipsOnly.kind, 'set', 'recorded preferences without prose are a thesis');
  assert.match(draw(h(ThesisBandView, { state: { kind: 'empty' } })), /No thesis set · Set it in Settings to see fit on live deals.*Set it in Settings ›/);
  assert.deepEqual(thesisGroups({ ticket_max_usd: 'x', sectors: [' ', null] }), [], 'nothing invented from a bad figure or a blank');
});

// ── The frame ─────────────────────────────────────────────────────────────────

test('an administrator\'s preview withholds every investor module, the five new ones included', () => {
  const tiles = investorTiles({ previewing: true, quick: quickStats({ previewing: true }), records: RECORDS });
  const all = ['needs_you', 'fund_commitment', 'returns', 'thesis_fit', 'arrivals', 'upcoming_events', 'usage_quota', 'deal_lifecycle', 'quick_stats', 'portfolio_glance'];
  assert.deepEqual(Object.keys(tiles).sort(), [...all].sort());
  assert.deepEqual([...INVESTOR_KEYS].sort(), [...all].sort());
  for (const k of all) assert.equal(tiles[k].state, 'withheld', k);
  assert.deepEqual(FALLBACK_DEFAULTS.investor.map((d) => d.key), ['needs_you', 'fund_commitment', 'returns', 'thesis_fit', 'arrivals', 'upcoming_events', 'usage_quota', 'deal_lifecycle']);
  for (const k of INVESTOR_KEYS) assert.ok(FALLBACK_TITLES[k], `${k} has a fallback title`);
});

test('dates are read as calendar days in UTC, never through the browser clock', () => {
  assert.equal(shortDay('2026-11-20'), 'Fri 20 Nov');
  assert.equal(shortDay('2026-11-20 23:30:00', { year: true }), 'Fri 20 Nov 2026');
  assert.equal(shortDay('2026-02-30'), null);
  assert.equal(shortDay(null), null);
});

test('the home hands the dashboard read to the tiles, so Arrivals can count the deals offered (#6622 had stopped passing it)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/pages/investor/InvestorStudioHome.jsx', import.meta.url), 'utf8');
  const call = src.slice(src.indexOf('investorTiles({'), src.indexOf('});', src.indexOf('investorTiles({')));
  assert.match(call, /\bdashboard,/, 'investorTiles receives dashboard');
  assert.match(call, /\bdashboardUnavailable,/, 'investorTiles receives dashboardUnavailable');
});
