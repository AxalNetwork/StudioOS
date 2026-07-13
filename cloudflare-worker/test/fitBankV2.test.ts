/**
 * Fit v2 — bank integrity tests. The bank is data; these tests pin its
 * structural contract so authoring mistakes fail CI instead of silently
 * degrading scoring:
 *   - id scheme + uniqueness per bank and across banks;
 *   - module composition (30 values / 24 archetypes / 24 skills /
 *     16 validation / 3 context / 8 role add-ons);
 *   - every validation_pair resolves inside its own bank;
 *   - choice kinds always carry ≥2 options with unique keys;
 *   - chat-safe degrade fields (input_kind/validate/options labels);
 *   - v1 `measures` only where truthful (archetype_trait ⊆ v1 traits,
 *     red_flag ⊆ v1 RED_FLAGS) so v1 scoring cannot drift;
 *   - v1-pipeline visibility: five-persona prefixes match FIT_ID_RE,
 *     staged-only prefixes never do;
 *   - the conversational chat slice stays deliberately small.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BANKS,
  FIT_ID_RE,
  FIT_V2_ID_RE,
  bankFor,
  fitV2BankFor,
  fitV2ChatSlice,
  fitV2Stages,
  profilingBankFor,
  type Question,
} from '../src/services/advisor/questionBank.ts';
import { FIT_ROLE_CONTEXTS } from '../src/services/fitRoles.ts';
import { AXAL_VALUES, RED_FLAGS } from '../src/services/axalFit.ts';
import { ARCHETYPE_TRAITS } from '../src/services/archetypeScoring.ts';

const OPTION_KINDS = new Set(['forced_choice', 'sjt', 'tradeoff', 'rank_order', 'multi_select']);
const KIND_TO_INPUT: Record<string, string> = {
  likert: 'scale', confidence_check: 'scale',
  forced_choice: 'select', sjt: 'select', tradeoff: 'select', rank_order: 'select',
  multi_select: 'multi', behavioral_evidence: 'long',
};

const MODULE_COUNTS: Record<string, number> = {
  context: 3, values: 30, archetypes: 24, skills: 24, validation: 16, role: 8,
};

for (const role of FIT_ROLE_CONTEXTS) {
  test(`bank[${role}]: structure, ids, pairs, options, degrade fields`, () => {
    const bank = fitV2BankFor(role, { coreOnly: false });
    assert.ok(bank.length > 0, 'bank resolves');

    // Composition.
    const byModule = new Map<string, number>();
    for (const q of bank) {
      assert.ok(q.fit_v2, `${q.id} carries fit_v2`);
      byModule.set(q.fit_v2!.module, (byModule.get(q.fit_v2!.module) || 0) + 1);
    }
    for (const [mod, want] of Object.entries(MODULE_COUNTS)) {
      assert.equal(byModule.get(mod), want, `${role}: ${mod} count`);
    }
    assert.equal(bank.length, Object.values(MODULE_COUNTS).reduce((a, b) => a + b, 0));

    // Ids: scheme + uniqueness.
    const ids = new Set<string>();
    for (const q of bank) {
      assert.ok(FIT_V2_ID_RE.test(q.id), `${q.id} matches FIT_V2_ID_RE`);
      assert.ok(!ids.has(q.id), `${q.id} unique`);
      ids.add(q.id);
    }

    // Validation pairs resolve in-bank; validation items are reverse-keyed likerts
    // or explicitly structured probes.
    for (const q of bank) {
      const pair = q.fit_v2?.validation_pair;
      if (pair) assert.ok(ids.has(pair), `${q.id} pair ${pair} resolves`);
    }
    const pairs = bank.filter((q) => q.fit_v2?.validation_pair);
    assert.ok(pairs.length >= 6, 'at least the six reverse pairs exist');

    // Options + chat degrade.
    for (const q of bank) {
      const v2 = q.fit_v2!;
      assert.equal(q.input_kind, KIND_TO_INPUT[v2.kind], `${q.id} input_kind degrade`);
      if (OPTION_KINDS.has(v2.kind)) {
        const opts = v2.options_v2 || [];
        assert.ok(opts.length >= 2, `${q.id} has ≥2 options`);
        assert.equal(new Set(opts.map((o) => o.key)).size, opts.length, `${q.id} option keys unique`);
        assert.deepEqual(q.options, opts.map((o) => o.label), `${q.id} labels mirrored for chat`);
      }
      if (v2.kind === 'behavioral_evidence') {
        assert.ok((v2.evidence?.min_len ?? 0) >= 80, `${q.id} evidence min_len sane`);
      }
      assert.equal(q.importance, 'low', `${q.id} trails onboarding questions`);
      assert.equal(q.skip_allowed !== false, true, `${q.id} skippable`);
    }

    // v1 measures only where truthful.
    for (const q of bank) {
      const m = q.measures;
      if (!m) continue;
      assert.ok(!m.rubric_category && !m.skill_axis && !m.value_dim && !m.axal_value,
        `${q.id}: v2 items must not double-write v1 sinks via measures`);
      if (m.archetype_trait) {
        assert.ok((ARCHETYPE_TRAITS as readonly string[]).includes(m.archetype_trait),
          `${q.id}: archetype_trait ∈ v1 traits`);
        assert.equal(q.fit_v2!.kind, 'likert', `${q.id}: v1 trait enrichment is numeric-only`);
      }
      if (m.red_flag) {
        assert.ok((RED_FLAGS as readonly string[]).includes(m.red_flag.key as never),
          `${q.id}: red_flag key ∈ v1 RED_FLAGS`);
        assert.equal(m.red_flag.at_or_below, 1, `${q.id}: house threshold`);
      }
    }

    // Option-level flags stay in the v1 vocabulary too.
    for (const q of bank) {
      for (const o of q.fit_v2?.options_v2 || []) {
        if (o.flag) assert.ok((RED_FLAGS as readonly string[]).includes(o.flag as never), `${q.id}/${o.key} flag ∈ RED_FLAGS`);
      }
    }

    // Every v2 value key referenced is one of the six.
    const VALUES = new Set([...AXAL_VALUES, 'ambition']);
    for (const q of bank) {
      if (q.fit_v2?.value_key) assert.ok(VALUES.has(q.fit_v2.value_key), `${q.id} value_key`);
    }

    // Stages partition the bank in canonical order.
    const stages = fitV2Stages(bank);
    assert.deepEqual(stages.map((s) => s.key), ['context', 'values', 'archetypes', 'skills', 'validation']);
    assert.equal(stages.reduce((a, s) => a + s.ids.length, 0), bank.length);

    // Core subset lands in the intended band.
    const core = fitV2BankFor(role, { coreOnly: true });
    assert.ok(core.length >= 45 && core.length <= 70, `${role}: core size ${core.length}`);

    // v1-pipeline visibility by prefix.
    const v1Visible = FIT_ID_RE.test(bank[0].id);
    if (role === 'internal_hire' || role === 'portfolio_talent') {
      assert.equal(v1Visible, false, `${role} is invisible to v1`);
      for (const q of bank) assert.ok(!FIT_ID_RE.test(q.id));
    } else {
      for (const q of bank) assert.ok(FIT_ID_RE.test(q.id), `${q.id} rides the v1 rails`);
    }
  });
}

test('conversational slice: small, tradeoff/forced-choice-heavy, values+archetypes only', () => {
  for (const persona of ['founder', 'investor', 'partner', 'advisor'] as const) {
    const bankName = persona === 'partner' ? 'fitV2Partner' : persona === 'founder' ? 'fitV2Founder' : persona === 'investor' ? 'fitV2Investor' : 'fitV2Advisor';
    const slice = fitV2ChatSlice(BANKS[bankName]);
    assert.ok(slice.length >= 10 && slice.length <= 30, `${persona}: chat slice ${slice.length}`);
    for (const q of slice) {
      assert.ok(['values', 'archetypes'].includes(q.fit_v2!.module), `${q.id} chat slice module`);
      assert.notEqual(q.fit_v2!.kind, 'behavioral_evidence', `${q.id} no long-form in chat slice`);
    }
    // The slice rides the conversation.
    const ids = bankFor(persona).map((q) => q.id);
    for (const q of slice) assert.ok(ids.includes(q.id), `${q.id} served by bankFor(${persona})`);
  }
});

test('v1 surfaces stay untouched: profiling completion bank carries no v2 items', () => {
  for (const persona of ['founder', 'investor', 'partner', 'advisor'] as const) {
    const ids = profilingBankFor(persona).map((q) => q.id);
    assert.ok(ids.length > 0);
    assert.ok(!ids.some((id) => FIT_V2_ID_RE.test(id)), `${persona} completion card unchanged`);
  }
});

test('admin and explorer conversations carry no v2 items', () => {
  assert.ok(!bankFor('admin').some((q: Question) => FIT_V2_ID_RE.test(q.id)));
  assert.ok(!bankFor('explorer').some((q: Question) => FIT_V2_ID_RE.test(q.id)));
});
