// Proves the quarterly report paginates without clipping.
//
// Same measuring stub as the fund brief (see _pdf-stub.mjs). This document has a
// harder problem than the one-pager: page 1 carries the GP's letter, which is
// authored prose of unknown length, and everything below it on that page is
// fixed. So these cases pin BOTH failure modes — content running under the
// footer, and a letter silently clipped at a page boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfStub } from './_pdf-stub.mjs';
import { renderQuarterlyReport } from '../src/lib/quarterlyReportPdf.js';
import { quarterlyReportModel, quarterOf } from '../src/lib/quarterlyReportViewModel.js';

const PT = 0.75;
const PAGE_H_PT = 792;
const PAGE_W_PT = 612;
const Q2 = quarterOf(new Date(2026, 4, 15));
const ISSUED_AT = new Date(2026, 6, 15);

// The design export's own three paragraphs — a realistic letter, not a stub.
const DESIGN_LETTER = [
  'The fund deployed $565K this quarter — $525K across 4 new positions sourced from Cohort 3 graduates, and $215K in 2 follow-ons into earlier positions where post-program execution data justified additional exposure, consistent with the reserve policy described in the fund documents.',
  'Underwriting continues to benefit from the observed-execution model: every company entering the portfolio arrived incorporated, 83(b)-filed, with a clean cap table and logged customer discovery. Median venture-readiness at graduation was 64 for Cohort 3, against 58 for Cohort 2. Three portfolio companies now report recurring revenue.',
  'The fund remains open toward a $5M minimum first close on September 15, 2026, with $13.2M of capacity remaining against the $20M target. Cohort 4 demo day is August 21; LPs holding allocation rights will receive the allocation window notice separately.',
];

function payload() {
  return {
    recipient: { name: 'Helena Kaur', email: 'helena@example.com' },
    performance: [{
      lp_id: 7, fund_id: 3, fund_name: 'Axal VC Spin-Out Fund I', fund_slug: 'spinout-fund-i',
      commitment: 250_000, invested_amount: 87_500, returns: 0, distributions_dollars: 0, lpa_signed: true,
    }],
    capital_calls: [
      { limited_partner_id: 7, amount: 12_775, due_date: '2025-10-15', paid_date: '2025-10-20', status: 'paid' },
      { limited_partner_id: 7, amount: 20_037, due_date: '2026-01-20', paid_date: '2026-01-25', status: 'paid' },
      { limited_partner_id: 7, amount: 29_138, due_date: '2026-04-18', paid_date: '2026-04-22', status: 'paid' },
      { limited_partner_id: 7, amount: 25_550, due_date: '2026-06-30', paid_date: '2026-06-30', status: 'paid' },
    ],
    distributions: [],
    funds: {
      3: {
        fund_id: 3, name: 'Axal VC Spin-Out Fund I', slug: 'spinout-fund-i', vintage_year: 2026,
        management_fee: 0.02, carried_interest: 0.2,
        gp: { name: 'Guillaume Lauzier', title: 'General Partner', email: 'gp@axal.vc', entity: 'Axal VC GP LLC' },
        providers: { fund_admin: 'Carta Fund Admin', auditor: 'An Auditor LLP', legal_counsel: 'Counsel LLP', custodian: 'A Bank', valuation_policy: 'ASC 820' },
      },
    },
  };
}

const isBackdrop = (c) => c.op === 'rect' && c.w >= PAGE_W_PT - 0.01 && c.h >= PAGE_H_PT - 0.01;
const bottomOf = (c) => (c.op === 'text' ? c.y + c.height : c.op === 'line' ? Math.max(c.y1, c.y2) : c.y + c.h);

function layout({ narrative = null, issued = false, over } = {}) {
  const doc = createPdfStub();
  const p = over ? over(payload()) : payload();
  const vm = quarterlyReportModel({
    payload: p, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT, narrative, issued,
  });
  assert.equal(vm.ok, true, 'the fixture must produce a document');
  const r = renderQuarterlyReport(doc, vm);
  const perPage = new Map();
  for (const c of doc.calls) {
    if (c.op === 'addPage' || c.op === 'save' || isBackdrop(c)) continue;
    perPage.set(c.page, Math.max(perPage.get(c.page) ?? 0, bottomOf(c)));
  }
  const drawn = doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join(' | ');
  return { doc, vm, ...r, perPage, drawn };
}

test('every page of a draft closes inside the sheet', () => {
  const { doc, pages, perPage } = layout();
  assert.equal(pages, 4, 'the design is four pages when the letter fits the cover');
  assert.equal(doc.maxX <= PAGE_W_PT, true, `content reaches ${doc.maxX.toFixed(1)}pt of ${PAGE_W_PT}pt wide`);
  for (const [page, bottom] of perPage) {
    assert.ok(bottom <= PAGE_H_PT, `page ${page} content reaches ${bottom.toFixed(1)}pt of ${PAGE_H_PT}pt`);
    assert.ok(bottom / PT <= 1056 - 4, `page ${page} leaves only ${(1056 - bottom / PT).toFixed(1)}px of margin`);
  }
});

test("a realistic GP letter still fits the cover — the design's own page count", () => {
  const { pages, perPage } = layout({ issued: true, narrative: { letter: DESIGN_LETTER } });
  assert.equal(pages, 4, 'a three-paragraph letter must not push the document to five pages');
  for (const [page, bottom] of perPage) {
    assert.ok(bottom <= PAGE_H_PT, `page ${page} overflows with a real letter`);
  }
});

