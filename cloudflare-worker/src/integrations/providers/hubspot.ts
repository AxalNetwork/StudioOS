/**
 * Task #2 — HubSpot provider implementation.
 *
 * Two-way sync between StudioOS deals and HubSpot deals; one-way push of
 * StudioOS projects → HubSpot companies (+ primary contact). Auth is
 * standard OAuth2 authorization-code (HubSpot does not support PKCE on
 * its public app endpoint as of 2026-04 — the foundation's signed state
 * still binds the callback to (user, provider)).
 *
 * Surface plugged into the registry:
 *   - buildAuthorizeUrl  → /oauth/v1/authorize
 *   - connect            → POST /oauth/v1/token (code exchange)
 *   - sync               → reconcile recently-modified deals both ways
 *   - push               → upsert one deal or create one company
 *   - webhook            → handle deal.propertyChange + contact.creation
 *   - disconnect         → DELETE /oauth/v1/refresh-tokens/:token
 *   - action('list_pipelines')      → for the frontend picker
 *   - action('list_dealstages')     → stage IDs for the chosen pipeline
 *
 * IMPORTANT: this module is imported once from index.ts so the
 * registerProvider() call below runs at boot.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import {
  registerProvider,
  REGISTRY,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
  type PushResult,
} from '../registry';
import { decryptCredentials, encryptCredentials, type CredentialBlob } from '../secrets';
import { loadDealstageMap, studioStageToHubspot, hubspotStageToStudio, type StudioStage } from '../mappings/hubspot_stages';

const HS_API = 'https://api.hubapi.com';
const HS_AUTH = 'https://app.hubspot.com';
const PROVIDER_KEY = 'hubspot';

// Minimum scope set we ask the user for. Customers on legacy contact-only
// portals will see a HubSpot-side error if any scope is unavailable; we
// surface that verbatim in the connect response.
const SCOPES = [
  'oauth',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.schemas.deals.read',
];

function redirectUri(env: Env): string {
  const base = (env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  // Task #7 — env-var FIRST, admin-managed DB row as fallback.
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const cred = await loadOauthCreds(env, 'hubspot');
  if (!cred) {
    throw new Error('hubspot_oauth_unconfigured: HUBSPOT_CLIENT_ID/HUBSPOT_CLIENT_SECRET secrets must be set on the worker (or configured via Admin → Integration Keys).');
  }
  return { id: cred.id, secret: cred.secret };
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // seconds
  token_type?: string;
}

interface HubSpotTokenInfo {
  hub_id?: number;
  hub_domain?: string;
  user?: string;             // email of authorising HubSpot user
  user_id?: number;
  app_id?: number;
  expires_in?: number;
  scopes?: string[];
}

async function exchangeCode(env: Env, code: string): Promise<HubSpotTokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(env),
    code,
  });
  const res = await fetch(`${HS_API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`hubspot_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as HubSpotTokenResponse;
}

async function refreshAccessToken(env: Env, refreshToken: string): Promise<HubSpotTokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${HS_API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`hubspot_refresh_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as HubSpotTokenResponse;
}

async function fetchTokenInfo(accessToken: string): Promise<HubSpotTokenInfo> {
  const res = await fetch(`${HS_API}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
  if (!res.ok) {
    return {};
  }
  return await res.json() as HubSpotTokenInfo;
}

/**
 * Load the row's credentials, refresh if expiring within 60 s, and
 * persist the refreshed blob back into D1. Returns the live access token.
 *
 * Concurrency: HubSpot's refresh tokens are single-use. If two requests on
 * the same isolate (or two isolates) both detect expiry simultaneously and
 * race, one of them will burn the refresh token before the other completes
 * — bricking the integration. We serialize via a short KV lease keyed off
 * the integration row UID; losers spin briefly and re-read the freshly
 * persisted blob from D1.
 */
