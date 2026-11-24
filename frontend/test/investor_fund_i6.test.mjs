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
  assert.match(page, /items\.length === 0\s*\?\s*<EmptyFundDetail[\s/]/);
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
  // The legacy ops tool's Accounting and LP Reporting handoffs went with those
  // tabs (owner, 2026-10-20): the landing must not link a route that is gone.
  for (const route of ['/funds/accounting', '/lp-reports']) {
    assert.ok(!page.includes(route), `the landing still links the removed ${route}`);
  }
  // Re-aimed by D371: `/funds/capital-calls` retired into the Calls zone, so
  // the call-ledger handoff opens `/funds/calls` itself rather than a route
  // that only redirects there — and the old path still lands somewhere.
  assert.ok(!page.includes('/funds/capital-calls'), 'the landing links a retired route');
  // #6232: the handoff carries the chosen fund (`zone()` adds `?fund=`).
  assert.match(page, /<Link to=\{zone\('\/funds\/calls'\)\} data-testid="link-review-call-ledger">/);
  assert.doesNotMatch(app, /path="\/funds\/capital-calls" element=\{<FundCapitalCallsRedirect \/>\}/);
  assert.match(app, /function FundCapitalCallsRedirect\(\)[\s\S]{0,200}?pathname: '\/funds\/calls', search: loc\.search, hash: loc\.hash/);
  // D1160: Fund Ops is retired; an investor's Performance is the page itself. #6245: it draws its own Fund chrome, no tier gate.
  assert.match(app, /path="\/funds\/performance" element=\{guard\(\['admin', 'investor'\], holds\('investor'\) \? <FundPerformancePage fundUnlocked=\{hasInvestorTier\(user, 'institutional'\)\} \/> : effectiveRole !== 'admin' \? <FundPerformancePage locked \/> : <FundOpsRedirect \/>\)\}/);
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

test('I6 draws the shared institutional locked state (D6233, FV2)', () => {
  // #6233: the blurred preview is gone (FV2 draws none, and it could only hold invented figures);
  // /funds draws FundLocked, the surface every Fund zone draws. fund_locked_6233 holds its contents.
  assert.match(page, /if \(!fundUnlocked\) return <FundLocked zone="overview" \/>;/);
  assert.doesNotMatch(styles, /i6-locked/);
});

test('I6 is responsive and supports dark mode', () => {
  assert.match(styles, /\.dark \.i6-fund/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:640px\)/);
});