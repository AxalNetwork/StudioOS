/**
 * Task #35 — regression tests for the calendar OAuth start pre-flight.
 *
 * Asserts:
 *   (a) Missing required secret → preflightOAuthSecrets() lists it.
 *   (b) All secrets present → preflightOAuthSecrets() returns [].
 *   (c) buildGoogleAuthUrl produces a URL with origin accounts.google.com
 *       and a redirect_uri derived from PUBLIC_BASE_URL / APP_URL.
 *
 * Run via:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/calendar.google-oauth.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  preflightOAuthSecrets,
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
} from '../src/services/calendar.ts';
import {
  buildGoogleOAuthStartResponse,
  buildMicrosoftOAuthStartResponse,
} from '../src/routes/calendar.ts';

type EnvShape = Record<string, string | undefined>;

const FULL_GOOGLE: EnvShape = {
  JWT_SECRET: 'test-jwt-secret-at-least-32-bytes-long-xx',
  GOOGLE_CLIENT_ID: 'g-client-id',
  GOOGLE_CLIENT_SECRET: 'g-client-secret',
  APP_URL: 'https://app.axal.vc',
  PUBLIC_BASE_URL: 'https://app.axal.vc',
};

const FULL_MICROSOFT: EnvShape = {
  JWT_SECRET: 'test-jwt-secret-at-least-32-bytes-long-xx',
  MICROSOFT_CLIENT_ID: 'm-client-id',
  MICROSOFT_CLIENT_SECRET: 'm-client-secret',
  APP_URL: 'https://app.axal.vc',
  PUBLIC_BASE_URL: 'https://app.axal.vc',
};

test('preflightOAuthSecrets reports GOOGLE_CLIENT_ID missing', () => {
  const env: EnvShape = { ...FULL_GOOGLE };
  delete env.GOOGLE_CLIENT_ID;
  const missing = preflightOAuthSecrets(env as any, 'google');
  assert.ok(missing.includes('GOOGLE_CLIENT_ID'), `expected GOOGLE_CLIENT_ID in ${JSON.stringify(missing)}`);
});

test('preflightOAuthSecrets reports JWT_SECRET missing', () => {
  const env: EnvShape = { ...FULL_GOOGLE };
  delete env.JWT_SECRET;
  const missing = preflightOAuthSecrets(env as any, 'google');
  assert.ok(missing.includes('JWT_SECRET'));
});

test('preflightOAuthSecrets reports PUBLIC_BASE_URL missing when no redirect URI resolvable', () => {
  const env: EnvShape = { ...FULL_GOOGLE };
  delete env.APP_URL;
  delete env.PUBLIC_BASE_URL;
  const missing = preflightOAuthSecrets(env as any, 'google');
  assert.ok(missing.includes('PUBLIC_BASE_URL'));
});

test('preflightOAuthSecrets returns empty when fully configured for Google', () => {
  const missing = preflightOAuthSecrets(FULL_GOOGLE as any, 'google');
  assert.deepEqual(missing, []);
});

test('preflightOAuthSecrets returns empty when fully configured for Microsoft', () => {
  const missing = preflightOAuthSecrets(FULL_MICROSOFT as any, 'microsoft');
  assert.deepEqual(missing, []);
});

test('preflightOAuthSecrets reports MICROSOFT_CLIENT_SECRET missing', () => {
  const env: EnvShape = { ...FULL_MICROSOFT };
  delete env.MICROSOFT_CLIENT_SECRET;
  const missing = preflightOAuthSecrets(env as any, 'microsoft');
  assert.ok(missing.includes('MICROSOFT_CLIENT_SECRET'));
});

test('buildGoogleAuthUrl produces a well-formed accounts.google.com URL', () => {
  const url = new URL(buildGoogleAuthUrl(FULL_GOOGLE as any, 'nonce.sig'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'g-client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'nonce.sig');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://app.axal.vc/api/calendar/google/callback',
  );
});

test('buildMicrosoftAuthUrl produces a well-formed login.microsoftonline.com URL', () => {
  const url = new URL(buildMicrosoftAuthUrl(FULL_MICROSOFT as any, 'nonce.sig'));
  assert.equal(url.hostname, 'login.microsoftonline.com');
  assert.equal(url.searchParams.get('client_id'), 'm-client-id');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://app.axal.vc/api/calendar/microsoft/callback',
  );
});

// ---------------------------------------------------------------------------
// Endpoint-level regression tests for /api/calendar/google/start and
// /api/calendar/{microsoft,outlook}/start. We call the route's pure
// response builder (extracted in Task #35 for testability) with a stub D1
// binding so we don't need to spin up Hono or sign a JWT cookie.
// ---------------------------------------------------------------------------
function makeStubDB() {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async all() {
                calls.push({ sql, params });
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
}

test('/google/start: missing secret → typed 500 oauth_config_missing', async () => {
  const env: EnvShape = { ...FULL_GOOGLE };
  delete env.GOOGLE_CLIENT_SECRET;
  const { status, body } = await buildGoogleOAuthStartResponse(env as any, 42);
  assert.equal(status, 500);
  assert.equal(body.error.code, 'oauth_config_missing');
  assert.ok(Array.isArray(body.error.missing));
  assert.ok(body.error.missing.includes('GOOGLE_CLIENT_SECRET'));
  assert.ok(/not fully configured/.test(body.error.message));
});

test('/google/start: healthy → 200 with redirect_url to accounts.google.com', async () => {
  const stub = makeStubDB();
  const env = { ...FULL_GOOGLE, DB: stub.DB } as any;
  const { status, body } = await buildGoogleOAuthStartResponse(env, 42);
  assert.equal(status, 200);
  assert.ok(typeof body.redirect_url === 'string');
  assert.ok(body.redirect_url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  // back-compat alias retained for the existing SPA
  assert.equal(body.auth_url, body.redirect_url);
  const redirectUri = new URL(body.redirect_url).searchParams.get('redirect_uri');
  assert.equal(redirectUri, 'https://app.axal.vc/api/calendar/google/callback');
  // OAuth state row must have been persisted
  assert.ok(stub.calls.some(c => /INSERT INTO oauth_state_tokens/.test(c.sql)));
});

test('/outlook/start: missing secret → typed 500 oauth_config_missing', async () => {
  const env: EnvShape = { ...FULL_MICROSOFT };
  delete env.MICROSOFT_CLIENT_ID;
  const { status, body } = await buildMicrosoftOAuthStartResponse(env as any, 42);
  assert.equal(status, 500);
  assert.equal(body.error.code, 'oauth_config_missing');
  assert.ok(body.error.missing.includes('MICROSOFT_CLIENT_ID'));
});

test('/outlook/start: healthy → 200 with redirect_url to login.microsoftonline.com', async () => {
  const stub = makeStubDB();
  const env = { ...FULL_MICROSOFT, DB: stub.DB } as any;
  const { status, body } = await buildMicrosoftOAuthStartResponse(env, 42);
  assert.equal(status, 200);
  assert.ok(body.redirect_url.startsWith('https://login.microsoftonline.com/'));
  assert.equal(body.auth_url, body.redirect_url);
});

test('PUBLIC_BASE_URL is the source of truth — APP_URL alone still works (back-compat)', () => {
  // PUBLIC_BASE_URL absent, APP_URL present → redirect URI resolves
  const env: EnvShape = {
    JWT_SECRET: FULL_GOOGLE.JWT_SECRET,
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 's',
    APP_URL: 'https://app.axal.vc',
  };
  assert.deepEqual(preflightOAuthSecrets(env as any, 'google'), []);
});

test('PUBLIC_BASE_URL wins over APP_URL when both are set', () => {
  const env: EnvShape = {
    JWT_SECRET: FULL_GOOGLE.JWT_SECRET,
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 's',
    APP_URL: 'https://legacy.example.com',
    PUBLIC_BASE_URL: 'https://app.axal.vc',
  };
  const url = new URL(buildGoogleAuthUrl(env as any, 'n.s'));
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://app.axal.vc/api/calendar/google/callback',
  );
});
