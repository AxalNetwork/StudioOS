/**
 * The Founder shell — twenty-one items to ten rows, and the bar that had to
 * be built before the collapse was safe.
 *
 * Founder is the hardest of the four roles. Investor collapsed cleanly because
 * three workspaces already tabbed across their whole subtrees. Founder has no
 * such thing: `PitchWorkspacePage`, `CapitalWorkspacePage` and
 * `LegalEnginePage` each tab only within themselves and nothing links one to
 * another, while `ExecutionPage`, `FounderTeamPage`, `DiscoveryPage` and
 * `FounderMarketplacePage` have no tab bar at all.
 *
 * So the audit came first. Searching every `to=`, `to:`, `navigate(` and
 * `link=` in frontend/src outside sidebarConfig.js, six destinations had
 * zero inbound links — their sidebar row was the only door:
 *
 *     /execution  /signals  /build/team
 *     /build/metrics  /network-effects  /raise/capital
 *
 * The cycle module doors and quiet editor returns preserve navigation after the desks retire. Every
 * assertion below reads that file, or App.jsx,
 * rather than trusting the sidebar's own comments — because `match` decides
 * which row highlights, and does not create a link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { FOUNDER_FULL_BLEED } from '../src/sidebarConfig.js';
import { actual, checks } from './_founder_tool_checks.mjs';
import { allZoneRoutes } from '../src/workspaces/shellConfig.js';
// D528 — App.jsx plus every module under frontend/src/routes/, so a route in a module is checked like one in App.jsx.
import { readRoutesSource } from './_routesSource.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const founder = src.slice(src.indexOf('\n  founder: ['), src.indexOf('\n  partner: ['));

const rows = [...founder.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

const toolNavigation = codeOnly(read('frontend/src/pages/cycles/founderToolNavigation.js'));
const app = codeOnly(readRoutesSource());

test('the canvas rows are present, in the canvas order', () => {
  // Canvas ROWS: Home · Validate · Build · Raise · Grow · Network · Research.
  // Trust is excluded on purpose (below); Company Settings is the pinned
  // footer in SidebarNav, not a nav row, so it is not in this list.
  //
  // The first entry is 'Studio', not 'Home'. `rows` is built from a regex that
  // only matches items carrying a `to:`, and the item pointing at /studio has
  // been labelled 'Studio' in every role, on this branch and on main, for as
  // long as the config has existed — 'Home' is the GROUP header above it,
  // which has no `to:` and so is never in `rows`. This assertion had been
  // reading the group's name and comparing it against the row's. The same
  // correction was made in investor_shell.test.mjs; advisor_shell and
  // partner_shell carry the identical defect.
  const CANON = ['Studio', 'Validate', 'Build', 'Raise', 'Grow', 'Network', 'Research'];
  let i = 0;
  for (const l of labels) if (l === CANON[i]) i += 1;
  assert.equal(i, CANON.length, `canonical rows out of order or missing: ${JSON.stringify(labels)}`);
});

test('the shell is eight rows, not twenty-one', () => {
  assert.equal(rows.length, 8, `founder shell drifted off eight rows: ${JSON.stringify(labels)}`);
});

test('the missing tools have doors from their cycle modules',()=>checks.doors(actual));

test('the former sibling-bar editors return to their own modules',()=>checks.returns(actual));

test('each editor route mounts its module return',()=>checks.bindings(actual));

test('A4 owns the founder Raise landing while workspace mode retains its detailed editor', () => {
  // The landing MOVED, from /raise/pitch to /raise, and the reason is worth
  // recording because the old assertion read like a behaviour change and was
  // not one.
  //
  // `724dfc9f` rebuilt the Raise sections as six dedicated pages — Status,
  // Pitch, Capital, Legal, Data room, Liquidity — each rendering the zone's
  // section switcher, and pointed the sidebar row at /raise/pitch. That is a
  // section page, at the level below the desk, and it took the slot the A4
  // desk was mounted in. The desk was left importable and unimported: the
  // only one of the five founder desks without a mount.
  //
  // Rather than evict a section page Replit shipped, or leave a built zone
  // overview dead on disk, the desk now sits at the zone root, /raise —
  // which until this change spent itself redirecting into
  // /raise/capital/pipeline, a sub-sub-route of a sibling section.
  //
  // What A4 actually requires is unchanged and is what is asserted: a founder
  // arriving at the Raise zone gets the desk, not the generic workspace; and
  // ?mode=workspace still reaches the detailed pitch editor inside the Raise
  // tab bar. Both halves are pinned, and so is the section page, so this can
  // no longer be satisfied by deleting one side of it.
  const zone = routeBlock(app, '/raise');
  assert.ok(zone?.includes('founderRaiseLanding'), 'the Raise zone root must defer ownership to A4');
  assert.match(app, /founderRaiseLanding = effectiveRole === 'founder'[\s\S]*?get\('mode'\) !== 'workspace'/);
  // D661 (#1474): the landing a founder gets is the Raise cycle overview now.
  assert.match(zone, /founderRaiseLanding\s*\?\s*guard\([^)]*\), <CycleRoute cycle="raise" \/>\)/);
  assert.match(app, /founderEditor\(<PitchWorkspacePage \/>\)/);
  // The desk is an overview OVER the sections, not instead of them.
  assert.match(routeBlock(app, '/raise/pitch'), /<FounderRaisePitch \/>/,
    'the Pitch section page must survive the desk being mounted');
});

test('A7 owns the founder Research landing, and /signals only redirects to it', () => {
  const line = app.split('\n').find((item) => item.includes('path="/signals"'));
  assert.match(app, /founderResearchLanding = effectiveRole === 'founder'/);
  // D422: the landing is `/research`'s; bare `/signals` redirects there. D670
  // retired the Signals feed, so the redirect is everyone's and no route
  // mounts a Research tab bar any more.
  assert.match(line, /<Navigate to=\{`\/research\$\{location\.search\}`\} replace \/>/);
  assert.match(app, /founderResearchLanding\s*\?\s*guard\([^)]*\), <FounderResearchDesk \/>\)/);
  assert.doesNotMatch(app, /<SignalsPage\b|FounderWorkspaceTabs set="research"/);
});

test('a founder never gets two tab bars on one page', () => {
  // /comarketing already carried the Partner Offers bar. The fix is a branch,
  // not a second bar stacked on the first.
  const comarketing = app.split('\n').find((l) => l.includes('path="/comarketing"'));
  assert.match(comarketing, /effectiveRole === 'founder'\s*\?\s*founderWorkspace\('grow', founderEditor\(/,
    '/comarketing must serve founders the Grow bar INSTEAD of the Partner bar');
  assert.ok(comarketing.includes('<PartnerWorkspaceTabs set="offers"'),
    '/comarketing must still serve everyone else the Partner bar');

  // /perks is that same Grow row's full-bleed canvas. It does not take the
  // Offers bar, and it does not take the Grow frame either: the page is the
  // surface. A partner never reaches it.
  const perks = app.split('\n').find((l) => l.includes('path="/perks"'));
  assert.match(perks, /<PerksPage user=\{user\} \/>/);
  assert.ok(!perks.includes('PartnerWorkspaceTabs') && !perks.includes('FounderWorkspaceTabs'),
    '/perks must not stack a second tab bar on the canvas');
});

test('the module doors keep their role gates (Liquidity, the one tier-gated door, was removed)',()=>checks.gates(actual));

test('every module tool door carries its route\'s access rule',()=>checks.guards(actual));

test('Home is /studio, no role root invented', () => {
  assert.equal(rows[0].to, '/studio');
  // 'Studio' is the row's label; 'Home' is the group header. See the note on
  // CANON above — the destination is what this test is really pinning.
  assert.equal(rows[0].label, 'Studio');
  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/founder'), 'no bare /founder root');
});

test('Spin-Out Lab keeps its row; its match adds only the 83(b) tracker (D563)', () => {
  assert.match(founder, /\{ to: '\/spinout-lab', icon: Rocket, label: 'Spin-Out Lab', match: SPINOUT_LAB_PAGES \}/);
  assert.match(src, /const SPINOUT_LAB_PAGES = \['\/spinout-lab\/83b'\];/);
});

test('the Research row lands somewhere every founder can actually open', () => {
  // /market-intel's guard is labRoles(['admin','partner','investor']) — it does
  // not list founder at all, so a founder outside the Lab is bounced. That
  // predates this shell; the row must not walk into it.
  // The row now lands on /research/ask, the shared Research bucket's first
  // zone. What matters is not WHICH route it is but that a founder can open
  // it — the literal is what the shell migration changes, the guard below is
  // the thing that must never change.
  // Read the route BLOCK, not the line the route starts on: /research now
  // branches across three lines (founder → the A7 desk, everyone else → the
  // first zone), exactly as /raise already did, so the guard is not on the
  // line carrying `path=`.
  const research = rows.find((r) => r.label === 'Research');
  const target = routeBlock(app, research.to);
  assert.ok(target, `the Research row points at ${research.to}, which has no route`);
  assert.match(target.slice(target.indexOf('guard(')), /\[[^\]]*'founder'[^\]]*\]/,
    `${research.to} must admit 'founder' outright, not only Lab-active ones`);
  // /market-intel and its Lab-only Market tab were the other half of this
  // test; D670 retired the page, and the route only redirects to /research.
  assert.doesNotMatch(toolNavigation, /path: '\/market-intel'/, 'the retired Market tab is back');
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
 * The six workspaces: the root owns the overview, the pills navigate, and the
 * rail is the same one everywhere.
 *
 * These four tests exist because of the specific way this broke. Every
 * overview was BUILT and contract-tested, and then displaced: a rebuild took a
 * desk's slot, the desk was re-mounted on whatever path was free, and the
 * sidebar row was never pointed back. Nothing failed, because nothing asserted
 * that a row's target and its workspace's overview were the same page.
 * ──────────────────────────────────────────────────────────────────────────── */

