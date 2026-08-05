// Guards the Fund Brief One-Pager's data contract.
//
// The point of lib/fundBriefViewModel.js is that a downloaded brief carries
// what the LP & Investor Workspace is currently showing. The Claude Design
// export it replaces had its own private copy of every figure, so the failure
// this file exists to catch is that copy coming back: someone writes '$6.8M' or
// `deployed: 1.9` into the brief, the workspace moves, and every brief handed
// to an LP from then on misstates the raise.
//
// The strong cases below therefore MUTATE the shared model and re-render. A
// literal survives that unchanged and fails; only a derived value follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fundModel, money, FUND, PROGRAM, THESIS, fundTerms, TIERS, TIER_RIGHTS,
  COHORT_4, PROCESS_STEPS, SERVICE_PROVIDERS, allocationCandidates,
} from '../src/lib/spinoutFundModel.js';
import { fundBriefModel, fundBriefFilename, briefDate } from '../src/lib/fundBriefViewModel.js';

/** Mutate the shared model, render, and always put it back. */
function withModel(patch, fn) {
  const target = patch.target;
  const saved = {};
  for (const k of Object.keys(patch.values)) saved[k] = target[k];
  Object.assign(target, patch.values);
  try {
    return fn(fundBriefModel());
  } finally {
    Object.assign(target, saved);
  }
}

const byKey = (rows, k) => rows.find((r) => r.k === k);

/* ------------------------------------------------------------------ shape */

test('the brief renders every section the design has', () => {
  const vm = fundBriefModel();
  for (const k of ['meta', 'raise', 'thesisBody', 'terms', 'tiers', 'record', 'pipeline', 'providers', 'steps', 'footer']) {
    assert.ok(vm[k], `missing section: ${k}`);
  }
  assert.equal(vm.raise.length, 5);
  assert.equal(vm.terms.length, 12, 'the design shows twelve fund-structure rows');
  assert.equal(vm.tiers.length, TIERS.length);
  assert.equal(vm.record.length, 6);
  assert.equal(vm.pipeline.length, COHORT_4.length);
  assert.equal(vm.providers.length, SERVICE_PROVIDERS.length);
  assert.equal(vm.steps.length, PROCESS_STEPS.length);
});

test('narrative copy is the workspace copy, not a second wording', () => {
  const vm = fundBriefModel();
  assert.equal(vm.meta.headline, THESIS.headline);
  assert.equal(vm.meta.thesis, THESIS.brief);
  assert.equal(vm.thesisBody, THESIS.body);
});

/* ------------------------------------------- derived, not copied: the raise */

test('the raise strip tracks FUND rather than restating it', () => {
  withModel({ target: FUND, values: { committed: 9.9, target: 30, hardCap: 40, softCircled: 2.5, lpCount: 44 } }, (vm) => {
    assert.equal(byKey(vm.raise, 'Committed').v, '$9.9M');
    assert.equal(byKey(vm.raise, 'Target / hard cap').v, '$30M / $40M');
    assert.equal(byKey(vm.raise, 'Soft-circled').v, '$2.5M');
    // 9.9 / 30 = 33%, and the LP count rides along in the same note.
    assert.equal(byKey(vm.raise, 'Committed').note, '33% of target · 44 LPs');
    // Capacity is a difference, so a literal cannot fake it.
    assert.equal(byKey(vm.raise, 'Capacity remaining').v, '$20.1M');
  });
});

test('first close and the minimum follow FUND', () => {
  withModel({ target: FUND, values: { firstClose: 'Jan 2, 2027', minCloseM: 7 } }, (vm) => {
    const row = byKey(vm.raise, 'First close');
    assert.equal(row.v, 'Jan 2, 2027');
    assert.equal(row.note, '$7M minimum · rolling after');
  });
});

/* --------------------------------------- derived, not copied: track record */

test('the three tiles the export hard-coded are derived from the position list', () => {
  const M = fundModel();
  const vm = fundBriefModel();
  // The export carried `deployed: 1.9, reserveHeld: 2.7, followOns: 2`.
  assert.equal(byKey(vm.record, 'Capital deployed').v, money.m(M.investedK));
  assert.equal(byKey(vm.record, 'Reserve remaining').v, `$${M.reserveCloseM}M`);
  assert.equal(byKey(vm.record, 'Follow-ons completed').v, String(M.followOnCount));
});

