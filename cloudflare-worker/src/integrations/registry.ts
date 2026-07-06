/**
 * Task #1 — Integrations registry (single source of truth).
 *
 * Each entry describes one provider the Integrations page can render. Eight
 * downstream tasks (#2 HubSpot, #3 Calendly, #4 Salesforce, #5 Carta,
 * #6 Slack, #7 DocuSign, #8 Crunchbase, #9 Affinity) each plug an
 * implementation into the PROVIDERS map below and flip their entry's
 * `status` from 'coming_soon' to 'live' (or 'beta').
 *
 * The registry is the authority for:
 *   - which providers appear on /integrations and in which section,
 *   - the tier gate enforced by routes/integrations.ts,
 *   - the capability list shown as chips on each card,
 *   - the auth flow (api_key | oauth2 | webhook) the connect modal renders.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { Tier } from '../middleware/requireTier';

export type ProviderStatus = 'live' | 'beta' | 'coming_soon';
export type AuthType = 'api_key' | 'oauth2' | 'webhook';
export type IntegrationType = 'crm' | 'scheduling' | 'cap_table' | 'messaging' | 'e_sign' | 'data_feed' | 'custom';

export interface ProviderDescriptor {
  key: string;                           // url-safe; primary key
  display_name: string;
  integration_type: IntegrationType;
  description: string;
  status: ProviderStatus;
  tier: Tier;                            // minimum tier to connect
  auth_type: AuthType;
  capabilities: string[];                // human-readable chips
  docs_url: string | null;
  /** Lucide-react icon name string the frontend looks up. Optional. */
  icon?: string;
  /** OAuth scopes requested when auth_type='oauth2'. */
  oauth_scopes?: string[];
  /**
   * When true, the connect modal renders BOTH the OAuth button AND the
   * api_key input — the provider's `connect()` accepts whichever the
   * caller supplies. Used by Calendly (PAT or OAuth).
   */
  supports_pat?: boolean;
}

/**
 * Registered provider implementations live here. Downstream tasks call
 * `registerProvider(key, impl)` from their own module to attach behaviour;
 * the foundation ships an empty map. Calls against an unregistered provider
 * return 501 `provider_not_implemented` from the route layer.
 */
