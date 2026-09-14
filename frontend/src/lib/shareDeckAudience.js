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
 * `'narrative'` RENDERS NOTHING, and that is the interesting one. The repo does
 * not agree with itself about what a narrative deck is. The worker files two
 * methods under it (`services/decks/methods.ts`: `sequoia_classic` and
 * `narrative_brand`) while the frontend registry calls the first `fundraising`
 * and the second `commercial` — and the two sources reach different screens:
 * `PitchDeckPage.jsx` prefers the methods value, `PitchDeckPrintPage.jsx` (which
 * renders this CTA) reads the registry's. A CTA that picked one would be
 * guessing which half of that disagreement is right, and guessing wrong here is
 * precisely the bug above. Until the repo settles it, no promise is made.
 *
 * An unrecognised value renders nothing for the same reason. Defaulting to the
 * deal pack is how a Demo Day deck ended up offering documents in the first
 * place.
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
 * Null covers three different situations on purpose — absent, undecided
 * (`'narrative'`), and unrecognised — because the caller's response to all
 * three is the same: show nothing rather than promise something.
 */
export function shareDeckFlow(category) {
  if (!category) return null;
  return BY_CATEGORY.get(category) || null;
}

/** True when this category's viewer is offered the deal pack. */
export const offersDealPack = (category) => shareDeckFlow(category) === DEAL_PACK;

/** True when this category's viewer is asked for feedback. */
export const asksForFeedback = (category) => shareDeckFlow(category) === FEEDBACK;
