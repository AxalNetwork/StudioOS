import { userFacingRaiseError } from '../../../lib/raiseErrors.js';

const TOKEN_LINE = 'Your AI balance cannot cover this. Add tokens, then try again.';
const TOKEN_SENTENCES = Object.freeze(Object.fromEntries([
  'budget_user_day', 'budget_user_month', 'budget_org_month', 'budget_review',
  'spend_limit', 'insufficient_tokens', 'out_of_tokens', 'tokens', 'hold_refused',
].map((code) => [code, TOKEN_LINE])));

export const deckSaveFailure = (error) => userFacingRaiseError(error, {
  fallback: 'The deck could not be saved.', scope: 'raise:pitch:deck-save',
});

export const reviewFailure = (error) => userFacingRaiseError(error, {
  fallback: 'The review could not be run. Nothing was saved. Try again.', scope: 'raise:pitch:review',
});

export const ndaFailure = (error) => userFacingRaiseError(error, {
  fallback: 'The NDA could not be recorded. Try again.', scope: 'raise:pitch:share-nda',
});

export const newDeckFailure = (error) => userFacingRaiseError(error, {
  fallback: 'That did not work. Nothing was changed.', sentences: TOKEN_SENTENCES, scope: 'raise:pitch:new-deck',
});
