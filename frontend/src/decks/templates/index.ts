import type React from 'react';
import type { DeckProps } from '../DeckBase';
import { Deck_yc_seed } from './yc_seed';
import { Deck_sequoia_classic } from './sequoia_classic';
import { Deck_kawasaki_10_20_30 } from './kawasaki_10_20_30';
import { Deck_minimal_seed } from './minimal_seed';
// `series_a_growth.tsx` now re-exports the richer self-contained
// `series_a_growth_app` variant under the original
// `Deck_series_a_growth` name. The registry key `series_a_growth`
// stays stable so existing decks with that `method_id` continue
// to resolve; only the underlying renderer changes.
import { Deck_series_a_growth } from './series_a_growth';
import { Deck_series_b_diligence } from './series_b_diligence';
import { Deck_demo_day } from './demo_day';
import { Deck_sales_commercial } from './sales_commercial';
import { Deck_partnership_bd } from './partnership_bd';
import { Deck_one_pager_teaser } from './one_pager_teaser';
import { Deck_investor_appendix } from './investor_appendix';
import { Deck_narrative_brand } from './narrative_brand';
// Task #15 — Axal 28-day Spin-Out Lab Demo Day deck (10 slides · editorial).
import { Deck_axal_spinout_demoday } from './axal_spinout_demoday_app';

/**
 * The three values a template's `category` may take — WHO the deck is for.
 *
 * WIDENED IN #201, NARROWED AGAIN IN #207, and the two moves are the same
 * lesson from opposite ends. #201 found the type reading
 * `'commercial' | 'fundraising'` while `demo_day` and `axal_spinout_demoday`
 * below both write `'event'` and `PitchDeckPage.jsx` hard-codes an `'event'`
 * tab — the type was false about data that had shipped all along, so `'event'`
 * was added. It also added `'narrative'`, for a different and weaker reason:
 * the worker emitted it, and the note here said such a method was "reachable
 * only under All".
 *
 * THAT WAS THE BUG, NOT A CAVEAT. `'narrative'` describes a deck's STYLE and
 * every reader of this field routes by AUDIENCE — `shareDeckAudience.js` picks
 * the post-NDA flow from it, and `PitchDeckPage.jsx:1570` prefers the worker's
 * value over this table's for both the card label and the chips. So
 * `sequoia_classic`, the template founders raise money with, displayed
 * "NARRATIVE" in the picker and vanished from the Fundraising filter. #207
 * retired the value at its source (`services/decks/methods.ts`, D102) rather
 * than teaching more code to cope with it.
 *
 * Widening to `string` would still be the wrong repair, and now there is a test
 * as well as a type: `frontend/test/deck_category_sources_agree.test.mjs` holds
 * this table, the worker's and the FastAPI dev mirror to one answer, because
 * nothing else did and two of the three had drifted.
 */
export type TemplateCategory = 'commercial' | 'fundraising' | 'event';

export type BrandTheme = 'full' | 'accent_only' | 'off';

export interface TemplateMeta {
  key: string;
  label: string;
  description: string;
  slide_count: number;
  required_tier: 'free' | 'growth' | 'studio';
  /**
   * Task #6 — classifies the deck for share-link end-of-deck CTA routing.
   * `commercial` → customer-discovery feedback flow (Sales / Partnership /
   * One-Pager / Narrative Brand); `fundraising` and `event` → the deal-pack +
   * e-sign flow.
   *
   * NOTHING BRANCHES ON A LITERAL HERE ANY MORE. This used to say "`ShareDeckCTA`
   * branches on `=== 'commercial'` and treats the remainder as fundraising" —
   * that fall-through is exactly how a Demo Day viewer was promised documents
   * the next step could not produce (#205). Since D97 the map lives in
   * `frontend/src/lib/shareDeckAudience.js`, an unrecognised value renders no
   * CTA at all rather than defaulting, and a test forbids either file from
   * comparing `category` to a literal again.
   *
   * The wording before that said Demo Day was `fundraising` "even though its
   * backend category is 'event'" — it is `'event'` here too, on the two entries
   * below, and has been since they were added (#201).
   */
  category: TemplateCategory;
  Component: React.FC<DeckProps>;
  /**
   * Task #6 — brand kit theming tier.
   *   `full`       — full palette override (bg, ink, accent, fonts)
   *   `accent_only` — accent color only; backgrounds stay neutral
   *   `off`         — no palette injection; logo still appears on cover
   */
  brandTheme: BrandTheme;
}

