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
  ]) assert.match(page, new RegExp(copy));
  // "Worker AI · Fund" was a literal here, in one of twelve bespoke investor
  // rails — none of which read the spend endpoint, and four of which claimed
  // "Mode and model are set on the workspace" while this page set neither. The
  // heading now belongs to the shared component, composed from `workspace`, so
  // what this file asserts is the mount.
  assert.match(page, /<WorkerRail[\s\S]*?workspace="Fund"[\s\S]*?role="investor"/,
    'the landing must mount the shared Worker AI rail');
  assert.match(page, /function EmptyFundDetail/);
  assert.match(page, /items\.length === 0\s*\?\s*<EmptyFundDetail \/>/);
});

test('I6 composes live fund sources and preserves detailed tools', () => {
  for (const source of ['useFundAnalytics', 'fundsLpsList', 'fundsLpPortal', 'capitalCalls', 'fundsReportPeriods']) {
    assert.match(page, new RegExp(source));
  }
  // The four ZONE routes are what the section row and the card arrows now
  // open. They existed all along and were reachable from no control in the
  // product: the row was `<a href="#lps">` and three more, and the card arrows
  // pointed at the legacy ops tool — the LP registry card's arrow opened
  // /funds/accounting.
  for (const route of ['/funds/lps', '/funds/calls', '/funds/ledger', '/funds/reporting']) {
    assert.ok(page.includes(route), `the landing opens no door to ${route}`);
  }
  // And the legacy ops tool keeps its own doors, named as handoffs in the card
  // bodies rather than sitting where a zone link belongs.
  for (const route of ['/funds/accounting', '/funds/capital-calls', '/lp-reports']) {
    assert.ok(page.includes(route), `the landing dropped the handoff to ${route}`);
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