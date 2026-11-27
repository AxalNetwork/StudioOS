// Task #13 — `narrative_brand` now re-exports the cinematic 4-act
// self-contained `narrative_brand_app` variant under the original
// `Deck_narrative_brand` name (15 content chapters + 4 full-bleed
// act dividers = 19 frames). The registry key `narrative_brand`
// stays stable so existing decks with that `method_id` continue to
// resolve; only the underlying renderer changes.
export { Deck_narrative_brand_app as Deck_narrative_brand } from './narrative_brand_app';
