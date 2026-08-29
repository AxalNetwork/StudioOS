import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

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
    // An exact substring, not a regex. The previous form built a RegExp from
    // these strings and escaped only `/` and `?` — CodeQL 5907
    // (js/incomplete-sanitization) rightly flagged the partial escaping. But
    // nothing here needs a pattern at all: the route line is a literal, and
    // includes() asserts it more exactly than the regex did.
    const line = `path="${from}" element={<Navigate to="${to}"`;
    assert.ok(app.includes(line), `${from} should redirect to ${to}`);
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
