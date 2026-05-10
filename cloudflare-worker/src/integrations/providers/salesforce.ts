/**
 * Task #4 — Salesforce provider implementation.
 *
 * One-way push of StudioOS deals/projects/founders → Salesforce
 * Opportunities/Accounts/Contacts, plus inbound polling that mirrors
 * Opportunity StageName changes back into local `deals.status`. Auth is
 * the OAuth 2.0 Web Server flow (Salesforce supports PKCE on Connected
 * Apps; we send the S256 challenge issued by the foundation).
 *
 * Sandbox vs Production picker: the connect modal passes `?sandbox=1` on
 * the OAuth start URL; the route layer carries that through `state.extra`
 * into the callback, where it lands in `connect()` via
 * `input.config.is_sandbox`. We then talk to test.salesforce.com (sandbox)
 * vs login.salesforce.com (prod) and persist the chosen login host plus
 * the org's `instance_url` from the token response. ALL subsequent API
 * calls use the persisted instance_url — never a hardcoded host.
 *
 * CometD/Platform Events are explicitly out of scope; inbound runs every
 * 30 minutes via the existing cron sweep.
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
import {
  loadStageMaps,
  studioStageToSf,
  sfStageToStudio,
  loadFieldMaps,
  applyFieldMap,
  DEFAULT_FIELD_MAPS,
  DEFAULT_STAGE_MAP,
  type StudioStage,
} from '../mappings/salesforce_fields';

const PROVIDER_KEY = 'salesforce';
const SF_API_VERSION = 'v60.0';
const PROD_HOST = 'https://login.salesforce.com';
const SANDBOX_HOST = 'https://test.salesforce.com';

function loginHost(isSandbox: boolean): string {
  return isSandbox ? SANDBOX_HOST : PROD_HOST;
}

function redirectUri(env: Env): string {
  const base = (env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  // Task #7 — env-var FIRST, admin-managed DB row as fallback.
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const cred = await loadOauthCreds(env, 'salesforce');
  if (cred) return { id: cred.id, secret: cred.secret };
  const id = (env as unknown as Record<string, string | undefined>).SF_CLIENT_ID;
  const secret = (env as unknown as Record<string, string | undefined>).SF_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('salesforce_oauth_unconfigured: SF_CLIENT_ID/SF_CLIENT_SECRET secrets must be set on the worker (or configured via Admin → Integration Keys).');
  }
  return { id, secret };
}

interface SfTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id?: string;            // identity URL e.g. https://login.salesforce.com/id/<orgId>/<userId>
  token_type?: string;
  issued_at?: string;     // ms epoch as string
  signature?: string;
}

interface SfIdentity {
  organization_id?: string;
  user_id?: string;
  username?: string;
  display_name?: string;
  email?: string;
  urls?: Record<string, string>;
}

async function exchangeCode(env: Env, code: string, isSandbox: boolean, codeVerifier: string | null): Promise<SfTokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(env),
    code,
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const res = await fetch(`${loginHost(isSandbox)}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`salesforce_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as SfTokenResponse;
}

async function refreshAccessToken(env: Env, refreshToken: string, isSandbox: boolean): Promise<SfTokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${loginHost(isSandbox)}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`salesforce_refresh_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as SfTokenResponse;
}

async function fetchIdentity(idUrl: string, accessToken: string): Promise<SfIdentity> {
  try {
    const res = await fetch(idUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return {};
    return await res.json() as SfIdentity;
  } catch { return {}; }
}

/**
 * Refresh-on-the-fly — Salesforce access tokens have ~2-hour TTL by
 * default. We don't get an `expires_in`, so we treat the access_token as
 * potentially-stale on every call and lazily refresh when an API request
 * returns 401 INVALID_SESSION_ID. Concurrency is gated by a short KV
 * lease (same pattern as HubSpot) so two simultaneous refreshes don't
 * burn the refresh token.
 */
async function getActiveAccessToken(env: Env, row: IntegrationRow): Promise<{ token: string; instanceUrl: string }> {
  const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('salesforce_credentials_missing');
  const at = typeof creds.access_token === 'string' ? creds.access_token : '';
  const instUrl = typeof creds.instance_url === 'string' ? creds.instance_url : '';
  if (!at || !instUrl) throw new Error('salesforce_credentials_incomplete');
  return { token: at, instanceUrl: instUrl };
}

