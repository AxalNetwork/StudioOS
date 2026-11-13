/**
 * D538 (#1078) — no market-intelligence stub figure on any screen.
 *
 * The Worker now answers a sector, dimension or lens it has no live data for
 * with `null` and a reason, and the endpoints that served figures written
 * into its code answer `{ recorded: false, reason }`. These screens used to
 * draw the neutral 50s and the invented rows as readings, and to count them.
 * This file pins that each screen names what is not recorded instead:
 *
 *   - the founder desk and the investor workspace (the two the issue owns);
 *   - Market Intelligence and the Spin-Out Lab market tab, which read the
 *     same endpoints.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/market_intel_not_recorded_d538.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { notRecordedReason as founderReason } from '../src/pages/founder/FounderResearchDesk.jsx';
import { notRecordedReason as investorReason } from '../src/pages/investor/InvestorResearchWorkspace.jsx';
import { matchSectorRow } from '../src/pages/SpinoutLabMarketPage.jsx';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const FOUNDER = read('frontend/src/pages/founder/FounderResearchDesk.jsx');
const INVESTOR = read('frontend/src/pages/investor/InvestorResearchWorkspace.jsx');
const LAB = read('frontend/src/pages/SpinoutLabMarketPage.jsx');

const REASON = 'No store of private funding rounds yet';

test('notRecordedReason reads `{ recorded: false, reason }` and nothing else', () => {
  for (const fn of [founderReason, investorReason]) {
    assert.equal(fn({ not_recorded: { recorded: false, reason: REASON } }, 'not_recorded'), REASON);
    assert.equal(fn({ not_recorded: { recorded: true, reason: REASON } }, 'not_recorded'), null, 'a recorded part is not a reason');
    assert.equal(fn({ not_recorded: { recorded: false, reason: '  ' } }, 'not_recorded'), null, 'a blank reason is not a reason');
    assert.equal(fn({ rounds: [] }, 'not_recorded'), null);
    assert.equal(fn(null, 'not_recorded'), null);
  }
});

test('founder desk: market records are counted only where recorded, and otherwise named with the reason', () => {
  // The old meta counted the hardcoded pulse sectors and rounds as "stored
  // market records", and would count zero once they were gone.
  assert.doesNotMatch(FOUNDER, /\$\{data\.markets\.length \+ data\.rounds\.length\} stored market records/);
  assert.match(FOUNDER, /const pulseReason = notRecordedReason\(records\.pulse, 'signals_not_recorded'\);/);
  assert.match(FOUNDER, /const roundsReason = notRecordedReason\(records\.rounds, 'not_recorded'\);/);
  assert.match(FOUNDER, /const marketRecordCount = \(pulseReason \? 0 : data\.markets\.length\) \+ \(roundsReason \? 0 : data\.rounds\.length\);/);
  assert.match(FOUNDER, /: marketRecordCount > 0 \? `\$\{marketRecordCount\} stored market record/);
  assert.match(FOUNDER, /\n\s*: 'Not recorded';/, 'an empty market count must read Not recorded, not 0');
  assert.match(FOUNDER, /\[pulseReason, roundsReason\]\.filter\(Boolean\)\.join\('\. '\)/, 'the card must carry the reasons');
  assert.match(FOUNDER, /<SectionHead title="Market deep-dives" meta=\{marketsMeta\} \/><p data-testid="text-research-markets">\{marketsLine\}<\/p>/);
});

test('investor workspace: the ledger counts live sectors, and says Not recorded with the reason for rounds and benchmarks', () => {
  assert.match(INVESTOR, /const recordedSectors = compass\.filter\(\(sector\) => typeof sector\?\.composite === 'number'\)\.length;/);
  assert.doesNotMatch(INVESTOR, /data \? compass\.length : 'Loading'/, 'the ledger counts all twelve sectors again');
  assert.doesNotMatch(INVESTOR, /`\$\{compass\.length\} sector records/, 'the market status counts all twelve sectors again');
  assert.doesNotMatch(INVESTOR, /data \? rounds\.length : 'Loading'/, 'the ledger counts zero rounds again');
  assert.match(INVESTOR, /roundsReason \? 'Not recorded' : rounds\.length/);
  assert.match(INVESTOR, /data-testid="text-research-ledger-rounds-reason">\{roundsReason\}/);
  assert.match(INVESTOR, /benchmarksReason \? `Not recorded · \$\{benchmarksReason\}`/);
  assert.match(INVESTOR, /recordedSectors \? `\$\{recordedSectors\} live sector\$\{recordedSectors === 1 \? '' : 's'\}` : 'Not recorded'/);
});

test('Spin-Out Lab: no "current leader" is crowned from unrecorded sectors, and an unrecorded score reads Not recorded', () => {
  const rows = [
    { sector: 'Cybersecurity', composite: null, composite_reason: 'No live source yet for this sector' },
    { sector: 'DevTools', composite: null },
  ];
  assert.equal(matchSectorRow(rows, 'quantum'), null, 'a sector with no live composite was crowned leader');
  const exact = matchSectorRow(rows, 'cybersecurity');
  assert.equal(exact.exact, true, 'an exact sector match still names the sector');
  assert.equal(exact.row.composite, null);
  const withOne = matchSectorRow([...rows, { sector: 'Enterprise AI', composite: 41 }], 'quantum');
  assert.deepEqual([withOne.row.sector, withOne.exact], ['Enterprise AI', false]);
  assert.match(LAB, /const picks = \(lens\?\.picks \|\| \[\]\)\.filter\(\(p\) => typeof p\.opportunity_gap === 'number'\)\.slice\(0, 3\);/);
  assert.match(LAB, /data-testid="market-dynamics-not-recorded">Not recorded · \{sectorMatch\.row\.composite_reason/);
  assert.match(LAB, /\{typeof d\.value === 'number' \? Math\.round\(d\.value\) : 'Not recorded'\}/);
});
