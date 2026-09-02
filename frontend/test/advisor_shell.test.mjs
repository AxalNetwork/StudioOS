/**
 * The Advisor Canvas shell contract.
 *
 * Advisor has six top-level rows. Existing concrete pages remain reachable
 * through their canonical deep links, but incidental pages no longer become
 * competing sidebar destinations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  // Two corrections, for two different reasons.
  //
  // 'Studio', not 'Home'. `rows` only matches items carrying a `to:`, and the
  // item pointing at /studio is labelled 'Studio' in every role, here and on
  // main. 'Home' is the GROUP header above it, which has no `to:` and never
  // appears in `rows`. Same correction as investor_shell.test.mjs.
  //
  // 'Cohorts' is a real new row, added by this migration. The Advisor canvas
  // declares a Cohorts bucket, so the shell grew a row for it and the
  // enumeration has to say so. Nothing was relaxed: this still pins the exact
  // list, in order, and the destinations beside it.
  assert.deepEqual(labels, [
    'Studio', 'Spin-Out Lab', 'Practice', 'Cohorts', 'Expertise', 'Network', 'Research',
  ]);
  //
  // EVERY WORKSPACE ROW POINTS AT ITS BUCKET. Practice, Expertise and Research
  // used to point outside their own buckets — at /advisor/advisory/opportunities,
  // /office-hours and /signals — because those destinations were claimed by
  // earlier decisions. Two of the three were also wrapped in
  // `advisorPrivateWorkspace`, which redirects an admin previewing the Advisor
  // role to /studio, so for that viewer those rows opened no workspace at all.
  // The legacy routes stay registered and stay in `match` (asserted below).
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/practice',
    '/cohorts',
    '/expertise',
    '/network',
    '/research',
  ]);
});

test('Practice owns the whole advisory subtree, and the workspace tabs to all of it', () => {
  const practice = rows.find((r) => r.label === 'Practice');
  assert.ok(practice, 'no Practice row');
  // The row moved onto its bucket; owning the legacy subtree is now a `match`
  // entry beside it rather than the destination itself, so a deep link into
  // /advisor/advisory still lights the Practice row.
  assert.match(advisor, /match: \['\/practice', '\/advisor\/advisory'\]/,
    'Practice must still match the legacy advisory subtree');

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
  // The row points at its bucket; /office-hours keeps its route, keeps
  // rendering AdvisorExpertiseWorkspace for an advisor, and stays in `match`.
  assert.match(advisor, /\{ to: '\/expertise', icon: UserCircle, label: 'Expertise'/);
  assert.match(advisor, /match: \['\/expertise', '\/office-hours', '\/advisors'\]/);
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

/* ────────────────────────────────────────────────────────────────────────────
 * The advisor half of the checks the founder and investor shells already make.
 * Same three defects, reported a third time in the same words — so the same
 * three checks, scoped to this licence.
 * ──────────────────────────────────────────────────────────────────────────── */

test('every advisor workspace row lands inside its own bucket', () => {
  // Not "on its overview": the four Advisor canvases specify zone pages only,
  // with no overview artboard, so a bucket root that resolves to its first
  // zone IS the landing. What must not happen is a row pointing OUTSIDE its
  // bucket — which is where Practice, Expertise and Research were, and two of
  // those destinations bounce an admin previewing the role to /studio.
  const shell = codeOnly(read('frontend/src/workspaces/shellConfig.js'));
  const block = shell.slice(shell.indexOf("  advisor: {\n    accent:"), shell.indexOf('  partner: {'));
  const prefixes = [...block.matchAll(/prefix: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(prefixes, ['/practice', '/cohorts', '/expertise', '/network', '/research'],
    'the advisor shell no longer declares these five buckets');

  const app = read('frontend/src/App.jsx');
  for (const prefix of prefixes) {
    const row = rows.find((r) => r.to === prefix);
    assert.ok(row, `no advisor row points at ${prefix}`);
    assert.ok(app.includes(`path="${prefix}"`), `${prefix} has no route`);
  }
  // And none of them points back at a destination outside its bucket.
  for (const outside of ['/advisor/advisory/opportunities', '/office-hours', '/signals', '/cohorts/founders']) {
    assert.ok(!targets.includes(outside),
      `an advisor row points at ${outside}, outside the bucket it belongs to`);
  }
});

test('every advisor bucket route carries the Worker AI rail', () => {
  // Fifteen routes rendered through AdvisorBucketRoutes and it filled none of
  // WorkspaceShell's rail slot, so Practice, Cohorts and Expertise each drew an
  // empty right-hand column: "some pages doesn't have it, it does show
  // anything, it looks blank", filed for the third licence.
  const bucketRoutes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(bucketRoutes, /rail=\{RAIL && \(\s*<WorkerRail/,
    'AdvisorBucketRoutes must fill the shell’s rail slot');
  assert.match(bucketRoutes, /role="advisor"/, 'the rail must carry the advisor accent');
  for (const workspace of ['Practice', 'Cohorts', 'Expertise']) {
    assert.ok(bucketRoutes.includes(`workspace: '${workspace}'`), `${workspace} has no rail copy`);
  }
  // A zone with no store must not have the rail claiming coverage it cannot
  // produce — the rail is the one element that must never read as more certain
  // than the body beside it.
  assert.match(bucketRoutes, /has no store behind it/,
    'the rail must say when the zone it describes has nothing behind it');

  // Network and Research reach the advisor through the shared shells, which
  // have passed a rail since the founder pass. What was missing was the route:
  // bare /network gave an advisor NetworkPage with no shell at all.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /effectiveRole === 'advisor' \? <NetworkWorkspace role="advisor" \/>/,
    'bare /network must give an advisor the zone shell, not the bare page');
  assert.match(app, /researchRole === 'advisor' \|\| researchRole === 'partner'/,
    'bare /research must resolve for an advisor rather than redirecting past it');
});

test('nothing under pages/advisor hand-builds a rail of its own', () => {
  // The same shape check the founder and investor suites make. Thirty-nine
  // hand-built rails accumulated across two licences before anything looked
  // for them by shape rather than by mount.
  const dir = 'frontend/src/pages/advisor';
  const own = [];
  const walk = (rel) => {
    for (const f of readdirSync(resolve(process.cwd(), rel), { withFileTypes: true })) {
      if (f.isDirectory()) walk(`${rel}/${f.name}`);
      else if (f.name.endsWith('.jsx')
        && /<aside[^>]*className="[^"]*rail/.test(codeOnly(read(`${rel}/${f.name}`)))) {
        own.push(`${rel}/${f.name}`);
      }
    }
  };
  walk(dir);
  assert.deepEqual(own, [], 'these pages hand-build a rail instead of using the shared one');
});
