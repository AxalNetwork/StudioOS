/**
 * The Partner shell follows the canvas, and no surface lost its door.
 *
 * The Partner canvas does not describe its sidebar — it declares it:
 *
 *   // CANONICAL Partner shell — 8 rows, no tier gating in v1.
 *   const ROWS = ['Home','Pipeline','Delivery','Offers','Network','Research',
 *                 'Trust','Firm Settings'];
 *
 * A FLAT list. The first reading of these canvases matched group NAMES and
 * concluded the IA was mostly aligned; it was not.
 *
 * THE TEST THAT MATTERS IS THE SECOND ONE. Flattening a sidebar does not fail
 * loudly when it goes wrong: the route still resolves, it just stops having a
 * door, and nothing notices until a user says "where did X go". The first cut
 * of this restructure did exactly that to five surfaces — /matches,
 * /partner/insights, /comarketing, /perks and /partner/office-hours, each of
 * which a search of every `to=` and `navigate(` in frontend/src showed has NO
 * other inbound link. So reachability is asserted two ways: a row of its own,
 * or a workspace that tabs to it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const partner = src.slice(src.indexOf('\n  partner: ['), src.indexOf('\n  investor: ['));

const rows = [...partner.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const labels = rows.map((r) => r.label);
const targets = rows.map((r) => r.to);

test('the canvas rows are all present, in the canvas order', () => {
  // A subsequence check, not equality: rows still pending absorption sit
  // between them, and the next test is what keeps that list honest.
  const CANON = ['Home', 'Pipeline', 'Delivery', 'Offers', 'Network', 'Research',
                 'Firm Settings'];
  let i = 0;
  for (const l of labels) if (l === CANON[i]) i += 1;
  assert.equal(i, CANON.length,
    `canonical rows out of order or missing — got ${JSON.stringify(labels)}`);
});

test('the shell is flat — one group, not seven', () => {
  const groups = [...partner.matchAll(/\{ key: '([^']+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['shell'], 'the canvas declares rows, not groups');
});

test('every destination the old nav reached still has a door', () => {
  const BEFORE = [
    '/studio', '/messages', '/services', '/matches', '/needs', '/partner/insights',
    '/partner/office-hours', '/comarketing', '/my/jobs', '/perks', '/network',
    '/partner/operations/overview', '/partner/operations/capabilities',
    '/partner/operations/portfolio', '/partner/operations/engagements',
    '/partner/operations/performance', '/market-intel',
  ];
  // A workspace counts as a door only if it actually tabs to the page. This
  // reads PartnerOperationsWorkspace rather than trusting the claim.
  const opsTabs = read('frontend/src/pages/partner/operations/PartnerOperationsWorkspace.jsx');
  const doorless = BEFORE.filter((p) => !targets.includes(p) && !opsTabs.includes(`to: '${p}'`));
  assert.deepEqual(doorless, [],
    'these have no nav row and no workspace tab — reachable only by typing the URL');
});

test('the pending list can only shrink', () => {
  // Rows that exist ONLY because their canonical owner cannot yet absorb them.
  // When a workspace grows a WorkspaceTabs bar over its sections, its rows come
  // out of the nav and out of this list in the same commit. Adding to it is the
  // change this test is meant to make someone argue for.
  const PENDING = ['/matches', '/partner/insights', '/perks', '/comarketing',
                   '/partner/office-hours', '/my/jobs', '/messages'];
  const extra = targets.filter((t) => ![
    '/studio', '/needs', '/partner/operations/overview', '/services',
    '/network', '/market-intel', '/settings',
  ].includes(t));
  assert.deepEqual(extra.sort(), [...PENDING].sort(),
    'the set of un-absorbed rows changed — shrink it, or justify the addition here');
});

test('Home is /studio, and no role root was invented', () => {
  assert.equal(rows[0].to, '/studio');
  assert.equal(rows[0].label, 'Home');
  assert.ok(!targets.includes('/home'), 'no /home root');
  assert.ok(!targets.includes('/partner'), 'no bare /partner root');
});

test('Trust stays out of the sidebar', () => {
  // The canvas asks for a Trust row. `trust_center_navigation.test.mjs` says
  // Trust Center appears in no sidebar and lives in the user dropdown between
  // User Settings and Support. Asserted from the Partner side too so the two
  // cannot drift apart silently.
  assert.ok(!targets.includes('/trust'), 'Trust Center belongs to the user dropdown');
});
