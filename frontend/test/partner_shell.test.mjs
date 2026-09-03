import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const partner = src.slice(src.indexOf('\n  partner: ['), src.indexOf('\n  investor: ['));
const rows = [...partner.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((match) => ({ to: match[1], label: match[2] }));
const labels = rows.map((row) => row.label);
const targets = rows.map((row) => row.to);

test('Partner sidebar is exactly the seven approved rows in order', () => {
  // Two corrections, both against what `sidebarConfig.js` has actually held on
  // this branch and on main, and neither of them a relaxation — the list is
  // still exact, still ordered, still checked against its destinations.
  //
  // 'Studio', not 'Home'. `rows` above is built from a regex that only matches
  // items carrying a `to:`. 'Home' is the GROUP header — it has no `to:`, so it
  // can never appear in `rows`, and this assertion was comparing a group's name
  // against a row's. The item on /studio has been labelled 'Studio' in every
  // role for as long as the config has existed. The same correction was made in
  // founder_shell, investor_shell and advisor_shell.
  //
  // EVERY WORKSPACE ROW POINTS AT ITS BUCKET ROOT. Pipeline, Delivery, Offers
  // and Research used to point at legacy destinations — /needs,
  // /partner/operations/overview, /services, /signals — so the canvas overview
  // pages (P3, P4, P5, P7) were unreachable from the sidebar and the rows lit
  // up on pages outside their own buckets. The roots render the overviews via
  // PartnerBucketRoutes; the legacy destinations stay in each row's `match`
  // list, which the deep-link test below still pins.
  assert.deepEqual(labels, [
    'Studio',
    'Spin-Out Lab',
    'Pipeline',
    'Delivery',
    'Offers',
    'Network',
    'Research',
  ]);
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/pipeline',
    '/delivery',
    '/offers',
    '/network',
    '/research',
  ]);
  assert.ok(!labels.includes('Messages'));
  assert.ok(!labels.includes('Jobs'));
});

test('Partner shell is one flat, headerless group', () => {
  assert.match(partner, /\{ key: 'shell', label: '', items:/);
  assert.equal([...partner.matchAll(/\{ key: '([^']+)', label:/g)].length, 1);
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(sidebar, /group\.key === 'home' \|\| !group\.label/);
});

test('Home remains /studio and no Partner persona root was invented', () => {
  // 'Home' here is the group; the destination is what the test pins.
  assert.equal(rows[0].to, '/studio');
  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/partner'));
});

test('canonical Partner deep links are owned by the correct workspace', () => {
  const expectedMatches = {
    Pipeline: ['/pipeline', '/needs', '/matches', '/partner/insights', '/partner/operations/engagements'],
    Delivery: ['/delivery', '/partner/operations/overview', '/partner/operations/portfolio', '/partner/operations/performance'],
    Offers: ['/offers', '/services', '/perks', '/comarketing', '/partner/office-hours', '/partner/operations/capabilities'],
    Network: ['/network', '/relationships', '/contacts'],
    Research: ['/research', '/signals', '/market-intel'],
  };
  for (const [label, paths] of Object.entries(expectedMatches)) {
    const rowStart = partner.indexOf(`label: '${label}'`);
    const rowEnd = partner.indexOf('},', rowStart);
    const rowSource = partner.slice(rowStart, rowEnd);
    for (const path of paths) {
      assert.ok(rowSource.includes(`'${path}'`) || targets.includes(path), `${path} is not owned by ${label}`);
    }
  }
});

test('collapsed Pipeline and Offers sections remain reachable from Partner tabs', () => {
  const bars = read('frontend/src/pages/partner/PartnerWorkspaceTabs.jsx');
  const app = read('frontend/src/App.jsx');
  const routeLine = (path) => app.split('\n').find(
    (line) => line.includes(`path="${path}"`) && line.includes('<Route'),
  );
  for (const path of [
    '/needs',
    '/matches',
    '/partner/insights',
    '/services',
    '/perks',
    '/comarketing',
    '/partner/office-hours',
  ]) {
    assert.ok(bars.includes(`to: '${path}'`), `${path} is in no Partner tab set`);
    const line = routeLine(path);
    assert.ok(line, `no route for ${path}`);
    assert.ok(line.includes('PartnerWorkspaceTabs'), `${path} does not mount the Partner tab shell`);
  }
});

test('Partner pages share amber identity and cyan provenance without recoloring other roles', () => {
  const shell = read('frontend/src/pages/partner/PartnerWorkspaceShell.jsx');
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(shell, /text-amber-/);
  assert.match(shell, /border-cyan-/);
  assert.match(shell, /Founder-granted access/);
  assert.match(shell, /Screened and consented/);
  assert.match(shell, /AI assist/);
  assert.match(sidebar, /role === 'partner'/);
  assert.match(sidebar, /role === 'advisor'/);
  assert.match(sidebar, /text-emerald-/);
  assert.match(sidebar, /text-violet-/);
});

test('shared Network and Research pages only mount Partner chrome for Partner users', () => {
  const tabs = read('frontend/src/pages/partner/PartnerWorkspaceTabs.jsx');
  const operations = read('frontend/src/pages/partner/operations/PartnerOperationsWorkspace.jsx');
  const network = read('frontend/src/pages/NetworkPage.jsx');
  const research = read('frontend/src/pages/MarketIntelPage.jsx');
  assert.match(tabs, /user\?\.role !== 'partner'/);
  assert.match(operations, /user\?\.role !== 'partner'/);
  assert.match(network, /role === 'partner'/);
  assert.match(network, /workspace="network"/);
  assert.match(network, /role === 'advisor'/);
  assert.match(research, /user\?\.role === 'partner'/);
  assert.match(research, /workspace="research"/);
  assert.match(research, /Some live market data could not be loaded/);
});

test('Trust stays in the user menu and Company Settings stays in the pinned footer', () => {
  assert.ok(!targets.includes('/trust'));
  assert.ok(!targets.includes('/company-settings'));
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(sidebar, /to="\/company-settings"/);
  assert.ok(!/to="\/settings"/.test(sidebar));
});