async function getActiveAccessToken(env: Env, row: IntegrationRow): Promise<string> {
  const skewMs = 60 * 1000;
  const readCreds = async () => {
    const fresh = await env.DB.prepare(
      'SELECT credentials_enc FROM integrations WHERE id = ?',
    ).bind(row.id).first<{ credentials_enc: string }>();
    if (!fresh?.credentials_enc) throw new Error('hubspot_credentials_missing');
    return await decryptCredentials(env, row.uid, fresh.credentials_enc);
  };
  const isLive = (creds: CredentialBlob | null) => {
    const at = typeof creds?.access_token === 'string' ? creds!.access_token as string : '';
    const exp = typeof creds?.expires_at === 'number'
      ? creds!.expires_at as number
      : (typeof creds?.expires_at === 'string' ? Date.parse(creds!.expires_at as string) : 0);
    return at && exp && exp - Date.now() > skewMs ? at : '';
  };

  let creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('hubspot_credentials_missing');
  const live = isLive(creds);
  if (live) return live;

  // Acquire short KV lease so concurrent refreshes serialize. KV has eventual
  // consistency, so the lease is best-effort; we additionally re-check the
  // DB after acquiring and after the wait loop.
  const lockKey = `hubspot:refresh:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 30 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra failure → fall through, single-flight not guaranteed */ }

  if (!acquired) {
    // Loser: poll DB up to ~3 s for the winner's refreshed blob.
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const after = await readCreds();
      const liveAfter = isLive(after);
      if (liveAfter) return liveAfter;
    }
    // Still nothing — fall through and do our own refresh as a last resort.
  } else {
    // Winner: re-read inside the lock to make sure no other isolate
    // already refreshed between our first read and the lock acquire.
    const fresh = await readCreds();
    const liveFresh = isLive(fresh);
    if (liveFresh) {
      try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
      return liveFresh;
    }
    creds = fresh;
  }

  const refreshToken = typeof creds?.refresh_token === 'string' ? creds!.refresh_token as string : '';
  if (!refreshToken) {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
    throw new Error('hubspot_refresh_token_missing');
  }
  try {
    const refreshed = await refreshAccessToken(env, refreshToken);
    const newCreds: CredentialBlob = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      token_type: refreshed.token_type || 'bearer',
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    const enc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET credentials_enc = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, row.id).run();
    return refreshed.access_token;
  } finally {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

async function hsFetch(env: Env, row: IntegrationRow, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getActiveAccessToken(env, row);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${HS_API}${path}`, { ...init, headers });
}

