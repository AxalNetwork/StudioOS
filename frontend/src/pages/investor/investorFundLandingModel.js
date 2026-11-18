/**
 * #6232 — what the Fund overview (`/funds`) says, kept true. Pure.
 *
 * Called and Collected are two facts: called is what the fund's calls asked
 * for (`called_cents`), collected is what its dated receipts recorded
 * (`collected_cents`, null when none is recorded, with the rollup's reason).
 * A legacy LP row with no commitment recorded carries `commitment_amount` 0 or
 * null, and that reads Not recorded, never $0. Legacy LP amounts are USD
 * dollars (`limited_partners.commitment_amount`, D370's money convention).
 */
import { fmtCents, fmtMultiple, fmtRate } from '../../lib/fundAnalytics';
import { majorToMinor } from '../../lib/money';
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };
export const COLLECTED_REASON_DEFAULT = 'No dated capital-call receipts are recorded.';

/** `{ value, reason }`: the collected amount, or Not recorded and why. */
export function collectedLine(fund) {
  const c = fund?.collected_cents;
  if (c == null || !Number.isFinite(Number(c))) {
    return { value: null, reason: String(fund?.capital_reason || '').trim() || COLLECTED_REASON_DEFAULT };
  }
  return { value: fmtCents(Number(c)), reason: null };
}

/** An LP row's commitment, or null when none is recorded (legacy dollars). */
export function lpCommitmentText(lp) {
  const v = lp?.commitment_amount;
  if (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  return fmtCents(majorToMinor(Number(v), 'USD'));
}

/** A zone link that carries the chosen fund, so the zone opens on it (`useManagedFund` reads `?fund=`). */
export function fundZoneHref(path, fundId) {
  if (fundId == null || fundId === '') return path;
  return `${path}?fund=${encodeURIComponent(String(fundId))}`;
}

/** What is true for a GP about distributions (no GP page runs one) and a fund not yet recorded. */
export const DISTRIBUTIONS_TODAY = 'Distributed is what has been recorded on this fund. No GP page runs a distribution yet: Axal staff run one from the fund-administration console.';
// #6235: the no-fund state now creates the fund (FundTermsForm.jsx), so this no longer sends the GP to Axal staff.
export const NO_FUND_TODAY = 'No fund record names you as its GP yet. Once one does, its commitments, LP records, capital movements and reporting periods appear here.';

/**
 * #6248: the landing's performance figures, from `GET /api/fund-performance/:id` (D627) — the same
 * read the performance page draws. Each figure is its value, or Not recorded with the Worker's own
 * `unavailable` reason. `perf` is null while reading and `'unreadable'` when the read failed: then
 * every figure says the read failed, which is not a claim that the figure is missing.
 */
export const PERFORMANCE_FIELDS = Object.freeze([
  { key: 'nav_cents', label: 'NAV · investments only', format: (v) => fmtCents(v) },
  { key: 'rvpi', label: 'RVPI', format: fmtMultiple },
  { key: 'tvpi', label: 'TVPI', format: fmtMultiple },
  { key: 'irr', label: 'IRR', format: fmtRate },
]);
export const PERFORMANCE_UNREADABLE = 'This is not a claim that it is unrecorded.';
export const PERFORMANCE_FALLBACK_REASON = 'The performance read gave no value and no reason.';

export function performanceFigures(perf) {
  const state = perf == null ? 'loading' : perf === 'unreadable' ? 'unreadable' : 'ready';
  const unavailable = state === 'ready' && perf.unavailable && typeof perf.unavailable === 'object' ? perf.unavailable : {};
  const figures = PERFORMANCE_FIELDS.map(({ key, label, format }) => {
    if (state !== 'ready') return { key, label, value: null, reason: null };
    const raw = perf[key];
    const value = raw == null || !Number.isFinite(Number(raw)) ? null : format(Number(raw));
    return { key, label, value, reason: value == null ? (String(unavailable[key] || '').trim() || PERFORMANCE_FALLBACK_REASON) : null };
  });
  return { state, figures, asOf: state === 'ready' ? perf.as_of || null : null, basis: state === 'ready' ? perf.nav_basis || null : null };
}

/** The performance page, carrying the chosen fund. */
