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
  assert.match(decl, /googleProbe === 'yes'/, "'Google' must be named only when the probe said yes");
  assert.match(decl, /passkeySupported/, "'passkey' must be named only when the browser supports one");
  // ...and the sentence must actually consume it.
  assert.match(src, /\{`? ?\$\{alsoAvailable\}/, 'the rendered sentence must interpolate alsoAvailable');
});

test('the Google probe has three states, so "not asked yet" is not rendered as "no"', () => {
  // A boolean initialised false cannot tell those apart, and both rendered as
  // silence. `googleAvailable` is gone on purpose.
  assert.ok(!/googleAvailable/.test(src), 'the two-state flag is back; it cannot express "probing"');
  assert.match(src, /useState\('probing'\)/, "the probe must start in a 'probing' state");
  assert.match(src, /setGoogleProbe\('yes'\)/);
  assert.match(src, /setGoogleProbe\('no'\)/);
});

test("a refused Google probe leaves a stated absence where the button was", () => {
  assert.match(src, /googleProbe === 'no' &&/, 'nothing is rendered for the "no" state');
  const at = src.indexOf("googleProbe === 'no' &&");
  const block = src.slice(at, at + 900);
  assert.match(block, /data-testid="login-google-unavailable"/);
  // Everything below reads the COPY, not the markup — see visibleText above.
  const copy = visibleText(block.slice(0, block.indexOf('</div>')));
  assert.match(copy, /unavailable/i, 'the absence must say, in words, that it is an absence');
  // And it must say the other ways in still work — the whole reason the user
  // was not actually locked out.
  assert.match(copy, /passkey/i, 'the absence must point at a way in that does work');
  assert.match(copy, /email link/i);
  assert.ok(
    /did not confirm|did not answer/.test(copy),
    'say which of the two it was, or that we cannot tell: "not enabled" and '
    + '"did not answer" are different facts and the probe cannot distinguish them',
  );
});

test('the probe has its own deadline, so a stall becomes an absence and not a short list', () => {
  // Found by rendering, not by reading: with the module's default deadline the
  // hanging case showed a silently shorter list for thirty seconds and no note.
  // A probe whose only job is to decide what the page CLAIMS must not be allowed
  // to leave that claim pending.
  assert.match(src, /GOOGLE_PROBE_TIMEOUT_MS/, 'the probe has no deadline of its own');
  const call = src.slice(src.indexOf('api.googleStartUrl({ action:'), src.indexOf("setGoogleProbe('yes')"));
  assert.match(call, /timeoutMs: GOOGLE_PROBE_TIMEOUT_MS/, 'the probe must pass its deadline');
  const decl = src.slice(src.indexOf('const GOOGLE_PROBE_TIMEOUT_MS'));
  const ms = Number(decl.match(/=\s*([\d_]+)/)[1].replace(/_/g, ''));
  assert.ok(ms > 0 && ms <= 10_000, `probe deadline is ${ms}ms — it must be well under the 30s default`);
  // ...and the click must NOT inherit it: a person who chose Google should get
  // the normal deadline, not the probe's.
  const click = src.slice(src.indexOf('const continueWithGoogle'));
  const clickCall = click.slice(0, click.indexOf('}'));
  assert.ok(
    !/GOOGLE_PROBE_TIMEOUT_MS/.test(clickCall),
    'the probe deadline must not be applied to the real click',
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
