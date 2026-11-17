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
import { fmtCents } from '../../lib/fundAnalytics';
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
