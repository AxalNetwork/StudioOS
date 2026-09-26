/**
 * D286 — the Admin shell on accounts HQ holds directly (canvas S20), its wall
 * rules, and every leftover console placed (S22). Tasks 415, 416, 418, 419;
 * closes task 410.
 *
 * WHAT IS PINNED, AND WHY BY VALUE. The eight rows are S20's, in S20's order,
 * and every row points at an /admin console or /studio — never /branch/*,
 * which refuses on HQ. Five rows are landings under /admin/held/ (a prefix
 * that cannot collide with an HQ console; /admin/accounts is HQ's Team), each
 * `guard(['admin'])` and never `hqOnly`, each carrying its consoles as
 * LITERAL links, because `admin_route_reachability.test.mjs` reads
 * navigation syntax and ten routes have these landings as their only door on
 * this shell. The Approvals landing is S22's sixteen lanes verbatim, read
 * back out of its JSX and compared by `deepEqual` to the table below, so a
 * lane cannot gain a console it does not have (Spinout moderation) or lose
 * the one it does.
 *
 * THE FALSE LABELS ARE NOT RENDERED. S22 says "Template library · read-only"
 * and "results only; authoring is HQ's"; `requireHqAuthoring` refuses only on
 * a branch. The shell says what the code does, and this file refuses the
 * three phrases in every source it draws from. No gate is raised here: the
 * four consoles H35 places on HQ rows that are plain `guard(['admin'])`
 * (/monitoring, /admin/articles, /admin/publications, /admin/team) keep that
 * gate, and their door is the HQ strip (D285).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { HQ_STRIPS, ADMIN_ROW_ROUTE, NO_ROW, adminRowFor } from '../src/lib/hqStrips.js';
import { shellRoleFor } from '../src/lib/shellRole.js';
import { ACCENT } from '../src/workspaces/shellConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const SIDEBAR_NAV = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));
const ADMIN_PAGE = read('frontend/src/pages/AdminPage.jsx');
const SIDEBAR_SRC = read('frontend/src/sidebarConfig.js');

const LANDINGS = {
  Accounts: 'frontend/src/pages/admin/HeldAccounts.jsx',
  Approvals: 'frontend/src/pages/admin/HeldApprovals.jsx',
  Programs: 'frontend/src/pages/admin/HeldPrograms.jsx',
  Community: 'frontend/src/pages/admin/HeldCommunity.jsx',
  Insights: 'frontend/src/pages/admin/HeldInsights.jsx',
};
const ZONE = 'frontend/src/pages/admin/HeldZone.jsx';
const HELD_FILES = [...Object.values(LANDINGS), ZONE];
const SRC = Object.fromEntries(HELD_FILES.map((f) => [f, read(f)]));
const CODE = Object.fromEntries(HELD_FILES.map((f) => [f, codeOnly(SRC[f])]));

const rows = SIDEBAR_GROUPS.admin.flatMap((g) => g.items || []);
const pathOf = (to) => to.split('?')[0];
const routeLine = (path) => APP.split('\n').find((l) => l.includes(`path="${path}"`));
/** Literal `to="/…"` doors in one file's code, comments stripped. */
const doorsIn = (code) => [...code.matchAll(/\bto="(\/[^"]*)"/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ *
 * S20 — the eight rows
 * ------------------------------------------------------------------ */

