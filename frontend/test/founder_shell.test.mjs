/**
 * The Founder shell — twenty-one items to ten rows, and the bar that had to
 * be built before the collapse was safe.
 *
 * Founder is the hardest of the four roles. Investor collapsed cleanly because
 * three workspaces already tabbed across their whole subtrees. Founder has no
 * such thing: `PitchWorkspacePage`, `CapitalWorkspacePage` and
 * `LegalEnginePage` each tab only within themselves and nothing links one to
 * another, while `ExecutionPage`, `TeamBuildingPage`, `DiscoveryPage` and
 * `FounderMarketplacePage` have no tab bar at all.
 *
 * So the audit came first. Searching every `to=`, `to:`, `navigate(` and
 * `link=` in frontend/src outside sidebarConfig.js, six destinations had
 * zero inbound links — their sidebar row was the only door:
 *
 *     /execution  /signals  /build/team
 *     /build/metrics  /network-effects  /raise/capital
 *
 * `FounderWorkspaceTabs` is what makes them survive the collapse. Every
 * assertion below reads that file, or App.jsx,
 * rather than trusting the sidebar's own comments — because `match` decides
 * which row highlights, and does not create a link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const founder = src.slice(src.indexOf('\n  founder: ['), src.indexOf('\n  partner: ['));

const rows = [...founder.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

const bar = codeOnly(read('frontend/src/pages/founder/FounderWorkspaceTabs.jsx'));
const app = codeOnly(read('frontend/src/App.jsx'));
const tabsTo = (p) => bar.includes(`to: '${p}'`);

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

test('every destination the old nav reached still has a door', () => {
  // The twenty-one items the pre-canvas founder nav carried, verbatim.
  const BEFORE = [
    '/studio', '/spinout-lab',
    '/execution', '/signals', '/build/team', '/build/metrics', '/spinout-lab/brand',
    '/build/discovery', '/build/marketplace', '/advisory',
    '/network', '/market-intel',
    '/raise/pitch', '/raise/capital', '/raise/legal-engine', '/raise/data-room',
    '/comarketing',
    '/network-effects', '/liquidity', '/perks',
  ];
  const doorless = BEFORE.filter((p) => !targets.includes(p) && !tabsTo(p));
  assert.deepEqual(doorless, [], 'no nav row and no workspace tab — reachable only by typed URL');
});

test('the seven doorless destinations are exactly the ones the bar rescues', () => {
  // If any of these loses its tab, it becomes unreachable outright — there is
  // no second door anywhere in frontend/src. This is the assertion that would
  // have caught the regression in #350.
  for (const p of ['/execution', '/signals', '/build/team', '/build/metrics',
    '/network-effects', '/raise/capital']) {
    assert.ok(tabsTo(p), `${p} has no inbound link anywhere else — the tab IS the door`);
  }
  assert.ok(!targets.includes('/messages'), 'Messages is intentionally outside the eight-row canvas shell');
});

test('each row that owns sections is actually wrapped at its routes', () => {
  // A tab set that no route renders is a list, not a bar.
  const SITES = {
    validate: ['/build/marketplace', '/advisory'],
    build: ['/execution', '/build/roadmap', '/build/metrics'],
    raise: ['/raise/capital', '/raise/legal-engine', '/raise/data-room', '/liquidity'],
    grow: ['/build/team', '/spinout-lab/brand', '/comarketing', '/perks', '/network-effects'],
    research: ['/market-intel'],
  };
  // A route's `element` used to always fit on the line carrying `path="..."`.
  // It stopped being safe to assume that the day an investor branch was added
  // ahead of the founder one (/network, /market-intel — both gained a
  // dedicated Investor*Workspace branch and Prettier wrapped the ternary
  // across lines). So this reads a bounded WINDOW of lines starting at the
  // route, not just the one line, and stops at the next <Route so it can't
  // walk into a neighbour's markup and false-positive.
  const appLines = app.split('\n');
  for (const [set, paths] of Object.entries(SITES)) {
    for (const p of paths) {
      const start = appLines.findIndex((l) => l.includes(`path="${p}"`));
      assert.ok(start !== -1, `no route for ${p}`);
      let end = start + 1;
      while (end < appLines.length && end < start + 8 && !appLines[end].includes('<Route ')) end++;
      const block = appLines.slice(start, end).join('\n');
      assert.ok(block.includes(`<FounderWorkspaceTabs set="${set}"`),
        `${p} is not wrapped in the ${set} bar — the row cannot own it`);
    }
  }
  const discovery = app.split('\n').find((line) => line.includes('path="/build/discovery"'));
  assert.ok(discovery?.includes("<FounderValidatePage />"),
    '/build/discovery must be owned by the dedicated A2 Validate page');
});

test('A4 owns the founder Raise landing while workspace mode retains its detailed editor', () => {
  const line = app.split('\n').find((item) => item.includes('path="/raise/pitch"'));
  assert.ok(line?.includes('founderRaiseLanding'), '/raise/pitch must defer ownership to A4');
  assert.match(app, /founderRaiseLanding = effectiveRole === 'founder'[\s\S]*?get\('mode'\) !== 'workspace'/);
  assert.match(app, /founderRaiseLanding\s*\?\s*<FounderRaiseDesk \/>/);
  assert.match(app, /FounderWorkspaceTabs set="raise" user=\{user\}><PitchWorkspacePage \/>/);
});

test('A7 owns the founder Research landing while workspace mode retains Signals', () => {
  const line = app.split('\n').find((item) => item.includes('path="/signals"'));
  assert.ok(line?.includes('founderResearchLanding'), '/signals must defer ownership to A7');
  assert.match(app, /founderResearchLanding = effectiveRole === 'founder'/);
  assert.match(app, /founderResearchLanding\s*\?\s*<FounderResearchDesk \/>/);
  assert.match(app, /FounderWorkspaceTabs set="research" user=\{user\}><SignalsPage user=\{user\} \/>/);
});

test('a founder never gets two tab bars on one page', () => {
  // /perks and /comarketing already carried the Partner Offers bar. The fix is
  // a branch, not a second bar stacked on the first.
  for (const p of ['/perks', '/comarketing']) {
    const line = app.split('\n').find((l) => l.includes(`path="${p}"`));
    assert.match(line, /effectiveRole === 'founder'\s*\?\s*founderWorkspace\('grow', <FounderWorkspaceTabs/,
      `${p} must serve founders the Grow bar INSTEAD of the Partner bar`);
    assert.ok(line.includes('<PartnerWorkspaceTabs set="offers"'),
      `${p} must still serve everyone else the Partner bar`);
  }
});

test("liquidity's tier gate moved onto the tab rather than being dropped", () => {
  // The /liquidity ROUTE has no tier gate — the sidebar row was the whole
  // gate. Folding the row into an ungated tab would have widened who sees it.
  assert.match(bar, /to: '\/liquidity'[^}]*requiredTier: 'studio'/s);
  assert.match(bar, /hasTier\(user, t\.requiredTier\)/, 'the filter must apply the gate');
  const line = app.split('\n').find((l) => l.includes('path="/liquidity"'));
  assert.ok(!/requiredTier/.test(line), 'if the route ever gains its own gate, revisit this');
});

test('every tab carries the guard its route carries', () => {
  // A tab that bounces the viewer off a route guard is worse than an absent
  // one. Each tab's `roles` must be a subset of its route's guard list.
  const sets = [...bar.matchAll(/\{ to: '([^']+)', label: '[^']+', icon: \w+,\s*roles: \[([^\]]*)\](, labOnlyFor: \[([^\]]*)\])?/g)];
  assert.ok(sets.length >= 15, `only found ${sets.length} tabs — the regex went stale`);
  for (const [, to, rolesRaw, , labRaw] of sets) {
    const line = app.split('\n').find((l) => l.includes(`path="${to}"`));
    assert.ok(line, `no route for tab ${to}`);
    const guardList = line.slice(line.indexOf('guard(')).match(/\[([^\]]*)\]/);
    assert.ok(guardList, `could not read the guard for ${to}`);
    const allowed = new Set(guardList[1].split(',').map((x) => x.trim().replace(/'/g, '')));
    // `labRoles(...)` widens the guard at runtime to admit the viewer's own
    // role while spinout_lab_active === 1. A tab may rely on that ONLY by
    // declaring labOnlyFor, which makes it disappear when the widening does
    // not apply — otherwise it would offer a route that bounces the viewer.
    const labWidened = new Set((labRaw || '').split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean));
    if (labWidened.size) {
      assert.ok(line.includes('labRoles('),
        `tab ${to} declares labOnlyFor but its route is not wrapped in labRoles()`);
    }
    for (const r of rolesRaw.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)) {
      assert.ok(allowed.has(r) || labWidened.has(r),
        `tab ${to} offers '${r}' but its route guard is ${[...allowed].join(', ')}`);
    }
  }
});

test('Home is /studio, no role root invented', () => {
  assert.equal(rows[0].to, '/studio');
  // 'Studio' is the row's label; 'Home' is the group header. See the note on
  // CANON above — the destination is what this test is really pinning.
  assert.equal(rows[0].label, 'Studio');
  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/founder'), 'no bare /founder root');
});

test('Spin-Out Lab keeps its row, untouched', () => {
  assert.match(founder, /\{ to: '\/spinout-lab', icon: Rocket, label: 'Spin-Out Lab' \}/);
});

test('the Research row lands somewhere every founder can actually open', () => {
  // /market-intel's guard is labRoles(['admin','partner','investor']) — it does
  // not list founder at all, so a founder outside the Lab is bounced. That
  // predates this shell; the row must not walk into it.
  // The row now lands on /research/ask, the shared Research bucket's first
  // zone. What matters is not WHICH route it is but that a founder can open
  // it — the literal is what the shell migration changes, the guard below is
  // the thing that must never change.
  const research = rows.find((r) => r.label === 'Research');
  const target = app.split('\n').find((l) => l.includes(`path="${research.to}"`));
  assert.ok(target, `the Research row points at ${research.to}, which has no route`);
  assert.match(target.slice(target.indexOf('guard(')), /\[[^\]]*'founder'[^\]]*\]/,
    `${research.to} must admit 'founder' outright, not only Lab-active ones`);
  const mi = app.split('\n').find((l) => l.includes('path="/market-intel"'));
  assert.ok(!/\[[^\]]*'founder'[^\]]*\]/.test(mi.slice(mi.indexOf('guard('))),
    'if /market-intel ever admits founders outright, point Research back at it');
  assert.match(bar, /to: '\/market-intel'[^}]*labOnlyFor: \['founder'\]/s,
    'the Market tab must hide itself for a founder outside the Lab');
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
