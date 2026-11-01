/**
 * D1424 (#3700) — what the Investor, Advisor and Operating Partner header Ask
 * may use today, in one place, so no profile page calls a route that is not
 * on `main` and no page has to know which half of #3706 has landed.
 *
 * THE PANEL. The header Ask opens the Ask panel, which slides out of the
 * AIRail (#3706, D1443). It is not built. The only Eadwyn panel on `main` is
 * D698's phone panel (`ui/eadwynPanel.js`), which serves a founder below 1024px
 * and nobody else, so it cannot be what an investor's Ask opens. Until D1443
 * widens it to these licences, `askAvailability()` says no and the header Ask
 * draws nothing (the gate in `ProfileHeaderAsk.jsx`). When it lands, this file
 * is the one line that changes, and every profile header lights up together.
 *
 * THE "N WAITING" CHIP. Its count is the proposals waiting for a page, which
 * needs `GET /api/ai/rail/proposals?page=` (D1442). Today that route requires
 * `option` (400 `option_required`), and `railProposalsApi.list` sends no
 * `page`. This adapter adds no client parameter; D1442 adds it with its
 * route. Until then the count is unavailable, so the chip is never drawn, and
 * an unread count is never "0 waiting" (the Ask addendum).
 *
 * THE IN-FORM ASK IS NOT GATED HERE. IC memo, Services, Status reports (D1329)
 * and Log support, New service and New perk (D1595) run through
 * `ui/useScopedFill.jsx` today and keep doing so.
 */
export const ASK_PANEL = Object.freeze({ available: false, reason: 'ask_panel_unbuilt', waitsOn: '#3706 (D1443)' });
export const ASK_WAITING = Object.freeze({ available: false, count: null, reason: 'proposals_by_page_unbuilt', waitsOn: '#3706 (D1442)' });

/** Whether the Ask panel serves these licences. */
export function askAvailability() {
  return ASK_PANEL;
}

/**
 * The proposals waiting on a rail page, or unavailable. Never a guessed 0.
 * `pageKey` is the rail page the count will be read for once D1442 serves it.
 */
export function waitingCount(pageKey) { // eslint-disable-line no-unused-vars
  return ASK_WAITING;
}
