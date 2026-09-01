import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { duplicateApiMethods } from './_apiMethods.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const escapeRegExp = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

// documentation/architecture/DECISIONS.md D10. Companion to research_market_funds_retired and the repo's
// other deletion guards.

test('the three /advisor/network routes redirect onto the working surface', () => {
  const app = read('frontend/src/App.jsx');
  for (const [from, to] of [
    ['/advisor/network', '/network'],
    ['/advisor/network/introductions', '/network?tab=introductions'],
    ['/advisor/network/relationships', '/network?tab=relationships'],
    ['/advisor/network/organizations', '/network'],
  ]) {
    assert.match(
      app,
      new RegExp(`path="${escapeRegExp(from)}" element=\\{<Navigate to="${escapeRegExp(to)}"`),
      `${from} should redirect to ${to}`
    );
  }
  assert.doesNotMatch(app, /AdvisorNetworkWorkspace/);
});

test('the dead network stack is gone but the shared kit survives', () => {
  const dir = 'frontend/src/pages/advisor/network';
  for (const dead of ['AdvisorNetworkWorkspace.jsx', 'IntroductionsPage.jsx',
                      'OrganizationsPage.jsx', 'RelationshipsPage.jsx']) {
    assert.equal(existsSync(resolve(root, `${dir}/${dead}`)), false, `${dead} should be deleted`);
  }
  assert.equal(existsSync(resolve(root, 'frontend/src/data/advisor/network.js')), false);
  // kit.jsx lives here for historical reasons but is imported by 8 unrelated
  // pages — deleting the folder wholesale breaks portfolio, pipeline, funds
  // and partner operations. It stays until it moves to ui/ deliberately.
  assert.ok(existsSync(resolve(root, `${dir}/kit.jsx`)), 'the shared kit must not be deleted with the stack');
});

test('every role links the working Network surface exactly once', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.doesNotMatch(sidebar, /'\/advisor\/network\//);
  assert.equal((sidebar.match(/to: '\/network'/g) || []).length, 5,
    'expected one /network row per role (admin + the four that were collapsed)');
});

test('no api.js method is declared twice inside its object', () => {
  // Sits beside the other two api.js-wide integrity checks in this file.
  //
  // A later duplicate silently wins in an object literal, so the earlier body
  // becomes dead code that still reads like live code. Not theoretical:
  // `getCapTableByProject` was declared twice inside `api`, and the copy that
  // won was the one WITHOUT `encodeURIComponent`, so seven callers
  // interpolated a project id into the URL path raw while an encoded
  // definition sat eighty lines above looking correct. It had been that way
  // since f862ccb1.
  //
  // Nothing in the suite could see it: every existing consumer asks only "is
  // this name defined?", and `apiMethodNames` answers that from a Set — the
  // one structure guaranteed to discard the evidence.
  //
  // Checked per exported object, not per file. api.js exports twenty-three of
  // them and each one's properties sit at the same indent, so a whole-file
  // scan would read `news.list`, `events.list` and `jobs.list` as three
  // declarations of `list` and fail on code that is entirely correct.
  const src = read('frontend/src/lib/api.js');
  const exported = [...src.matchAll(/^export const (\w+) = \{/gm)].map((m) => m[1]);
  assert.ok(exported.length >= 20, `expected api.js's exported objects, found ${exported.length}`);
  const offenders = exported
    .map((name) => [name, duplicateApiMethods(src, name)])
    .filter(([, dupes]) => dupes.length);
  assert.deepEqual(offenders, [],
    offenders.map(([name, d]) => `${name} declares ${d.join(', ')} more than once`).join('; '));
});

test('no client method calls an unmounted network route', () => {
  const api = read('frontend/src/lib/api.js');
  assert.doesNotMatch(api, /networkIntros/);
  assert.doesNotMatch(api, /'\/network-introductions/);
  for (const gone of ['listOrganizations', 'getOrganizationFacets', 'getOrganization']) {
    assert.doesNotMatch(api, new RegExp(`\\b${gone}:`), `${gone} calls a route the worker never mounts`);
  }
});

test('the drift ledger shrank rather than growing', () => {
  const baseline = JSON.parse(read('scripts/api-drift-baseline.json'));
  const rows = baseline.missing_route.join('\n');
  assert.doesNotMatch(rows, /network-introductions/);
  assert.doesNotMatch(rows, /\/api\/organizations/);
  assert.ok(baseline.missing_route.length <= 41,
    `known-drift ledger should be at most 41 entries, found ${baseline.missing_route.length}`);
});
