// Proves the Fund Brief One-Pager still fits on one page.
//
// A single-page PDF fails silently: anything past the page box is clipped, not
// carried onto a second sheet, so an overflowing brief looks correct in code
// review and arrives at an LP with a section missing. These cases run the real
// drawing code from lib/fundBriefPdf.js against a measuring stub (see
// _pdf-stub.mjs) and assert the page still closes.
//
// They also pin the things that would push it over: a longer thesis, a
// committed LP's full raise strip and six record tiles (D6137), an extra
// service provider. Each of those is a plausible edit, and each is caught here
// rather than in someone's inbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfStub } from './_pdf-stub.mjs';
import { renderFundBrief, BRIEF_BOARD } from '../src/lib/fundBriefPdf.js';
import { fundBriefModel } from '../src/lib/fundBriefViewModel.js';
import { SERVICE_PROVIDERS } from '../src/lib/spinoutFundModel.js';

/** A committed LP's read (D6137): every LP key present, every figure recorded. */
const fig = (value) => ({ available: true, value });
const LP_READ = {
  program: { available: false },
  fund: {
    available: true,
    target: fig(12_000_000),
    close: { first_close_date: '2026-09-15', date_passed: true, outcome_recorded: false, outcome: null },
    raise: { available: true, committed: 3_000_000, soft_circled: 500_000, lp_count: 7, median_commitment: 250_000 },
    portfolio: {
      available: true, positions: fig(3), invested: fig(450_000), held: fig(600_000),
      follow_ons: { available: true, count: 1, amount: 50_000 }, reserve: { available: false, value: null },
      gross_moic: fig(1.33), as_of: { available: true, value: '2026-09-30' },
    },
  },
};

const PT = 0.75;                    // one design px, in points
const PAGE_H_PT = BRIEF_BOARD.h * PT; // 792 — letter portrait
const PAGE_W_PT = BRIEF_BOARD.w * PT; // 612

/** The page-sized white backdrop is meant to reach the trim; content is not. */
const isBackdrop = (c) => c.op === 'rect' && c.w >= PAGE_W_PT - 0.01 && c.h >= PAGE_H_PT - 0.01;

const bottomOf = (c) => (c.op === 'text' ? c.y + c.height : c.op === 'line' ? Math.max(c.y1, c.y2) : c.y + c.h);

/** Lay the page out and report where everything landed, in design px. */
function layout(opts) {
  const doc = createPdfStub();
  const vm = fundBriefModel({ generatedAt: new Date(2026, 7, 5), ...opts });
  const r = renderFundBrief(doc, vm);
  const contentBottom = Math.max(...doc.calls.filter((c) => !isBackdrop(c) && c.op !== 'save').map(bottomOf));
  return { doc, vm, ...r, contentBottom, contentBottomPx: contentBottom / PT };
}

test('the whole brief lands inside a single letter page', () => {
  const { doc, contentBottom, contentBottomPx } = layout();
  assert.ok(doc.maxY <= PAGE_H_PT, `something reaches ${doc.maxY.toFixed(1)}pt of ${PAGE_H_PT}pt tall`);
  assert.ok(doc.maxX <= PAGE_W_PT, `something reaches ${doc.maxX.toFixed(1)}pt of ${PAGE_W_PT}pt wide`);
  assert.ok(contentBottom <= PAGE_H_PT, `content reaches ${contentBottom.toFixed(1)}pt`);
  // The measuring stub is a close approximation, not the renderer, so require
  // real slack rather than a hairline pass.
  assert.ok(
    contentBottomPx <= BRIEF_BOARD.h - 4,
    `only ${(BRIEF_BOARD.h - contentBottomPx).toFixed(1)}px of bottom margin left`,
  );
});

test('neither column runs into the commitment process or the footer', () => {
  const { columns, bottom, footerTop } = layout();
  assert.ok(columns.left < bottom, 'the left column ends above the process row');
  assert.ok(columns.right < bottom, 'the right column ends above the process row');
  assert.ok(bottom < footerTop, `the process row (${bottom.toFixed(1)}px) overlaps the footer (${footerTop.toFixed(1)}px)`);
});

