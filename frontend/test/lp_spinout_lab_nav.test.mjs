/**
 * "Spin-Out Lab" means two different products depending on who is asking.
 *
 * For a founder it is the 4-week program: apply, get accepted, work the week
 * timeline. For an LP it is the FUND, reached as a two-step journey:
 *
 *   /spinout-lab                     → SpinoutLabInvestorPage, the Fund I
 *                                      conviction/sales page (what founders do
 *                                      inside the Lab, the operating stack,
 *                                      the underwriting edge, studio proof)
 *   /spinout-lab/investor-workspace  → Spin-Out Lab · LP & Investor Workspace
 *                                      (fund terms, raise status, tiers,
 *                                      reporting, allocation, apply)
 *
 * The investor profile originally served the FOUNDER page at /spinout-lab: a
 * week timeline and an "Apply Now" CTA for a cohort application that POST
 * /spinout-lab/apply hard-403s for an investor.
 *
 * The routing fix is only as good as the role it branches on, so most of this
 * file is about that. `resolveActiveRole` is the shared answer to "who is
 * browsing"; the app shell picks the sidebar from it and the router picks route
 * elements from it. If either re-derives the role inline, they can disagree —
 * and the visible symptom is precisely what was reported: an "Investor View"
 * chip in the sidebar sitting above the founder program.
 *
 * Source-level assertions where they have to be — the frontend has no React
 * test runner, so (like the other frontend/test/*.mjs suites) we parse the
 * source directly. resolveActiveRole itself is React-free and imported for real.
 *
 * Run with:  node --test frontend/test/lp_spinout_lab_nav.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveActiveRole } from '../src/lib/activeRole.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

const app = read('App.jsx');
const sidebar = read('sidebarConfig.js');
const fundOps = read('pages/FundOpsWorkspace.jsx');

/* ------------------------------------------------------ who is browsing */

test('a plain investor browses as an investor', () => {
  assert.equal(
    resolveActiveRole({ user: { role: 'investor' }, viewMode: 'admin' }),
    'investor',
    'viewMode is an ADMIN-only switcher; it must not override a real role',
  );
});

test('an admin in Investor View browses as an investor', () => {
  // The reported bug in one assertion: this admin's user.role is 'admin', so
  // any surface keying off user.role shows them the founder product while the
  // sidebar chip says "Investor View".
  assert.equal(
    resolveActiveRole({ user: { role: 'admin' }, viewMode: 'investor' }),
    'investor',
  );
  assert.equal(
    resolveActiveRole({ user: { role: 'admin' }, viewMode: 'admin' }),
    'admin',
    'an admin who has not switched still browses as an admin',
  );
});

test('impersonation wins over the view switcher', () => {
  assert.equal(
    resolveActiveRole({
      user: { role: 'founder' },
      realUser: { role: 'admin' },
      viewMode: 'investor',
      isImpersonating: true,
    }),
    'founder',
    'impersonating a founder must show the founder product, whatever viewMode says',
  );
});

test('a signed-out session has no active role', () => {
  assert.equal(resolveActiveRole({}), undefined);
  assert.equal(resolveActiveRole(), undefined, 'called with no session at all');
  assert.equal(
    resolveActiveRole({ user: null, realUser: null }),
    undefined,
    'null user must not read as a role',
  );
});

test('no role is invented for an admin who has not picked a view', () => {
  assert.equal(resolveActiveRole({ user: { role: 'admin' }, viewMode: undefined }), undefined);
});

/* ------------------------------------------------------------- the route */

test('/spinout-lab serves the investor sales page to investors and the founder page to everyone else', () => {
  assert.match(
    app,
    /path="\/spinout-lab"[\s\S]{0,400}effectiveRole === 'investor'[\s\S]{0,120}<SpinoutLabInvestorPage \/>[\s\S]{0,80}<SpinoutLabPage \/>/,
    'the /spinout-lab route must branch on the active role',
  );
});

