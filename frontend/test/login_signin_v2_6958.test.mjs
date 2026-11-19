/**
 * #6958 — Sign In v2 (canvas D6956): the first view's three choices, the Email
 * steps, the desktop card and the phone sheet.
 *
 * Three halves. The pure step logic (lib/loginSteps.js) is exercised directly.
 * The container (components/auth/SignInSurface.jsx) is rendered on the server
 * for both layouts. The page is read as source, because what it must keep —
 * which control appears in which step, what a step mounts, what Back and the
 * providers do — is structure the other two halves cannot see.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/login_signin_v2_6958.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  STEPS, PARENT, stepFromSearch, searchForStep, restorableStep, cleanCode, codeReady,
  stepForMagicError, APPLE_ERROR_COPY, isCancellation,
} from '../src/lib/loginSteps.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LOGIN = codeOnly(read('frontend/src/pages/LoginPage.jsx'));
const SURFACE = read('frontend/src/components/auth/SignInSurface.jsx');
const CSS = read('frontend/src/components/auth/signInSurface.css');
const h = React.createElement;

/** The JSX of one step: from `step === '<name>'` to the next branch. */
function stepBody(name) {
  const at = name === 'first' ? LOGIN.lastIndexOf('} else {\n    body = (') : LOGIN.indexOf(`(step === '${name}') {`);
  assert.ok(at > 0, `the ${name} step is gone`);
  const end = name === 'first' ? LOGIN.indexOf('\n  return (', at) : LOGIN.indexOf('} else ', at + 10);
  return LOGIN.slice(at, end);
}

// ─────────────────────────────────────────────────────────── steps ──

test('every step but the first has one parent, and the chain ends at the first view', () => {
  for (const s of STEPS) {
    let cur = s; let n = 0;
    while (cur !== 'first') { cur = PARENT[cur]; n += 1; assert.ok(cur && n < 5, `${s} never reaches the first view`); }
  }
  assert.equal(PARENT.first, undefined);
  assert.equal(PARENT.link, 'email');
  assert.equal(PARENT.code, 'email');
  assert.equal(PARENT.passkey, 'email');
  assert.equal(PARENT.sent, 'link');
});

test('?step= round-trips and keeps next=; unknown steps are the first view', () => {
  assert.equal(stepFromSearch('?step=code&next=%2Fgrow'), 'code');
  assert.equal(stepFromSearch('?step=admin'), 'first');
  assert.equal(stepFromSearch(''), 'first');
  assert.equal(searchForStep('?next=%2Fgrow', 'link'), '?next=%2Fgrow&step=link');
  assert.equal(searchForStep('?next=%2Fgrow&step=link', 'first'), '?next=%2Fgrow');
  assert.equal(searchForStep('', 'first'), '');
});

test('a reload never replays an action: sent opens the link step, passkey the chooser', () => {
  assert.equal(restorableStep('sent'), 'link');
  assert.equal(restorableStep('passkey'), 'email');
  assert.equal(restorableStep('code'), 'code');
  assert.equal(restorableStep('nope'), 'first');
});

test('a magic-link return opens the retry view, except for an inactive account', () => {
  for (const c of ['expired', 'invalid', 'rate', 'limiter', 'error', 'whatever']) assert.equal(stepForMagicError(c), 'link', c);
  assert.equal(stepForMagicError('inactive'), 'first');
});

test('the code field takes six digits or a recovery code, from typing or a paste', () => {
  assert.equal(cleanCode(' 482 913 '), '482913');
  assert.equal(cleanCode('4829131234'), '482913');
  assert.equal(cleanCode('ABCD-EFGH-12'), 'ABCD-EFGH-12');
  assert.equal(cleanCode('abcd efgh!'), 'abcdefgh');
  assert.equal(codeReady('482913'), true);
  assert.equal(codeReady('48291'), false);
  assert.equal(codeReady('ABCD-EFGH'), true);
  assert.equal(codeReady('ABC-D'), false);
});

