/**
 * The Advisor Canvas shell contract.
 *
 * Advisor has six top-level rows. Existing concrete pages remain reachable
 * through their canonical deep links, but incidental pages no longer become
 * competing sidebar destinations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const advisor = src.slice(src.indexOf('\n  advisor: ['), src.indexOf('\n  exploring: ['));

const rows = [...advisor.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

test('the canvas rows are present, in the canvas order', () => {
  assert.deepEqual(labels, ['Home', 'Spin-Out Lab', 'Practice', 'Expertise', 'Network', 'Research']);
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/advisor/advisory/opportunities',
    '/office-hours',
    '/network',
    '/signals',
  ]);
});

test('Practice owns the whole advisory subtree, and the workspace tabs to all of it', () => {
  const practice = rows.find((r) => r.label === 'Practice');
  assert.ok(practice, 'no Practice row');
  assert.match(advisor, /match: \['\/advisor\/advisory'\]/, 'Practice must match the subtree');

  // The row may only own them because the workspace links every one. Read it.
  const ws = read('frontend/src/pages/advisor/AdvisorWorkspaceShell.jsx');
  for (const page of ['opportunities', 'clients', 'engagements', 'delivery', 'contracts']) {
    assert.ok(ws.includes(`to: '/advisor/advisory/${page}'`),
      `Practice no longer links to ${page}`);
  }
});

test('canonical deep links remain registered even when not sidebar rows', () => {
  const app = read('frontend/src/App.jsx');
  for (const path of [
    '/advisor/advisory/opportunities',
    '/advisor/advisory/clients',
    '/advisor/advisory/engagements',
    '/advisor/advisory/delivery',
    '/advisor/advisory/contracts',
    '/office-hours',
    '/advisors',
    '/network',
    '/signals',
  ]) {
    assert.ok(app.includes(`path="${path}"`), `${path} lost its canonical route`);
  }
  for (const legacyRow of ['/messages', '/my/jobs', '/advisors', '/market-intel', '/due-diligence']) {
    assert.ok(!targets.includes(legacyRow), `${legacyRow} became a competing advisor row`);
  }
});

test('Expertise owns the canonical advisor profile destination', () => {
  assert.match(advisor, /\{ to: '\/office-hours', icon: UserCircle, label: 'Expertise'/);
  assert.match(read('frontend/src/App.jsx'), /effectiveRole === 'advisor' \? <AdvisorExpertiseWorkspace \/> : <OfficeHoursPage \/>/);
  assert.match(read('frontend/src/pages/advisor/AdvisorExpertiseWorkspace.jsx'), /OfficeHoursPage embedded/);
});

test('Advisor-only framing is isolated from shared roles', () => {
  const network = read('frontend/src/pages/NetworkPage.jsx');
  const signals = read('frontend/src/pages/SignalsPage.jsx');
  assert.match(network, /role === 'advisor'/);
  assert.match(signals, /mode === 'advisor'/);
  assert.match(read('frontend/src/ui/SidebarNav.jsx'), /advisorAccent/);
  assert.doesNotMatch(read('frontend/src/App.jsx'), /<Route path="\/advisor"/);
});

test('Home is /studio, no role root invented', () => {
  assert.equal(rows[0].to, '/studio');

  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/advisor'), 'no bare /advisor root');
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
