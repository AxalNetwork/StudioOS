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
import { MODULE_LABELS, moduleHref } from './moduleLabels';
import { bindingKey } from '../util/schemaBootstrap';

export type ProviderStatus = 'live' | 'beta' | 'coming_soon';
export type AuthType = 'api_key' | 'oauth2' | 'webhook';
export type IntegrationType = 'crm' | 'scheduling' | 'cap_table' | 'messaging' | 'e_sign' | 'data_feed' | 'custom';
export type ConnectorCategory = 'CRM' | 'Payments' | 'Calendar' | 'Messaging' | 'Signing' | 'Cap table' | 'Data' | 'Code' | 'Design' | 'Docs' | 'Accounting and banking' | 'Payroll' | 'Calendar and workspace';
export interface ConnectorMetadata {
  category: ConnectorCategory;
  verified: boolean;
  pulls: Array<{ what: string; module: string }>;
  sends: Array<{ what: string; target: string; default_mode: 'auto' | 'ask' }>;
  feeds: string[];
  permissions: string[];
}

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
  /**
   * D710 (#1775): the roles that see this provider as an HQ entity connection
   * (an `admin` on HQ for Mercury), read through its own store rather than an
   * `integrations` row. With `personal_roles`, it narrows who sees the
   * provider at all. A provider with neither field is unchanged.
   */
  entity_roles?: string[];
  /** D710: the roles that may hold their own connection (#1778 adds founders and partners for Mercury). */
  personal_roles?: string[];
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
  last_error_at: string | null;
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

/**
 * D652 — what one `push` would send, read without sending it: the record it
 * lands on, and every field with the value it carries. Eadwyn's card shows
 * this, the pending action stores and hashes it, and confirm rebuilds it and
 * refuses when it no longer matches, so what the member saw is what goes out.
 */
export interface PushPreview {
  target: string;
  fields: { name: string; value: string | number | null }[];
}

