/**
 * "Spin-Out Lab" means two different products depending on who is asking.
 *
 * For a founder it is the 4-week program: apply, get accepted, work the week
 * timeline. For an LP it is the FUND — thesis, key terms, participation tiers,
 * underwriting data on the cohort, the reporting archive, and commitment-gated
 * allocation. Both live at /spinout-lab, and the investor profile was serving
 * the founder one: a week timeline and an "Apply Now" CTA for a cohort
 * application that POST /spinout-lab/apply hard-403s for an investor.
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

test('/spinout-lab serves the LP workspace to investors and the founder page to everyone else', () => {
  assert.match(
    app,
    /path="\/spinout-lab"[\s\S]{0,400}effectiveRole === 'investor'[\s\S]{0,120}<SpinoutLabLpWorkspacePage \/>[\s\S]{0,80}<SpinoutLabPage \/>/,
    'the /spinout-lab route must branch on the active role',
  );
});

test('a logged-out visitor still gets the public marketing page', () => {
  assert.match(
    app,
    /path="\/spinout-lab"[\s\S]{0,500}:\s*<SpinoutLabPage \/>\s*\n?\s*\}/,
    'the signed-out arm of /spinout-lab must stay SpinoutLabPage',
  );
});

test('the LP workspace is lazily imported, so a founder never downloads it', () => {
  assert.match(app, /const SpinoutLabLpWorkspacePage = lazy\(\(\) => import\('\.\/pages\/SpinoutLabLpWorkspacePage'\)\)/);
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
  assert.match(sidebar, /investor: \[[\s\S]{0,1200}to: '\/spinout-lab', icon: Rocket, label: 'Spin-Out Lab'/);
});

test('the duplicate LP Workspace nav item is gone, but its route is not', () => {
  assert.doesNotMatch(
    sidebar,
    /to: '\/funds\/lp-workspace'/,
    'two nav items opening identical content is the confusion, not the fix',
  );
  assert.match(
    app,
    /path="\/funds\/lp-workspace" element=\{guard\(\['admin', 'investor'\], <FundOpsWorkspace \/>\)\}/,
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
