/**
 * A zone route may admit a role only if that role's shell has that zone.
 *
 * THE CONVERSE OF `workspace_shell_routes.test.mjs`, AND THE HALF THAT WAS
 * MISSING. That guard asserts every zone a shell declares HAS a route, so a
 * sidebar pill can never point at a blank page. Nothing asserted the other
 * direction — that a route does not admit a role whose shell has no such zone —
 * and the gap was not theoretical: nineteen role/route combinations were in that
 * state, eighteen of them rendering the wrong page.
 *
 * WHY THE WRONG PAGE RATHER THAN A 404. `zoneForPath` (`shellConfig.js`) ends
 * `|| bucket.zones[0]`, which is right for a bucket root and silently wrong for
 * a slug the role's shell does not list. `ResearchWorkspace` then dispatches its
 * BODY on that resolved slug, so an advisor at `/research/funds` got Ask's body
 * under Ask's heading — not an error, not an empty state, just a different page
 * wearing the URL of the one that was asked for.
 *
 * The two halves belong together: one says every door has a room behind it, this
 * one says every door opens onto its OWN room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketsFor, bucketForPath, zoneForPath } from '../src/workspaces/shellConfig.js';
import { readRoutesSource } from './_routesSource.mjs';
import { isRetiredRedirect } from './_retiredRedirects_2319.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// D528 — App.jsx plus every module under frontend/src/routes/, so a zone route
// in a module is held to the same role contract as one in App.jsx.
const appSrc = readRoutesSource(resolve(here, '../..'));

const ROLES = ['founder', 'investor', 'advisor', 'partner'];

/** `/prefix/slug` for every zone a role's shell declares. */
const declared = new Map(ROLES.map((role) => [role, new Set(
  bucketsFor(role).flatMap((b) => b.zones.map((z) => `${b.prefix}/${z.slug}`)),
)]));

/** Every zone route any shell declares — the set this guard has an opinion about. */
const zoneRoutes = new Set([...declared.values()].flatMap((s) => [...s]));

/**
 * Routes that deliberately serve a role whose shell has no such zone, because
 * the element branches on `effectiveRole` and hands that role its own surface.
 *
 * AN ENTRY HERE IS NOT TAKEN ON TRUST. The test below requires each one to
 * actually contain that branch, so an allowlist row cannot quietly cover a route
 * that forwards nothing — which is the difference between this and the four
 * bare-element routes the guard caught.
 */
const BRANCHED = {
  // "Founders manage their room; investors see what was shared with them. One
  // route, role-branched inside the page, so there is no second root."
  '/raise/data-room': ['investor'],
  // D905 (#2684), PD22: the studio's home tells an Advisor or an Operating
  // Partner it is for the venture's founders (PitchBoundary), never their body.
  '/raise/pitch': ['advisor', 'partner'],
};

/**
 * Each `<Route>` in App.jsx, as `{ path, roles, body }`.
 *
 * Segments are split on the tag and truncated at the next one, so a role array
 * belonging to a later route cannot be read as this route's. The parser is
 * asserted complete below rather than assumed: a zone route it fails to find
 * would be a route this guard silently has no opinion about, which is the exact
 * failure mode of `check-workspace-frames.mjs` (it documents a bug on paths its
 * own route list never visits).
 */
function routes(src) {
  const out = [];
  for (const seg of src.split('<Route').slice(1)) {
    const p = /^\s*path="([^"]+)"/.exec(seg);
    if (!p) continue;
    const next = seg.indexOf('\n      <Route');
    const body = next >= 0 ? seg.slice(0, next) : seg;
    const roles = new Set();
    for (const arr of body.matchAll(/(?:labRoles\(\[|guard\(\[)([^\]]*)\]/g)) {
      for (const q of arr[1].matchAll(/'([a-z_]+)'/g)) roles.add(q[1]);
    }
    out.push({ path: p[1], roles: [...roles], body });
  }
  return out;
}

const parsed = routes(appSrc);
const zoneRouteRows = parsed.filter((r) => zoneRoutes.has(r.path));

test('the parser finds every declared zone route in App.jsx', () => {
  // If this drifts, the assertions below stop covering part of the route table
  // WITHOUT failing — a guard that got quieter, which is worse than no guard.
  const found = new Set(zoneRouteRows.map((r) => r.path));
  for (const z of [...zoneRoutes].filter(isRetiredRedirect)) assert.equal(found.has(z), false, `${z} retired by D2319`);
  const missing = [...zoneRoutes].filter((z) => !isRetiredRedirect(z) && !found.has(z));
  assert.deepEqual(missing, [],
    `these zone routes were not parsed, so nothing below checks them:\n  ${missing.join('\n  ')}`);
  assert.ok(zoneRoutes.size >= 70,
    `expected the four shells to declare at least 70 zone routes, got ${zoneRoutes.size}`);
});