export interface IntegrationRow {
  id: number;
  uid: string;
  user_id: number;
  provider_key: string;
  display_name: string | null;
  status: string;
  auth_type: string;
  credentials_enc: string | null;
  webhook_secret_enc: string | null;
  config_json: string | null;
  capabilities_json: string | null;
  scopes_json: string | null;
  external_account_id: string | null;
  external_account_name: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectInput {
  // For api_key flows
  api_key?: string;
  // For oauth2 callback flows
  oauth_code?: string;
  oauth_state?: string;
  // Either flow
  display_name?: string;
  config?: Record<string, unknown>;
  webhook_secret?: string;
}

export interface ConnectResult {
  /** Encrypted JSON credentials (api_key, refresh_token, access_token, expires_at). */
  credentials: Record<string, unknown>;
  scopes?: string[];
  external_account_id?: string | null;
  external_account_name?: string | null;
  capabilities?: string[];
  config?: Record<string, unknown>;
}

export interface SyncResult {
  summary: string;
  counts?: Record<string, number>;
  external_id?: string | null;
}

export interface PushResult {
  summary: string;
  external_id?: string | null;
  http_status?: number;
}

export interface ProviderImpl {
  key: string;
  connect(c: Context<{ Bindings: Env }>, user: User, input: ConnectInput): Promise<ConnectResult>;
  sync?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<SyncResult>;
  push?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow, payload: unknown): Promise<PushResult>;
  webhook?(c: Context<{ Bindings: Env }>, row: IntegrationRow, body: string, signature: string | null): Promise<{ summary: string }>;
  disconnect?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void>;
  /** OAuth flows: build the authorize URL the browser is redirected to. */
  buildAuthorizeUrl?(c: Context<{ Bindings: Env }>, user: User, state: string): Promise<string>;
  /**
   * Provider-specific named actions exposed to the UI via
   * `GET|POST /api/integrations/:uid/action/:name`. Used for things like
   * `list_pipelines` (HubSpot pipeline picker) or `list_workspaces` (Slack)
   * that don't fit the generic sync/push surface. Returns an arbitrary JSON
   * body that the route forwards verbatim.
   */
  action?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow, name: string, body: unknown): Promise<unknown>;
  /**
   * Provider-specific validation for `PATCH /api/integrations/:uid/config`.
   * Throw a `Response` (4xx) or return `{ ok: false, error }` to reject the
   * patch. Return `{ ok: true, patch }` to allow the (potentially
   * normalised) patch through. Providers that don't implement this fall
   * back to a plain shallow-merge.
   */
  validateConfig?(patch: Record<string, unknown>, existing: Record<string, unknown>):
    | { ok: true; patch: Record<string, unknown> }
    | { ok: false; error: string };
  /**
   * Optional provider-specific webhook signature verifier. Returns true on
   * a valid signature. When omitted, the route layer falls back to its
   * default `sha256=hex` HMAC over the raw body. Implement this for
   * providers that use a non-standard signature format (Calendly's
   * `t=...,v1=...` Stripe-style, etc.). The `headers` argument is the raw
   * inbound Headers — providers that need a header other than
   * `X-Axal-Signature` (e.g. `Calendly-Webhook-Signature`) read it here.
   */
  verifyWebhook?(secret: string, body: string, headers: Headers):
    Promise<boolean> | boolean;
  /**
   * Optional fire-and-forget hook called by the route layer **after** a
   * fresh connect (or reconnect) has been persisted. The route invokes
   * this through `executionCtx.waitUntil`, so failures are non-fatal and
   * never block the HTTP response. Used by Calendly to immediately
   * provision its webhook subscription + run a first sync — without it,
   * the user faces a 15-minute "dead period" before bookings show up.
   */
  postConnect?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void>;
}

const PROVIDER_IMPLS: Map<string, ProviderImpl> = new Map();

export function registerProvider(impl: ProviderImpl): void {
  PROVIDER_IMPLS.set(impl.key, impl);
}

export function getProviderImpl(key: string): ProviderImpl | null {
  return PROVIDER_IMPLS.get(key) ?? null;
}

/**
 * Registry — every provider the page knows about. Downstream tasks update
 * their entry's `status` from 'coming_soon' to 'live'/'beta' when shipping.
 */
