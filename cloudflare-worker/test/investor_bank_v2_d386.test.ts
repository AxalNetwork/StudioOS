/**
 * D386 — the investor fit bank v2: pick-ones, reverse keys, situational
 * skills and values, and a re-ask line on every question.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIT_INVESTOR_BANK } from '../src/services/advisor/banks/fit_investor.ts';
import { BANK_SIZE_TARGETS } from '../src/services/advisor/questionBank.ts';

const TRAITS = ['builder', 'visionary', 'connector', 'operator'] as const;

test('the investor bank is past the v1 size and names that minimum', () => {
  assert.ok(FIT_INVESTOR_BANK.length >= 82, `bank is ${FIT_INVESTOR_BANK.length}`);
  assert.equal(BANK_SIZE_TARGETS.fitInvestor, FIT_INVESTOR_BANK.length);
});

test('every investor question has re-ask wording', () => {
  const missing = FIT_INVESTOR_BANK.filter((q) => !q.reask_prompt).map((q) => q.id);
  assert.deepEqual(missing, []);
});

test('each trait has at least two reverse-keyed probes', () => {
  for (const trait of TRAITS) {
    const n = FIT_INVESTOR_BANK.filter((q) => q.reverse && q.measures.archetype_trait === trait).length;
    assert.ok(n >= 2, `${trait} has ${n}`);
  }
});

test('a pick-one separates a thesis-led pass from an allocation-rule pass', () => {
  const q = FIT_INVESTOR_BANK.find((x) => x.id === 'fit.investor.arch_inv_pick_outside');
  assert.ok(q, 'the outside-thesis situation is missing');
  const keys = (q!.choices || []).map((c) => c.key);
  assert.ok(keys.includes('thesis') && keys.includes('alloc'), keys.join(','));
  const thesis = q!.choices!.find((c) => c.key === 'thesis')!;
  const alloc = q!.choices!.find((c) => c.key === 'alloc')!;
  assert.equal(thesis.loadings.visionary, 5);
  assert.equal(alloc.loadings.operator, 5);
});

test('engineering, design and marketing each have a situational self-rating', () => {
  const axes = new Set(FIT_INVESTOR_BANK.map((q) => q.measures.skill_axis).filter(Boolean));
  for (const axis of ['engineering', 'design', 'marketing_brand']) {
    assert.ok(axes.has(axis as any), axis);
  }
});

test('risk, growth and the three Schwartz dimensions have a situation', () => {
  const dims = new Set(FIT_INVESTOR_BANK.map((q) => q.measures.value_dim).filter(Boolean));
  for (const dim of ['founder_risk_appetite', 'founder_growth_vs_sustain', 'schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism']) {
    const situational = FIT_INVESTOR_BANK.filter((q) => q.measures.value_dim === dim && q.id.includes('.sit_'));
    assert.ok(situational.length >= 1, dim);
    assert.ok(dims.has(dim as any));
  }
});