export const TEMPLATES: Record<string, TemplateMeta> = {
  // accent_only — accent color only; backgrounds stay neutral
  yc_seed:            { key: 'yc_seed',            label: 'Y Combinator — Seed',           description: '10 slides · YC seed style',                        slide_count: 10, required_tier: 'free',   category: 'fundraising', Component: Deck_yc_seed,            brandTheme: 'accent_only' },
  kawasaki_10_20_30:  { key: 'kawasaki_10_20_30',  label: 'Kawasaki — 10 / 20 / 30',       description: '10 slides · big type only',                        slide_count: 10, required_tier: 'free',   category: 'fundraising', Component: Deck_kawasaki_10_20_30,  brandTheme: 'accent_only' },
  minimal_seed:       { key: 'minimal_seed',       label: 'Minimal Seed — 6 slides',       description: '6 slides · stripped to essentials',                slide_count: 6,  required_tier: 'free',   category: 'fundraising', Component: Deck_minimal_seed,       brandTheme: 'accent_only' },
  investor_appendix:  { key: 'investor_appendix',  label: 'Investor + Appendix',           description: '12 core + 30 appendix (A–I) · editorial · with charts', slide_count: 42, required_tier: 'studio', category: 'fundraising', Component: Deck_investor_appendix,  brandTheme: 'accent_only' },
  demo_day:           { key: 'demo_day',           label: 'Demo Day — Product-first',      description: '12 slides · product-first · SVG mockups',          slide_count: 12, required_tier: 'growth', category: 'event',       Component: Deck_demo_day,           brandTheme: 'accent_only' },
  axal_spinout_demoday: { key: 'axal_spinout_demoday', label: 'Axal VC Spin-Out', description: '11 slides · editorial · binds to Lab data', slide_count: 11, required_tier: 'growth', category: 'event', Component: Deck_axal_spinout_demoday, brandTheme: 'accent_only' },
  // full — full palette override (bg, ink, accent, fonts)
  narrative_brand:    { key: 'narrative_brand',    label: 'Narrative — Brand-led',         description: '4 acts · 15 chapters + 4 dividers · cinematic · custom SVG artwork', slide_count: 19, required_tier: 'studio', category: 'commercial',  Component: Deck_narrative_brand,    brandTheme: 'full' },
  one_pager_teaser:   { key: 'one_pager_teaser',   label: 'One-Pager Teaser',              description: '1 page · cold outreach',                           slide_count: 1,  required_tier: 'free',   category: 'commercial',  Component: Deck_one_pager_teaser,   brandTheme: 'full' },
  partnership_bd:     { key: 'partnership_bd',     label: 'Partnership / BD',              description: '12 slides · executive consulting · SVG diagrams', slide_count: 12, required_tier: 'growth', category: 'commercial',  Component: Deck_partnership_bd,     brandTheme: 'full' },
  sales_commercial:   { key: 'sales_commercial',   label: 'Sales — Customer-facing',       description: '18 slides · customer-facing · SVG product screens', slide_count: 18, required_tier: 'growth', category: 'commercial',  Component: Deck_sales_commercial,   brandTheme: 'full' },
  // off — no palette injection; logo still appears on cover
  sequoia_classic:    { key: 'sequoia_classic',    label: 'Sequoia Classic — Narrative',   description: '12 slides · narrative-driven',                     slide_count: 12, required_tier: 'free',   category: 'fundraising', Component: Deck_sequoia_classic,    brandTheme: 'off' },
  series_a_growth:    { key: 'series_a_growth',    label: 'Series A — Growth & GTM',       description: '15 slides · metrics + GTM',                        slide_count: 15, required_tier: 'growth', category: 'fundraising', Component: Deck_series_a_growth,    brandTheme: 'off' },
  series_b_diligence: { key: 'series_b_diligence', label: 'Series B — Diligence Pack',     description: '22 main + 10 appendix · board-grade',              slide_count: 32, required_tier: 'studio', category: 'fundraising', Component: Deck_series_b_diligence, brandTheme: 'off' },
};

// Explicit registry list — kept in the same order as the TEMPLATES map.
// Listing each entry by hand (instead of `Object.values(TEMPLATES)`) means
// TypeScript fails the build if a key is missing OR if the underlying
// component import returns undefined, instead of silently producing a
// short list at runtime.
export const TEMPLATE_LIST: readonly TemplateMeta[] = [
  TEMPLATES.yc_seed,
  TEMPLATES.sequoia_classic,
  TEMPLATES.kawasaki_10_20_30,
  TEMPLATES.minimal_seed,
  TEMPLATES.series_a_growth,
  TEMPLATES.series_b_diligence,
  TEMPLATES.demo_day,
  TEMPLATES.sales_commercial,
  TEMPLATES.partnership_bd,
  TEMPLATES.one_pager_teaser,
  TEMPLATES.investor_appendix,
  TEMPLATES.narrative_brand,
  TEMPLATES.axal_spinout_demoday,
];

export const TEMPLATE_KEYS: readonly string[] = TEMPLATE_LIST.map((t) => t.key);

export const EXPECTED_TEMPLATE_COUNT = 13;

// Runtime sanity check fires in both dev AND prod — if the registry ever
// resolves to fewer than the expected count, surface it loudly in the
// console (the picker's empty state will then render the diagnostic).
if (TEMPLATE_LIST.length !== EXPECTED_TEMPLATE_COUNT || TEMPLATE_LIST.some((t) => !t || !t.Component)) {
  // eslint-disable-next-line no-console
  console.error(
    `[decks/templates] Registry integrity check failed — expected ${EXPECTED_TEMPLATE_COUNT} ` +
    `entries with Component bound, found ${TEMPLATE_LIST.length} ` +
    `(${TEMPLATE_LIST.filter((t) => t && t.Component).length} valid). ` +
    `Check frontend/src/decks/templates/index.ts and the Deck_* imports it depends on.`,
  );
}
