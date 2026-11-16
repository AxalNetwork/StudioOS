/**
 * D6679 (#6679, owner answer A): T2 narrowed in two places, with the
 * test-weakening guards left as they were.
 *   1. Every `frontend/src/` and `cloudflare-worker/src/` folder is named, so a
 *      file there is T1; protected paths and names still win.
 *   2. An edit to an existing test file with a readable diff is T1; a drop in
 *      tests or assertions, or an added skip, todo or only, keeps it T2.
 * The three mutation checks the issue asks for are the `still T2` tests below:
 * an auth path, a dropped assertion and an added skip must each stay T2.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import { classify } from '../../scripts/merge-policy.mjs';
import { pathGuard } from '../../scripts/landing-bot/rules.mjs';

const ROOT = new URL('../../', import.meta.url);
const file = (path, status = 'M', patch = '') => ({ path, status, patch });
const hunk = (...lines) => ['@@ -1,3 +1,3 @@', ...lines].join('\n');
const tierOf = (...files) => classify(files).tier;
const reasons = (...files) => classify(files).reasons.join('\n');
const folders = (dir) => readdirSync(new URL(dir, ROOT)).filter((n) => statSync(new URL(`${dir}${n}`, ROOT)).isDirectory());
const TEST = 'frontend/test/example.test.mjs';

test('D6679: every frontend/src folder is a named folder (T0 leaf UI or T1), never unmatched', () => {
  for (const dir of folders('frontend/src/')) {
    const r = classify([file(`frontend/src/${dir}/Example.jsx`)]);
    assert.notEqual(r.tier, 'T2', `frontend/src/${dir}: ${r.reasons}`);
  }
  assert.equal(tierOf(file('frontend/src/lib/format.js')), 'T1');
  assert.equal(tierOf(file('frontend/src/ui/Panel.jsx')), 'T1');
  assert.equal(tierOf(file('frontend/src/workspaces/hq/Board.jsx')), 'T1');
  assert.match(reasons(file('frontend/src/hooks/useThing.js')), /^T1: named source folder: frontend\/src\/hooks\//m);
});

test('D6679: every cloudflare-worker/src folder but middleware is T1; middleware stays protected', () => {
  for (const dir of folders('cloudflare-worker/src/')) {
    const tier = tierOf(file(`cloudflare-worker/src/${dir}/example.ts`));
    assert.equal(tier, dir === 'middleware' ? 'T2' : 'T1', `cloudflare-worker/src/${dir}`);
  }
  assert.match(reasons(file('cloudflare-worker/src/middleware/cors.ts')), /protected path/);
});

test('D6679: files at the top of a source tree, and new folders, are still unmatched T2', () => {
  for (const p of ['cloudflare-worker/src/index.ts', 'cloudflare-worker/src/db.ts', 'frontend/src/App.jsx', 'frontend/src/brandnew/X.jsx', 'cloudflare-worker/src/brandnew/x.ts']) {
    assert.match(reasons(file(p)), /^T2: unmatched path/m, p);
  }
});

test('D6679 mutation check: an auth, session, permission, tenancy, billing or money path in a newly named folder is still T2', () => {
  for (const p of [
    'frontend/src/lib/auth.js', 'frontend/src/lib/api/authApi.js', 'frontend/src/hooks/useSession.js',
    'frontend/src/contexts/PermissionsContext.jsx', 'cloudflare-worker/src/util/tenancy.ts',
    'cloudflare-worker/src/integrations/stripe/client.ts', 'frontend/src/ui/BillingPanel.jsx',
    'cloudflare-worker/src/models/money.ts', 'cloudflare-worker/src/durable-objects/SessionStore.ts',
  ]) assert.match(reasons(file(p)), /^T2: protected path/m, p);
});

test('D6679: an edit to an existing test with its counts intact is T1', () => {
  const same = file(TEST, 'M', hunk('-  assert.equal(got, 1);', '+  assert.equal(got, 2);'));
  assert.equal(tierOf(same), 'T1');
  assert.match(reasons(same), /^T1: edited test, counts checked/m);
  const grown = file('cloudflare-worker/test/example.test.ts', 'M', hunk('+test("more", () => { assert.ok(true); });'));
  assert.equal(tierOf(grown), 'T1');
  assert.equal(tierOf(file('backend/tests/test_example.py', 'M', hunk('-    assert a == 1', '+    assert a == 2'))), 'T1');
});

test('D6679 mutation check: a dropped assertion or test in an edited test is still T2', () => {
  const dropped = file(TEST, 'M', hunk('   assert.equal(got, 1);', '-  assert.equal(other, 2);'));
  assert.equal(tierOf(dropped), 'T2');
  assert.match(reasons(dropped), /Test or assertion count dropped/);
  assert.equal(tierOf(file(TEST, 'M', hunk('-test("gone", () => {});'))), 'T2');
  // Swapping a test for an assertion still drops a test.
  assert.equal(tierOf(file(TEST, 'M', hunk('-it("a", () => {});', '+assert.ok(true);'))), 'T2');
});

test('D6679 mutation check: an added skip, todo or only in an edited test is still T2', () => {
  for (const line of ["+test.skip('x', () => {});", "+test.todo('x');", "+it.only('x', () => {});", "+test('x', { skip: 'flaky' }, () => {});"]) {
    const r = classify([file(TEST, 'M', hunk(line))]);
    assert.equal(r.tier, 'T2', line);
    assert.match(r.reasons.join('\n'), /Test skip, todo or only added/, line);
  }
});

test('D6679: helpers and fixtures in a test folder, and an unreadable test edit, stay T2', () => {
  assert.match(reasons(file('frontend/test/_deck-loader.mjs', 'M', hunk('-a', '+b'))), /^T2: test helper or fixture/m);
  assert.match(reasons(file('cloudflare-worker/test/fixtures/deal.json', 'M', hunk('-a', '+b'))), /^T2: test helper or fixture/m);
  assert.match(reasons(file(TEST, 'M', '')), /^T2: existing test without a readable diff/m);
  assert.match(reasons(file(TEST, 'C100', hunk('+test("x", () => {});'))), /^T2: existing test without a readable diff/m);
  assert.equal(tierOf(file(TEST, 'M', hunk('-  setTimeout(r, 10);', '+  setTimeout(r, 50);'))), 'T2', 'a timeout change still wins');
});

test('D6679: a landing bot still may not edit an existing test (pathGuard passes no diff)', () => {
  const r = pathGuard([{ path: TEST }]);
  assert.equal(r.ok, false);
  assert.match(r.refused[0].reason, /existing test without a readable diff/);
  assert.equal(pathGuard([{ path: 'frontend/src/lib/format.js' }]).ok, true);
});
