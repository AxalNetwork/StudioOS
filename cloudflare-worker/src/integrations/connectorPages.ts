/**
 * D753 (#1875): each connector's page, as data. The registry describes a card
 * (`REGISTRY`, `CONNECTOR_METADATA`); this module describes the page behind it:
 * a tagline and a long description, the tools Axal VC runs through the
 * connector, the Eadwyn prompts the code supports, who made it, how to sign in,
 * the service's endpoints, when it was added, its links and the trust sentence.
 *
 * Every fact here is held to the code by `test/connector_pages_d753.test.ts`:
 * each tool's `calls` fragments are found in its connector's sources, every
 * request that writes is named by a tool, prompts exist only for a connector
 * Eadwyn reads, and "never writes" and "cannot move money" follow the tools.
 *
 * IMPORT RULE. `registry.ts` re-exports this module, so the two form a cycle.
 * This file imports only types and `audienceFor` from `./registry`, calls
 * `audienceFor` inside functions only, and never reads a registry value at its
 * top level. It imports no provider and no service: the provider constants
 * quoted in `endpoints` are checked by the test, not imported.
 */
import type { ConnectorCategory, DescriptorViewer, ProviderDescriptor } from './registry';
import { audienceFor } from './registry';

export type ToolAccess = 'read' | 'write' | 'account' | 'inbound';

/** One thing Axal VC reads or does through a connector; `calls` are literal fragments of the source that makes the call. */
export interface PageTool {
  name: string;
  label: string;
  access: ToolAccess;
  what: string;
  lands_in: string | null;
  calls: string[];
}

/** An example ask for Eadwyn the code supports. `proposes` is a `SEND_TARGETS` field of the same connector, or null. */
export interface PagePrompt {
  name: string;
  ask: string;
  proposes: 'project_id' | 'deal_id' | null;
}

export type SignInKind = 'oauth' | 'oauth_or_key' | 'key' | 'first_party' | 'entity';

export interface ConnectorPage {
  /** At most 120 characters. */
  tagline: string;
  /** One to four paragraphs. */
  long_description: string[];
  tools: PageTool[];
  prompts: PagePrompt[];
  /** Null exactly when `prompts` is not empty. */
  prompts_reason: string | null;
  made_by: { name: 'Axal VC' };
  service: { name: string; href: string | null };
  sign_in: { kind: SignInKind; label: string; key_help_href: string | null };
  endpoints: { sign_in: string | null; api: string | null };
  /** The month it became connectable, `YYYY-MM`, or null. */
  added: string | null;
  links: { help: string | null; developer_docs: string | null; support: string | null; privacy: string | null };
  /** The date of a recorded live connect on production (`YYYY-MM-DD`), or null (D753 decision 7). */
  verified_on: string | null;
}

/** Mercury's pages, by audience: the HQ entity connection, and a member's own by role. */
export interface VariantPages {
  entity: ConnectorPage;
  personal: Record<string, ConnectorPage>;
}

const AXAL = { name: 'Axal VC' } as const;
const NO_LINKS = { help: null, support: null, privacy: null };

const tool = (name: string, label: string, access: ToolAccess, what: string, lands_in: string | null, calls: string[]): PageTool =>
  ({ name, label, access, what, lands_in, calls });

const notRead = (name: string) => `Eadwyn does not read ${name} yet.`;

// ── Mercury: one client, two audiences ────────────────────────────────────────

const MERCURY_API = 'https://api.mercury.com/api/v1';
const MERCURY_DOCS = 'https://docs.mercury.com';

function mercuryTools(variant: 'entity' | 'founder' | 'partner'): PageTool[] {
  const tools = [
    tool('read_organization', 'your organization', 'read', 'Reads the organization’s id and legal name, to match it to the right owner.', null, ["read(token, '/organization'"]),
    tool('list_accounts', 'account names and last four digits', 'read', 'Lists the organization’s accounts by name, kind and last four digits.', null, ["read(token, '/accounts'"]),
    tool('list_transactions', 'transactions', 'read',
      variant === 'entity' ? 'Reads each account’s transactions every hour, for reconciliation against capital calls and fees.'
        : variant === 'founder' ? 'Lists the credits in your account. Only the ones you import become revenue rows.'
          : 'Lists your account’s transactions so you can pick the one that settled an invoice, payout or deal.',
      variant === 'founder' ? 'revenue_and_traction' : null,
      ['`/account/${accountId}/transactions`']),
  ];
  if (variant !== 'entity') {
    tools.push(tool('read_transaction', 'the transaction you pick', 'read', 'Reads the one transaction you picked, to confirm it before it is used.', null,
      ['`/account/${accountId}/transaction/${transactionId}`']));
  }
  return tools;
}