async function refreshAndPersist(env: Env, row: IntegrationRow): Promise<{ token: string; instanceUrl: string }> {
  const lockKey = `salesforce:refresh:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 30 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra failure → continue, single-flight not guaranteed */ }

  const reread = async (): Promise<CredentialBlob | null> => {
    const fresh = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').bind(row.id).first<{ credentials_enc: string }>();
    if (!fresh?.credentials_enc) return null;
    return await decryptCredentials(env, row.uid, fresh.credentials_enc);
  };

  if (!acquired) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const after = await reread();
      const at = typeof after?.access_token === 'string' ? after.access_token : '';
      const inst = typeof after?.instance_url === 'string' ? after.instance_url : '';
      // Detect that someone else updated by checking for a different token
      // string; if still equal we keep waiting.
      if (at && inst && at !== (await decryptCredentials(env, row.uid, row.credentials_enc))?.access_token) {
        return { token: at, instanceUrl: inst };
      }
    }
  }

  try {
    const cfg = (() => { try { return row.config_json ? JSON.parse(row.config_json) as Record<string, unknown> : {}; } catch { return {}; } })();
    const isSandbox = cfg.is_sandbox === true;
    const creds = await reread();
    const refreshToken = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (!refreshToken) throw new Error('salesforce_refresh_token_missing');
    const refreshed = await refreshAccessToken(env, refreshToken, isSandbox);
    const newCreds: CredentialBlob = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      token_type: refreshed.token_type || 'Bearer',
      instance_url: refreshed.instance_url,
      issued_at: refreshed.issued_at ? Number(refreshed.issued_at) : Date.now(),
    };
    const enc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET credentials_enc = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, row.id).run();
    return { token: refreshed.access_token, instanceUrl: refreshed.instance_url };
  } finally {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

async function sfFetch(env: Env, row: IntegrationRow, path: string, init: RequestInit = {}): Promise<Response> {
  let { token, instanceUrl } = await getActiveAccessToken(env, row);
  const url = path.startsWith('http') ? path : `${instanceUrl}/services/data/${SF_API_VERSION}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    // Single retry after a refresh — covers the standard expired-session
    // path (INVALID_SESSION_ID). Any other 401 (e.g. revoked refresh) is
    // surfaced as-is by the second call.
    const refreshed = await refreshAndPersist(env, row);
    token = refreshed.token; instanceUrl = refreshed.instanceUrl;
    const url2 = path.startsWith('http') ? path : `${instanceUrl}/services/data/${SF_API_VERSION}${path}`;
    const headers2 = new Headers(init.headers || {});
    headers2.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers2.has('Content-Type')) headers2.set('Content-Type', 'application/json');
    res = await fetch(url2, { ...init, headers: headers2 });
  }
  return res;
}

