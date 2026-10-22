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
  /** Tried in this order. */
  readonly registration: readonly McpRegistration[];
  /** The client ID metadata document's https URL on axal.vc, or null when none is published. */
  readonly cimd_url: string | null;
  readonly era: McpEra;
  /** POSTs per session, the era probe and the handshake included. */
  readonly budget: number;
  /** Fixed request headers, from this record only. */
  readonly headers: Readonly<Record<string, string>>;
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
    registration: Object.freeze([...p.registration]),
    headers: Object.freeze({ ...p.headers }),
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

/** Every MCP provider, Mercury first. */
export const MCP_PROVIDERS: Readonly<Record<string, McpProvider>> = Object.freeze({
  mercury: MERCURY,
});

export function mcpProviderFor(key: string): McpProvider | null {
  return Object.hasOwn(MCP_PROVIDERS, key) ? MCP_PROVIDERS[key] : null;
}
