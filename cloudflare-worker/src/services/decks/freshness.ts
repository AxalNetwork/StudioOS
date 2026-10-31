/**
 * D1599 (#3877): how fresh each connector a deck reads is, before a run spends
 * the founder's tokens.
 *
 * - **Which connectors:** the venture's integrations rows switched on for its
 *   company (the join `projectEnabled` makes, integrations/companyScope.ts),
 *   for the providers DECK_SOURCES reads. A connector that is not connected is
 *   absent, never "stale".
 * - **Mercury** is the founder's own connection only (D840, `mercuryFor`). For
 *   anyone else it is left out, not marked stale.
 * - **`as_of`** is the newer of what the adapter in services/decks/sources.ts
 *   read (its connector-graded slots) and the row's `last_synced_at`.
 * - **`stale`** is true when `as_of` is older than the provider's cadence, or
 *   when nothing has been read or synced at all.
 * - **`sync`** names the existing `POST /api/connectors/:uid/sync`. This read
 *   never starts a sync; the frontend asks the founder first.
 */
import type { Env } from '../../types';
import { DECK_SOURCES, type SourceCtx, type SourceItem } from './sources';

/** Days before a provider's data counts as stale. */
export const FRESHNESS_CADENCE_DAYS: Readonly<Record<string, number>> = { stripe: 7, mercury: 7, carta: 30, github: 7 };
export const FRESHNESS_DEFAULT_DAYS = 30;
/** Which DECK_SOURCES adapters each provider feeds. A provider added later adds one row. */
export const PROVIDER_ADAPTERS: Readonly<Record<string, readonly string[]>> = {
  stripe: ['revenue'],
  mercury: ['mercury'],
  carta: ['cap_table', 'team'],
  github: ['github'],
};

export type Freshness = { provider: string; as_of: string | null; stale: boolean; sync: { method: 'POST'; path: string } };

const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The newest date the provider's adapters read from the connector itself. */
function readAsOf(provider: string, items: readonly SourceItem[]): string | null {
  const ids = new Set(PROVIDER_ADAPTERS[provider] ?? []);
  const keys = new Set(DECK_SOURCES.filter((a) => ids.has(a.id)).flatMap((a) => a.slots.map((s) => s.key)));
  return items.filter((i) => keys.has(i.source_key) && i.state === 'recorded' && i.source === 'Connector')
    .map((i) => day(i.as_of)).filter((d): d is string => !!d).sort().pop() ?? null;
}

export function staleAt(provider: string, asOf: string | null, today: string): boolean {
  if (!asOf) return true;
  return daysBetween(asOf, today) > (FRESHNESS_CADENCE_DAYS[provider] ?? FRESHNESS_DEFAULT_DAYS);
}

type Row = { uid: string; provider_key: string; last_synced_at: string | null };

export async function freshnessFor(
  env: Env,
  projectId: number,
  ctx: { mercury: SourceCtx['mercury']; items: readonly SourceItem[]; today: string },
): Promise<Freshness[]> {
  const providers = new Set(Object.keys(PROVIDER_ADAPTERS).filter((p) => p !== 'mercury'));
  const all = ((await env.DB.prepare(
    `SELECT DISTINCT i.uid, i.provider_key, i.last_synced_at FROM projects p
       JOIN integration_companies ic ON ic.company_id = p.company_id AND ic.enabled = 1
       JOIN integrations i ON i.id = ic.integration_id
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
      WHERE p.id = ? AND p.deleted_at IS NULL AND i.status = 'active'
      ORDER BY i.provider_key, i.id`,
  ).bind(projectId).all<Row>()).results ?? []) as Row[];
  const rows = all.filter((r) => providers.has(r.provider_key));
  // D840: the bank is read only from the founder's own connection.
  if (ctx.mercury && 'integrationId' in ctx.mercury) {
    const m = await env.DB.prepare("SELECT uid, provider_key, last_synced_at FROM integrations WHERE id = ? AND provider_key = 'mercury' AND status = 'active'")
      .bind(ctx.mercury.integrationId).first<Row>();
    if (m) rows.push(m);
  }
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.provider_key) && seen.add(r.provider_key)).map((r) => {
    const as_of = [readAsOf(r.provider_key, ctx.items), day(r.last_synced_at)].filter((d): d is string => !!d).sort().pop() ?? null;
    return { provider: r.provider_key, as_of, stale: staleAt(r.provider_key, as_of, ctx.today), sync: { method: 'POST' as const, path: `/api/connectors/${r.uid}/sync` } };
  });
}
