// Series B — Diligence Pack
// ─────────────────────────────────────────────────────────────────
// The original 1-slide placeholder has been superseded by the richer
// 32-slide self-contained variant defined in
// `./series_b_diligence_app.tsx` (22 main + 10 appendix). We re-export
// the new adapter under the original `Deck_series_b_diligence` name so:
//   • the registry key `series_b_diligence` stays stable for existing
//     decks (no `method_id` migration needed),
//   • the drift check (`scripts/check-deck-templates.mjs`) keeps
//     finding the canonical `Deck_<key>` import from `./<key>`.
export { Deck_series_b_diligence_app as Deck_series_b_diligence } from './series_b_diligence_app';