function mercuryPage(variant: 'entity' | 'founder' | 'partner'): ConnectorPage {
  const entity = variant === 'entity';
  return {
    tagline: entity ? 'Balances and transactions of the Axal entity accounts, for fund administration. Read-only.'
      : variant === 'founder' ? 'Credits from your own Mercury account, imported as venture revenue. Read-only.'
        : 'Your invoices, payouts and settlements matched to your own Mercury lines. Read-only.',
    long_description: entity
      ? [
        'Read balances and transactions of the Axal entity accounts for fund administration. Read-only: nothing here can move money.',
        'A Super Admin adds a Read Only API token for each Axal entity. Axal VC reads the organization, its accounts and their transactions, and proposes matches to capital calls and fees for a person to confirm.',
      ]
      : variant === 'founder'
        ? [
          'Your own Mercury account, read-only.',
          'Axal VC lists the credits in your account. Only the credits you choose to import become rows in Revenue and traction. It never sends, transfers or requests money.',
        ]
        : [
          'Your own Mercury account, read-only.',
          'Axal VC lists your transactions so you can match an invoice, a payout or a partner-deal settlement to the line that settled it. It never sends, transfers or requests money.',
        ],
    tools: mercuryTools(variant),
    prompts: [],
    prompts_reason: notRead('Mercury'),
    made_by: AXAL,
    service: { name: 'Mercury', href: null },
    sign_in: entity
      ? { kind: 'entity', label: 'Read Only API token, added for each Axal entity by the Super Admin', key_help_href: null }
      : { kind: 'key', label: 'Read Only API token', key_help_href: MERCURY_DOCS },
    endpoints: { sign_in: null, api: MERCURY_API },
    added: '2026-10',
    links: { ...NO_LINKS, developer_docs: MERCURY_DOCS },
    verified_on: null,
  };
}

// ── The pages ─────────────────────────────────────────────────────────────────

/**
 * One page per `REGISTRY` row, keyed by registry key. Mercury's is by audience
 * (D753 decision 15). Read through `pageDescriptor`, never directly by a route.
 */
