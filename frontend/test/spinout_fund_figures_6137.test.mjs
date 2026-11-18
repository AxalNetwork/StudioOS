// D6137 (#6137) — the Spin-Out LP pages draw no fund figure without a record.
//
// `lib/spinoutFundFigures.js` turns the GET /api/spinout-lab/fund-metrics read
// into the strings the LP workspace, the investor page and the fund brief draw.
// These cases check it draws "Not recorded" where the read records nothing,
// gives a visitor's read no LP figure at all, and that the two pages draw from
// it (and from nothing in lib/spinoutFundModel.js) for every fund figure.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_fund_figures_6137.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fundFigures, programFigures, NOT_RECORDED, UNREADABLE, usdM } from '../src/lib/spinoutFundFigures.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const workspace = read('pages/SpinoutLabLpWorkspacePage.jsx');
const investor = read('pages/SpinoutLabInvestorPage.jsx');

const CLOSE = { first_close_date: '2026-09-15', date_passed: true, outcome_recorded: false, outcome: null };
const none = (reason) => ({ available: false, value: null, reason });

test('a visitor\'s read draws the target and the close status, and no LP figure', () => {
  const F = fundFigures({ fund: { available: true, target: { available: true, value: 15_000_000 }, close: CLOSE } });
  assert.equal(F.lp, false);
  assert.equal(F.target.text, '$15M');
  assert.equal(F.close.label, 'Sep 15, 2026 (date passed; outcome not recorded)');
  assert.equal(F.raise, null, 'nothing reserved for LPs to draw');
  assert.equal(F.portfolio, null);
});

test('no record draws Not recorded, never a figure', () => {
  const F = fundFigures({
    fund: {
      available: true,
      target: none('no_target_record'),
      close: CLOSE,
      raise: { available: false, reason: 'no_lp_records' },
      portfolio: {
        available: false,
        positions: none('no_position_records'), invested: none('no_position_records'),
        held: none('no_position_records'), reserve: none('no_reserve_record'),
        gross_moic: none('no_position_records'),
        follow_ons: { available: false, count: null, amount: null, reason: 'no_position_records' },
        as_of: { available: false, value: null, reason: 'no_position_records' },
      },
    },
  });
  assert.equal(F.lp, true);
  assert.equal(F.target.text, NOT_RECORDED);
  for (const k of ['committed', 'softCircled', 'lpCount', 'median', 'capacity']) assert.equal(F.raise[k], NOT_RECORDED, k);
  assert.equal(F.raise.pctOfTarget, null, 'no bar without both figures');
  for (const k of ['positions', 'invested', 'held', 'followOns', 'followOnAmount', 'reserve', 'moic', 'asOf']) {
    assert.equal(F.portfolio[k], NOT_RECORDED, k);
  }
});

test('a failed read draws Unreadable, and a read failure is not "no record"', () => {
  assert.equal(fundFigures(null).target.text, UNREADABLE);
  assert.equal(fundFigures(null).raise, null);
  const F = fundFigures({ fund: { available: true, target: none('no_target_record'), close: CLOSE, raise: { available: true, committed: 0, soft_circled: 0, lp_count: 1, median_commitment: null }, portfolio: { positions: none('read_failed') } } });
  assert.equal(F.portfolio.positions, UNREADABLE);
  assert.equal(F.raise.capacity, NOT_RECORDED, 'capacity needs a recorded target');
});

test('a committed LP\'s read draws its own figures', () => {
  const fig = (value) => ({ available: true, value });
  const F = fundFigures({
    fund: {
      available: true, target: fig(10_000_000), close: CLOSE,
      raise: { available: true, committed: 2_500_000, soft_circled: 0, lp_count: 4, median_commitment: 500_000 },
      portfolio: {
        available: true, positions: fig(2), invested: fig(300_000), held: fig(525_000),
        follow_ons: { available: true, count: 1, amount: 50_000 }, reserve: none('no_reserve_record'),
        gross_moic: fig(1.75), as_of: { available: true, value: '2026-09-30' },
      },
    },
  });
  assert.deepEqual(
    [F.raise.committed, F.raise.lpCount, F.raise.capacity, F.raise.pctOfTarget, F.raise.median],
    ['$2.5M', '4', '$7.5M', 25, '$500K'],
  );
  assert.deepEqual(
    [F.portfolio.positions, F.portfolio.invested, F.portfolio.held, F.portfolio.followOns, F.portfolio.moic, F.portfolio.reserve, F.portfolio.asOf],
    ['2', '$0.3M', '$0.53M', '1', '1.75×', NOT_RECORDED, 'Sep 30, 2026'],
  );
  assert.equal(usdM(0), '$0M');
});

test('#5513: the program figures come from the read only; there is no fixed track record', () => {
  const some = programFigures({ program: { available: true, graduates: 4, on_time_pct: null, alumni_raised: null } });
  assert.deepEqual([some.live, some.graduates, some.onTime, some.alumni], [true, '4', NOT_RECORDED, NOT_RECORDED]);
  const none = programFigures({ program: { available: false } });
  assert.deepEqual([none.live, none.graduates, none.onTime, none.alumni], [false, NOT_RECORDED, NOT_RECORDED, NOT_RECORDED]);
  const failed = programFigures(null);
  assert.deepEqual([failed.live, failed.graduates, failed.onTime, failed.alumni], [false, UNREADABLE, UNREADABLE, UNREADABLE]);
  // The owner took 37 graduates, 86% on time and $8.6M raised down (2026-11-17): no source records them.
  assert.ok(![none, failed].some((p) => /\b37\b|86%|8\.6M/.test(`${p.graduates} ${p.onTime} ${p.alumni}`)));
});

test('the workspace draws every fund figure from the read, none from the design model', () => {
  assert.match(workspace, /const F = fundFigures\(live\);/);
  assert.doesNotMatch(workspace, /\bfundModel\b|allocationCandidates|FUND\.(committed|softCircled|lpCount|target|hardCap|medianTicketK|status|firstClose|minCloseM|reservePolicy)/,
    'no raise, portfolio, target or close figure from lib/spinoutFundModel.js');
  assert.doesNotMatch(workspace, /see lib\/spinoutFundModel\.js<|Operator-maintained portfolio model/, 'the model is not cited to readers');
  // The underwriting block and the raise figures are drawn only from an LP's read.
  assert.match(workspace, /\{F\.portfolio \? \(\s*<div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="underwriting-kpis">/);
  assert.match(workspace, /\{F\.raise \? \(/);
  // The Cohort 4 list is not a record, and #6138 removed the allocation
  // section altogether: no sliders and no company from the list on the page.
  assert.doesNotMatch(workspace, /Allocation preference for|Cohort 4 allocation window|COHORT_4/);
  // The brief prints the page's read.
  assert.match(workspace, /exportFundBriefPdf\(\{[\s\S]{0,400}metrics: live,/);
});

test('the investor page draws deployment and capacity from the read only', () => {
  assert.match(investor, /const F = fundFigures\(live\);/);
  assert.doesNotMatch(investor, /\bfundModel\b|\bM\.investedK|FUND\.(committed|target)/);
  assert.match(investor, /F\.portfolio\s*\?\s*\{ k: 'Deployed by the fund', v: F\.portfolio\.invested/);
  assert.match(investor, /const capacity = F\.raise && F\.raise\.recorded && F\.target\.recorded \? F\.raise\.capacity : null;/);
  // Every brief button passes the page's read.
  const buttons = investor.match(/<FundBriefButton [^>]*\/>/g) || [];
  assert.equal(buttons.length, 3);
  for (const b of buttons) assert.match(b, /metrics=\{live\}/);
});