export interface ProviderImpl {
  key: string;
  connect(c: Context<{ Bindings: Env }>, user: User, input: ConnectInput): Promise<ConnectResult>;
  /** Revoke a rejected OAuth grant before any connection row is saved. */
  revokeGranted?(env: Env, result: ConnectResult): Promise<void>;
  sync?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<SyncResult>;
  push?(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow, payload: unknown): Promise<PushResult>;
  /**
   * D652: `push`'s content for this payload, built by the same function
   * `push` builds it with, and nothing sent. Throws where `push` would refuse
   * before sending (target missing, company not enabled).
   */
  preview?(env: Env, row: IntegrationRow, payload: unknown): Promise<PushPreview>;
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
  { key: 'figma', display_name: 'Figma', integration_type: 'data_feed', description: 'Design files for Prototype / MVP.', status: 'coming_soon', tier: 'free', auth_type: 'oauth2', capabilities: [], docs_url: null, icon: 'Figma' },
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
    oauth_scopes: ['oauth', 'crm.objects.deals.read', 'crm.objects.deals.write', 'crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.companies.read', 'crm.objects.companies.write', 'crm.schemas.deals.read'],
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
    oauth_scopes: ['default', 'user'],
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
    // 2026-09-10 — unparked to 'beta'. OAuth + 6-hour cap-table sync +
    // Data Imports one-shot already shipped; coming_soon only hid Connect.
    // Needs CARTA_CLIENT_ID/SECRET (env or Admin → Integration Keys).
    // Salesforce / Affinity stay coming_soon.
    status: 'beta',
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
    // 2026-09-10 — unparked to 'beta'. Envelope send, Connect webhook,
    // hourly reconcile, and Admin e-sign picker already shipped;
    // coming_soon only hid Connect. Needs DOCUSIGN_CLIENT_ID/SECRET
    // (env or Admin → Integration Keys). Demo vs production is chosen
    // in the connect modal (?demo=1|0). Salesforce / Affinity stay
    // coming_soon.
    status: 'beta',
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
    // 2026-09-10 — unparked to 'beta'. The provider, /api/crunchbase/*
    // routes, ProjectDetail lookup/apply, and Market Intel competitor
    // fetch were already live; coming_soon only blocked Connect so
    // enrichment always 412'd. Per-user Basic user_key (no OAuth app).
    status: 'beta',
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
  {
    key: 'github',
    display_name: 'GitHub',
    integration_type: 'data_feed',
    description: 'Read issues, pull requests and releases from the repositories you choose. Issues link to Product roadmap items and pull requests to Prototype / MVP must-haves. Read-only.',
    // D655 (#1467). A GitHub App, not an OAuth App: an OAuth App's only
    // private-repository scope (`repo`) also grants write, so read-only is
    // possible only with an App's fine-grained permissions. These four are
    // the App's permissions; the callback reads what each installation
    // actually grants and refuses anything beyond them (a write is refused).
    status: 'beta',
    tier: 'free',
    auth_type: 'oauth2',
    capabilities: ['Read issues', 'Read pull requests', 'Read releases', 'Choose repositories'],
    docs_url: 'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app',
    icon: 'Github',
    oauth_scopes: ['issues:read', 'pull_requests:read', 'contents:read', 'metadata:read'],
  },
  {
    key: 'zoom',
    display_name: 'Zoom',
    integration_type: 'messaging',
    description: 'Schedule a Zoom call from a Validate interview on your own Zoom account. When the call’s cloud transcript is ready, it is imported into the interview.',
    // D684 (#1577). The implementation lives with the other interview channels
    // (services/channels/zoom.ts), which registers it; the router that mounts
    // the meetings routes imports it. Scopes are granular General-app names,
    // UNVERIFIED until the Zoom app exists: create, delete, and list a
    // meeting's recordings (which carries the transcript's download link).
    // D685 adds meeting and user reads to prove a pasted call is hosted by
    // this member and to resolve Zoom's deauthorization event to their grant.
    // Zoom sets scopes on the app itself; the callback refuses a wider grant.
    status: 'beta',
    tier: 'free',
    auth_type: 'oauth2',
    capabilities: ['Schedule interview calls', 'Import cloud transcripts'],
    docs_url: 'https://developers.zoom.us/docs/integrations/oauth/',
    icon: 'Video',
    oauth_scopes: ['meeting:write:meeting', 'meeting:delete:meeting', 'cloud_recording:read:list_recording_files',
      'meeting:read:meeting', 'meeting:read:list_past_instances', 'user:read:user'],
  },
  {
    key: 'google_calendar', display_name: 'Google Calendar', integration_type: 'scheduling',
    description: 'Calendar events and interview slots from your existing Google Calendar connection.',
    status: 'live', tier: 'free', auth_type: 'oauth2', capabilities: ['Calendar events'],
    docs_url: null, icon: 'Calendar', oauth_scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ],
  },
  {
    key: 'microsoft_365', display_name: 'Microsoft 365', integration_type: 'scheduling',
    description: 'Calendar events and interview slots from your existing Microsoft 365 connection.',
    status: 'live', tier: 'free', auth_type: 'oauth2', capabilities: ['Calendar events'],
    docs_url: null, icon: 'Calendar', oauth_scopes: [
      'openid', 'profile', 'email', 'offline_access', 'Calendars.ReadWrite', 'User.Read',
    ],
  },
  // D710 (#1775): the bank provider D686 left open. Read-only: an HQ entity
  // connection a Super Admin adds per Axal organization, in its own store
  // (`services/mercury/`), so no per-user `ProviderImpl` is registered and
  // `has_implementation` is false. Only an admin on HQ sees it.
  {
    key: 'mercury', display_name: 'Mercury', integration_type: 'data_feed',
    description: 'Read balances and transactions of the Axal entity accounts for fund administration. Read-only: nothing here can move money.',
    status: 'beta', tier: 'growth', auth_type: 'api_key', capabilities: ['Balances', 'Transactions', 'Reconciliation'],
    docs_url: 'https://docs.mercury.com', icon: 'Landmark',
    entity_roles: ['admin'], personal_roles: [],
  },
];