test('the eight rows are S20\'s, in S20\'s order, one group, each an /admin console or /studio and never /branch/*', () => {
  assert.equal(SIDEBAR_GROUPS.admin.length, 1, 'S20 draws one group of eight rows');
  assert.deepEqual(rows.map((r) => r.label),
    ['Studio', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Settings']);
  assert.deepEqual(rows.map((r) => r.to), [
    '/studio',
    '/admin/held/accounts',
    '/admin/held/approvals',
    '/admin/held/programs',
    '/admin/held/community',
    '/admin?tab=legal',
    '/admin/held/insights',
    '/admin/my-licence',
  ]);
  for (const r of rows) {
    assert.ok(!r.to.startsWith('/branch'), `${r.label} points under /branch/, which refuses on HQ`);
    assert.ok(routeLine(pathOf(r.to)), `${r.label} → ${r.to} is not a registered route`);
    for (const m of r.match || []) {
      assert.ok(routeLine(m), `${r.label} matches ${m}, which is not a registered route`);
      assert.ok(!m.startsWith('/branch'), `${r.label} matches a /branch/ path`);
    }
  }
  // The parked X row stays exactly as the reachability guard reads it.
  assert.match(SIDEBAR_SRC, /^\s*\/\/ \{ to: '\/admin\/x', icon: Megaphone, label: 'X \(Twitter\)' \},$/m);
});

test('the five landings are guard([\'admin\']) without hqOnly, under a prefix no HQ console can collide with', () => {
  for (const [label, file] of Object.entries(LANDINGS)) {
    const row = rows.find((r) => r.label === label);
    assert.ok(row, `${label} has no row`);
    assert.ok(row.to.startsWith('/admin/held/'), `${label}'s landing is not under /admin/held/`);
    const line = routeLine(row.to);
    assert.ok(line, `${row.to} is not registered`);
    assert.match(line, /guard\(\['admin'\]/, `${row.to} is not guard(['admin'])`);
    assert.doesNotMatch(line, /hqOnly\(/, `${row.to} is wrapped in hqOnly — this is the plain admin's own shell`);
    assert.match(APP, new RegExp(`lazy\\(\\(\\) => import\\('\\./pages/admin/${file.split('/').pop().replace('.jsx', '')}'\\)\\)`),
      `${file} is not lazy-imported by App.jsx`);
    assert.match(SRC[file], /<HeldZone\b/, `${file} does not render inside HeldZone`);
  }
  // The collision the prefix avoids: HQ's Team is /admin/accounts and hqOnly.
  assert.match(routeLine('/admin/accounts'), /hqOnly\(/);
  // The four landings with consoles keep their row lit inside them.
  for (const label of ['Accounts', 'Approvals', 'Programs', 'Community']) {
    assert.ok(Array.isArray(rows.find((r) => r.label === label).match), `${label} has no match list`);
  }
});

test('every console link on a landing is literal, registered, and never under /branch/', () => {
  const expectedDoors = { Accounts: 4, Approvals: 14, Programs: 4, Community: 5, Insights: 0 };
  for (const [label, file] of Object.entries(LANDINGS)) {
    const doors = doorsIn(CODE[file]);
    assert.equal(doors.length, expectedDoors[label], `${label} draws ${doors.length} literal links, expected ${expectedDoors[label]}`);
    for (const d of doors) {
      assert.ok(!d.startsWith('/branch'), `${label} links ${d}, under /branch/`);
      assert.ok(routeLine(pathOf(d)), `${label} links ${d}, which is not a registered route`);
    }
    assert.doesNotMatch(CODE[file], /\.map\([^)]*<Link/, `${label} maps data into links — invisible to the reachability walk`);
  }
  // The frame's sentence NAMES /branch/ to say it is never linked; a link is the syntax.
  assert.doesNotMatch(CODE[ZONE], /\b(?:to|href)=["'`{]\/branch/, 'HeldZone links a /branch/ path');
});

/* ------------------------------------------------------------------ *
 * S22 — the sixteen lanes
 * ------------------------------------------------------------------ */

const S22_LANES = [
  [1, 'Core', 'LP applications', '/admin/lp-applications', 'Links to its console'],
  [2, 'Core', 'Referrals', '/admin/refer-earn', 'Links to its console'],
  [3, 'Core', 'Cohort applications', '/admin/spinout-lab', 'Links to its console'],
  [4, 'Core', 'Spinout moderation', null, 'No console exists anywhere yet'],
  [5, 'Core', 'Content to HQ', null, 'Not applicable to HQ-held accounts'],
  [6, 'Absorbed', 'KYC', '/admin?tab=kyc', 'Links to its console'],
  [7, 'Absorbed', 'Partner profiles', '/admin?tab=profiles', 'Links to its console'],
  [8, 'Absorbed', 'Directory', '/admin?tab=directory', 'Links to its console'],
  [9, 'Absorbed', 'Exploring', '/admin/exploring', 'Links to its console'],
  [10, 'Absorbed', 'Jobs', '/admin/jobs', 'Links to its console'],
  [11, 'Absorbed', 'Events', '/admin/events', 'Links to its console'],
  [12, 'Absorbed', 'Circles', '/admin/circles', 'Links to its console'],
  [13, 'Absorbed', 'Partner invitations', '/admin/partners', 'Links to its console'],
  [14, 'Absorbed', 'Best-Fit', '/admin/best-fit', 'Links to its console'],
  [15, 'Absorbed', 'Due diligence', '/admin/due-diligence', 'Links to its console'],
  [16, 'Absorbed', 'Advisor cohort access', '/admin/advisor-cohorts', 'Links to its console'],
];

/** The lanes as the JSX draws them: one `<tr data-lane>` each, cells in S22's order. */
function drawnLanes() {
  const out = [];
  for (const m of CODE[LANDINGS.Approvals].matchAll(/<tr data-lane="(\d+)">([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    assert.equal(cells.length, 5, `lane ${m[1]} draws ${cells.length} cells`);
    const link = /<Link to="([^"]+)"/.exec(cells[3]);
    out.push([Number(m[1]), cells[1].trim(), cells[2].trim(), link ? link[1] : null, cells[4].trim()]);
    if (link) assert.equal(link[1], cells[3].replace(/<[^>]+>/g, '').trim(), `lane ${m[1]} shows a route it does not link`);
  }
  return out;
}

test('Approvals draws S22\'s sixteen lanes verbatim and in order; moderation and Content-to-HQ link nowhere', () => {
  assert.deepEqual(drawnLanes(), S22_LANES);
  const moderation = drawnLanes().find((l) => l[2] === 'Spinout moderation');
  assert.equal(moderation[3], null, 'Spinout moderation was given a console — no page in the SPA calls adminSpinoutModeration');
  // Held to the map: every route S22 links is a console the H35 map places on Admin · Approvals, or a tab S22 absorbs.
  const laned = new Set(ADMIN_PLACEMENT
    .filter((e) => [e, ...(e.also || [])].some((p) => p.tier === 'Admin' && p.row === 'Approvals'))
    .map((e) => e.route));
  for (const [, , lane, route] of S22_LANES) {
    if (!route || route === '/admin/spinout-lab') continue; // the Lab console is reached through its tab's placement
    assert.ok(laned.has(route), `${lane} links ${route}, which the H35 map does not place on Admin · Approvals`);
  }
});

/* ------------------------------------------------------------------ *
 * The other landings
 * ------------------------------------------------------------------ */

test('Community links its five consoles at their own routes — Advisors & Partners at the tab, never the standalone route', () => {
  const doors = doorsIn(CODE[LANDINGS.Community]);
  assert.deepEqual(doors, ['/admin/events', '/admin/jobs', '/admin/circles', '/admin?tab=network-profiles', '/admin?tab=wellbeing']);
  assert.ok(!doors.includes('/admin/network-profiles'), 'a door onto the standalone roster route would make its EXEMPT entry stale');
  assert.match(SRC[LANDINGS.Community], /import \{ COMMUNITY_CONSOLES \} from '\.\.\/branch\/BranchCommunity'/,
    'the console prose is BranchCommunity\'s own list, read rather than copied');
});

test('Programs links its four consoles; Accounts links the Users table, Exploring, Personas and Trash', () => {
  assert.deepEqual(doorsIn(CODE[LANDINGS.Programs]),
    ['/admin?tab=lab-applications', '/admin/spinout-lab', '/admin/advisor-cohorts', '/admin/assessment']);
  assert.deepEqual(doorsIn(CODE[LANDINGS.Accounts]),
    ['/admin', '/admin/exploring', '/admin?tab=personas', '/admin/trash']);
});

test('Insights carries S20\'s sentence verbatim and links nowhere', () => {
  assert.ok(SRC[LANDINGS.Insights].includes('No console fits yet for HQ-held accounts. This row will hold the territory '));
  assert.ok(SRC[LANDINGS.Insights].includes('benchmark and activity funnel once there is a store for these accounts. It does not borrow an HQ-only page.'));
  assert.doesNotMatch(CODE[LANDINGS.Insights], /<Link\b|\bto="\//, 'Insights borrowed a page');
  assert.doesNotMatch(CODE[LANDINGS.Insights], /admin\/analytics|branch\/insights/, 'Insights borrowed an HQ-only or branch page');
});

test('the three false labels are not rendered, and no gate was narrowed or raised', () => {
  const sources = { ...CODE, 'frontend/src/sidebarConfig.js': codeOnly(SIDEBAR_SRC) };
  for (const [file, code] of Object.entries(sources)) {
    for (const phrase of [/results only/i, /authoring is HQ/i, /Template library[^'"<]*read-only/i]) {
      assert.doesNotMatch(code, phrase, `${file} renders "${phrase.source}", which requireHqAuthoring makes false on HQ`);
    }
  }
  // "read-only" on a LANDING or a ROW is the Contracts label coming back; the
  // frame's rail stance ("Read-only summary") is a different sentence about a
  // different thing, so the frame is not scanned for the bare word.
  for (const file of Object.values(LANDINGS)) {
    assert.doesNotMatch(CODE[file], /read-only/i, `${file} says read-only`);
  }
  for (const r of rows) assert.doesNotMatch(r.label, /read-only/i, `${r.label} says read-only`);
  assert.equal(rows.find((r) => r.label === 'Contracts').to, '/admin?tab=legal');
  // The gates this item touches nothing of.
  for (const path of ['/admin/assessment', '/admin', '/monitoring', '/admin/articles', '/admin/publications', '/admin/team']) {
    const line = routeLine(path);
    assert.match(line, /guard\(\['admin'/, `${path} no longer admits an admin`);
    assert.doesNotMatch(line, /hqOnly\(/, `${path}'s gate was raised — D286 files that question, it does not decide it`);
  }
  // …and the four HQ-placed plain-admin consoles keep a door: the HQ strip (D285).
  const stripRoutes = new Set(Object.values(HQ_STRIPS).flat().map((i) => i.route));
  for (const path of ['/monitoring', '/admin/articles', '/admin/publications', '/admin/team']) {
    assert.ok(stripRoutes.has(path), `${path} is on no HQ strip and no Admin row — it lost its door`);
  }
});

/* ------------------------------------------------------------------ *
 * Reachability — the ten orphans
 * ------------------------------------------------------------------ */

test('the ten routes that lost their sidebar row have a literal door on this shell', () => {
  const orphans = ['/admin/refer-earn', '/admin/partners', '/admin/lp-applications', '/admin/my-licence', '/admin/best-fit',
    '/admin/events', '/admin/jobs', '/admin/circles', '/admin/due-diligence', '/admin/advisor-cohorts'];
  const doors = new Set([
    ...rows.map((r) => pathOf(r.to)),
    ...Object.values(LANDINGS).flatMap((f) => doorsIn(CODE[f]).map(pathOf)),
  ]);
  const missing = orphans.filter((p) => !doors.has(p));
  assert.deepEqual(missing, [], 'these routes have no door on the Admin shell');
});

/* ------------------------------------------------------------------ *
 * The active row, the chrome, the accent, the wall rules
 * ------------------------------------------------------------------ */

test('an /admin tab lights the Admin row the H35 map places it on, and a tab placed only on HQ lights no row', () => {
  assert.equal(adminRowFor('/admin', '?tab=kyc'), ADMIN_ROW_ROUTE.Approvals);
  assert.equal(adminRowFor('/admin', '?tab=profiles'), ADMIN_ROW_ROUTE.Approvals);
  assert.equal(adminRowFor('/admin', '?tab=legal'), ADMIN_ROW_ROUTE.Contracts);
  assert.equal(adminRowFor('/admin', '?tab=users'), ADMIN_ROW_ROUTE.Accounts);
  assert.equal(adminRowFor('/admin', ''), ADMIN_ROW_ROUTE.Accounts, 'a bare /admin is the Users tab');
  assert.equal(adminRowFor('/admin', '?tab=personas'), ADMIN_ROW_ROUTE.Accounts);
  assert.equal(adminRowFor('/admin', '?tab=lab-applications'), ADMIN_ROW_ROUTE.Programs);
  assert.equal(adminRowFor('/admin', '?tab=wellbeing'), ADMIN_ROW_ROUTE.Community);
  assert.equal(adminRowFor('/admin', '?tab=network-profiles'), ADMIN_ROW_ROUTE.Community);
  for (const tab of ['integration-keys', 'github', 'payments', 'promos', 'billing']) {
    assert.equal(adminRowFor('/admin', `?tab=${tab}`), NO_ROW, `${tab} is HQ's and lit an Admin row`);
  }
  assert.equal(adminRowFor('/admin', '?tab=no-such-tab'), NO_ROW);
  assert.equal(adminRowFor('/admin/held/programs', ''), null, 'off /admin the path decides');
  assert.equal(adminRowFor('/admin/events', ''), null);
  assert.ok(!rows.some((r) => r.to === NO_ROW), 'NO_ROW must equal no row\'s route');
  assert.match(SIDEBAR_NAV, /role === 'admin' \? adminRowFor\(navLocation\.pathname, navLocation\.search\)/,
    'SidebarNav does not derive the Admin row from the map');
  assert.match(SIDEBAR_NAV, /const active = derivedRow !== null\s*\? to === derivedRow/, 'the derived row does not decide the active row');
});

test('the top bar says whose data: "HQ-held · axal.vc" and the HQ-HELD badge, on the plain Admin shell off a branch only', () => {
  const open = APP.indexOf('<Routes>');
  const chrome = codeOnly(APP.slice(0, open));
  const m = /\{!branchFact && shellRole === 'admin' && activeRole === 'admin' && !isImpersonating && \(([\s\S]*?)\)\}/.exec(chrome);
  assert.ok(m, 'the HQ-held badge is not gated on the plain Admin shell off a branch');
  assert.match(m[1], /data-testid="hq-held-badge"/);
  assert.match(m[1], /HQ-held · axal\.vc/, 'the scope chip does not read "HQ-held · axal.vc" (S20 changelog)');
  assert.match(m[1], />HQ-HELD</, 'the badge does not read "HQ-HELD" (S20 artboard)');
  assert.match(m[1], /<Globe\b/, 'S20 draws a globe on the chip');
  // The territory badge still renders from /me.branch alone, ahead of it.
  assert.ok(chrome.indexOf('data-testid="territory-badge"') < chrome.indexOf('data-testid="hq-held-badge"'));
});

test('the accent is steel and the shell key is still admin', () => {
  assert.deepEqual(ACCENT.admin, ACCENT.branch_admin, 'S20 is the subsidiary shell pointed at HQ; the accent is the same steel');
  assert.equal(ACCENT.admin.ink, '#334155');
  assert.match(CODE[ZONE], /role="admin"/, 'HeldZone mounts the rail under another shell\'s accent');
  const plain = { role: 'admin', is_super_admin: 0 };
  assert.equal(shellRoleFor('admin', plain, true), 'admin', 'no new shell key: a plain admin still gets `admin`');
});

test('the wall rules: search says HQ-held accounts, the scope sentence is the frame\'s, licensing is only Settings', () => {
  assert.match(ADMIN_PAGE, /: 'Searching HQ-held accounts';/, 'the Users table\'s search does not say what it searches off a branch');
  assert.match(CODE[ZONE], /data-testid="held-scope"/, 'the scope sentence is not drawn');
  assert.match(SRC[ZONE], /No branch is deployed yet, so these accounts have no branch database/,
    'the frame does not say the rules hold only because no branch exists yet');
  assert.match(CODE[ZONE], /nothing here reads or links a page under \/branch\//);
  assert.match(SRC[ZONE], /there is no branch read behind it/, 'the rail does not say there is no branch read behind it');
  assert.equal((CODE[ZONE].match(/<WorkerRail\b/g) || []).length, 1, 'HeldZone is the shell\'s one rail mount');
  for (const file of Object.values(LANDINGS)) {
    assert.doesNotMatch(CODE[file], /<WorkerRail\b/, `${file} mounts a rail of its own`);
  }
  const licence = rows.filter((r) => /licen[cs]e/.test(r.to));
  assert.deepEqual(licence.map((r) => [r.label, r.to]), [['Settings', '/admin/my-licence']],
    'licensing appears somewhere other than the read-only summary in Settings');
});
