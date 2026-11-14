/**
 * Unit tests for the persona (account-plan) billing routing helpers.
 *
 * These cover the pure decision logic the /api/billing/plan/* routes and the
 * Stripe webhook depend on:
 *   planGroupForRole          — role → plan_group (or null for dedicated roles)
 *   accountFieldsFromStripeSub — Stripe subscription object → normalised fields
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/account_plans.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planGroupForRole, accountFieldsFromStripeSub } from '../src/services/accountPlans.ts';

// ---------------------------------------------------------------------------
// planGroupForRole
// ---------------------------------------------------------------------------

test('planGroupForRole: founder/investor have dedicated pipelines → null', () => {
  assert.equal(planGroupForRole('founder'), null);
  assert.equal(planGroupForRole('investor'), null);
  assert.equal(planGroupForRole('INVESTOR'), null); // case-insensitive
});

test('planGroupForRole: partner maps to its own group; advisor maps to advisor', () => {
  assert.equal(planGroupForRole('partner'), 'partner');
  assert.equal(planGroupForRole('advisor'), 'advisor');
  assert.equal(planGroupForRole('Advisor'), 'advisor');
});

test('planGroupForRole: any other role defaults to its own name (generic)', () => {
  assert.equal(planGroupForRole('admin'), 'admin');
  assert.equal(planGroupForRole('reviewer'), 'reviewer');
});

test('planGroupForRole: empty / nullish → null', () => {
  assert.equal(planGroupForRole(''), null);
  assert.equal(planGroupForRole(null), null);
  assert.equal(planGroupForRole(undefined), null);
});

// ---------------------------------------------------------------------------
// accountFieldsFromStripeSub
// ---------------------------------------------------------------------------

test('accountFieldsFromStripeSub: maps status + unix seconds to ISO', () => {
  const periodEndUnix = 1_800_000_000; // fixed
  const trialEndUnix = 1_790_000_000;
  const f = accountFieldsFromStripeSub({
    status: 'trialing',
    current_period_end: periodEndUnix,
    trial_end: trialEndUnix,
  });
  assert.equal(f.status, 'trialing');
  assert.equal(f.periodEnd, new Date(periodEndUnix * 1000).toISOString());
  assert.equal(f.trialEnd, new Date(trialEndUnix * 1000).toISOString());
});

test('accountFieldsFromStripeSub: missing status defaults to active; missing dates → null', () => {
  const f = accountFieldsFromStripeSub({});
  assert.equal(f.status, 'active');
  assert.equal(f.periodEnd, null);
  assert.equal(f.trialEnd, null);
});