// ───────────────────────────────────────────────────────────── connect

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) {
    throw new Error('salesforce_requires_oauth_code: complete the OAuth handshake first.');
  }
  const cfg = (input.config || {}) as Record<string, unknown>;
  const isSandbox = cfg.is_sandbox === true || cfg.is_sandbox === '1' || cfg.is_sandbox === 1;
  const verifier = typeof cfg.pkce_verifier === 'string' ? cfg.pkce_verifier : null;
  const tokens = await exchangeCode(c.env, input.oauth_code, isSandbox, verifier);
  // Hard-fail when the org didn't return a refresh_token: without it we can't
  // sustain a long-lived connection. Common cause is the Connected App's OAuth
  // policy missing "Perform requests on your behalf at any time (refresh_token)"
  // or the user's profile not granting the `refresh_token` scope.
  if (!tokens.refresh_token) {
    throw new Error(
      'salesforce_no_refresh_token: the Connected App did not return a refresh_token. ' +
      'Enable the "refresh_token" / "Perform requests at any time" scope on the Connected App and reconnect.',
    );
  }
  let identity: SfIdentity = {};
  if (tokens.id) identity = await fetchIdentity(tokens.id, tokens.access_token);
  const credentials: CredentialBlob = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    instance_url: tokens.instance_url,
    issued_at: tokens.issued_at ? Number(tokens.issued_at) : Date.now(),
  };
  return {
    credentials,
    scopes: ['api', 'refresh_token', 'id'],
    external_account_id: identity.organization_id || null,
    external_account_name: identity.username || identity.display_name || identity.email || null,
    capabilities: ['Push opportunities', 'Sync accounts', 'Custom objects'],
    config: {
      is_sandbox: isSandbox,
      instance_url: tokens.instance_url,
      identity_url: tokens.id || null,
      organization_id: identity.organization_id || null,
      username: identity.username || null,
      stage_map: DEFAULT_STAGE_MAP,
      field_map: DEFAULT_FIELD_MAPS,
    },
  };
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = await ensureCreds(c.env);
  // Sandbox flag flows from `?sandbox=1` on /oauth/start. The route layer
  // also stashes it in oauth_state_tokens.extra_json so the callback can
  // recover it independently of the query string.
  const isSandbox = c.req.query('sandbox') === '1' || c.req.query('sandbox') === 'true';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(c.env),
    state,
    scope: 'api refresh_token id',
  });
  // PKCE challenge: foundation always issues an S256 pair. We pull it
  // from the consumed state on callback, but the authorize URL needs the
  // challenge here. Stored alongside the verifier in oauth_state_tokens.
  // The `state` param is opaque to us at this point — the foundation has
  // the challenge tucked into extra_json under `challenge`, which the
  // start handler already echoes back in its JSON response. We re-derive
  // it from the request state cookie path is not available; instead we
  // look up the row directly.
  try {
    const row = await c.env.DB.prepare(
      'SELECT extra_json FROM oauth_state_tokens WHERE state = ?',
    ).bind(state).first<{ extra_json: string | null }>();
    if (row?.extra_json) {
      const extra = JSON.parse(row.extra_json) as Record<string, unknown>;
      const challenge = typeof extra.challenge === 'string' ? extra.challenge : '';
      if (challenge) {
        params.set('code_challenge', challenge);
        params.set('code_challenge_method', 'S256');
      }
    }
  } catch { /* PKCE is optional on the SF side; non-fatal */ }
  return `${loginHost(isSandbox)}/services/oauth2/authorize?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── push

interface PushPayload {
  // For deal upsert
  deal_id?: number;
  // For project → account create
  project_id?: number;
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

function escapeSoql(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function pushOne(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, payload: unknown): Promise<PushResult> {
  const p = (payload || {}) as PushPayload;
  if (p.deal_id) return pushDeal(c.env, row, p.deal_id);
  if (p.project_id) return pushProjectAccount(c.env, row, p.project_id);
  throw new Error('salesforce_push_requires_deal_id_or_project_id');
}

async function pushDeal(env: Env, row: IntegrationRow, dealId: number): Promise<PushResult> {
  // Tenant isolation: deal must belong to the integration owner via project→founder.
  // Without this scope, any user with an active SF integration could push another
  // tenant's deal by guessing the ID.
  const deal = await env.DB.prepare(
    'SELECT d.*, p.name as project_name, p.sf_account_id ' +
    'FROM deals d ' +
    'LEFT JOIN projects p ON p.id = d.project_id ' +
    'LEFT JOIN founders f ON f.id = p.founder_id ' +
    'WHERE d.id = ? AND f.user_id = ?',
  ).bind(dealId, row.user_id).first<{
    id: number; status: string; amount: number | null; notes: string | null;
    sf_opportunity_id: string | null; project_name: string | null;
    sf_account_id: string | null; project_id: number;
  }>();
  if (!deal) throw new Error(`deal_not_found_or_forbidden: ${dealId}`);

  const config = row.config_json ? safeParse(row.config_json) : {};
  const stageMaps = loadStageMaps(config);
  const fieldMaps = loadFieldMaps(config);
  const stage = studioStageToSf(stageMaps, deal.status);

  const source: Record<string, unknown> = {
    project_name: deal.project_name || `StudioOS deal ${dealId}`,
    amount: deal.amount,
    status: stage,
    deal_id: String(dealId),
  };
  let body = applyFieldMap(fieldMaps.opportunity, source);
  if (deal.sf_account_id) body.AccountId = deal.sf_account_id;
  // CloseDate is required by SF on Opportunity create; default to +30d
  // when we don't have one. Once present we never overwrite.
  if (!deal.sf_opportunity_id) {
    body.CloseDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  }

  if (deal.sf_opportunity_id) {
    const res = await sfFetch(env, row, `/sobjects/Opportunity/${encodeURIComponent(deal.sf_opportunity_id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const retry = await retryStrippingCustomFields(env, row, 'Opportunity', deal.sf_opportunity_id, body, await res.text());
      if (retry) return retry;
      throw new Error(`salesforce_opp_patch_failed: ${res.status}`);
    }
    return { summary: `Updated SF Opportunity ${deal.sf_opportunity_id} → ${stage}`, external_id: deal.sf_opportunity_id, http_status: res.status };
  }

  const res = await sfFetch(env, row, '/sobjects/Opportunity', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const retry = await retryStrippingCustomFields(env, row, 'Opportunity', null, body, await res.text());
    if (retry) {
      const out = retry as PushResult & { _id?: string };
      if (out._id) await env.DB.prepare('UPDATE deals SET sf_opportunity_id = ? WHERE id = ?').bind(out._id, dealId).run();
      return { summary: out.summary, external_id: out.external_id, http_status: out.http_status };
    }
    throw new Error(`salesforce_opp_create_failed: ${res.status}`);
  }
  const out = await res.json() as { id: string };
  await env.DB.prepare('UPDATE deals SET sf_opportunity_id = ? WHERE id = ?').bind(out.id, dealId).run();
  return { summary: `Created SF Opportunity ${out.id}`, external_id: out.id, http_status: res.status };
}