// A catalogue entry describes only behaviour that the shipping provider has.
// Calendar connections are read from calendar.ts; they do not create a second
// integrations row or a second OAuth flow.
export const CONNECTOR_METADATA: Record<string, ConnectorMetadata> = {
  figma: { category: 'Design', verified: false, pulls: [{ what: 'Designs', module: 'prototype_mvp' }], sends: [], feeds: ['prototype_mvp'], permissions: [] },
  hubspot: { category: 'CRM', verified: true, pulls: [{ what: 'Deals and contacts', module: 'capital_relationships' }], sends: [{ what: 'New company', target: 'HubSpot company', default_mode: 'ask' }, { what: 'Deal stage change', target: 'HubSpot deal', default_mode: 'auto' }], feeds: ['capital_relationships', 'network'], permissions: ['Connect to your HubSpot account.', 'Read your HubSpot deals.', 'Update your HubSpot deals.', 'Read your HubSpot contacts.', 'Update your HubSpot contacts.', 'Read your HubSpot companies.', 'Update your HubSpot companies.', 'Read your HubSpot deal fields.'] },
  calendly: { category: 'Calendar', verified: true, pulls: [{ what: 'Booked meetings', module: 'customer_research' }], sends: [], feeds: ['customer_research'], permissions: ['Read your Calendly calendar through its default grant.', 'Read your Calendly profile and scheduled events.'] },
  salesforce: { category: 'CRM', verified: false, pulls: [{ what: 'Opportunity stages', module: 'capital_relationships' }], sends: [{ what: 'New account', target: 'Salesforce account', default_mode: 'ask' }, { what: 'Deal stage change', target: 'Salesforce deal', default_mode: 'auto' }], feeds: ['capital_relationships'], permissions: ['Read and update Salesforce records.', 'Maintain the connection when you are away.', 'Read your Salesforce account identity.'] },
  carta: { category: 'Cap table', verified: false, pulls: [{ what: 'Holders, securities and vesting', module: 'founding_team' }], sends: [], feeds: ['founding_team'], permissions: ['Read your Carta cap table.', 'Read Carta stakeholders.', 'Read Carta securities.'] },
  slack: { category: 'Messaging', verified: true, pulls: [], sends: [{ what: 'Alerts', target: 'Slack channel', default_mode: 'ask' }], feeds: [], permissions: ['Post to the Slack channel you select.'] },
  docusign: { category: 'Signing', verified: false, pulls: [{ what: 'Envelope status', module: 'company_creation' }], sends: [{ what: 'Documents for signature', target: 'DocuSign', default_mode: 'ask' }], feeds: ['company_creation'], permissions: ['Send and read signature envelopes.', 'Keep the DocuSign connection active.'] },
  crunchbase: { category: 'Data', verified: false, pulls: [{ what: 'Company data', module: 'market_intelligence' }], sends: [], feeds: ['market_intelligence'], permissions: ['Read company profiles with your Crunchbase key.'] },
  stripe: { category: 'Payments', verified: true, pulls: [{ what: 'Payments and subscriptions', module: 'revenue_and_traction' }], sends: [], feeds: ['revenue_and_traction', 'customers'], permissions: ['Read charges and subscriptions from your Stripe account.'] },
  affinity: { category: 'CRM', verified: false, pulls: [], sends: [], feeds: [], permissions: ['Read relationship data from your Affinity account.'] },
  github: { category: 'Code', verified: false, pulls: [{ what: 'Issues', module: 'product_roadmap' }, { what: 'Pull requests', module: 'prototype_mvp' }, { what: 'Releases', module: 'product_roadmap' }], sends: [], feeds: ['product_roadmap', 'prototype_mvp'], permissions: ['Read issues in the repositories you choose.', 'Read pull requests in the repositories you choose.', 'Read releases in the repositories you choose.', 'Read repository names and visibility.'] },
  zoom: { category: 'Messaging', verified: false, pulls: [{ what: 'Call transcripts', module: 'customer_research' }], sends: [{ what: 'Interview calls you schedule', target: 'Zoom meeting', default_mode: 'ask' }], feeds: ['customer_research'], permissions: ['Create Zoom meetings for the interview calls you schedule.', 'Delete a Zoom meeting when you cancel its interview call.', 'Read your meetings’ cloud recording files, to download their transcripts.', 'Read a pasted meeting to confirm you host it.', 'List your past meeting instances to recover restarted calls.', 'Read your Zoom user id to identify the connection when you disconnect it.'] },
  google_calendar: { category: 'Calendar and workspace', verified: true, pulls: [{ what: 'Events', module: 'customer_research' }], sends: [{ what: 'Calendar events', target: 'Google Calendar', default_mode: 'ask' }], feeds: ['customer_research', 'operating_systems'], permissions: ['Create and update your calendar events.', 'Read your calendar events.', 'Read Gmail messages linked to invitations.', 'Read your account email address.', 'Read your public account profile.', 'Confirm your Google sign-in identity.'] },
  mercury: { category: 'Accounting and banking', verified: false, pulls: [], sends: [], feeds: [], permissions: ['Read balances and transactions of the Axal entity accounts a Super Admin connects.'] },
  microsoft_365: { category: 'Calendar and workspace', verified: true, pulls: [{ what: 'Events', module: 'customer_research' }], sends: [{ what: 'Calendar events', target: 'Microsoft 365', default_mode: 'ask' }], feeds: ['customer_research', 'operating_systems'], permissions: ['Confirm your Microsoft sign-in identity.', 'Read your public Microsoft profile.', 'Read your account email address.', 'Keep the connection active.', 'Read and update calendar events.', 'Read your basic account profile.'] },
};

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
const SCHEMA_READY = new WeakMap<object, boolean>();
export async function ensureIntegrationsSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
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
      'last_error_at TEXT, ' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'UNIQUE(user_id, provider_key))',
    );
    try { await env.DB.exec('ALTER TABLE integrations ADD COLUMN last_error_at TEXT'); }
    catch (e) { if (!/duplicate column name/i.test(e instanceof Error ? e.message : String(e))) throw e; }
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
    SCHEMA_READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[integrations] ensureIntegrationsSchema failed:', (e as Error).message);
  }
}