test('every zone route admits only roles whose shell has that zone', () => {
  const offenders = [];
  for (const { path, roles } of zoneRouteRows) {
    const allowed = BRANCHED[path] || [];
    for (const role of roles) {
      if (!ROLES.includes(role)) continue;          // admin and the lab roles
      if (declared.get(role).has(path)) continue;   // its own zone
      if (allowed.includes(role)) continue;         // deliberate, asserted below
      offenders.push(`${path} admits ${role}, whose shell has no such zone`);
    }
  }
  assert.deepEqual(offenders, [],
    `a role reaching a zone its shell does not list resolves to that bucket's FIRST zone\n`
    + `(zoneForPath falls back to zones[0]), so the page renders someone else's body:\n  `
    + offenders.join('\n  '));
});

test('every allowlisted cross-role route really branches on the role', () => {
  for (const [path, roles] of Object.entries(BRANCHED)) {
    const row = zoneRouteRows.find((r) => r.path === path);
    assert.ok(row, `${path} is allowlisted but is not a declared zone route`);
    assert.match(row.body, /effectiveRole === '/,
      `${path} is allowlisted as role-branched but its element does not branch on effectiveRole`);
    for (const role of roles) {
      assert.match(row.body, new RegExp(`'${role}'`),
        `${path} is allowlisted for ${role} but never names that role`);
      assert.ok(row.roles.includes(role),
        `${path} is allowlisted for ${role} but its guard does not admit that role`);
    }
  }
});

test('zoneForPath answers a root with its first zone and an unknown slug with null', () => {
  // THE MECHANISM, PINNED DIRECTLY. Narrowing the guards above stops a role
  // reaching a foreign zone; this stops the silent substitution that made such
  // a reach render someone else's page instead of nothing. Both halves are
  // needed: guard lists are hand-maintained, and the next one to drift should
  // produce a null the caller redirects on, not a neighbour's body.
  const bucket = bucketForPath('partner', '/research/ask');
  assert.ok(bucket, "the partner research bucket is gone");
  assert.equal(bucket.zones[0].slug, 'ask', 'partner research no longer starts at Ask');

  // The root still resolves, because five callers rely on it and two of the
  // eight have no isRoot guard of their own.
  assert.equal(zoneForPath(bucket, '/research')?.slug, 'ask');

  // A slug the partner shell DOES list resolves to itself.
  assert.equal(zoneForPath(bucket, '/research/library')?.slug, 'library');

  // And the four it does not list answer null rather than 'ask'. Before this
  // change every one of them returned the Ask zone, and `ResearchWorkspace`
  // rendered Ask's body under Ask's heading at those URLs.
  for (const slug of ['funds', 'diligence', 'benchmarking', 'companies']) {
    assert.equal(zoneForPath(bucket, `/research/${slug}`), null,
      `/research/${slug} resolves to a zone the partner shell does not list`);
  }
});

/**
 * #6265: THE ADMIN HALF. The loop above skips `admin`, because an admin has no
 * shell of its own. Under Research and Network it is not shell-less, though:
 * it browses as the founder (`researchRole` / `networkRole` in App.jsx). So an
 * admitted admin at a zone the founder shell does not list resolves to null,
 * and `ResearchWorkspace` drew "Nothing serves this zone yet" on
 * `/research/diligence` and `/research/benchmarking`. The rule: under these two
 * prefixes a route (a zone or a page beneath one) whose zone the founder shell
 * does not list never admits `admin`, never goes through `labRoles` (which adds
 * `viewMode`, and that is 'admin' for an admin who is not previewing), and sends
 * such an admin to `/research` through `adminToResearch`.
 */
const FOUNDER_PREVIEW_PREFIXES = ['/research', '/network'];

