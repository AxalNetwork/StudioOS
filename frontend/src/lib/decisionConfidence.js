// #3938 (task 4 of #3721's model use-case plan): a Clef decision's probability,
// as the page shows it beside the decision. Null when none was recorded (a
// rule-based gate, or one written before the column): never a guessed figure,
// never "0%". The Worker's `services/ai/decide.ts` `confidenceLine` says the same.
export function confidenceLine(p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return `${Math.round(p * 100)}% likely`;
}