async function pushProjectAccount(env: Env, row: IntegrationRow, projectId: number): Promise<PushResult> {
  // Tenant isolation: project must belong to the integration owner via founder.user_id.
  const proj = await env.DB.prepare(
    'SELECT p.*, f.id as f_id, f.email as founder_email, f.name as founder_name, f.sf_contact_id as founder_sf_contact_id ' +
    'FROM projects p LEFT JOIN founders f ON f.id = p.founder_id ' +
    'WHERE p.id = ? AND f.user_id = ?',
  ).bind(projectId, row.user_id).first<{
    id: number; name: string; description: string | null; sector: string | null;
    sf_account_id: string | null; sf_primary_contact_id: string | null;
    f_id: number | null; founder_email: string | null; founder_name: string | null;
    founder_sf_contact_id: string | null;
  }>();
  if (!proj) throw new Error(`project_not_found_or_forbidden: ${projectId}`);

  const config = row.config_json ? safeParse(row.config_json) : {};
  const fieldMaps = loadFieldMaps(config);

  const accountSource: Record<string, unknown> = {
    project_name: proj.name,
    description: proj.description,
    sector: proj.sector,
    project_id: String(projectId),
  };
  const accountBody = applyFieldMap(fieldMaps.account, accountSource);

  let accountId = proj.sf_account_id;
  if (accountId) {
    const res = await sfFetch(env, row, `/sobjects/Account/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      body: JSON.stringify(accountBody),
    });
    if (!res.ok) {
      const retry = await retryStrippingCustomFields(env, row, 'Account', accountId, accountBody, await res.text());
      if (!retry) throw new Error(`salesforce_account_patch_failed: ${res.status}`);
    }
  } else {
    const res = await sfFetch(env, row, '/sobjects/Account', { method: 'POST', body: JSON.stringify(accountBody) });
    if (!res.ok) {
      const retry = await retryStrippingCustomFields(env, row, 'Account', null, accountBody, await res.text()) as (PushResult & { _id?: string }) | null;
      if (!retry?._id) throw new Error(`salesforce_account_create_failed: ${res.status}`);
      accountId = retry._id;
    } else {
      const out = await res.json() as { id: string };
      accountId = out.id;
    }
    await env.DB.prepare('UPDATE projects SET sf_account_id = ? WHERE id = ?').bind(accountId, projectId).run();
  }

  // Primary contact: create if we have a founder email and no contact yet
  // for this project. Reuse the founder's existing sf_contact_id when set.
  if (proj.founder_email && !proj.sf_primary_contact_id) {
    let contactId = proj.founder_sf_contact_id;
    if (!contactId) {
      const [first, ...rest] = (proj.founder_name || '').split(' ');
      const contactSource: Record<string, unknown> = {
        email: proj.founder_email,
        first_name: first || '',
        last_name: rest.join(' ') || (first || 'Founder'),
      };
      const contactBody = applyFieldMap(fieldMaps.contact, contactSource);
      contactBody.AccountId = accountId;
      const cres = await sfFetch(env, row, '/sobjects/Contact', { method: 'POST', body: JSON.stringify(contactBody) });
      if (cres.ok) {
        const out = await cres.json() as { id: string };
        contactId = out.id;
        if (proj.f_id) {
          await env.DB.prepare('UPDATE founders SET sf_contact_id = ? WHERE id = ?').bind(contactId, proj.f_id).run();
        }
      }
      // Non-fatal: duplicate-rule rejections leave the contact unset; the
      // user can retry once the SF rule is fixed.
    }
    if (contactId) {
      await env.DB.prepare('UPDATE projects SET sf_primary_contact_id = ? WHERE id = ?').bind(contactId, projectId).run();
    }
  }

  return {
    summary: proj.sf_account_id ? `Updated SF Account ${accountId}` : `Created SF Account ${accountId}`,
    external_id: accountId,
    http_status: 200,
  };
}

/**
 * Salesforce returns 400 INVALID_FIELD when a custom field on the body
 * doesn't exist on the org (typical for `Axal_*__c` fields the customer
 * hasn't created). We strip those keys and retry once. On a still-failing
 * second attempt we return null and let the caller throw.
 */
async function retryStrippingCustomFields(
  env: Env,
  row: IntegrationRow,
  sobject: string,
  externalId: string | null,
  body: Record<string, unknown>,
  errText: string,
): Promise<(PushResult & { _id?: string }) | null> {
  const lower = errText.toLowerCase();
  if (!lower.includes('invalid_field') && !lower.includes('no such column')) return null;
  const stripped = Object.fromEntries(Object.entries(body).filter(([k]) => !k.endsWith('__c')));
  if (Object.keys(stripped).length === Object.keys(body).length) return null;
  const path = externalId
    ? `/sobjects/${sobject}/${encodeURIComponent(externalId)}`
    : `/sobjects/${sobject}`;
  const res = await sfFetch(env, row, path, {
    method: externalId ? 'PATCH' : 'POST',
    body: JSON.stringify(stripped),
  });
  if (!res.ok) return null;
  if (externalId) {
    return { summary: `Updated SF ${sobject} ${externalId} (custom fields skipped)`, external_id: externalId, http_status: res.status, _id: externalId };
  }
  const out = await res.json() as { id: string };
  return { summary: `Created SF ${sobject} ${out.id} (custom fields skipped)`, external_id: out.id, http_status: res.status, _id: out.id };
}

// ───────────────────────────────────────────────────────────── sync

const STUDIO_TO_SF_STATUSES: ReadonlyArray<StudioStage> = ['applied', 'scored', 'active', 'funded', 'rejected'];

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  const counts = { pushed: 0, pulled: 0, errors: 0 };
  const config = row.config_json ? safeParse(row.config_json) : {};
  const stageMaps = loadStageMaps(config);

  // ── outbound: push StudioOS deals modified since last sync that belong to this user.
  const localDeals = await c.env.DB.prepare(
    'SELECT d.id, d.status, d.sf_opportunity_id, d.updated_at ' +
    'FROM deals d ' +
    'LEFT JOIN projects p ON p.id = d.project_id ' +
    'LEFT JOIN founders f ON f.id = p.founder_id ' +
    'WHERE f.user_id = ? AND datetime(d.updated_at) > datetime(?) ' +
    'ORDER BY datetime(d.updated_at) DESC LIMIT 100',
  ).bind(row.user_id, row.last_synced_at || '1970-01-01 00:00:00').all<{
    id: number; status: string; sf_opportunity_id: string | null;
  }>();
  for (const d of (localDeals.results || [])) {
    if (!STUDIO_TO_SF_STATUSES.includes(d.status as StudioStage)) continue;
    try {
      await pushDeal(c.env, row, d.id);
      counts.pushed++;
    } catch {
      counts.errors++;
    }
  }

  // ── inbound: poll SF Opportunities modified since last sync. Use SOQL.
  // We only update local rows we already track via sf_opportunity_id; we
  // never auto-create deals from SF data (that would require synthesizing
  // a project, which is out of scope).
  try {
    const sinceIsoRaw = row.last_synced_at
      ? new Date(Date.parse(row.last_synced_at + 'Z') || (Date.now() - 30 * 60 * 1000)).toISOString()
      : new Date(Date.now() - 30 * 60 * 1000).toISOString();
    // SOQL datetime literals are unquoted but MUST match `YYYY-MM-DDThh:mm:ssZ` —
    // JS toISOString() emits milliseconds (`.123Z`) which SOQL rejects as malformed.
    const sinceIso = sinceIsoRaw.replace(/\.\d{3}Z$/, 'Z');
    const soql = `SELECT Id, StageName, LastModifiedDate FROM Opportunity WHERE LastModifiedDate > ${sinceIso} ORDER BY LastModifiedDate ASC LIMIT 200`;
    // Page through SOQL results via `nextRecordsUrl` so high-volume orgs
    // don't drop updates past the first 200 rows. Cap pages defensively to
    // avoid runaway sync loops on broken cursors.
    let nextPath: string | null = `/query?q=${encodeURIComponent(soql)}`;
    let pages = 0;
    const maxPages = 25; // up to 5,000 opportunities per sync run
    while (nextPath && pages < maxPages) {
      const res: Response = await sfFetch(c.env, row, nextPath);
      if (!res.ok) { counts.errors++; break; }
      const out = await res.json() as {
        records: Array<{ Id: string; StageName: string }>;
        nextRecordsUrl?: string;
        done?: boolean;
      };
      for (const r of (out.records || [])) {
        const next = sfStageToStudio(stageMaps, r.StageName);
        if (!next) continue;
        const local = await c.env.DB.prepare(
          'SELECT d.id, d.status FROM deals d ' +
          'LEFT JOIN projects p ON p.id = d.project_id ' +
          'LEFT JOIN founders f ON f.id = p.founder_id ' +
          'WHERE d.sf_opportunity_id = ? AND f.user_id = ?',
        ).bind(r.Id, row.user_id).first<{ id: number; status: string }>();
        if (local && local.status !== next) {
          await c.env.DB.prepare('UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(next, local.id).run();
          counts.pulled++;
        }
      }
      // `nextRecordsUrl` is an absolute API path like
      // `/services/data/v60.0/query/01g...-2000`; sfFetch prefixes
      // `/services/data/v60.0` so strip it when present.
      if (!out.done && out.nextRecordsUrl) {
        nextPath = out.nextRecordsUrl.replace(/^\/services\/data\/v\d+\.\d+/, '');
      } else {
        nextPath = null;
      }
      pages++;
    }
  } catch {
    counts.errors++;
  }

  void escapeSoql; // reserved for future named-account search
  return {
    summary: `pushed=${counts.pushed} pulled=${counts.pulled} errors=${counts.errors}`,
    counts,
  };
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  // Salesforce revoke: POST <login>/services/oauth2/revoke?token=<token>.
  // Try refresh token first (revokes both); fall back to access token.
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  const cfg = row.config_json ? safeParse(row.config_json) : {};
  const isSandbox = cfg.is_sandbox === true;
  const refresh = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
  const access = typeof creds?.access_token === 'string' ? creds.access_token : '';
  const target = refresh || access;
  if (!target) return;
  try {
    await fetch(`${loginHost(isSandbox)}/services/oauth2/revoke?token=${encodeURIComponent(target)}`, { method: 'POST' });
  } catch (e) {
    console.warn('[salesforce] revoke failed (non-fatal):', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── action

async function action(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, name: string, _body: unknown): Promise<unknown> {
  if (name === 'list_stages') {
    // Return the pick-list values for Opportunity.StageName so the
    // frontend stage-mapping editor can render a dropdown of real org
    // values rather than the user typing freehand.
    const res = await sfFetch(c.env, row, '/sobjects/Opportunity/describe');
    if (!res.ok) throw new Error(`salesforce_describe_failed: ${res.status}`);
    const out = await res.json() as { fields: Array<{ name: string; picklistValues?: Array<{ value: string; active: boolean; label?: string }> }> };
    const f = (out.fields || []).find(x => x.name === 'StageName');
    return {
      stages: (f?.picklistValues || []).filter(p => p.active).map(p => ({ value: p.value, label: p.label || p.value })),
    };
  }
  if (name === 'list_field_map') {
    const config = row.config_json ? safeParse(row.config_json) : {};
    return { field_map: loadFieldMaps(config), defaults: DEFAULT_FIELD_MAPS };
  }
  throw new Error(`unknown_action: ${name}`);
}

// ───────────────────────────────────────────────────────────── validateConfig

function validateConfig(
  patch: Record<string, unknown>,
  _existing: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const ALLOWED = new Set(['stage_map', 'field_map', 'is_sandbox', 'instance_url']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown_config_key: ${k}` };
    if (k === 'is_sandbox') {
      if (typeof v !== 'boolean') return { ok: false, error: 'is_sandbox_must_be_boolean' };
      out[k] = v;
    } else if (k === 'instance_url') {
      if (typeof v !== 'string' || !/^https:\/\/[a-z0-9.-]+\.salesforce\.com$/i.test(v)) {
        return { ok: false, error: 'instance_url_invalid' };
      }
      out[k] = v;
    } else if (k === 'stage_map') {
      if (v === null) { out[k] = null; continue; }
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'stage_map_must_be_object' };
      const ALLOWED_STAGES = new Set(['applied', 'scored', 'active', 'funded', 'rejected']);
      const norm: Record<string, string> = {};
      for (const [stage, sfName] of Object.entries(v as Record<string, unknown>)) {
        if (!ALLOWED_STAGES.has(stage)) return { ok: false, error: `stage_map_unknown_stage: ${stage}` };
        if (typeof sfName !== 'string' || !sfName.length || sfName.length > 80) {
          return { ok: false, error: 'stage_map_value_invalid' };
        }
        norm[stage] = sfName;
      }
      out[k] = norm;
    } else if (k === 'field_map') {
      if (v === null) { out[k] = null; continue; }
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'field_map_must_be_object' };
      const ALLOWED_OBJECTS = new Set(['opportunity', 'account', 'contact']);
      const norm: Record<string, Record<string, string>> = {};
      for (const [obj, mapping] of Object.entries(v as Record<string, unknown>)) {
        if (!ALLOWED_OBJECTS.has(obj)) return { ok: false, error: `field_map_unknown_object: ${obj}` };
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
          return { ok: false, error: `field_map_${obj}_must_be_object` };
        }
        const inner: Record<string, string> = {};
        for (const [studioKey, sfField] of Object.entries(mapping as Record<string, unknown>)) {
          if (typeof studioKey !== 'string' || studioKey.length > 60) return { ok: false, error: 'field_map_bad_key' };
          if (typeof sfField !== 'string' || sfField.length > 80) return { ok: false, error: 'field_map_bad_value' };
          // SF field API names: alphanumeric + underscore, ending optionally __c for custom.
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(sfField)) return { ok: false, error: 'field_map_invalid_sf_field' };
          inner[studioKey] = sfField;
        }
        norm[obj] = inner;
      }
      out[k] = norm;
    }
  }
  return { ok: true, patch: out };
}

