// The strategic category in Refer & Earn has its own access decision.
// The request endpoint can return an existing decision instead of "requested".
const decisionMessages = new Map([
  ['requested', 'Your request for strategic referral access is under review.'],
  ['granted', 'You can submit strategic and capital introductions.'],
  ['declined', 'Your request for strategic referral access was declined.'],
]);

export const strategicDecisionMessage = (state) => decisionMessages.get(state) ?? null;
export const canRequestStrategicAccess = (state, sending = false) => state === 'none' && !sending;

export function referralCategories(overview) {
  if (!Array.isArray(overview?.categories)) return [];
  return overview.categories.filter((category) =>
    typeof category?.key === 'string' && typeof category.name === 'string');
}

export function applyStrategicAccess(overview, state) {
  if (!decisionMessages.has(state)) return overview;
  return {
    ...overview,
    strategic_access: state,
    categories: referralCategories(overview).map((category) =>
      category.key === 'strategic' ? { ...category, locked: state !== 'granted' } : category),
  };
}
