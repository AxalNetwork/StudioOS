/**
 * Task #4 — Cross-account session leak regression guard.
 *
 * Covers the `pickAuthToken` precedence helper extracted from `auth.ts`.
 * The historical behaviour (Bearer always wins over cookie) leaked the
 * admin's account to anyone whose browser still had a stale impersonation
 * Bearer in localStorage when a new user signed in via Google OAuth.
 *
 * Run via:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_token_precedence.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pickAuthToken } from '../src/auth.ts';

test('returns null when neither token is present', () => {
  assert.equal(pickAuthToken({ bearer: null, cookie: null }), null);
});

test('cookie-only → cookie wins', () => {
  assert.equal(pickAuthToken({ bearer: null, cookie: { user_id: 7 } }), 'cookie');
});

test('bearer-only → bearer wins', () => {
  assert.equal(pickAuthToken({ bearer: { user_id: 7 }, cookie: null }), 'bearer');
});

test('same identity in both → bearer wins (back-compat)', () => {
  assert.equal(
    pickAuthToken({ bearer: { user_id: 42 }, cookie: { user_id: 42 } }),
    'bearer',
  );
});

test('legitimate impersonation (bearer.impersonated_by === cookie.user_id) → bearer wins', () => {
  // Admin (cookie.user_id=1) is impersonating user 99 — the Bearer JWT
  // carries impersonated_by=1 so the worker should honour the impersonation.
  assert.equal(
    pickAuthToken({
      bearer: { user_id: 99, impersonated_by: 1 },
      cookie: { user_id: 1 },
    }),
    'bearer',
  );
});

test('CRITICAL — stale impersonation Bearer + fresh other-user cookie → cookie wins', () => {
  // Reproduces the Google-OAuth bug: browser has an old admin (id=1)
  // impersonation Bearer for user 5, then a different real user
  // (generativefinance@gmail.com, id=42) signs in via Google. The cookie
  // for user 42 must win, NOT the stale Bearer for user 5 owned by admin 1.
  assert.equal(
    pickAuthToken({
      bearer: { user_id: 5, impersonated_by: 1 },
      cookie: { user_id: 42 },
    }),
    'cookie',
  );
});

test('stale admin Bearer (no impersonation) + fresh other-user cookie → cookie wins', () => {
  // The simpler variant: admin signed in normally on this browser, then
  // signed out (or didn't), and now a different account holder signs in.
  // The fresh cookie must always beat the stale Bearer.
  assert.equal(
    pickAuthToken({
      bearer: { user_id: 1 }, // admin, no impersonated_by
      cookie: { user_id: 42 }, // freshly signed-in different user
    }),
    'cookie',
  );
});

test('bearer.impersonated_by points to a user that is NOT the cookie holder → cookie wins', () => {
  // Edge case: a stale impersonation Bearer where the original admin is
  // user 1, but the current cookie belongs to user 7 (someone else who
  // signed in). Bearer is not a legitimate impersonation of the cookie
  // holder, so cookie wins.
  assert.equal(
    pickAuthToken({
      bearer: { user_id: 99, impersonated_by: 1 },
      cookie: { user_id: 7 },
    }),
    'cookie',
  );
});

test('numeric vs string user_id coercion is consistent', () => {
  // JWT payloads sometimes round-trip as strings; the helper coerces with
  // Number(). Make sure 42 (number) and "42" (string) match.
  assert.equal(
    pickAuthToken({
      bearer: { user_id: '42' as unknown as number },
      cookie: { user_id: 42 },
    }),
    'bearer',
  );
  assert.equal(
    pickAuthToken({
      bearer: { user_id: 99, impersonated_by: '1' as unknown as number },
      cookie: { user_id: 1 },
    }),
    'bearer',
  );
});
