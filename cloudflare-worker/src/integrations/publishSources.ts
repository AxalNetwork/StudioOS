/**
 * D1319 (#3480, part 1 of #2400) — where a draft may be made from: the nine
 * Grow places of #2400's Module map, and, per place, the store fields a
 * draft builder may read (`PUBLISH_SOURCES`). D1333 (#3481, part 2) fills the
 * lists and builds the nine builders (`services/publishSources.ts`); a test
 * holds every builder's SELECT to its `fields`, so a field off the list never
 * reaches a draft, and every `never` field to the seeded values it must not
 * carry.
 *
 * No side effects and no imports.
 */

/** The nine places a founder publishes from: Overview, Updates and Grow's seven modules. */
export const PUBLISH_MODULES = Object.freeze([
  'overview', 'updates', 'product-improvement', 'distribution', 'revenue-and-traction',
  'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building',
] as const);
export type PublishModule = typeof PUBLISH_MODULES[number];

export interface PublishSource {
  module: PublishModule;
  /** The store a draft builder reads. */
  store: string;
  /** The fields it may quote; anything else never reaches a draft. */
  fields: readonly string[];
  /** The store's fields a draft never carries (#2400's "Never in a draft"), checked by a test. */
  never: readonly string[];
}

const src = (module: PublishModule, store: string, fields: readonly string[], never: readonly string[] = []): PublishSource =>
  Object.freeze({ module, store, fields: Object.freeze([...fields]), never: Object.freeze([...never]) });

/** #2400's Module map, as data. A figure from the founder's Mercury is team-only unless ticked for the draft. */
export const PUBLISH_SOURCES: readonly PublishSource[] = Object.freeze([
  // Overview: the headline figures `growFigures` reads, each with its source and date.
  src('overview', 'grow_figures', ['key', 'label', 'value', 'unit', 'source', 'as_of']),
  // Updates: the network's version of a sent update — the title and the asks; the metrics only if the founder included them.
  src('updates', 'portfolio_updates', ['uid', 'title', 'period_start', 'period_end', 'metrics_json', 'network_includes_metrics', 'sent_at'],
    ['highlights_json', 'lowlights_json', 'audience_json', 'body', 'kpis_json']),
  src('updates', 'update_asks', ['uid', 'kind', 'text']),
  // Product improvement: what shipped, never who asked for it or their words.
  src('product-improvement', 'product_feedback', ['uid', 'theme', 'roadmap_item_label', 'shipped_on'],
    ['from_name', 'from_email', 'from_company', 'body']),
  // Distribution: the live channels and the experiments run, never spend, CAC or UTM data.
  src('distribution', 'growth_channels', ['uid', 'name'], ['utm_source', 'cac_bar_cents']),
  src('distribution', 'channel_experiments', ['uid', 'title', 'run_on'], ['cac_cents']),
  // Revenue and traction: the latest recorded figure of each kind; bank figures are team-only.
  src('revenue-and-traction', 'project_metrics', ['snapshot_date', 'source', 'mrr', 'arr', 'paying_accounts', 'new_users', 'nrr_pct', 'net_burn', 'cash_balance', 'cash_in_cents'],
    ['notes']),
  // Team expansion: live postings only, never applicants, people or pay.
  src('team-expansion', 'job_postings', ['slug', 'title', 'location_text', 'remote', 'summary', 'published_at'],
    ['comp_min_cents', 'comp_max_cents', 'equity_pct', 'description', 'review_notes']),
  // Partner network: a signed partner's type. Its name waits for a recorded "agreed to be named" (D1333 §2).
  src('partner-network', 'growth_partners', ['uid', 'type'], ['name', 'terms', 'terms_pct', 'terms_amount_cents', 'contact_name', 'contact_email']),
  // Market expansion: markets entered or served and the steps done, never scores, their sources or step owners.
  src('market-expansion', 'markets', ['uid', 'name', 'state', 'decision', 'decided_on', 'updated_at'],
    ['demand_score', 'demand_source', 'regulation_score', 'regulation_source', 'partners_score', 'partners_source', 'cost_score', 'cost_source', 'size_cents', 'size_source']),
  src('market-expansion', 'market_entry_steps', ['uid', 'text', 'done_at'], ['owner_name']),
  // Durable company-building: the checklist items done.
  src('durable-company-building', 'durability_checklist', ['item_key', 'done_at']),
]);
