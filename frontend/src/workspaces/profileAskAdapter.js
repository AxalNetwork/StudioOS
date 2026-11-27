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
 * THE "N WAITING" CHIP is not decided here. The header Ask is `HeaderAsk`
 * (D1443 part 5), which is `PageAsk`: its count is D1442's per-page read
 * (`askPanelAdapter.waiting`, `GET /api/ai/rail/proposals?page=&status=proposed`),
 * drawn only once read and never "0 waiting". The placeholder that stood here
 * for it (`ASK_WAITING`, `waitingCount`) was removed by D4353 (#4353): it
 * answered nothing and nothing called it.
 *
 * THE IN-FORM ASK IS NOT GATED HERE. IC memo, Services, Status reports (D1329)
 * and Log support, New service and New perk (D1595) run through
 * `ui/useScopedFill.jsx` today and keep doing so.
 */
// D1443 part 5 (#3992): the panel serves these licences now (`WorkerRail`'s `askServes`); the header Ask draws while the rail serves it.
export const ASK_PANEL = Object.freeze({ available: true, reason: null, waitsOn: null });

/** Whether the Ask panel serves these licences. */
export function askAvailability() {
  return ASK_PANEL;
}

