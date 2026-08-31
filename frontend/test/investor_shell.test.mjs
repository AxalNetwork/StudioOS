/**
 * The Investor/LP shell — eighteen items to nine rows, and the three
 * workspaces that make it honest.
 *
 * Unlike Partner, Investor collapses cleanly: `PipelineWorkspace`,
 * `PortfolioWorkspace` and `FundOpsWorkspace` each already render a
 * `WorkspaceTabs` bar across their whole subtree, so three rows can own
 * fifteen destinations between them and every one stays a click away.
 *
 * Two former rows had no other door at all. Auditing every `to=`, `to:`,
 * `navigate(` and `link=` in frontend/src outside sidebarConfig.js:
 * /messages 0 inbound, /raise/data-room 0. /deals has eight (Dashboard
 * cards, DealRoomPage's back buttons, ScoredDealCard, the login landing),
 * but none of them is reachable from the investor's own nav, so it is
 * treated as doorless here too. /messages keeps a row; /deals and
 * /raise/data-room became tabs on PipelineWorkspace.
 *
 * The rule that governs the whole file: `match` decides which row
 * highlights. It does not create a link. A destination is reachable only
 * if a row targets it or a workspace demonstrably tabs to it — which is
 * why every assertion below reads the workspace file rather than trusting
 * the sidebar's own comments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const investor = src.slice(src.indexOf('\n  investor: ['), src.indexOf('\n  advisor: ['));

const rows = [...investor.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

const pipeline = read('frontend/src/pages/PipelineWorkspace.jsx');
const portfolio = read('frontend/src/pages/PortfolioWorkspace.jsx');
const fundOps = read('frontend/src/pages/FundOpsWorkspace.jsx');
const tabsTo = (ws, p) => ws.includes(`to: '${p}'`);

test('the canvas rows are present, in the canvas order', () => {
  // Canvas ROWS: Home · Deals · Portfolio · Axal VC Fund · Fund · Network ·
  // Research · Trust · Firm Settings. Trust is excluded on purpose (below),
  // and "Axal VC Fund" ships under its existing Spin-Out Lab name (below).
  const CANON = ['Home', 'Deals', 'Portfolio', 'Fund', 'Network', 'Research'];
  let i = 0;
  for (const l of labels) if (l === CANON[i]) i += 1;
  assert.equal(i, CANON.length, `canonical rows out of order or missing: ${JSON.stringify(labels)}`);
});

test('one row per workspace, and the shell is eight rows not eighteen', () => {
  assert.equal(rows.length, 8, `investor shell drifted off eight rows: ${JSON.stringify(labels)}`);
});

test('Deals owns the pipeline subtree, and the workspace tabs to all of it', () => {
  const deals = rows.find((r) => r.label === 'Deals');
  assert.ok(deals, 'no Deals row');
  assert.equal(deals.to, '/pipeline', 'Deals must land on the workspace, not on a page without tabs');

  // Canvas zones: Pipeline · Screening · Commit · Closing.
  for (const p of ['/pipeline', '/pipeline/screening', '/pipeline/commit', '/pipeline/transactions']) {
    assert.ok(tabsTo(pipeline, p), `PipelineWorkspace no longer tabs to ${p} — Deals cannot own it`);
  }
  // The two absorbed rows.
  assert.ok(tabsTo(pipeline, '/deals'), 'Deal Flow lost its only investor door');
  assert.ok(tabsTo(pipeline, '/raise/data-room'), 'Data Room lost its only investor door');
});

test('Portfolio owns the portfolio subtree, and the workspace tabs to all of it', () => {
  const row = rows.find((r) => r.label === 'Portfolio');
  assert.ok(row, 'no Portfolio row');
  assert.equal(row.to, '/portfolio/health');
  for (const p of ['/portfolio/health', '/portfolio/updates', '/portfolio/positions',
    '/portfolio/performance', '/portfolio/growth']) {
    assert.ok(tabsTo(portfolio, p), `PortfolioWorkspace no longer tabs to ${p}`);
  }
});

test('Fund owns fund ops, and the workspace tabs to all of it', () => {
  const row = rows.find((r) => r.label === 'Fund');
  assert.ok(row, 'no Fund row');
  assert.equal(row.to, '/funds');
  // Canvas zones: LPs · Calls · Accounting · Reporting.
  for (const p of ['/funds', '/funds/performance', '/funds/accounting', '/lp-reports',
    '/funds/capital-calls', '/funds/lp-workspace']) {
    assert.ok(tabsTo(fundOps, p), `FundOpsWorkspace no longer tabs to ${p}`);
  }
});

test('every destination the old nav reached still has a door', () => {
  // The eighteen items the pre-canvas investor nav carried, verbatim.
  const BEFORE = [
    '/studio', '/spinout-lab', '/messages', '/network',
    '/deals', '/pipeline/screening', '/pipeline/commit', '/pipeline/transactions',
    '/raise/data-room',
    '/portfolio/health', '/portfolio/performance', '/portfolio/updates', '/portfolio/growth',
    '/funds', '/lp-reports', '/funds/performance', '/funds/accounting',
    '/market-intel',
  ];
  const doorless = BEFORE.filter((p) => !targets.includes(p)
    && ![pipeline, portfolio, fundOps].some((ws) => tabsTo(ws, p)));
  assert.deepEqual(doorless, [], 'no nav row and no workspace tab — reachable only by typed URL');
});

test('Spin-Out Lab keeps its row untouched, rather than being renamed to a page nobody designed', () => {
  // The canvas's fourth row is "Axal VC Fund" — the LP's relationship with
  // Axal's own fund — and no page canvas exists for it. The Lab is not a
  // modification target, so the row ships verbatim and the deviation is
  // recorded rather than papered over by inventing the destination.
  assert.match(investor,
    /\{ to: '\/spinout-lab', icon: Rocket, label: 'Spin-Out Lab', match: \['\/spinout-lab', '\/spinout-lab\/investor-workspace'\] \}/,
    'the Spin-Out Lab row changed — it is frozen');
  assert.ok(!labels.includes('Axal VC Fund'),
    'Axal VC Fund needs an audited destination before it gets a row');
});

test('Messages keeps a row because it has no other door', () => {
  assert.ok(targets.includes('/messages'));
});

test('Home is /studio, no role root invented', () => {
  assert.equal(rows[0].to, '/studio');
  assert.equal(rows[0].label, 'Home');
  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/investor'), 'no bare /investor root');
});

test('Trust stays out of the sidebar', () => {
  assert.ok(!targets.includes('/trust'), 'Trust Center belongs to the user dropdown');
});

test('Company Settings is the pinned footer only, never a nav row', () => {
  // It used to be both: a row at the end of the group AND the pinned footer,
  // so every role rendered it twice. The footer is the single entry point now.
  assert.ok(
    !targets.includes('/company-settings'),
    'a /company-settings row is back in the nav config; it duplicates the pinned footer',
  );

  // The guard that moved here with it. SidebarNav's footer is unconditional —
  // no role gate — so removing the row cannot strand a role without a door.
  const nav = readFileSync(resolve(process.cwd(), 'frontend/src/ui/SidebarNav.jsx'), 'utf8');
  assert.ok(/to="\/company-settings"/.test(nav), 'the pinned footer lost its link');
  assert.ok(!/to="\/settings"/.test(nav), 'the footer must not point at the personal Account page');
});
