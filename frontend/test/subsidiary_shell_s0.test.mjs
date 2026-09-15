/**
 * The subsidiary shell — Admin · Subsidiary S0, "the tenancy wall" (D107).
 *
 * A branch admin is `role: 'admin'` on a Worker deployed for one territory
 * (D104–D106). The shell is chosen on the DEPLOYMENT fact `/me.branch`, by
 * `shellRoleFor` — which names a sidebar and never a permission; the gates are
 * the Worker's, keyed off `BRANCH_CODE`, and no assertion here should ever be
 * read as evidence that anything is enforced in the browser.
 *
 * THE ROW/ROUTE RULE, HELD. `sidebarConfig.js` forbids a row pointing at a
 * route that does not exist, because it "looks shipped and 404s". All eight
 * canvas rows ship here and all eight resolve: the ones whose artboards are
 * not built render `BranchZonePending`, a stated notice. This test is what
 * keeps that true — a ninth row, or a row repointed at nothing, fails it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { shellRoleFor, branchOfUser } from '../src/lib/shellRole.js';
import { ACCENT } from '../src/workspaces/shellConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const APP_CODE = codeOnly(APP);

const rows = (SIDEBAR_GROUPS.branch_admin || []).flatMap((g) => g.items || []);

/** A branch admin, as `/me` describes one on a branch Worker. */
const BRANCH_USER = {
  role: 'admin',
  is_super_admin: 0,
  branch: { code: 'fr', name: 'Axal VC France', territories: ['FR', 'BE', 'LU'], status: 'active' },
};

test('the eight canvas rows, in the canvas order', () => {
  // `deepEqual` on the whole array, NOT a membership check: the canvas's order
  // is part of what it specifies, and a set comparison would pass a shell that
  // put Settings first.
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Home', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Settings'],
  );
});

test('every row points at a route that is actually registered', () => {
  const missing = rows.filter((r) => !APP.includes(`path="${r.to}"`));
  assert.deepEqual(
    missing.map((r) => `${r.label} → ${r.to}`), [],
    'a branch row whose route does not exist 404s — the pending notice is the point',
  );
});

test('the branch shell wears steel, and not another tier\'s accent', () => {
  assert.equal(ACCENT.branch_admin.ink, '#334155');
  // The one property that matters beyond the hex: it must not collide with the
  // tier above it. HQ oxblood and branch steel are the two admin shells, and
  // telling them apart at a glance is the reason each has an accent at all.
  assert.notEqual(ACCENT.branch_admin.ink, ACCENT.super_admin.ink);
  assert.notEqual(ACCENT.branch_admin.deepDark, ACCENT.super_admin.deepDark);
  // Both grounds are defined — a shell with no dark pair renders the light
  // ink on a dark ground, which is how an accent becomes unreadable.
  assert.ok(/^#[0-9a-f]{6}$/i.test(ACCENT.branch_admin.deepDark));
  assert.ok(/^#[0-9a-f]{6}$/i.test(ACCENT.branch_admin.tintDark));
});

test('shellRoleFor returns branch_admin from the branch fact, and only from it', () => {
  assert.equal(shellRoleFor('admin', BRANCH_USER), 'branch_admin');

  // An admin on HQ keeps their own shell. Both HQ shapes are checked: the
  // holder (HQ) and the plain admin.
  assert.equal(shellRoleFor('admin', { role: 'admin', is_super_admin: 1 }, true), 'super_admin');
  assert.equal(shellRoleFor('admin', { role: 'admin', is_super_admin: 0 }, true), 'admin');

  // A branch admin using View-as keeps the shell of the role being browsed —
  // the same rule that sends a viewing-as-founder holder to the founder shell.
  assert.equal(shellRoleFor('founder', BRANCH_USER), 'founder');

  // The three shapes that all mean "not a branch" and must not differ: the
  // key absent (dev FastAPI, older worker), null (HQ), and present-but-empty.
  for (const branch of [undefined, null, { code: '' }, { code: '   ' }]) {
    assert.equal(shellRoleFor('admin', { role: 'admin', is_super_admin: 0, branch }), 'admin');
    assert.equal(branchOfUser({ branch }), null);
  }
});

test('the territory badge renders from /me.branch and nothing else', () => {
  assert.ok(APP_CODE.includes('data-testid="territory-badge"'), 'the badge must exist');
  // Fed from the branch fact, and gated on it — so HQ, where `branch` is null,
  // renders no badge at all rather than an empty chip.
  assert.match(APP_CODE, /const branchFact = branchOfUser\(user\) \? user\.branch : null;/);
  assert.match(APP_CODE, /\{branchFact && \(/);
  assert.ok(APP_CODE.includes('SUBSIDIARY'), 'the badge names the tier, per the canvas');
});

test('the shell arm decides a sidebar, never access', () => {
  // The rule the whole file rests on: no guard array may name the shell.
  assert.ok(
    !/guard\(\[[^\]]*branch_admin/.test(APP_CODE),
    "'branch_admin' must not appear in a guard() array — it is a sidebar, not a permission",
  );
  // And the branch routes are guarded as admin routes, which is what they are.
  for (const r of rows) {
    assert.match(
      APP_CODE,
      new RegExp(`path="${r.to.replace(/\//g, '\\/')}"\\s+element=\\{guard\\(\\['admin'\\]`),
      `${r.to} must be guarded as an admin route`,
    );
  }
});

test('every pending zone states what it will show and which PR builds it', () => {
  // A notice with a missing prop is the "coming soon" card this component was
  // written to avoid, so each rendered instance must carry all four.
  const uses = APP_CODE.match(/<BranchZonePending[^/]*\/>/g) || [];
  assert.ok(uses.length >= 1, 'the pending notice must actually be used');
  for (const u of uses) {
    for (const prop of ['artboard=', 'title=', 'will=', 'pr=']) {
      assert.ok(u.includes(prop), `a BranchZonePending is missing ${prop}: ${u.slice(0, 80)}`);
    }
    assert.match(u, /pr="PR \d+"/, 'the notice must name a numbered PR, not "soon"');
  }
});