// ───────────────────────────────────────────────────────────── connect

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) {
    throw new Error('hubspot_requires_oauth_code: complete the OAuth handshake first.');
  }
  const tokens = await exchangeCode(c.env, input.oauth_code);
  const info = await fetchTokenInfo(tokens.access_token);
  const credentials: CredentialBlob = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'bearer',
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  return {
    credentials,
    scopes: info.scopes || SCOPES,
    external_account_id: info.hub_id ? String(info.hub_id) : null,
    external_account_name: info.hub_domain || info.user || null,
    capabilities: ['Push deals', 'Pull contacts', 'Two-way sync'],
    config: {
      portal_id: info.hub_id || null,
      hub_domain: info.hub_domain || null,
      authorising_user: info.user || null,
      pipeline_id: 'default',
    },
  };
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = await ensureCreds(c.env);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(c.env),
    scope: SCOPES.join(' '),
    state,
  });
  return `${HS_AUTH}/oauth/authorize?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── push

interface PushPayload {
  // For deal upsert
  deal_id?: number;
  // For project → company create
  project_id?: number;
}

async function pushOne(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, payload: unknown): Promise<PushResult> {
  const p = (payload || {}) as PushPayload;
  if (p.deal_id) return pushDeal(c.env, row, p.deal_id);
  if (p.project_id) return pushProjectCompany(c.env, row, p.project_id);
  throw new Error('hubspot_push_requires_deal_id_or_project_id');
}

async function pushDeal(env: Env, row: IntegrationRow, dealId: number): Promise<PushResult> {
  const deal = await env.DB.prepare(
    'SELECT d.*, p.name as project_name, p.hubspot_company_id ' +
    'FROM deals d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?',
  ).bind(dealId).first<{
    id: number; status: string; amount: number | null; notes: string | null;
    hubspot_deal_id: string | null; project_name: string | null;
    hubspot_company_id: string | null; project_id: number;
  }>();
  if (!deal) throw new Error(`deal_not_found: ${dealId}`);
  const config = row.config_json ? safeParse(row.config_json) : {};
  const map = loadDealstageMap(config);
  const dealstage = studioStageToHubspot(map, deal.status);
  const properties: Record<string, string | number | null> = {
    dealname: deal.project_name || `StudioOS deal ${dealId}`,
    pipeline: map.pipeline_id,
    dealstage,
    amount: deal.amount ?? null,
    axal_deal_id: String(dealId),
  };

  // Upsert: if we already have a hubspot_deal_id, PATCH; else POST.
  if (deal.hubspot_deal_id) {
    const res = await hsFetch(env, row, `/crm/v3/objects/deals/${encodeURIComponent(deal.hubspot_deal_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`hubspot_deal_patch_failed: ${res.status} ${txt.slice(0, 200)}`);
    }
    return { summary: `Updated HubSpot deal ${deal.hubspot_deal_id} → ${dealstage}`, external_id: deal.hubspot_deal_id, http_status: res.status };
  }

  const associations = deal.hubspot_company_id
    ? [{ to: { id: deal.hubspot_company_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] }]
    : undefined;
  const res = await hsFetch(env, row, '/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties, ...(associations ? { associations } : {}) }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`hubspot_deal_create_failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const out = await res.json() as { id: string };
  await env.DB.prepare('UPDATE deals SET hubspot_deal_id = ? WHERE id = ?').bind(out.id, dealId).run();
  return { summary: `Created HubSpot deal ${out.id}`, external_id: out.id, http_status: res.status };
}

