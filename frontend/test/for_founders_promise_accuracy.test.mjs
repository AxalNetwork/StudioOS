/**
 * `/for-founders` (productPages.js + pricing.js) made two promises that
 * didn't match the code:
 *
 *   1. "AI scoring (5 runs / month)" on the Free/Starter plan. The real gate
 *      — scoring.ts:82-90 — is `ensureTier(user, 'growth')` for every founder
 *      request, sandbox or official, with the SOLE exception of a sandbox run
 *      by role `exploring` (a pre-founder holding state, not "free tier").
 *      A free-tier founder gets zero scoring runs, not five, and there is no
 *      monthly counter anywhere in the worker.
 *
 *   2. "Qualified Pro founders are introduced to investors" — both in the
 *      Pro-plan extraFeatures and the FAQ. trust.ts's actual eligibility
 *      check (requestIntroLogic) never reads `subscription_tier`; only role,
 *      NDA state and the investor's own quota matter. The page's own
 *      liveFeatures list (line ~144) already said this correctly — un-gated
 *      by plan — one section of the same page contradicted another.
 *
 * This doesn't re-verify the worker (that's scoring.ts / trust.ts's own
 * tests); it pins that the FRONTEND no longer makes either false claim, and
 * that the two truths — free means zero scoring, intros are plan-agnostic —
 * are stated once, consistently, not stated one way in one spot and another
 * way twenty lines later.
 *
 * Run with:  node --test frontend/test/for_founders_promise_accuracy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PRICING = read('../src/data/pricing.js');
const PRODUCT = read('../src/data/productPages.js');
const SCORING_ROUTE = read('../../cloudflare-worker/src/routes/scoring.ts');
const TRUST_ROUTE = read('../../cloudflare-worker/src/routes/trust.ts');

// --- ground truth, so a future change to the gate itself fails this test
//     loudly instead of leaving the marketing copy quietly wrong again -----

test('the worker still gates founder scoring behind Growth tier', () => {
  assert.match(SCORING_ROUTE, /ensureTier\(user, 'growth'\)/);
  assert.match(SCORING_ROUTE, /isSandbox && user\.role === 'exploring'/,
    'the sandbox exemption is for role exploring specifically, not free founders');
});

test('the worker still never gates investor intros by subscription_tier', () => {
  assert.doesNotMatch(TRUST_ROUTE, /subscription_tier/);
});

// --- the free tier no longer claims scoring it doesn't grant -------------

test('the free/Starter plan no longer advertises "5 runs / month" scoring', () => {
  for (const src of [PRICING, PRODUCT]) {
    assert.doesNotMatch(src, /\d+\s*runs?\s*\/\s*mo(nth)?/i);
    assert.doesNotMatch(src, /AI scoring \(5 runs/i);
  }
});

test('Growth is still where scoring is actually advertised — nothing was silently dropped', () => {
  // TIER_PLANS.growth.features in PaywallModal.jsx is the single source of
  // truth pricing.js/productPages.js both inherit from; this just confirms
  // the fix didn't accidentally remove the TRUE claim along with the false one.
  const PAYWALL = read('../src/components/PaywallModal.jsx');
  assert.match(PAYWALL, /AI scoring/);
});

// --- investor intros are no longer claimed as Pro-exclusive --------------

test('no plan is claimed as a prerequisite for investor introductions', () => {
  // Line-scoped (no dotall) — the page separately and correctly says
  // "Qualified founders get introduced..." with no plan mentioned at all
  // (that sentence is untouched and should stay), so this must not span
  // lines and accidentally bridge that with an unrelated later "Pro".
  assert.doesNotMatch(PRODUCT, /^.*Qualified.*Pro.*(?:introduced|investor).*$/im);
  assert.doesNotMatch(PRODUCT, /Pro founders are introduced/i);
});

test('the FAQ states intros are not plan-gated, matching liveFeatures', () => {
  const faqStart = PRODUCT.indexOf("q: 'How do investor introductions work?'");
  assert.notEqual(faqStart, -1, 'FAQ question not found — did the copy move?');
  const faqAnswer = PRODUCT.slice(faqStart, PRODUCT.indexOf('},', faqStart));
  assert.match(faqAnswer, /not gated by plan/);

  // liveFeatures already said this correctly before the fix — pin that the
  // two sections of the same page now agree instead of just moving the
  // contradiction around.
  assert.match(PRODUCT, /Warm founder → investor introductions \(three-way NDA gated\)/);
});

test('the Pro plan no longer lists investor intros as one of its extras', () => {
  // It's a liveFeature available to every founder (see above), so listing it
  // again as a Pro-only "extra" is the exact contradiction being fixed.
  const proStart = PRODUCT.indexOf("id: 'pro'");
  const proBlock = PRODUCT.slice(proStart, PRODUCT.indexOf('}),', proStart));
  assert.doesNotMatch(proBlock, /warm investor introductions/i);
  // The one thing that WAS an honest roadmap item stays.
  assert.match(proBlock, /AI pitch deck reviewer/);
});
