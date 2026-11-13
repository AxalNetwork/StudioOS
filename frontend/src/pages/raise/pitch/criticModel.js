/**
 * D1557 (#3804): the investor critic's words and its findings as the Check
 * claims sheet (pd25) draws them. Pure.
 */
import { aiTokens } from './newDeckModel';

export const CRITIC_TITLE = 'An investor’s read';
export const CRITIC_LINE = 'Red flags an investor at this stage would raise, from your cards. Rule findings are free; the investor’s own read is one run.';
export const SEVERITY_LABEL = Object.freeze({ deal_breaker: 'Deal-breaker', will_be_asked: 'Will be asked', polish: 'Polish' });
export const SEVERITY_ORDER = Object.freeze(['deal_breaker', 'will_be_asked', 'polish']);
export const NO_FINDINGS = 'No red flags found.';

/** The Ask button's words: the price when the quote is known, never a guessed one. */
export function askLabel(quote) {
  if (quote?.ai !== true) return 'Read as an investor';
  const price = aiTokens(quote.hold_microusd);
  return price ? `Read as an investor · holds ${price}` : 'Read as an investor';
}

/** Findings grouped by severity, in the order a reader acts on them; empty groups left out. */
export function findingGroups(findings) {
  const list = Array.isArray(findings) ? findings : [];
  return SEVERITY_ORDER.map((s) => ({ severity: s, label: SEVERITY_LABEL[s], rows: list.filter((f) => f?.severity === s) }))
    .filter((g) => g.rows.length);
}

/** The benchmark line: the venture's norms when recorded, else the Worker's reason. */
export function benchmarkLine(b) {
  if (b?.available === true && Array.isArray(b.value) && b.value.length) return `Benchmarks: ${b.value.join('; ')}`;
  return b?.reason || 'No stage benchmark recorded';
}

/** What the critic's own run says when it gave no findings of its own. */
export function criticNote(critic) {
  if (!critic || critic.state === 'ok') return null;
  return critic.message || 'The investor’s read did not run.';
}
