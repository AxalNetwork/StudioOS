/**
 * The subsidiary shell — Admin · Subsidiary S0, "the tenancy wall" (D107).
 *
 * A branch admin is `role: 'admin'` on a Worker deployed for one territory
 * (D104–D106). The shell is chosen on the DEPLOYMENT fact `/me.branch`, by
 * `shellRoleFor` — which names a sidebar and never a permission; the gates are
 * the Worker's, keyed off `BRANCH_CODE`, and no assertion here should ever be
 * read as evidence that anything is enforced in the browser.
 *
 * THE RENAME IS PARTIAL BECAUSE THE DESIGN IS. As of #238/D123 the badge chip
 * reads `BRANCH`, and that is the ONLY word that moved — measured in the canvas
 * rather than inferred from its CHANGELOG. `Admin · Subsidiary.dc.html` still
 * titles S0 "Subsidiary Admin — the tenancy wall", still passes
 * `tier="subsidiary"` to `AdminRail` at fourteen call sites, and still says
 * "a subsidiary cannot see" in its own prose. So the file names, the role key
 * `branch_admin`, the `/branch/*` routes and every comment below stay as they
 * are: finishing the rename here would make the repo disagree with the export
 * it exists to mirror. (Unrelated and NOT part of any rename: "Subsidiary
 * Spin-Out" in `LegalCapitalPage.jsx` and `legalcap.ts` is a founder
 * incorporating a subsidiary company — a different noun that shares a spelling.)
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

test('the eight rows, Studio first, then the canvas order', () => {
  // `deepEqual` on the whole array, NOT a membership check: order is part of
  // what the shell specifies, and a set comparison would pass a shell that
  // put Settings first.
  //
  // THE FIRST LABEL IS THE PRODUCT OVERRIDE. The canvas still titles S0's
  // first row Home and points it at the digest. The admin profile's front
  // door is Studio at `/studio` — Eadwyn, then one card per other page — so
  // a revert to Home `/branch` is the old console coming back.
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Studio', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Settings'],
  );
  assert.equal(rows[0].to, '/studio');
  assert.ok(!rows.some((r) => r.to === '/branch'), 'the digest is not a sidebar row');
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

  // The tier word, BOUNDED TO THE BADGE'S OWN ELEMENT.
  //
  // This was `APP_CODE.includes('SUBSIDIARY')` — a whole-file scan, which was
  // a real guard only by luck: `SUBSIDIARY` happened to appear nowhere else in
  // App.jsx. `BRANCH` does. `codeOnly` leaves JSX comments in place, and one of
  // them reads "THE ROOT BRANCHES TOO" (the `/research` note), so the same
  // assertion renamed word-for-word would have passed with the badge deleted
  // entirely. An assertion that cannot fail on the bug it was written for is
  // decoration, so the scan is bounded to the span it is about.
  const badgeAt = APP_CODE.indexOf('data-testid="territory-badge"');
  const badge = APP_CODE.slice(badgeAt, APP_CODE.indexOf('</span>', badgeAt));
  assert.match(badge, /\{' · BRANCH'\}/, 'the badge names the tier, per the canvas');
  // And it is the word the canvas now uses. `Admin · Subsidiary.dc.html` changed
  // exactly one byte across S0–S6 (#238/D123) and this is it — so a revert here
  // would put the shell back out of step with its own design source.
  assert.ok(!badge.includes('SUBSIDIARY'), 'the badge still carries the retired word');
});

test('the shell arm decides a sidebar, never access', () => {
  // The rule the whole file rests on: no guard array may name the shell.
  assert.ok(
    !/guard\(\[[^\]]*branch_admin/.test(APP_CODE),
    "'branch_admin' must not appear in a guard() array — it is a sidebar, not a permission",
  );
  // And the branch routes are guarded as admin routes, which is what they are.
  //
  // NO REGEX IS BUILT FROM THE ROUTE. This compared `APP_CODE` against a
  // pattern assembled from `r.to` with `/` escaped — which CodeQL flagged as
  // incomplete escaping, and which was worse than that: `/` is only special
  // in a regex LITERAL, never in `new RegExp()`, so the one character being
  // escaped needed no escaping while every character that would actually
  // change the pattern went through untouched. A correct escaper would have
  // silenced the alert and left a regex assembled from data for no benefit.
  // The route is a literal string, so it is compared as one.
  for (const r of rows) {
    const at = APP_CODE.indexOf(`path="${r.to}"`);
    assert.ok(at > 0, `${r.to} must be a registered route`);
    // Bounded to this route's own element so the assertion cannot be satisfied
    // by a NEIGHBOURING route's guard — the one failure mode a substring scan
    // has, and the reason the window is 80 rather than open-ended.
    const window = APP_CODE.slice(at, at + (r.to === '/studio' ? 200 : 80));
    // `/studio` is the shared studio route. Its guard is `labRoles(['admin', …])`,
    // which includes admin, rather than the branch-only `guard(['admin'])`.
    const guarded = r.to === '/studio'
      ? window.includes("guard(labRoles(['admin'")
      : window.includes("guard(['admin']");
    assert.ok(guarded, `${r.to} must be guarded as an admin route`);
  }
});

test('no branch row renders a pending notice, because every branch artboard is built', () => {
  // WAS "every pending zone states what it will show and which PR builds it",
  // asserting `uses.length >= 1` — the scaffolding had to EXIST. D155 built
  // S11 Settings, the last branch route rendering one, so that assertion began
  // failing on the day its own job was finished: the inverse of the stale
  // refusal this programme keeps re-aiming, and the same lesson from the other
  // side. A guard tied to an interim arrangement has to be re-aimed when the
  // interim ends.
  //
  // `BranchZonePending` is DELETED rather than left unused — a component named
  // Pending with nothing pending is the stale artefact D129 and D131 deleted
  // in their own areas — and what is pinned now is the stronger property it
  // existed to approach: every row in the branch sidebar resolves to a real
  // page, so none of them can 404 and none needs a notice standing in.
  assert.ok(!APP_CODE.includes('BranchZonePending'),
    'a pending notice came back — if a branch artboard is genuinely unbuilt, say so on its own page');
  const rows = (SIDEBAR_GROUPS.branch_admin || []).flatMap((g) => g.items || []);
  assert.ok(rows.length >= 8, `expected the canvas's eight branch rows, found ${rows.length}`);
  for (const r of rows) {
    const line = APP_CODE.split('\n').find((l) => l.includes(`path="${r.to}"`));
    assert.ok(line, `${r.to} is a sidebar row with no route`);
    assert.doesNotMatch(line, /Pending/, `${r.to} still renders a placeholder`);
  }
});
