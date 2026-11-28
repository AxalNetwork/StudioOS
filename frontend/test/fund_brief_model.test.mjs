// Guards the Fund Brief One-Pager's data contract.
//
// The point of lib/fundBriefViewModel.js is that a downloaded brief carries
// what the LP & Investor Workspace is currently showing. The Claude Design
// export it replaces had its own private copy of every figure.
//
// D6137 (#6137): the fund figures (target, close status, and for a committed
// LP the raise and the portfolio) come from the viewer's own read of
// GET /api/spinout-lab/fund-metrics, the read the page drew, through
// `fundFigures()`. The cases below feed the brief a read and check it prints
// the same strings the page's helper does, prints "Not recorded" where the read
// records nothing, prints no LP figure from a visitor's read, and never prints
// a figure from lib/spinoutFundModel.js (target 20, committed 6.8, 31 LPs,
// eleven positions, the Cohort 4 list).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fundModel, FUND, THESIS, fundTerms, TIERS, TIER_RIGHTS,
  COHORT_4, PROCESS_STEPS, SERVICE_PROVIDERS,
} from '../src/lib/spinoutFundModel.js';
import { fundBriefModel, fundBriefFilename, briefDate } from '../src/lib/fundBriefViewModel.js';
import { fundFigures, programFigures } from '../src/lib/spinoutFundFigures.js';

const byKey = (rows, k) => rows.find((r) => r.k === k);
const TODAY = '2026-11-16';

/* ------------------------------------------------------------- the reads */

const CLOSE = { first_close_date: '2026-09-15', as_of: '2026-11-16', date_passed: true, outcome_recorded: false, outcome: null };
const visitorRead = {
  ok: true,
  program: { available: false },
  fund: { available: true, target: { available: true, value: 12_000_000 }, close: CLOSE },
};
const lpRead = {
  ok: true,
  program: { available: true, graduates: 9, on_time_pct: 78, alumni_raised: 3_250_000 },
  fund: {
    available: true,
    target: { available: true, value: 12_000_000 },
    close: CLOSE,
    raise: { available: true, committed: 3_000_000, soft_circled: 500_000, lp_count: 7, median_commitment: 250_000 },
    portfolio: {
      available: true,
      positions: { available: true, value: 3 },
      invested: { available: true, value: 450_000 },
      held: { available: true, value: 600_000 },
      follow_ons: { available: true, count: 1, amount: 50_000 },
      reserve: { available: false, value: null, reason: 'no_reserve_record' },
      gross_moic: { available: true, value: 600_000 / 450_000 },
      as_of: { available: true, value: '2026-09-30' },
    },
  },
};
const emptyLpRead = {
  ok: true,
  program: { available: false },
  fund: {
    available: true,
    target: { available: false, value: null, reason: 'no_target_record' },
    close: CLOSE,
    raise: { available: false, reason: 'no_lp_records' },
    portfolio: {
      available: false,
      positions: { available: false, value: null, reason: 'no_position_records' },
      invested: { available: false, value: null, reason: 'no_position_records' },
      held: { available: false, value: null, reason: 'no_position_records' },
      follow_ons: { available: false, count: null, amount: null, reason: 'no_position_records' },
      reserve: { available: false, value: null, reason: 'no_reserve_record' },
      gross_moic: { available: false, value: null, reason: 'no_position_records' },
      as_of: { available: false, value: null, reason: 'no_position_records' },
    },
  },
};

const brief = (metrics) => fundBriefModel({ metrics, today: TODAY });

/** Every string a brief prints from its figures, for "is this model figure anywhere" checks. */
const printed = (vm) => JSON.stringify([vm.meta, vm.raise, vm.record, vm.pipeline, vm.pipelineEmpty, vm.footer]);

/* ------------------------------------------------------------------ shape */

