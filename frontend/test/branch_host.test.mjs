/**
 * The SPA's half of D104: which CSRF cookie a page mirrors is decided by its
 * hostname, and it must be the same decision the Worker makes from
 * `BRANCH_CODE` (`cloudflare-worker/src/util/branch.ts`).
 *
 * The source-scan test is the one that matters long-term. `getCsrfHeader` in
 * api.js used to compare against the literal `'studioos_csrf'`; on a branch
 * host that literal is HQ's cookie, still sent by the browser, and mirroring
 * it fails every branch write with a 403 that looks like a CSRF attack. If
 * someone "simplifies" the lookup back to the literal, this fails.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_host.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { branchCodeFromHost, csrfCookieNameFor } from '../src/lib/branchHost.js';
import { codeOnly } from './_codeOnly.mjs';

test('a single label before axal.vc is a branch; the apex, app, www, dev and preview hosts are not', () => {
  assert.equal(branchCodeFromHost('fr.axal.vc'), 'fr');
  assert.equal(branchCodeFromHost('DACH.axal.vc'), 'dach', 'hostnames are case-insensitive');
  assert.equal(branchCodeFromHost('dubai-2.axal.vc'), 'dubai-2');
  // THE DEEPER HOSTS ARE THE ASSERTION THAT MATTERS. Dropping the regex's
  // `^` anchor survived a mutation run against the first version of this
  // list, because every deeper host in it had single-letter labels the rule
  // rejects anyway. `evil.fr.axal.vc` is the case that catches it: an
  // unanchored rule reads it as the branch `fr`, and a page on a host we do
  // not serve would mirror a branch's cookie.
  for (const host of ['axal.vc', 'app.axal.vc', 'www.axal.vc', 'localhost', '127.0.0.1',
    'studioos-pr-511.guillaumelauzier.workers.dev', 'fr.axal.vc.evil.com', 'a.b.axal.vc',
    'evil.fr.axal.vc', 'x.dach.axal.vc', '', undefined]) {
    assert.equal(branchCodeFromHost(host), null, `${host} must not read as a branch`);
  }
});

test('the cookie name carries the branch code, and only there', () => {
  assert.equal(csrfCookieNameFor('axal.vc'), 'studioos_csrf');
  assert.equal(csrfCookieNameFor('app.axal.vc'), 'studioos_csrf');
  assert.equal(csrfCookieNameFor('fr.axal.vc'), 'studioos_csrf_fr');
});

test('api.js mirrors the hostname-derived cookie, never the literal', () => {
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8'));
  const fn = src.slice(src.indexOf('function getCsrfHeader('), src.indexOf('function getCsrfHeader(') + 1200);
  assert.ok(fn.includes('csrfCookieNameFor('), 'getCsrfHeader must ask branchHost.js for the cookie name');
  assert.ok(!fn.includes("'studioos_csrf'"), 'the literal cookie name is HQ\'s; on a branch host it is the wrong cookie');
  assert.ok(src.includes("from './branchHost'"), 'api.js must import the helper rather than re-derive the rule');
});
