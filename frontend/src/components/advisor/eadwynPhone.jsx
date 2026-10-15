/**
 * D701 (#1663) — Eadwyn's phone pieces, in a module a Node test can import.
 *
 * WHY A SEPARATE MODULE. `PersonalAdvisor`, `StudioInterview`,
 * `FounderStudioHome` and `AdvisorProgressWidget` all reach
 * `lib/advisor/router.js`, which imports `banks.manifest.json` with no import
 * attribute, so `node --test` throws before the first assertion. What the phone
 * layout needs, and what a test must render, lives here instead. Nothing in
 * this file may import anything that reaches `lib/advisor/router.js`.
 */
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';

/**
 * One breakpoint (D701 decision 2, epic D-l): the shell's `PHONE_QUERY`,
 * below 1024px, followed through D699's `usePhoneWidth` with a `change`
 * listener. It replaced `innerWidth >= 768`, which left 768–1023px with a
 * phone shell around a desktop chat. Without `matchMedia` (a server render)
 * it is desktop, as `usePhoneWidth` is not a phone there.
 */
export function useIsDesktop() {
  return !usePhoneWidth();
}