test('the brief renders every section the design has', () => {
  const vm = brief(lpRead);
  for (const k of ['meta', 'raise', 'thesisBody', 'terms', 'tiers', 'record', 'pipeline', 'providers', 'steps', 'footer']) {
    assert.ok(vm[k], `missing section: ${k}`);
  }
  assert.equal(vm.raise.length, 5, 'a committed LP: target, committed, soft-circled, capacity, first close');
  assert.equal(vm.tiers.length, TIERS.length);
  assert.equal(vm.record.length, 6);
  assert.equal(vm.providers.length, SERVICE_PROVIDERS.length);
  assert.equal(vm.steps.length, PROCESS_STEPS.length);
});

test('narrative copy is the workspace copy, not a second wording', () => {
  const vm = brief(null);
  assert.equal(vm.meta.headline, THESIS.headline);
  assert.equal(vm.meta.thesis, THESIS.brief);
  assert.equal(vm.thesisBody, THESIS.body);
});

/* --------------------------------------------- D6137: the read, not the model */

test('D6137: a committed LP brief prints the read\'s figures, the page helper\'s strings', () => {
  const vm = brief(lpRead);
  const F = fundFigures(lpRead, { today: TODAY });
  assert.equal(byKey(vm.raise, 'Target').v, '$12M');
  assert.equal(byKey(vm.raise, 'Target').v, F.target.text);
  assert.equal(byKey(vm.raise, 'Committed').v, '$3M');
  assert.equal(byKey(vm.raise, 'Committed').note, '25% of target · 7 LPs');
  assert.equal(byKey(vm.raise, 'Soft-circled').v, '$0.5M');
  assert.equal(byKey(vm.raise, 'Capacity remaining').v, '$9M');
  assert.equal(byKey(vm.raise, 'Capacity remaining').note, 'Median ticket $250K');
  assert.equal(byKey(vm.record, 'Capital deployed').v, F.portfolio.invested);
  assert.equal(byKey(vm.record, 'Capital deployed').v, '$0.45M');
  assert.equal(byKey(vm.record, 'Follow-ons completed').v, '1');
  assert.equal(byKey(vm.record, 'Reserve remaining').v, 'Not recorded', 'no store records the reserve');
  const P = programFigures(lpRead);
  assert.equal(byKey(vm.record, 'Graduates to date').v, P.graduates);
  assert.equal(byKey(vm.record, 'Graduates to date').v, '9');
  assert.equal(byKey(vm.record, 'Incorporated on time').v, '78%');
  assert.equal(byKey(vm.record, 'Raised by alumni').v, '$3.25M');
});

test('D6137: a visitor brief prints the headline only, no LP figure', () => {
  const vm = brief(visitorRead);
  assert.deepEqual(vm.raise.map((r) => r.k), ['Target', 'First close']);
  assert.equal(byKey(vm.raise, 'Target').v, '$12M');
  assert.deepEqual(vm.record.map((r) => r.k), ['Graduates to date', 'Incorporated on time', 'Raised by alumni']);
  // The figures: no LP cell or tile. (The footer may say LP figures exist, not what they are.)
  assert.doesNotMatch(JSON.stringify([vm.meta, vm.raise, vm.record]), /Committed|Soft-circled|Capacity|Capital deployed|Follow-ons|LPs\b/);
});

test('D6137: no record prints Not recorded, and a failed read prints Unreadable', () => {
  const vm = brief(emptyLpRead);
  assert.equal(byKey(vm.raise, 'Target').v, 'Not recorded');
  assert.equal(byKey(vm.raise, 'Committed').v, 'Not recorded');
  assert.equal(byKey(vm.raise, 'Capacity remaining').v, 'Not recorded');
  assert.equal(byKey(vm.record, 'Capital deployed').v, 'Not recorded');
  assert.equal(byKey(vm.record, 'Follow-ons completed').v, 'Not recorded');
  const failed = brief(null);
  assert.equal(byKey(failed.raise, 'Target').v, 'Unreadable');
  assert.equal(failed.raise.length, 2, 'a failed read has no LP keys, so no LP cells');
});

