/**
 * Task #51 — Tests for the "Continue with Google" linking-precedence rules.
 *
 * Covers the four scenarios the spec called out:
 *   (1) link-verified         → existing email-verified row links to sub
 *   (2) link-unverified-blocked → existing unverified row REFUSES to link
 *   (3) fresh-signup          → no existing row → new account created
 *   (4) no-merge-double-account → second Google sign-in with the same sub
 *                                 returns the SAME user (never silos)
 *
 * Plus state-token cryptography sanity (HMAC roundtrip, tamper-reject,
 * expiry-reject) and the unlink no-orphan guard logic.
 *
 * Run via:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_google.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideSigninAction,
  decideLinkAction,
  decideUnlinkAllowed,
  __testing,
} from '../src/routes/auth_google.ts';

const ENV = { JWT_SECRET: 'a'.repeat(48) } as any;

// ---------------------------------------------------------------------------
// Sign-in precedence (rules 1-4)
// ---------------------------------------------------------------------------

test('rule 1 — google_sub match short-circuits and signs the existing user in', () => {
  const out = decideSigninAction(
    { id: 42, email_verified: true },
    { id: 99, email_verified: true }, // would-be email match is ignored
  );
  assert.deepEqual(out, { kind: 'signin_existing', userId: 42 });
});

test('rule 2 — verified email match auto-links to existing row (no silo)', () => {
  const out = decideSigninAction(null, { id: 7, email_verified: true });
  assert.deepEqual(out, { kind: 'link_then_signin', userId: 7 });
});

test('rule 3 — unverified email match REFUSES (link blocked)', () => {
  const out = decideSigninAction(null, { id: 7, email_verified: false });
  assert.deepEqual(out, { kind: 'refuse_unverified_email' });
});

test('rule 4 — no rows at all → fresh signup branch', () => {
  const out = decideSigninAction(null, null);
  assert.deepEqual(out, { kind: 'fresh_signup' });
});

test('no-merge-double-account — second sign-in returns the SAME user', () => {
  // Simulating the second visit: the user's google_sub is now persisted
  // so the bySub lookup succeeds and we never even consult byEmail.
  const first = decideSigninAction(null, { id: 7, email_verified: true });
  assert.equal(first.kind, 'link_then_signin');
  const second = decideSigninAction({ id: 7, email_verified: true }, null);
  assert.deepEqual(second, { kind: 'signin_existing', userId: 7 });
});

// ---------------------------------------------------------------------------
// Authenticated linking (L1-L4)
// ---------------------------------------------------------------------------

test('link L1 — caller already has google_sub → already_linked', () => {
  const out = decideLinkAction({
    callerHasSub: true, callerEmailVerified: true, subAlreadyOwnedByOtherUser: false,
  });
  assert.deepEqual(out, { kind: 'refuse', code: 'already_linked' });
});

test('link L2 — sub owned by another user → sub_owned_by_other', () => {
  const out = decideLinkAction({
    callerHasSub: false, callerEmailVerified: true, subAlreadyOwnedByOtherUser: true,
  });
  assert.deepEqual(out, { kind: 'refuse', code: 'sub_owned_by_other' });
});

test('link L4 — caller email unverified → caller_email_unverified', () => {
  const out = decideLinkAction({
    callerHasSub: false, callerEmailVerified: false, subAlreadyOwnedByOtherUser: false,
  });
  assert.deepEqual(out, { kind: 'refuse', code: 'caller_email_unverified' });
});

test('link ok — verified caller, sub free → link_ok', () => {
  const out = decideLinkAction({
    callerHasSub: false, callerEmailVerified: true, subAlreadyOwnedByOtherUser: false,
  });
  assert.deepEqual(out, { kind: 'link_ok' });
});

// ---------------------------------------------------------------------------
// State HMAC roundtrip + tampering + expiry
// ---------------------------------------------------------------------------

test('state token roundtrips action + redirect + uid', async () => {
  const t = await __testing.signState(ENV, {
    n: 'abc', ts: Math.floor(Date.now() / 1000),
    action: 'link', uid: 42, redirect: '/account?tab=security',
  });
  const parsed = await __testing.verifyState(ENV, t);
  assert.equal(parsed?.action, 'link');
  assert.equal(parsed?.uid, 42);
  assert.equal(parsed?.redirect, '/account?tab=security');
});

test('state token: tampered signature is rejected', async () => {
  const t = await __testing.signState(ENV, {
    n: 'abc', ts: Math.floor(Date.now() / 1000),
    action: 'signin', redirect: '/dashboard',
  });
  // Flip a character in the signature half.
  const dot = t.indexOf('.');
  const bad = t.slice(0, dot + 1) + (t[dot + 1] === 'a' ? 'b' : 'a') + t.slice(dot + 2);
  const parsed = await __testing.verifyState(ENV, bad);
  assert.equal(parsed, null);
});

test('state token: expired (>10 min) is rejected', async () => {
  const t = await __testing.signState(ENV, {
    n: 'abc', ts: Math.floor(Date.now() / 1000) - 700, // 11m40s old
    action: 'signin', redirect: '/dashboard',
  });
  const parsed = await __testing.verifyState(ENV, t);
  assert.equal(parsed, null);
});

test('state token: future timestamp (clock skew abuse) is rejected', async () => {
  const t = await __testing.signState(ENV, {
    n: 'abc', ts: Math.floor(Date.now() / 1000) + 120,
    action: 'signin', redirect: '/dashboard',
  });
  const parsed = await __testing.verifyState(ENV, t);
  assert.equal(parsed, null);
});

// ---------------------------------------------------------------------------
// No-orphan unlink guard (Google-only account must NOT be able to unlink)
// ---------------------------------------------------------------------------

test('unlink — Google-only user (no TOTP, no SMS) is BLOCKED', () => {
  const out = decideUnlinkAllowed({ totpConfigured: false, smsConfigured: false });
  assert.deepEqual(out, { allowed: false, reason: 'last_sign_in_path' });
});

test('unlink — Google + TOTP is allowed', () => {
  const out = decideUnlinkAllowed({ totpConfigured: true, smsConfigured: false });
  assert.deepEqual(out, { allowed: true, reason: null });
});

test('unlink — Google + SMS is allowed', () => {
  const out = decideUnlinkAllowed({ totpConfigured: false, smsConfigured: true });
  assert.deepEqual(out, { allowed: true, reason: null });
});

test('unlink — email_verified alone does NOT unlock unlink (regression guard)', () => {
  // A prior version of the route treated email_verified as an alternate
  // sign-in path. It is NOT — the helper signature has no such field,
  // and a Google-only user with a verified email but no TOTP and no SMS
  // must still be blocked.
  const out = decideUnlinkAllowed({ totpConfigured: false, smsConfigured: false });
  assert.equal(out.allowed, false);
});

test('state token: bogus action is rejected', async () => {
  const t = await __testing.signState(ENV, {
    n: 'abc', ts: Math.floor(Date.now() / 1000),
    action: 'evil' as any, redirect: '/dashboard',
  });
  const parsed = await __testing.verifyState(ENV, t);
  assert.equal(parsed, null);
});
