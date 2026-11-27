/**
 * D541 — what a Lab checklist row pays in credits, from `/spinout-lab/state`'s
 * `milestone_credits` (the Worker reads the amounts from D540's rules; none
 * are written here).
 *
 * A row can hold several milestone keys ("Log 5 customer interviews" holds
 * five, of which only the last two pay). Its credit is the sum over the keys
 * that pay, and it is "earned" once every paying key has been paid. The half
 * of the advisor / co-founder pair that will not pay, because the other one
 * did, is left out.
 *
 * Returns null when the row pays nothing, so the checklist draws no badge
 * rather than "+0".
 */
export function rowCredit(keys, milestoneCredits) {
  const table = milestoneCredits?.milestones;
  if (!table || !Array.isArray(keys)) return null;
  const paying = keys.map((k) => table[k]).filter((m) => m && !m.superseded && Number(m.credits) > 0);
  if (paying.length === 0) return null;
  const credits = paying.reduce((a, m) => a + Number(m.credits), 0);
  const usdCents = paying.reduce((a, m) => a + Number(m.usd_value_cents), 0);
  const earnedCount = paying.filter((m) => m.earned).length;
  return { credits, usd_value_cents: usdCents, earned: earnedCount === paying.length, partly_earned: earnedCount > 0 && earnedCount < paying.length };
}

export function usdLabel(cents) {
  return `US$${(Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** The badge's words: "+N credits (US$N)", or "earned" once paid. */
export function rowCreditLabel(credit) {
  if (!credit) return null;
  const amount = `+${credit.credits.toLocaleString('en-US')} credit${credit.credits === 1 ? '' : 's'} (${usdLabel(credit.usd_value_cents)})`;
  if (credit.earned) return `${amount} · earned`;
  if (credit.partly_earned) return `${amount} · partly earned`;
  return amount;
}
