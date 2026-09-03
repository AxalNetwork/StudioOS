/**
 * Partner bucket roots render the canvas overview pages, not the first zone
 * and not a legacy destination.
 *
 * The Partner Operator canvas specifies a landing page per bucket — P3
 * Pipeline ("Win the work"), P4 Delivery ("Ship the work"), P5 Offers
 * ("Package what we sell"), P6 Network ("Work our relationships"), P7
 * Research ("Know the client's world"). The sidebar row must open that
 * overview. What it did instead, per the bug report:
 *
 *   - Research pointed at /signals
 *   - Network fell through the role branch to a bare NetworkPage (or bounced
 *     an admin preview to /studio)
 *   - Offers redirected /offers to /offers/catalog
 *   - Delivery redirected /delivery to /delivery/board
 *   - /pipeline rendered the investor deal pipeline for partners
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const bucketRoutes = codeOnly(read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'));
const sidebar = codeOnly(read('frontend/src/sidebarConfig.js'));
const shell = codeOnly(read('frontend/src/workspaces/WorkspaceShell.jsx'));

test('Delivery and Offers roots are routes, not redirects', () => {
  for (const prefix of ['/delivery', '/offers']) {
    const line = app.split('\n').find((l) => l.includes(`path="${prefix}"`));
    assert.ok(line, `${prefix} has no route`);
    assert.doesNotMatch(line, /Navigate to=/, `${prefix} must not redirect to a zone`);
    assert.match(line, /PartnerBucketRoutes/, `${prefix} must render the bucket shell`);
  }
});

test('the partner /pipeline root renders the partner bucket, not the investor page', () => {
  const line = app.split('\n').find((l) => l.includes('path="/pipeline"'));
  assert.ok(line, '/pipeline has no route');
  assert.match(line, /effectiveRole === 'partner' \? <PartnerBucketRoutes \/>/,
    'partners must branch to PartnerBucketRoutes');
  assert.match(line, /investorWorkspace\('deals', <PipelineWorkspace \/>\)/,
    'investors keep the deal pipeline');
  // Exactly one /pipeline route — a duplicate would shadow by rank order.
  const count = app.split('\n').filter((l) => l.includes('path="/pipeline"')).length;
  assert.equal(count, 1, 'there must be exactly one /pipeline route');
});

test('partner /network renders the network shell, outside the preview redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/network"'));
  assert.ok(line, '/network has no route');
  assert.match(line, /effectiveRole === 'partner' \? <NetworkWorkspace role="partner" \/>/,
    'partners must get the zone shell');
  // The branch sits BEFORE partnerPrivateWorkspace, so an admin previewing
  // the Partner role lands on the overview instead of bouncing to /studio.
  assert.ok(
    line.indexOf("effectiveRole === 'partner'") < line.indexOf('partnerPrivateWorkspace'),
    'the partner branch must come before the preview redirect',
  );
});

test('partner sidebar rows point at bucket roots', () => {
  const partner = sidebar.slice(sidebar.indexOf('\n  partner: ['), sidebar.indexOf('\n  investor: ['));
  for (const root of ['/pipeline', '/delivery', '/offers', '/network', '/research']) {
    assert.match(partner, new RegExp(`to: '${root}'`), `no partner row points at ${root}`);
  }
  for (const legacy of ["/needs'", "/partner/operations/overview'", "/services'", "/signals'"]) {
    assert.doesNotMatch(partner, new RegExp(`to: '${legacy}`),
      `a partner row still points at legacy ${legacy}`);
  }
});

test('PartnerBucketRoutes renders an overview grid at each bucket root', () => {
  assert.match(bucketRoutes, /isRoot/, 'the root must be detected');
  assert.match(bucketRoutes, /<BucketOverview bucket=\{bucket\} role="partner"/,
    'the root must render the shared overview with the partner accent');
  assert.match(bucketRoutes, /activeSlug=\{isRoot \? null : undefined\}/,
    'the root must light no zone pill');
  assert.match(bucketRoutes, /title=\{isRoot \? bucket\?\.label : undefined\}/,
    'the root must title itself with the bucket, not the first zone');
});

test('WorkspaceShell resolves no zone when activeSlug is null', () => {
  assert.match(shell, /activeSlug === null \? null : zoneForPath/,
    'overview mode must clear the crumb, title and badge zone');
});

test('the shared overview component exists and takes a role accent', () => {
  const overview = codeOnly(read('frontend/src/workspaces/BucketOverview.jsx'));
  assert.match(overview, /ACCENT\[role\]/, 'the accent must come from the role');
  assert.match(overview, /zonePath\(bucket, zone\)/, 'each card must link to its zone route');
});
