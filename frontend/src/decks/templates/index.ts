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
// Task #15 — Axal 30-day Spin-Out Lab Demo Day deck (14 slides · 4 variants).
import { Deck_axal_spinout_demoday } from './axal_spinout_demoday_app';

export type TemplateCategory = 'commercial' | 'fundraising';

export interface TemplateMeta {
  key: string;
  label: string;
  description: string;
  slide_count: number;
  required_tier: 'free' | 'growth' | 'studio';
  /**
   * Task #6 — classifies the deck for share-link end-of-deck CTA routing.
   * `commercial` → customer-discovery feedback flow (Sales / Partnership /
   * One-Pager / Narrative Brand). `fundraising` → auto-generated deal-pack
   * + e-sign flow (everything else, including Demo Day even though its
   * backend `category` is 'event').
   */
  category: TemplateCategory;
  Component: React.FC<DeckProps>;
}

export const TEMPLATES: Record<string, TemplateMeta> = {
  yc_seed:            { key: 'yc_seed',            label: 'Y Combinator — Seed',           description: '10 slides · YC seed style',                        slide_count: 10, required_tier: 'free',   category: 'fundraising', Component: Deck_yc_seed },
  sequoia_classic:    { key: 'sequoia_classic',    label: 'Sequoia Classic — Narrative',   description: '12 slides · narrative-driven',                     slide_count: 12, required_tier: 'free',   category: 'fundraising', Component: Deck_sequoia_classic },
  kawasaki_10_20_30:  { key: 'kawasaki_10_20_30',  label: 'Kawasaki — 10 / 20 / 30',       description: '10 slides · big type only',                        slide_count: 10, required_tier: 'free',   category: 'fundraising', Component: Deck_kawasaki_10_20_30 },
  minimal_seed:       { key: 'minimal_seed',       label: 'Minimal Seed — 6 slides',       description: '6 slides · stripped to essentials',                slide_count: 6,  required_tier: 'free',   category: 'fundraising', Component: Deck_minimal_seed },
  series_a_growth:    { key: 'series_a_growth',    label: 'Series A — Growth & GTM',       description: '15 slides · metrics + GTM',                        slide_count: 15, required_tier: 'growth', category: 'fundraising', Component: Deck_series_a_growth },
  series_b_diligence: { key: 'series_b_diligence', label: 'Series B — Diligence Pack',     description: '22 main + 10 appendix · board-grade',              slide_count: 32, required_tier: 'studio', category: 'fundraising', Component: Deck_series_b_diligence },
  demo_day:           { key: 'demo_day',           label: 'Demo Day — Product-first',      description: '12 slides · product-first · SVG mockups',          slide_count: 12, required_tier: 'growth', category: 'fundraising', Component: Deck_demo_day },
  sales_commercial:   { key: 'sales_commercial',   label: 'Sales — Customer-facing',       description: '18 slides · customer-facing · SVG product screens', slide_count: 18, required_tier: 'growth', category: 'commercial',  Component: Deck_sales_commercial },
  partnership_bd:     { key: 'partnership_bd',     label: 'Partnership / BD',              description: '12 slides · executive consulting · SVG diagrams', slide_count: 12, required_tier: 'growth', category: 'commercial',  Component: Deck_partnership_bd },
  one_pager_teaser:   { key: 'one_pager_teaser',   label: 'One-Pager Teaser',              description: '1 page · cold outreach',                           slide_count: 1,  required_tier: 'free',   category: 'commercial',  Component: Deck_one_pager_teaser },
  investor_appendix:  { key: 'investor_appendix',  label: 'Investor + Appendix',           description: '12 core + 30 appendix (A–I) · editorial · with charts', slide_count: 42, required_tier: 'studio', category: 'fundraising', Component: Deck_investor_appendix },
  narrative_brand:    { key: 'narrative_brand',    label: 'Narrative — Brand-led',         description: '4 acts · 15 chapters + 4 dividers · cinematic · custom SVG artwork', slide_count: 19, required_tier: 'studio', category: 'commercial',  Component: Deck_narrative_brand },
  axal_spinout_demoday: { key: 'axal_spinout_demoday', label: 'Axal VC Spin-Out', description: '14 slides · 4 variants (editorial / product-first / data-dense / manifesto) · binds to Lab data', slide_count: 14, required_tier: 'growth', category: 'fundraising', Component: Deck_axal_spinout_demoday },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export const TEMPLATE_LIST: TemplateMeta[] = Object.values(TEMPLATES);

if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
  if (TEMPLATE_LIST.length !== 13) {
     
    console.warn(
      `[decks/templates] Expected 13 templates, found ${TEMPLATE_LIST.length}. ` +
      `Check frontend/src/decks/templates/index.ts.`,
    );
  }
}
