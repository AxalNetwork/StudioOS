/**
 * The Partner shell matches the canvas, and nothing was orphaned reaching it.
 *
 * The Partner canvas does not describe its sidebar in prose — it declares it:
 *
 *   // CANONICAL Partner shell — 8 rows, no tier gating in v1.
 *   const ROWS = ['Home','Pipeline','Delivery','Offers','Network','Research',
 *                 'Trust','Firm Settings'];
 *
 * That is a FLAT list. The first reading of these canvases matched group NAMES
 * and concluded the IA was mostly aligned; it was not. Seventeen items across
 * seven groups became eight rows, and the sections the canvas draws inside each
 * row (Pipeline → Leads · Negotiations · Proposals · Retainers · Analytics)
 * belong in the page, not the sidebar.
 *
 * The second test is the one that matters operationally. A restructure that
 * drops a destination does not fail anything — the route still resolves, it
 * just has no door. That is the Wave 4 mistake in reverse, and the only defence
 * is to assert every previous destination is still reachable from the nav.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/sidebarConfig.js'), 'utf8'));
const partner = src.slice(src.indexOf('\n  partner: ['), src.indexOf('\n  investor: ['));

/** Every path the partner nav mentions, whether as a destination or a match. */
const paths = new Set([...partner.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]));
/**
 * Row labels in declared order.
 *
 * Anchored on `to:` so the GROUP's own label is not counted as a row — the
 * first version matched every `label:` and read "Workspace" as the first row.
 */
const rows = [...partner.matchAll(/\{ to: '[^']*'[^}]*label: '([^']+)'/g)].map((m) => m[1]);

test('the shell is the canvas ROWS, in order', () => {
  // Trust is the canvas's eighth row and is deliberately absent — see the
  // comment in sidebarConfig.js and `trust_center_navigation.test.mjs`, which
  // pins Trust Center to the user dropdown and out of every sidebar.
  const CANON = ['Home', 'Pipeline', 'Delivery', 'Offers', 'Network', 'Research',
                 'Firm Settings'];
  // Messages is a deliberate ninth row: the canvas's eight have nowhere to put a
  // cross-cutting inbox, and dropping it would leave /messages reachable only by
  // typing the URL. Filtering it here rather than adding it to CANON keeps this
  // test honest about what the canvas actually says.
  assert.deepEqual(rows.filter((r) => r !== 'Messages'), CANON);
});

test('the shell is flat — one group, not seven', () => {
  const groups = [...partner.matchAll(/\{ key: '([^']+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['shell'], 'the canvas declares rows, not groups');
});

test('every destination the old nav reached is still reachable', () => {
  // The seventeen items the seven groups carried before the restructure.
  const BEFORE = [
    '/studio', '/messages', '/services', '/matches', '/needs', '/partner/insights',
    '/partner/office-hours', '/comarketing', '/my/jobs', '/perks', '/network',
    '/partner/operations/overview', '/partner/operations/capabilities',
    '/partner/operations/portfolio', '/partner/operations/engagements',
    '/partner/operations/performance', '/market-intel',
  ];
  const lost = BEFORE.filter((p) => !paths.has(p));
  assert.deepEqual(lost, [], 'these have no row and no match — they are unreachable from the nav');
});

test('Home is /studio, and no role root was invented', () => {
  assert.ok(partner.includes("{ to: '/studio', icon: LayoutDashboard, label: 'Home' }"));
  assert.ok(!paths.has('/home'), 'no /home root');
  assert.ok(![...paths].some((p) => p === '/partner'), 'no bare /partner root');
});

test('Trust stays out of the sidebar', () => {
  // The canvas asks for a Trust row. `trust_center_navigation.test.mjs` says
  // Trust Center appears in no sidebar and lives in the user dropdown between
  // User Settings and Support. This asserts the same thing from the Partner
  // side so the two cannot drift apart silently.
  assert.ok(!paths.has('/trust'), 'Trust Center belongs to the user dropdown');
});
