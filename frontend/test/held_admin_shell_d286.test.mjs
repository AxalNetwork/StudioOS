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
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AdminStudioOverview, studioCardTarget } from '../src/pages/admin/AdminStudioOverview.jsx';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { HQ_STRIPS } from '../src/lib/hqStrips.js';
import { shellRoleFor } from '../src/lib/shellRole.js';
import { ACCENT } from '../src/workspaces/shellConfig.js';
import { codeOnly } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const SIDEBAR_NAV = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));
const ADMIN_PAGE = adminConsoleSource();
const SIDEBAR_SRC = read('frontend/src/sidebarConfig.js');

// D953 (#2371): Programs left /admin/held/ when it was rebuilt to its canvas,
// so the two landings that keep HeldZone carry its pins.
const LANDINGS = {
  Accounts: 'frontend/src/pages/admin/HeldAccounts.jsx',
};
const PROGRAMS = 'frontend/src/pages/admin/programs/ProgramsCatalogue.jsx';
// D893 (#2366): Insights left /admin/held/ when it was rebuilt to its canvas.
const INSIGHTS = 'frontend/src/pages/admin/insights/AdminInsights.jsx';
// D930 (#2367): so did Community.
const COMMUNITY = 'frontend/src/pages/admin/community/AdminCommunity.jsx';
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
 * S20 — the eight rows, and D714's ninth
 * ------------------------------------------------------------------ */