test('a letter too long for the cover gets its own page, never a clipped one', () => {
  const long = Array.from({ length: 8 }, (_, i) => `${DESIGN_LETTER[i % 3]} Paragraph ${i + 1}.`);
  const { pages, perPage, drawn } = layout({ issued: true, narrative: { letter: long } });
  assert.equal(pages, 5, 'the letter spills onto a page of its own');
  for (const [page, bottom] of perPage) {
    assert.ok(bottom <= PAGE_H_PT, `page ${page} overflows`);
  }
  // Every paragraph survives the move — the failure being guarded is silent loss.
  for (const para of long) {
    assert.ok(drawn.includes(para.slice(0, 60)), 'a paragraph went missing when the letter spilled');
  }
  assert.ok(drawn.includes('follows on the next page'), 'the cover points at the letter page');
});

test('footers are numbered against the real page count', () => {
  const four = layout();
  for (let i = 1; i <= 4; i++) assert.ok(four.drawn.includes(`Page ${i} of 4`), `missing footer ${i} of 4`);
  const long = Array.from({ length: 8 }, (_, i) => `${DESIGN_LETTER[i % 3]} ${i}`);
  const five = layout({ issued: true, narrative: { letter: long } });
  for (let i = 1; i <= 5; i++) assert.ok(five.drawn.includes(`Page ${i} of 5`), `missing footer ${i} of 5`);
  assert.ok(!five.drawn.includes('Page 1 of 4'), 'a stale page count survived the spill');
});

test('a draft is stamped as one, and an issued report is not', () => {
  assert.ok(layout().drawn.includes('DRAFT'), 'an unissued report must say so');
  assert.ok(layout().drawn.includes('NOT ISSUED'));
  const issued = layout({ issued: true, narrative: { letter: DESIGN_LETTER } });
  assert.ok(!issued.drawn.includes('DRAFT'), 'an issued report must not be stamped draft');
  assert.ok(issued.drawn.includes('Unaudited · GP-reviewed'));
});

test('every section of the document renders', () => {
  const { drawn, vm } = layout({
    issued: true,
    narrative: {
      letter: DESIGN_LETTER,
      developments: [{ date: 'Apr 18', title: 'Cadence Robotics closed a seed round', body: 'Marked to the round price.' }],
      outlook: ['Cohort 4 demo day in August.'],
      subsequent: [{ d: 'Jul 8', e: 'Cohort 4 commenced with nine companies.' }],
    },
  });
  for (const needle of [
    'Quarterly LP report · confidential',
    'LETTER FROM THE GENERAL PARTNER',
    `CAPITAL ACCOUNT · ${vm.meta.lp.toUpperCase()}`,
    'FUND-LEVEL SUMMARY',
    'Portfolio review',
    'ACTIVE POSITIONS',
    'DEPLOYMENT BY QUARTER',
    'MATERIAL DEVELOPMENTS',
    'SECTOR EXPOSURE',
    'Program telemetry & outlook',
    'COHORT PERFORMANCE',
    'FUND ADMINISTRATION',
    'RESERVE POSITION',
    'KEY DATES',
    'Financial statements & disclosures',
    'PERFORMANCE PROGRESSION · SINCE INCEPTION',
    'FEES & EXPENSES',
    `CAPITAL CALL HISTORY · ${vm.meta.lp.toUpperCase()}`,
    'CONCENTRATION & RISK DISCLOSURE',
    'SUBSEQUENT EVENTS',
    'BASIS OF PREPARATION',
  ]) {
    assert.ok(drawn.includes(needle), `"${needle}" was never drawn`);
  }
  for (const p of vm.portfolio) assert.ok(drawn.includes(p.company), `${p.company} missing from the positions table`);
  for (const c of vm.cohorts) assert.ok(drawn.includes(c.name), `${c.name} missing from the cohort table`);
  assert.ok(drawn.includes('Prepared for Helena Kaur'));
});

test('a fund with no GP of record prints a warning where the signature goes', () => {
  const { drawn } = layout({
    over: (p) => { p.funds[3].gp = { name: null, title: null, email: null, entity: null }; return p; },
  });
  assert.ok(drawn.includes('General Partner not recorded on this fund'));
  assert.ok(drawn.includes('Set a GP of record before issuing this report'));
  assert.ok(!drawn.includes('Guillaume'), 'a mock signer leaked onto the page');
});

test('an unreconciled capital account is called out on the cover', () => {
  const { drawn } = layout({ over: (p) => { p.performance[0].invested_amount = 60_000; return p; } });
  assert.ok(drawn.includes('unreconciled'), 'a call history that does not tie must be visible');
});

test('nothing is drawn off the left edge or above any page', () => {
  const { doc } = layout({ issued: true, narrative: { letter: DESIGN_LETTER } });
  for (const c of doc.calls) {
    if (c.op !== 'text') continue;
    assert.ok(c.left >= -0.01, `text "${c.text.slice(0, 30)}" starts at x=${c.left.toFixed(1)}pt`);
    assert.ok(c.y >= -0.01, `text "${c.text.slice(0, 30)}" starts at y=${c.y.toFixed(1)}pt`);
  }
});

test('the fit check is real — an oversized table fails it', () => {
  // Guards the guard: if the stub stopped measuring, every case above would
  // pass vacuously.
  const doc = createPdfStub();
  const vm = quarterlyReportModel({ payload: payload(), fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  vm.portfolio = Array.from({ length: 60 }, (_, i) => ({ ...vm.portfolio[0], company: `Position ${i}` }));
  renderQuarterlyReport(doc, vm);
  assert.ok(doc.maxY > PAGE_H_PT, '60 positions should not fit one page');
});
