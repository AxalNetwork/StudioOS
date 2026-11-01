/**
 * D1601 (#3880) — the three pipeline counts a pitch deck reads from the
 * venture founder's own HubSpot, live and read-only.
 *
 * COUNTS ONLY. Every request is a CRM search that asks for one property:
 * `hs_object_id` for a count (`limit: 1`, and only `total` is read) and
 * `amount` for the pipeline value. HubSpot answers a search with no
 * `properties` with its defaults, a deal's name among them, so the list is
 * never left out. No contact, deal name, owner or email is requested, kept,
 * logged or returned.
 *
 * SCOPES. The provider already asks for `crm.objects.deals.read` and
 * `crm.objects.companies.read` (`providers/hubspot.ts`); nothing here needs
 * more.
 *
 * A failed request throws with its status only, never HubSpot's body, and
 * the caller marks its slots unreadable. The caller's signal ends the reads
 * at its deadline.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { getActiveAccessToken } from '../../integrations/providers/hubspot';

export const HS_API = 'https://api.hubapi.com';

/** An open deal: HubSpot's own calculated "closed" flag is false. */
export const OPEN_DEALS = { propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' } as const;
/** A customer: a company whose lifecycle stage is `customer`. */
export const CUSTOMERS = { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' } as const;
/** Every property any request here asks for. */
export const READ_PROPERTIES = ['hs_object_id', 'amount'] as const;
/** HubSpot's largest search page, and its 10,000-result search ceiling. */
export const PAGE = 200;
export const MAX_PAGES = 50;

export type HubspotFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type PipelineCounts = { open_deals: number; pipeline_value: number; customers: number };

type Filter = { propertyName: string; operator: string; value: string };
type SearchAnswer = { total?: unknown; results?: Array<{ properties?: Record<string, unknown> }>; paging?: { next?: { after?: unknown } } };

export class HubspotCountError extends Error {
  readonly status: number | null;
  constructor(status: number | null) { super(`hubspot_count_${status ?? 'unreadable'}`); this.name = 'HubspotCountError'; this.status = status; }
}

/** The venture's open deals, their summed amounts and its customers, from one connection. */
export async function hubspotPipelineCounts(
  env: Env, row: IntegrationRow, opts: { fetcher?: HubspotFetch; signal?: AbortSignal } = {},
): Promise<PipelineCounts> {
  const fetcher = opts.fetcher ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const token = await getActiveAccessToken(env, row);
  const search = async (object: 'deals' | 'companies', filter: Filter, property: (typeof READ_PROPERTIES)[number], limit: number, after?: string): Promise<SearchAnswer> => {
    const res = await fetcher(`${HS_API}/crm/v3/objects/${object}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [filter] }], properties: [property], limit, ...(after ? { after } : {}) }),
      signal: opts.signal,
    });
    if (!res.ok) throw new HubspotCountError(res.status);
    try { return await res.json() as SearchAnswer; } catch { throw new HubspotCountError(null); }
  };
  const totalOf = (a: SearchAnswer): number => {
    const n = Number(a.total);
    if (!Number.isSafeInteger(n) || n < 0) throw new HubspotCountError(null);
    return n;
  };

  const open_deals = totalOf(await search('deals', OPEN_DEALS, 'hs_object_id', 1));
  const customers = totalOf(await search('companies', CUSTOMERS, 'hs_object_id', 1));
  let pipeline_value = 0;
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const a = await search('deals', OPEN_DEALS, 'amount', PAGE, after);
    for (const r of a.results ?? []) {
      const amount = Number(r?.properties?.amount);
      if (r?.properties?.amount != null && r.properties.amount !== '' && Number.isFinite(amount)) pipeline_value += amount;
    }
    const next = a.paging?.next?.after;
    if (typeof next !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(next)) break;
    after = next;
  }
  return { open_deals, pipeline_value: Math.round(pipeline_value * 100) / 100, customers };
}
