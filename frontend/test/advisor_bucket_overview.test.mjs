/**
 * Advisor bucket roots render overviews, not the first zone.
 *
 * The canvas specifies a landing page for each bucket — Practice, Expertise,
 * Network, Research — and the sidebar row must open that overview, not jump
 * straight to the first zone. This test pins the routing and the overview
 * bodies so a later change cannot quietly restore the old redirects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const bucketRoutes = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
const networkWs = read('frontend/src/workspaces/NetworkWorkspace.jsx');
const researchWs = read('frontend/src/workspaces/ResearchWorkspace.jsx');
const shell = read('frontend/src/workspaces/WorkspaceShell.jsx');

test('Practice root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/practice"'));
  assert.ok(line, '/practice has no route');
  assert.doesNotMatch(line, /Navigate to="\/practice\//, '/practice must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/practice must render the bucket shell');
});

test('Expertise root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/expertise"'));
  assert.ok(line, '/expertise has no route');
  assert.doesNotMatch(line, /Navigate to="\/expertise\//, '/expertise must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/expertise must render the bucket shell');
});

test('Cohorts root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/cohorts"'));
  assert.ok(line, '/cohorts has no route');
  assert.doesNotMatch(line, /Navigate to="\/cohorts\//, '/cohorts must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/cohorts must render the bucket shell');
});

test('bucket roots render an overview grid, not a zone body', () => {
  const code = codeOnly(bucketRoutes);
  assert.match(code, /isRoot &&/, 'AdvisorBucketRoutes must detect the bucket root');
  assert.match(code, /<BucketOverviewGrid bucket=\{bucket\} \/>/, 'the root must render the overview');
  assert.match(code, /<BucketOverview bucket=\{bucket\} role="advisor"/,
    'the overview must delegate to the shared grid with the advisor accent');
  assert.match(code, /ADVISOR_ZONE_LINES/, 'the overview must list every zone');
});

test('Network root renders an overview for advisors', () => {
  const code = codeOnly(networkWs);
  assert.match(code, /isRoot/, 'NetworkWorkspace must detect the bucket root');
  assert.match(code, /<NetworkOverview/, 'the root must render the overview');
});

test('Research root renders an overview for advisors', () => {
  const code = codeOnly(researchWs);
  assert.match(code, /isRoot/, 'ResearchWorkspace must detect the bucket root');
  assert.match(code, /<ResearchOverview/, 'the root must render the overview');
});

test('the shell crumb links to the bucket root, not the first zone', () => {
  const code = codeOnly(shell);
  assert.match(code, /to=\{bucket\.prefix\}/, 'the crumb must link to the bucket root');
  assert.doesNotMatch(code, /to=\{`\$\{bucket\.prefix\}\/\$\{bucket\.zones\[0\]\.slug\}`\}/,
    'the crumb must not link to the first zone');
});

test('the shell passes activeSlug through to ZoneNav', () => {
  const code = codeOnly(shell);
  assert.match(code, /activeSlug=\{activeSlug\}/, 'WorkspaceShell must forward activeSlug');
});
