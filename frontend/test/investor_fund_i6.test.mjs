import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('frontend/src/pages/investor/InvestorFundLanding.jsx');
const styles = read('frontend/src/pages/investor/investorFundLanding.css');
const app = read('frontend/src/App.jsx');

test('I6 renders the requested institutional fund surfaces', () => {
  for (const copy of [
    'Run my fund',
    'LP registry',
    'Capital calls &amp; distributions',
    'Fund accounting',
    'LP reporting',
    'Worker AI · Fund',
  ]) assert.match(page, new RegExp(copy));
  assert.match(page, /function EmptyFundDetail/);
  assert.match(page, /items\.length === 0 \? <EmptyFundDetail \/>/);
});

test('I6 composes live fund sources and preserves detailed tools', () => {
  for (const source of ['useFundAnalytics', 'fundsLpsList', 'fundsLpPortal', 'capitalCalls', 'fundsReportPeriods']) {
    assert.match(page, new RegExp(source));
  }
  for (const route of ['/funds/accounting', '/funds/capital-calls', '/lp-reports']) {
    assert.match(page, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(app, /path="\/funds\/performance"[^\n]+<FundOpsWorkspace \/>/);
});

test('I6 does not ship canvas sample funds, LPs, figures, or models', () => {
  for (const sample of [
    'Thornbury',
    'Brightwater',
    'Onkonwo',
    'Lindqvist',
    'Ashgrove',
    'Verwood',
    '42,000,000',
    'DeepSeek',
    'GPT-OSS',
  ]) assert.doesNotMatch(page, new RegExp(sample, 'i'));
});

test('I6 includes an inert institutional locked state', () => {
  assert.match(page, /data-testid="investor-fund-locked"/);
  assert.match(page, /aria-hidden="true"/);
  assert.match(styles, /\.i6-locked-preview[^}]+pointer-events:none/);
  assert.match(page, /Institutional add-on/);
});

test('I6 is responsive and supports dark mode', () => {
  assert.match(styles, /\.dark \.i6-fund/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:640px\)/);
});