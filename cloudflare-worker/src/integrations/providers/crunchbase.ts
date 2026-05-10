/**
 * Task #3 (2026-05-10) — Crunchbase provider implementation (BETA, growth tier).
 *
 * One-way read-only enrichment via the Crunchbase Basic API. Each user
 * provides their own `user_key` (api_key) — Crunchbase issues per-account
 * keys; we do NOT operate a shared key. Per-user keys preserve rate-limit
 * accounting (Basic = 200 calls/day per key) and let the user revoke at
 * will from their Crunchbase account.
 *
 * Credential blob shape:
 *   { api_key: string }                 // long-lived user_key
 *
 * Endpoints we hit (Basic-tier surface):
 *   GET  /api/v4/searches/organizations  (POST body: query+field_ids+order)
 *   GET  /api/v4/entities/organizations/{uuid_or_permalink}?card_ids=...
 *
 * Rate-limit handling: a 429 from Crunchbase is the daily cap. We surface
 * it to the integration row's `last_error='rate_limited:<resetEpoch?>'`
 * so the IntegrationsPage banner renders explicit "daily limit reached"
 * copy. Other 4xx/5xx pass through with the upstream message.
 *
 * Actions exposed:
 *   - search       { q: string, limit?: number }    → [{uuid, name, ...}]
 *   - lookup       { uuid: string }                  → full snapshot
 *   - competitors  { uuid: string, limit?: number }  → similar orgs (sector heuristic)
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import {
  registerProvider,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import { decryptCredentials, type CredentialBlob } from '../secrets';

const PROVIDER_KEY = 'crunchbase';
const CB_BASE = 'https://api.crunchbase.com/api/v4';

// ───────────────────────────────────────────────── HTTP

export class CrunchbaseRateLimited extends Error {
  resetHint?: string;
  constructor(resetHint?: string) {
    super('crunchbase_rate_limited');
    this.resetHint = resetHint;
  }
}

export class CrunchbaseUnauthorized extends Error {
  constructor() { super('crunchbase_unauthorized'); }
}

interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export async function crunchbaseFetch(
  apiKey: string, path: string, opts: FetchOpts = {},
): Promise<unknown> {
  const url = new URL(`${CB_BASE}${path}`);
  url.searchParams.set('user_key', apiKey);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method: opts.method || 'GET',
    headers: { 'Accept': 'application/json' },
  };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 401 || res.status === 403) throw new CrunchbaseUnauthorized();
  if (res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset') || res.headers.get('retry-after') || '';
    throw new CrunchbaseRateLimited(reset || undefined);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`crunchbase_http_${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
}

// ───────────────────────────────────────────────── shape helpers

interface CbOrgIdentifier {
  uuid?: string;
  permalink?: string;
  value?: string;       // display name in identifier objects
  image_url?: string;
}
interface CbOrgEntity {
  uuid: string;
  identifier?: CbOrgIdentifier;
  properties?: Record<string, unknown>;
  cards?: Record<string, unknown>;
}

const ORG_FIELDS = [
  'identifier','short_description','website','linkedin','founded_on',
  'location_identifiers','category_groups','categories','operating_status',
  'company_type','num_employees_enum','funding_total','last_funding_type',
  'last_funding_at','rank_org','equity_funding_total','num_funding_rounds',
];

export interface CrunchbaseSnapshot {
  uuid: string;
  permalink: string | null;
  name: string;
  image_url: string | null;
  short_description: string | null;
  website: string | null;
  linkedin: string | null;
  founded_on: string | null;
  hq_location: string | null;
  categories: string[];
  category_groups: string[];
  operating_status: string | null;
  company_type: string | null;
  employee_range: string | null;
  funding_total_usd: number | null;
  equity_funding_total_usd: number | null;
  num_funding_rounds: number | null;
  last_funding_type: string | null;
  last_funding_at: string | null;
  rank: number | null;
  cb_url: string;
  fetched_at: string;
}

function pickMoney(v: unknown): number | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const amt = typeof o.value_usd === 'number' ? o.value_usd
    : (typeof o.value === 'number' && (o.currency === 'USD' || !o.currency) ? o.value : null);
  return typeof amt === 'number' ? amt : null;
}

function flattenLocations(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map(l => (l && typeof l === 'object' && 'value' in (l as object))
    ? String((l as { value?: unknown }).value || '')
    : '').filter(Boolean).join(', ') || null;
}

function flattenCategories(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(l => (l && typeof l === 'object' && 'value' in (l as object))
    ? String((l as { value?: unknown }).value || '') : '').filter(Boolean);
}

export function shapeOrg(entity: CbOrgEntity): CrunchbaseSnapshot {
  const p = entity.properties || {};
  const id = entity.identifier || (p.identifier as CbOrgIdentifier | undefined) || {};
  const permalink = id.permalink || null;
  return {
    uuid: entity.uuid || id.uuid || '',
    permalink,
    name: id.value || (p.name as string) || '',
    image_url: id.image_url || (p.image_url as string) || null,
    short_description: (p.short_description as string) || null,
    website: ((p.website as { value?: string } | undefined)?.value) || (p.website as string) || null,
    linkedin: ((p.linkedin as { value?: string } | undefined)?.value) || null,
    founded_on: ((p.founded_on as { value?: string } | undefined)?.value) || null,
    hq_location: flattenLocations(p.location_identifiers),
    categories: flattenCategories(p.categories),
    category_groups: flattenCategories(p.category_groups),
    operating_status: (p.operating_status as string) || null,
    company_type: (p.company_type as string) || null,
    employee_range: (p.num_employees_enum as string) || null,
    funding_total_usd: pickMoney(p.funding_total),
    equity_funding_total_usd: pickMoney(p.equity_funding_total),
    num_funding_rounds: typeof p.num_funding_rounds === 'number' ? p.num_funding_rounds as number : null,
    last_funding_type: (p.last_funding_type as string) || null,
    last_funding_at: ((p.last_funding_at as { value?: string } | undefined)?.value)
      || (typeof p.last_funding_at === 'string' ? p.last_funding_at as string : null),
    rank: typeof p.rank_org === 'number' ? p.rank_org as number : null,
    cb_url: permalink ? `https://www.crunchbase.com/organization/${permalink}` : '',
    fetched_at: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────── high-level helpers

export async function searchOrganizations(
  apiKey: string, query: string, limit = 10,
): Promise<CrunchbaseSnapshot[]> {
  const body = {
    field_ids: ORG_FIELDS,
    query: [{ type: 'predicate', field_id: 'identifier', operator_id: 'contains', values: [query] }],
    order: [{ field_id: 'rank_org', sort: 'asc' }],
    limit: Math.max(1, Math.min(50, Math.floor(limit) || 10)),
  };
  const res = await crunchbaseFetch(apiKey, '/searches/organizations', { method: 'POST', body });
  const entities = ((res as { entities?: CbOrgEntity[] })?.entities) || [];
  return entities.map(shapeOrg);
}

export async function lookupOrganization(
  apiKey: string, uuidOrPermalink: string,
): Promise<CrunchbaseSnapshot | null> {
  const path = `/entities/organizations/${encodeURIComponent(uuidOrPermalink)}`;
  const res = await crunchbaseFetch(apiKey, path, { query: { field_ids: ORG_FIELDS.join(',') } }) as CbOrgEntity | null;
  if (!res) return null;
  return shapeOrg(res);
}

/**
 * Sector-heuristic competitor list — Basic tier doesn't expose a "similar
 * companies" endpoint, so we search by category overlap on the source
 * snapshot's primary category_group and exclude the source uuid.
 */
