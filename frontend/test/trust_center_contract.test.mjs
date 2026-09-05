/**
 * The Trust Center calls routes that exist, and reads the data it fetches.
 *
 * THE SHAPE OF WHAT WAS WRONG. `scripts/api-drift-baseline.json` suppressed
 * nine `/trust/*` paths the SPA called with no worker route behind them, which
 * is why CI stayed green over them. Reading each one against
 * `routes/trust.ts`'s eighteen declared routes gave three different answers,
 * and the difference matters:
 *
 *   KybCard, AccreditationCard — UNREACHABLE, not broken-in-use. Each rendered
 *     only on the true branch of `legacy?.kyb ? …` / `legacy?.accreditation ? …`,
 *     and GET /trust/summary returns both as LITERAL NULLS with a comment
 *     saying so. Nobody could hit their 404s. Deleted, with their client
 *     methods.
 *
 *   NdaCard — REACHABLE, and broken twice over. It was fed `summary.ndas`,
 *     which is `pairwise_ndas` rows, while reading `it.role`, `it.title` and
 *     `it.signed_at` — none of which exist on that row — so it rendered blank
 *     titles, "role: undefined", and keyed React on undefined. And it signed
 *     through two routes that do not exist. Meanwhile the page was already
 *     fetching GET /trust/nda/required, which returns exactly the right
 *     thing, and THROWING THE RESULT AWAY.
 *
 * Eight baseline entries retired as a result: 22 -> 14.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/TrustCenterPage.jsx');
// The comments in this file NAME what was removed — `legacy?.kyb ? <KybCard …>`
// and the discarded `try { await api.getRequiredNdas(); } catch {}` are both
// quoted verbatim as the record of what went wrong. Assertions about absence
// have to read code, or they fail against the explanation of the fix.
const CODE = codeOnly(PAGE);
const API = read('frontend/src/lib/api.js');
const WORKER = read('cloudflare-worker/src/routes/trust.ts');
const BASELINE = JSON.parse(read('scripts/api-drift-baseline.json'));

/** Every path routes/trust.ts actually declares. */
const declared = () =>
  new Set([...WORKER.matchAll(/trust\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .map((m) => `${m[1]} ${m[2]}`));

test('no /trust path the SPA calls is banked as missing', () => {
  // NOT a reimplementation of check-api-drift.mjs. A first draft of this test
  // tried to match every client path against every declared route and drowned
  // in normalisation — `/obligation/${encodeURIComponent(key)}/start` against
  // `/obligation/:key/start` needs the real matcher, and there is one, in the
  // gate already.
  //
  // What that matcher CANNOT tell you is this: a path already banked in the
  // baseline is suppressed forever, so drift stays green while the SPA calls
  // something that 404s. This asserts the narrower, durable thing — the
  // Trust Center may not call a path the ledger records as having no route.
  // It is how `getNdaStatus` was found, with zero call sites and a banked
  // entry nobody had noticed.
  const banked = (BASELINE.missing_route || [])
    .filter((e) => e.includes('trust/'))
    .map((e) => e.replace(/^[A-Z]+\s+/, '').replace(/^\/?api\//, ''));
  const called = [...API.matchAll(/request\(`?'?\/(trust\/[A-Za-z0-9/_-]*)/g)].map((m) => m[1]);
  const overlap = called.filter((c) => banked.some((b) => b.startsWith(c) || c.startsWith(b.split(':')[0])));
  assert.deepEqual(overlap, [],
    `the SPA calls ${overlap.join(', ')}, which the drift baseline records as having no worker route`);
  assert.ok(declared().size >= 15, 'routes/trust.ts parse broke, not the code');
});

test('the six dead client methods are gone, not merely unused', () => {
  for (const m of ['getKybStatus', 'submitKyb', 'getAccreditationStatus', 'uploadAccreditation',
                   'reviewAccreditation', 'getAccreditationBadge', 'getNdaPreview', 'signNda',
                   'getNdaStatus']) {
    assert.doesNotMatch(API, new RegExp(`\\b${m}\\s*:`), `${m} still exists in api.js`);
    assert.doesNotMatch(PAGE, new RegExp(`\\bapi\\.${m}\\b`), `${m} is still called`);
  }
});

test('the retired paths left the drift baseline', () => {
  const missing = new Set(BASELINE.missing_route || []);
  for (const p of ['trust/kyb/submit', 'trust/kyb/status', 'trust/accreditation/upload',
                   'trust/accreditation/status', 'trust/nda/:p/preview', 'trust/nda/sign']) {
    const still = [...missing].some((e) => e.includes(p));
    assert.ok(!still, `${p} is still banked in the baseline — the suppression outlived its caller`);
  }
});

test('the two unreachable cards are gone, and the reason is recorded', () => {
  assert.doesNotMatch(PAGE, /function KybCard/);
  assert.doesNotMatch(PAGE, /function AccreditationCard/);
  // The premise, in the worker. If /trust/summary ever returns a real kyb
  // object, this fails and the deletion should be reconsidered.
  assert.match(WORKER, /kyb: null,\s*\n\s*accreditation: null,/,
    'GET /trust/summary no longer hardcodes these nulls — the cards were deleted on that premise');
  // And the page must not read them any more.
  assert.doesNotMatch(CODE, /legacy\?\.kyb\s*\?/);
  assert.doesNotMatch(CODE, /legacy\?\.accreditation\s*\?/);
});

test('the NDA card is fed the endpoint the page fetches, not the one it discarded', () => {
  // The bug in one line: the result was awaited and dropped on the floor.
  assert.doesNotMatch(CODE, /try \{ await api\.getRequiredNdas\(\); \} catch \{\}/,
    'getRequiredNdas is being fetched and thrown away again');
  assert.match(PAGE, /setRequiredNdas\(/);
  assert.match(PAGE, /<NdaCard items=\{requiredNdas\}/);
  // And it reads fields that exist on that payload, not on a pairwise_nda row.
  const card = CODE.slice(CODE.indexOf('function NdaCard'), CODE.indexOf('function ObligationList'));
  for (const gone of ['it.role', 'it.title', 'it.signed_at']) {
    assert.ok(!card.includes(gone), `${gone} is not a field of GET /trust/nda/required`);
  }
  assert.match(card, /it\.obligation_key/);
  assert.match(card, /it\.evidence_envelope_uuid/);
});

test('signing goes through the envelope route that exists, via the method already in use', () => {
  const card = CODE.slice(CODE.indexOf('function NdaCard'), CODE.indexOf('function ObligationList'));
  assert.match(card, /api\.trustMySigningUrl\(item\.evidence_envelope_uuid\)/);
  // That method's route is real, and the Agreements tab already relies on it.
  assert.match(WORKER, /trust\.get\('\/agreements\/:envelope_uuid\/my_signing_url'/);
  // No typed-name ceremony: the worker returns a LINK into the e-sign flow.
  assert.doesNotMatch(card, /Type your full legal name/);
  assert.match(card, /signing_url/);
});

test('accreditation states the limit instead of drawing an upload that cannot POST', () => {
  assert.match(PAGE, /Evidence upload is not available here/);
  assert.doesNotMatch(PAGE, /type="file"/, 'no file input may survive without a route to POST to');
  // The premise: no accreditation route on either side.
  assert.doesNotMatch(WORKER, /trust\.(get|post)\('\/accreditation/,
    'an accreditation route now exists — the stated limit should become a control');
});

test('the page keeps the three things the canvas has no concept of', () => {
  // Server-derived tabs, server-derived role, partial-failure resilience.
  assert.match(PAGE, /function tabsForRole\(role, obligations\)/);
  assert.match(PAGE, /const role = matrix\?\.role \|\| cachedRole/,
    'the role must come from /trust/me, with localStorage only as a first-paint fallback');
  assert.match(PAGE, /Promise\.allSettled/);
  // The canvas ships demo switchers for role and state. They must never land.
  assert.doesNotMatch(PAGE, /roleTabs|stateTabs/);
});

test('an investor does not get two h1s in one frame', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<TrustCenterPage chromeless=\{effectiveRole === 'investor'\} \/>/);
  assert.match(PAGE, /function TrustCenterPage\(\{ chromeless = false \}\)/);
  assert.match(PAGE, /\{chromeless \? <div \/> : \(/);
  // InvestorWorkspacePage is the one that draws the other heading.
  assert.match(read('frontend/src/pages/investor/InvestorWorkspacePage.jsx'), /<h1 className="investor-title"/);
});
