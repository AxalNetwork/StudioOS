/**
 * The Partner shell follows the canvas, and no surface lost its door.
 *
 * The Partner canvas does not describe its sidebar — it declares it:
 *
 *   // CANONICAL Partner shell — 8 rows, no tier gating in v1.
 *   const ROWS = ['Home','Pipeline','Delivery','Offers','Network','Research',
 *                 'Trust','Firm Settings'];
 *
 * A FLAT list. The first reading of these canvases matched group NAMES and
 * concluded the IA was mostly aligned; it was not.
 *
 * THE TEST THAT MATTERS IS THE SECOND ONE. Flattening a sidebar does not fail
 * loudly when it goes wrong: the route still resolves, it just stops having a
 * door, and nothing notices until a user says "where did X go". The first cut
 * of this restructure did exactly that to five surfaces — /matches,
 * /partner/insights, /comarketing, /perks and /partner/office-hours, each of
 * which a search of every `to=` and `navigate(` in frontend/src showed has NO
 * other inbound link. So reachability is asserted two ways: a row of its own,
 * or a workspace that tabs to it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const partner = src.slice(src.indexOf('\n  partner: ['), src.indexOf('\n  investor: ['));

const rows = [...partner.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const labels = rows.map((r) => r.label);
const targets = rows.map((r) => r.to);

test('the canvas rows are all present, in the canvas order', () => {
  // A subsequence check, not equality: rows still pending absorption sit
  // between them, and the next test is what keeps that list honest.
  // Company Settings is the pinned footer in SidebarNav, not a nav row, so it
  // is deliberately absent here — see the footer test at the bottom.
  const CANON = ['Home', 'Pipeline', 'Delivery', 'Offers', 'Network', 'Research'];
  let i = 0;
  for (const l of labels) if (l === CANON[i]) i += 1;
  assert.equal(i, CANON.length,
    `canonical rows out of order or missing — got ${JSON.stringify(labels)}`);
});

test('the shell is flat — one group, not seven', () => {
  const groups = [...partner.matchAll(/\{ key: '([^']+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['shell'], 'the canvas declares rows, not groups');
});

test('every destination the old nav reached still has a door', () => {
  const BEFORE = [
    '/studio', '/messages', '/services', '/matches', '/needs', '/partner/insights',
    '/partner/office-hours', '/comarketing', '/my/jobs', '/perks', '/network',
    '/partner/operations/overview', '/partner/operations/capabilities',
    '/partner/operations/portfolio', '/partner/operations/engagements',
    '/partner/operations/performance', '/market-intel',
  ];
  // A door is a nav row, or a tab bar that demonstrably links it. There are two
  // bars now: the ops workspace (Wave 1a) and the route wrapper this commit
  // added. Both are READ rather than assumed.
  const opsTabs = read('frontend/src/pages/partner/operations/PartnerOperationsWorkspace.jsx');
  const routeTabs = read('frontend/src/pages/partner/PartnerWorkspaceTabs.jsx');
  const doorless = BEFORE.filter((p) => !targets.includes(p)
    && !opsTabs.includes(`to: '${p}'`)
    && !routeTabs.includes(`to: '${p}'`));
  assert.deepEqual(doorless, [],
    'these have no nav row and no tab bar — reachable only by typing the URL');
});

test('the two rows beyond the canvas are the two that earn it', () => {
  // This list began as seven and was called PENDING, which promised a further
  // absorption. `PartnerWorkspaceTabs` delivered most of it: /matches,
  // /partner/insights, /perks, /comarketing and /partner/office-hours are
  // sections of a row rather than rows, and left the nav and this list in the
  // same commit.
  //
  // The two that remain are not pending. They are decided, and the investor,
  // advisor and founder shells reached the same answer independently:
  //
  //   /messages  a cross-cutting inbox has no home among eight lifecycle rows,
  //              and it has NO other door in any of the four roles. Every shell
  //              gives it a row for that reason, so the product reads the same
  //              way whichever profile you are in.
  //   /my/jobs   not a section of Offers — those are the partner's own listings
  //              — and it has four inbound links elsewhere. Folding it in to
  //              reach exactly eight would be arithmetic, not information
  //              architecture.
  const KEPT = ['/messages', '/my/jobs'];
  const CANON = [
    '/studio', '/needs', '/partner/operations/overview', '/services',
    '/network', '/market-intel', '/company-settings',
  ];
  const extra = targets.filter((t) => !CANON.includes(t));
  assert.deepEqual(extra.sort(), [...KEPT].sort(),
    'the set of rows beyond the canvas changed — justify the addition here, or remove it');
});

test('every section of a collapsed row is reachable from its tab bar', () => {
  // Two things have to hold, and they fail independently: the path must be in a
  // tab set, AND its route must be wrapped so the bar actually renders there.
  // A tab set nobody mounts is the same nothing as no tab set.
  const bars = read('frontend/src/pages/partner/PartnerWorkspaceTabs.jsx');
  const app = read('frontend/src/App.jsx');
  const routeLine = (p) => app.split('\n').find(
    (l) => l.includes(`path="${p}"`) && l.includes('<Route'));
  for (const p of ['/matches', '/partner/insights', '/perks', '/comarketing',
                   '/partner/office-hours', '/needs', '/services']) {
    assert.ok(bars.includes(`to: '${p}'`), `${p} is in no tab set`);
    const line = routeLine(p);
    assert.ok(line, `no route for ${p}`);
    assert.ok(line.includes('PartnerWorkspaceTabs'),
      `${p}'s route is not wrapped, so the bar never renders on it`);
  }
});

test('Home is /studio, and no role root was invented', () => {
  assert.equal(rows[0].to, '/studio');
  assert.equal(rows[0].label, 'Home');
  assert.ok(!targets.includes('/home'), 'no /home root');
  assert.ok(!targets.includes('/partner'), 'no bare /partner root');
});

test('Trust stays out of the sidebar', () => {
  // The canvas asks for a Trust row. `trust_center_navigation.test.mjs` says
  // Trust Center appears in no sidebar and lives in the user dropdown between
  // User Settings and Support. Asserted from the Partner side too so the two
  // cannot drift apart silently.
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