/** Public-safe view of a registry entry (no secrets, no impl ref). */
/** Who is asking, for a provider whose audience depends on it (D710). */
export interface DescriptorViewer { role: string; hq: boolean }

/**
 * D710: how a viewer may see a provider. `open` for a provider with no
 * audience fields (today's behaviour); `entity` for an HQ entity connection;
 * `personal` for the viewer's own; `none` when it is not theirs to see. On a
 * branch, only `personal_roles` count, never `entity_roles`.
 */
export function audienceFor(p: ProviderDescriptor, viewer: DescriptorViewer): 'open' | 'entity' | 'personal' | 'none' {
  if (!p.entity_roles && !p.personal_roles) return 'open';
  const role = String(viewer.role || '').toLowerCase();
  if (viewer.hq && (p.entity_roles ?? []).includes(role)) return 'entity';
  if ((p.personal_roles ?? []).includes(role)) return 'personal';
  return 'none';
}

export function publicDescriptor(p: ProviderDescriptor, viewer?: DescriptorViewer) {
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
    ...CONNECTOR_METADATA[p.key],
    feed_modules: (CONNECTOR_METADATA[p.key]?.feeds ?? []).map(key => ({ key, label: MODULE_LABELS[key] ?? key, href: moduleHref(key) })),
    connection_source: p.key === 'google_calendar' ? 'google_oauth_tokens' : p.key === 'microsoft_365' ? 'microsoft_oauth_tokens'
      : p.key === 'mercury' && viewer && audienceFor(p, viewer) === 'entity' ? 'mercury_entity_connections' : 'integrations',
  };
}