// ───────────────────────────────────────────────────────────── side-effects

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  push: pushOne,
  sync,
  disconnect,
  action,
  validateConfig,
};
registerProvider(impl);
void REGISTRY;

/**
 * Cron entry-point. Iterates every active salesforce integration and runs
 * `sync` against it, with per-integration error isolation. Called from
 * index.ts scheduled() on a 30-minute cadence.
 */
export async function syncAllSalesforceIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  let scanned = 0, ok = 0, failed = 0;
  let rows: { results: IntegrationRow[] };
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM integrations WHERE provider_key = 'salesforce' AND status = 'active' LIMIT 200",
    ).all<IntegrationRow>() as unknown as { results: IntegrationRow[] };
  } catch {
    return { scanned: 0, ok: 0, failed: 0 };
  }
  for (const row of (rows.results || [])) {
    scanned++;
    try {
      const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
      const stubUser = { id: row.user_id } as User;
      const out = await sync(stubCtx, stubUser, row);
      await env.DB.prepare(
        'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      ).bind(row.id).run();
      ok++;
      console.info(`[salesforce] cron sync ok integration=${row.id}: ${out.summary}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
      try {
        await env.DB.prepare(
          'UPDATE integrations SET last_error = ?, status = CASE WHEN ? LIKE \'%refresh%\' THEN \'error\' ELSE status END WHERE id = ?',
        ).bind(msg, msg, row.id).run();
      } catch { /* non-fatal */ }
      console.error(`[salesforce] cron sync failed integration=${row.id}: ${msg}`);
    }
  }
  return { scanned, ok, failed };
}
