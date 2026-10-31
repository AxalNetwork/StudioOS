/**
 * D847 (#2468, #2404 part 1) — one frozen record per MCP provider: what the
 * shared client (`mcpClient.ts`) may do with a member's sign-in.
 *
 * A record is the whole of a provider's MCP surface. The client reads nothing
 * else: the server URLs it may POST to, the hosts every discovered endpoint
 * must sit on, the scopes it asks for and accepts, the tools it may call, how
 * it registers, and the request budget. Nothing a server says can add to it:
 * a listed tool off `read_tools` is ignored, a grant wider than
 * `accepted_scopes` is refused and revoked, and an endpoint off `hosts` is
 * never fetched.
 *
 * THREE LOCKS ON WRITES. `write_tools` is empty unless `publish_issue` names
 * the provider issue that asked for publishing (`mcp_client_d847.test.ts`
 * holds every record to that); a write tool is callable only with #2400's
 * ticket, which does not exist yet, so the session refuses every write tool
 * before any request; and a read tool the server annotates as not read-only
 * or destructive is refused. Annotations can only narrow the list.
 *
 * A NARROWER LOCK FOR SETUP (D856, #2501). `setup_tools` is empty unless
 * `setup_issue` names the provider issue that asked for a guided setup. A
 * setup tool changes the member's own account at the provider (register a
 * number, subscribe a webhook, create a template), so it is callable only
 * with a one-time setup ticket (`mintMcpSetupTicket`), which the setup route
 * mints after the member confirms that one step, for that provider and that
 * step's tools alone, each once. A setup tool the server annotates as
 * destructive is refused. The write lock above stays as it is, and #2400's
 * publish ticket stays a separate thing.
 *
 * THE SESSION (D847 decision 3). `per_request`: a session lives for one
 * Worker request. A `legacy` server's `Mcp-Session-Id` is kept in memory for
 * that request only and the server expires it; a `modern` server
 * (`2026-07-28`) is stateless and has none. No provider holds a session in
 * D1 or a Durable Object. A provider whose server needs a session across
 * requests must change this type and D847 first.
 *
 * TOOL PINS (D847 decision 4). `tool_pins` maps each allowlisted tool to the
 * fingerprint of the schema that was reviewed (`toolFingerprint`). A listed
 * tool whose schema differs is not offered and is logged as `mcp_tool_drift`.
 * `null` means the provider's schemas have not been read from a live server
 * yet; its first live sign-in records them.
 *
 * SPENT LIMITS (D855 §4, #3733). `rate_limit_headers` names the response
 * headers a provider uses to say a grant's budget is gone (Linear's
 * remaining-requests and remaining-complexity counters). An answer that is
 * not a success and reads `0` in any of them is `rate_limited`, whatever its
 * status, so a spent complexity budget is not mistaken for a bad request.
 *
 * This file imports types only, and names no provider's write tool.
 */

export type McpEra = 'auto' | 'legacy' | 'modern';
export type McpRegistration = 'preregistered' | 'cimd' | 'dcr';

export interface McpProvider {
  /** The registry key (`integrations.provider_key`). */
  readonly key: string;
  /** The MCP server URLs; `[0]` is the default. */
  readonly resources: readonly string[];
  /** Host suffixes every discovered endpoint must sit on (https, no userinfo, no port). */
  readonly hosts: readonly string[];
  /** The scopes a sign-in asks for: least privilege, named in the provider issue. */
  readonly scopes: readonly string[];
  /** A grant reporting any scope off this list is refused and revoked. */
  readonly accepted_scopes: readonly string[];
  /** The tools Axal VC may call; each has a typed read in that provider's `reads.ts`. */
  readonly read_tools: readonly string[];
  /** Empty unless `publish_issue` is set; callable only with #2400's ticket. */
  readonly write_tools: readonly string[];
  /** The provider issue that asked for publishing, or null. */
  readonly publish_issue: number | null;
  /** D856: tools that change the member's own account at the provider, each callable once per setup ticket. Empty unless `setup_issue` is set. */
  readonly setup_tools?: readonly string[];
  /** D856: the provider issue that asked for a guided setup, or null. */
  readonly setup_issue?: number | null;
  /** Tried in this order. */
  readonly registration: readonly McpRegistration[];
  /** The client ID metadata document's https URL on axal.vc, or null when none is published. */
  readonly cimd_url: string | null;
  readonly era: McpEra;
  /** POSTs per session, the era probe and the handshake included. */
  readonly budget: number;
  /** Fixed request headers, from this record only. */
  readonly headers: Readonly<Record<string, string>>;
  /** D855 §4: headers whose `0` on a failed answer means the grant's limit is spent (`rate_limited`). */
  readonly rate_limit_headers?: readonly string[];
  readonly session: 'per_request';
  readonly tool_pins: Readonly<Record<string, string>> | null;
  /** `acquireRefreshLease`'s provider name. */
  readonly lease: string;
  /** `oauth_state_tokens.provider` for this provider's sign-in. */
  readonly state_provider: string;
  /** The `platform_settings` key prefix of a DCR registration (then the redirect URI). */
  readonly client_key_prefix: string;
  /** The callback path registered with the provider. */
  readonly callback_path: string;
}

