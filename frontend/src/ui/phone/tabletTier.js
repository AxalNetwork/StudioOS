/**
 * D4846 part 2 (#6032, Build v2 board BD14 B "Tablet 768") — the tablet tier
 * between the phone page and the desktop, as data. Pure: `usePhoneWidth.js`
 * holds the hook (`useTabletWidth`) that reads it from the browser.
 *
 *   phone    below 768px   (`BELOW_MD_QUERY`)
 *   tablet   768px–1023px  (`TABLET_QUERY`)
 *   desktop  from 1024px   (`PHONE_QUERY` no longer matches)
 *
 * A cycle whose def names `tabletPages` (Build) draws its desktop pages in the
 * tablet tier, laid out for it, rather than the phone page's single column;
 * every other cycle keeps its phone page below 1024px.
 */

/** Below `md` (D717, #1854): the Templates tab's phone rule, and the bottom of the tablet tier. */
export const BELOW_MD_QUERY = '(max-width: 767px)';
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)';

/** The tier a width falls in: 'phone' below 768px, 'tablet' to 1023px, 'desktop' from 1024px. */
export function layoutTier(width) {
  const w = Number(width);
  if (!Number.isFinite(w)) return 'desktop';
  if (w < 768) return 'phone';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Whether the tablet tier holds, from a `matches(query)` function. It needs
 * the tablet range AND not the phone range: in a browser the first implies
 * the second, but an environment that answers every query alike (a stub, a
 * webview that reports no width) is not taken for a tablet, so it keeps the
 * page it drew before this tier existed.
 */
export function tabletFrom(matches) {
  try {
    return matches(TABLET_QUERY) === true && matches(BELOW_MD_QUERY) !== true;
  } catch {
    return false;
  }
}

/**
 * BD14 B's overview at 768px: two module columns, and the four status figures
 * in one row, as the board draws them. Tailwind's `md:` is 768px, so these
 * act from the tablet tier up; the desktop's own `lg:` and `xl:` classes still
 * win from 1024px.
 */
export const TABLET_CARD_COLS = 'md:grid-cols-2';
export const TABLET_FIGURE_COLS = Object.freeze({ 4: 'md:grid-cols-4' });

/** The last module card spans the tablet row an odd count leaves empty, as `lastCardSpan` does from 1024px. */
export function tabletLastSpan(n) {
  return Number.isInteger(n) && n > 0 && n % 2 === 1 ? 'md:col-span-2' : '';
}
