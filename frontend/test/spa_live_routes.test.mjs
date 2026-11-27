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
import { readRoutesSource } from './_routesSource.mjs';

const ROOT = resolve(process.cwd());
const SMOKE = readFileSync(join(ROOT, 'scripts', 'check-spa-live.mjs'), 'utf8');
// D528 — App.jsx plus every module under frontend/src/routes/: a smoked path
// that a module declares is a real route, not the catch-all's.
const APP = readRoutesSource(ROOT);

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
 * Route patterns declared in `App.jsx` and the route modules, minus the catch-all.
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
  assert.ok(routes.length >= 100, `parsed ${routes.length} routes out of App.jsx and the route modules`);
  for (const p of paths) {
    assert.ok(routes.some((r) => matches(r, p)),
      `check-spa-live.mjs checks ${p}, which no <Route> in App.jsx or a route module declares — `
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

// D751 T9 (#1921) — `/api/health`'s `connectors_oauth` block. The verdict is
// the pure half in scripts/lib/connectorReadiness.mjs; the wiring is read out
// of the script and the workflow, for the reason smokedPaths() gives.
const { connectorReadinessVerdict, warnLine, summaryMarkdown, CONNECTOR_READINESS_PATH } =
  await import('../../scripts/lib/connectorReadiness.mjs');
const health = (connectors_oauth) => ({ status: 'ok', connectors_oauth });
const URL_ = 'https://axal.vc/api/health';

test('D751 T9: a false or null connector is one WARN line, and the run stays green', () => {
  const v = connectorReadinessVerdict(health({ github: false, slack: true, zoom: null, stripe: false }));
  assert.equal(v.ok, true);
  assert.deepEqual(v.unset, ['github', 'stripe']);
  assert.deepEqual(v.unreadable, ['zoom']);
  assert.equal(warnLine(URL_, v), `[spa-live] WARN  ${URL_} — OAuth connectors no client: github, stripe; unreadable: zoom`);
  const nullOnly = connectorReadinessVerdict(health({ slack: null }));
  assert.equal(nullOnly.ok, true);
  assert.equal(warnLine(URL_, nullOnly), `[spa-live] WARN  ${URL_} — OAuth connectors unreadable: slack`);
  assert.equal(warnLine(URL_, connectorReadinessVerdict(health({ github: true }))), null, 'nothing unset, no WARN');
});

test('D751 T9: a missing or malformed block fails, naming a key and never a value', () => {
  for (const body of [null, {}, { connectors_oauth: null }, { connectors_oauth: [] }, { connectors_oauth: 'yes' }]) {
    const v = connectorReadinessVerdict(body);
    assert.equal(v.ok, false, JSON.stringify(body));
    assert.match(v.reason, /missing/);
  }
  const leaked = connectorReadinessVerdict(health({ github: 'Iv1.fixture-client-id', slack: true }));
  assert.equal(leaked.ok, false);
  assert.match(leaked.reason, /`connectors_oauth\.github` is not true, false or null/);
  assert.ok(!leaked.reason.includes('Iv1.fixture-client-id'), 'the value is never printed');
  for (const odd of [1, 'true', {}, []]) assert.equal(connectorReadinessVerdict(health({ slack: odd })).ok, false, String(odd));
  const badKey = connectorReadinessVerdict(health({ 'GITHUB_APP_CLIENT_ID=Iv1.x': true }));
  assert.equal(badKey.ok, false);
  assert.ok(!badKey.reason.includes('GITHUB_APP_CLIENT_ID'), 'a key that is not a provider key is not echoed');
});

test('D751 T9: strict mode fails on false and on null, and passes when every client is set', () => {
  const strict = { strict: true };
  const f = connectorReadinessVerdict(health({ github: false, slack: true }), strict);
  assert.equal(f.ok, false);
  assert.equal(f.reason, 'strict mode: no client: github');
  assert.equal(connectorReadinessVerdict(health({ github: null }), strict).ok, false);
  assert.equal(connectorReadinessVerdict(health({ github: true, slack: true }), strict).ok, true);
  assert.equal(connectorReadinessVerdict(health({ github: false })).ok, true, 'not strict: a WARN only');
});

test('D751 T9: the run summary lists the same connectors, keys only', () => {
  const v = connectorReadinessVerdict(health({ github: false, zoom: null, slack: true }));
  assert.equal(summaryMarkdown(URL_, v),
    `### OAuth connectors — ${URL_}\n\n- \`github\`: no client. The fix is the owner's keys.\n- \`zoom\`: the readiness read failed.\n`);
  assert.equal(summaryMarkdown(URL_, connectorReadinessVerdict(health({ slack: true }))),
    `### OAuth connectors — ${URL_}\n\nEvery catalogue OAuth connector has a client.\n`);
  assert.equal(summaryMarkdown(URL_, connectorReadinessVerdict({})),
    `### OAuth connectors — ${URL_}\n\nFAIL: the \`connectors_oauth\` block is missing from /api/health\n`);
});

test('D751 T9: the smoke runs the check on every host, and the workflow passes strict mode in', () => {
  assert.equal(CONNECTOR_READINESS_PATH, '/api/health');
  assert.match(SMOKE, /async function checkConnectorReadiness\(base\)/);
  assert.match(SMOKE, /process\.env\.SMOKE_CONNECTORS_STRICT === '1'/);
  assert.match(SMOKE, /appendFileSync\(process\.env\.GITHUB_STEP_SUMMARY, summaryMarkdown\(/);
  const loop = SMOKE.slice(SMOKE.indexOf('for (const base of HOSTS)'));
  assert.match(loop, /await checkConnectorReadiness\(base\);[\s\S]{0,120}if \(!res\.ok\) \{[\s\S]{0,200}failures\.push/);
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'post-deploy-smoke.yml'), 'utf8');
  assert.match(wf, /connectors_strict:\n\s+description: [^\n]+\n\s+required: false\n\s+type: boolean\n\s+default: false/);
  assert.match(wf, /SMOKE_CONNECTORS_STRICT: \$\{\{ github\.event\.inputs\.connectors_strict == 'true' && '1' \|\| '' \}\}/);
});
