/**
 * THE SIGN-IN CARD MAY NOT NAME A METHOD IT IS NOT OFFERING.
 *
 * On 2026-09-12 the user reported that Continue with Google had "disappeared"
 * from /login. It had not been removed — `/api/auth/google/start` was hanging,
 * the mount-time probe never resolved, and the button is rendered only when the
 * probe succeeds. Above it, unconditionally, the card still read "Google,
 * passkey, and authenticator codes are also available."
 *
 * That is D56/D68 in its user-facing form: a promise with no control under it.
 * It is worse than a blank space, because a blank space makes someone look for
 * another way in, and a promise makes them look for a button that is not there.
 * The same sentence also promised a passkey on every browser without WebAuthn.
 *
 * So: the sentence is DERIVED from the conditions that render the controls, and
 * a method that is not on offer leaves a stated absence in its place. This file
 * fails if either property is lost. It reads the page rather than remembering
 * it, and it reads only code — `codeOnly` — because the comment explaining the
 * fix necessarily quotes the sentence being banned.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/login_offers_what_it_names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

/**
 * The words a READER sees in a JSX block — tags and their attributes removed.
 *
 * Asserting over raw JSX is a trap this file fell into: `data-testid=
 * "login-google-unavailable"` satisfies a `/unavailable/i` match, so the word
 * could be deleted from the sentence a person actually reads and the assertion
 * would still pass. A mutation proved it. An attribute is not copy.
 */
function visibleText(jsx) {
  return jsx.replace(/<[^>]*>/g, ' ').replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
}

const PAGE = path.resolve(import.meta.dirname, '../src/pages/LoginPage.jsx');
const raw = readFileSync(PAGE, 'utf8');
const src = codeOnly(raw);

test('the card does not carry a hard-coded list of sign-in methods', () => {
  // The exact sentence that outlived its buttons. Banned as a literal: it can
  // only be true by accident, because nothing keeps it in step with the JSX.
  assert.ok(
    !/Google, passkey, and authenticator codes are also available/.test(src),
    'the blurb is hard-coded again — derive it from the same conditions that '
    + 'render the controls, or it will promise a button that is not there',
  );
});

