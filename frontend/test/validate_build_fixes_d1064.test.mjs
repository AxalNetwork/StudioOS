// D1064 (#2934, part 1 of #2426), item 1: a Spin-Out Lab founder reaches
// Build's cycle pages as they reach Validate's. The Worker already admits a
// Lab founder on their own venture (`ownsVenture`); the routes refused them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';

const routes = codeOnly(readRoutesSource());

/** The guard expression of one `<Route path=…>`, up to the component. */
function guardOf(path) {
  const line = routes.split('\n').find((l) => l.includes(`<Route path="${path}"`));
  assert.ok(line, `${path} is registered`);
  return line;
}

/** App.jsx's own `labRoles`, run on a session, so the test admits whom the app admits. */
function labRolesFor(session) {
  const src = routes.match(/const labRoles = \(roles\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(src, 'labRoles is defined in App.jsx');
  // eslint-disable-next-line no-new-func
  return new Function('user', 'isImpersonating', 'viewMode', `${src[0]}; return labRoles;`)(session.user, false, null);
}

const CYCLE = ['/build/connect', '/build/:slug', '/build/:slug/:id', '/build/:slug/new'];

test('Build\'s cycle pages take labRoles, as Validate\'s do', () => {
  for (const path of CYCLE) {
    assert.match(guardOf(path), /guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="build"/, path);
  }
  // `/build` itself: the overview branch takes labRoles too.
  assert.match(routes, /<Route path="\/build" element=\{founderBuildLanding\s*\? guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="build" \/>\)/);
  // The model it copies.
  assert.match(guardOf('/validate/:slug'), /guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="validate"/);
});

test('a Lab founder whose account role is not founder lands on the overview, not the editor\'s redirect', () => {
  const landing = routes.match(/const founderBuildLanding = ([^;]+);/);
  assert.ok(landing);
  const decide = new Function('effectiveRole', 'user', 'location', `return ${landing[1]};`);
  const at = { search: '' };
  assert.equal(decide('exploring', { spinout_lab_active: 1 }, at), true, 'a Lab member opens the Build overview');
  assert.equal(decide('founder', { spinout_lab_active: 0 }, at), true, 'a founder still does');
  assert.equal(decide('exploring', { spinout_lab_active: 0 }, at), false, 'outside the Lab nothing changes');
  assert.equal(decide('admin', { spinout_lab_active: 1 }, at), false, 'an admin keeps the editor');
  assert.equal(decide('exploring', { spinout_lab_active: 1 }, { search: '?mode=workspace' }), false, 'workspace mode still asks for the editor');
});

test('labRoles admits the active Lab member\'s own role and nobody else\'s', () => {
  const lab = labRolesFor({ user: { role: 'exploring', spinout_lab_active: 1 } });
  assert.deepEqual(lab(['admin', 'founder']), ['admin', 'founder', 'exploring']);
  const out = labRolesFor({ user: { role: 'exploring', spinout_lab_active: 0 } });
  assert.deepEqual(out(['admin', 'founder']), ['admin', 'founder']);
});