export async function findCompetitors(
  apiKey: string, source: CrunchbaseSnapshot, limit = 10,
): Promise<CrunchbaseSnapshot[]> {
  const primary = source.category_groups[0] || source.categories[0];
  if (!primary) return [];
  const body = {
    field_ids: ORG_FIELDS,
    query: [
      { type: 'predicate', field_id: 'category_groups', operator_id: 'includes', values: [primary] },
      { type: 'predicate', field_id: 'operating_status', operator_id: 'includes', values: ['active'] },
    ],
    order: [{ field_id: 'rank_org', sort: 'asc' }],
    limit: Math.max(1, Math.min(25, Math.floor(limit) || 10)) + 1,
  };
  const res = await crunchbaseFetch(apiKey, '/searches/organizations', { method: 'POST', body });
  const entities = ((res as { entities?: CbOrgEntity[] })?.entities) || [];
  return entities.map(shapeOrg).filter(e => e.uuid !== source.uuid).slice(0, limit);
}

// ───────────────────────────────────────────────── credential extraction

async function getApiKey(env: Env, row: IntegrationRow): Promise<string> {
  const fresh = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
    .bind(row.id).first<{ credentials_enc: string }>();
  const blob: CredentialBlob | null = await decryptCredentials(env, row.uid, fresh?.credentials_enc || row.credentials_enc);
  const k = typeof blob?.api_key === 'string' ? blob.api_key.trim() : '';
  if (!k) throw new Error('crunchbase_credentials_missing');
  return k;
}