/** A record, frozen to its arrays and maps. */
export function mcpProvider(p: McpProvider): McpProvider {
  const list = (v: readonly string[]) => Object.freeze([...v]);
  return Object.freeze({
    ...p,
    resources: list(p.resources),
    hosts: list(p.hosts),
    scopes: list(p.scopes),
    accepted_scopes: list(p.accepted_scopes),
    read_tools: list(p.read_tools),
    write_tools: list(p.write_tools),
    setup_tools: list(p.setup_tools ?? []),
    setup_issue: p.setup_issue ?? null,
    registration: Object.freeze([...p.registration]),
    headers: Object.freeze({ ...p.headers }),
    rate_limit_headers: list(p.rate_limit_headers ?? []),
    tool_pins: p.tool_pins ? Object.freeze({ ...p.tool_pins }) : null,
  });
}

/**
 * D840's Mercury, on its legacy names so live rows keep working: the lease
 * and state provider `mercury_mcp`, the DCR key prefix `mercury_mcp_client:`
 * and the callback path registered with Mercury. Its era stays `legacy`
 * until a live sign-in confirms what the server speaks (D840.md).
 * `services/mercury/mcp.ts` re-exports `read_tools` as `MERCURY_READ_TOOLS`.
 */
const MERCURY = mcpProvider({
  key: 'mercury',
  resources: ['https://mcp.mercury.com/mcp'],
  hosts: ['mercury.com'],
  scopes: ['read', 'offline_access'],
  accepted_scopes: ['read', 'offline_access'],
  read_tools: [
    'getOrganization',
    'getAccounts',
    'getAccount',
    'listTransactions',
    'getTransactionById',
    'getCashflowSummary',
    'getTreasury',
    'getAccountStatements',
    'listInvoices',
    'listCustomers',
    'getRecipients',
    'getSafeRequests',
    'listCategories',
  ],
  write_tools: [],
  publish_issue: null,
  registration: ['dcr'],
  cimd_url: null,
  era: 'legacy',
  budget: 24,
  headers: {},
  session: 'per_request',
  tool_pins: null,
  lease: 'mercury_mcp',
  state_provider: 'mercury_mcp',
  client_key_prefix: 'mercury_mcp_client:',
  callback_path: '/api/integrations/mercury/oauth/callback',
});

/**
 * D1085 (#2950, #2405 part 1): Notion's hosted MCP server. Notion's own grant
 * reads and writes, so READ-ONLY IS THIS RECORD: `read_tools` is the three
 * tools `services/notion/reads.ts` calls, `write_tools` is empty, and the
 * session refuses every other name before a request. It signs in through the
 * generic routes (D1080): a client ID metadata document published here, else
 * DCR, whichever the server's metadata offers at start.
 *
 * SCOPES: none asked for, none accepted. Notion's MCP documentation names no
 * OAuth scope, so the authorize URL and the registration carry none, and a
 * grant that reports any scope is refused and revoked until a live sign-in
 * shows what Notion reports (UNVERIFIED, D1085.md §6). The era, the tools'
 * schemas (`tool_pins`) and each tool's arguments wait for that sign-in too.
 */
const NOTION = mcpProvider({
  key: 'notion',
  resources: ['https://mcp.notion.com/mcp'],
  hosts: ['notion.com'],
  scopes: [],
  accepted_scopes: [],
  read_tools: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
  write_tools: [],
  publish_issue: null,
  registration: ['cimd', 'dcr'],
  cimd_url: 'https://axal.vc/api/integrations/mcp/notion/client.json',
  era: 'auto',
  budget: 16,
  headers: {},
  session: 'per_request',
  tool_pins: null,
  lease: 'mcp:notion',
  state_provider: 'mcp_notion',
  client_key_prefix: 'mcp_client:notion:',
  callback_path: '/api/integrations/mcp/notion/callback',
});

