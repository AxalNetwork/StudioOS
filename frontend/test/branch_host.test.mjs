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

import { branchCodeFromHost, csrfCookieNameFor, appOrigin } from '../src/lib/branchHost.js';
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

test('appOrigin is the host actually serving the page, with the apex only as an SSR fallback', () => {
  const real = globalThis.window;
  try {
    globalThis.window = undefined;
    assert.equal(appOrigin(), 'https://axal.vc', 'no window (prerender, test) falls back to the apex');

    globalThis.window = { location: { origin: 'https://axal.vc' } };
    assert.equal(appOrigin(), 'https://axal.vc');

    globalThis.window = { location: { origin: 'https://fr.axal.vc' } };
    assert.equal(appOrigin(), 'https://fr.axal.vc', 'a branch page must build links into itself');

    // A window without a usable location — jsdom fragments, some embed
    // contexts — must not produce `undefined/referrals`, which would render
    // as a broken link rather than as a wrong one.
    //
    // BOTH SHAPES, and the second is the one that earns its place. `window`
    // with no `location` at all falls through to the fallback whether the
    // guard reads `window.location` or `window.location?.origin`, so it
    // cannot tell a correct guard from a careless one: dropping the optional
    // chain survived a mutation run against a fixture that only had this
    // case. `{ location: {} }` is where they diverge — the careless guard
    // returns `undefined` and every link built from it is broken.
    globalThis.window = {};
    assert.equal(appOrigin(), 'https://axal.vc');

    globalThis.window = { location: {} };
    assert.equal(appOrigin(), 'https://axal.vc', 'a location with no origin must still fall back');

    globalThis.window = { location: { origin: '' } };
    assert.equal(appOrigin(), 'https://axal.vc', 'an empty origin is not an origin');
  } finally {
    globalThis.window = real;
  }
});

test('no user-facing link is still built from the hardcoded apex (D106, L9)', () => {
  // The referral case is why this is a guard and not a one-time edit: a
  // branch member sharing `https://axal.vc/register?ref=…` sends the referee
  // to HQ, where they REGISTER IN HQ'S DATABASE and the reward is attributed
  // against a member who is not there. Re-typing the literal is the easy
  // regression, so the files that carry these links are scanned for it.
  const files = [
    'frontend/src/pages/ReferralsPage.jsx',
    'frontend/src/pages/SettingsPage.jsx',
    'frontend/src/pages/ArticleAuthorPage.jsx',
    'frontend/src/pages/admin/AdminTeam.jsx',
  ];
  for (const f of files) {
    const src = codeOnly(readFileSync(resolve(process.cwd(), f), 'utf8'));
    assert.ok(
      !src.includes('https://axal.vc'),
      `${f} must build shareable links from appOrigin(), not from the apex literal`,
    );
    assert.ok(src.includes('appOrigin('), `${f} must call appOrigin()`);
  }

  // THE OTHER DIRECTION, and it is not an oversight. `SITE_URL` in
  // ogRegistry.js stays the apex: canonical tags, OG URLs and the sitemap are
  // statements about where the canonical document lives, which is HQ — and a
  // branch answers `X-Robots-Tag: noindex` precisely so the duplicate is
  // never indexed. A sweep that "fixed" this one too would point every
  // branch's canonical at itself and create the duplicate the header avoids.
  const og = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/lib/ogRegistry.js'), 'utf8'));
  assert.ok(og.includes("SITE_URL = 'https://axal.vc'"), 'the canonical site URL must stay the apex');
});
