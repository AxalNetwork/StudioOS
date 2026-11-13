/**
 * D752 (#1890) — what an admin reads about an investor's shared proof of
 * funds, pure: no React, no fetch. `components/ProofOfFunds.jsx` draws it on
 * the LP application, a deal's Commitments tab and the fund console's Calls tab.
 */

/** The queue chip for each state; `none` and null draw nothing. */
export const PROOF_CHIP = Object.freeze({
  active: ['Proof of funds', 'ok'],
  expired: ['Proof expired', 'warn'],
  revoked: ['Proof revoked', 'neutral'],
  unreadable: ['Proof not read', 'warn'],
});

export const NOT_ACCREDITATION = 'Proof of funds for this commitment, not evidence of accredited status.';
export const NONE_SHARED = 'None shared. An investor shares one from their own Mercury.';
export const VIEW_NOTE = 'Showing a proof of funds is recorded in the admin audit log, and the investor sees that an admin viewed it.';
export const CALLS_COMPARE = 'Compare with the LP\'s uncalled commitment on the call ledger.';

/** The pill tone for a statement's label. */
export const PILL_TONE = Object.freeze({ Active: 'ok', Expired: 'warn', Revoked: 'neutral' });

const dollars = (cents) => `$${Math.floor(Number(cents) / 100).toLocaleString('en-US')}`;

/**
 * The floor beside today's figure: "Covers the full amount", or "Covers $X of
 * $Y" in whole dollars; null when the figure is missing.
 */
export function coverText(floorCents, figureDollars) {
  if (figureDollars === null || figureDollars === undefined || figureDollars === '' || !Number.isFinite(Number(figureDollars))) return null;
  if (floorCents === null || floorCents === undefined || !Number.isFinite(Number(floorCents))) return null;
  const figureCents = Math.round(Number(figureDollars) * 100);
  if (Number(floorCents) >= figureCents) return 'Covers the full amount';
  return `Covers ${dollars(floorCents)} of ${dollars(figureCents)}`;
}

/** "Also shared: <label>, at least $X on <date> … One balance can back more than one statement." */
export function otherActiveText(item) {
  const others = Array.isArray(item?.other_active) ? item.other_active : [];
  if (!item?.other_active_count || !others.length) return null;
  const parts = others.map((o) => `${o.target_label}, at least ${dollars(o.amount_floor_cents)} on ${o.as_of}${o.expired ? ' (expired)' : ''}`);
  const more = item.other_active_count > others.length ? ` and ${item.other_active_count - others.length} more` : '';
  return `Also shared: ${parts.join('; ')}${more}. One balance can back more than one statement.`;
}
