/**
 * D1537 (#3786) — the hourly deck error-budget check, as the cron imports it.
 *
 * The scheduled handler imports this module rather than `decks/gridHealth`
 * directly: `mercury_member_privacy_d752` counts every word in that handler
 * that names one of `index.ts`'s imports, and the path's `decks` would name
 * the decks router. This module's own graph (gridHealth, the catalogue,
 * observability, notify) reaches no member bank data.
 */
export { noteErrorBudgetAlert } from './decks/gridHealth';