// label → [root, the component the root must render for a founder]
// The file that component lives in. A cycle overview (D661) is one route
// component for every cycle, so it lives in pages/cycles, not pages/founder.
const deskFile = (desk) => (desk.startsWith('CycleRoute')
  ? 'frontend/src/pages/cycles/CycleRoute.jsx'
  : `frontend/src/pages/founder/${desk}.jsx`);
const WORKSPACES = {
  // D661 (#1474): Validate's root is the cycle overview, wired to #1487's read.
  Validate: ['/validate', 'CycleRoute cycle="validate"'],
  // D661 (#1474): Build's root is the cycle overview, wired to #1475's read.
  Build: ['/build', 'CycleRoute cycle="build"'],
  // D661 (#1474): Raise's root is the cycle overview, wired to #1501's read.
  Raise: ['/raise', 'CycleRoute cycle="raise"'],
  // D661 (#1474): Grow's root is the cycle overview, wired to #1488's read.
  Grow: ['/grow', 'CycleRoute cycle="grow"'],
  Network: ['/network', 'FounderNetworkDesk'],
  Research: ['/research', 'FounderResearchDesk'],
};

test('every founder row lands on its own workspace overview', () => {
  for (const [label, [root, desk]] of Object.entries(WORKSPACES)) {
    const row = rows.find((r) => r.label === label);
    assert.ok(row, `the ${label} row is gone from the founder sidebar`);
    assert.equal(row.to, root,
      `the ${label} row points at ${row.to}, one level below its overview — `
      + `that is exactly how the overviews were lost the first time`);
    const block = routeBlock(app, root);
    assert.ok(block, `${root} has no route`);
    assert.ok(block.includes(`<${desk} />`),
      `${root} must render ${desk} for a founder, not redirect past it`);
  }
});

