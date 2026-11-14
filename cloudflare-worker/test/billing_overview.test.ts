/**
 * Task #25 — unit tests for the billing-overview resilience helpers.
 *
 * These cover the pure decision logic that keeps Settings → Billing rendering
 * when a Stripe call fails (instead of 502-ing the whole tab with
 * `overview_failed`):
 *   StripeApiError      — parses HTTP status + Stripe error code/type from body
 *   classifyStripeError — maps a throw to resource_missing | auth | other
 *   resolveCoreOutcome  — maps per-section failures to the overview outcome
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/billing_overview.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StripeApiError,
  classifyStripeError,
  resolveCoreOutcome,
} from '../src/util/stripeError.ts';

// ---------------------------------------------------------------------------
// StripeApiError
// ---------------------------------------------------------------------------

test('StripeApiError: parses status, code and type from a JSON Stripe body', () => {
  const body = JSON.stringify({
    error: { code: 'resource_missing', type: 'invalid_request_error', message: 'No such customer: cus_x' },
  });
  const e = new StripeApiError(404, body);
  assert.equal(e.status, 404);
  assert.equal(e.code, 'resource_missing');
  assert.equal(e.type, 'invalid_request_error');
});

test('StripeApiError: keeps the legacy stripe_error:STATUS:body message shape', () => {
  const e = new StripeApiError(500, 'oops');
  assert.ok(e.message.startsWith('stripe_error:500:'));
  assert.ok(e instanceof Error);
});

test('StripeApiError: non-JSON body leaves code/type null', () => {
  const e = new StripeApiError(503, '<html>gateway timeout</html>');
  assert.equal(e.code, null);
  assert.equal(e.type, null);
  assert.equal(e.status, 503);
});

// ---------------------------------------------------------------------------
// classifyStripeError
// ---------------------------------------------------------------------------

test('classifyStripeError: resource_missing code → resource_missing', () => {
  const e = new StripeApiError(404, JSON.stringify({ error: { code: 'resource_missing' } }));
  assert.equal(classifyStripeError(e), 'resource_missing');
});

test('classifyStripeError: 401 status → auth', () => {
  const e = new StripeApiError(401, JSON.stringify({ error: { message: 'Invalid API Key provided' } }));
  assert.equal(classifyStripeError(e), 'auth');
});

test('classifyStripeError: authentication_error type → auth', () => {
  const e = new StripeApiError(403, JSON.stringify({ error: { type: 'authentication_error' } }));
  assert.equal(classifyStripeError(e), 'auth');
});

test('classifyStripeError: api_key_expired code → auth', () => {
  const e = new StripeApiError(401, JSON.stringify({ error: { code: 'api_key_expired' } }));
  assert.equal(classifyStripeError(e), 'auth');
});

test('classifyStripeError: generic 500 → other', () => {
  const e = new StripeApiError(500, JSON.stringify({ error: { type: 'api_error' } }));
  assert.equal(classifyStripeError(e), 'other');
});

test('classifyStripeError: legacy "No such customer" message string → resource_missing', () => {
  const e = new Error('stripe_error:404:{"error":{"message":"No such customer: cus_x"}}');
  assert.equal(classifyStripeError(e), 'resource_missing');
});

test('classifyStripeError: legacy 401 message string → auth', () => {
  const e = new Error('stripe_error:401:{"error":{"message":"Invalid API Key"}}');
  assert.equal(classifyStripeError(e), 'auth');
});

test('classifyStripeError: a non-Stripe throw → other', () => {
  assert.equal(classifyStripeError(new Error('network down')), 'other');
  assert.equal(classifyStripeError(null), 'other');
  assert.equal(classifyStripeError('boom'), 'other');
});

// ---------------------------------------------------------------------------
// resolveCoreOutcome  (null = section succeeded)
// ---------------------------------------------------------------------------

test('resolveCoreOutcome: all sections ok → ok', () => {
  assert.equal(resolveCoreOutcome([null, null, null, null]), 'ok');
});

test('resolveCoreOutcome: any resource_missing → customer_missing (self-heal + empty)', () => {
  assert.equal(resolveCoreOutcome([null, 'resource_missing', null, null]), 'customer_missing');
});

test('resolveCoreOutcome: resource_missing wins over auth', () => {
  assert.equal(resolveCoreOutcome(['auth', 'resource_missing', null, null]), 'customer_missing');
});

test('resolveCoreOutcome: any auth (no resource_missing) → unavailable', () => {
  assert.equal(resolveCoreOutcome([null, null, 'auth', null]), 'unavailable');
});

test('resolveCoreOutcome: a single other failure → ok (degrade that section)', () => {
  assert.equal(resolveCoreOutcome([null, 'other', null, null]), 'ok');
});

test('resolveCoreOutcome: every section failed (all other) → unavailable, not a misleading empty page', () => {
  assert.equal(resolveCoreOutcome(['other', 'other', 'other', 'other']), 'unavailable');
});
