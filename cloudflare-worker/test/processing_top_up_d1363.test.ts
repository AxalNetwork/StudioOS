/**
 * D1363: a session whose processing stopped because the AI allowance and the
 * top-up balance could not cover it says so, so the page can offer Top up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { processingOf } from '../src/services/interviewProcessing.ts';
import { NOT_ENOUGH_TOKENS, budgetRefusalMessage } from '../src/services/aiRouter.ts';

test('top_up is true only for a run stopped for want of tokens', () => {
  // Mutation checked: top_up = stage === 'failed' → the unreadable-recording case reads true.
  assert.equal(budgetRefusalMessage('budget_user_month'), NOT_ENOUGH_TOKENS, 'the refusal the session stores is the one top_up reads');
  const of = (stage: string, error: string | null) => processingOf({ processing_stage: stage, processing_error: error } as any).top_up;
  assert.equal(of('failed', NOT_ENOUGH_TOKENS), true);
  assert.equal(of('failed', 'The recording could not be read. Nothing was transcribed.'), false);
  assert.equal(of('failed', budgetRefusalMessage('ai_paused')), false, 'a pause is not fixed by buying tokens');
  assert.equal(of('transcribing', null), false);
});
