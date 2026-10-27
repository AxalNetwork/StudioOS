/**
 * D1319 (#3480, part 1 of #2400) — where a draft may be made from: the nine
 * Grow places of #2400's Module map, and, per place, the store fields a
 * draft builder may read (`PUBLISH_SOURCES`). Part 2 (#2400) builds the nine
 * builders and fills the field lists; a test then holds every builder to
 * them, so a field off the list never reaches a draft. Part 1 has no builder:
 * a draft holds only the founder's own words.
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
}

export const PUBLISH_SOURCES: readonly PublishSource[] = Object.freeze([]);
