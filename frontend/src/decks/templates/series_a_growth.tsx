// Series A — Growth & GTM
// ─────────────────────────────────────────────────────────────────
// The original simpler `Deck_series_a_growth` (3-slide sketch) has
// been superseded by the richer self-contained variant defined in
// `./series_a_growth_app.tsx`. We re-export the new adapter under
// the original `Deck_series_a_growth` name so:
//   • the registry key `series_a_growth` stays stable for existing
//     decks (no `method_id` migration needed),
//   • the drift check (`scripts/check-deck-templates.mjs`) keeps
//     finding the canonical `Deck_<key>` import from `./<key>`.
export { Deck_series_a_growth_app as Deck_series_a_growth } from './series_a_growth_app';