test('the LP workspace is a first-class, role-gated route under /spinout-lab', () => {
  assert.match(
    app,
    /path="\/spinout-lab\/investor-workspace" element=\{guard\(\['admin', 'investor'\], investorWorkspace\('axal-vc-fund', null\)\)\}/,
    'the deeper second step must be routed and gated to investors/admins',
  );
});

test('a logged-out visitor still gets the public marketing page', () => {
  assert.match(
    app,
    /path="\/spinout-lab"[\s\S]{0,500}:\s*<SpinoutLabPage \/>\s*\n?\s*\}/,
    'the signed-out arm of /spinout-lab must stay SpinoutLabPage',
  );
});

test('both investor surfaces are lazily imported, so a founder never downloads them', () => {
  assert.match(app, /const SpinoutLabInvestorPage = lazy\(\(\) => import\('\.\/pages\/SpinoutLabInvestorPage'\)\)/);
  assert.match(app, /const InvestorWorkspacePage = lazy\(\(\) => import\('\.\/pages\/investor\/InvestorWorkspacePage'\)\)/);
  const investorWorkspace = read('pages/investor/InvestorWorkspacePage.jsx');
  assert.match(investorWorkspace, /import SpinoutLabLpWorkspacePage from '\.\.\/SpinoutLabLpWorkspacePage'/);
});

/* -------------------------------------------------------- the sales page */

const salesPage = read('pages/SpinoutLabInvestorPage.jsx');
const content = read('lib/spinoutInvestorContent.js');

test('every sales-page CTA routes into the LP workspace — the CTA flow is real', () => {
  assert.match(
    salesPage,
    /export const LP_WORKSPACE_PATH = '\/spinout-lab\/investor-workspace'/,
    'one exported destination constant, not scattered strings',
  );
  const links = salesPage.match(/to=\{LP_WORKSPACE_PATH\}/g) || [];
  assert.ok(links.length >= 4, `hero, fund-position, workspace and request-access CTAs all point at the workspace (found ${links.length})`);
  assert.doesNotMatch(salesPage, /to="\/funds\/lp-workspace"/, 'the investor journey stays in the /spinout-lab namespace');
});

test('sales-page claims are centralized, and shared figures come from the fund model', () => {
  assert.match(salesPage, /from '\.\.\/lib\/spinoutInvestorContent'/, 'the page renders the content module, not inline copy');
  assert.match(content, /import \{ FUND, PROGRAM, THESIS \} from '\.\/spinoutFundModel'/,
    'numbers also stated by the workspace/brief must come from the single fund model');
  assert.match(content, /headline: THESIS\.headline/, 'the hero headline is the shared thesis sentence');
});