export const CONNECTOR_PAGES: Record<string, ConnectorPage | VariantPages> = {
  figma: {
    tagline: 'Design files for Prototype / MVP. Coming soon.',
    long_description: [
      'Figma will bring design files into Prototype / MVP.',
      'Axal VC has not built this connector yet. Nothing connects, and nothing is read or written.',
    ],
    tools: [],
    prompts: [],
    prompts_reason: 'Nothing to ask yet: this connector is not built.',
    made_by: AXAL,
    service: { name: 'Figma', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Figma', key_help_href: null },
    endpoints: { sign_in: null, api: null },
    added: null,
    links: { ...NO_LINKS, developer_docs: null },
    verified_on: null,
  },
  hubspot: {
    tagline: 'Deals, companies and contacts between Axal VC and your HubSpot CRM.',
    long_description: [
      'Sync deals, companies and contacts between Axal VC and your HubSpot CRM.',
      'Deals read from HubSpot land in Capital relationships. When a deal’s stage changes on Axal VC, its HubSpot deal is updated automatically. A company and its founder contact go to HubSpot only when you ask.',
      'Connect with a HubSpot Private App token, or by signing in with HubSpot. Axal VC never deletes a HubSpot record.',
    ],
    tools: [
      tool('read_token_info', 'the token’s account', 'account', 'Reads which HubSpot account the token belongs to, when you connect.', null,
        ['`${HS_API}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`']),
      tool('search_deals', 'recently changed deals', 'read', 'Searches for deals changed in the last half hour, to keep stages in step.', null, ["'/crm/v3/objects/deals/search'"]),
      tool('list_deals', 'deals', 'read', 'Lists your deals with their name, stage, pipeline and amount.', 'capital_relationships',
        ['`/crm/v3/objects/deals?limit=100&properties=dealname,dealstage,pipeline,amount']),
      tool('list_pipelines', 'deal pipelines', 'read', 'Reads your deal pipelines and their stages, to map stages both ways.', null, ["'/crm/v3/pipelines/deals'"]),
      tool('create_deal', 'deals', 'write', 'Creates a HubSpot deal, automatically, when a deal’s stage changes on Axal VC and HubSpot has none yet.', null,
        ["hsFetch(env, row, '/crm/v3/objects/deals', {"]),
      tool('update_deal', 'deal stages', 'write', 'Updates the HubSpot deal’s stage, automatically, when its stage changes on Axal VC.', null,
        ['`/crm/v3/objects/deals/${encodeURIComponent(deal.hubspot_deal_id)}`']),
      tool('create_company', 'companies', 'write', 'Creates a HubSpot company for a project, when you ask.', null, ["hsFetch(env, row, '/crm/v3/objects/companies', {"]),
      tool('update_company', 'company details', 'write', 'Updates the project’s HubSpot company, when you ask.', null,
        ['`/crm/v3/objects/companies/${encodeURIComponent(companyId)}`']),
      tool('create_contact', 'founder contacts', 'write', 'Creates the founder’s contact with the company, when you ask and HubSpot has none yet.', null, ["'/crm/v3/objects/contacts'"]),
      tool('receive_deal_updates', 'deal updates', 'inbound', 'HubSpot tells Axal VC when a deal changes.', null, ['async function webhook(']),
      tool('revoke_refresh_token', 'the sign-in', 'account', 'Revokes the HubSpot sign-in when you disconnect.', null, ['/oauth/v1/refresh-tokens/']),
    ],
    prompts: [
      { name: 'recent_deals', ask: 'Which HubSpot deals were updated most recently, and at what stage?', proposes: null },
      { name: 'deal_amounts', ask: 'What is each HubSpot deal for <project> worth?', proposes: null },
      { name: 'send_company', ask: 'Add <project> to HubSpot as a company', proposes: 'project_id' },
      { name: 'update_deal', ask: 'Update the HubSpot deal for <project>', proposes: 'deal_id' },
    ],
    prompts_reason: null,
    made_by: AXAL,
    service: { name: 'HubSpot', href: null },
    sign_in: { kind: 'oauth_or_key', label: 'Private App token, or sign in with HubSpot', key_help_href: 'https://developers.hubspot.com/docs/api/overview' },
    endpoints: { sign_in: 'https://app.hubspot.com/oauth/authorize', api: 'https://api.hubapi.com' },
    added: '2026-05',
    links: { ...NO_LINKS, developer_docs: 'https://developers.hubspot.com/docs/api/overview' },
    verified_on: null,
  },
  calendly: {
    tagline: 'Bookings from your Calendly land in Customer research.',
    long_description: [
      'Calendly bookings flow into Customer research: Axal VC reads your scheduled events and their invitees.',
      'To hear about new bookings, Axal VC adds a webhook subscription to your Calendly account, and can remove it again.',
      'Connect with a Calendly Personal Access Token, or by signing in with Calendly. Axal VC never books, changes or cancels a meeting in Calendly.',
    ],
    tools: [
      tool('read_profile', 'your profile', 'read', 'Reads your Calendly user and organization, when you connect.', null, ["clBearerFetch(token, '/users/me')"]),
      tool('create_webhook_subscription', 'a booking webhook', 'account', 'Subscribes Axal VC to your booking events.', null, ['`${CL_API}/webhook_subscriptions`']),
      tool('delete_webhook_subscription', 'the booking webhook', 'account', 'Removes that subscription.', null, ["await fetch(uri, { method: 'DELETE'"]),
      tool('list_scheduled_events', 'scheduled events', 'read', 'Lists your scheduled events.', 'customer_research', ['`/scheduled_events?user=${encodeURIComponent(userUri)}`']),
      tool('read_invitee', 'invitees', 'read', 'Reads who booked each event.', null, ['`${path}/invitees?count=1`']),
      tool('receive_bookings', 'bookings', 'inbound', 'Calendly tells Axal VC when an event is booked or canceled.', null, ['async function webhook(']),
      tool('list_event_types', 'event types', 'read', 'Lists your active event types, to offer a booking link.', null,
        ['`/event_types?user=${encodeURIComponent(userUri)}&active=true&count=50`']),
    ],
    prompts: [],
    prompts_reason: notRead('Calendly'),
    made_by: AXAL,
    service: { name: 'Calendly', href: null },
    sign_in: { kind: 'oauth_or_key', label: 'Personal Access Token, or sign in with Calendly', key_help_href: 'https://developer.calendly.com/api-docs' },
    endpoints: { sign_in: 'https://auth.calendly.com/oauth/authorize', api: 'https://api.calendly.com' },
    added: '2026-05',
    links: { ...NO_LINKS, developer_docs: 'https://developer.calendly.com/api-docs' },
    verified_on: null,
  },
  salesforce: {
    tagline: 'Opportunities and accounts in your Salesforce org. Coming soon.',
    long_description: [
      'Push opportunities and accounts to your Salesforce org.',
      'New connections are paused while Salesforce is coming soon. A connection made before the pause keeps working: Axal VC reads opportunity stages into Capital relationships, updates an opportunity when its deal stage changes, and creates or updates an account and its contact when you ask.',
    ],
    tools: [
      tool('read_identity', 'your identity', 'read', 'Reads your Salesforce identity, when you connect.', null, ['await fetch(idUrl,']),
      tool('query_opportunities', 'opportunity stages', 'read', 'Reads your opportunities and their stages.', 'capital_relationships', ['`/query?q=${encodeURIComponent(soql)}`']),
      tool('describe_opportunity', 'opportunity fields', 'read', 'Reads the opportunity’s fields and stages, to map stages both ways.', null, ["'/sobjects/Opportunity/describe'"]),
      tool('update_opportunity', 'opportunity stages', 'write', 'Updates an opportunity, automatically, when its deal stage changes on Axal VC.', null,
        ['`/sobjects/Opportunity/${encodeURIComponent(deal.sf_opportunity_id)}`', 'sfFetch(env, row, path, {']),
      tool('create_opportunity', 'opportunities', 'write', 'Creates an opportunity, automatically, when a deal’s stage changes and Salesforce has none yet.', null,
        ["'/sobjects/Opportunity', { method: 'POST'", 'sfFetch(env, row, path, {']),
      tool('update_account', 'account details', 'write', 'Updates the project’s account, when you ask.', null,
        ['`/sobjects/Account/${encodeURIComponent(accountId)}`', 'sfFetch(env, row, path, {']),
      tool('create_account', 'accounts', 'write', 'Creates an account for a project, when you ask.', null, ["'/sobjects/Account', { method: 'POST'", 'sfFetch(env, row, path, {']),
      tool('create_contact', 'founder contacts', 'write', 'Creates the founder’s contact with the account, when you ask.', null, ["'/sobjects/Contact', { method: 'POST'"]),
      tool('revoke_token', 'the sign-in', 'account', 'Revokes the Salesforce sign-in when you disconnect.', null, ['/services/oauth2/revoke']),
    ],
    prompts: [],
    prompts_reason: 'Salesforce is coming soon, so Eadwyn cannot read it yet.',
    made_by: AXAL,
    service: { name: 'Salesforce', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Salesforce', key_help_href: null },
    endpoints: { sign_in: 'https://login.salesforce.com/services/oauth2/authorize', api: null },
    added: null,
    links: { ...NO_LINKS, developer_docs: 'https://developer.salesforce.com/docs' },
    verified_on: null,
  },
  carta: {
    tagline: 'Your Carta cap table in Founding team, refreshed every six hours. Read-only.',
    long_description: [
      'Mirror your Carta cap table (issuer, stakeholders, securities and vesting) into Founding team on a six-hour sync.',
      'Read-only: Axal VC reads your cap table and never changes it in Carta. When you disconnect, it revokes its Carta sign-in.',
    ],
    tools: [
      tool('list_issuers', 'issuers', 'read', 'Lists the companies your Carta sign-in can see.', null, ["cartaFetch(env, row, '/issuers')"]),
      tool('list_stakeholders', 'stakeholders', 'read', 'Reads each issuer’s stakeholders.', 'founding_team', ["/stakeholders`, 'stakeholders'"]),
      tool('list_securities', 'securities', 'read', 'Reads each issuer’s securities.', 'founding_team', ["/securities`, 'securities'"]),
      tool('list_vesting_schedules', 'vesting schedules', 'read', 'Reads each issuer’s vesting schedules.', null, ['/vesting-schedules`']),
      tool('revoke_token', 'the sign-in', 'account', 'Revokes the Carta sign-in when you disconnect.', null, ['`${AUTH_HOST}/o/revoke_token/`']),
    ],
    prompts: [],
    prompts_reason: notRead('Carta'),
    made_by: AXAL,
    service: { name: 'Carta', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Carta', key_help_href: null },
    endpoints: { sign_in: 'https://login.carta.com/o/authorize/', api: 'https://api.carta.com/v1alpha1' },
    added: '2026-09',
    links: { ...NO_LINKS, developer_docs: 'https://carta.com/api/' },
    verified_on: null,
  },
  slack: {
    tagline: 'Alerts from Axal VC in the Slack channel you choose.',
    long_description: [
      'Receive deal-flow alerts in the Slack channel you choose. Axal VC sends one-way notifications.',
      'Slack gives Axal VC a webhook for that one channel. Axal VC reads nothing from Slack: no messages, members or channels.',
    ],
    tools: [
      tool('post_message', 'alerts', 'write', 'Posts an alert to the channel you chose, when Axal VC has one for you.', null,
        ['async function postSlackBlocks(webhook: string', 'await fetch(webhook, {']),
    ],
    prompts: [],
    prompts_reason: notRead('Slack'),
    made_by: AXAL,
    service: { name: 'Slack', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Slack and choose a channel', key_help_href: null },
    endpoints: { sign_in: 'https://slack.com/oauth/v2/authorize', api: null },
    added: '2026-05',
    links: { ...NO_LINKS, developer_docs: 'https://api.slack.com/messaging/webhooks' },
    verified_on: null,
  },
  docusign: {
    tagline: 'Send agreements for signature through DocuSign and follow their status.',
    long_description: [
      'Send incorporation, NDA and co-founder agreements through DocuSign, with its audit trail.',
      'Axal VC sends an envelope only when you send it. It then follows the envelope’s status and recipients in Company creation, and keeps the signed document.',
      'To hear about changes, Axal VC registers a Connect listener with its own signing key on your DocuSign account.',
    ],
    tools: [
      tool('read_user_info', 'your account', 'read', 'Reads your DocuSign user and account, when you connect.', null, ['/oauth/userinfo`']),
      tool('send_envelope', 'envelopes', 'write', 'Sends an envelope for signature, when you send it.', null, ["dsFetch(env, row, '/envelopes', {"]),
      tool('read_envelope_status', 'envelope status', 'read', 'Reads an envelope’s status.', 'company_creation', ['`/envelopes/${encodeURIComponent(dsEnvelopeId)}`)']),
      tool('read_recipients', 'recipients', 'read', 'Reads who has signed.', 'company_creation', ['/recipients`']),
      tool('download_signed_document', 'signed documents', 'read', 'Downloads the completed document.', null, ['/documents/combined`']),
      tool('create_connect_listener', 'a status listener', 'account', 'Registers a Connect listener for envelope events.', null, ["dsFetch(env, row, '/connect', { method: 'POST'"]),
      tool('set_listener_signing_key', 'the listener’s signing key', 'account', 'Gives the listener Axal VC’s signing key.', null, ['/hmac`']),
      tool('delete_connect_listener', 'the status listener', 'account', 'Removes the listener.', null, ["`/connect/${encodeURIComponent(connectId)}`, { method: 'DELETE' }"]),
      tool('receive_envelope_events', 'envelope events', 'inbound', 'DocuSign tells Axal VC when an envelope changes.', null, ['async function webhook(']),
      tool('revoke_token', 'the sign-in', 'account', 'Revokes the DocuSign sign-in when you disconnect.', null, ['/oauth/revoke`']),
    ],
    prompts: [],
    prompts_reason: notRead('DocuSign'),
    made_by: AXAL,
    service: { name: 'DocuSign', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with DocuSign', key_help_href: null },
    endpoints: { sign_in: 'https://account.docusign.com/oauth/auth', api: null },
    added: '2026-09',
    links: { ...NO_LINKS, developer_docs: 'https://developers.docusign.com/' },
    verified_on: null,
  },
  crunchbase: {
    tagline: 'Company data from Crunchbase, with your own Basic key. Read-only.',
    long_description: [
      'Enrich projects with Crunchbase company data: funding, headcount and sector tags.',
      'Read-only, with your own Crunchbase Basic API key: Axal VC searches and looks up organizations for Market intelligence, and lists likely competitors by sector. Investor, round and people data needs Crunchbase Enterprise and is not built.',
    ],
    tools: [
      tool('search_organizations', 'organizations', 'read', 'Searches organizations by name. A one-result search also checks your key.', null,
        ["crunchbaseFetch(apiKey, '/searches/organizations'"]),
      tool('lookup_organization', 'company profiles', 'read', 'Reads one organization’s profile.', 'market_intelligence',
        ['`/entities/organizations/${encodeURIComponent(uuidOrPermalink)}`']),
      tool('find_competitors', 'likely competitors', 'read', 'Searches active organizations in the same sector.', null, ['export async function findCompetitors(']),
    ],
    prompts: [],
    prompts_reason: notRead('Crunchbase'),
    made_by: AXAL,
    service: { name: 'Crunchbase', href: null },
    sign_in: { kind: 'key', label: 'Crunchbase Basic API key', key_help_href: 'https://data.crunchbase.com/docs' },
    endpoints: { sign_in: null, api: 'https://api.crunchbase.com/api/v4' },
    added: '2026-09',
    links: { ...NO_LINKS, developer_docs: 'https://data.crunchbase.com/docs' },
    verified_on: null,
  },
  stripe: {
    tagline: 'MRR, ARR, churn and paying customers from your Stripe account. Read-only.',
    long_description: [
      'Pull live MRR, ARR, paying customers and churn from your Stripe account into Revenue and traction. Read-only.',
      'Axal VC reads your account, subscriptions and charges, and hears about changes through Stripe events. The grant is read-only, so nothing here can charge, refund or pay out.',
    ],
    tools: [
      tool('read_account', 'your account', 'read', 'Reads your Stripe account’s name and id.', null, ["'/v1/account'"]),
      tool('list_subscriptions', 'subscriptions', 'read', 'Lists active and trialing subscriptions, for MRR, ARR and churn.', 'revenue_and_traction',
        ["'/v1/subscriptions?status=active'", "'/v1/subscriptions?status=trialing'"]),
      tool('list_charges', 'charges', 'read', 'Lists your charges, for paying customers.', null, ["listAll<RawCharge>(token, '/v1/charges')"]),
      tool('receive_events', 'account events', 'inbound', 'Stripe tells Axal VC when a subscription or charge changes.', null, ['async function webhook(']),
      tool('deauthorize', 'the grant', 'account', 'Deauthorizes Axal VC’s grant when you disconnect.', null, ['`${STRIPE_CONNECT}/oauth/deauthorize`']),
    ],
    prompts: [
      { name: 'mrr_arr', ask: 'What are MRR and ARR from Stripe for this company’s projects?', proposes: null },
      { name: 'churn_customers', ask: 'What is monthly churn, and how many paying customers does <project> have?', proposes: null },
    ],
    prompts_reason: null,
    made_by: AXAL,
    service: { name: 'Stripe', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Stripe (read-only)', key_help_href: null },
    endpoints: { sign_in: 'https://connect.stripe.com/oauth/authorize', api: 'https://api.stripe.com' },
    added: '2026-05',
    links: { ...NO_LINKS, developer_docs: 'https://stripe.com/docs/connect/standard-accounts' },
    verified_on: null,
  },
  affinity: {
    tagline: 'Deal flow from Affinity’s relationship CRM. Coming soon.',
    long_description: [
      'Sync deal flow with Affinity’s relationship intelligence CRM.',
      'Axal VC has not built this connector yet. Nothing connects, and nothing is read or written.',
    ],
    tools: [],
    prompts: [],
    prompts_reason: 'Nothing to ask yet: this connector is not built.',
    made_by: AXAL,
    service: { name: 'Affinity', href: null },
    sign_in: { kind: 'key', label: 'Affinity API key', key_help_href: 'https://api-docs.affinity.co/' },
    endpoints: { sign_in: null, api: null },
    added: null,
    links: { ...NO_LINKS, developer_docs: 'https://api-docs.affinity.co/' },
    verified_on: null,
  },
  github: {
    tagline: 'Issues, pull requests and releases from the repositories you choose. Read-only.',
    long_description: [
      'Read issues, pull requests and releases from the repositories you choose. Issues link to Product roadmap items and pull requests to Prototype / MVP must-haves. Read-only.',
      'Axal VC connects as a GitHub App with read permissions only. If GitHub ever grants more than read, Axal VC revokes the grant and refuses the connection.',
    ],
    tools: [
      tool('read_installations', 'app installations', 'read', 'Lists where the Axal VC app is installed for you.', null, ["'/user/installations'"]),
      tool('list_repositories', 'repository names', 'read', 'Lists the repositories each installation can see, so you can choose.', null,
        ['`/user/installations/${id}/repositories`']),
      tool('read_account', 'your account name', 'read', 'Reads your GitHub login, when you connect.', null, ["ghJson<any>(token, '/user')"]),
      tool('read_issues', 'issues', 'read', 'Reads issues in the repositories you chose.', 'product_roadmap', ['`${path}/issues?state=all`']),
      tool('read_pull_requests', 'pull requests', 'read', 'Reads pull requests in the repositories you chose.', 'prototype_mvp', ['`${path}/pulls?state=all`']),
      tool('read_releases', 'releases', 'read', 'Reads releases in the repositories you chose. They are counted under Product roadmap; no row is made.', null,
        ['`${path}/releases`']),
      tool('revoke_grant', 'the grant', 'account', 'Revokes the grant when you disconnect, and when GitHub grants more than read.', null,
        ['`${API}/applications/${encodeURIComponent(id)}/grant`']),
    ],
    prompts: [
      { name: 'fed_by_github', ask: 'What has GitHub brought into this company’s projects?', proposes: null },
      { name: 'roadmap_from_issues', ask: 'How many GitHub issues became roadmap items for <project>?', proposes: null },
    ],
    prompts_reason: null,
    made_by: AXAL,
    service: { name: 'GitHub', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with GitHub and choose repositories', key_help_href: null },
    endpoints: { sign_in: 'https://github.com/login/oauth/authorize', api: 'https://api.github.com' },
    added: '2026-10',
    links: { ...NO_LINKS, developer_docs: 'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app' },
    verified_on: null,
  },
  zoom: {
    tagline: 'Interview calls on your own Zoom, and their cloud transcripts.',
    long_description: [
      'Schedule a Zoom call from a Validate interview on your own Zoom account. When the call’s cloud transcript is ready, it is imported into the interview.',
      'Axal VC creates a meeting only when you schedule an interview call, and deletes it when you cancel. It reads a meeting’s recordings only to download its transcript into Customer research.',
      'When you disconnect, Axal VC revokes its Zoom grant.',
    ],
    tools: [
      tool('read_user', 'your Zoom user', 'read', 'Reads your Zoom user id, to tell your grant apart.', null, ['`${ZOOM_API}/users/me`', "zoomApi(env, conn, '/users/me')"]),
      tool('create_meeting', 'interview meetings', 'write', 'Creates a meeting, when you schedule an interview call.', null, ["zoomApi(env, conn, '/users/me/meetings', {"]),
      tool('delete_meeting', 'interview meetings', 'write', 'Deletes that meeting, when you cancel its interview call.', null, ["`/meetings/${externalRef}`, { method: 'DELETE' }"]),
      tool('read_meeting', 'a pasted meeting', 'read', 'Reads a meeting you paste, to confirm you host it.', null, ['zoomApi(env, conn, `/meetings/${meetingId}`)']),
      tool('list_recordings', 'cloud recordings', 'read', 'Lists a meeting’s recording files, to find its transcript.', null, ['/recordings`']),
      tool('download_transcript', 'transcripts', 'read', 'Downloads the transcript into the interview.', 'customer_research', ['async function downloadTranscript(']),
      tool('list_past_instances', 'past instances', 'read', 'Lists a meeting’s past instances, to recover a restarted call.', null,
        ['`/past_meetings/${meetingPathId(meetingId)}/instances`']),
      tool('receive_events', 'meeting events', 'inbound', 'Zoom tells Axal VC when a transcript is ready or the app is removed.', null, ['export async function handleZoomWebhook(']),
      tool('revoke_grant', 'the grant', 'account', 'Revokes the Zoom grant when you disconnect.', null, ['`${ZOOM_AUTH}/oauth/revoke`']),
    ],
    prompts: [],
    prompts_reason: notRead('Zoom'),
    made_by: AXAL,
    service: { name: 'Zoom', href: null },
    sign_in: { kind: 'oauth', label: 'Sign in with Zoom', key_help_href: null },
    endpoints: { sign_in: 'https://zoom.us/oauth/authorize', api: 'https://api.zoom.us/v2' },
    added: '2026-10',
    links: { ...NO_LINKS, developer_docs: 'https://developers.zoom.us/docs/integrations/oauth/' },
    verified_on: null,
  },
  google_calendar: {
    tagline: 'Your Google Calendar events and interview slots, and sign-in with Google.',
    long_description: [
      'Calendar events and interview slots from your Google sign-in.',
      'Axal VC adds, updates and removes the events it schedules on your primary calendar, including Google Meet interview calls. It reads your events, and the Meet transcripts you allow, into Customer research.',
      'At sign-in, Google also asks for permission to read Gmail. Axal VC does not read your Gmail.',
    ],
    tools: [
      tool('read_profile', 'your profile', 'read', 'Reads your email address and name, when you sign in.', null, ['fetchWithTimeout(GOOGLE_USERINFO_URL']),
      tool('create_event', 'calendar events', 'write', 'Adds an event to your primary calendar, when you schedule one.', null, ['`${GOOGLE_CALENDAR_API}/calendars/primary/events`,']),
      tool('update_event', 'calendar events', 'write', 'Updates an event Axal VC added, when you change it.', null, ['`${GOOGLE_CALENDAR_API}/calendars/primary/events/${googleEventId}`']),
      tool('delete_event', 'calendar events', 'write', 'Removes an event Axal VC added, when you cancel it.', null, ['export async function deleteEventFromGoogle(']),
      tool('create_meet_event', 'Meet interview calls', 'write', 'Adds an interview call with a Google Meet link, when you schedule one.', null,
        ["'/calendars/primary/events?conferenceDataVersion=1'"]),
      tool('list_events', 'calendar events', 'read', 'Reads events on your primary calendar.', 'customer_research',
        ['calendarFetch(token, `/calendars/primary/events?${q}`)', 'calendarFetch(token, `/calendars/primary/events/${eventId}`)']),
      tool('read_meet_transcripts', 'Meet transcripts', 'read', 'Reads a Meet call’s transcript, when you have allowed it.', 'customer_research', ['fetch(`${MEET_API}${path}`']),
    ],
    prompts: [],
    prompts_reason: notRead('Google Calendar'),
    made_by: AXAL,
    service: { name: 'Google', href: null },
    sign_in: { kind: 'first_party', label: 'Sign in with Google', key_help_href: null },
    endpoints: { sign_in: 'https://accounts.google.com/o/oauth2/v2/auth', api: 'https://www.googleapis.com/calendar/v3' },
    added: '2026-10',
    links: { ...NO_LINKS, developer_docs: null },
    verified_on: null,
  },
  microsoft_365: {
    tagline: 'Your Outlook calendar events and interview slots.',
    long_description: [
      'Calendar events and interview slots from your Microsoft sign-in.',
      'Axal VC adds, updates and removes the events it schedules on your Outlook calendar, and reads your profile to confirm who you are.',
    ],
    tools: [
      tool('read_profile', 'your profile', 'read', 'Reads your email address and name, when you sign in.', null, ['`${MICROSOFT_GRAPH}/me`, {']),
      tool('create_event', 'calendar events', 'write', 'Adds an event to your calendar, when you schedule one.', null, ['`${MICROSOFT_GRAPH}/me/events`,']),
      tool('update_event', 'calendar events', 'write', 'Updates an event Axal VC added, when you change it.', null, ['`${MICROSOFT_GRAPH}/me/events/${eventId}`']),
      tool('delete_event', 'calendar events', 'write', 'Removes an event Axal VC added, when you cancel it.', null, ['export async function deleteEventFromMicrosoft(']),
    ],
    prompts: [],
    prompts_reason: notRead('Microsoft 365'),
    made_by: AXAL,
    service: { name: 'Microsoft', href: 'https://www.microsoft.com/microsoft-365' },
    sign_in: { kind: 'first_party', label: 'Sign in with Microsoft', key_help_href: null },
    endpoints: { sign_in: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', api: 'https://graph.microsoft.com/v1.0' },
    added: '2026-10',
    links: { ...NO_LINKS, developer_docs: null },
    verified_on: null,
  },
  mercury: {
    entity: mercuryPage('entity'),
    personal: { founder: mercuryPage('founder'), partner: mercuryPage('partner') },
  },
};

/** Connectors with a page but no registry row (D753 decision 2). */
export const FIRST_PARTY_PAGES: { linkedin: ConnectorPage } = {
  linkedin: {
    tagline: 'Sign in with LinkedIn to confirm who you are. Connections come by CSV.',
    long_description: [
      'Sign in with LinkedIn to confirm who you are.',
      'Axal VC reads your LinkedIn identity once, at sign-in, and then discards the token. LinkedIn offers no API for your connections, so they come by CSV import.',
    ],
    tools: [
      tool('read_identity', 'your identity', 'read', 'Reads your name and email address, once, at sign-in.', null, ['fetch(LINKEDIN_USERINFO_URL']),
    ],
    prompts: [],
    prompts_reason: notRead('LinkedIn'),
    made_by: AXAL,
    service: { name: 'LinkedIn', href: null },
    sign_in: { kind: 'first_party', label: 'Sign in with LinkedIn', key_help_href: null },
    endpoints: { sign_in: 'https://www.linkedin.com/oauth/v2/authorization', api: 'https://api.linkedin.com/v2/userinfo' },
    added: '2026-05',
    links: { ...NO_LINKS, developer_docs: null },
    verified_on: null,
  },
};

/** The Discover order (D753 decision 13): the Connectors page's list, then Payroll. Every `ConnectorCategory` once. */
export const CATEGORY_ORDER: readonly ConnectorCategory[] = Object.freeze([
  'CRM', 'Payments', 'Accounting and banking', 'Calendar', 'Calendar and workspace', 'Messaging', 'Signing', 'Cap table', 'Data', 'Code', 'Design', 'Docs', 'Payroll',
] as const);

/** A page key to its registry key; the inverse of the frontend's `REGISTRY_ALIAS`. */
export const PAGE_ALIAS = Object.freeze({ google: 'google_calendar', microsoft: 'microsoft_365' } as const);

/** Connectors that can move money. None can. */
export const MONEY_MOVERS: ReadonlySet<string> = new Set<string>();

export interface Trust {
  built_by: 'Axal VC';
  reads: string[];
  writes: string[];
  read_only: boolean;
  moves_money: boolean;
  sentence: string;
}

const isVariant = (e: ConnectorPage | VariantPages | undefined): e is VariantPages => !!e && 'entity' in e && 'personal' in e;

/** The page for a key (registry or page key) and an optional Mercury variant: `entity` or a role. */
function pageFor(key: string, variant?: string): ConnectorPage | null {
  const k = Object.hasOwn(PAGE_ALIAS, key) ? PAGE_ALIAS[key as keyof typeof PAGE_ALIAS] : key;
  if (k === 'linkedin') return FIRST_PARTY_PAGES.linkedin;
  if (!Object.hasOwn(CONNECTOR_PAGES, k)) return null;
  const entry = CONNECTOR_PAGES[k];
  if (!isVariant(entry)) return entry;
  if (variant === 'entity') return entry.entity;
  return variant && Object.hasOwn(entry.personal, variant) ? entry.personal[variant] : null;
}

/** "a", "a and b", "a, b and c". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const unique = (items: string[]) => [...new Set(items)];

/** The trust notice (D753 decision 5), from the page's tools. */
export function trustFor(key: string, variant?: 'entity' | string): Trust | null {
  const page = pageFor(key, variant);
  if (!page) return null;
  const k = Object.hasOwn(PAGE_ALIAS, key) ? PAGE_ALIAS[key as keyof typeof PAGE_ALIAS] : key;
  const service = page.service.name;
  const reads = unique(page.tools.filter((t) => t.access === 'read').map((t) => t.label));
  const writes = unique(page.tools.filter((t) => t.access === 'write').map((t) => t.label));
  const readOnly = writes.length === 0;
  const movesMoney = MONEY_MOVERS.has(k);
  const comingSoon = /Coming soon\.$/.test(page.tagline);
  const parts: string[] = [];
  if (comingSoon && page.tools.length === 0) {
    parts.push('Axal VC has not built this connector yet, so it reads and writes nothing.');
  } else {
    if (comingSoon) parts.push('New connections are paused.');
    parts.push('Axal VC built and runs this connector.');
    parts.push(reads.length ? `It reads ${listWords(reads)} from ${service}.` : `It reads nothing from ${service}.`);
    parts.push(readOnly ? `It never writes to ${service}.` : `It writes to ${service}: ${listWords(writes)}. Each tool below says when.`);
  }
  if (!movesMoney) parts.push('Nothing it does can move money.');
  return { built_by: 'Axal VC', reads, writes, read_only: readOnly, moves_money: movesMoney, sentence: parts.join(' ') };
}

/** The same pattern as `CONNECTOR_KEY_RE` (`services/eadwynConnectors.ts`); the test holds them equal. */
const PAGE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const HUB = '/account/connectors';

/** A connector's page path, from a registry key or a page key; the hub for anything unknown. */
export function connectorPagePath(key: string): string {
  if (typeof key !== 'string' || !PAGE_KEY_RE.test(key)) return HUB;
  const pageKey = key === PAGE_ALIAS.google ? 'google' : key === PAGE_ALIAS.microsoft ? 'microsoft' : key;
  const known = Object.hasOwn(PAGE_ALIAS, pageKey) || pageKey === 'linkedin' || Object.hasOwn(CONNECTOR_PAGES, pageKey);
  return known ? `${HUB}/${pageKey}` : HUB;
}

export type PageDescriptor = ConnectorPage & { key: string; page_key: string; page_href: string; trust: Trust };

/**
 * One connector's page for this viewer, or null. Mercury's variant follows
 * `audienceFor` (D753 decision 15): an admin on HQ gets `entity`, a founder or
 * partner their `personal` role, anyone else null. It does not merge
 * `publicDescriptor`; the route's `catalogueEntry` (#1878) joins the two.
 */
export function pageDescriptor(p: { key: string } & Partial<ProviderDescriptor>, viewer?: DescriptorViewer): PageDescriptor | null {
  const key = p?.key;
  if (typeof key !== 'string') return null;
  let page: ConnectorPage | null = null;
  if (key === 'linkedin') {
    page = FIRST_PARTY_PAGES.linkedin;
  } else if (Object.hasOwn(CONNECTOR_PAGES, key)) {
    const entry = CONNECTOR_PAGES[key];
    const audience = viewer && (p.entity_roles || p.personal_roles) ? audienceFor(p as ProviderDescriptor, viewer) : 'open';
    if (audience === 'none') return null;
    if (isVariant(entry)) {
      if (audience === 'entity') page = entry.entity;
      else if (audience === 'personal') page = pageFor(key, String(viewer?.role || '').toLowerCase());
    } else {
      page = entry;
    }
  }
  if (!page) return null;
  const variant = isVariant(CONNECTOR_PAGES[key]) ? (page === (CONNECTOR_PAGES[key] as VariantPages).entity ? 'entity' : String(viewer?.role || '').toLowerCase()) : undefined;
  const page_href = connectorPagePath(key);
  return {
    ...page,
    key,
    page_key: page_href.slice(HUB.length + 1) || key,
    page_href,
    trust: trustFor(key, variant)!,
  };
}
