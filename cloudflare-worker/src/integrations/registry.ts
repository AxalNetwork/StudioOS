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
import { cartaAudience, cartaScopesFor } from './cartaScopes';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { Tier } from '../middleware/requireTier';
import { MODULE_LABELS, moduleHref } from './moduleLabels';
import { MERCURY_FEEDS, mercuryFedModules } from './mercuryFeeds';
import { bindingKey } from '../util/schemaBootstrap';

export type ProviderStatus = 'live' | 'beta' | 'coming_soon';
/** `oauth_mcp`: a member's sign-in through a provider's MCP server (D840's Mercury, D847's shared client). */
export type AuthType = 'api_key' | 'oauth2' | 'webhook' | 'oauth_mcp';
export type IntegrationType = 'crm' | 'scheduling' | 'cap_table' | 'messaging' | 'e_sign' | 'data_feed' | 'custom';
export type ConnectorCategory = 'CRM' | 'Payments' | 'Calendar' | 'Messaging' | 'Signing' | 'Cap table' | 'Data' | 'Code' | 'Design' | 'Docs' | 'Accounting and banking' | 'Payroll' | 'Calendar and workspace';
export interface ConnectorMetadata {
  category: ConnectorCategory;
  verified: boolean;
  pulls: Array<{ what: string; module: string }>;
  sends: Array<{ what: string; target: string; default_mode: 'auto' | 'ask' }>;
  feeds: string[];
  permissions: string[];
  /** D757 §2.12: where in Axal this connector is used, for D753's page (F7). */
  used_by?: Array<{ label: string; href: string }>;
  /** D757 §2.12: the Validate modules its transcripts suggest into (`moduleLabels.ts` keys). */
  suggests?: string[];
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
   * D879 (#2552): the roles that, on HQ, see the founder's page as a read-only
   * preview (`audienceFor` → `preview`): they connect nothing and read no
   * member's connection. With `personal_roles`, it narrows who sees the
   * provider at all. A provider with neither field is unchanged. It replaces
   * D710's `entity_roles`: Axal VC's own accounts are HQ's only, never a
   * connector (`/api/admin/mercury`).
   */
  preview_roles?: string[];
  /** D710: the roles that may hold their own connection (#1778 adds founders and partners for Mercury). */
  personal_roles?: string[];
  /**
   * D752: personal roles whose every use is HQ-only; off HQ they see `none`.
   * Like the two fields above, it is never served.
   */
  personal_hq_only_roles?: string[];
  /**
   * D757 §2.11: `venture` makes the provider founder-facing — `personal` for a
   * viewer who can hold a venture (`canHoldValidateSource`), `none` for
   * everyone else. It overrides the role lists.
   */
  audience_rule?: 'venture';
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

/**
 * D713 (#1778): a refusal a provider's `connect` throws on purpose. The route's
 * catch answers it as it is, with its own status and code and our sentence,
 * through `refuse`; every other throw stays 400 `connect_failed`.
 */
export class ConnectRefusal extends Error {
  readonly status: number;
  readonly code: string;
  /** Our sentence for the member, answered as the refusal's `message`. */
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.name = 'ConnectRefusal';
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export interface SyncResult {
  summary: string;
  /** Figures, plus `partial: true` when a sync stopped at its budget (#1906). */
  counts?: Record<string, number | boolean>;
  /** D782: the repositories (or other sources) this sync read, kept on its log row. */
  repositories?: string[];
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
  /** D751 — whether Axal holds this provider's OAuth client. Never a value or a name. */
  ready?(env: Env): Promise<boolean | null>;
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
    personal_roles: ['founder', 'investor'],
    display_name: 'Carta',
    integration_type: 'cap_table',
    description: 'Mirror your Carta cap table (issuer, stakeholders, securities) into the Capital module on a 6-hour sync.',
    // 2026-09-10 — unparked to 'beta'. OAuth + 6-hour cap-table sync +
    // Data Imports one-shot already shipped; coming_soon only hid Connect.
    // Needs CARTA_CLIENT_ID/SECRET (env or HQ → Integration keys).
    // Salesforce / Affinity stay coming_soon.
    status: 'beta',
    tier: 'studio',
    auth_type: 'oauth2',
    capabilities: ['Cap-table sync', 'Stakeholder import', 'Securities import'],
    docs_url: 'https://docs.carta.com/api-platform/guides/',
    icon: 'PieChart',
    oauth_scopes: ['read_issuer_info', 'read_issuer_stakeholders', 'read_issuer_securities'],
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
    // (env or HQ → Integration keys). Demo vs production is chosen
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
    // The last two are granted by every General app the owner set up on
    // 2026-10-22, whatever its Scopes page says (zoomapp:inmeeting) or with the
    // transcript event subscribed (cloud_recording:read:recording); Axal calls
    // no endpoint under either. Accepted so the grant is not refused.
    // D886 (#2582): `user:read:token` mints the notetaker's OBF join token
    // (`mintObfToken`). Listed before the owner adds it to the app, so the
    // grant that carries it is not refused; a grant without it still connects.
    status: 'beta',
    tier: 'free',
    auth_type: 'oauth2',
    capabilities: ['Schedule interview calls', 'Import cloud transcripts'],
    docs_url: 'https://developers.zoom.us/docs/integrations/oauth/',
    icon: 'Video',
    // D757 §2.11: founder-facing, a Validate source.
    audience_rule: 'venture',
    oauth_scopes: ['meeting:write:meeting', 'meeting:delete:meeting', 'cloud_recording:read:list_recording_files',
      'meeting:read:meeting', 'meeting:read:list_past_instances', 'user:read:user',
      'cloud_recording:read:recording', 'zoomapp:inmeeting', 'user:read:token'],
  },
  {
    key: 'google_calendar', display_name: 'Google Calendar', integration_type: 'scheduling',
    description: 'Calendar events and interview slots from your existing Google Calendar connection.',
    status: 'live', tier: 'free', auth_type: 'oauth2', capabilities: ['Calendar events'],
    docs_url: null, icon: 'Calendar', oauth_scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
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
  // D879 (#2552): a member connector only. A member reads their OWN Mercury,
  // read-only, through Mercury's MCP server (D840), for Grow and Raise.
  // D713 (#1778): founders and partners hold their own read-only connection, an
  // ordinary `integrations` row (`providers/mercury.ts`), and see their role's
  // personal variant below (`PERSONAL_MERCURY`), on HQ and on a branch.
  // D752 (#1886): investors hold one too; D884 (#2557): on HQ or in a branch, proof of funds HQ-only by use.
  // An admin on HQ sees the founder's page as a preview (`preview_roles`) and
  // connects nothing. Axal VC's own accounts are never here: they are HQ ›
  // Fund administration › Bank accounts (`/api/admin/mercury`, `services/mercury/`).
  {
    key: 'mercury', display_name: 'Mercury', integration_type: 'data_feed',
    description: 'Your own Mercury account, read-only, through Mercury’s own sign-in: Axal VC reads your accounts, transactions, cashflow and statements to fill Grow and Raise. It never sends, transfers or requests money.',
    status: 'beta', tier: 'growth', auth_type: 'api_key', capabilities: ['Grow', 'Raise', 'Read-only'],
    docs_url: 'https://docs.mercury.com', icon: 'Landmark',
    // D884 (#2557, the owner's answer A): an investor connects their own Mercury on HQ or in a branch.
    // Proof of funds stays HQ-only by its use (`HQ_ONLY_USES`), not by hiding the connector.
    preview_roles: ['admin'], personal_roles: ['founder', 'partner', 'investor'],
  },
];

// A catalogue entry describes only behaviour that the shipping provider has.
// Calendar connections are read from calendar.ts; they do not create a second
// integrations row or a second OAuth flow.
export const CONNECTOR_METADATA: Record<string, ConnectorMetadata> = {
  figma: { category: 'Design', verified: false, pulls: [{ what: 'Designs', module: 'prototype_mvp' }], sends: [], feeds: ['prototype_mvp'], permissions: [] },
  hubspot: { category: 'CRM', verified: false, pulls: [{ what: 'Deals and contacts', module: 'capital_relationships' }], sends: [{ what: 'New company', target: 'HubSpot company', default_mode: 'ask' }, { what: 'Deal stage change', target: 'HubSpot deal', default_mode: 'auto' }], feeds: ['capital_relationships', 'network'], permissions: ['Connect to your HubSpot account.', 'Read your HubSpot deals.', 'Update your HubSpot deals.', 'Read your HubSpot contacts.', 'Update your HubSpot contacts.', 'Read your HubSpot companies.', 'Update your HubSpot companies.', 'Read your HubSpot deal fields.'] },
  calendly: { category: 'Calendar', verified: false, pulls: [{ what: 'Booked meetings', module: 'customer_research' }], sends: [], feeds: ['customer_research'], permissions: ['Read your Calendly calendar through its default grant.', 'Read your Calendly profile and scheduled events.'] },
  salesforce: { category: 'CRM', verified: false, pulls: [{ what: 'Opportunity stages', module: 'capital_relationships' }], sends: [{ what: 'New account', target: 'Salesforce account', default_mode: 'ask' }, { what: 'Deal stage change', target: 'Salesforce deal', default_mode: 'auto' }], feeds: ['capital_relationships'], permissions: ['Read and update Salesforce records.', 'Maintain the connection when you are away.', 'Read your Salesforce account identity.'] },
  carta: { category: 'Cap table', verified: false, pulls: [{ what: 'Holders, securities and vesting', module: 'founding_team' }], sends: [], feeds: ['founding_team'], permissions: ['Read your Carta cap table.', 'Read Carta stakeholders.', 'Read Carta securities.'] },
  slack: { category: 'Messaging', verified: false, pulls: [], sends: [{ what: 'Alerts', target: 'Slack channel', default_mode: 'ask' }], feeds: [], permissions: ['Post to the Slack channel you select.'] },
  docusign: { category: 'Signing', verified: false, pulls: [{ what: 'Envelope status', module: 'company_creation' }], sends: [{ what: 'Documents for signature', target: 'DocuSign', default_mode: 'ask' }], feeds: ['company_creation'], permissions: ['Send and read signature envelopes.', 'Keep the DocuSign connection active.'] },
  crunchbase: { category: 'Data', verified: false, pulls: [{ what: 'Company data', module: 'market_intelligence' }], sends: [], feeds: ['market_intelligence'], permissions: ['Read company profiles with your Crunchbase key.'] },
  stripe: { category: 'Payments', verified: false, pulls: [{ what: 'Payments and subscriptions', module: 'revenue_and_traction' }], sends: [], feeds: ['revenue_and_traction', 'customers'], permissions: ['Read charges and subscriptions from your Stripe account.'] },
  github: { category: 'Code', verified: false, pulls: [{ what: 'Issues', module: 'product_roadmap' }, { what: 'Milestones', module: 'product_roadmap' }, { what: 'Releases', module: 'product_roadmap' }, { what: 'Pull requests', module: 'prototype_mvp' }, { what: 'Release checks', module: 'prototype_mvp' }, { what: 'The connection and each sync', module: 'operating_systems' }, { what: 'Architecture notes and decisions', module: 'solution_design' }, { what: 'Languages and topics', module: 'solution_design' }, { what: 'Contributors and their commits', module: 'founding_team' }, { what: 'Where the code sits and its licence', module: 'company_creation' }], sends: [], feeds: ['product_roadmap', 'prototype_mvp', 'operating_systems', 'solution_design', 'founding_team', 'company_creation'], permissions: ['Read issues in the repositories you choose.', 'Read pull requests in the repositories you choose.', 'Read releases, the README, the Markdown in docs/, doc/ and adr/, and the last 90 days of commits in the repositories you choose.', 'Read repository names, visibility, owners, licences, contributors, languages and topics.'] },
  zoom: { category: 'Messaging', verified: false, pulls: [{ what: 'Call transcripts', module: 'customer_research' }], sends: [{ what: 'Interview calls you schedule', target: 'Zoom meeting', default_mode: 'ask' }], feeds: ['customer_research'], used_by: [{ label: 'Validate › Record a session', href: '/validate/record' }], suggests: ['problem_discovery', 'customer_research', 'ideal_customer_profile', 'market_intelligence', 'demand_signals', 'experiments'], permissions: ['Create Zoom meetings for the interview calls you schedule.', 'Delete a Zoom meeting when you cancel its interview call.', 'Read your meetings’ cloud recording files, to download their transcripts.', 'Read a pasted meeting to confirm you host it.', 'List your past meeting instances to recover restarted calls.', 'Read your Zoom user id to identify the connection when you disconnect it.', 'Read a recording’s details, which Zoom grants with transcript notifications; Axal VC uses only the recording files above.', 'Open inside a Zoom meeting, which Zoom grants to every app of this kind; Axal VC does not use it.', 'Let Axal’s notetaker join a call on your behalf, only while you are in it.'] },
  google_calendar: { category: 'Calendar and workspace', verified: false, pulls: [{ what: 'Events', module: 'customer_research' }], sends: [{ what: 'Calendar events', target: 'Google Calendar', default_mode: 'ask' }], feeds: ['customer_research', 'operating_systems'], permissions: ['Create and update your calendar events.', 'Read your calendar events.', 'Read your account email address.', 'Read your public account profile.', 'Confirm your Google sign-in identity.'] },
  // D879: the founder's Grow and Raise modules, read from `mercuryFeeds.ts` (D840 parts 2 and 3).
  mercury: {
    category: 'Accounting and banking', verified: false,
    pulls: MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.module !== null).map((f) => ({ what: f.what, module: f.module! })),
    sends: [],
    feeds: [...new Set(MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.module !== null).map((f) => f.module!))],
    used_by: [{ label: 'Grow', href: '/grow' }, { label: 'Raise', href: '/raise' }],
    permissions: ['Sign in with Mercury: read your accounts, balances, transactions, cashflow, statements, invoices, customers, treasury and SAFEs through Mercury’s MCP server; it never sends, transfers or requests money.'],
  },
  microsoft_365: { category: 'Calendar and workspace', verified: false, pulls: [{ what: 'Events', module: 'customer_research' }], sends: [{ what: 'Calendar events', target: 'Microsoft 365', default_mode: 'ask' }], feeds: ['customer_research', 'operating_systems'], permissions: ['Confirm your Microsoft sign-in identity.', 'Read your public Microsoft profile.', 'Read your account email address.', 'Keep the connection active.', 'Read and update calendar events.', 'Read your basic account profile.'] },
};

/** What one personal role reads on its own Mercury card. */
export interface PersonalMercuryVariant {
  description: string;
  capabilities: string[];
  /** Exactly one sentence, as every `api_key` row has (`connectors_d650.test.ts`). */
  permissions: string[];
  feeds: string[];
  /** D884 (#2557): what the card says it pulls, and the sections it links to. Absent, the card claims none. */
  pulls?: Array<{ what: string; module: string }>;
  used_by?: Array<{ label: string; href: string }>;
}

/**
 * D884 (#2557): a role's Mercury sections as the card names them, from
 * `MERCURY_FEEDS` itself and in its order: what each pulls, and a link to each
 * section that has a page. Proof of funds has no module, so it is neither.
 */
export function mercuryPulls(role: string): Array<{ what: string; module: string }> {
  return MERCURY_FEEDS.filter((f) => f.role === role && f.module !== null).map((f) => ({ what: f.what, module: f.module! }));
}
export function mercuryUsedBy(role: string): Array<{ label: string; href: string }> {
  return mercuryFedModules(role).flatMap((m) => {
    const href = moduleHref(m);
    return href ? [{ label: MODULE_LABELS[m] ?? m, href }] : [];
  });
}

export type PersonalMercuryRole = 'founder' | 'partner' | 'investor';

const FOUNDER_PARTNER_DESCRIPTION = 'Your own Mercury account, read-only: import the credits you choose as venture revenue (founders), and match your invoices, payouts and partner-deal settlements to your own bank lines (partners).';
const FOUNDER_PARTNER_CAPABILITIES = ['Revenue import', 'Payment matching'];
const FOUNDER_PARTNER_PERMISSIONS = ['Read your Mercury account names, last four digits and the transactions you review; it never sends, transfers or requests money.'];

/**
 * D713 (#1778), D752 (#1886): what each personal role reads for its own
 * Mercury connection. A founder's import feeds Revenue and traction; a
 * partner's uses (invoices, payouts, settlements) and an investor's proof of
 * funds have no module key. A PR that changes what a role uses Mercury for
 * updates that role's variant.
 */
export const PERSONAL_MERCURY: Readonly<Record<PersonalMercuryRole, Readonly<PersonalMercuryVariant>>> = Object.freeze({
  // D752 (#1889): the founder also reads their venture's spending, burn, cash and runway.
  founder: Object.freeze({
    description: 'Your own Mercury account, read-only: import the credits you choose as venture revenue, and see each month\'s spending, burn, cash on hand and runway. Only the figures you choose are saved.',
    capabilities: ['Revenue import', 'Payment matching', 'Spending and runway'],
    permissions: ['Read your Mercury account names, last four digits, available balances and the transactions you review; it never sends, transfers or requests money.'],
    // D840 parts 2 (#2347) and 3 (#2348): the Raise and Grow modules, in `MERCURY_FEEDS`' order.
    feeds: ['revenue_and_traction', 'fundraising_readiness', 'use_of_funds', 'data_room', 'cap_table', 'capital_relationships', 'investor_narrative', 'pitch_deck',
      'durable_company_building', 'team_expansion', 'distribution', 'partner_network'],
  }),
  partner: Object.freeze({
    description: FOUNDER_PARTNER_DESCRIPTION, capabilities: FOUNDER_PARTNER_CAPABILITIES,
    permissions: FOUNDER_PARTNER_PERMISSIONS, feeds: [],
  }),
  investor: Object.freeze({
    description: "Your own Mercury account, read-only: your capacity in Deals › Pipeline and Deals › Commit, the wire that funded a commitment in Deals › Closing, and proposals for your Fund sections. On HQ, also a dated proof of funds for Axal's admins, who never see your balance.",
    capabilities: ['Capacity', 'Closing proposals', 'Fund calls, accounting and reporting proposals', 'Proof of funds'],
    permissions: ['Read your Mercury account names, last four digits, available balances, transactions and statements for your own sections; only you see a balance, and it never sends, transfers or requests money.'],
    // D840 part 4 (#2349), D884 (#2557): the investor's sections, read from `mercuryFeeds.ts` itself.
    feeds: mercuryFedModules('investor'),
    // D884 PR 2: Deals first, then Fund, each a link to its section.
    pulls: mercuryPulls('investor'),
    used_by: mercuryUsedBy('investor'),
  }),
});

/** The role's personal Mercury variant, or null for a role that holds none. */
export function personalMercuryFor(role: string | null | undefined): Readonly<PersonalMercuryVariant> | null {
  const key = String(role || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PERSONAL_MERCURY, key) ? PERSONAL_MERCURY[key as PersonalMercuryRole] : null;
}

/** The modules a connector feeds for this viewer: Mercury's personal variant by role, else the catalogue's. */
export function connectorFeeds(providerKey: string, role?: string | null): string[] {
  if (providerKey === 'carta' && role === 'investor') return ['deals_pipeline', 'investor_portfolio'];
  if (providerKey === 'mercury' && role != null && String(role).toLowerCase() !== 'admin') return [...(personalMercuryFor(role)?.feeds ?? [])];
  return CONNECTOR_METADATA[providerKey]?.feeds ?? [];
}

const REGISTRY_BY_KEY: Map<string, ProviderDescriptor> = new Map(
  REGISTRY.map(p => [p.key, p]),
);

/**
 * D751 — `configured` for `GET /available`: the impl's `ready` for an
 * `oauth2` provider, a throw read as `null` (unknown). `undefined` (no field)
 * for any other row, a provider with no impl, or an impl with no `ready`.
 */
export async function readinessOf(env: Env, p: ProviderDescriptor): Promise<boolean | null | undefined> {
  if (p.auth_type !== 'oauth2') return undefined;
  const impl = PROVIDER_IMPLS.get(p.key);
  if (!impl?.ready) return undefined;
  try { return await impl.ready(env); } catch { return null; }
}

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
/**
 * Who is asking, for a provider whose audience depends on it (D710). `venture`
 * is `canHoldValidateSource` (D757 §2.11); every builder of a viewer sets it.
 */
export interface DescriptorViewer { role: string; hq: boolean; venture: boolean }

/**
 * D710: how a viewer may see a provider. `open` for a provider with no
 * audience fields (today's behaviour); `personal` for the viewer's own;
 * `preview` (D879) for a role that reads the founder's page on HQ and connects
 * nothing; `none` when it is not theirs to see. On a branch, only
 * `personal_roles` count, never `preview_roles`. A provider with
 * `audience_rule: 'venture'` (D757) reads only `viewer.venture`.
 */
export type Audience = 'open' | 'preview' | 'personal' | 'none';
export function audienceFor(p: ProviderDescriptor, viewer: DescriptorViewer): Audience {
  if (p.audience_rule === 'venture') return viewer.venture === true ? 'personal' : 'none';
  if (!p.preview_roles && !p.personal_roles) return 'open';
  const role = String(viewer.role || '').toLowerCase();
  if (viewer.hq && (p.preview_roles ?? []).includes(role)) return 'preview';
  // D752: a personal role whose every use is HQ-only sees nothing off HQ.
  if ((p.personal_roles ?? []).includes(role)) return personalHqOnlyOffHq(p, viewer) ? 'none' : 'personal';
  return 'none';
}

/**
 * D757 §2.1: how far Zoom has approved the app, from `ZOOM_APP_AUDIENCE`
 * (#1902), trimmed and lower-cased. Absent, empty or unknown is the narrowest,
 * `own_account`: a page must never promise more members than can connect.
 */
export type ZoomDistribution = 'own_account' | 'beta' | 'public';
export function zoomDistribution(raw: unknown): ZoomDistribution {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'beta' || v === 'public' ? v : 'own_account';
}

/**
 * D752: true when the viewer is off HQ and holds a personal role whose every
 * use is HQ-only (`personal_hq_only_roles`). `/connect` answers such a viewer
 * 403 `purpose_not_allowed` with `personalHqOnlySentence`; every other route
 * stays 404, as for a provider the viewer may not see (D710 decision 5).
 */
export function personalHqOnlyOffHq(p: ProviderDescriptor, viewer: DescriptorViewer): boolean {
  if (viewer.hq) return false;
  const role = String(viewer.role || '').toLowerCase();
  return (p.personal_roles ?? []).includes(role) && (p.personal_hq_only_roles ?? []).includes(role);
}

/** D879: the line a previewing admin reads, pointing at where Axal VC's own accounts live. */
export const HQ_ACCOUNTS_NOTE = Object.freeze({
  line: 'Axal VC’s own accounts are managed in HQ › Fund administration › Bank accounts.',
  href: '/admin?tab=bank-accounts',
});

/** D879: the refusal a role with no personal connection reads at connect (`providers/mercury.ts` and `/connect`). */
export function noPersonalConnectionSentence(name: string): string {
  return `Your role does not hold a personal ${name} connection.`;
}

/** D752: the refusal an HQ-only personal role reads at connect off HQ. */
export function personalHqOnlySentence(name: string): string {
  return `${name} is offered to your profile on HQ only.`;
}

/** The allowlist is selected from the authenticated member, never a request parameter. */
export function descriptorForRole(p: ProviderDescriptor, role: string): ProviderDescriptor {
  const audience = cartaAudience(role);
  return p.key === 'carta' && audience ? { ...p, oauth_scopes: cartaScopesFor(audience) } : p;
}

export function publicDescriptor(p: ProviderDescriptor, viewer?: DescriptorViewer, env?: Pick<Env, 'ZOOM_APP_AUDIENCE'>) {
  const audience = viewer ? audienceFor(p, viewer) : 'open';
  // D713, D752: a founder, partner or investor reads their role's Mercury variant; D879: a previewing admin reads the founder's.
  const variant = p.key !== 'mercury' ? null
    : audience === 'personal' ? personalMercuryFor(viewer!.role) : audience === 'preview' ? PERSONAL_MERCURY.founder : null;
  const cartaInvestor = p.key === 'carta' && viewer?.role === 'investor';
  const metadata = cartaInvestor ? { ...CONNECTOR_METADATA.carta, feeds: ['deals_pipeline', 'investor_portfolio'],
    pulls: [{ what: 'Your firms, funds, portfolio investments, securities and cap tables', module: 'investor_portfolio' }],
    permissions: ['Read your Carta firms.', 'Read funds in those firms.', 'Read their portfolio investments.', 'Read their investment securities.', 'Read their portfolio companies’ capitalization tables.'],
    used_by: [{ label: 'Deals · Pipeline', href: '/deals/pipeline' }, { label: 'Portfolio', href: '/portfolio' }] } : CONNECTOR_METADATA[p.key];
  const feeds = variant ? [...variant.feeds] : metadata?.feeds ?? [];
  return {
    key: p.key,
    display_name: p.display_name,
    integration_type: p.integration_type,
    description: cartaInvestor ? 'Read your own Carta firms, funds, investments, securities and cap tables. Read-only.' : variant ? variant.description : p.description,
    status: p.status,
    tier: p.tier,
    auth_type: p.auth_type,
    capabilities: cartaInvestor ? ['Firm and fund reads', 'Portfolio investments', 'Securities and cap tables'] : variant ? [...variant.capabilities] : p.capabilities,
    docs_url: p.docs_url,
    icon: p.icon ?? null,
    supports_pat: !!p.supports_pat,
    // Only a member's own connection is made here: a preview has no implementation (D879).
    has_implementation: PROVIDER_IMPLS.has(p.key) && !(p.key === 'mercury' && audience !== 'personal'),
    ...metadata,
    ...(variant ? { permissions: [...variant.permissions] } : {}),
    // D879: the catalogue's pulls and `used_by` are the founder's Grow and Raise; a partner's card claims neither.
    // D884 (#2557): an investor's card claims its own sections, from `MERCURY_FEEDS`.
    ...(variant && variant !== PERSONAL_MERCURY.founder ? { pulls: [...(variant.pulls ?? [])], used_by: [...(variant.used_by ?? [])] } : {}),
    ...(p.key === 'zoom' ? { distribution: zoomDistribution(env?.ZOOM_APP_AUDIENCE) } : {}),
    feeds,
    feed_modules: feeds.map(key => ({ key, label: MODULE_LABELS[key] ?? key, href: moduleHref(key) })),
    connection_source: p.key === 'google_calendar' ? 'google_oauth_tokens' : p.key === 'microsoft_365' ? 'microsoft_oauth_tokens' : 'integrations',
    ...(audience === 'preview' ? { preview: true, hq_accounts: { ...HQ_ACCOUNTS_NOTE } } : {}),
  };
}

// D753 (#1875): each connector's page data, re-exported by name (a test loads this file with only named re-exports rewritten). Last, apart from D751's and D752's lines.
export { type ConnectorPage, type PageDescriptor, type PagePrompt, type PageTool, type SignInKind, type ToolAccess, type Trust, type VariantPages, type FirstPartyCard, CATEGORY_ORDER, CHANNEL_PAGES, CONNECTOR_PAGES, FIRST_PARTY_CARDS, FIRST_PARTY_PAGES, MONEY_MOVERS, PAGE_ALIAS, channelPage, connectorPagePath, directoryKeyFor, pageDescriptor, trustFor } from './connectorPages';