test('D6137: no figure from the design model reaches any brief', () => {
  const M = fundModel();
  for (const metrics of [null, visitorRead, lpRead, emptyLpRead]) {
    const text = printed(brief(metrics));
    for (const stale of ['$20M', '$25M', '$6.8M', '31 LPs', '$1.4M', '$13.2M', `$${FUND.minCloseM}M minimum`, '$1.9M']) {
      assert.ok(!text.includes(stale), `"${stale}" came from the model`);
    }
    for (const p of M.positions) assert.ok(!text.includes(p.company), `${p.company} came from the model`);
    for (const c of COHORT_4) assert.ok(!text.includes(c.company), `${c.company} came from the Cohort 4 list`);
  }
});

test('D6137: the pipeline names no company and says why', () => {
  const vm = brief(lpRead);
  assert.deepEqual(vm.pipeline, []);
  assert.match(vm.pipelineEmpty, /^Not recorded/);
  assert.equal(vm.pipelineNote, `Demo day ${FUND.demoDay}`);
});

test('D6137: the first close keeps "date passed; outcome not recorded"', () => {
  const vm = brief(visitorRead);
  const row = byKey(vm.raise, 'First close');
  assert.equal(row.v, 'Sep 15, 2026');
  assert.equal(row.note, 'Date passed; outcome not recorded');
  assert.equal(vm.meta.status, 'First-close date passed · outcome not recorded');
  const before = brief({ ...visitorRead, fund: { ...visitorRead.fund, close: { ...CLOSE, date_passed: false } } });
  assert.equal(byKey(before.raise, 'First close').note, 'Scheduled');
});

test('#5513: a brief from a read without a program block prints Not recorded, as the page does', () => {
  const vm = brief(visitorRead);
  for (const k of ['Graduates to date', 'Incorporated on time', 'Raised by alumni']) {
    assert.equal(byKey(vm.record, k).v, 'Not recorded', k);
  }
  assert.equal(byKey(vm.record, 'Graduates to date').v, programFigures(visitorRead).graduates);
  // A live program block prints its own figures.
  const live = brief({ ...visitorRead, program: { available: true, graduates: 5, on_time_pct: 80, alumni_raised: 1200000 } });
  assert.deepEqual(['Graduates to date', 'Incorporated on time', 'Raised by alumni'].map((k) => byKey(live.record, k).v), ['5', '80%', '$1.2M']);
});

/* ------------------------------------------------ derived: terms and tiers */

test('fund structure is the brief-flagged slice of the one term list', () => {
  const vm = brief(null);
  const expected = fundTerms().filter((t) => t.brief).map((t) => t.k);
  assert.deepEqual(vm.terms.map((t) => t.k), expected);
  // Target/hard cap is page-only: the raise strip already states the target.
  assert.ok(!expected.includes('Target / hard cap'));
  assert.ok(fundTerms().some((t) => t.k === 'Target / hard cap' && t.page));
});

function withModel(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) saved[k] = FUND[k];
  Object.assign(FUND, patch);
  try { return fn(brief(null)); } finally { Object.assign(FUND, saved); }
}

test('economics on the brief track FUND', () => {
  withModel({ mgmtFeePct: 2.5, carryPct: 25, minTicketK: 75 }, (vm) => {
    assert.equal(byKey(vm.terms, 'Management fee').v, '2.5%');
    assert.equal(byKey(vm.terms, 'Carried interest').v, '25%');
    assert.equal(byKey(vm.terms, 'Minimum ticket').v, '$75K');
  });
});

test('check sizes and portfolio band track FUND', () => {
  withModel({ checkLowK: 200, checkHighK: 300, convictionCheckK: 500, portfolioLow: 10, portfolioHigh: 15 }, (vm) => {
    assert.equal(byKey(vm.terms, 'Initial check').v, '$200–300K');
    assert.equal(byKey(vm.terms, 'High conviction').v, 'up to $500K');
    assert.equal(byKey(vm.terms, 'Portfolio').v, '10–15 companies');
  });
});

test('the stated reserve band matches the policy the model applies', () => {
  assert.equal(FUND.reserveHighPct, FUND.reservePolicy * 100);
  assert.ok(FUND.reserveLowPct < FUND.reserveHighPct);
});