/**
 * Persist a deterministic `rate_limited:<unix_epoch_ms>` marker on the row.
 * The epoch is the moment the user can retry: x-ratelimit-reset (seconds
 * since epoch) when present, else next UTC midnight (Crunchbase Basic
 * resets daily). The IntegrationsPage banner + the project lookup
 * slide-over both parse this suffix to render a "try again at HH:MM"
 * message and to disable search until the timestamp passes.
 */
function computeResetEpoch(hint?: string): number {
  if (hint) {
    const n = Number(hint);
    if (Number.isFinite(n) && n > 0) {
      // Heuristic: values <1e10 are seconds, larger are ms.
      return n < 1e10 ? Math.floor(n * 1000) : Math.floor(n);
    }
    const t = Date.parse(hint);
    if (!Number.isNaN(t)) return t;
  }
  // Default — next UTC midnight (Crunchbase Basic daily reset).
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return next;
}

async function markRateLimited(env: Env, row: IntegrationRow, hint?: string): Promise<void> {
  const epoch = computeResetEpoch(hint);
  await env.DB.prepare(
    'UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).bind(`rate_limited:${epoch}`, row.id).run();
}

async function clearRateLimited(env: Env, row: IntegrationRow): Promise<void> {
  await env.DB.prepare(
    "UPDATE integrations SET last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND last_error LIKE 'rate_limited%'",
  ).bind(row.id).run();
}

// ───────────────────────────────────────────────── connect / sync / action

async function connect(_c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  const apiKey = String(input.api_key || '').trim();
  if (!apiKey) throw new Error('crunchbase_api_key_required');
  // Validation smoke test — cheapest possible probe.
  try {
    await crunchbaseFetch(apiKey, '/searches/organizations', {
      method: 'POST',
      body: { field_ids: ['identifier'], limit: 1 },
    });
  } catch (e) {
    if (e instanceof CrunchbaseUnauthorized) throw new Error('crunchbase_unauthorized: API key was rejected by Crunchbase.');
    if (e instanceof CrunchbaseRateLimited) throw new Error('crunchbase_rate_limited: this API key has hit its daily quota — try again tomorrow.');
    throw e;
  }
  return {
    credentials: { api_key: apiKey } as CredentialBlob,
    scopes: ['basic_read'],
    external_account_id: null,
    external_account_name: 'Crunchbase Basic',
    capabilities: ['Company enrichment', 'Funding history', 'Competitor lookup'],
    config: { tier: 'basic' },
  };
}

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  // Connection-health probe; doesn't pull any data on its own (Crunchbase
  // enrichment is initiated from project-level lookup actions).
  const apiKey = await getApiKey(c.env, row);
  try {
    await crunchbaseFetch(apiKey, '/searches/organizations', {
      method: 'POST',
      body: { field_ids: ['identifier'], limit: 1 },
    });
  } catch (e) {
    if (e instanceof CrunchbaseRateLimited) {
      await markRateLimited(c.env, row, e.resetHint);
      return { summary: 'rate_limited', counts: { rate_limited: 1 } };
    }
    throw e;
  }
  await clearRateLimited(c.env, row);
  return { summary: 'ok', counts: { healthcheck: 1 } };
}