test('the nine rows are S20\'s eight, in S20\'s order, with D714\'s Fund admin after Contracts, one group, each an /admin console or /studio and never /branch/*', () => {
  assert.equal(SIDEBAR_GROUPS.admin.length, 1, 'S20 draws one group');
  assert.deepEqual(rows.map((r) => r.label),
    ['Studio', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Fund admin', 'Insights', 'Licences']);
  assert.deepEqual(rows.map((r) => r.to), [
    '/studio',
    '/admin/held/accounts',
    '/admin/approvals',
    '/admin/programs',
    '/admin/community',
    '/admin/contracts',
    '/admin/fund-admin',
    '/admin/insights',
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

test('the two held landings, Programs, Community and Insights are guard([\'admin\']) without hqOnly, the held two under a prefix no HQ console can collide with', () => {
  for (const [path, page, old, redirect] of [
    ['/admin/insights', 'AdminInsights', '/admin/held/insights', 'HeldInsightsRedirect'],
    ['/admin/community', 'AdminCommunity', '/admin/held/community', 'HeldCommunityRedirect'],
    ['/admin/approvals', 'AdminApprovals', '/admin/held/approvals', 'HeldApprovalsRedirect'],
    ['/admin/programs', 'AdminProgramsCatalogue', '/admin/held/programs', 'HeldProgramsRedirect'],
  ]) {
    const line = routeLine(path);
    assert.ok(line, `${path} is not registered`);
    assert.match(line, new RegExp(`guard\\(\\['admin'\\], <${page} \\/>\\)`), `${path} is not guard(['admin'])`);
    assert.doesNotMatch(line, /hqOnly\(/, `${path} is wrapped in hqOnly — this is the plain admin's own shell`);
    assert.match(routeLine(old), new RegExp(`<${redirect} \\/>`), `the old address ${old} no longer redirects`);
  }
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
  // D506 — Approvals gained its fifteenth door, Spinout moderation (D442's console).
  // D953 — Programs is no longer a held landing; its catalogue's doors are pinned
  // in admin_programs_d953.test.mjs.
  const expectedDoors = { Accounts: 4, Approvals: 15 };

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

test('off a branch, Studio card Open links are the S20 rows and never /branch/*', () => {
  const html = renderToStaticMarkup(createElement(
    MemoryRouter, null,
    createElement(AdminStudioOverview, {
      user: { role: 'admin' }, glance: null, home: null, licence: null, templates: null, insights: null,
    }),
  ));
  const cards = [
    ['admin-studio-accounts', 'Accounts'],
    ['admin-studio-approvals', 'Approvals'],
    ['admin-studio-programs', 'Programs'],
    ['admin-studio-community', 'Community'],
    ['admin-studio-contracts', 'Contracts'],
    ['admin-studio-insights', 'Insights'],
    ['admin-studio-settings', 'Licences'],
  ];
  for (const [id, label] of cards) {
    const at = html.indexOf(`data-testid="${id}"`);
    assert.ok(at > 0, `${label} card is missing`);
    const href = html.slice(at, at + 600).match(/href="([^"]+)"/);
    assert.ok(href, `${label} has no Open link`);
    const to = href[1].replaceAll('&amp;', '&');
    const row = rows.find((r) => r.label === label);
    assert.equal(to, row.to, `${label} Open is not the S20 row`);
    assert.equal(to, studioCardTarget(false, label));
    assert.ok(!to.startsWith('/branch'), `${label} Open points under /branch/`);
  }
  assert.doesNotMatch(html, /href="\/branch\//, 'an HQ-held Studio card links a page that refuses on HQ');
});

/* ------------------------------------------------------------------ *
 * D1038 (#2390) — the twenty lanes, at /admin/approvals
 * ------------------------------------------------------------------ */

// S22's sixteen lanes became the canvas's twenty (APR2): the eleven the
// glance counts, the nine new ones, and the Not-a-queue card. Each lane's
// door is a literal Link in `LaneDoor`, keyed by the lane.
const APPROVALS = 'frontend/src/pages/admin/approvals/AdminApprovals.jsx';
const APPROVALS_CODE = codeOnly(read(APPROVALS));

/** `LaneDoor`'s cases as lane key → literal target. */
function laneDoors() {
  const out = {};
  const body = APPROVALS_CODE.slice(APPROVALS_CODE.indexOf('export function LaneDoor'), APPROVALS_CODE.indexOf('export function HqDoor'));
  for (const m of body.matchAll(/((?:case '[a-z_]+': )+)return <Link to="([^"]+)"/g)) {
    for (const k of m[1].matchAll(/case '([a-z_]+)'/g)) out[k[1]] = m[2];
  }
  return out;
}

test('Approvals draws the canvas\'s twenty lanes, each with a literal door; moderation keeps its console (D506)', async () => {
  const { LANES } = await import('../src/pages/admin/approvals/approvalsModel.js');
  const doors = laneDoors();
  assert.equal(LANES.length, 20);
  assert.deepEqual(Object.keys(doors).sort(), LANES.map((l) => l.key).sort(), 'every lane has exactly one door');
  for (const [k, to] of Object.entries(doors)) assert.ok(routeLine(pathOf(to)), `${k} opens ${to}, which is not a registered route`);
  assert.equal(doors.moderation, '/admin/spinout-moderation', 'Spinout moderation lost its console — D442 built it and D506 made this lane its HQ door');
  // The eleven laned queues the glance counts are the lanes with a glance key.
  assert.deepEqual(LANES.filter((l) => l.glance).map((l) => l.glance).sort(),
    ['best_fit', 'cohort', 'due_diligence', 'events', 'exploring', 'jobs', 'kyc', 'lp', 'moderation', 'partner_profiles', 'referrals']);
  // Queued consoles belong on Approvals by the H35 map.
  const laned = new Set(ADMIN_PLACEMENT
    .filter((e) => [e, ...(e.also || [])].some((p) => p.tier === 'Admin' && p.row === 'Approvals'))
    .map((e) => e.route));
  for (const l of LANES.filter((x) => x.glance)) {
    const route = doors[l.key];
    // The Lab's queue is placed on Programs (D937); moderation (D442) postdates the map (D506);
    // Events opens the desk's Review tab, a sub-path of the placed /admin/events (D1038).
    if (['/admin/programs/spinout-lab/applications', '/admin/spinout-moderation', '/admin/events/review'].includes(route)) continue;
    assert.ok(laned.has(route), `${l.label} links ${route}, which the H35 map does not place on Admin · Approvals`);
  }
  // Not a queue: each reference is an Admin console.
  const adminConsoles = new Set(ADMIN_PLACEMENT.filter((e) => e.tier === 'Admin').map((e) => e.route));
  const card = APPROVALS_CODE.slice(APPROVALS_CODE.indexOf('data-testid="approvals-not-a-queue"'));
  for (const to of ['/admin/directory', '/admin/circles', '/admin/partner-invitations', '/admin/programs/mentor-cohorts/people']) {
    assert.ok(card.includes(`<Link to="${to}"`), `Not a queue lost its door onto ${to}`);
    assert.ok(adminConsoles.has(to), `${to} has no Admin console placement`);
  }
  assert.doesNotMatch(APPROVALS_CODE, /\.map\([^)]*<Link/, 'a mapped link is invisible to the reachability walk');
});

/* ------------------------------------------------------------------ *
 * The other landings
 * ------------------------------------------------------------------ */

test('Community (D930) links its six consoles at their own routes — Advisors & Partners at its own page (D972), never the old roster address', () => {
  const code = codeOnly(read(COMMUNITY));
  const doors = [...new Set(doorsIn(code))];
  for (const d of ['/admin/events', '/admin/jobs', '/admin/circles', '/admin/advisors-partners', '/admin/wellbeing', '/admin/partner-invitations']) {
    assert.ok(doors.includes(d), `Community has no literal door onto ${d}`);
  }

  assert.ok(!doors.includes('/admin/network-profiles'), 'a door onto the old roster address, which only forwards now (D972)');
  for (const d of doors) {
    assert.ok(!d.startsWith('/branch'), `Community links ${d}, under /branch/`);
    assert.ok(routeLine(pathOf(d)), `Community links ${d}, which is not a registered route`);
  }
  assert.doesNotMatch(code, /\.map\([^)]*<Link/, 'Community maps data into links — invisible to the reachability walk');
});

test('Programs (D953) opens the Lab console and Profiling trends, never the Admin Console\'s Lab tab; Accounts links the Users table, Exploring, Personas and Trash', () => {
  // Defect 1 of #2371: two cards opened one console. One Spin-Out Lab card
  // now, and Programs no longer links the Admin Console's Lab tab.
  const programs = doorsIn(codeOnly(read(PROGRAMS)));
  for (const d of ['/admin/programs/spinout-lab', '/admin/profiling-trends']) assert.ok(programs.includes(d), `Programs has no literal door onto ${d}`);
  assert.ok(!programs.includes('/admin?tab=lab-applications'), 'Programs links the Lab tab and the Lab console, one console twice');
  assert.ok(!programs.includes('/admin/advisor-cohorts'), 'Programs links the old address, which only redirects');
  assert.deepEqual(doorsIn(CODE[LANDINGS.Accounts]),
    ['/admin/accounts/all', '/admin/exploring', '/admin/persona-segments', '/admin/trash']);
});

test('Insights (D893) reads the Insights read, and links only registered routes, never /branch/', () => {
  const src = read(INSIGHTS);
  const code = codeOnly(src);
  assert.match(src, /insightsApi\.adminInsights\(/, 'Insights no longer reads GET /api/admin/insights (#2660)');
  assert.doesNotMatch(src, /No console fits yet for HQ-held accounts/);
  for (const d of doorsIn(code)) {
    assert.ok(!d.startsWith('/branch'), `Insights links ${d}, under /branch/`);
    assert.ok(routeLine(pathOf(d)), `Insights links ${d}, which is not a registered route`);
  }
  assert.doesNotMatch(code, /branch\/insights/, 'Insights borrowed the branch page');
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
  assert.equal(rows.find((r) => r.label === 'Contracts').to, '/admin/contracts');
  // The gates this item touches nothing of.
  // D938: `/admin` only forwards now; All accounts carries its gate.
  for (const path of ['/admin/accounts/all', '/monitoring', '/admin/articles', '/admin/publications', '/admin/team']) {
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
  // D953: the referral review and the assignments console are under Programs
  // now; their old addresses only redirect, and lanes 2 and 16 are their doors.
  const orphans = ['/admin/programs/refer-and-earn/queue', '/admin/partner-invitations', '/admin/lp-applications', '/admin/my-licence', '/admin/best-fit',
    '/admin/events', '/admin/jobs', '/admin/circles', '/admin/due-diligence', '/admin/programs/mentor-cohorts/people'];
  const doors = new Set([
    ...rows.map((r) => pathOf(r.to)),
    ...Object.values(LANDINGS).flatMap((f) => doorsIn(CODE[f]).map(pathOf)),
    // D1038 and D930: Approvals and Community left /admin/held/ with their doors.
    ...doorsIn(APPROVALS_CODE).map(pathOf),
    ...doorsIn(codeOnly(read(COMMUNITY))).map(pathOf),
  ]);
  const missing = orphans.filter((p) => !doors.has(p));
  assert.deepEqual(missing, [], 'these routes have no door on the Admin shell');
});

/* ------------------------------------------------------------------ *
 * The active row, the chrome, the accent, the wall rules
 * ------------------------------------------------------------------ */

test('the Admin rows light by path and `match` alone: no admin page lives on a query (D938)', () => {
  assert.match(SIDEBAR_NAV, /const derivedRow = role === 'super_admin' \? hqRowFor\(navLocation\.pathname\) : null;/,
    'the Admin shell derives a row from the query again');
  assert.doesNotMatch(SIDEBAR_NAV, /adminRowFor/);
  assert.match(SIDEBAR_NAV, /const active = derivedRow !== null\s*\? to === derivedRow/, 'the derived row does not decide the active row');
  const row = (label) => rows.find((r) => r.label === label);
  for (const [label, path] of [['Accounts', '/admin/accounts/all'], ['Accounts', '/admin/persona-segments'], ['Approvals', '/admin/kyc'],
    ['Approvals', '/admin/partner-profiles'], ['Community', '/admin/directory'], ['Community', '/admin/wellbeing']]) {
    assert.ok(row(label).match.includes(path), `${label} does not light on ${path}`);
  }
});

test('the top bar says whose data: "HQ-held · axal.vc" and the HQ-HELD badge, on the plain Admin shell off a branch only', () => {
  const open = APP.indexOf('<Routes');
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

test('the wall rules: search says HQ-held accounts, the scope sentence is the frame\'s, licensing is only Licences', () => {
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
  assert.deepEqual(licence.map((r) => [r.label, r.to]), [['Licences', '/admin/my-licence']],
    'licensing appears somewhere other than the read-only summary in Licences (D796)');
});
