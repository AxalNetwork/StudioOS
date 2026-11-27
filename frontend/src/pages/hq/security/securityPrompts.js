/**
 * D4803 (#4803, canvas SE12) — what Eadwyn offers first on HQ › Security.
 *
 * The canvas's prompt list (`Security v2 Page.dc.html`, PROMPTS, plus its
 * "Explain why a status is unavailable"), in its order: security work first,
 * so the rail opens on the questions an operator brings here rather than on
 * model economics. Pressing one fills the Ask composer and sends nothing
 * (`WorkerRail`'s `prompts`, D5034 part 4); the rail's structure is #5130's.
 */
export const SECURITY_PROMPTS = Object.freeze([
  'Summarize unresolved security items',
  'Explain the failed restore drill',
  'Identify sessions that warrant review',
  'Summarize events since yesterday',
  'Explain recent refusals',
  'Explain why a status is unavailable',
]);

/** Where the rail sends models, usage and top-up instead of drawing them here (D4811 part 9's `usageAt`). */
export const SECURITY_USAGE_AT = '/account/ai-tokens';
