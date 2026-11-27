// Demo Day — Product-first
// ─────────────────────────────────────────────────────────────────
// The original screenshot-stub 11-slide variant has been superseded
// by the richer 12-slide self-contained variant defined in
// `./demo_day_app.tsx` (product-first, hand-built SVG mockups,
// warm Demo-Day orange accent). We re-export the new adapter under
// the original `Deck_demo_day` name so:
//   • the registry key `demo_day` stays stable for existing decks
//     (no `method_id` migration needed),
//   • the drift check (`scripts/check-deck-templates.mjs`) keeps
//     finding the canonical `Deck_<key>` import from `./<key>`.
export { Deck_demo_day_app as Deck_demo_day } from './demo_day_app';
