/**
 * D133 — "only one super admin exists" stops being a sentence and becomes a rule.
 *
 * WHAT WAS TRUE BEFORE. Migration 207's `DELETE` was a one-shot that had already
 * run; `super_admins`' only constraint is `user_id PRIMARY KEY`, which says an
 * admin holds the elevation at most ONCE, not that at most one admin holds it;
 * and `POST /admin/super-admins/:userId` counted nothing. This page said so in
 * its own words — *"One holder BY DECISION"* — and offered `'Every admin already
 * holds it'` as an empty state, a string that only makes sense if many holders
 * are expected.
 *
 * WHAT THE PAGE OWES NOW. The server refuses a second holder, so a Grant button
 * pointed at a second admin would reliably 409. A control that always errors is
 * the bare refusal D132 was written about, so with a holder present the form
 * asks for a TRANSFER — which the server does as one batch, grant and revoke
 * together, so the set is never two nor empty.
 *
 * THE PATH ASSERTION IS THE LOAD-BEARING ONE. Copy can be rewritten without the
 * request changing; `superAdminGrant` is pure and importable, so what it BUILDS
 * is checked rather than how the page describes it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/super_admin_one_holder_d133.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/hq/SuperAdminHolders.jsx'));
const API = read('frontend/src/lib/api.js');
const ROUTE = read('cloudflare-worker/src/routes/admin_super_admins.ts');

test('the grant method builds ?transfer=1 only when asked, and a bare grant without it', () => {
  // Captured from api.js rather than imported, because importing the module
  // drags in the whole request stack; the template is the whole claim here.
  const at = API.indexOf('superAdminGrant:');
  assert.ok(at > 0, 'superAdminGrant is gone — re-point this guard rather than deleting it');
  const body = API.slice(at, at + 260);
  assert.ok(body.includes("transfer ? '?transfer=1' : ''"),
    'the transfer flag no longer reaches the URL, so a handover cannot be expressed');
  assert.ok(/transfer = false/.test(body),
    'transfer defaults to true, which would silently turn every grant into a handover');
});

test('the server refuses a second holder, and names the transfer as the way through', () => {
  assert.ok(ROUTE.includes("code: 'super_admin_exists'"),
    'the one-holder ceiling is gone');
  const at = ROUTE.indexOf("code: 'super_admin_exists'");
  assert.ok(ROUTE.slice(Math.max(0, at - 700), at).includes("query('transfer')"),
    'the refusal no longer sits behind a transfer escape — the elevation would be immovable');
});

test('the page no longer calls the single holder a decision', () => {
  // It was a decision. It is a constraint now, and a page that still called it
  // a convention would be the third expired promise this programme has deleted.
  assert.ok(!/One holder by decision/i.test(PAGE),
    'the page still describes the cap as a convention');
  assert.match(PAGE, /enforced/i, 'the page does not say the cap is enforced');
});

test('the empty state stops implying that many admins hold it', () => {
  assert.ok(!/Every admin already holds it/.test(PAGE),
    'a string that only makes sense with many holders survived the cap');
});

test('with a holder the form transfers; with none it grants', () => {
  // Both verbs must be reachable from one control, or the page is honest in one
  // state and wrong in the other.
  assert.match(PAGE, /transfer: hasHolder/,
    'the form sends the same request whether or not a holder exists');
  assert.match(PAGE, /hasHolder \? 'Transfer' : 'Grant'/,
    'the button says the same word for two different acts');
  assert.match(PAGE, /const hasHolder = \(holders \|\| \[\]\)\.some/,
    'hasHolder is not derived from the holders actually loaded');
});