test('the cohort snapshot is captioned as an illustrative composite, not live readings', () => {
  // No endpoint reports per-company cohort telemetry to investors. Rendering
  // the design's six named "live readings" without provenance would be a fake
  // claim on an LP-facing page — the caption is required, not decorative.
  assert.match(content, /provenance:\s*'Illustrative composite/);
  assert.match(salesPage, /\{COHORT_SNAPSHOT\.provenance\}/, 'the page must render the provenance caption verbatim');
});

test('the sales page overlays live fund metrics with the workspace fallback semantics', () => {
  assert.match(salesPage, /spinoutLab\.fundMetrics\(\)/, 'live program/raise figures come from the real endpoint');
  assert.match(salesPage, /live\?\.program\?\.available \? live\.program : null/,
    'a block is used only when it answers available — a failed fetch falls back to the operator-maintained model');
});

/* ------------------------------------------- shell and router cannot drift */

test('both the shell and the router resolve the active role through the shared helper', () => {
  assert.match(app, /import \{ resolveActiveRole \} from '\.\/lib\/activeRole'/);
  const calls = app.match(/resolveActiveRole\(\{/g) || [];
  assert.equal(
    calls.length,
    2,
    'exactly two callers: the shell (sidebar) and the router (route elements)',
  );
  // The inline ternary this replaced is the drift hazard: two copies of the
  // same rule, one of which was never updated.
  assert.doesNotMatch(
    app,
    /isImpersonating \? user\?\.role : \(isAdmin \? viewMode : user\?\.role\)/,
    'the role rule must not be re-derived inline anywhere',
  );
});

/* ---------------------------------------------------------------- the IA */

test('the investor Home nav keeps its Spin-Out Lab entry', () => {
  // Same item, same place as the founder and exploring navs — it just resolves
  // to the LP product now. Removing it would hide the fund from LPs entirely.
  assert.match(sidebar, /investor: \[[\s\S]{0,1600}to: '\/spinout-lab', icon: Rocket, label: 'Spin-Out Lab'/);
});

test('the duplicate LP Workspace nav item is gone, but its route is not', () => {
  assert.doesNotMatch(
    sidebar,
    /to: '\/funds\/lp-workspace'/,
    'two nav items opening identical content is the confusion, not the fix',
  );
  assert.match(
    app,
    /path="\/funds\/lp-workspace" element=\{guard\(\['admin', 'investor'\], investorFundWorkspace\(<FundOpsWorkspace \/>\)\)\}/,
    'the route must stay registered — deep links and the Fund Ops tab strip use it',
  );
  assert.match(
    fundOps,
    /to: '\/funds\/lp-workspace', label: 'LP Workspace'/,
    'and it must stay a tab inside Fund Ops',
  );
});

test('the LP workspace renders standalone, not only embedded', () => {
  const lp = read('pages/SpinoutLabLpWorkspacePage.jsx');
  assert.match(lp, /export default function SpinoutLabLpWorkspacePage\(\{ embedded = false \}\)/);
  // Mounted at a top-level route it gets no Fund Ops chrome, so it has to bring
  // its own header and page padding.
  assert.match(lp, /if \(embedded\) \{\s*\n\s*return loading \? <LpSkeleton \/> : body;/);
  assert.match(lp, /<WorkspaceHeader/);
});

/* -------------------------------- live studio metrics + the apply flow */

const workspace = read('pages/SpinoutLabLpWorkspacePage.jsx');
const api = read('lib/api.js');

test('each studio-proof tile falls back independently, not the whole page at once', () => {
  // /fund-metrics can measure some figures and not others (a null percentage
  // there means "no denominator"), so the page picks per TILE. An all-or-
  // nothing merge would either hide live numbers it has or print fallbacks as
  // though they were measured.
  assert.match(salesPage, /const pick = \(liveValue, format, staticTile\)/);
  const picks = salesPage.match(/pick\(liveProgram\?\./g) || [];
  assert.equal(picks.length, 5, `the five previously-static tiles are now live-capable (found ${picks.length})`);
});

test('the studio-proof caption counts live tiles rather than claiming all or none', () => {
  assert.match(salesPage, /const liveTiles = proofStudio\.filter\(\(t\) => t\.live\)\.length/);
  assert.match(salesPage, /data-testid="text-studio-provenance"/);
});

test('the LP application posts for real — no dead-end copy left', () => {
  assert.match(api, /submitLpApplication: \(body\) =>/);
  assert.match(api, /request\('\/spinout-lab\/lp-application', \{ method: 'POST'/);
  assert.match(workspace, /<LpApplicationForm/);
  assert.match(workspace, /spinoutLab\.submitLpApplication\(/);
  // The old admission that the form was unwired must be gone with it.
  assert.doesNotMatch(workspace, /no LP-application\s*\n?\s*\/\/?\s*endpoint exists yet/);
  assert.doesNotMatch(workspace, /is not wired/);
});

test('the form stays hidden when the application status could not be read', () => {
  // "Could not tell" is not "never applied" — showing a fresh form to someone
  // who already applied invites a duplicate submission.
  assert.match(workspace, /applicationLoaded/);
  assert.match(workspace, /if \(!loaded\) \{/);
});

test('accreditation gates submission on the client too', () => {
  assert.match(workspace, /disabled=\{busy \|\| !accredited\}/,
    'the submit button is disabled until Rule 501 is certified');
});

test('the access ladder reads the application, and the workspace feeds it one', () => {
  assert.match(workspace, /lpAccessState\(portal, application\)/);
  assert.match(workspace, /spinoutLab\.lpApplication\(\)/);
});
