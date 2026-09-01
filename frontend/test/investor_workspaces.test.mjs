import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeBlock } from './_routes.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/investor/InvestorWorkspacePage.jsx');
const styles = read('frontend/src/pages/investor/investorWorkspace.css');
const deals = read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx');
const research = read('frontend/src/pages/investor/InvestorResearchWorkspace.jsx');

test('investor workspace routes branch on the active role', () => {
  assert.match(app, /effectiveRole === 'investor'[\s\S]{0,160}<InvestorWorkspacePage page=\{page\}/);
  for (const [path, key] of [
    ['/pipeline', 'deals'],
    ['/portfolio/health', 'portfolio'],
    ['/trust', 'trust'],
  ]) {
    // routeBlock + `includes` rather than a hand-escaped constructed regex.
    // Escaping `/` does nothing inside `new RegExp` — the delimiter only
    // matters in `/literal/` syntax — so the escape was ineffective while `.`
    // and the rest stayed live, which is exactly the shape CodeQL flags. The
    // block is bounded by the next <Route, so reading a window instead of one
    // line cannot let a neighbour satisfy this.
    assert.ok(routeBlock(app, path)?.includes(`investorWorkspace('${key}'`),
      `${path} does not mount the ${key} investor workspace`);
  }
  assert.match(app, /path="\/network"[\s\S]{0,180}effectiveRole === 'investor'[\s\S]{0,100}<InvestorNetworkWorkspace \/>/);
  assert.match(app, /path="\/market-intel"[\s\S]{0,220}effectiveRole === 'investor'[\s\S]{0,100}<InvestorResearchWorkspace \/>/);
});

