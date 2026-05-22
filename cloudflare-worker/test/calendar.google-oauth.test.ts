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
  persistGoogleCallbackTokens,
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

// Task #1 — force account chooser + optional login_hint.
test('buildGoogleAuthUrl forces select_account+consent and omits login_hint when not supplied', () => {
  const url = new URL(buildGoogleAuthUrl(FULL_GOOGLE as any, 'nonce.sig'));
  assert.equal(url.searchParams.get('prompt'), 'select_account consent');
  assert.equal(url.searchParams.get('login_hint'), null);
});

test('buildGoogleAuthUrl attaches login_hint when an email is provided', () => {
  const url = new URL(buildGoogleAuthUrl(FULL_GOOGLE as any, 'nonce.sig', 'founder@axal.vc'));
  assert.equal(url.searchParams.get('prompt'), 'select_account consent');
  assert.equal(url.searchParams.get('login_hint'), 'founder@axal.vc');
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

// ---------------------------------------------------------------------------
// Task #1 — /google/callback persistence step. Exercises the
// one-Google-to-one-Axal collision guard end-to-end (token write AND
// sign-in link write) using a tiny in-memory SQL stub keyed by query
// fragment, so we don't need Hono, JWT, or Google's token endpoint.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
type StubState = {
  tokens: Map<number, Row>;          // user_id → { google_sub, ... }
  links:  Map<number, Row>;          // user_id → { google_sub }
  hasLinksTable: boolean;
  writes: string[];                  // chronological log of write SQL
};

function makePersistStub(initial?: Partial<StubState>) {
  const state: StubState = {
    tokens: new Map(initial?.tokens ?? []),
    links: new Map(initial?.links ?? []),
    hasLinksTable: initial?.hasLinksTable ?? true,
    writes: [],
  };
  const uniqueErr = () => Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' });
  const DB = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params: any[]) {
          return {
            async all() {
              // SELECT collision pre-check on tokens
              if (/^SELECT user_id FROM google_oauth_tokens WHERE google_sub = \? AND user_id <> \?/i.test(s)) {
                const [sub, uid] = params;
                const rows: Row[] = [];
                for (const [u, r] of state.tokens) {
                  if (u !== uid && r.google_sub === sub) rows.push({ user_id: u });
                }
                return { results: rows.slice(0, 1) };
              }
              // SELECT collision pre-check on links
              if (/^SELECT user_id FROM user_google_links WHERE google_sub = \? AND user_id <> \?/i.test(s)) {
                if (!state.hasLinksTable) throw new Error('no such table: user_google_links');
                const [sub, uid] = params;
                const rows: Row[] = [];
                for (const [u, r] of state.links) {
                  if (u !== uid && r.google_sub === sub) rows.push({ user_id: u });
                }
                return { results: rows.slice(0, 1) };
              }
              // SELECT self-link
              if (/^SELECT google_sub FROM user_google_links WHERE user_id = \?/i.test(s)) {
                const [uid] = params;
                const row = state.links.get(uid);
                return { results: row ? [{ google_sub: row.google_sub }] : [] };
              }
              // SELECT existing-token-row (id)
              if (/^SELECT id FROM google_oauth_tokens WHERE user_id = \?/i.test(s)) {
                const [uid] = params;
                const row = state.tokens.get(uid);
                return { results: row ? [{ id: 1 }] : [] };
              }
              // CREATE TABLE for user_google_links (idempotent bootstrap)
              if (/^CREATE TABLE IF NOT EXISTS user_google_links/i.test(s)) {
                state.hasLinksTable = true;
                state.writes.push('create_links');
                return { results: [] };
              }
              // INSERT user_google_links
              if (/^INSERT INTO user_google_links/i.test(s)) {
                const [uid, sub] = params;
                for (const [u, r] of state.links) {
                  if (u !== uid && r.google_sub === sub) throw uniqueErr();
                }
                state.links.set(uid, { google_sub: sub });
                state.writes.push(`insert_link u=${uid} sub=${sub}`);
                return { results: [] };
              }
              // INSERT google_oauth_tokens
              if (/^INSERT INTO google_oauth_tokens/i.test(s)) {
                const [uid, refresh, scope, email, sub] = params;
                if (sub) {
                  for (const [u, r] of state.tokens) {
                    if (u !== uid && r.google_sub === sub) throw uniqueErr();
                  }
                }
                state.tokens.set(uid, { refresh_token: refresh, scope, google_email: email, google_sub: sub });
                state.writes.push(`insert_token u=${uid} sub=${sub}`);
                return { results: [] };
              }
              // UPDATE google_oauth_tokens
              if (/^UPDATE google_oauth_tokens/i.test(s)) {
                const [refresh, scope, email, sub, _now, uid] = params;
                if (sub) {
                  for (const [u, r] of state.tokens) {
                    if (u !== uid && r.google_sub === sub) throw uniqueErr();
                  }
                }
                const cur = state.tokens.get(uid) || {};
                state.tokens.set(uid, { ...cur, refresh_token: refresh, scope, google_email: email, google_sub: sub });
                state.writes.push(`update_token u=${uid} sub=${sub}`);
                return { results: [] };
              }
              throw new Error(`unstubbed sql: ${s}`);
            },
          };
        },
      };
    },
  };
  return { state, DB };
}

