/**
 * D1419 (#3698) — what the page draws when it cannot read the Worker.
 *
 * SM8a: a failed layout read draws the profile's DEFAULT with "Your layout
 * could not be read; showing the default", never an empty page. The default
 * lives in the Worker (`STUDIO_DEFAULTS`, `services/studioModules.ts`, D1418),
 * so this copy exists only for the read that failed, and
 * `studio_canvas_d1419.test.mjs` holds it equal to the Worker's table, key for
 * key and size for size. Titles are the Worker's too: they are used only when
 * the catalogue read failed as well.
 */
import { CYCLE_KEYS } from './studioLayoutModel';

export const FALLBACK_DEFAULTS = Object.freeze({
  founder: [
    { key: 'company_progress', size: 'full' },
    { key: 'eadwyn_questions', size: '1/2' },
    { key: 'lab_tools', size: '1/2' },
  ],
  investor: [
    { key: 'usage_quota', size: '1/2' },
    { key: 'deal_lifecycle', size: '1/2' },
    { key: 'scored_opportunities', size: '1/2' },
    { key: 'quick_stats', size: '1/2' },
    { key: 'portfolio_glance', size: '1/2' },
    { key: 'upcoming_events', size: '1/2' },
  ],
  advisor: [
    { key: 'today', size: '1/2' },
    { key: 'storefront', size: '1/2' },
    { key: 'engagements', size: '1/2' },
    { key: 'consented_proof', size: '1/2' },
    { key: 'earnings', size: 'full' },
  ],
  partner: [
    { key: 'firm_tiles', size: 'full' },
    { key: 'operating_brief', size: 'full' },
    { key: 'firm_feed', size: 'full' },
  ],
});

export const FALLBACK_TITLES = Object.freeze({
  company_progress: 'Company progress',
  eadwyn_questions: 'Eadwyn’s questions',
  lab_tools: 'Lab tools',
  usage_quota: 'Usage & quota',
  deal_lifecycle: 'Deal lifecycle',
  scored_opportunities: 'AI-scored opportunities',
  quick_stats: 'Quick stats',
  portfolio_glance: 'Portfolio glance',
  upcoming_events: 'Upcoming events',
  today: 'Today',
  storefront: 'Storefront',
  engagements: 'Engagements',
  consented_proof: 'Consented proof',
  earnings: 'Earnings',
  firm_tiles: 'Firm tiles',
  operating_brief: 'Operating brief',
  firm_feed: 'Firm feed',
});

/** A copy of the profile's default, so a caller's edit never reaches this table. */
export const fallbackLayout = (profile) => (FALLBACK_DEFAULTS[profile] || []).map((e) => ({ ...e }));

/** A module's title when the catalogue read failed: the table above, or the cycle module's own name. */
export const fallbackTitle = (key) => FALLBACK_TITLES[key] || CYCLE_KEYS[key]?.name || 'Module';
