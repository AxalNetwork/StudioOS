/**
 * D6278 (#6278) — a benchmark's "Ours" from a fund's recorded TVPI or DPI, at
 * the page end: the provenance line, the offer, the Not recorded refusal and
 * the confirm before a typed figure is replaced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUND_METRICS, fundChoice, oursProvenance, typedOurs } from '../src/pages/research/oursFromFundRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../src/pages/research/BenchmarkDetail.jsx');
const control = read('../src/pages/research/OursFromFund.jsx');
const client = read('../src/lib/api/researchBenchmarkFunds.js');

const FIGURES = [
  { fund_id: 10, name: 'Northlake Fund I', as_of: '2026-11-18',
    tvpi: { value: 1.31, display: '1.31×', reason: null }, dpi: { value: 0.1, display: '0.10×', reason: null } },
  { fund_id: 30, name: 'Fund C', as_of: '2026-11-18',
    tvpi: { value: null, display: null, reason: 'This figure needs its recorded investment NAV or paid distributions and positive capital called.' },
    dpi: { value: null, display: null, reason: null } },
];

test('the line under Ours says where the figure came from', () => {
  assert.equal(oursProvenance({ our_value: null }), null, 'an empty Ours got a provenance line');
  assert.equal(oursProvenance({ our_value: '22 months', our_from: null }), 'As entered on this row');
  assert.equal(oursProvenance({ our_value: '1.31×', our_from: { fund_id: 10, fund_name: 'Northlake Fund I', metric: 'tvpi', as_of: '2026-11-18' } }),
    'Recorded TVPI from Northlake Fund I as of 2026-11-18');
  // A fund the reader can no longer open is not named.
  assert.equal(oursProvenance({ our_value: '0.10×', our_from: { fund_id: 10, fund_name: null, metric: 'dpi', as_of: '2026-11-18' } }),
    'Recorded DPI from a fund you can no longer open as of 2026-11-18');
});

test('only a typed figure asks before it is replaced', () => {
  assert.equal(typedOurs({ our_value: '1.4x', our_from: null }), true);
  assert.equal(typedOurs({ our_value: null, our_from: null }), false);
  assert.equal(typedOurs({ our_value: '1.31×', our_from: { fund_id: 10 } }), false);
  assert.match(control, /typed \? setConfirming\(true\) : use\(false\)/);
  assert.match(control, /onClick=\{\(\) => use\(true\)\}/);
  assert.match(control, /This replaces the figure you typed/);
  assert.match(control, /Keep mine/);
});

test('a figure that is not recorded says why and cannot be used', () => {
  assert.deepEqual(fundChoice(FIGURES, '10', 'tvpi'), { recorded: true, fund: FIGURES[0], display: '1.31×', as_of: '2026-11-18' });
  const missing = fundChoice(FIGURES, 30, 'tvpi');
  assert.equal(missing.recorded, false);
  assert.match(missing.text, /^Not recorded: This figure needs/);
  assert.equal(fundChoice(FIGURES, 30, 'dpi').text, 'Not recorded: This figure is not recorded for this fund.');
  assert.equal(fundChoice(FIGURES, 99, 'tvpi'), null);
  assert.match(control, /disabled=\{busy !== '' \|\| !choice\?\.recorded\}/);
  assert.deepEqual(FUND_METRICS.map((m) => m.key), ['tvpi', 'dpi']);
});

test('the page renders the line and the control, and writes through its record gate', () => {
  assert.match(page, /data-testid="benchmark-ours-from"/);
  assert.match(page, /<OursFromFund key=\{target\}/);
  assert.match(page, /run\('fund', \(\) => researchBenchmarkFundsApi\.useFigure\(target, choice\)/);
  assert.match(control, /Use our figure from a fund…/);
  assert.match(control, /You cannot open any fund’s performance/);
  assert.match(control, /<Unreadable what="Fund figures"/);
});

test('the client calls the two Worker routes', () => {
  assert.match(client, /request\('\/research\/benchmarks\/fund-figures'\)/);
  assert.match(client, /\/research\/benchmarks\/\$\{encodeURIComponent\(uid\)\}\/ours-from-fund/);
  assert.match(client, /JSON\.stringify\(\{ fund_id, metric, replace \}\)/);
});