test('persistGoogleCallbackTokens: collision on token-side → reason=google_already_linked_other_user, no writes', async () => {
  const { state, DB } = makePersistStub({
    tokens: new Map([[7, { google_sub: 'sub-A', google_email: 'a@x.com', refresh_token: 'r', scope: '' }]]),
  });
  const env = { ...FULL_GOOGLE, DB } as any;
  const result = await persistGoogleCallbackTokens(env, {
    userId: 99,                  // a different Axal user
    refreshEnc: 'enc-refresh',
    scope: 'calendar',
    googleEmail: 'a@x.com',
    googleSub: 'sub-A',           // same Google account as user 7
    emailsMatch: true,
    userEmail: 'a@x.com',
  });
  assert.deepEqual(result, { ok: false, reason: 'google_already_linked_other_user' });
  // No token row added for user 99; user 7's row untouched.
  assert.equal(state.tokens.has(99), false);
  assert.equal(state.tokens.get(7)?.google_sub, 'sub-A');
  assert.equal(state.writes.length, 0, `expected zero writes, got: ${state.writes.join('; ')}`);
});

test('persistGoogleCallbackTokens: collision on link-side → reason=google_already_linked_other_user, no writes', async () => {
  const { state, DB } = makePersistStub({
    links: new Map([[7, { google_sub: 'sub-A' }]]),
  });
  const env = { ...FULL_GOOGLE, DB } as any;
  const result = await persistGoogleCallbackTokens(env, {
    userId: 99,
    refreshEnc: 'enc-refresh',
    scope: 'calendar',
    googleEmail: 'a@x.com',
    googleSub: 'sub-A',
    emailsMatch: true,
    userEmail: 'a@x.com',
  });
  assert.deepEqual(result, { ok: false, reason: 'google_already_linked_other_user' });
  assert.equal(state.tokens.has(99), false);
  assert.equal(state.writes.length, 0);
});

test('persistGoogleCallbackTokens: same-user reconnect is idempotent (UPDATE, link no-op)', async () => {
  const { state, DB } = makePersistStub({
    tokens: new Map([[42, { google_sub: 'sub-A', refresh_token: 'old', scope: '', google_email: 'me@x.com' }]]),
    links:  new Map([[42, { google_sub: 'sub-A' }]]),
  });
  const env = { ...FULL_GOOGLE, DB } as any;
  const result = await persistGoogleCallbackTokens(env, {
    userId: 42,
    refreshEnc: 'enc-new',
    scope: 'calendar gmail',
    googleEmail: 'me@x.com',
    googleSub: 'sub-A',
    emailsMatch: true,
    userEmail: 'me@x.com',
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(state.tokens.get(42)?.refresh_token, 'enc-new');
  assert.equal(state.tokens.get(42)?.google_sub, 'sub-A');
  assert.equal(state.links.size, 1);
  // Only the UPDATE (and the idempotent CREATE TABLE IF NOT EXISTS for the
  // links bootstrap) — no duplicate link INSERT.
  assert.ok(state.writes.some(w => /^update_token u=42 sub=sub-A/.test(w)));
  assert.ok(!state.writes.some(w => /^insert_link/.test(w)),
    `link insert should not run when self-link already exists; writes: ${state.writes.join('; ')}`);
});

test('persistGoogleCallbackTokens: race past pre-check → UNIQUE on token write maps to collision reason', async () => {
  // Pre-check sees nothing (no row for sub-A yet), but the INSERT
  // simulation racer condition: we inject a competing row into the
  // tokens map between pre-check and INSERT to mirror a concurrent
  // callback that won the race.
  const { state, DB } = makePersistStub();
  const env = { ...FULL_GOOGLE, DB } as any;
  // Wrap DB.prepare so the moment the INSERT runs, a competitor row
  // exists — exercises the UNIQUE-catch path inside the upsert.
  const origPrepare = DB.prepare.bind(DB);
  (DB as any).prepare = (sql: string) => {
    if (/INSERT INTO google_oauth_tokens/i.test(sql)) {
      state.tokens.set(7, { google_sub: 'sub-RACE', refresh_token: 'r', scope: '', google_email: 'a@x.com' });
    }
    return origPrepare(sql);
  };
  const result = await persistGoogleCallbackTokens(env, {
    userId: 99,
    refreshEnc: 'enc-refresh',
    scope: 'calendar',
    googleEmail: 'a@x.com',
    googleSub: 'sub-RACE',
    emailsMatch: true,
    userEmail: 'a@x.com',
  });
  assert.deepEqual(result, { ok: false, reason: 'google_already_linked_other_user' });
  assert.equal(state.tokens.has(99), false, 'token row for user 99 must not be persisted');
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
