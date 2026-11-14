/**
 * Office Hours follow-ups on the page — D355. Action items both parties keep
 * on a session, and the founder's rating of a completed one.
 *
 * The Worker (services/partnerBookingFollowups.ts) decides who may do what;
 * these pure helpers decide what the PAGE claims from its reads:
 *   * a partner with no ratings shows "No ratings yet" — never ★ 0 — and a
 *     failed read of the averages is unreadable, not "no ratings";
 *   * an average always travels with its count;
 *   * an item's owner reads from the viewer's side: "You", or the other party;
 *   * only a completed session can be rated, and only from the founder's side.
 */

/** The Lab tools an item may link to — the Worker's LINKED_TOOLS, labelled. */
export const LINKED_TOOL_LABELS = {
  profiling: 'Profiling',
  discovery: 'Customer Discovery',
  market: 'Market Sizing',
  scoring: 'Scoring Engine',
  advisors: 'Advisors',
  'cofounder-match': 'Co-founder Match',
  'cofounder-agreement': 'Co-founder Agreement',
  captable: 'Cap Table',
  '83b': '83(b) Election',
  incorporate: 'Incorporate',
  'use-of-funds': 'Use of Funds',
  revenue: 'Revenue',
  'pitch-deck': 'Pitch Deck',
  brand: 'Brand & Landing',
  capital: 'Capital',
  compliance: 'Compliance',
  roadmap: 'Roadmap',
};

/** `{ label, to }` for an item's linked tool, or null when it has none we know. */
export function toolLink(key) {
  if (!key || !Object.prototype.hasOwnProperty.call(LINKED_TOOL_LABELS, key)) return null;
  return { label: LINKED_TOOL_LABELS[key], to: `/spinout-lab/${key}` };
}

/**
 * The directory badge for one partner, from GET /ratings/summary.
 *   { state: 'failed' }                 — the averages could not be read
 *   { state: 'none' }                   — read fine, nobody has rated them
 *   { state: 'ok', average, count }     — shown from the first rating
 */
export function ratingBadge(summaryRead, partnerId) {
  if (!summaryRead || summaryRead.state !== 'ok') return { state: 'failed' };
  const items = Array.isArray(summaryRead.data?.items) ? summaryRead.data.items : [];
  const row = items.find((r) => Number(r.partner_id) === Number(partnerId));
  if (!row || !Number.isFinite(Number(row.count)) || Number(row.count) < 1) return { state: 'none' };
  return { state: 'ok', average: Number(row.average), count: Number(row.count) };
}

export const formatRating = (b) => `★ ${b.average.toFixed(1)} · ${b.count} ${b.count === 1 ? 'rating' : 'ratings'}`;

/** Who added an item: "You", or the side that did (another account on the same partner profile reads "Partner"). */
export function ownerLabel(item) {
  if (item.added_by_you) return 'You';
  return item.added_by === 'partner' ? 'Partner' : 'Founder';
}

/** Open items first, then by due date (undated last), then oldest first. */
export function sortItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => (
    Number(!!a.done) - Number(!!b.done)
    || Number(!a.due_date) - Number(!b.due_date)
    || String(a.due_date || '').localeCompare(String(b.due_date || ''))
    || Number(a.id) - Number(b.id)
  ));
}

/** Only the founder rates, and only a session the partner marked completed. */
export const canRate = (booking, viewerSide) => viewerSide === 'founder' && booking?.status === 'completed';

/** A session that can still carry action items. */
export const takesItems = (booking) => !!booking && booking.status !== 'cancelled';
