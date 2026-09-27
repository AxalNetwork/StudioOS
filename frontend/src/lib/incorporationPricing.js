/**
 * The Lab Incorporate page's money and jurisdiction rules (D362), kept out of
 * the page so they run under node --test (the page pulls in the Stripe loader,
 * which reads import.meta.env at module load).
 *
 * Amounts are integer cents from the Worker's catalog quote or order row; this
 * module formats them and never computes a price.
 */

/** Server order statuses that mean the incorporation fee was paid. */
export const PAID_STATUSES = ['paid', 'packet_processing', 'packet_ready'];

/**
 * Integer cents → a display string. The only place a cents amount becomes a
 * decimal; everything before it stays an integer (D362).
 */
export function fmtCents(cents, currency = 'usd') {
  if (!Number.isInteger(cents)) return null;
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: String(currency || 'usd').toUpperCase(), minimumFractionDigits: 0,
  });
}

/**
 * Where this startup is formed, from the Lab application's jurisdiction label
 * (the Apply page stores e.g. "Wyoming C-Corp — Wyoming, USA"). Only Delaware
 * has a Worker jurisdiction and a catalog SKU; any other answer yields no
 * `jurisdictionId`, and the reason is shown instead of a Pay button. With no
 * application jurisdiction on record, Delaware is used and labelled as such.
 */
export function formationJurisdiction(applicationJurisdiction, entity) {
  const label = String(applicationJurisdiction || '').trim();
  const delawareId = entity === 'llc' ? 'us_de_llc' : 'us_de_ccorp';
  if (!label) {
    return { state: 'Delaware', jurisdictionId: delawareId, fromApplication: false, reason: null };
  }
  if (/delaware/i.test(label)) {
    return { state: 'Delaware', jurisdictionId: delawareId, fromApplication: true, reason: null };
  }
  const state = /wyoming/i.test(label) ? 'Wyoming' : label;
  return {
    state,
    jurisdictionId: null,
    fromApplication: true,
    reason: `Your application chose ${state}. Formation here has no ${state} jurisdiction and no catalog price yet, so it cannot be ordered or charged.`,
  };
}

