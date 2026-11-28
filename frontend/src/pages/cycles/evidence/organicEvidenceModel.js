/**
 * D5841 part 2 (#5841): the founder's explicit path from Grow's organic report to Raise evidence, on #5842's
 * client (`lib/api/raiseSearchConsoleEvidence.js`). Pure, so `frontend/test/organic_raise_evidence_5841.test.mjs`
 * holds each rule.
 *
 * NOTHING BY VIEWING. Opening the Grow report, the Account connector or this sheet writes nothing. A figure becomes
 * evidence only when a founder previews one whole week, picks one claim and confirms the pin; it starts Private.
 *
 * ONLY ORGANIC CLAIMS. Which claim a figure may back is the Worker's (`searchConsoleMayBack`); this list mirrors it so
 * the picker never offers a claim the pin would refuse. Paying customers, revenue, conversions and traction proof
 * are never offered, whatever the metric.
 */
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';

export const ORGANIC_METRICS = Object.freeze([
  { key: 'clicks', label: 'Organic search clicks' },
  { key: 'impressions', label: 'Organic search impressions' },
  { key: 'ctr', label: 'Organic search CTR (weighted)' },
]);
export const metricLabel = (m) => ORGANIC_METRICS.find((x) => x.key === m)?.label || 'Organic search figure';

/** `raiseSearchConsoleEvidence.ts` SEARCH_CONSOLE_BACKS, less SEARCH_CONSOLE_NEVER_BACKS (which it never contains). */
const BACKS = Object.freeze({
  clicks: ['organic_search', 'organic_search_clicks', 'distribution'],
  impressions: ['organic_search', 'organic_search_impressions', 'distribution'],
  ctr: ['organic_search', 'organic_search_ctr', 'distribution'],
});
export const ORGANIC_CLAIM_KINDS = Object.freeze(['organic_search_clicks', 'organic_search_impressions', 'organic_search_ctr']);
export const mayBack = (metric, claimKind) => !!BACKS[metric]?.includes(claimKind);
/** The claims of this venture's evidence read that this metric may back; none is chosen for the founder. */
export const eligibleClaims = (claims, metric) => (Array.isArray(claims) ? claims : []).filter((c) => c?.uid && mayBack(metric, c.claim_kind));

/** Whole weeks the results read stored in full, newest first: the only weeks a preview can offer. */
export function pinnableWeeks(results) {
  if (!results?.property) return [];
  const weeks = Array.isArray(results.weeks) ? results.weeks : [];
  return weeks.filter((w) => w?.complete === true && /^\d{4}-\d{2}-\d{2}$/.test(String(w.week_start || '')))
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

/** A figure in the metric's unit; never a zero for a missing value. CTR is a ratio, shown as a percentage. */
export function organicFigure(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not recorded';
  if (metric === 'ctr') return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString('en-US');
}
export const windowWords = (w) => (w?.from && w?.to ? `${w.from} to ${w.to} (Pacific Time)` : 'Not recorded');
export function coverageWords(c) {
  if (!c) return 'Coverage not recorded';
  const days = Number(c.days) || 7;
  const missing = Number(c.days_not_returned) || 0;
  return `${c.days_reported} of ${days} days reported${missing ? `, ${missing} with no row from Google (not zero)` : ''}`;
}

/**
 * Where a pinned figure stands. `current` and `corrected` come from part 1's recheck on every read; `withdrawn` and
 * `replaced` are closed. Only a current selection may be withdrawn, and only a corrected one re-reviewed.
 */
const STATES = Object.freeze({
  current: { word: 'Current', tone: 'ok', detail: 'Google has not changed this week since you pinned it.' },
  corrected: { word: 'Corrected by Google: re-review', tone: 'warn', detail: 'Google revised a day of this week. The pinned figure left every shared view until you re-review it.' },
  missing: { word: 'No longer stored in full', tone: 'warn', detail: 'This week is no longer stored in full, so it cannot be re-reviewed. Withdraw it, or pin another week.' },
  revoked: { word: 'Access lost', tone: 'bad', detail: 'The property is no longer this venture’s, or its access was lost. It left every shared view.' },
  withdrawn: { word: 'Withdrawn', tone: 'muted', detail: 'Unpinned, Private and removed from its claim. Investors no longer see it.' },
  replaced: { word: 'Replaced after re-review', tone: 'muted', detail: 'A re-reviewed figure for the same week replaced this one.' },
});
export function selectionState(sel) {
  const closed = sel?.status && sel.status !== 'current';
  const key = closed ? sel.status : sel?.source?.state;
  const s = STATES[key] || { word: 'Not checked', tone: 'muted', detail: 'Where this figure stands could not be read.' };
  return {
    key: STATES[key] ? key : 'unknown', ...s,
    stale: sel?.source?.stale === true,
    canWithdraw: sel?.status === 'current',
    canReview: sel?.status === 'current' && sel?.source?.state === 'corrected',
  };
}

/** Grow's and the claim drawer's way in: the Evidence page with the sheet open, a week or claim pre-chosen. */
export function organicSearch(search = '', { week = null, claim = null } = {}) {
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  p.set('organic', week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : 'open');
  if (claim) p.set('organic_claim', String(claim)); else p.delete('organic_claim');
  return `?${p.toString()}`;
}
export const organicHref = (projectId, week = null) => `/raise/evidence${organicSearch(`project_id=${encodeURIComponent(projectId)}`, { week })}`;

const CODE_COPY = Object.freeze({
  search_console_unavailable: 'Search Console is unavailable until its app is approved. Nothing was pinned or changed.',
  changed: 'The figure changed since you previewed it. Preview the week again before you pin it.',
  forbidden: 'Only this venture’s founders can choose Search Console evidence.',
});
const codeOf = (e) => e?.code || e?.data?.error || null;
/** Never the raw error: the Worker's own refusal sentence (D5070 rule 2) or one of these. */
export function organicError(e, fallback = 'Nothing was saved. Try again.') {
  return CODE_COPY[codeOf(e)] || userFacingRaiseError(e, { fallback });
}
