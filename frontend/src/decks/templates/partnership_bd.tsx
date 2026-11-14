// Partnership / BD
// ─────────────────────────────────────────────────────────────────
// The original 11-slide simple variant has been superseded by the
// richer 12-slide self-contained executive-consulting variant
// defined in `./partnership_bd_app.tsx` (McKinsey/Bain/Accenture
// tone, hand-built SVG diagrams). We re-export the new adapter
// under the original `Deck_partnership_bd` name so:
//   • the registry key `partnership_bd` stays stable for existing
//     decks (no `method_id` migration needed),
//   • the drift check (`scripts/check-deck-templates.mjs`) keeps
//     finding the canonical `Deck_<key>` import from `./<key>`.
export { Deck_partnership_bd_app as Deck_partnership_bd } from './partnership_bd_app';