test('a founder desk pill opens its route — navigating on a desktop, switching the lens on a phone', () => {
  // The user's words: "The buttons are the ones that should show the pages."
  // Three desks shipped their pill row as `href="#validate-0"`, `#a7-ask`,
  // `#build-1` — in-page anchors, two of which named sections that did not
  // exist on the page at all. A pill that scrolls is not navigation, and the
  // section pages it names were then reachable only from the sidebar.
  //
  // THE RULE SINCE D575 (#1188, mobile canvas M2). Every pill still names a
  // real route. On a desktop it navigates there; on a phone it opens that
  // route's page in place as a lens, with no route change and no history
  // entry. Both come from the shared `LensNavLink`, so a pill built as a bare
  // NavLink would navigate on a phone too.
  // The Validate, Build, Raise and Grow desks are retired (D661, #1474). The
  // cycle pages that replaced them draw their module tabs only from the
  // lg breakpoint up (`cycle-tabs`), so no phone taps one.
  const DESKS = ['FounderNetworkDesk', 'FounderResearchDesk'];
  const routes = new Set(
    [...app.matchAll(/path="([^":]+)"/g)].map((m) => m[1]).filter((p) => p.startsWith('/')),
  );
  for (const name of DESKS) {
    const src = codeOnly(read(`frontend/src/pages/founder/${name}.jsx`));
    const nav = /<nav[^>]*>[\s\S]*?<\/nav>/.exec(src);
    assert.ok(nav, `${name} has no section row`);
    assert.doesNotMatch(nav[0], /href=\{?[`'"]#/,
      `${name} still has an in-page anchor in its section row`);
    assert.match(nav[0], /<LensNavLink\b/, `${name}'s section row is not the lens switcher`);
    assert.doesNotMatch(nav[0], /<(?:Nav)?Link\b/,
      `${name}'s section row has a pill that navigates on a phone instead of switching the lens`);
    // Every `to=` in that row must be a route the router actually opens. The
    // literal targets are checked; template-built ones carry their base path.
    for (const m of nav[0].matchAll(/to=\{?[`'"]([^`'"?$]+)/g)) {
      const target = m[1].replace(/\/$/, '');
      assert.ok(routes.has(target),
        `${name}'s section row links ${target}, which has no route`);
    }
  }
});

test('every founder zone page\'s section row switches lenses on a phone (D575)', () => {
  // The zone pages hand-build the same row the desks do, so a lens opened on a
  // phone would otherwise navigate (and push a history entry) the moment its
  // own row was tapped. Every row here uses the shared lens links.
  const rows = [];
  for (const f of readdirSync(resolve(process.cwd(), 'frontend/src/pages/founder'))) {
    if (!f.endsWith('.jsx')) continue;
    const src = codeOnly(read(`frontend/src/pages/founder/${f}`));
    for (const m of src.matchAll(/<nav[^>]*aria-label="[^"]*sections"[^>]*>[\s\S]*?<\/nav>/gi)) {
      if (!/<(?:Lens)?(?:Nav)?Link\b/.test(m[0])) continue;
      rows.push(f);
      assert.doesNotMatch(m[0], /<(?:Nav)?Link\b/, `${f}'s section row has a pill that navigates on a phone`);
    }
  }
  // Twenty-seven until D661 (#1474) retired four desks, each with one row;
  // twenty-two until the owner removed Raise · Liquidity (2026-10-20);
  // twenty-one until #2343 folded Grow · Brand into the brand builder.
  assert.ok(rows.length >= 20, `only ${rows.length} founder section rows are lens switchers`);
});

test('the Worker AI rail is one component, and every founder workspace has it', () => {
  // It used to be twenty-seven: a local WorkerRail / BuildRail / RaiseRail /
  // ValidateRail / CadenceRail declared at the bottom of each page file under
  // seventeen distinct names, agreeing on their shape by coincidence. The
  // pages that never grew one had no rail, and the workspace shells mounted
  // AssistLayout with a surface eadwynConfig does not define, which renders
  // nothing at all — "it looks blank, probably not connected to anything".
  for (const [label, [, desk]] of Object.entries(WORKSPACES)) {
    const src = codeOnly(read(deskFile(desk)));
    if (desk.startsWith('CycleRoute')) {
      // One route component for every cycle: the rail names the cycle it is
      // mounted for, and the cycle's name is the workspace (D661).
      const cycle = desk.match(/cycle="([a-z]+)"/)[1];
      assert.match(src, /<WorkerRail[\s\S]*?workspace=\{name\}/, `${desk} must mount the shared rail`);
      assert.match(read('frontend/src/pages/cycles/cycleModel.js'), new RegExp(`${cycle}: \\{ key: '${cycle}', name: '${label}'`),
        `${desk}'s rail would not be named ${label}`);
      continue;
    }
    assert.match(src, new RegExp(`<WorkerRail[\\s\\S]*?workspace="${label}"`),
      `${desk} must mount the shared rail`);
  }
  // And nothing declares its own again.
  const own = [];
  for (const f of readdirSync(resolve(process.cwd(), 'frontend/src/pages/founder'))) {
    if (!f.endsWith('.jsx')) continue;
    const src = codeOnly(read(`frontend/src/pages/founder/${f}`));
    if (/<aside[^>]*className="[^"]*rail/.test(src)) own.push(f);
  }
  assert.deepEqual(own, [], 'these pages hand-build a rail again instead of using the shared one');

  // What the shared rail says: the AIRail canvas's blocks and nothing else
  // (owner, 2026-10-10; D698) — the switch and its Manual line, "Suggested
  // for this page", the safety line and the Usage box. Coverage and the
  // guardrail footer are gone.
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  for (const block of ['MANUAL_LINE', '>Suggested for this page<', '>Usage<', 'SAFETY_LINE']) {
    assert.ok(rail.includes(block), `the rail lost its ${block} block`);
  }
  for (const gone of ['>Coverage<', '>Usage this month<', 'EADWYN_GUARDRAIL', '>Unavailable here<']) {
    assert.ok(!rail.includes(gone), `the rail draws ${gone} again, which the AIRail canvas does not`);
  }
  assert.match(rail, /useAiSpend/, 'the usage card must read the live spend endpoint');
  // THE MODEL CARDS NAME ONLY WHAT RUNS. Since D769 PR 2 (#2088) they are the
  // page's row in the Worker's matrix (`GET /api/ai/rail`, D764), the same row
  // a rail run resolves its models from, shaped by `railView`; never typed.
  assert.match(rail, /railPrefsApi\.page\(page, option\)/, 'the models come from the Worker\'s matrix');
  assert.match(rail, /const rail = railView\(\{/, 'the cards are built from the Worker\'s answer');
  assert.doesNotMatch(rail, /\$0\.293|\$2\.253|Llama 3\.3 70B Fast/,
    'the canvas figures are not the router figures');
});

test('the founder full-bleed list covers every desk and section page', () => {
  // `fullWidthSurface` and `flushSurface` were two hand-typed arrays of the
  // same sixteen paths, matched exactly. `/grow/focus` was the one `/grow/*`
  // route missing from both, and that was the whole of "Grow doesn't fit full
  // width and height".
  //
  // THIS USED TO REGEX THE LITERALS OUT OF THE SOURCE, and could not survive
  // the list being derived — a derived list has no quoted strings to count, so
  // the old `listed.size >= 20` would have failed on a correct list. It reads
  // the exported value now, which is strictly stronger: the parse could only
  // see paths typed in the founder block, and `/network/*` reaches the list
  // through a shared const declared elsewhere in the file.
  const listed = new Set(FOUNDER_FULL_BLEED);
  assert.ok(listed.size >= 20, 'FOUNDER_FULL_BLEED is unexpectedly small');
  const required = [
    ...Object.values(WORKSPACES).map(([root]) => root),
    '/execution', '/build/team', // `/build/discovery` left with its editor (#2335)
    ...allZoneRoutes('founder'),
  ];
  assert.deepEqual(required.filter((p) => !listed.has(p)), [],
    'these founder surfaces sit in the shell’s centred column instead of owning the page');

  // DERIVED, NOT TYPED. Every zone route the shell config declares is covered
  // because the list is built from that config — so a new zone cannot be added
  // to a founder bucket and left out of the layout, which is the failure this
  // whole test exists for. Only the three legacy mounts are still hand-written,
  // and they are exactly the paths the shell config does not claim.
  const sidebar = codeOnly(read('frontend/src/sidebarConfig.js'));
  assert.match(sidebar, /export const FOUNDER_FULL_BLEED = \[\s*\.\.\.workspaceRoutes\('founder'\)/,
    'FOUNDER_FULL_BLEED must be derived from the shell config, not re-typed');
  // Scoped to the array's own block: these paths also appear as sidebar row
  // targets in the same file, which is where they belong.
  const block = /export const FOUNDER_FULL_BLEED = \[([\s\S]*?)\];/.exec(sidebar)?.[1] || '';
  assert.ok(block, 'FOUNDER_FULL_BLEED block not found');
  for (const zone of allZoneRoutes('founder')) {
    assert.ok(!block.includes(`'${zone}'`),
      `${zone} is typed into FOUNDER_FULL_BLEED as a literal — it should come from the shell config`);
  }

  // And every flag still reads one list rather than re-typing it.
  assert.match(app, /const fullBleedSurface = \(FULL_BLEED_BY_ROLE\[activeRole\] \|\| \[\]\)\.includes\(location\.pathname\)/,
    'the full-bleed test must read the per-role table, not name roles inline');
  assert.match(app, /founder: FOUNDER_FULL_BLEED/, 'the table must map founder to its own list');
  assert.match(app, /const fullWidthSurface = fullBleedSurface/,
    'fullWidthSurface must derive from the shared full-bleed test');
  assert.match(app, /const flushSurface = fullBleedSurface;/,
    'flushSurface must derive from the same one, not a second hand-typed list');
});
