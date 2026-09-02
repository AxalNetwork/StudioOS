/**
 * The Advisor Canvas shell contract.
 *
 * Advisor has six top-level rows. Existing concrete pages remain reachable
 * through their canonical deep links, but incidental pages no longer become
 * competing sidebar destinations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  // The row points at its bucket. `/office-hours` used to be the second half
  // of this row's ownership and is now retired — it coupled the storefront to
  // booking and was broken at both, so the two halves went to the buckets that
  // work: storefront to Expertise, booking to Practice.
  const app = read('frontend/src/App.jsx');
  assert.match(advisor, /\{ to: '\/expertise', icon: UserCircle, label: 'Expertise'/);
  assert.match(advisor, /match: \['\/expertise', '\/advisors'\]/,
    'the Expertise row no longer claims a path that redirects elsewhere');

  const line = app.split('\n').find((l) => l.includes('path="/office-hours"'));
  assert.ok(line, 'the path must still resolve — bookmarks outlive pages');
  assert.match(line, /<Navigate to="\/practice\/opportunities" replace \/>/,
    'and it redirects to where booking actually lives');

  // Both components are gone, not merely unmounted. Dead code that is also
  // broken is worse than removed code.
  for (const gone of [
    'frontend/src/pages/OfficeHoursPage.jsx',
    'frontend/src/pages/advisor/AdvisorExpertiseWorkspace.jsx',
  ]) {
    assert.ok(!existsSync(resolve(process.cwd(), gone)), `${gone} should have been deleted`);
  }
  assert.doesNotMatch(app, /\bOfficeHoursPage\b|\bAdvisorExpertiseWorkspace\b/,
    'and nothing still imports them');
  // Neither of the two surfaces that merely share the name is touched:
  // /partner/office-hours is a different licence, /spinout-lab/office-hours a
  // different tool. Both carry the identical DTO defects and are named as out
  // of scope rather than quietly swept in.
  assert.match(app, /path="\/partner\/office-hours"/);
  assert.match(app, /path="\/spinout-lab\/office-hours"/);
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

test('an advisor never gets two headers or two rails on one page', () => {
  // PR #392 gave AdvisorBucketRoutes the shell's rail, which was the fix — and
  // missed that AdvisorWorkspaceShell defaults `rail = true` and draws its own
  // header too. So /expertise/* and advisor /network/* rendered two of each
  // inside one another. `embedded` is how an inner shell says the outer one
  // owns the chrome; the investor pages have had this seam since #391.
  const inner = codeOnly(read('frontend/src/pages/advisor/AdvisorWorkspaceShell.jsx'));
  assert.match(inner, /embedded = false,/, 'AdvisorWorkspaceShell must accept an embedded flag');
  assert.match(inner, /if \(embedded\) return/, 'embedded must suppress the header and the rail');

  // Every component the bucket routes mount inside WorkspaceShell must pass it
  // through, and every mount site must set it.
  // Expertise is absent from this list because it no longer has an inner shell
  // to suppress: its five zones are their own body-only pages, checked below.
  for (const [file, msg] of [
    ['frontend/src/pages/advisor/advisory/AdvisorAdvisoryWorkspace.jsx', 'Practice'],
    ['frontend/src/pages/NetworkPage.jsx', 'Network'],
  ]) {
    const src = codeOnly(read(file));
    assert.match(src, /\{ embedded = false \}/, `${msg} must accept embedded`);
    assert.match(src, /embedded=\{embedded\}/, `${msg} must pass embedded to its inner shell`);
  }
  const bucketRoutes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(bucketRoutes, /<AdvisorAdvisoryWorkspace embedded \/>/,
    'the Practice workspace carries its own shell and must be mounted embedded');
  assert.match(codeOnly(read('frontend/src/workspaces/NetworkWorkspace.jsx')),
    /<NetworkPage embedded \/>/, 'the shared network shell must mount NetworkPage embedded');

  // The Expertise zone pages take the other route to the same guarantee: they
  // render a BODY and carry no shell of their own, so there is no second
  // header or rail to suppress. That has to be checked rather than assumed —
  // a later zone page that reached for AdvisorWorkspaceShell would bring the
  // double chrome straight back, and it would be mounted with no `embedded`
  // to catch it.
  let zoneCount = 0;
  for (const zoneDir of [
    'frontend/src/pages/advisor/expertise',
    'frontend/src/pages/advisor/practice',
  ]) {
    for (const f of readdirSync(resolve(process.cwd(), zoneDir)).filter((x) => x.endsWith('.jsx'))) {
      zoneCount += 1;
      const src = codeOnly(read(`${zoneDir}/${f}`));
      assert.doesNotMatch(src, /AdvisorWorkspaceShell/,
        `${f} must render a body only — WorkspaceShell above it already draws the chrome`);
      assert.doesNotMatch(src, /<WorkerRail/,
        `${f} must not draw a second Worker AI rail`);
    }
  }
  assert.ok(zoneCount >= 6, 'every backed zone has its own page, plus their shared kits');
});

test('the advisor preview boundary is stated, and covers every surface that renders a practice', () => {
  // The boundary is right — an admin in View-as-Advisor has picked a role, not
  // a person, so there is no practice to scope to. Two things were wrong with
  // how it was enforced: it redirected to /studio with no explanation, which is
  // indistinguishable from a broken link and was reported as one; and it
  // covered /advisor/advisory/* and /office-hours while /practice/* and
  // /expertise/* rendered the same two components ungated.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /advisorRolePreview \? <AdvisorPreviewNotice \/> : component/,
    'the gate must state its reason rather than redirect to /studio');
  assert.doesNotMatch(app, /advisorRolePreview \? <Navigate to="\/studio"/,
    'the silent redirect is back');

  // Every Practice and Expertise zone route carries it. Cohorts deliberately
  // does not: it renders no personal practice, only Lab-sourced empties.
  const gated = (app.match(/<AdvisorBucketRoutes preview=\{advisorRolePreview\} \/>/g) || []).length;
  assert.equal(gated, 10, 'all five Practice and five Expertise zone routes must carry the gate');
  for (const cohortZone of ['/cohorts/founders', '/cohorts/guidance', '/cohorts/this-week',
    '/cohorts/calendar', '/cohorts/outcomes']) {
    const line = app.split('\n').find((l) => l.includes(`path="${cohortZone}"`));
    assert.ok(line && !line.includes('preview='),
      `${cohortZone} renders no personal practice and must not be gated`);
  }

  // And the notice keeps the shell around it, so the reader can still see which
  // workspace they are in — the thing the redirect destroyed.
  assert.match(codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx')),
    /if \(preview\) return <AdvisorPreviewNotice \/>;/,
    'the notice must replace the body, not the whole page');
});
