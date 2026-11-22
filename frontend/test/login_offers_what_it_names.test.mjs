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

test('every method the page names is a control rendered under the same condition (#6958)', () => {
  // Sign In v2 (D6956) removed the sentence: the first view shows the three
  // buttons themselves, and the Email chooser shows one row per method. The
  // promise and the control are now the same element, so they cannot drift.
  assert.ok(!/alsoAvailable/.test(src), 'a separate sentence naming methods is back');
  // The passkey row is offered only where the browser has WebAuthn...
  const chooser = src.slice(src.indexOf("(step === 'email') {"), src.indexOf("(step === 'link') {"));
  const pk = chooser.indexOf('Use a passkey');
  assert.ok(pk > 0, 'the passkey row is gone');
  assert.match(chooser.slice(Math.max(0, pk - 400), pk), /\{passkeySupported && \(/, "the passkey row must sit behind passkeySupported");
  // ...and the other two rows are always there, because their methods always are.
  for (const row of ['Email me a sign-in link', 'Use an authenticator code']) {
    const at = chooser.indexOf(row);
    assert.ok(at > 0, `${row} is gone`);
  }
  // Apple is named only by its button, which renders only once configured.
  const first = src.slice(src.lastIndexOf('} else {\n    body = ('));
  assert.match(first, /\{appleConfigured && \(/);
  assert.equal((src.match(/Continue with Apple/g) || []).length, 1, 'Apple is named outside its button');
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

test('#6959: Resend on "Check your email" can send — it is not gated on a Turnstile widget that step does not mount', () => {
  // The sent step offers "Resend link". Turnstile mounts only with the link and code forms, and the step change and
  // the widget's unmount both clear the token, so a check on the token outside the link step left Resend saying
  // "Please complete the verification challenge first." with no challenge anywhere on screen (found by #6959's
  // browser run). The control the page names must be one that works.
  const send = src.slice(src.indexOf('const sendMagicLink'), src.indexOf('\n  };', src.indexOf('const sendMagicLink')));
  const gate = send.match(/if \(TURNSTILE_SITE_KEY && ([^)]*?)!turnstileToken\)/);
  assert.ok(gate, 'the link form no longer checks its Turnstile token');
  assert.match(gate[1], /step === 'link' &&/, "the token check must apply only to the link step, which mounts the widget");
  const sent = src.slice(src.indexOf("(step === 'sent') {"), src.indexOf("(step === 'code') {"));
  assert.match(sent, /onClick=\{sendMagicLink\}/, 'Resend no longer sends');
  assert.ok(!/<TurnstileBox /.test(sent), 'the sent step mounts a widget now; revisit this gate');
});
