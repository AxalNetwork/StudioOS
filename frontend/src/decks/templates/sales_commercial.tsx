// Task #10 — `sales_commercial` now re-exports the 18-slide
// self-contained `sales_commercial_app` variant under the original
// `Deck_sales_commercial` name. The registry key `sales_commercial`
// stays stable so existing decks with that `method_id` continue to
// resolve; only the underlying renderer changes.
export { Deck_sales_commercial_app as Deck_sales_commercial } from './sales_commercial_app';