test('the blurb is derived from the live methods, and the derivation is the one rendered', () => {
  assert.match(src, /alsoAvailable/, 'expected a derived list of available methods');
  // Each entry must sit behind the SAME condition as its control. A derivation
  // that hard-codes 'Google' into the list is the original bug with extra steps.
  const decl = src.slice(src.indexOf('const alsoList'), src.indexOf('const alsoAvailable'));
  assert.ok(decl.length > 0, 'could not find the alsoList derivation');
  // 2026-09-21: Google moved from conditional to UNCONDITIONAL, so naming it is
  // true by construction rather than by a probe agreeing. The property this file
  // exists for — never name a method that is not offered — is unchanged and now
  // holds more strongly: the sentence and the control are both unconditional.
  assert.match(decl, /^\s*'Google',\s*$/m, "'Google' is always offered, so it is always named");
  assert.match(decl, /passkeySupported/, "'passkey' must be named only when the browser supports one");
  // ...and the sentence must actually consume it.
  assert.match(src, /\{`? ?\$\{alsoAvailable\}/, 'the rendered sentence must interpolate alsoAvailable');
});

test('there is NO pre-flight probe — the Google button is never gated on one', () => {
  // THE DEFECT THIS FILE NOW OWNS. Until 2026-09-21 this page called
  // /api/auth/google/start on mount and rendered the button only if that call
  // resolved. Four unrelated things made it fail — the endpoint is rate-limited
  // (not in RATE_LIMIT_EXEMPT, D74, and the `global` bucket is platform-wide),
  // the probe carried a 6s deadline a phone trips, /start does a KV write and
  // sets a cookie so it was never a safe health check, and it blocked the page
  // on a round-trip. Measured that day: Google was configured and working (22 of
  // 49 accounts linked, newest 2026-09-17) while the card said it was
  // unavailable and the owner could not sign in.
  //
  // A capability is not predicted here. The click asks, and the server answers.
  assert.ok(!/googleProbe/.test(src), 'the probe state is back');
  assert.ok(!/googleAvailable/.test(src), 'the two-state probe flag is back');
  assert.ok(!/GOOGLE_PROBE_TIMEOUT_MS/.test(src), 'the probe deadline is back');

  // The one that matters, and the one a state-name check would miss: the page
  // must reach /auth/google/start ONLY from the click handler. Any other call
  // site is a pre-flight by another name, whatever it is called.
  const calls = [...src.matchAll(/api\.googleStartUrl\s*\(/g)].map((m) => m.index);
  assert.equal(calls.length, 1, `expected exactly one googleStartUrl call site, found ${calls.length}`);
  const handlerAt = src.indexOf('const continueWithGoogle');
  assert.ok(handlerAt > 0, 'continueWithGoogle is gone');
  const handlerEnd = src.indexOf('\n  };', handlerAt);
  assert.ok(
    calls[0] > handlerAt && calls[0] < handlerEnd,
    'googleStartUrl is called outside continueWithGoogle — that is a pre-flight probe',
  );

  // And no effect may exist whose body reaches for it.
  assert.ok(
    !/useEffect\([^)]*\)\s*=>\s*\{[^}]*googleStartUrl/s.test(src),
    'an effect calls googleStartUrl — the probe is back in another shape',
  );
});

test('the Google button is rendered unconditionally', () => {
  // Not behind `googleProbe === 'yes'`, not behind any other flag. A button that
  // might fail is strictly better than one that is missing: the missing one
  // leaves the person no path in and nothing to retry.
  const at = src.indexOf('data-testid="login-google"');
  assert.ok(at > 0, 'the Google button lost its testid, or the button is gone');
  // The window must be scanned WHOLE, not just at its end: a mutation that put
  // `{googleBusy === false && (` in front of the button left the last characters
  // before it unchanged, so an end-anchored check walked straight past it.
  // Everything between the previous sibling and the button is a divider and a
  // comment, so ANY conditional opener in that span is the regression.
  const prevSibling = src.lastIndexOf(')}', at);
  const before = src.slice(prevSibling < 0 ? Math.max(0, at - 700) : prevSibling, at);
  // Ban BOTH conditional operators outright. A shape-specific check is not
  // enough: `?\s*\(` was written for `cond ? (` and `{googleBusy ? null : (`
  // walked straight past it. The real span between the previous sibling and the
  // button is a divider and a comment — it contains no `&&` and no `?` — so any
  // occurrence of either is a gate, whatever form it takes.
  assert.ok(!/&&/.test(before), 'the Google button sits behind a `&&` conditional again');
  assert.ok(!/\?/.test(before), 'the Google button sits behind a ternary again');
  assert.match(src.slice(at - 400, at + 400), /onClick=\{continueWithGoogle\}/);
  // The card the probe used to paint is gone with it.
  assert.ok(
    !/login-google-unavailable/.test(src),
    'the probe-painted "unavailable" card is back; the absence belongs at click time',
  );
});

test('a server that genuinely refuses Google still says so — at click time', () => {
  // The honesty rule is kept and MOVED, not dropped. /start answers 503
  // `not_configured` when GOOGLE_AUTH_CLIENT_ID/SECRET are unset; the click
  // handler surfaces the server's own message, and the copy map carries the
  // sentence. That is a stated absence from the server rather than one guessed
  // on mount by a request that fails for four other reasons.
  assert.match(src, /GOOGLE_ERROR_COPY/, 'the callback error copy map is gone');
  const map = src.slice(src.indexOf('const GOOGLE_ERROR_COPY'));
  assert.match(map.slice(0, 900), /not_configured:/, 'no copy for a genuine 503');
  const click = src.slice(src.indexOf('const continueWithGoogle'));
  const body = click.slice(0, click.indexOf('\n  };'));
  assert.match(body, /catch/, 'the click must catch a refusal');
  // Scoped to the CATCH. `setError('')` at the top of the handler clears the
  // previous error and satisfied a body-wide match, so the reporting line could
  // be deleted outright and this still passed — a mutation proved it.
  const catchBody = body.slice(body.indexOf('catch'));
  assert.match(
    catchBody, /setError\(/,
    'a refused click must put the server\'s reason on screen, from the catch',
  );
});

test('the list reads as English at every length', () => {
  // Two items take "a and b"; three take the serial comma. A single join for
  // both produced "passkey, and authenticator codes", which rendering caught and
  // no source assertion would have.
  const decl = src.slice(src.indexOf('const joined'), src.indexOf('const alsoAvailable'));
  assert.match(decl, /alsoList\.length > 2/, 'the serial comma must be conditional on three items');
  assert.match(decl, /join\(' and '\)/, 'two items must join with a bare "and"');
  // The list opens a sentence, so its first letter is capitalised — otherwise
  // dropping Google leaves ". passkey and authenticator codes".
  assert.match(src, /charAt\(0\)\.toUpperCase\(\)/, 'the list opens a sentence and must be capitalised');
});

test('the collapsed toggle does not name a passkey the browser cannot offer', () => {
  assert.match(src, /altFactorsLabel/, 'the toggle label must be derived too');
  const decl = src.slice(src.indexOf('const altFactorsLabel'));
  assert.match(decl.slice(0, 200), /passkeySupported \?/);
});

test('/magic/verify’s limiter-unavailable code has copy, and it does not blame the user', () => {
  // routes/auth.ts redirects with ?magic_error=limiter when the rate-limit store
  // could not be consulted. Without an entry here the user gets the generic
  // "that link could not be used", which points at the link — the one thing
  // that was fine.
  const map = src.slice(src.indexOf('const MAGIC_ERROR_COPY'), src.indexOf('// Honor a `?next=`'));
  assert.match(map, /\blimiter:/, 'MAGIC_ERROR_COPY has no `limiter` line');
  const line = map.slice(map.indexOf('limiter:'));
  const copy = line.slice(0, line.indexOf('\n', 1) + 1);
  assert.ok(
    !/wait/i.test(copy),
    'telling someone to wait is advice that never comes true when the limiter '
    + 'is the thing that is down',
  );
  assert.match(copy, /our side/i, 'say whose problem it is');
});

test('the worker still emits the code this page renders', () => {
  // The two halves are in different packages; nothing else would notice if one
  // of them was renamed.
  const worker = readFileSync(
    path.resolve(import.meta.dirname, '../../cloudflare-worker/src/routes/auth.ts'), 'utf8',
  );
  assert.match(worker, /fail\('limiter'\)/, "routes/auth.ts no longer returns the 'limiter' code");
});