async function pushProjectCompany(env: Env, row: IntegrationRow, projectId: number): Promise<PushResult> {
  const proj = await env.DB.prepare(
    'SELECT p.*, f.email as founder_email, f.name as founder_name ' +
    'FROM projects p LEFT JOIN founders f ON f.id = p.founder_id WHERE p.id = ?',
  ).bind(projectId).first<{
    id: number; name: string; description: string | null; sector: string | null;
    hubspot_company_id: string | null; hubspot_primary_contact_id: string | null;
    founder_email: string | null; founder_name: string | null;
  }>();
  if (!proj) throw new Error(`project_not_found: ${projectId}`);

  const companyProps: Record<string, string | null> = {
    name: proj.name,
    description: proj.description,
    industry: proj.sector,
    axal_project_id: String(projectId),
  };
  let companyId = proj.hubspot_company_id;
  if (companyId) {
    const res = await hsFetch(env, row, `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: companyProps }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`hubspot_company_patch_failed: ${res.status} ${txt.slice(0, 200)}`);
    }
  } else {
    const res = await hsFetch(env, row, '/crm/v3/objects/companies', {
      method: 'POST',
      body: JSON.stringify({ properties: companyProps }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`hubspot_company_create_failed: ${res.status} ${txt.slice(0, 200)}`);
    }
    const out = await res.json() as { id: string };
    companyId = out.id;
    await env.DB.prepare('UPDATE projects SET hubspot_company_id = ? WHERE id = ?').bind(companyId, projectId).run();
  }

  // Create primary contact if we have a founder email and none yet.
  if (proj.founder_email && !proj.hubspot_primary_contact_id) {
    const [first, ...rest] = (proj.founder_name || '').split(' ');
    const contactRes = await hsFetch(env, row, '/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          email: proj.founder_email,
          firstname: first || '',
          lastname: rest.join(' ') || '',
        },
        associations: [{
          to: { id: companyId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
        }],
      }),
    });
    if (contactRes.ok) {
      const contact = await contactRes.json() as { id: string };
      await env.DB.prepare('UPDATE projects SET hubspot_primary_contact_id = ? WHERE id = ?').bind(contact.id, projectId).run();
    }
    // Non-fatal — keep going if HubSpot rejected the contact (e.g. duplicate).
  }

  return {
    summary: proj.hubspot_company_id ? `Updated HubSpot company ${companyId}` : `Created HubSpot company ${companyId}`,
    external_id: companyId,
    http_status: 200,
  };
}

// ───────────────────────────────────────────────────────────── sync

const STUDIO_TO_HS_STATUSES: ReadonlyArray<StudioStage> = ['applied', 'scored', 'active', 'funded', 'rejected'];

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  const counts = { pushed: 0, pulled: 0, errors: 0 };
  const config = row.config_json ? safeParse(row.config_json) : {};
  const map = loadDealstageMap(config);
  const since = row.last_synced_at ? Date.parse(row.last_synced_at + 'Z') || 0 : 0;

  // ── outbound: push StudioOS deals modified since last sync that belong to this user.
  const localDeals = await c.env.DB.prepare(
    'SELECT d.id, d.status, d.hubspot_deal_id, d.updated_at ' +
    'FROM deals d ' +
    'LEFT JOIN projects p ON p.id = d.project_id ' +
    'LEFT JOIN founders f ON f.id = p.founder_id ' +
    'WHERE f.user_id = ? AND datetime(d.updated_at) > datetime(?) ' +
    'ORDER BY datetime(d.updated_at) DESC LIMIT 100',
  ).bind(row.user_id, row.last_synced_at || '1970-01-01 00:00:00').all<{
    id: number; status: string; hubspot_deal_id: string | null;
  }>();
  for (const d of (localDeals.results || [])) {
    if (!STUDIO_TO_HS_STATUSES.includes(d.status as StudioStage)) continue;
    try {
      await pushDeal(c.env, row, d.id);
      counts.pushed++;
    } catch {
      counts.errors++;
    }
  }

  // ── inbound: pull HubSpot deals modified since `since`. Use the search API
  // to filter by hs_lastmodifieddate; only update locally when we already
  // have a row keyed by hubspot_deal_id (we do not auto-create deals from
  // HubSpot — that would require a project, out of scope for this slice).
  try {
    const sinceMs = since || (Date.now() - 30 * 60 * 1000);
    const searchRes = await hsFetch(c.env, row, '/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) }],
        }],
        properties: ['dealstage', 'pipeline', 'amount', 'axal_deal_id'],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        limit: 100,
      }),
    });
    if (searchRes.ok) {
      const out = await searchRes.json() as { results: Array<{ id: string; properties: Record<string, string> }> };
      for (const hd of out.results) {
        const localStage = hubspotStageToStudio(map, hd.properties.dealstage || '');
        if (!localStage) continue;
        const local = await c.env.DB.prepare(
          'SELECT d.id, d.status FROM deals d ' +
          'LEFT JOIN projects p ON p.id = d.project_id ' +
          'LEFT JOIN founders f ON f.id = p.founder_id ' +
          'WHERE d.hubspot_deal_id = ? AND f.user_id = ?',
        ).bind(hd.id, row.user_id).first<{ id: number; status: string }>();
        if (local && local.status !== localStage) {
          await c.env.DB.prepare('UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(localStage, local.id).run();
          counts.pulled++;
        }
      }
    } else {
      counts.errors++;
    }
  } catch {
    counts.errors++;
  }

  return {
    summary: `pushed=${counts.pushed} pulled=${counts.pulled} errors=${counts.errors}`,
    counts,
  };
}

// ───────────────────────────────────────────────────────────── webhook

interface HubSpotWebhookEvent {
  eventId?: number;
  subscriptionType?: string;
  objectId?: number;
  propertyName?: string;
  propertyValue?: string;
  occurredAt?: number;
  portalId?: number;
}

async function webhook(c: Context<{ Bindings: Env }>, row: IntegrationRow, body: string, signature: string | null): Promise<{ summary: string }> {
  // HubSpot signature v3: base64(HMAC-SHA256(client_secret, METHOD + URI + body + timestamp))
  // Fail closed: every required input must be present. The legacy `signature`
  // arg from the integrations route is intentionally NOT consulted here —
  // HubSpot only signs via the v3 header, and accepting a route-supplied
  // value would let a caller spoof verification by passing in their own.
  const ts = c.req.header('x-hubspot-request-timestamp');
  const sigHeader = c.req.header('x-hubspot-signature-v3');
  void signature; // intentionally unused; see comment above
  let secret = '';
  try { secret = (await ensureCreds(c.env)).secret; } catch { /* leave empty → throws below */ }
  if (!secret) throw new Error('webhook_unverified_no_client_secret');
  if (!ts || !sigHeader) throw new Error('webhook_signature_missing');
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) throw new Error('webhook_timestamp_too_old');
  // HubSpot v3 spec: HMAC-SHA256(client_secret, METHOD + REQUESTED_URI + body + timestamp).
  // The "requested URI" is the exact URL as the HubSpot edge sent it,
  // including scheme/host/path/query — i.e. the raw request URL string,
  // NOT a re-parsed `new URL(...).toString()` (which can drop a trailing
  // slash, re-encode unicode, or normalize default ports). Use `c.req.url`
  // verbatim. We additionally try a second candidate with any stray
  // fragment stripped, since some Cloudflare edges have been observed to
  // forward `#…` in `req.url`; the spec excludes fragments.
  const method = c.req.method;
  const rawUrl = c.req.url;
  const stripped = rawUrl.includes('#') ? rawUrl.slice(0, rawUrl.indexOf('#')) : rawUrl;
  const candidates = stripped === rawUrl ? [rawUrl] : [rawUrl, stripped];
  let matched = false;
  for (const u of candidates) {
    const expected = await hmacBase64(secret, `${method}${u}${body}${ts}`);
    if (constantTimeEqual(expected, sigHeader)) { matched = true; break; }
  }
  if (!matched) throw new Error('webhook_signature_invalid');

  let events: HubSpotWebhookEvent[] = [];
  try {
    const parsed = JSON.parse(body);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error('webhook_payload_invalid_json');
  }

  let handled = 0;
  for (const ev of events) {
    if (ev.subscriptionType === 'deal.propertyChange' && ev.objectId) {
      const config = row.config_json ? safeParse(row.config_json) : {};
      const map = loadDealstageMap(config);
      if (ev.propertyName === 'dealstage' && ev.propertyValue) {
        // Tenant scoping: HubSpot object IDs are NOT globally unique across
        // portals, so a webhook event must only ever mutate the deal owned
        // by the same user as the integration row that received it. Mirror
        // the inbound-sync join (deals→projects→founders) and require
        // `founders.user_id = row.user_id`.
        const local = await c.env.DB.prepare(
          'SELECT d.id, d.status FROM deals d ' +
          'LEFT JOIN projects p ON p.id = d.project_id ' +
          'LEFT JOIN founders f ON f.id = p.founder_id ' +
          'WHERE d.hubspot_deal_id = ? AND f.user_id = ?',
        ).bind(String(ev.objectId), row.user_id).first<{ id: number; status: string }>();
        if (local) {
          const next = hubspotStageToStudio(map, ev.propertyValue);
          if (next && next !== local.status) {
            await c.env.DB.prepare('UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, local.id).run();
            handled++;
          }
        }
      }
    }
    // contact.creation: we just ack — auto-creating local founders from
    // HubSpot contacts is intentionally out of scope for Task #2.
    if (ev.subscriptionType === 'contact.creation') {
      handled++;
    }
  }
  return { summary: `events=${events.length} handled=${handled}` };
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  const refresh = typeof creds?.refresh_token === 'string' ? creds!.refresh_token as string : '';
  if (!refresh) return;
  // HubSpot's refresh-token revoke endpoint returns 204 on success and 404
  // if the token is already gone — both are fine to swallow.
  try {
    await fetch(`${HS_API}/oauth/v1/refresh-tokens/${encodeURIComponent(refresh)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('[hubspot] revoke failed (non-fatal):', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── action (pipeline picker)

async function action(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, name: string, _body: unknown): Promise<unknown> {
  if (name === 'list_pipelines') {
    const res = await hsFetch(c.env, row, '/crm/v3/pipelines/deals');
    if (!res.ok) throw new Error(`hubspot_pipelines_failed: ${res.status}`);
    const out = await res.json() as { results: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string; displayOrder?: number }> }> };
    return {
      pipelines: out.results.map(p => ({
        id: p.id,
        label: p.label,
        stages: (p.stages || []).map(s => ({ id: s.id, label: s.label, order: s.displayOrder ?? 0 })),
      })),
    };
  }
  throw new Error(`unknown_action: ${name}`);
}

// ───────────────────────────────────────────────────────────── helpers

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

async function hmacBase64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  let s = '';
  const u8 = new Uint8Array(sig);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ───────────────────────────────────────────────────────────── side-effects

/**
 * Strict allowlist for `PATCH /api/integrations/:uid/config`. The pipeline
 * picker only ever needs to write three keys; reject everything else so
 * config_json doesn't drift into an arbitrary key/value bag over time.
 */
function validateConfig(
  patch: Record<string, unknown>,
  _existing: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const ALLOWED = new Set(['pipeline_id', 'pipeline_label', 'dealstage_map']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown_config_key: ${k}` };
    if (k === 'pipeline_id' || k === 'pipeline_label') {
      if (v !== null && typeof v !== 'string') return { ok: false, error: `${k}_must_be_string` };
      if (typeof v === 'string' && v.length > 200) return { ok: false, error: `${k}_too_long` };
      out[k] = v;
    } else if (k === 'dealstage_map') {
      if (v === null) { out[k] = null; continue; }
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'dealstage_map_must_be_object' };
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > 50) return { ok: false, error: 'dealstage_map_too_large' };
      const norm: Record<string, string> = {};
      for (const [stage, hsId] of entries) {
        if (typeof stage !== 'string' || stage.length > 60) return { ok: false, error: 'dealstage_map_bad_key' };
        if (typeof hsId !== 'string' || hsId.length > 200) return { ok: false, error: 'dealstage_map_bad_value' };
        norm[stage] = hsId;
      }
      out[k] = norm;
    }
  }
  return { ok: true, patch: out };
}

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  push: pushOne,
  sync,
  webhook,
  disconnect,
  action,
  validateConfig,
};
registerProvider(impl);
void REGISTRY; // Static descriptor in registry.ts is the source of truth (status='live').

