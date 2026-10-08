/**
 * #1447 — the lifecycle runs Idea, Validate, Build, Launch, Raise, Grow: Raise
 * before Grow, as in the founder sidebar and the owner's blueprint (#1440).
 *
 * Studio's "Do these next" lists the current stage's checklist, and the
 * current stage is either stored or inferred from signals, then moved on only
 * one stage forward by a suggestion. So the order is checked in all three: the
 * stage list, the inference, and each forward suggestion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LIFECYCLE_STAGES, inferStageFromSignals, buildLifecycleSuggestions } from '../src/routes/progress.ts';

const none = {
  landing_published: false, interview_count: 0, latest_mrr: null,
  active_users: null, monthly_churn_pct: null, new_users: null, active_prospects: 0,
};

test('the stages run Idea, Validate, Build, Launch, Raise, Grow', () => {
  assert.deepEqual([...LIFECYCLE_STAGES], ['idea', 'validate', 'build', 'launch', 'raise', 'grow']);
});

test('the inferred stage is the furthest one the signals justify, Grow after Raise', () => {
  assert.equal(inferStageFromSignals(none), 'idea');
  assert.equal(inferStageFromSignals({ ...none, landing_published: true, interview_count: 5 }), 'validate');
  assert.equal(inferStageFromSignals({ ...none, active_prospects: 3 }), 'raise');
  assert.equal(inferStageFromSignals({ ...none, latest_mrr: 1200 }), 'grow');
  // Revenue and investors both: Grow is the later stage now.
  assert.equal(inferStageFromSignals({ ...none, latest_mrr: 1200, active_prospects: 3 }), 'grow');
});

test('each suggestion moves one stage forward in the new order, and never backward', () => {
  const order = [...LIFECYCLE_STAGES];
  const all = { landing_published: true, interview_count: 9, latest_mrr: 1200, active_users: 40, monthly_churn_pct: 2, new_users: 5, active_prospects: 3 };
  for (const stage of order) {
    for (const s of buildLifecycleSuggestions(stage, all)) {
      assert.equal(order.indexOf(s.to), order.indexOf(stage) + 1, `${stage} suggested ${s.to}`);
    }
  }
  assert.deepEqual(buildLifecycleSuggestions('launch', { ...none, active_prospects: 1 }).map((s) => s.to), ['raise']);
  assert.deepEqual(buildLifecycleSuggestions('raise', { ...none, latest_mrr: 500 }).map((s) => s.to), ['grow']);
  // Revenue alone no longer jumps a launched venture past Raise.
  assert.deepEqual(buildLifecycleSuggestions('launch', { ...none, latest_mrr: 500 }), []);
  // Grow is last: nothing after it.
  assert.deepEqual(buildLifecycleSuggestions('grow', all), []);
});
