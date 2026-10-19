import type { Env } from '../types';
import { connectorFeeds } from './registry';
import { GITHUB_READ_BY } from './githubFeeds';

/**
 * D655 — "Now fed by": how many items each connector delivered into each
 * module it feeds, from `connector_fed_items` (migration 445).
 *
 * EVERY CONNECTOR GETS AN ANSWER, AND NONE IS INVENTED. A connector that
 * writes the ledger gets its counts. One that does not yet (every connector
 * before D655) gets each module it feeds with `count: null` and a reason,
 * never 0: zero would say "nothing arrived", which nobody measured.
 */
export const FED_LEDGER_PROVIDERS = new Set(['github', 'mercury']);

import { MODULE_LABELS, moduleHref } from './moduleLabels';
export { MODULE_LABELS } from './moduleLabels';

export interface FedModule {
  module: string;
  label: string;
  href: string | null;
  count: number | null;
  linked: number | null;
  unlanded: number | null;
  reason: string | null;
}

/**
 * `role` is the connection owner's: Mercury's personal variant feeds by role (D713).
 * `projectId`, when given, counts only what landed in that project (D782's Code
 * system on Operating systems); without it, everything the connection delivered.
 */
export async function fedCounts(env: Env, integrationId: number, providerKey: string, role?: string | null, projectId?: number | null): Promise<FedModule[]> {
  const feeds = connectorFeeds(providerKey, role);
  const label = (m: string) => MODULE_LABELS[m] || m;
  if (!FED_LEDGER_PROVIDERS.has(providerKey)) {
    return feeds.map((m) => ({
      module: m, label: label(m), href: moduleHref(m), count: null, linked: null, unlanded: null,
      reason: 'Not recorded: this connector does not yet record what it delivers to each module.',
    }));
  }
  const rows = projectId == null ? await env.DB.prepare(
    `SELECT module, COUNT(*) AS n, SUM(CASE WHEN local_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
       FROM connector_fed_items WHERE integration_id = ? GROUP BY module`,
  ).bind(integrationId).all<{ module: string; n: number; linked: number }>() : await env.DB.prepare(
    `SELECT module, COUNT(*) AS n, SUM(CASE WHEN local_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
       FROM connector_fed_items WHERE integration_id = ? AND project_id = ? GROUP BY module`,
  ).bind(integrationId, projectId).all<{ module: string; n: number; linked: number }>();
  const by = new Map((rows.results || []).map((r) => [r.module, r]));
  return feeds.map((m) => {
    // D782: a module that reads the connection itself has no ledger rows; 0 would say nothing arrived.
    if (providerKey === 'github' && (GITHUB_READ_BY as readonly string[]).includes(m)) {
      return { module: m, label: label(m), href: moduleHref(m), count: null, linked: null, unlanded: null,
        reason: 'Read from the connection: GitHub is the Code system here, with its repositories and each sync.' };
    }
    const r = by.get(m);
    const count = Number(r?.n || 0), linked = Number(r?.linked || 0);
    const unlanded = count - linked;
    return {
      module: m, label: label(m), href: moduleHref(m), count, linked, unlanded,
      // An item whose row is gone was deleted here, and stays deleted (#1906).
      reason: unlanded > 0 ? `${unlanded} arrived and ${unlanded === 1 ? 'its row was' : 'their rows were'} deleted in ${label(m)}; a sync does not bring ${unlanded === 1 ? 'it' : 'them'} back.` : null,
    };
  });
}