test('admin, browsing Research and Network as the founder, reaches only zones the founder shell lists', () => {
  assert.match(appSrc, /const researchRole = \(!effectiveRole \|\| effectiveRole === 'admin'\) \? 'founder' : effectiveRole;/,
    'an admin no longer previews Research as the founder; this guard must learn the new rule');
  assert.match(appSrc, /const networkRole = researchRole;/);
  const founder = declared.get('founder');
  const offenders = [];
  let foreign = 0;
  for (const { path, roles, body } of parsed) {
    const prefix = FOUNDER_PREVIEW_PREFIXES.find((p) => path.startsWith(`${p}/`));
    if (!prefix) continue;
    const zone = `${prefix}/${path.slice(prefix.length + 1).split('/')[0]}`;
    if (!zoneRoutes.has(zone) || founder.has(zone) || isRetiredRedirect(path)) continue;
    if (/<Navigate /.test(body) && !/guard\(/.test(body)) continue; // a plain redirect admits no one
    foreign += 1;
    if (roles.includes('admin')) offenders.push(`${path} admits admin`);
    if (/labRoles\(/.test(body)) offenders.push(`${path} uses labRoles, which re-admits admin through viewMode`);
    if (!/element=\{adminToResearch\(/.test(body)) offenders.push(`${path} does not send a plain admin to /research`);
  }
  // diligence x3, benchmarking x2, client-prep: if this drops, the scan stopped seeing them.
  assert.ok(foreign >= 6, `expected at least 6 Research routes outside the founder shell, saw ${foreign}`);
  assert.deepEqual(offenders, [], `the founder shell has none of these zones, so an admin resolves to no zone:\n  ${offenders.join('\n  ')}`);
});

test('the Research routes closed to admin still open for an admin using View as a licence that has them', async () => {
  const { resolveActiveRole, resolveHeldLicences } = await import('../src/lib/activeRole.js');
  // RoleGuard's and labRoles' own lines, pinned so the simulation below is the one App.jsx runs.
  assert.ok(appSrc.includes("const effectiveRole = isImpersonating ? user?.role : ((realUser || user)?.role === 'admin' ? viewMode : user?.role);"),
    'RoleGuard no longer reads the previewed role the way this test simulates');
  assert.ok(appSrc.includes('if (!allowedRoles.includes(effectiveRole) && !held.some((l) => allowedRoles.includes(l))) {'),
    'RoleGuard no longer admits on the role browsed as or a held licence');
  assert.ok(appSrc.includes("const adminToResearch = (element) => (effectiveRole === 'admin' ? <Navigate to=\"/research\" replace /> : element);"),
    'the admin redirect these routes rely on changed');

  const admin = { role: 'admin' };
  const session = (viewMode) => ({ user: admin, realUser: admin, viewMode, isImpersonating: false });
  // What the route renders: adminToResearch, then RoleGuard on the plain `guard([...])` list.
  const outcome = (roles, viewMode) => {
    const effective = resolveActiveRole(session(viewMode));
    if (effective === 'admin') return 'redirect:/research';
    const held = resolveHeldLicences(session(viewMode));
    return roles.includes(effective) || held.some((l) => roles.includes(l)) ? 'page' : 'refused';
  };
  const researchRoleFor = (viewMode) => (!viewMode || viewMode === 'admin' ? 'founder' : viewMode);

  const cases = [
    ['/research/diligence', 'investor'],
    ['/research/diligence/:grantUid', 'investor'],
    ['/research/diligence/:grantUid/files/:fileUid', 'investor'],
    ['/research/benchmarking', 'investor'],
    ['/research/benchmarking/:uid', 'investor'],
    ['/research/client-prep', 'advisor'],
    ['/research/client-prep', 'partner'],
  ];
  for (const [path, preview] of cases) {
    const row = parsed.find((r) => r.path === path);
    assert.ok(row, `${path} is not routed`);
    assert.equal(row.roles.includes('admin'), false, `${path} admits admin again`);
    // labRoles adds viewMode, which is 'admin' for an admin not previewing: it must not gate these.
    assert.match(row.body, /element=\{adminToResearch\(guard\(\[/, `${path} is not adminToResearch(guard([...]))`);
    assert.doesNotMatch(row.body, /labRoles\(/, `${path} uses labRoles, which re-admits admin through viewMode`);
    assert.equal(outcome(row.roles, preview), 'page', `${path} refuses an admin previewing ${preview}`);
    assert.equal(outcome(row.roles, 'admin'), 'redirect:/research', `${path} does not send a plain admin to /research`);
    assert.equal(outcome(row.roles, 'founder'), 'refused', `${path} opens for an admin previewing Founder`);
    // The previewed shell resolves the zone, so the page drawn is the zone's own.
    const zonePath = path.split('/').slice(0, 3).join('/');
    const role = researchRoleFor(preview);
    assert.equal(zoneForPath(bucketForPath(role, zonePath), zonePath)?.slug, zonePath.split('/')[2],
      `${zonePath} does not resolve in the ${role} shell`);
  }
  // The un-previewed admin browses the founder shell, which has none of the three: why admin is off.
  for (const zonePath of ['/research/diligence', '/research/benchmarking', '/research/client-prep']) {
    assert.equal(zoneForPath(bucketForPath('founder', zonePath), zonePath), null, zonePath);
  }
});
