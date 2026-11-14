/**
 * Which end-of-deck flow a share link offers, decided in ONE place.
 *
 * WHY THIS EXISTS (#205). `ShareDeckCTA` asked `category === 'commercial'` and
 * let everything else fall through to the fundraising copy, while
 * `ShareViewerSignupModal` gated its post-NDA step on `category ===
 * 'fundraising'`. The two disagreed for `'event'`, and the disagreement was
 * invisible: a Demo Day viewer was promised "the SAFE, term sheet, and side
 * letters are ready for your review", signed the NDA on the strength of it, and
 * landed on a panel that rendered NOTHING. No error, no empty state — the step
 * simply had no branch. A promise followed by a blank screen is worse than no
 * promise, and nothing in either file could see it, because neither knew what
 * the other branched on.
 *
 * So the rule is named once and both files ask it. A category is either:
 *   · FEEDBACK  — customer discovery; "tell the team what you think"
 *   · DEAL_PACK — the SAFE / term sheet / side letters, ready to sign
 *   · null      — no CTA at all
 *
 * `'event'` is DEAL_PACK by decision, not by fall-through: a Demo Day viewer is
 * there to evaluate the company, which is what the deal pack is for.
 *
 * THERE IS NO `'narrative'` ANY MORE, AND NOT MAPPING IT IS WHAT BOUGHT THE
 * TIME TO FIND OUT WHY. This file used to carry a fourth case: the worker filed
 * `sequoia_classic` and `narrative_brand` under `'narrative'` while the registry
 * called them `fundraising` and `commercial`, the two sources reached different
 * screens, and a CTA that picked a side would have been guessing which half of
 * the repo was right — the same guess as the bug above. So it promised nothing
 * and D97 raised the question instead of answering it.
 *
 * #207 answered it at the source (D102). `'narrative'` named a deck's STYLE in
 * a vocabulary of AUDIENCES — this map is the proof: every entry below answers
 * "who is looking, and what do they want next", which is not a question a
 * writing style has an answer to. The value is retired from
 * `services/decks/methods.ts`, its Python dev mirror and the registry's own
 * union; `frontend/test/deck_category_sources_agree.test.mjs` keeps all three
 * saying one thing. Nothing here changed, which was the point: settling it
 * upstream left every live share link's promise exactly as it was.
 *
 * An unrecognised value still renders nothing, and that guard is not
 * vestigial — it is what stops the next new category from silently inheriting
 * the deal pack. Defaulting is how a Demo Day deck came to offer documents in
 * the first place.
 */

/** The viewer is asked for structured feedback. */
export const FEEDBACK = 'feedback';
/** The viewer is offered the generated deal pack to review and sign. */
export const DEAL_PACK = 'deal_pack';

const BY_CATEGORY = new Map([
  ['commercial', FEEDBACK],
  ['fundraising', DEAL_PACK],
  ['event', DEAL_PACK],
]);

/**
 * The flow this category's share link offers, or `null` for no CTA.
 *
 * Null covers two different situations on purpose — absent, and unrecognised —
 * because the caller's response to both is the same: show nothing rather than
 * promise something. (It covered a third until #207: `'narrative'`, which was
 * undecided rather than unknown. Deciding it removed the case; it did not
 * remove the rule.)
 */
export function shareDeckFlow(category) {
  if (!category) return null;
  return BY_CATEGORY.get(category) || null;
}

/** True when this category's viewer is offered the deal pack. */
export const offersDealPack = (category) => shareDeckFlow(category) === DEAL_PACK;

/** True when this category's viewer is asked for feedback. */
export const asksForFeedback = (category) => shareDeckFlow(category) === FEEDBACK;
