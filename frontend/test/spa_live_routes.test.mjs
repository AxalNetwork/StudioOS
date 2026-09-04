/**
 * EVERY PATH THE LIVE SMOKE ASSERTS IS A REAL ROUTE.
 *
 * `scripts/check-spa-live.mjs` fetches a list of paths off the production
 * hosts and requires each to come back as the SPA shell with its security
 * headers. That check is only as good as its list, and the list is a hand-kept
 * array of string literals in a script no test has ever read.
 *
 * The failure this guards is quiet in both directions. A zone slug renamed in
 * `App.jsx` leaves the smoke asserting a path that no longer exists — and
 * because `App.jsx` ends in a catch-all `*` route, that dead path still
 * answers 200 with the shell and its headers, so the smoke goes on passing
 * while checking the 404 page. The reverse is the same shape: a path typed
 * with a wrong segment here was never testing what its comment said it was.
 *
 * So the catch-all is excluded below. Matching a smoked path against `*` is
 * exactly the outcome this file exists to fail on: "the app renders something"
 * is not "the app renders this".
 *
 * This is NOT a substitute for the live run. It proves the list names real
 * routes; only the live run proves the deployed build serves them. It exists
 * because the list can be checked from anywhere and the live run cannot — a
 * sandbox whose egress policy does not admit `axal.vc` gets a proxy 403 on
 * every route, which the script reports as a site-wide production failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SMOKE = readFileSync(join(ROOT, 'scripts', 'check-spa-live.mjs'), 'utf8');
const APP = readFileSync(join(ROOT, 'frontend', 'src', 'App.jsx'), 'utf8');

/**
 * The paths the smoke script checks.
 *
 * Read out of the source rather than by importing the module: the script runs
 * its whole check at import time and calls `process.exit`, so importing it
 * from a test would end the test run rather than return a list.
 *
 * Both literal forms are taken. The one template literal in the array
 * (`/articles/${encodeURIComponent(SLUG)}`) is reduced to a placeholder
 * segment — its interpolation is a slug, and what is being checked is the
 * SHAPE of the path, which a slug cannot change.
 */
function smokedPaths() {
  const paths = [];
  for (const m of SMOKE.matchAll(/\{\s*path:\s*'([^']+)'/g)) paths.push(m[1]);
  for (const m of SMOKE.matchAll(/\{\s*path:\s*`([^`]+)`/g)) {
    paths.push(m[1].replace(/\$\{[^}]*\}/g, 'placeholder'));
  }
  return paths;
}

/**
 * Route patterns declared in `App.jsx`, minus the catch-all.
 *
 * `*` is dropped for the reason in the header. `/auth/recover/*` and
 * `/docs/admin/*` are kept: a prefixed wildcard still asserts its prefix, so
 * matching one means the path reached the route its author intended.
 */
function declaredRoutes() {
  return [...APP.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
}

/** react-router matching, restricted to the two forms this app declares. */
function matches(pattern, path) {
  const pat = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  if (pat[pat.length - 1] === '*') {
    // A prefixed wildcard matches its prefix plus anything under it.
    return pat.length - 1 <= got.length
      && pat.slice(0, -1).every((seg, i) => seg.startsWith(':') || seg === got[i]);
  }
  if (pat.length !== got.length) return false;
  return pat.every((seg, i) => seg.startsWith(':') || seg === got[i]);
}

test('every smoked path resolves to a declared route, not the catch-all', () => {
  const routes = declaredRoutes();
  const paths = smokedPaths();
  // A parse that silently returned nothing would make every assertion below
  // vacuous, which is the one way a guard like this fails without saying so.
  assert.ok(paths.length >= 10, `parsed ${paths.length} paths out of the smoke script`);
  assert.ok(routes.length >= 100, `parsed ${routes.length} routes out of App.jsx`);
  for (const p of paths) {
    assert.ok(routes.some((r) => matches(r, p)),
      `check-spa-live.mjs checks ${p}, which no <Route> in App.jsx declares — `
      + 'it would be answered by the catch-all and pass while testing nothing');
  }
});

test('the nine partner zones and the public consent page are among them', () => {
  // Named rather than counted. #431 added these ten on 2026-09-04 and the
  // reason they are in the smoke list is that they were the newest deep links
  // in the product; a later edit that drops one should fail against the ZONE
  // it covered, not against a number that can be made to add up again.
  const paths = new Set(smokedPaths());
  for (const p of [
    '/pipeline/negotiations', '/pipeline/retainers',
    '/delivery/health', '/delivery/deliverables', '/delivery/capacity',
    '/delivery/status-reports',
    '/offers/visibility', '/offers/proof', '/offers/audience-fit',
  ]) {
    assert.ok(paths.has(p), `${p} is no longer live-smoked`);
  }
  const attest = [...paths].filter((p) => p.startsWith('/attest/partner/'));
  assert.equal(attest.length, 1,
    'the public partner consent page must stay smoked — it is reached by people '
    + 'with no account, who cannot log in to work around a broken shell');
});

test('the smoke list only claims what an unauthenticated fetch can show', () => {
  // The partner zones all read `/api/partner/*` behind `requireAuth`, so the
  // shell comes back whether or not the zone can render a row. The script has
  // no session and must not be described as though it did.
  const block = SMOKE.slice(SMOKE.indexOf('/pipeline/negotiations') - 2000,
    SMOKE.indexOf('/pipeline/negotiations'));
  assert.match(block, /does NOT prove/,
    'the partner block in check-spa-live.mjs must keep saying what it does not prove');
});