test('the recipient line does not push the masthead into the raise strip', () => {
  const plain = layout();
  const named = layout({
    recipient: {
      name: 'Alexandra Fitzwilliam-Kensington',
      email: 'alexandra@averylongfundname.example.com',
      standing: 'Committed LP · full rights · $1,250K committed',
    },
  });
  assert.ok(named.contentBottom <= PAGE_H_PT, 'a long recipient line still fits the page');
  assert.ok(named.bottom >= plain.bottom - 1, 'the recipient line never shortens the document');
});

test('every section actually renders a mark', () => {
  const { doc, vm } = layout();
  const drawn = doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join(' | ');
  const mustAppear = [
    vm.meta.fundName,
    'FUND BRIEF · CONFIDENTIAL',
    'THESIS',
    'FUND STRUCTURE',
    'PARTICIPATION TIERS',
    'TRACK RECORD',
    'GOVERNANCE & SERVICE PROVIDERS',
    'COMMITMENT PROCESS',
    vm.meta.generated,
    vm.footer.gpName,
  ];
  for (const needle of mustAppear) {
    assert.ok(drawn.includes(needle), `"${needle}" was never drawn`);
  }
  // Section labels are drawn uppercased; the pipeline heading carries the
  // cohort, so check it that way.
  assert.ok(drawn.includes(vm.pipelineHeading.toUpperCase()), 'the pipeline heading was never drawn');
  for (const p of vm.pipeline) {
    assert.ok(drawn.includes(p.company), `${p.company} is missing from the pipeline table`);
  }
  for (const t of vm.terms) assert.ok(drawn.includes(t.k), `term "${t.k}" is missing`);
  for (const s of vm.steps) assert.ok(drawn.includes(s.label), `process step "${s.label}" is missing`);
});

test('nothing is drawn off the left edge or above the page', () => {
  const { doc } = layout();
  for (const c of doc.calls) {
    if (c.op === 'text') {
      assert.ok(c.left >= -0.01, `text "${c.text.slice(0, 30)}" starts at x=${c.left.toFixed(1)}pt`);
      assert.ok(c.y >= -0.01, `text "${c.text.slice(0, 30)}" starts at y=${c.y.toFixed(1)}pt`);
    }
  }
});

/* -------------------------------------------------- the edits that would break it */

test('D6137: a committed LP\'s brief (five raise cells, six record tiles) still fits', () => {
  const { doc, vm, contentBottom, bottom, footerTop } = layout({ metrics: LP_READ });
  assert.equal(vm.raise.length, 5);
  assert.equal(vm.record.length, 6);
  assert.ok(contentBottom <= PAGE_H_PT, 'the LP brief overflows the page');
  assert.ok(bottom < footerTop, 'the LP brief pushes the process row into the footer');
  const drawn = doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join(' | ');
  for (const r of [...vm.raise, ...vm.record]) assert.ok(drawn.includes(r.v), `"${r.k}: ${r.v}" was never drawn`);
});

test('D6137: the empty pipeline is drawn as its Not recorded sentence', () => {
  const { doc, vm } = layout();
  const drawn = doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join(' ');
  assert.deepEqual(vm.pipeline, []);
  assert.ok(drawn.includes('Not recorded'), 'the pipeline says it is not recorded');
  assert.ok(!drawn.includes('COMPANY'), 'no empty table header is drawn');
});

test('one more service provider still fits', () => {
  SERVICE_PROVIDERS.push({ k: 'Insurance', v: 'Placeholder Underwriting' });
  try {
    const { contentBottom } = layout();
    assert.ok(contentBottom <= PAGE_H_PT, 'a seventh provider row overflows the page');
  } finally {
    SERVICE_PROVIDERS.pop();
  }
});

test('the fit check is real — an obviously oversized document fails it', () => {
  // Guards the guard: if the stub silently stopped measuring, every assertion
  // above would pass vacuously.
  const doc = createPdfStub();
  const vm = fundBriefModel();
  vm.thesisBody = `${vm.thesisBody} `.repeat(40);
  renderFundBrief(doc, vm);
  assert.ok(doc.maxY > PAGE_H_PT, 'a 40× thesis should not fit on one page');
});