/**
 * D856 (#2501, #2500): Meta's WhatsApp Business Tools MCP, for the guided
 * setup only (`services/channels/whatsappSetup.ts`). Conversations keep
 * arriving by the Cloud API webhook (D684); no tool here reads one.
 *
 * EVERY META FACT HERE IS UNVERIFIED (D856.md §1). Meta's page did not resolve
 * from the build environment, so the server URL, the scopes and the tool
 * names come from search coverage, read 2026-10-22, and wait for the first
 * live sign-in:
 * - `read_tools` are the setup's reads: the prerequisites, the account's
 *   numbers and its templates.
 * - `setup_tools` register a number, subscribe Axal's app to the account, and
 *   create the consent-notice template. Each is called only with the
 *   founder's one-time ticket for that step.
 * - No message-sending tool is listed, the test message included, and no
 *   tool that creates an account or adds a number: Meta's OTP stays in
 *   Meta's own flow.
 * - `write_tools` is empty, as every record's is without #2400.
 */
const WHATSAPP_BUSINESS = mcpProvider({
  key: 'whatsapp_business',
  resources: ['https://mcp.facebook.com/whatsapp_business_tools'],
  hosts: ['facebook.com'],
  scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
  accepted_scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
  read_tools: ['check_prerequisites', 'list_phone_numbers', 'list_message_templates'],
  write_tools: [],
  publish_issue: null,
  setup_tools: ['register_phone_number', 'subscribe_app', 'create_message_template'],
  setup_issue: 2501,
  registration: ['dcr'],
  cimd_url: null,
  era: 'auto',
  budget: 12,
  headers: {},
  session: 'per_request',
  tool_pins: null,
  lease: 'mcp:whatsapp_business',
  state_provider: 'mcp_whatsapp_business',
  client_key_prefix: 'mcp_client:whatsapp_business:',
  callback_path: '/api/integrations/mcp/whatsapp_business/callback',
});

/**
 * D855 §4 row 2 (#3733 part 1): a member's own Linear, READ-ONLY THREE TIMES
 * OVER. Linear's `/readonly` server exposes no write tool; the grant is `read`
 * alone, and a token so granted cannot reach Linear's write API; and this
 * record lists six read tools and no write tool, so the session refuses any
 * other name before a request. Any of the three alone would hold.
 *
 * It signs in through the generic routes (D1080) by dynamic client
 * registration, which Linear's server offers (D855 §3.5). Linear's complexity
 * budget answers with its remaining counters at `0`, which the client reads as
 * `rate_limited` (`rate_limit_headers`).
 *
 * UNVERIFIED until the first live sign-in (D855.md §7): linear.app did not
 * resolve from the build environment on 2026-10-31, so the tool names and
 * their arguments come from D855's sources and search coverage read that day.
 * Linear's write tools are absent by design; the schemas
 * (`tool_pins`) and the era wait for that sign-in.
 */
const LINEAR = mcpProvider({
  key: 'linear',
  resources: ['https://mcp.linear.app/mcp/readonly'],
  hosts: ['linear.app'],
  scopes: ['read'],
  accepted_scopes: ['read'],
  read_tools: ['list_issues', 'get_issue', 'list_comments', 'list_projects', 'get_project', 'list_teams'],
  write_tools: [],
  publish_issue: null,
  registration: ['dcr'],
  cimd_url: null,
  era: 'auto',
  budget: 16,
  headers: {},
  rate_limit_headers: ['X-RateLimit-Requests-Remaining', 'X-RateLimit-Complexity-Remaining'],
  session: 'per_request',
  tool_pins: null,
  lease: 'mcp:linear',
  state_provider: 'mcp_linear',
  client_key_prefix: 'mcp_client:linear:',
  callback_path: '/api/integrations/mcp/linear/callback',
});

/** Every MCP provider, Mercury first. */
export const MCP_PROVIDERS: Readonly<Record<string, McpProvider>> = Object.freeze({
  mercury: MERCURY,
  notion: NOTION,
  whatsapp_business: WHATSAPP_BUSINESS,
  linear: LINEAR,
});

export function mcpProviderFor(key: string): McpProvider | null {
  return Object.hasOwn(MCP_PROVIDERS, key) ? MCP_PROVIDERS[key] : null;
}
