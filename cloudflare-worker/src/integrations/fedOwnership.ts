import type { Env } from '../types';

export type FedOwnedTable = 'roadmap_okrs' | 'mvp_features';
function check(table: string, id: number): void {
  if (!['roadmap_okrs', 'mvp_features'].includes(table) || !Number.isSafeInteger(id) || id <= 0) throw new Error('invalid_fed_target');
}
/** No owner means hand-entered or unlinked. It never authorizes overwriting a row. */
export async function ledgerOwnerOf(env: Env, localTable: FedOwnedTable, localId: number): Promise<number | null> {
  check(localTable, localId);
  const rows = await env.DB.prepare('SELECT DISTINCT integration_id FROM connector_fed_items WHERE local_table = ? AND local_id = ? LIMIT 2')
    .bind(localTable, localId).all<{ integration_id: number }>();
  if ((rows.results || []).length > 1) throw new Error('fed_ownership_conflict');
  return rows.results?.[0]?.integration_id ?? null;
}
/** Permission for an explicit link only. Automatic imports still create their own rows. */
export async function canLink(env: Env, integrationId: number, localTable: FedOwnedTable, localId: number): Promise<boolean> {
  if (!Number.isSafeInteger(integrationId) || integrationId <= 0) return false;
  const owner = await ledgerOwnerOf(env, localTable, localId);
  return owner === null || owner === integrationId;
}