async function action(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, name: string, body: unknown): Promise<unknown> {
  const apiKey = await getApiKey(c.env, row);
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  try {
    let out: unknown;
    if (name === 'search') {
      const q = String(b.q || b.query || '').trim();
      if (!q) throw new Error('query_required');
      const limit = typeof b.limit === 'number' ? b.limit : 10;
      out = { results: await searchOrganizations(apiKey, q, limit) };
    } else if (name === 'lookup') {
      const uuid = String(b.uuid || b.permalink || '').trim();
      if (!uuid) throw new Error('uuid_required');
      out = { snapshot: await lookupOrganization(apiKey, uuid) };
    } else if (name === 'competitors') {
      const uuid = String(b.uuid || b.permalink || '').trim();
      if (!uuid) throw new Error('uuid_required');
      const snap = await lookupOrganization(apiKey, uuid);
      if (!snap) { out = { competitors: [] }; }
      else {
        const limit = typeof b.limit === 'number' ? b.limit : 10;
        out = { source: snap, competitors: await findCompetitors(apiKey, snap, limit) };
      }
    } else {
      throw new Error(`unknown_action: ${name}`);
    }
    await clearRateLimited(c.env, row);
    return out;
  } catch (e) {
    if (e instanceof CrunchbaseRateLimited) {
      await markRateLimited(c.env, row, e.resetHint);
      throw new Error('crunchbase_rate_limited');
    }
    if (e instanceof CrunchbaseUnauthorized) {
      await c.env.DB.prepare('UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind('unauthorized', row.id).run();
      throw new Error('crunchbase_unauthorized');
    }
    throw e;
  }
}

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  sync,
  action,
};

registerProvider(impl);

/**
 * Look up the active Crunchbase integration row + decrypted API key for a
 * given user. Returns null when the user has no active connection. Used
 * by the project-level enrichment route + the DD connector.
 */
export async function loadCrunchbaseKeyForUser(env: Env, userId: number): Promise<{ apiKey: string; row: IntegrationRow } | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'crunchbase' AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).bind(userId).first<IntegrationRow>();
  if (!row) return null;
  try {
    const apiKey = await getApiKey(env, row);
    return { apiKey, row };
  } catch { return null; }
}

export { markRateLimited as markCrunchbaseRateLimited, computeResetEpoch as crunchbaseResetEpoch };

/**
 * Map a Crunchbase snapshot onto the denormalized `projects.*` columns
 * the schema reserves for cached enrichment (founded_year, hq,
 * employee_count, last_funding_round, total_funding). Used by the
 * /apply route after a server-side lookup so the project list/grid
 * surfaces don't have to JSON.parse `crunchbase_data_json` per row.
 */
export interface ProjectAutofill {
  founded_year: number | null;
  hq: string | null;
  employee_count: string | null;
  last_funding_round: string | null;
  total_funding: number | null;
}
export function mapToProjectFields(snap: CrunchbaseSnapshot): ProjectAutofill {
  let yr: number | null = null;
  if (snap.founded_on) {
    const m = String(snap.founded_on).match(/^(\d{4})/);
    if (m) yr = Number(m[1]);
  }
  const lastRound = snap.last_funding_type
    ? `${snap.last_funding_type}${snap.last_funding_at ? ` (${snap.last_funding_at})` : ''}`
    : null;
  return {
    founded_year: yr,
    hq: snap.hq_location,
    employee_count: snap.employee_range,
    last_funding_round: lastRound,
    total_funding: snap.funding_total_usd,
  };
}
