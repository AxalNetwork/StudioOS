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