export const REGISTRY: ProviderDescriptor[] = [
  {
    key: 'hubspot',
    display_name: 'HubSpot',
    integration_type: 'crm',
    description: 'Sync deals, contacts, and notes between StudioOS and your HubSpot CRM.',
    // Task #2 — flipped to 'live' on 2026-05-10. The provider module's
    // top-level `registerProvider` runs at boot via the side-effect import
    // in index.ts, but we keep the static status authoritative so order of
    // imports doesn't change marketplace visibility.
    status: 'live',
    tier: 'growth',
    auth_type: 'oauth2',
    capabilities: ['Push deals', 'Pull contacts', 'Two-way sync'],
    docs_url: 'https://developers.hubspot.com/docs/api/overview',
    icon: 'Building2',
    oauth_scopes: ['crm.objects.deals.read', 'crm.objects.deals.write', 'crm.objects.contacts.read'],
    // Task #17 — HubSpot Public-App OAuth requires app marketplace
    // publication on non-test portals; until that lands, customers can
    // connect via a HubSpot Private App access token (long-lived bearer,
    // no refresh). Provider `connect()` branches on `input.api_key` first.
    supports_pat: true,
  },
  {
    key: 'calendly',
    display_name: 'Calendly',
    integration_type: 'scheduling',
    description: 'Embed your Calendly availability across advisor matching and partner office hours; bookings flow into your StudioOS calendar.',
    // Task #3 — flipped to 'live' on 2026-05-10. Provider module is
    // side-effect imported from index.ts so the registerProvider() call
    // runs at boot.
    status: 'live',
    tier: 'free',
    auth_type: 'oauth2',
    capabilities: ['Embed scheduling', 'Pull bookings', 'Cancellation sync', 'Personal Access Token'],
    docs_url: 'https://developer.calendly.com/api-docs',
    icon: 'Calendar',
    oauth_scopes: ['default'],
    supports_pat: true,
  },
  {
    key: 'salesforce',
    display_name: 'Salesforce',
    integration_type: 'crm',
    description: 'Push opportunities and accounts to your Salesforce org.',
    // 2026-05-14 — parked as coming_soon by product. Provider impl
    // remains registered (side-effect import) so existing connections
    // keep working, but new connect attempts get the standard 503 +
    // "join the waitlist" path from /api/integrations/connect.
    status: 'coming_soon',
    tier: 'studio',
    auth_type: 'oauth2',
    capabilities: ['Push opportunities', 'Sync accounts', 'Custom objects'],
    docs_url: 'https://developer.salesforce.com/docs',
    icon: 'Cloud',
    oauth_scopes: ['api', 'refresh_token', 'id'],
  },
  {
    key: 'carta',
    display_name: 'Carta',
    integration_type: 'cap_table',
    description: 'Mirror your Carta cap table (issuer, stakeholders, securities) into the Capital module on a 6-hour sync.',
    // 2026-05-14 — parked as coming_soon by product (see Salesforce).
    status: 'coming_soon',
    tier: 'studio',
    auth_type: 'oauth2',
    capabilities: ['Cap-table sync', 'Stakeholder import', 'Securities import'],
    docs_url: 'https://carta.com/api/',
    icon: 'PieChart',
    oauth_scopes: ['read:cap_table', 'read:stakeholders', 'read:securities'],
  },
  {
    key: 'slack',
    display_name: 'Slack',
    integration_type: 'messaging',
    description: 'Receive deal-flow alerts and assistant prompts in your chosen Slack channel. v1 sends one-way notifications. Two-way commands and DM digests are coming soon.',
    // Task #1 (2026-05-10) — flipped to 'beta' (free tier). One-way
    // Worker→Slack via incoming-webhook OAuth. Provider module is
    // side-effect imported from index.ts so registerProvider() runs at boot.
    status: 'beta',
    tier: 'free',
    auth_type: 'oauth2',
    capabilities: ['Channel notifications', 'Block Kit messages', 'Quiet-hours aware'],
    docs_url: 'https://api.slack.com/messaging/webhooks',
    icon: 'MessageSquare',
    oauth_scopes: ['incoming-webhook'],
  },
  {
    key: 'docusign',
    display_name: 'DocuSign',
    integration_type: 'e_sign',
    description: 'Send incorporation, NDA, and co-founder agreements through DocuSign with audit trail.',
    // 2026-05-14 — parked as coming_soon by product (see Salesforce).
    status: 'coming_soon',
    tier: 'studio',
    auth_type: 'oauth2',
    capabilities: ['Send envelopes', 'Webhook on signed', 'Template library'],
    docs_url: 'https://developers.docusign.com/',
    icon: 'PenTool',
    oauth_scopes: ['signature', 'extended'],
  },
  {
    key: 'crunchbase',
    display_name: 'Crunchbase',
    integration_type: 'data_feed',
    description: 'Auto-enrich projects with Crunchbase company data — funding, headcount, sector tags. BETA: Crunchbase Basic API only (read-only org search + lookup); deeper investor / round / people endpoints require Crunchbase Enterprise and ship later.',
    // 2026-05-14 — parked as coming_soon by product (see Salesforce).
    status: 'coming_soon',
    tier: 'growth',
    auth_type: 'api_key',
    capabilities: ['Company enrichment', 'Funding history', 'Competitor lookup'],
    docs_url: 'https://data.crunchbase.com/docs',
    icon: 'Database',
  },
  {
    key: 'stripe',
    display_name: 'Stripe',
    integration_type: 'data_feed',
    description: 'Pull live MRR, ARR, paying customers and churn from your Stripe account into the Metrics + scoring engine. Read-only.',
    // Task #6 (DG) — flipped to 'live' on 2026-05-13. Provider module is
    // side-effect imported from index.ts so registerProvider() runs at boot.
    status: 'live',
    tier: 'growth',
    auth_type: 'oauth2',
    capabilities: ['Pull MRR/ARR', 'Customer count', 'Churn analytics', 'Webhook deltas'],
    docs_url: 'https://stripe.com/docs/connect/standard-accounts',
    icon: 'CreditCard',
    oauth_scopes: ['read_only'],
  },
  {
    key: 'affinity',
    display_name: 'Affinity',
    integration_type: 'crm',
    description: 'Sync deal flow with Affinity\'s relationship intelligence CRM.',
    status: 'coming_soon',
    tier: 'studio',
    auth_type: 'api_key',
    capabilities: ['Push deals', 'Sync lists', 'Notes export'],
    docs_url: 'https://api-docs.affinity.co/',
    icon: 'Network',
  },
];

