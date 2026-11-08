/**
 * D4693 (#4693) — the rules the Pipeline's overview and its detail zones share,
 * written once so a figure cannot mean one thing on the Proposals desk and
 * another in Analytics. Pure functions; nothing here reads the database.
 *
 *   quoteOutcome / winRate      what a quote's status means, and the one win rate
 *   isActiveRetainer            which retainers are current revenue
 *   monthlyCents                what a retainer pays per month
 *   negotiationIsOpen / label   which negotiations are live, and what to call a stage
 *   companyBinds                the company predicate every partner query repeats
 *
 * NULL IS "NOT RECORDED", NEVER ZERO. A win rate over nothing decided, a
 * monthly amount with no amount recorded and an unknown cadence are `null`.
 */

// ---------------------------------------------------------------------------
// Quotes: one classifier, one denominator
// ---------------------------------------------------------------------------

/** `won` and `lost` are decisions; `open` is waiting; `withdrawn` is the partner walking away. */
export type QuoteOutcome = 'won' | 'lost' | 'open' | 'withdrawn' | 'unknown';

/**
 * What a quote's status means. A status the store does not define reads
 * `unknown` and is counted nowhere, rather than being guessed into a bucket.
 * A `decided_at` stamp does NOT decide a quote: a withdrawn quote can carry one,
 * and it is still not a loss.
 */
export function quoteOutcome(status: unknown): QuoteOutcome {
  switch (String(status ?? '')) {
    case 'accepted': return 'won';
    case 'rejected': return 'lost';
    case 'submitted': return 'open';
    case 'withdrawn': return 'withdrawn';
    default: return 'unknown';
  }
}

/**
 * The win rate: won ÷ (won + lost), as a percent to one decimal, or null when nothing is
 * decided. Open quotes are not losses and withdrawing is not losing, so neither
 * is in the denominator. Every surface that prints a win rate calls this.
 */
export function winRate(won: number, lost: number): { pct: number | null; decided: number } {
  const decided = won + lost;
  // One decimal, the precision `/quotes/analytics` has always returned; a screen rounds it for print.
  return { pct: decided > 0 ? Math.round((won / decided) * 1000) / 10 : null, decided };
}

/** The sentence that says what a win rate was counted from, shared by every surface. */
export function winRateBasis(won: number, lost: number, open: number, withdrawn: number): string {
  const { decided } = winRate(won, lost);
  return decided > 0
    ? `${won} won of ${decided} decided. ${open} still open and ${withdrawn} withdrawn are excluded — an undecided quote is not a loss, and withdrawing is not losing.`
    : 'No quotes decided yet, so there is no win rate to report.';
}

// ---------------------------------------------------------------------------
// Retainers: current revenue
// ---------------------------------------------------------------------------

export type RetainerCadence = 'monthly' | 'quarterly';

/**
 * Is this retainer current recurring revenue? It is until it ends. `ended_at`
 * on or before today (or an unreadable date) ends it; a date in the future is a
 * scheduled end and the retainer is still paying. A cancelled engagement
 * (`cancelled_at`, or status `cancelled`) is not revenue either.
 */
export function isActiveRetainer(
  r: { ended_at?: string | null },
  engagement: { status?: string | null; cancelled_at?: string | null } = {},
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (engagement.cancelled_at || engagement.status === 'cancelled') return false;
  const end = r.ended_at ? String(r.ended_at).slice(0, 10) : null;
  if (!end) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return end > today;
}

/**
 * What a retainer pays per month, in whole cents: a monthly amount as it is, a
 * quarterly one divided by three (rounded to the cent). No amount, or a cadence
 * this function does not know, is `null`: a figure under a "monthly" heading
 * must never be a raw quarterly amount, and an unknown cadence is not assumed to
 * be monthly.
 */
export function monthlyCents(amountCents: number | null | undefined, cadence: unknown): number | null {
  if (amountCents == null || !Number.isFinite(Number(amountCents))) return null;
  const cents = Number(amountCents);
  if (cadence === 'monthly') return cents;
  if (cadence === 'quarterly') return Math.round(cents / 3);
  return null;
}

// ---------------------------------------------------------------------------
// Negotiations
// ---------------------------------------------------------------------------

export const NEGOTIATION_STAGE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  scoping: 'Scoping', terms: 'Terms', legal: 'Legal', ready_to_sign: 'Ready to sign', closed: 'Closed',
});

/**
 * Is this negotiation live? It is tracked, not in its `closed` stage, and the
 * quote behind it is still waiting. A quote that was accepted, rejected or
 * withdrawn is not being negotiated, whatever stage its thread was left in.
 */
export function negotiationIsOpen(stage: unknown, quoteStatus: unknown): boolean {
  return typeof stage === 'string' && stage !== 'closed' && quoteOutcome(quoteStatus) === 'open';
}

/** What the zone prints for a negotiation: the stage, or the reason it is not live. */
export function negotiationLabel(stage: unknown, quoteStatus: unknown): string {
  const outcome = quoteOutcome(quoteStatus);
  if (outcome === 'won') return 'Won';
  if (outcome === 'lost') return 'Lost';
  if (outcome === 'withdrawn') return 'Withdrawn';
  return NEGOTIATION_STAGE_LABEL[String(stage)] ?? 'Stage not recorded';
}

// ---------------------------------------------------------------------------
// Company scope
// ---------------------------------------------------------------------------

/**
 * The two binds for `(? IS NULL OR x.company_id IS NULL OR x.company_id = ?)`,
 * the predicate every partner query carries. `companyId` is the VERIFIED active
 * company (`activeCompanyFor`) or null for "no company selected" (and for an
 * admin's oversight view). A row with no company stays visible, as it does on
 * `/quotes/me` and `/quotes/analytics`.
 */
export const companyBinds = (companyId: number | null): [number | null, number | null] => [companyId, companyId];
