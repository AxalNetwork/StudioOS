/**
 * D402 — on a zone below a workspace, the rail shows the workspace's model as
 * INHERITED, read-only, with a link back to where it is chosen.
 *
 * The choice was already stored per workspace (`worker_rail_model:<workspace>`),
 * so a zone and its root read the same key. The screen disagreed: every zone
 * drew the full menu, so picking a model "for Interviews" silently changed it
 * for all of Validate. The Validate canvas, DetailRail and EmberRail all draw
 * the zone rail as inherited instead.
 *
 * The rail itself cannot be rendered here with a model block: its data comes
 * from `useAiSpend`'s effect, which a server render never runs. So the
 * zone/root decision is pinned behaviourally on `railInheritance`, and the
 * rail's use of it on the source.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_inherited_d402.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { railInheritance } from '../src/ui/railInheritance.js';
import { SHELLS, bucketsFor } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

// ── Zone or root ────────────────────────────────────────────────────────

test('a bucket root chooses; nothing is inherited there', () => {
  for (const role of Object.keys(SHELLS)) {
    for (const b of bucketsFor(role)) {
      assert.equal(railInheritance(role, b.prefix), null, `${role} ${b.prefix} was treated as a zone`);
      assert.equal(railInheritance(role, `${b.prefix}/`), null, `${role} ${b.prefix}/ was treated as a zone`);
    }
  }
});

test('every zone of every shell inherits from its own bucket root', () => {
  let n = 0;
  for (const role of Object.keys(SHELLS)) {
    for (const b of bucketsFor(role)) {
      for (const z of b.zones) {
        const got = railInheritance(role, `${b.prefix}/${z.slug}`);
        assert.deepEqual(got, { to: b.prefix, bucket: b.label }, `${role} ${b.prefix}/${z.slug}`);
        n += 1;
      }
    }
  }
  assert.ok(n > 40, `only ${n} zones walked — the shell config was not read`);
});

test('a detail page below a zone still inherits from the workspace root', () => {
  assert.deepEqual(railInheritance('founder', '/raise/data-room/abc'), { to: '/raise', bucket: 'Raise' });
});

test('a path no bucket claims, or a role with no shell, keeps the menu', () => {
  assert.equal(railInheritance('founder', '/studio'), null);
  assert.equal(railInheritance('founder', '/validated'), null, 'a prefix match on a longer word is not a zone');
  assert.equal(railInheritance('super_admin', '/hq/security'), null);
  assert.equal(railInheritance('admin', '/validate/interviews'), null);
  assert.equal(railInheritance(undefined, undefined), null);
});

test('the role decides which bucket a shared path belongs to', () => {
  // `/network/*` and `/research/*` are shared; each role's zone list differs,
  // but every role's root is the same path, so each inherits from it.
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const zone = bucketsFor(role).find((b) => b.prefix === '/research')?.zones[0];
    assert.ok(zone, `${role} has no research zone`);
    assert.deepEqual(railInheritance(role, `/research/${zone.slug}`), { to: '/research', bucket: 'Research' });
  }
});

// ── The rail ────────────────────────────────────────────────────────────

/** The inherited branch of the model block, from source. */
function inheritedBranch() {
  const src = codeOnly(read(RAIL));
  const from = src.indexOf('{inherited && view.pickable && (');
  assert.ok(from > 0, 'the rail has no inherited card ahead of its models');
  const to = src.indexOf('<div className="fwr-models">', from);
  assert.ok(to > from, 'the inherited card does not sit ahead of the models');
  return src.slice(from, to);
}

/** The models list itself: the cards and the compact rows. */
function modelsList() {
  const src = codeOnly(read(RAIL));
  const from = src.indexOf('<div className="fwr-models">');
  return src.slice(from, src.indexOf('</div>\n            <p className="fwr-models-note"', from));
}

test('the rail works the view out from role and URL, not from a page prop', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /const inherited = railInheritance\(role, pathname\);/);
  // No new prop: branch_rail_mount parses the parameter list, and the point is
  // that seventy pages need no edit.
  const params = src.slice(src.indexOf('export default function WorkerRail({'), src.indexOf('}) {', src.indexOf('export default function WorkerRail({')));
  assert.doesNotMatch(params, /\binherit/i, 'inheritance became a prop a page has to remember');
});

test('the inherited view offers no choice', () => {
  const branch = inheritedBranch();
  assert.doesNotMatch(branch, /<input|<button|onClick|pick\(/, 'the inherited card can still change the model');
  // And the cards and rows under it are no choice either on a zone: a card
  // takes a pick only off a zone, and the compact rows are not drawn there.
  const list = modelsList();
  assert.match(list, /onPick=\{!inherited && card\.tasks\.length \? /, 'a card picks on a zone');
  assert.match(list, /\{!inherited && view\.alternates\.map\(/, 'the compact rows are offered on a zone');
});

test('the inherited view says where the model comes from, and links there', () => {
  const branch = inheritedBranch();
  assert.match(branch, /<i className="fwr-badge fwr-badge-inherited">INHERITED<\/i>/, 'no INHERITED chip');
  assert.match(branch, /`Inherited from \$\{workspace\}\./,
    'the card must name the WORKSPACE the choice is stored under, not the zone');
  assert.match(branch, /Change it there and this page follows/);
  assert.match(branch, /<RootLink to=\{inherited\.to\}/, 'the card does not link back to the workspace root');
});

test('the inherited view shows the model that will actually run', () => {
  const src = codeOnly(read(RAIL));
  // The cards are built from the same per-section, per-task picks the bands
  // send (`railModelChoice.js`), on a zone as on the root.
  assert.match(src, /chosen: \(task\) => readRailModel\(workspace, task\)/,
    'the cards are not the stored picks');
  assert.match(modelsList(), /\{view\.cards\.map\(\(card\) => \(/, 'a zone does not draw the cards in use');
  assert.match(codeOnly(read('frontend/src/workspaces/FillProposals.jsx')), /readRailModel\(workspace, task\)/,
    'the band reads a different store, so the card and the run can disagree');
});

test('reading the path never throws outside a router', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /useLocation\(/, 'useLocation throws outside a router');
  assert.match(src, /useContext\(UNSAFE_LocationContext\)/);
});
