/**
 * D232 — `handleStripeConnectEvent` is gone, and the header that promised it
 * says what actually happens.
 *
 * The function was exported, never called, and described by its file's header
 * as dispatched from routes/billing.ts. It was DELETED rather than wired, and
 * this file pins the premises that decision rests on, so that changing either
 * one fails here and forces the question again:
 *   - the endpoint the Stripe console registers is an ACCOUNT endpoint (no
 *     `connect` parameter), so no Connect event reaches the billing route;
 *   - the billing route does not import the Stripe provider.
 * It also pins that the per-connection receiver — what does deliver founder
 * events — still exists, and that the header's "not scheduled" sentence stays
 * true in whichever direction the cron changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import * as stripeProvider from '../src/integrations/providers/stripe.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const STRIPE = read('cloudflare-worker/src/integrations/providers/stripe.ts');
const HEADER = STRIPE.slice(0, STRIPE.indexOf('*/'));
const BILLING = codeOnly(read('cloudflare-worker/src/routes/billing.ts'));
const ADMIN_STRIPE = codeOnly(read('cloudflare-worker/src/routes/admin_stripe.ts'));
const INTEGRATIONS = codeOnly(read('cloudflare-worker/src/routes/integrations.ts'));
const INDEX = codeOnly(read('cloudflare-worker/src/index.ts'));

test('handleStripeConnectEvent no longer exists', () => {
  assert.ok(!('handleStripeConnectEvent' in stripeProvider), 'the dead dispatch is back');
  assert.doesNotMatch(codeOnly(STRIPE), /handleStripeConnectEvent/);
  // What the provider still exports for real callers is untouched.
  assert.equal(typeof (stripeProvider as any).syncStripeForUser, 'function');
});

test('the header no longer claims billing.ts dispatches Connect events, and names the receiver that does deliver', () => {
  assert.doesNotMatch(HEADER, /routes\/billing\.ts dispatches/);
  assert.doesNotMatch(HEADER, /15-min cron\)/, 'the header still promises a cron that is not scheduled');
  assert.match(HEADER, /\/api\/integrations\/webhook\/stripe\/:uid/);
  assert.match(INTEGRATIONS, /integrations\.post\('\/webhook\/:provider\/:uid'/, 'the per-connection receiver is gone');
});

test('premise: no Connect event can reach the billing route', () => {
  // The console registers an account endpoint: a URL and a fixed event list.
  // A `connect` parameter would make it a Connect endpoint, and D232's
  // deletion would need revisiting — with a guard in handleStripeEvent.
  assert.match(ADMIN_STRIPE, /const form: Record<string, string> = \{ url: ourUrl \};/);
  assert.doesNotMatch(ADMIN_STRIPE, /form\[?\s*['"`]?connect/, 'the registered endpoint became a Connect endpoint');
  assert.doesNotMatch(BILLING, /integrations\/providers\/stripe/, 'billing.ts now imports the Stripe provider');
});

test('the header\'s "not scheduled" sentence matches the cron, either way', () => {
  const scheduled = /syncAllStripeIntegrations\s*\(/.test(INDEX);
  assert.equal(HEADER.includes('NOT SCHEDULED'), !scheduled,
    scheduled ? 'the cron now runs the reconcile; correct the header' : 'the header hides that the reconcile is not scheduled');
});