test('reserve on the brief moves when the reserve policy moves', () => {
  const before = byKey(fundBriefModel().record, 'Reserve remaining').v;
  withModel({ target: FUND, values: { reservePolicy: 0.25 } }, (vm) => {
    const after = byKey(vm.record, 'Reserve remaining').v;
    assert.notEqual(after, before);
    assert.equal(after, `$${fundModel().reserveCloseM}M`);
  });
});

test('program stats come from PROGRAM, which the workspace hero also reads', () => {
  withModel({ target: PROGRAM, values: { graduates: 41, onTimeIncorpPct: 90, alumniRaisedM: 11.2 } }, (vm) => {
    assert.equal(byKey(vm.record, 'Graduates to date').v, '41');
    assert.equal(byKey(vm.record, 'Incorporated on time').v, '90%');
    assert.equal(byKey(vm.record, 'Raised by alumni').v, '$11.2M');
  });
});

/* ------------------------------------------------ derived: terms and tiers */

test('fund structure is the brief-flagged slice of the one term list', () => {
  const vm = fundBriefModel();
  const expected = fundTerms().filter((t) => t.brief).map((t) => t.k);
  assert.deepEqual(vm.terms.map((t) => t.k), expected);
  // Target/hard cap is page-only: the raise strip already states it, and the
  // design does not repeat it in the structure block.
  assert.ok(!expected.includes('Target / hard cap'));
  assert.ok(fundTerms().some((t) => t.k === 'Target / hard cap' && t.page));
});

test('economics on the brief track FUND', () => {
  withModel({ target: FUND, values: { mgmtFeePct: 2.5, carryPct: 25, minTicketK: 75, allocThresholdK: 400 } }, (vm) => {
    assert.equal(byKey(vm.terms, 'Management fee').v, '2.5%');
    assert.equal(byKey(vm.terms, 'Carried interest').v, '25%');
    assert.equal(byKey(vm.terms, 'Minimum ticket').v, '$75K');
    assert.equal(byKey(vm.terms, 'Allocation rights').v, 'from $400K');
  });
});

test('check sizes and portfolio band track FUND', () => {
  withModel({ target: FUND, values: { checkLowK: 200, checkHighK: 300, convictionCheckK: 500, portfolioLow: 10, portfolioHigh: 15 } }, (vm) => {
    assert.equal(byKey(vm.terms, 'Initial check').v, '$200–300K');
    assert.equal(byKey(vm.terms, 'High conviction').v, 'up to $500K');
    assert.equal(byKey(vm.terms, 'Portfolio').v, '10–15 companies');
  });
});

test('the stated reserve band matches the policy the model actually applies', () => {
  // The brief prints '30–40%' while fundModel() draws reserves at
  // reservePolicy. If those disagree the document overstates or understates
  // the fund's own rule.
  assert.equal(FUND.reserveHighPct, FUND.reservePolicy * 100);
  assert.ok(FUND.reserveLowPct < FUND.reserveHighPct);
});

test('tiers are the workspace tiers, with the matrix agreeing on column count', () => {
  const vm = fundBriefModel();
  assert.deepEqual(vm.tiers.map((t) => t.name), TIERS.map((t) => t.name));
  assert.deepEqual(vm.tiers.map((t) => t.amount), TIERS.map((t) => t.amount));
  assert.ok(vm.tiers.every((t) => t.rights && t.rights.length > 10), 'each tier states its rights');
  for (const row of TIER_RIGHTS) {
    assert.equal(row.c.length, TIERS.length, `"${row.right}" has one cell per tier`);
  }
  // Allocation rights open at exactly one tier, and it is the highlighted one.
  const allocator = TIERS.find((t) => t.hl);
  assert.equal(allocator.amountK, FUND.allocThresholdK);
});

/* --------------------------------------------------------------- pipeline */

