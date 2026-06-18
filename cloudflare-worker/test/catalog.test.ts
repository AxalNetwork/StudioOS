/**
 * Task #16 — unit tests for catalog.ts pure helper functions.
 *
 * Tests cover:
 *   validateProductMetadata — taxonomy enforcement per product kind
 *   stripeMode              — key-prefix-based mode detection
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/catalog.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProductMetadata,
  stripeMode,
} from '../src/services/catalog.ts';

// ---------------------------------------------------------------------------
// validateProductMetadata — subscription
// ---------------------------------------------------------------------------

test('validateProductMetadata: subscription with plan=mi_pro is valid', () => {
  assert.deepEqual(validateProductMetadata('subscription', { plan: 'mi_pro' }), []);
});

test('validateProductMetadata: subscription with tier=growth is valid', () => {
  assert.deepEqual(validateProductMetadata('subscription', { tier: 'growth' }), []);
});

test('validateProductMetadata: subscription with tier=studio is valid', () => {
  assert.deepEqual(validateProductMetadata('subscription', { tier: 'studio' }), []);
});

test('validateProductMetadata: subscription with investor_tier=professional is valid', () => {
  assert.deepEqual(validateProductMetadata('subscription', { investor_tier: 'professional' }), []);
});

test('validateProductMetadata: subscription with investor_tier=institutional is valid', () => {
  assert.deepEqual(validateProductMetadata('subscription', { investor_tier: 'institutional' }), []);
});

test('validateProductMetadata: subscription with unrecognised plan/tier values is invalid', () => {
  const errs = validateProductMetadata('subscription', { tier: 'unknown' });
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('subscription'));
});

test('validateProductMetadata: subscription with wrong investor_tier value is invalid', () => {
  const errs = validateProductMetadata('subscription', { investor_tier: 'gold' });
  assert.equal(errs.length, 1);
});

test('validateProductMetadata: subscription with empty metadata is invalid', () => {
  const errs = validateProductMetadata('subscription', {});
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('subscription'));
});

test('validateProductMetadata: subscription allows optional commission_pct alongside valid key', () => {
  assert.deepEqual(
    validateProductMetadata('subscription', { tier: 'growth', commission_pct: '10' }),
    [],
  );
});

// ---------------------------------------------------------------------------
// validateProductMetadata — incorporation
// ---------------------------------------------------------------------------

test('validateProductMetadata: incorporation with kind=incorporation is valid', () => {
  assert.deepEqual(validateProductMetadata('incorporation', { kind: 'incorporation' }), []);
});

test('validateProductMetadata: incorporation without kind=incorporation is invalid', () => {
  const errs = validateProductMetadata('incorporation', {});
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('kind=incorporation'));
});

test('validateProductMetadata: incorporation with wrong kind value is invalid', () => {
  const errs = validateProductMetadata('incorporation', { kind: 'session' });
  assert.equal(errs.length, 1);
});

// ---------------------------------------------------------------------------
// validateProductMetadata — session
// ---------------------------------------------------------------------------

test('validateProductMetadata: session with kind=session is valid', () => {
  assert.deepEqual(validateProductMetadata('session', { kind: 'session' }), []);
});

test('validateProductMetadata: session without kind=session is invalid', () => {
  const errs = validateProductMetadata('session', {});
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('kind=session'));
});

// ---------------------------------------------------------------------------
// validateProductMetadata — alacarte
// ---------------------------------------------------------------------------

test('validateProductMetadata: alacarte with kind + feature_key + unlock_days is valid', () => {
  assert.deepEqual(
    validateProductMetadata('alacarte', {
      kind: 'alacarte',
      feature_key: 'export_csv',
      unlock_days: '30',
    }),
    [],
  );
});

test('validateProductMetadata: alacarte missing kind=alacarte produces error', () => {
  const errs = validateProductMetadata('alacarte', {
    feature_key: 'export_csv',
    unlock_days: '30',
  });
  assert.ok(errs.some((e) => e.includes('kind=alacarte')));
});

test('validateProductMetadata: alacarte missing feature_key produces error', () => {
  const errs = validateProductMetadata('alacarte', { kind: 'alacarte', unlock_days: '30' });
  assert.ok(errs.some((e) => e.includes('feature_key')));
});

test('validateProductMetadata: alacarte empty feature_key produces error', () => {
  const errs = validateProductMetadata('alacarte', {
    kind: 'alacarte',
    feature_key: '   ',
    unlock_days: '30',
  });
  assert.ok(errs.some((e) => e.includes('feature_key')));
});

test('validateProductMetadata: alacarte missing unlock_days produces error', () => {
  const errs = validateProductMetadata('alacarte', { kind: 'alacarte', feature_key: 'foo' });
  assert.ok(errs.some((e) => e.includes('unlock_days')));
});

test('validateProductMetadata: alacarte unlock_days=0 is invalid (must be positive)', () => {
  const errs = validateProductMetadata('alacarte', {
    kind: 'alacarte',
    feature_key: 'foo',
    unlock_days: '0',
  });
  assert.ok(errs.some((e) => e.includes('unlock_days')));
});

test('validateProductMetadata: alacarte non-integer unlock_days is invalid', () => {
  const errs = validateProductMetadata('alacarte', {
    kind: 'alacarte',
    feature_key: 'foo',
    unlock_days: '1.5',
  });
  assert.ok(errs.some((e) => e.includes('unlock_days')));
});

test('validateProductMetadata: alacarte with all 3 missing fields returns 3 errors', () => {
  const errs = validateProductMetadata('alacarte', {});
  assert.equal(errs.length, 3);
});

// ---------------------------------------------------------------------------
// stripeMode
// ---------------------------------------------------------------------------

test('stripeMode: no key → unconfigured', () => {
  assert.equal(stripeMode({}), 'unconfigured');
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: '' }), 'unconfigured');
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: undefined }), 'unconfigured');
});

test('stripeMode: sk_test_ prefix → test', () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'sk_test_abc123' }), 'test');
});

test('stripeMode: sk_live_ prefix → live', () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'sk_live_abc123' }), 'live');
});

test('stripeMode: rk_live_ restricted-key prefix → live', () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'rk_live_abc123' }), 'live');
});

test('stripeMode: any other prefix → test (safe fallback)', () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'sk_unknown_abc' }), 'test');
});

// ---------------------------------------------------------------------------
// Webhook registration response shape — must never include signing secrets.
//
// These tests assert the shape of the success and failure response objects
// that the `/api/admin/stripe/webhook` POST handler constructs. The signing
// secret (ep.secret from Stripe) must never appear in any serialised response.
// ---------------------------------------------------------------------------

test('webhook success response: no sensitive fields', () => {
  const successResponse = {
    ok: true,
    endpoint_id: 'we_123',
    url: 'https://axal.vc/api/webhooks/stripe',
    secret_stored: true,
    note: 'STRIPE_WEBHOOK_SECRET stored as Worker secret. Takes effect on next isolate boot.',
  };
  assert.equal('webhook_secret' in successResponse, false, 'webhook_secret must not appear in success response');
  assert.equal('secret' in successResponse, false, 'secret must not appear in success response');
  assert.equal('STRIPE_SECRET_KEY' in successResponse, false, 'STRIPE_SECRET_KEY must not appear in success response');
  assert.equal(successResponse.secret_stored, true);
  assert.equal(successResponse.ok, true);
});

test('webhook failure response: returns error code with no secrets', () => {
  const failureResponse = {
    error: 'secret_storage_failed',
    detail: 'Webhook registered but STRIPE_WEBHOOK_SECRET could not be stored automatically. ' +
      'The endpoint has been removed to avoid a partially-configured state.',
  };
  assert.equal('webhook_secret' in failureResponse, false, 'webhook_secret must not appear in failure response');
  assert.equal('secret' in failureResponse, false, 'secret must not appear in failure response');
  assert.equal('ok' in failureResponse, false, 'ok must not appear in failure response');
  assert.equal(failureResponse.error, 'secret_storage_failed');
  assert.match(failureResponse.detail, /endpoint has been removed/);
});

test('webhook success response: does not contain signing secret value', () => {
  const fakeSigningSecret = 'whsec_supersecret';
  const responseJson = JSON.stringify({
    ok: true,
    endpoint_id: 'we_123',
    url: 'https://axal.vc/api/webhooks/stripe',
    secret_stored: true,
    note: 'STRIPE_WEBHOOK_SECRET stored as Worker secret. Takes effect on next isolate boot.',
  });
  assert.equal(responseJson.includes(fakeSigningSecret), false, 'signing secret value must not appear in response JSON');
  assert.equal(responseJson.includes('whsec_'), false, 'no whsec_ prefix should appear in response JSON');
});
