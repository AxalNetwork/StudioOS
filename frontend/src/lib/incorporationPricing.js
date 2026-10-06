/**
 * The Lab Incorporate page's money and jurisdiction rules (D362), kept out of
 * the page so they run under node --test (the page pulls in the Stripe loader,
 * which reads import.meta.env at module load).
 *
 * Amounts are integer cents from the Worker's catalog quote or order row; this
 * module formats them and never computes a price.
 */

/**
 * Server order statuses that mean the incorporation fee was paid. `packet_ready`
 * and `filed` are set by an Axal admin by hand (D601, the owner's answer 1A on
 * #998): the packet attached, then the date it was filed with the state.
 */
export const PAID_STATUSES = ['paid', 'packet_processing', 'packet_ready', 'filed'];

/**
 * D367 — what a paid order's screens may say about the packet. After payment
 * the Worker only moves the order to `packet_processing`; nothing assembles a
 * packet, emails a link or files with the state, and nothing sets
 * `packet_ready` (which step does is the owner's open decision on #998). So
 * no screen spins "Processing", says a packet is being prepared, or marks
 * documents prepared or a filing started for these two statuses. An admin
 * moves an order on from them in HQ (D601).
 */
export const PACKET_NOT_BUILT_STATUSES = ['paid', 'packet_processing'];
export const PACKET_NOT_BUILT =
  'Payment is confirmed. The formation packet has not been built yet, and nothing has been filed with the state.';

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
 * (the Apply page stores e.g. "Wyoming C-Corp — Wyoming, USA"). Delaware forms
 * a C-Corp, a PBC (a Delaware corporation) or an LLC. Wyoming forms a C-Corp
 * only (D586, `us_wy_ccorp`); a Wyoming PBC or LLC has no Worker jurisdiction.
 * Any other answer yields no `jurisdictionId`, and the reason is shown instead
 * of a Pay button. Whether a jurisdiction can be charged is then the catalog
 * quote's to say: no Stripe price, no Pay button. With no application
 * jurisdiction on record, Delaware is used and labelled as such.
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
  if (/wyoming/i.test(label)) {
    if (entity === 'ccorp') {
      return { state: 'Wyoming', jurisdictionId: 'us_wy_ccorp', fromApplication: true, reason: null };
    }
    const kind = entity === 'llc' ? 'an LLC' : 'a public benefit corporation';
    return {
      state: 'Wyoming',
      jurisdictionId: null,
      fromApplication: true,
      reason: `Your application chose Wyoming, where formation here offers a C-Corp only. Wyoming as ${kind} cannot be ordered or charged.`,
    };
  }
  return {
    state: label,
    jurisdictionId: null,
    fromApplication: true,
    reason: `Your application chose ${label}. Formation here has no ${label} jurisdiction and no catalog price yet, so it cannot be ordered or charged.`,
  };
}

/** The state's name for the charter: Wyoming files Articles, Delaware a Certificate. */
export function charterName(state) {
  return state === 'Wyoming' ? 'Articles of Incorporation' : 'Certificate of Incorporation';
}

/** The entity as it is formed in `state`: "Wyoming C-Corp", "Delaware PBC", "Delaware LLC". */
export function entityLabel(entity, state) {
  const where = state || 'Delaware';
  if (entity === 'pbc') return `${where} PBC`;
  if (entity === 'llc') return `${where} LLC`;
  return `${where} C-Corp`;
}