test('every code routes/auth_apple.ts can return has a sentence of ours', () => {
  const worker = read('cloudflare-worker/src/routes/auth_apple.ts');
  const codes = new Set([...worker.matchAll(/backWithError\(c, '([a-z_]+)'/g)].map((m) => m[1]));
  for (const m of worker.matchAll(/code: '([a-z_]+)'/g)) codes.add(m[1]);
  for (const k of ['link_requires_email_proof', 'link_blocked_unverified', 'account_inactive', 'email_missing']) codes.add(k);
  // Link-only codes are answered on Account → Security, not here.
  for (const k of ['already_linked', 'sub_owned_by_other', 'caller_email_unverified', 'user_gone', 'unauthenticated']) codes.delete(k);
  for (const c of codes) assert.ok(APPLE_ERROR_COPY[c], `no /login copy for apple_error=${c}`);
  assert.equal(isCancellation('cancelled'), true);
  assert.equal(isCancellation('popup_closed'), true);
  assert.equal(isCancellation('exchange_failed'), false);
});

// ─────────────────────────────────────────────────────── first view ──

test('the first view offers Email, Apple, Google in that order, and a contextual Create an account link', () => {
  const first = stepBody('first');
  const e = first.indexOf('Continue with Email');
  const a = first.indexOf("'Continue with Apple'");
  const g = first.indexOf('data-testid="login-google"');
  assert.ok(e > 0 && a > e && g > a, 'the order is Email, Apple, Google');
  assert.match(first, /<Link to=\{context\?\.registerHref \|\| '\/register'\}>Create an account<\/Link>/);
  assert.match(first, /\{heading\(context \? `Sign in to continue to \$\{context\.area\.name\}` : 'Sign in to Axal VC'\)\}/);
  // Nothing that asks for a credential or a challenge is on the first view.
  for (const banned of ['TurnstileBox', 'login-email"', 'login-totp', 'sendMagicLink', 'signInWithPasskey']) {
    assert.ok(!first.includes(banned), `the first view carries ${banned}`);
  }
  assert.ok(!/showApplyCard/.test(LOGIN), 'the separate signup card is back');
});

test('Apple shows only once its config says configured; Google always renders', () => {
  const first = stepBody('first');
  assert.match(first, /\{appleConfigured && \(\s*<button[^>]*onClick=\{continueWithApple\}/);
  assert.match(LOGIN, /appleSignInApi\.config\(\)\.then\(\(cfg\) => \{\s*if \(mountedRef\.current && cfg\?\.configured === true\) setAppleConfigured\(true\);/);
  const apple = LOGIN.slice(LOGIN.indexOf('const continueWithApple'), LOGIN.indexOf('\n  };', LOGIN.indexOf('const continueWithApple')));
  assert.match(apple, /appleSignInApi\.startUrl\(\{ action: 'signin', redirect: safeNextPath\(\) \|\| '\/studio' \}\)/);
  assert.ok(!/email/.test(apple.replace(/Continue with Email/g, '')), 'Apple depends on the typed address');
});

test('Google launches independent of any draft address', () => {
  const cwg = LOGIN.slice(LOGIN.indexOf('const continueWithGoogle'), LOGIN.indexOf('\n  };', LOGIN.indexOf('const continueWithGoogle')));
  assert.match(cwg, /const typed = '';/);
  assert.ok(!/email\.trim\(\)/.test(cwg), 'continueWithGoogle reads the typed address');
});

// ─────────────────────────────────────────────────────── the Email branch ──

test('choosing Email asks for nothing and sends nothing', () => {
  const chooser = stepBody('email');
  for (const banned of ['TurnstileBox', 'id="login-email"', 'magicStart', 'sendMagicLink']) assert.ok(!chooser.includes(banned), `the chooser carries ${banned}`);
  assert.match(chooser, /Email me a sign-in link/);
  assert.match(chooser, /Use an authenticator code/);
  assert.match(chooser, /\{passkeySupported && \(/, 'the passkey row is offered only where the browser has WebAuthn');
  assert.match(chooser, /to="\/auth\/recover"/);
  // Opening a method row only moves the step; the passkey row starts WebAuthn on that press.
  assert.match(LOGIN, /const choosePasskey = \(\) => \{\s*go\('passkey', 'signin-method-passkey'\);\s*signInWithPasskey\(\);/);
});

test('Turnstile mounts only with the link and code forms', () => {
  const uses = [...LOGIN.matchAll(/<TurnstileBox /g)].map((m) => m.index);
  assert.equal(uses.length, 2);
  const link = LOGIN.indexOf("(step === 'link') {");
  const sent = LOGIN.indexOf("(step === 'sent') {");
  const code = LOGIN.indexOf("(step === 'code') {");
  const pk = LOGIN.indexOf("(step === 'passkey') {");
  assert.ok(uses[0] > link && uses[0] < sent, 'the first widget is in the link step');
  assert.ok(uses[1] > code && uses[1] < pk, 'the second widget is in the code step');
  assert.match(LOGIN, /appearance: 'interaction-only'/);
  // Removed with its form, and its token with it.
  const box = LOGIN.slice(LOGIN.indexOf('function TurnstileBox'), LOGIN.indexOf('export default function LoginPage'));
  assert.match(box, /window\.turnstile\.remove\(widget\.current\)/);
  assert.match(box, /onToken\(''\);\s*\};/);
});

test('the link step: labelled address, explicit send, confirmation, cooldown, change address', () => {
  const link = stepBody('link');
  assert.match(link, /\{emailField\}/);
  assert.match(link, /Send sign-in link/);
  const sent = stepBody('sent');
  assert.match(sent, /Check your email/);
  assert.match(sent, /Resend link in \$\{magicCooldown\}s/);
  assert.match(sent, /onClick=\{back\}>Change address/);
  assert.match(LOGIN, /setMagicCooldown\(60\)/);
});

test('the code step: address, labelled six-digit field with one-time-code autofill and paste, recovery reachable', () => {
  const code = stepBody('code');
  assert.match(code, /\{emailField\}/);
  assert.match(code, /htmlFor="login-totp"[^>]*>6-digit code</);
  assert.match(code, /autoComplete="one-time-code"/);
  assert.match(code, /onPaste=/);
  assert.match(code, /pasteCode/);
  assert.match(code, /to="\/auth\/recover"/);
});

test('one-time codes are cleared on leaving the code step; the typed address is kept', () => {
  assert.match(LOGIN, /if \(step !== 'code'\) \{ setTotpCode\(''\);/);
  assert.ok(!/setEmail\(''\)/.test(LOGIN), 'the address is cleared somewhere');
});

test('a cancelled passkey returns to the Email methods and says so', () => {
  const pk = LOGIN.slice(LOGIN.indexOf('const signInWithPasskey'), LOGIN.indexOf('\n  };', LOGIN.indexOf('const signInWithPasskey')));
  const cancel = pk.slice(pk.indexOf("e?.name === 'NotAllowedError'"));
  assert.match(cancel.slice(0, 400), /carryRef\.current = \{ notice: 'Passkey sign-in was cancelled\. Nothing was changed\.' \};\s*if \(!back\(\)\) clearMessages\(\);/);
  assert.match(stepBody('passkey'), /Try passkey again/);
});

test('each step is a history entry and Back goes one step up', () => {
  assert.match(LOGIN, /window\.history\.pushState\(\{ signinStep: next \}/);
  assert.match(LOGIN, /window\.addEventListener\('popstate', onPop\)/);
  assert.match(LOGIN, /const onEscape = \(\) => \(step !== 'first' \? back\(\) : false\);/);
  for (const s of ['email', 'link', 'sent', 'code', 'passkey']) assert.match(stepBody(s), /\{backButton\}/, `${s} has no Back`);
});

test('the contextual destination and the #4577 associations are kept', () => {
  assert.match(LOGIN, /const \[context\] = useState\(signInContext\);/);
  assert.match(LOGIN, /\{context\.area\.what\} \{context\.area\.who\}/);
  assert.match(LOGIN, /id="login-error" role="alert"/);
  assert.match(LOGIN, /storePendingNext\(safeNextPath\(\)\)/);
});

// ─────────────────────────────────────────────────────── the container ──

test('desktop: one card in a main labelled by the heading', async () => {
  const { default: SignInSurface } = await import('../src/components/auth/SignInSurface.jsx');
  const html = renderToStaticMarkup(h(SignInSurface, { phone: false, labelledBy: 't' }, h('h1', { id: 't' }, 'Sign in')));
  assert.match(html, /<main class="signin-center" aria-labelledby="t"/);
  assert.match(html, /<section class="signin-card"/);
  assert.ok(!/role="dialog"/.test(html), 'the desktop card is not a modal');
});

test('phone: an open modal sheet with a labelled Close, over a scrim', async () => {
  const { default: SignInSurface } = await import('../src/components/auth/SignInSurface.jsx');
  const html = renderToStaticMarkup(h(SignInSurface, { phone: true, labelledBy: 't' }, h('h1', { id: 't' }, 'Sign in')));
  assert.match(html, /class="signin-scrim" aria-hidden="true"/);
  assert.match(html, /<section class="signin-sheet" role="dialog" aria-modal="true" aria-labelledby="t"/);
  assert.match(html, /aria-label="Close sign-in"/);
});

test('the sheet contains focus, closes to a Sign in button, and returns focus both ways', () => {
  assert.match(SURFACE, /e\.key !== 'Tab'/);
  assert.match(SURFACE, /reopenRef\.current\?\.focus\(\)/);
  assert.match(SURFACE, />\s*Sign in\s*</);
  assert.match(SURFACE, /h\?\.focus\(\)/);
  assert.match(SURFACE, /if \(phone\) \{ e\.stopPropagation\(\); close\(\); \}/, 'Escape on the phone first view closes the sheet');
  assert.match(SURFACE, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(SURFACE, /window\.visualViewport/);
});

test('the sheet respects the home indicator, the keyboard and reduced motion', () => {
  assert.match(CSS, /env\(safe-area-inset-bottom\)/);
  assert.match(CSS, /max-height: calc\(var\(--signin-vvh, 100dvh\)/);
  assert.match(CSS, /overflow-y: auto/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS, /\.signin-b:focus-visible/);
  assert.match(CSS, /font-size: 16px; \/\* 16px keeps iOS Safari from zooming/);
});

test('AuthShell keeps the new layout opt-in', () => {
  const shell = read('frontend/src/components/auth/AuthShell.jsx');
  assert.match(shell, /signInScene = false,/);
  assert.match(LOGIN, /<AuthShell signInScene backgroundSrc="\/auth\/login-background\.webp">/);
  const register = read('frontend/src/pages/RegisterPage.jsx');
  assert.ok(!/signInScene/.test(register), 'registration took the login layout');
});
