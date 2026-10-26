/**
 * D1253 (#2428) — the venture scorecard's words and display rules, from the
 * owner's canvas "Venture scorecard" (SC1–SC22): the eleven scopes in their one
 * order, the evidence grades, the band and confidence words, the scope strip's
 * bar rule, and the words of every block no read carries yet. Pure, so
 * `frontend/test/venture_scorecard_d1253.test.mjs` holds each rule.
 *
 * THE ENGINE IS THE WORKER'S. Values, coverage and confidence are computed by
 * `ventureScoring` (part 2) and read through `/api/venture-scores` (part 3).
 * Nothing here computes a score: it turns a scope the Worker returns into the
 * words and the bar the canvas draws, and says "Not read here yet" until then.
 */

/** The eleven scopes, in this order everywhere (#2428 "Scopes and starting weights"). No Overall. */
export const SCOPES = Object.freeze([
  { key: 'team', label: 'Team' },
  { key: 'market', label: 'Market' },
  { key: 'pmf', label: 'Product-market fit' },
  { key: 'technical', label: 'Technical' },
  { key: 'traction', label: 'Traction' },
  { key: 'financial', label: 'Financial' },
  { key: 'risk', label: 'Risk' },
  { key: 'geographic', label: 'Geographic' },
  { key: 'political', label: 'Political and regulatory' },
  { key: 'governance', label: 'Governance' },
  { key: 'legal_ip', label: 'Legal and IP' },
]);
export const SCOPE_LABELS = Object.freeze(SCOPES.map((s) => s.label));

/** Evidence grades: the grade sets confidence, never the value. */
export const GRADES = Object.freeze([
  { key: 'measured', label: 'Measured', factor: 1.0, what: 'A connector fact, or counted from platform records.' },
  { key: 'reviewed', label: 'Reviewed', factor: 0.9, what: 'Set or checked by someone other than the founder.' },
  { key: 'sourced', label: 'Sourced', factor: 0.7, what: 'Typed by the founder with a link, file or citation.' },
  { key: 'stated', label: 'Stated', factor: 0.4, what: 'Typed, with nothing behind it.' },
]);

/** The one Source-to-grade mapping (#2428): PIPE-RAISE's five Source labels and their default grade. */
export const SOURCE_GRADE = Object.freeze({
  connector: 'measured',
  recorded: 'measured',
  signed: 'measured',
  document: 'sourced',
  typed: 'stated',
});

/** Confidence cut-offs. Below Low the scope shows "Not enough recorded" and no number. */
export const CONFIDENCE = Object.freeze([['high', 0.70, 'High'], ['medium', 0.45, 'Medium'], ['low', 0.25, 'Low']]);

/** The band of a value; Risk reads as a risk word on the same cut-offs. */
export function bandOf(value, scopeKey) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const level = v >= 70 ? 0 : v >= 40 ? 1 : 2;
  return scopeKey === 'risk' ? ['Low risk', 'Medium risk', 'High risk'][level] : ['Strong', 'Fair', 'Weak'][level];
}

export const NOT_ENOUGH = 'Not enough recorded';
export const NOT_EXPECTED = 'Not expected yet';
export const NOT_YET = 'Not read here yet';

/**
 * One bar of the scope strip, from one scope the Worker returns
 * (`{ key, value, confidence: 'high'|'medium'|'low'|null, state, coverage }`).
 * 20px tall at 100; violet opacity is the confidence. "Not enough recorded" is a
 * dashed hairline and "Not expected yet" a muted dot; neither is a bar of zero.
 */
export function stripBar(s) {
  if (!s || s.state === 'not_read') return { kind: 'unread' };
  if (s.state === 'not_expected') return { kind: 'dot' };
  if (s.state === 'not_enough' || s.value == null || !s.confidence) return { kind: 'dashed' };
  const h = Math.max(1, Math.round((Math.min(100, Math.max(0, Number(s.value))) / 100) * 20));
  return { kind: 'bar', height: h, opacity: { high: 1, medium: 0.6, low: 0.3 }[s.confidence] ?? 0.3 };
}

/** A bar read as text on hover and focus: "Team 62, Fair, medium confidence, 5 of 6 inputs". */
export function barText(s) {
  const label = (SCOPES.find((x) => x.key === s?.key) || {}).label || 'Scope';
  if (!s || s.state === 'not_read') return `${label}: ${NOT_YET}`;
  if (s.state === 'not_expected') return `${label}: ${NOT_EXPECTED}`;
  if (s.state === 'not_enough' || s.value == null || !s.confidence) return `${label}: ${NOT_ENOUGH}`;
  const cov = s.coverage && s.coverage.of ? `, ${s.coverage.present} of ${s.coverage.of} inputs` : '';
  return `${label} ${Math.round(Number(s.value))}, ${bandOf(s.value, s.key)}, ${s.confidence} confidence${cov}`;
}

/** Every scope in order, unread: what the panel and the strip draw before the read lands. */
export const unreadScopes = () => SCOPES.map((s) => ({ key: s.key, state: 'not_read' }));

export const METHOD = '/scoring/method';
export const FOUNDER_PAGE = '/raise/scorecard';
export const HQ_PAGE = '/admin/platform/scoring';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  scores: 'Each scope’s value, band, confidence and inputs are not read here yet: the engine and model v1 are part 2, the read is part 3.',
  founder: 'Your own scorecard, every input with its source and grade, and “What investors see” are not read here yet (part 5).',
  sharing: 'Who sees your scorecard is not stored yet. Until it is, no investor sees a score of yours (part 3).',
  trajectory: 'The trajectory across model versions is not stored yet (part 5).',
  weighting: 'Your weighting, the sort it drives on the deal list, is not stored yet (parts 3 and 5).',
  models: 'Model versions, their weights and freshness windows, and Publish are not stored yet (parts 2 and 6).',
  indices: 'Country indices for Geographic and Political and regulatory are not imported: the owner chooses the source and its licence first (part 6).',
  fairness: 'The quarterly fairness check by stage, sector, studio and connector use is not computed yet (part 3).',
});
