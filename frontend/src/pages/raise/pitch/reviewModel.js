/**
 * D900 (#2679, part 6 of #2434) — the pure words and derivations of the studio's
 * Review tab (PD14), over `POST /api/decks/:id/review` and
 * `GET /api/decks/:id/reviews` (`cloudflare-worker/src/routes/deck_review.ts`).
 *
 * A score is shown only because the review returned one: a missing one reads
 * "Score not returned", never a figure. A cost the logs did not record reads
 * "Not recorded", never $0. A point that names no card says so, never a guess.
 */

export const REVIEW_COLUMNS = [
  { key: 'strengths', label: 'Strengths', tone: 'ok' },
  { key: 'weaknesses', label: 'Weaknesses', tone: 'amber' },
  { key: 'red_flags', label: 'Red flags', tone: 'bad' },
  { key: 'fixes', label: 'Fixes', tone: 'violet' },
];

export const SCORE_NOT_RETURNED = 'Score not returned';
export const COST_NOT_RECORDED = 'Not recorded';
export const NO_CARD = 'No card named';
export const REVIEW_READ_ONLY = 'Only the venture\'s founders run a review. You can read the reviews.';
export const NO_REVIEW_YET = 'This version has not been reviewed yet.';
export const NO_REVIEWS = 'No version of this deck has been reviewed yet.';
export const UPLOAD_LINE = 'Reviewing a file or text from outside the studio? Upload it or paste it here. Those reviews stay yours and are not part of the deck\'s history.';

/** A charge in micro-USD as dollars, to the hundredth of a cent the canvas shows ("$0.0180"). */
export function money(microusd) {
  if (typeof microusd !== 'number' || !Number.isFinite(microusd) || microusd < 0) return null;
  return `$${(microusd / 1_000_000).toFixed(4)}`;
}

/** A run's cost as the page says it: the charge, or "Not recorded". */
export function costLabel(cost) {
  return money(cost?.charged_microusd) ?? COST_NOT_RECORDED;
}

/** A score the review returned, or "Score not returned". */
export function scoreLabel(score) {
  return typeof score === 'number' && Number.isFinite(score) ? String(Math.round(score)) : SCORE_NOT_RETURNED;
}

/** Where a point points: "Card 5", or that it names none. */
export function pointerLabel(card) {
  return Number.isInteger(card) && card >= 1 ? `Card ${card}` : NO_CARD;
}

/** The reviews of one version (`deck_id`), newest first as the Worker sends them. */
export function reviewsOf(reviews, deckId) {
  return (Array.isArray(reviews) ? reviews : []).filter((r) => r && r.deck_id === deckId);
}

/** The latest review of this version that has its review to show, or null. */
export function latestReview(reviews, deckId) {
  return reviewsOf(reviews, deckId).find((r) => r.review && r.review.shape === 'cards') || null;
}

/**
 * The estimate on "Review this version": what the venture's last review cost,
 * when the logs recorded it. Null otherwise: the button then names no figure,
 * and the dialog says the cost is shown after the run.
 */
export function estimateOf(reviews) {
  const last = (Array.isArray(reviews) ? reviews : []).find((r) => money(r?.cost?.charged_microusd));
  return last ? money(last.cost.charged_microusd) : null;
}

/** "21 Oct · 09:12", in the reader's own time, or the raw stamp when unreadable. */
export function ranAt(iso) {
  const d = new Date(typeof iso === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

/** The reviews-per-version table: one row per run, newest first. */
export function historyRows(reviews) {
  return (Array.isArray(reviews) ? reviews : []).map((r) => ({
    key: r.run_id || r.id,
    version: `v${r.deck_version}`,
    score: scoreLabel(r.overall_score),
    scored: typeof r.overall_score === 'number',
    when: ranAt(r.created_at),
    cost: costLabel(r.cost),
  }));
}

/** What the review dialog says before the run: what it reads, what it costs, what it changes. */
export function reviewSentence(version, cards, estimate) {
  const cardWord = cards === 1 ? '1 card' : `${cards} cards`;
  const cost = estimate
    ? `It is charged to your AI allowance; the venture's last review cost ${estimate}.`
    : 'It is charged to your AI allowance; the cost is shown when it is done.';
  return `Eadwyn reads the ${cardWord} of ${version} and returns strengths, weaknesses, red flags and fixes, each pointing to a card. ${cost} The review is added to this version's history. Nothing on the deck changes.`;
}
