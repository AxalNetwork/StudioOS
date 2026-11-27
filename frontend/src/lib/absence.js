/**
 * The three string-level ways a page says it does not know something.
 *
 * WHY THIS FILE EXISTS, IN THIS FOLDER'S OWN WORDS. `frontend/src/lib/README.md`
 * has said since it was written: *"If a helper appears in two places, put it
 * here once rather than a third time."* Nothing checked it. Measured on
 * `main` at 597f0f68c, before this file: `text` was declared **16** times and
 * the same function under the name `display` **3** more; a title-casing helper
 * existed **30** times under **14** names; and `NOT_RECORDED` was exported
 * twice, from `lib/dealFlow.js` and `lib/fundAnalytics.js`.
 *
 * `ui/Honesty.jsx` made this argument one layer up and its header is worth
 * reading beside this one: `Unrecorded` and `Unreadable` were four components
 * whose copy had already drifted apart. These are the string-level half of the
 * same rule, and they had drifted in the same way — in two places that a user
 * can see.
 *
 * THE TWO DIVERGENCES THAT MADE THIS WORTH DOING, both demonstrable rather
 * than tidiness:
 *
 * 1. **`text` had two behaviours.** Twelve pages trimmed; four (the Build
 *    pages) tested trimmed-emptiness and then returned the value UN-trimmed.
 *    So `text('  x  ')` was `'x'` on twelve pages and `'  x  '` on four.
 *    This file trims, which is what the twelve did.
 *
 * 2. **The same absence rendered as two different strings.** A formatter that
 *    title-cases AFTER the fallback has been substituted cannot tell a
 *    human-written sentence from data, and re-cases it:
 *    `FounderNetworkIntroductions` turned a null into **"Not Recorded"** while
 *    `InvestorPortfolioPositions` turned the same null into **"Not recorded"**.
 *
 * SO `titleCase` TAKES NO FALLBACK, AND THAT IS THE POINT. It cases the value
 * and returns `''` for an absent one, so the caller writes its own fallback
 * after:
 *
 *     titleCase(row.stage) || 'Stage not recorded'
 *
 * A fallback is a sentence somebody chose — "Stage not recorded", "State not
 * recorded", "Event" — and the nine different ones in the tree are not
 * interchangeable, so they stay at their call sites. Folding them into this
 * helper would flatten copy AND put the fallback back inside the caser, which
 * is the bug.
 */

/** What the platform shows where it has nothing recorded. Never a guess. */
export const NOT_RECORDED = 'Not recorded';

/**
 * A value, or the fallback when the store has nothing.
 *
 * Trims: a value that is only whitespace is an absent value, and one padded
 * with it is the same value. The four pages that returned `String(value)`
 * un-trimmed were rendering the padding into the page.
 */
export function text(value, fallback = NOT_RECORDED) {
  return String(value ?? '').trim() || fallback;
}

/**
 * An enum-ish value cased for display — `in_progress` becomes `In Progress`.
 *
 * Returns `''` for an absent value rather than a fallback, so the caller
 * supplies its own with `||`. See the header: the fallback must not pass
 * through here, or it comes out re-cased.
 */
export function titleCase(value) {
  return String(value ?? '')
    .trim()
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