test('tiers are the workspace tiers, with the matrix agreeing on column count', () => {
  const vm = brief(null);
  assert.deepEqual(vm.tiers.map((t) => t.name), TIERS.map((t) => t.name));
  assert.deepEqual(vm.tiers.map((t) => t.amount), TIERS.map((t) => t.amount));
  assert.ok(vm.tiers.every((t) => t.rights && t.rights.length > 10), 'each tier states its rights');
  for (const row of TIER_RIGHTS) {
    assert.equal(row.c.length, TIERS.length, `"${row.right}" has one cell per tier`);
  }
  const highlighted = TIERS.find((t) => t.hl);
  assert.equal(highlighted.amountK, FUND.allocThresholdK);
});

test('D6138: Fund I terms and tiers carry no allocation preference promise', () => {
  const brief = fundBriefModel();
  assert.doesNotMatch(JSON.stringify([fundTerms(), TIERS, TIER_RIGHTS, brief.tiers]), /allocation (rights|preferences|window)/i);
});

/* -------------------------------------------------- masthead, recipient, file */

test('briefDate is stable without an ICU build', () => {
  assert.equal(briefDate(new Date(2026, 7, 5)), 'Aug 5, 2026');
  assert.equal(briefDate(new Date(2027, 0, 31)), 'Jan 31, 2027');
  assert.equal(briefDate(new Date('nonsense')), briefDate(new Date()), 'a bad clock falls back to now');
});

test('the masthead stamps the generation date it was given', () => {
  assert.equal(fundBriefModel({ generatedAt: new Date(2026, 7, 5) }).meta.generated, 'Generated Aug 5, 2026');
});

test('the recipient line is optional and never invented', () => {
  assert.equal(fundBriefModel().meta.preparedFor, null);
  assert.equal(fundBriefModel({ recipient: {} }).meta.preparedFor, null);
  assert.equal(fundBriefModel({ recipient: { name: '   ' } }).meta.preparedFor, null);
  assert.equal(fundBriefModel({ recipient: { email: 'lp@example.com' } }).meta.preparedFor, 'Prepared for lp@example.com');
  assert.equal(
    fundBriefModel({ recipient: { name: 'A. Partner', email: 'lp@example.com', standing: 'Full rights · $250,000.00' } }).meta.preparedFor,
    'Prepared for A. Partner · Full rights · $250,000.00',
  );
});

test('the download is date-stamped so successive briefs do not overwrite', () => {
  assert.equal(fundBriefFilename(new Date(2026, 7, 5)), 'axal-vc-spin-out-fund-i-brief-2026-08-05.pdf');
  assert.equal(fundBriefFilename(new Date(2026, 11, 31)), 'axal-vc-spin-out-fund-i-brief-2026-12-31.pdf');
  assert.match(fundBriefFilename(), /^axal-vc-spin-out-fund-i-brief-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('the footer keeps the no-offer language and says where the figures came from', () => {
  const { footer } = brief(lpRead);
  assert.match(footer.legal, /Nothing herein is an offer to sell securities/i);
  assert.match(footer.legal, /private placement memorandum/i);
  assert.match(footer.legal, /Rule 501/);
  assert.match(footer.provenance, /fund's records/);
  assert.doesNotMatch(footer.provenance, /operator-maintained/);
  assert.match(brief(visitorRead).footer.provenance, /shown to committed LPs/);
});

test('the commitment process is the shared eight steps', () => {
  const vm = brief(null);
  assert.deepEqual(vm.steps.map((s) => s.n), ['01', '02', '03', '04', '05', '06', '07', '08']);
  assert.equal(vm.steps[0].label, 'Invited');
  assert.equal(vm.steps[7].label, 'Funded');
});

// D6140 (#6140): the owner removed the co-invest promise. No tier, rights row or ladder step offers it.
test('D6140: no tier, rights row or LP ladder step promises co-invest', async () => {
  const model = await import('../src/lib/spinoutFundModel.js');
  const text = JSON.stringify([model.TIERS, model.TIER_RIGHTS]);
  assert.doesNotMatch(text, /co-invest/i);
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../src/pages/SpinoutLabLpWorkspacePage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /co-invest/i);
});