const REGISTRY_BY_KEY: Map<string, ProviderDescriptor> = new Map(
  REGISTRY.map(p => [p.key, p]),
);

export function getDescriptor(key: string): ProviderDescriptor | null {
  return REGISTRY_BY_KEY.get(key) ?? null;
}

/**
 * Schema bootstrap mirroring the pattern in services/subscriptionPlans.ts —
 * idempotent, called per-request. Lets fresh deploys serve before the
 * wrangler migration is applied.
 */
let _schemaReady = false;
export async function ensureIntegrationsSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS integrations (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'uid TEXT NOT NULL UNIQUE, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider_key TEXT NOT NULL, ' +
      'display_name TEXT, ' +
      "status TEXT NOT NULL DEFAULT 'active', " +
      'auth_type TEXT NOT NULL, ' +
      'credentials_enc TEXT, ' +
      'webhook_secret_enc TEXT, ' +
      'config_json TEXT, ' +
      'capabilities_json TEXT, ' +
      'scopes_json TEXT, ' +
      'external_account_id TEXT, ' +
      'external_account_name TEXT, ' +
      'last_synced_at TIMESTAMP, ' +
      'last_error TEXT, ' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'UNIQUE(user_id, provider_key))',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integrations_user ON integrations(user_id)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider_key)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status)');
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS integration_logs (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'integration_id INTEGER NOT NULL, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider_key TEXT NOT NULL, ' +
      'direction TEXT NOT NULL, ' +
      'event_type TEXT NOT NULL, ' +
      'status TEXT NOT NULL, ' +
      'http_status INTEGER, ' +
      'request_summary TEXT, ' +
      'response_summary TEXT, ' +
      'external_id TEXT, ' +
      'payload_json TEXT, ' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integration_logs_int ON integration_logs(integration_id, datetime(created_at) DESC)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integration_logs_user ON integration_logs(user_id, datetime(created_at) DESC)');
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS integration_waitlist (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider_key TEXT NOT NULL, ' +
      'notes TEXT, ' +
      'notified_at TIMESTAMP, ' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'UNIQUE(user_id, provider_key))',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_integration_waitlist_provider ON integration_waitlist(provider_key)');
    _schemaReady = true;
  } catch (e) {
    console.warn('[integrations] ensureIntegrationsSchema failed:', (e as Error).message);
  }
}

/** Public-safe view of a registry entry (no secrets, no impl ref). */
export function publicDescriptor(p: ProviderDescriptor) {
  return {
    key: p.key,
    display_name: p.display_name,
    integration_type: p.integration_type,
    description: p.description,
    status: p.status,
    tier: p.tier,
    auth_type: p.auth_type,
    capabilities: p.capabilities,
    docs_url: p.docs_url,
    icon: p.icon ?? null,
    supports_pat: !!p.supports_pat,
    has_implementation: PROVIDER_IMPLS.has(p.key),
  };
}
