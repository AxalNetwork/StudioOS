/**
 * The one sentence on a founder fund dossier that compares a cheque to a raise.
 *
 * It is a note, not a score, and it does not share the list's overlap COUNT.
 * The count treats a missing low end as 0 so a range of "up to $2M" can still
 * count as overlapping. This sentence does not: a missing end stays open, and
 * a cheque nobody recorded is "nothing to compare", never an overlap of zero.
 */

export function fundOverlapNote(
  fund: { cheque_min_cents: number | null; cheque_max_cents: number | null },
  askCents: number | null,
): string {
  const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
  if (askCents === null) {
    return 'No raise target on the active company, so there is no ask to compare.';
  }
  if (fund.cheque_min_cents == null && fund.cheque_max_cents == null) {
    return `Your raise target is ${usd(askCents)}. Their cheque is not recorded, so there is nothing to compare it to yet.`;
  }
  const lo = fund.cheque_min_cents;
  const hi = fund.cheque_max_cents;
  const inside = (lo == null || askCents >= lo) && (hi == null || askCents <= hi);
  return `Your raise target is ${usd(askCents)} — ${inside ? 'inside' : 'outside'} the range they state. A note, not a score.`;
}

/**
 * D7168: the allocation test — what the founder intends to raise from THIS
 * fund against the range the fund states. Both are USD cents, so they compare;
 * nothing here is compared with a figure in another currency. Ends are
 * inclusive and a missing end stays open, as in `fundOverlapNote`. No
 * allocation set means the test is not run, never an allocation of 0.
 */
export function fundAllocationNote(fund: {
  cheque_min_cents: number | null; cheque_max_cents: number | null; intended_allocation_cents?: number | null;
}): { result: 'not_set' | 'nothing_to_compare' | 'inside' | 'below' | 'above'; note: string } {
  const usd = (cents: number) => `US$${Math.round(cents / 100).toLocaleString('en-US')}`;
  const alloc = fund.intended_allocation_cents ?? null;
  if (alloc === null) {
    return { result: 'not_set', note: 'No allocation is set for this fund, so the test is not run.' };
  }
  const lo = fund.cheque_min_cents;
  const hi = fund.cheque_max_cents;
  if (lo == null && hi == null) {
    return { result: 'nothing_to_compare', note: `Your allocation is ${usd(alloc)}. Their cheque is not recorded, so there is nothing to compare it to yet.` };
  }
  if (lo != null && alloc < lo) return { result: 'below', note: `Your allocation of ${usd(alloc)} is below the range they state.` };
  if (hi != null && alloc > hi) return { result: 'above', note: `Your allocation of ${usd(alloc)} is above the range they state.` };
  const open = lo == null ? ' · low end left open' : hi == null ? ' · high end left open' : '';
  return { result: 'inside', note: `Your allocation of ${usd(alloc)} is inside the range they state${open}.` };
}
