import type React from 'react';
import type { DeckProps } from '../DeckBase';
import { Deck_yc_seed } from './yc_seed';
import { Deck_sequoia_classic } from './sequoia_classic';
import { Deck_kawasaki_10_20_30 } from './kawasaki_10_20_30';
import { Deck_minimal_seed } from './minimal_seed';
import { Deck_series_a_growth } from './series_a_growth';
import { Deck_series_b_diligence } from './series_b_diligence';
import { Deck_demo_day } from './demo_day';
import { Deck_sales_commercial } from './sales_commercial';
import { Deck_partnership_bd } from './partnership_bd';
import { Deck_one_pager_teaser } from './one_pager_teaser';
import { Deck_investor_appendix } from './investor_appendix';
import { Deck_narrative_brand } from './narrative_brand';

export interface TemplateMeta {
  key: string;
  label: string;
  description: string;
  slide_count: number;
  required_tier: 'free' | 'growth' | 'studio';
  Component: React.FC<DeckProps>;
}

export const TEMPLATES: Record<string, TemplateMeta> = {
  yc_seed:            { key: 'yc_seed',            label: 'Y Combinator — Seed',           description: '10 slides · YC seed style',                        slide_count: 10, required_tier: 'free',   Component: Deck_yc_seed },
  sequoia_classic:    { key: 'sequoia_classic',    label: 'Sequoia Classic — Narrative',   description: '12 slides · narrative-driven',                     slide_count: 12, required_tier: 'free',   Component: Deck_sequoia_classic },
  kawasaki_10_20_30:  { key: 'kawasaki_10_20_30',  label: 'Kawasaki — 10 / 20 / 30',       description: '10 slides · big type only',                        slide_count: 10, required_tier: 'free',   Component: Deck_kawasaki_10_20_30 },
  minimal_seed:       { key: 'minimal_seed',       label: 'Minimal Seed — 6 slides',       description: '6 slides · stripped to essentials',                slide_count: 6,  required_tier: 'free',   Component: Deck_minimal_seed },
  series_a_growth:    { key: 'series_a_growth',    label: 'Series A — Growth & GTM',       description: '15 slides · metrics + GTM',                        slide_count: 15, required_tier: 'growth', Component: Deck_series_a_growth },
  series_b_diligence: { key: 'series_b_diligence', label: 'Series B — Diligence Pack',     description: '26 slides incl. appendix · data-heavy',            slide_count: 26, required_tier: 'studio', Component: Deck_series_b_diligence },
  demo_day:           { key: 'demo_day',           label: 'Demo Day — Product-first',      description: '11 slides · screenshot-heavy',                     slide_count: 11, required_tier: 'growth', Component: Deck_demo_day },
  sales_commercial:   { key: 'sales_commercial',   label: 'Sales — Customer-facing',       description: '15 slides · sales conversation',                   slide_count: 15, required_tier: 'growth', Component: Deck_sales_commercial },
  partnership_bd:     { key: 'partnership_bd',     label: 'Partnership / BD',              description: '12 slides · mutual value',                         slide_count: 12, required_tier: 'growth', Component: Deck_partnership_bd },
  one_pager_teaser:   { key: 'one_pager_teaser',   label: 'One-Pager Teaser',              description: '1 page · cold outreach',                           slide_count: 1,  required_tier: 'free',   Component: Deck_one_pager_teaser },
  investor_appendix:  { key: 'investor_appendix',  label: 'Investor + Appendix',           description: '13 slides + appendix · with data room',            slide_count: 23, required_tier: 'studio', Component: Deck_investor_appendix },
  narrative_brand:    { key: 'narrative_brand',    label: 'Narrative — Brand-led',         description: '14 slides · story-led, consumer / brand',          slide_count: 14, required_tier: 'studio', Component: Deck_narrative_brand },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export const TEMPLATE_LIST: TemplateMeta[] = Object.values(TEMPLATES);

if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
  if (TEMPLATE_LIST.length !== 12) {
     
    console.warn(
      `[decks/templates] Expected 12 templates, found ${TEMPLATE_LIST.length}. ` +
      `Check frontend/src/decks/templates/index.ts.`,
    );
  }
}
