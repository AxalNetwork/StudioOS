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

// ===========================================================================
// Severity tones. The restyle's real content is not the colours — it is that
// the map is COMPLETE against the vocabulary the WORKER writes, and stays so.

test('every status the WORKER writes has a tone', () => {
  // The defect this replaces: STATUS_PILL enumerated eleven statuses while
  // pairwise_ndas carries `active`, `revoked` and `cancelled` (trust.ts
  // branches on the first two by name). All three fell through to the
  // `unverified` grey, so a live NDA and a revoked one drew identically.
  //
  // Enumerating tones instead of classes does not fix that on its own — the
  // canvas this came from has the same hole. Parsing the WORKER is what fixes
  // it, so this test reads trust.ts rather than trusting either list.
  const written = new Set();
  // `status = 'x'` (SQL SET), `status: 'x'` (JSON out), `status === 'x'` (branch)
  for (const m of WORKER.matchAll(/status\s*(?:=|:|===|!==)\s*'([a-z_]+)'/g)) written.add(m[1]);
  assert.ok(written.size >= 5, `parsed only ${written.size} statuses out of trust.ts`);

  const block = PAGE.slice(
    PAGE.indexOf('const STATUS_TONE = {'),
    PAGE.indexOf('};', PAGE.indexOf('const STATUS_TONE = {')),
  );
  assert.ok(block.length > 100, 'could not read STATUS_TONE');
  const mapped = new Set([...block.matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1]));

  // Statuses that belong to other objects entirely and never reach a pill.
  // Each is named so adding to this list is a decision, not a shrug.
  const NOT_A_PILL = new Set([
    'already_active',   // POST /nda/request idempotency reply, not a row status
    'envelope_issued',  // ditto — the shape of a response, not of a record
  ]);

  const unmapped = [...written].filter(s => !mapped.has(s) && !NOT_A_PILL.has(s));
  assert.deepEqual(unmapped, [],
    `trust.ts writes ${unmapped.join(', ')} and STATUS_TONE has no tone for it — it would render as neutral grey`);
});

test('the three statuses that used to render grey now read correctly', () => {
  // Pinned by name because these are the ones the old map missed, and the
  // failure was invisible: grey is a plausible colour for anything.
  const block = PAGE.slice(
    PAGE.indexOf('const STATUS_TONE = {'),
    PAGE.indexOf('};', PAGE.indexOf('const STATUS_TONE = {')),
  );
  // Parsed once with a literal pattern rather than a regex built per key:
  // Semgrep flags `new RegExp` on an interpolated value (detect-non-literal-regexp)
  // and it is right to, even here where the three keys are literals in this file.
  // Reading the map into a lookup is also the clearer thing to do.
  const tones = Object.fromEntries(
    [...block.matchAll(/^ {2}([a-z_]+):\s*'([a-z]+)'/gm)].map((m) => [m[1], m[2]]),
  );
  assert.ok(Object.keys(tones).length >= 10, 'STATUS_TONE parsed to almost nothing');
  const toneOf = (k) => tones[k];
  assert.equal(toneOf('active'), 'ok', 'an in-force NDA must not read as neutral');
  assert.equal(toneOf('revoked'), 'bad', 'a revoked NDA must not read as neutral');
  assert.equal(toneOf('cancelled'), 'bad', 'a cancelled NDA must not read as neutral');
});

test('waived reads the same way the score counts it', () => {
  // computeTrustScore counts waived alongside satisfied. A neutral pill beside
  // a green score said two things about one row.
  const badge = read('frontend/src/components/TrustScoreBadge.jsx');
  assert.match(badge, /o\.status === 'satisfied' \|\| o\.status === 'waived'/,
    'the score no longer counts waived — recheck its tone');
  const block = PAGE.slice(
    PAGE.indexOf('const STATUS_TONE = {'),
    PAGE.indexOf('};', PAGE.indexOf('const STATUS_TONE = {')),
  );
  assert.match(block, /^\s{2}waived:\s+'ok',/m);
});

test('the client score formula still mirrors the WORKER, and the PAGE does not invent a third', () => {
  // The canvas proposed partial credit for in-review plus a per-gate penalty.
  // Shipping it would have put /trust at odds with GET /trust/score/:userId
  // AND with the same badge on /account.
  assert.match(WORKER, /Math\.round\(\(satisfied \/ required\.length\) \* 100\)/);
  const badge = read('frontend/src/components/TrustScoreBadge.jsx');
  assert.match(badge, /Math\.round\(\(satisfied \/ required\.length\) \* 100\)/);
  // The PAGE consumes the shared helper and defines no rival.
  assert.match(PAGE, /computeTrustScore\(obligations\)/);
  assert.doesNotMatch(CODE, /reqGates|weightOf|PREV_SCORE|scoreDelta/,
    'the canvas score model landed — it disagrees with the server');
});

test('expiry is rendered as a state, not a bare date', () => {
  // `expires 3/14/2027` reads identically whether it is two years out or
  // lapsed last month, which is how an expired obligation sat in the list
  // looking ordinary.
  assert.match(PAGE, /function expiryNote\(iso, now = new Date\(\)\)/);
  assert.match(PAGE, /Expired \$\{n\} \$\{n === 1 \? 'day' : 'days'\} ago/);
  assert.match(PAGE, /Expires in \$\{days\}/);
  // and it is actually used on both row types
  assert.match(PAGE, /const exp = expiryNote\(o\.expires_at\)/);
  assert.match(PAGE, /const validExp = expiryNote\(a\.valid_until\)/);
});

test('the counts describe the list, they do not re-score it', () => {
  const fn = PAGE.slice(PAGE.indexOf('function ToneCounts'), PAGE.indexOf('function ObligationList'));
  assert.ok(fn.length > 200, 'could not read ToneCounts');
  // Counted from the same array the rows render — no second fetch, no second source.
  assert.match(fn, /for \(const o of obligations\) n\[toneOf\(o\.status\)\] \+= 1;/);
  assert.doesNotMatch(fn, /api\./, 'ToneCounts must not fetch');
  // A zero is omitted, not drawn: "0 blocked" reads as an achievement.
  assert.match(fn, /\.filter\(\(\[, c\]\) => c > 0\)/);
});

test('the canvas demo switchers did not land', () => {
  // roleTabs/stateTabs let the canvas flip role and completeness by hand. The
  // real role comes from /trust/me; the real state comes from the matrix.
  const code = CODE;
  assert.doesNotMatch(code, /roleTabs|stateTabs/);
  assert.doesNotMatch(code, /Guillaume Lauzier|Novacraft|Marisol Vega|AX-1183|Halverton/,
    'canvas fixture data landed in the PAGE');
  assert.doesNotMatch(code, /'83b'|83\(b\)/,
    "the canvas's 83b key is not an ObligationKey");
});
