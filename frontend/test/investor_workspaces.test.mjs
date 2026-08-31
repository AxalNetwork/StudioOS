import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/investor/InvestorWorkspacePage.jsx');
const styles = read('frontend/src/pages/investor/investorWorkspace.css');
const deals = read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx');

test('investor workspace routes branch on the active role', () => {
  assert.match(app, /effectiveRole === 'investor'[\s\S]{0,160}<InvestorWorkspacePage page=\{page\}/);
  for (const [path, key] of [
    ['/pipeline', 'deals'],
    ['/portfolio/health', 'portfolio'],
    ['/market-intel', 'research'],
    ['/network', 'network'],
    ['/trust', 'trust'],
  ]) {
    const escaped = path.replaceAll('/', '\\/');
    assert.match(app, new RegExp(`path=\"${escaped}\"[^\\n]+investorWorkspace\\('${key}'`));
  }
});

test('investor-owned deep links keep the investor workspace shell', () => {
  assert.match(
    app,
    /path="\/deals\/:dealId"[^\n]+investorWorkspace\('deals', <DealRoomPage \/>/,
  );
  assert.match(
    app,
    /path="\/lp-portal"[^\n]+investorWorkspace\('axal-vc-fund', <LPPortalPage \/>/,
  );
  assert.match(
    app,
    /path="\/raise\/data-room"[^\n]+investorWorkspace\('deals'/,
  );
  assert.match(
    app,
    /effectiveRole === 'investor' \? investorWorkspace\('deals', <DataRoomPage user=\{user\} \/>\) : founderWorkspace\('raise', <FounderWorkspaceTabs/,
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
    assert.doesNotMatch(deals, new RegExp(sample.replace('$', '\\$')));
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