test('investor Research implements I8 without fabricated diligence claims', () => {
  // Each label is the exact text the workspace renders, so each is checked
  // with a plain `includes`. Two earlier forms are worth not going back to.
  //
  // It began as `new RegExp(label.replace('&', '&amp;|&'))`, which put the
  // alternation at TOP level: 'Fund & manager benchmarking' compiled to
  // `Fund &amp;|& manager benchmarking` and was satisfied by EITHER HALF —
  // 'Fund &amp;' alone passed it.
  //
  // Replacing that with `includes(label) || includes(label.replaceAll('&',
  // '&amp;'))` fixed the halves but kept a transformation to serve a single
  // string: exactly one of these seven labels contains `&`, and the source
  // spells it `&amp;`. Semgrep read that replaceAll as hand-rolled HTML
  // escaping (detect-replaceall-sanitization). Its premise does not hold here
  // — these are literal needles in a source-text assertion, with no untrusted
  // input and no HTML sink — but the rule pointed at something true anyway:
  // the transformation was doing no work that writing the entity could not.
  //
  // So the entity is written out. This pins the encoding that actually ships;
  // if the JSX ever switches to a bare `&`, this failing is the right outcome
  // rather than something a tolerant matcher should absorb silently.
  for (const label of ['Go deep before money moves', 'Diligence pull', 'Source library', 'Fund &amp; manager benchmarking', 'Market deep-dives', 'Company profiles', 'Worker AI · Research']) {
    assert.ok(research.includes(label), `investor Research is missing "${label}"`);
  }
  assert.match(research, /api\.miSources\(\)/);
  assert.match(research, /api\.miWatchlistList\(\)/);
  assert.match(research, /\['rows', 'watchlist', 'items', 'data'\]/);
  assert.match(research, /computed_at/);
  assert.match(research, /sources\.map\(\(source\)/);
  assert.match(research, /source\.live[\s\S]{0,180}source\.paid/);
  assert.doesNotMatch(research, /Novacraft|74,000|DeepSeek|\$0\.0344|Founder-shared data room/);
  assert.match(research, /no answer has been generated/i);
});

test('investor-owned deep links keep the investor workspace shell', () => {
  // Each of these reads the route's own block, bounded by the next <Route, so
  // it cannot be satisfied by a neighbouring route's markup. The last two used
  // `[^\n]+` and a single flat ternary against the whole file: `724dfc9f`
  // wrapped /raise/data-room across six lines and both stopped matching, with
  // nothing about the routing having changed. The branch order they were
  // pinning — investor first, founder second — is still exactly what ships.
  assert.match(
    routeBlock(app, '/deals/:dealId'),
    /investorWorkspace\('deals', <DealRoomPage \/>/,
  );
  assert.match(
    routeBlock(app, '/lp-portal'),
    /investorWorkspace\('axal-vc-fund', <LPPortalPage \/>/,
  );
  const dataRoom = routeBlock(app, '/raise/data-room');
  assert.match(dataRoom, /investorWorkspace\('deals'/);
  assert.match(
    dataRoom,
    /effectiveRole === 'investor'\s*\?\s*investorWorkspace\('deals', <DataRoomPage user=\{user\} \/>\)/,
    'the investor branch must be the first arm, ahead of any founder shell',
  );
  assert.match(
    dataRoom,
    /founderWorkspace\('raise', <FounderWorkspaceTabs/,
    'investor Data Room must not inherit the founder workspace tab bar',
  );
});

test('the reusable surface covers every requested investor workspace', () => {
  for (const key of ['deals', 'portfolio', 'axal-vc-fund', 'fund', 'network', 'research', 'trust']) {
    assert.match(page, new RegExp(`['\"]?${key}['\"]?:?`));
  }
  assert.match(page, /data-testid=\{`investor-workspace-\$\{key\}`\}/);
  assert.match(page, /Data shown is governed by your existing access and permissions/);
});

test('Axal VC Fund preserves the live LP access implementation', () => {
  assert.match(page, /<SpinoutLabLpWorkspacePage embedded \/>/);
});

test('Fund preserves its institutional entitlement and honest locked state', () => {
  assert.match(app, /effectiveRole === 'investor' \? <InvestorFundLanding fundUnlocked=\{hasInvestorTier\(user, 'institutional'\)\} \/> : <FundOpsWorkspace \/>/);
  assert.match(app, /path="\/funds\/performance"[^\n]+investorFundWorkspace\(<FundOpsWorkspace \/>/);
});

test('investor visual system includes source provenance, responsive layout, and dark mode', () => {
  assert.match(styles, /--inv-seam:/);
  assert.match(styles, /\.dark \.investor-workspace/);
  assert.match(styles, /@media \(max-width: 767px\)/);
});

test('investor Deals implements the I3 hierarchy with live sources', () => {
  for (const label of ['Find and close investments', 'Pipeline', 'Screening', 'Commit', 'Closing', 'Deals AI']) {
    assert.match(deals, new RegExp(label));
  }
  for (const stage of ['Sourcing', 'Screening', 'Diligence', 'Commit', 'Closing']) {
    assert.match(deals, new RegExp(`label: '${stage}'`));
  }
  assert.match(deals, /api\.listDeals\(undefined, 'mine'\)/);
  assert.match(deals, /api\.myDealInvitations\(\)/);
  assert.match(deals, /api\.respondDealInvitation/);
  assert.doesNotMatch(deals, /api\.pipelineActive\(\)/, 'investors must not consume the studio-wide pipeline source');
  assert.match(deals, /committed > 0[\s\S]{0,80}'commit'/);
  assert.match(deals, /Total committed to deal/);
});

test('investor Deals does not ship illustrative canvas data as live data', () => {
  for (const sample of ['Novacraft', 'Meridian Labs', 'Halverton', 'DeepSeek', 'Llama 3.3', '$0.0149', '$4.2M allocated']) {
    // Literal, so `$` needs no escaping and `.` cannot wildcard: the old form
    // escaped only the FIRST `$` and left every `.` live, so '$0.0149' would
    // have been satisfied by '$0X0149'.
    assert.ok(!deals.includes(sample), `investor Deals still ships the sample value ${sample}`);
  }
  assert.match(deals, /never invents a memo, cost, model, or result/);
});

test('investor Deals exposes only canonical deal-room IDs and partial source failures', () => {
  assert.match(deals, /navigate\(`\/deals\/\$\{id\}`\)/);
  assert.match(deals, /invitations could not be loaded/);
  assert.match(deals, /if \(dealsResult\.status === 'rejected'\)/);
  assert.match(deals, /navigate\('\/raise\/data-room'\)/);
});

test('only canonical investor deal routes replace their child with I3', () => {
  assert.match(page, /pathname === '\/deals'/);
  assert.match(page, /pathname === '\/pipeline\/screening'/);
  assert.match(page, /if \(ownsDealsRoute\)/);
  assert.match(page, /<InvestorDealsWorkspace \/>/);
  assert.doesNotMatch(page, /pathname === '\/deals\/:dealId'/);
});