test('the pipeline is the shared Cohort 4 list, tones included', () => {
  const vm = fundBriefModel();
  assert.deepEqual(vm.pipeline.map((p) => p.company), COHORT_4.map((c) => c.company));
  for (const [i, p] of vm.pipeline.entries()) {
    const src = COHORT_4[i];
    assert.equal(p.score, String(src.score));
    assert.equal(p.revenue, src.revenueK == null ? '—' : `$${src.revenueK}K`);
    assert.equal(p.ic, src.ic);
    assert.ok(p.icPill.bg && p.icPill.fg, 'every IC status resolves to a pill');
  }
  assert.equal(vm.pipelineNote, `Demo day ${FUND.demoDay}`);
});

test('readiness tone bands are the design thresholds', () => {
  const toneOf = (score) => {
    const saved = COHORT_4[0].score;
    COHORT_4[0].score = score;
    try { return fundBriefModel().pipeline[0].scoreTone; } finally { COHORT_4[0].score = saved; }
  };
  assert.equal(toneOf(70), '#15803d');
  assert.equal(toneOf(69), '#b45309');
  assert.equal(toneOf(55), '#b45309');
  assert.equal(toneOf(54), '#71717a');
});

test('a new Cohort 4 company reaches the next downloaded brief', () => {
  COHORT_4.push({ company: 'Testbed Co', sector: 'Test', score: 80, revenueK: 1, ic: 'Advance', allocDefault: 5 });
  try {
    const vm = fundBriefModel();
    assert.ok(vm.pipeline.some((p) => p.company === 'Testbed Co'));
  } finally {
    COHORT_4.pop();
  }
});

test('the allocation window is a subset of the pipeline the brief prints', () => {
  const candidates = allocationCandidates();
  const printed = new Set(fundBriefModel().pipeline.map((p) => p.company));
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.ok(printed.has(c.company), `${c.company} is allocable but absent from the brief`);
    assert.notEqual(c.ic, 'Track', 'companies still at Track are not allocable');
  }
  // Returned rows are copies — a slider must not mutate the shared list.
  candidates[0].allocDefault = 999;
  assert.notEqual(allocationCandidates()[0].allocDefault, 999);
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
    fundBriefModel({ recipient: { name: 'A. Partner', email: 'lp@example.com', standing: 'Committed LP · $250K committed' } }).meta.preparedFor,
    'Prepared for A. Partner · Committed LP · $250K committed',
  );
});

test('the download is date-stamped so successive briefs do not overwrite', () => {
  assert.equal(fundBriefFilename(new Date(2026, 7, 5)), 'axal-vc-spin-out-fund-i-brief-2026-08-05.pdf');
  assert.equal(fundBriefFilename(new Date(2026, 11, 31)), 'axal-vc-spin-out-fund-i-brief-2026-12-31.pdf');
  assert.match(fundBriefFilename(), /^axal-vc-spin-out-fund-i-brief-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('the footer keeps the no-offer language and the provenance caveat', () => {
  const { footer } = fundBriefModel();
  assert.match(footer.legal, /Nothing herein is an offer to sell securities/i);
  assert.match(footer.legal, /private placement memorandum/i);
  assert.match(footer.legal, /Rule 501/);
  assert.match(footer.provenance, /operator-maintained/);
});

/* ------------------------------------------------------- stock-value pins */

test('with stock data the brief reproduces the design one-pager', () => {
  const vm = fundBriefModel();
  assert.equal(byKey(vm.raise, 'Committed').v, '$6.8M');
  assert.equal(byKey(vm.raise, 'Committed').note, '34% of target · 31 LPs');
  assert.equal(byKey(vm.raise, 'Capacity remaining').v, '$13.2M');
  assert.equal(byKey(vm.record, 'Capital deployed').v, '$1.9M');
  assert.equal(byKey(vm.record, 'Follow-ons completed').v, '2');
  assert.equal(byKey(vm.terms, 'Management fee').v, '2%');
  assert.equal(byKey(vm.terms, 'Carried interest').v, '20%');
  assert.deepEqual(vm.steps.map((s) => s.n), ['01', '02', '03', '04', '05', '06', '07', '08']);
  assert.equal(vm.steps[0].label, 'Invited');
  assert.equal(vm.steps[7].label, 'Funded');
});
