import type { Env } from '../types';
import { CONNECTOR_METADATA } from './registry';

/**
 * D655 — "Now fed by": how many items each connector delivered into each
 * module it feeds, from `connector_fed_items` (migration 445).
 *
 * EVERY CONNECTOR GETS AN ANSWER, AND NONE IS INVENTED. A connector that
 * writes the ledger gets its counts. One that does not yet (every connector
 * before D655) gets each module it feeds with `count: null` and a reason,
 * never 0: zero would say "nothing arrived", which nobody measured.
 */
export const FED_LEDGER_PROVIDERS = new Set(['github']);

export const MODULE_LABELS: Record<string, string> = {
  product_roadmap: 'Product roadmap',
  prototype_mvp: 'Prototype / MVP',
  capital_relationships: 'Capital relationships',
  network: 'Network',
  customer_research: 'Customer research',
  founding_team: 'Founding team',
  company_creation: 'Company creation',
  market_intelligence: 'Market intelligence',
  revenue_and_traction: 'Revenue and traction',
  customers: 'Customers',
};

export interface FedModule {
  module: string;
  label: string;
  count: number | null;
  linked: number | null;
  unlanded: number | null;
  reason: string | null;
}

export async function fedCounts(env: Env, integrationId: number, providerKey: string): Promise<FedModule[]> {
  const feeds = CONNECTOR_METADATA[providerKey]?.feeds || [];
  const label = (m: string) => MODULE_LABELS[m] || m;
  if (!FED_LEDGER_PROVIDERS.has(providerKey)) {
    return feeds.map((m) => ({
      module: m, label: label(m), count: null, linked: null, unlanded: null,
      reason: 'Not recorded: this connector does not yet record what it delivers to each module.',
    }));
  }
  const rows = await env.DB.prepare(
    `SELECT module, COUNT(*) AS n, SUM(CASE WHEN local_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
       FROM connector_fed_items WHERE integration_id = ? GROUP BY module`,
  ).bind(integrationId).all<{ module: string; n: number; linked: number }>();
  const by = new Map((rows.results || []).map((r) => [r.module, r]));
  return feeds.map((m) => {
    const r = by.get(m);
    const count = Number(r?.n || 0), linked = Number(r?.linked || 0);
    const unlanded = count - linked;
    return {
      module: m, label: label(m), count, linked, unlanded,
      reason: unlanded > 0 ? `${unlanded} arrived with no store to land in (releases have none in ${label(m)} yet).` : null,
    };
  });
}