/**
 * Cron entry-point. Iterates every active hubspot integration and runs
 * `sync` against it, with per-integration error isolation. Called from
 * index.ts scheduled() on a 30-minute cadence.
 */
export async function syncAllHubspotIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  let scanned = 0, ok = 0, failed = 0;
  let rows: { results: IntegrationRow[] };
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM integrations WHERE provider_key = 'hubspot' AND status = 'active' LIMIT 200",
    ).all<IntegrationRow>() as unknown as { results: IntegrationRow[] };
  } catch {
    // Schema not yet created on this isolate.
    return { scanned: 0, ok: 0, failed: 0 };
  }
  for (const row of (rows.results || [])) {
    scanned++;
    try {
      // We don't have a Hono Context in cron — synth a minimal stub that
      // sync() / pushDeal() use only for `c.env`. This is the same trick
      // calendar.ts uses for its hourly reconcile.
      const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
      const stubUser = { id: row.user_id } as User;
      const out = await sync(stubCtx, stubUser, row);
      await env.DB.prepare(
        'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      ).bind(row.id).run();
      ok++;
      console.info(`[hubspot] cron sync ok integration=${row.id}: ${out.summary}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
      try {
        await env.DB.prepare(
          'UPDATE integrations SET last_error = ?, status = CASE WHEN ? LIKE \'%refresh%\' THEN \'error\' ELSE status END WHERE id = ?',
        ).bind(msg, msg, row.id).run();
      } catch { /* non-fatal */ }
      console.error(`[hubspot] cron sync failed integration=${row.id}: ${msg}`);
    }
  }
  return { scanned, ok, failed };
}
