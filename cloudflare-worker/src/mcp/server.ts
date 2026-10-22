/**
 * D666 (#1496) — the StudioOS MCP server: a stateless Streamable HTTP server
 * (`@modelcontextprotocol/sdk`'s web-standard transport, one server per
 * request) behind the OAuth provider in `oauth.ts`, and the tool registry
 * #1497 adds the interview tools to.
 *
 * WHY NOT `agents`' createMcpHandler, which #1495 named: every published
 * `agents` release pins `@modelcontextprotocol/sdk` 1.30.0, inside
 * GHSA-6qxp-vccf-f47h's range (<1.31.0), so the worker's npm audit would go
 * red. createMcpHandler is this same transport in stateless mode; using the
 * patched SDK directly keeps the audit green and drops `agents`' tree. The
 * SDK validates tool input with @cfworker/json-schema, because its default
 * (ajv) compiles code with `new Function`, which Workers refuse.
 *
 * EVERY TOOL CALL, before its handler runs:
 *   - the grant's user is re-read (`grantUser`): an ended account, a deletion
 *     request or a later "sign out everywhere" refuses the call;
 *   - a tool that takes a company re-checks it (`grantCompany`): in the grant,
 *     and still writable by the user;
 *   - the grant's per-minute limit is counted;
 *   - one activity_logs line is written: tool, company, client, outcome.
 *     Never the arguments, never the result.
 *   - D843 (#2465): one `api_usage_events` row is written for every outcome,
 *     with an execution id, the duration and an error category, and the
 *     result's `_meta.execution_id` hands that id to the client.
 * A refusal is an error result in plain words, never an exception's text.
 *
 * D846 (#2467) — ONE REGISTRY, LISTED PER MEMBER. Every tool carries where it
 * comes from (`source`, with its `provider` registry key), a semver `version`
 * reported in `_meta`, an optional plan (`entitlement`) and whether it needs
 * its provider connected (`requiresConnection`). `createServer` registers
 * only the tools this principal may use: the token's scope covers the tool,
 * the plan is met, and the provider is connected and switched on for at least
 * one granted company. A tool left out answers a call by name exactly as an
 * unknown name does (`NOT_AVAILABLE`). Listing is not authorization: `callTool`
 * asks all of it again on every call. A tool's name is stable; a breaking
 * change registers `<name>_v2` beside it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { Env, User } from '../types';
import type { SCOPES } from './oauth';
import { userMeetsTier, type Tier } from '../middleware/requireTier';
import { METERING_POLICY, MeteringRefused, listed, meteredCall, quoteFor, toolOperation, type MeteringPolicy } from '../services/metering';
import {
  ToolRefused, grantCompany, grantIdOf, grantUser, lastUsedKey, logToolCall, withinGrantLimit, type GrantProps, type ToolOutcome,
} from './grants';
import { newExecutionId, recordUsage, type UsageErrorCategory } from '../services/apiUsage';
import { budgetRefusalMessage } from '../services/aiRouter';

export interface ToolRun {
  env: Env;
  props: GrantProps;
  user: Awaited<ReturnType<typeof grantUser>>;
  /** The granted companies the user can still write to. */
  companies: Array<{ id: number; name: string }>;
  /** The checked company, when the tool takes one. */
  company: { id: number; name: string } | null;
  args: Record<string, unknown>;
  /** D846: for a tool that needs its provider, the granted company ids it is connected and switched on for. */
  connected: number[];
  /** D842 (#2470): this call's id, in its result's `_meta` and its activity line; #2465 records it, #2466 keys its hold on it. */
  executionId: string;
  /** D842: aborted when the call times out; a tool that holds AI tokens releases them on it (#2466). */
  signal: AbortSignal;
}

export type ToolScope = (typeof SCOPES)[number];
/** D846: where a tool's answer comes from. `connector` reads StudioOS's records of a connection, never the provider live (D713). */
export type ToolSource = 'axal' | 'connector' | 'remote_mcp';

export interface McpTool {
  name: string;
  requiredScope: ToolScope;
  source: ToolSource;
  /** A key in the connector registry (`integrations/registry.ts`), for a connector or remote tool. */
  provider?: string;
  /** Semver, reported in `_meta`. A breaking change registers `<name>_v2` instead of changing this tool. */
  version: string;
  /** The founder plan the tool needs (`userMeetsTier`); none means every plan. */
  entitlement?: Tier;
  /** True when the tool is listed only while `provider` is connected and switched on for a granted company. */
  requiresConnection?: boolean;
  title: string;
  description: string;
  /** A zod raw shape; the SDK turns it into the tool's JSON schema. */
  inputSchema: Record<string, any>;
  /** True when the tool takes a `company` argument that must be checked against the grant. */
  company: boolean;
  /** Read-only tools are annotated so; a write tool (#1497) sets false. */
  readOnly?: boolean;
  /** D842: how long a call may run before it answers `timeout`; `TOOL_TIMEOUT_MS` when unset. */
  timeoutMs?: number;
  run: (r: ToolRun) => Promise<unknown>;
}

/** D842 (#2470): a tool call's default time limit. */
export const TOOL_TIMEOUT_MS = 20_000;

/** D842: the `_meta` key a call's execution id is reported under, on every result. */
export const EXECUTION_META = 'vc.axal/execution_id';

/** Where a member adds AI tokens (D786), for the `insufficient_tokens` body. */
export const ADD_TOKENS_HREF = '/pricing/products#token-packs';

/**
 * D842: a tool's own refusal code as `/mcp` names it (plan §3, with #2466's
 * codes). A member out of AI tokens is `insufficient_tokens`, with the body
 * #2466 defines: what was needed and what was available are unknown until
 * #2466's hold reports them, so they are null, never 0. A cap the member set
 * keeps its own code; an outage on our side is `unavailable`.
 */
export function mcpCode(code: string): string {
  if (code === 'budget_user_day' || code === 'budget_user_month') return 'insufficient_tokens';
  if (code === 'budget_org_month' || code === 'kill_switch') return 'unavailable';
  return code;
}

/** D842: the structured error result every refusal answers with: a sentence, a code, and the call's id. */
export function errorResult(sentence: string, code: string, executionId: string | null, extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { error: sentence, code, ...extra };
  if (code === 'insufficient_tokens') Object.assign(body, { needed_microusd: null, available_microusd: null, add_tokens_href: ADD_TOKENS_HREF });
  return text(body, true, executionId ?? undefined);
}

class ToolTimeout extends Error {}

/** Run `work` with a time limit: past it the signal aborts and the call answers `timeout`. */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    // Reject before aborting, so a tool that answers on the abort cannot win the race.
    timer = setTimeout(() => { reject(new ToolTimeout()); controller.abort(); }, ms);
  });
  try { return await Promise.race([work(controller.signal), expired]); } finally { clearTimeout(timer); }
}

const REGISTRY: McpTool[] = [];

/** Add tools to the server. The read tools register here; #1497 adds the interview tools. */
export function registerMcpTools(tools: McpTool[]) {
  for (const t of tools) if (!REGISTRY.some((x) => x.name === t.name)) REGISTRY.push(t);
}
export const registeredTools = () => [...REGISTRY];

const text = (value: unknown, isError = false, executionId?: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
  ...(executionId ? { _meta: { execution_id: executionId, [EXECUTION_META]: executionId } } : {}),
});

/**
 * D843 — where a call stopped, for its error category: the account check,
 * the scope check, the company check, or the tool itself.
 */
type CallStage = 'auth' | 'scope' | 'company' | 'run';

/** A ToolError's category, from its HTTP-like status. */
function toolErrorCategory(status: number): UsageErrorCategory {
  if (status === 401) return 'auth';
  if (status === 402) return 'scope';
  if (status === 403 || status === 404) return 'company';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal';
  return 'invalid_input';
}

/** What a tool this connection may not use answers, word for word what an unknown name answers. */
export const NOT_AVAILABLE = 'That tool is not available on this connection.';
/** The `_meta` keys a tool's listing and results carry. */
export const META = { version: 'vc.axal/version', source: 'vc.axal/source' } as const;
const toolMeta = (tool: McpTool) => ({ [META.version]: tool.version, [META.source]: tool.source });

/** The plan check, on the user's stored subscription. A read that fails denies. */
export async function toolEntitled(env: Env, user: { id: number; role: string | null }, tier: Tier | undefined): Promise<boolean> {
  if (!tier) return true;
  try {
    const sub = await env.DB.prepare('SELECT subscription_tier, subscription_status, subscription_renews_at FROM users WHERE id = ?')
      .bind(user.id).first<Record<string, string | null>>();
    return !!sub && userMeetsTier({ ...sub, id: user.id, role: user.role } as unknown as User, tier);
  } catch { return false; }
}

/**
 * The granted company ids (projects.id) for which the user's own `provider`
 * connection is active and switched on for the project's company (D713:
 * personal unless switched on). A read that fails connects nothing.
 */
export async function connectedCompanies(env: Env, userId: number, provider: string | undefined, companyIds: number[]): Promise<number[]> {
  if (!provider || !companyIds.length) return [];
  try {
    const r = await env.DB.prepare(
      'SELECT DISTINCT p.id AS id FROM integrations i ' +
      'JOIN integration_companies ic ON ic.integration_id = i.id AND ic.enabled = 1 ' +
      'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
      'JOIN projects p ON p.company_id = ic.company_id AND p.deleted_at IS NULL ' +
      "WHERE i.user_id = ? AND i.provider_key = ? AND i.status = 'active' AND p.id IN (SELECT value FROM json_each(?)) ORDER BY p.id",
    ).bind(userId, provider, JSON.stringify(companyIds)).all<{ id: number }>();
    return (r.results || []).map((row) => Number(row.id));
  } catch { return []; }
}

/** Whether the principal may use the tool: its scope, its plan and, when it needs one, its connection. */
export async function toolAvailable(env: Env, user: { id: number; role: string | null }, scope: readonly string[], companyIds: number[], tool: McpTool): Promise<boolean> {
  if (!scope.some((granted) => granted === tool.requiredScope)) return false;
  if (!(await toolEntitled(env, user, tool.entitlement))) return false;
  if (tool.requiresConnection && !(await connectedCompanies(env, user.id, tool.provider, companyIds)).length) return false;
  return true;
}

/** The granted companies the user can still read. */
async function liveCompanies(env: Env, props: GrantProps, user: Awaited<ReturnType<typeof grantUser>>) {
  return (await Promise.all(props.companies.map(async (id) => {
    try { return await grantCompany(env, props, user, id); } catch { return null; }
  }))).filter((c): c is { id: number; name: string } => c !== null);
}

/** The tools this principal is listed, or, when the grant no longer stands, none and the sentence why. */
export async function listedTools(env: Env, props: GrantProps, scope: readonly string[]): Promise<{ tools: McpTool[]; refusal: string | null }> {
  let principal: Awaited<ReturnType<typeof grantUser>>;
  try { principal = await grantUser(env, props); } catch (e) {
    if (e instanceof ToolRefused) return { tools: [], refusal: e.sentence };
    throw e;
  }
  const ids = (await liveCompanies(env, props, principal)).map((c) => c.id);
  const ok = await Promise.all(REGISTRY.map((t) => toolAvailable(env, principal, scope, ids, t)));
  return { tools: REGISTRY.filter((_, i) => ok[i]), refusal: null };
}

/**
 * Run one tool call under the grant's checks. Exported for tests.
 *
 * OAuth grants are counted here; API-key requests are counted in oauth.ts
 * before the server is built, at the key's own rate.
 *
 * D844: a tool the metering policy prices above 0 runs inside `meteredCall`,
 * after every check above it passed, so a refused call holds nothing. Its
 * price is the policy's, never the arguments'. v1 prices every tool at 0, so
 * no member's call changes; `policy` is the server's own, and only tests pass
 * another.
 */
export async function callTool(env: Env, props: GrantProps, grantId: string | null, tool: McpTool, args: Record<string, unknown>, scope: readonly string[] = [], policy: MeteringPolicy = METERING_POLICY) {
  const executionId = newExecutionId();
  const started = Date.now();
  let user: Awaited<ReturnType<typeof grantUser>> | null = null;
  let companyId: number | null = null;
  let stage: CallStage = 'auth';
  // D842 keys use keyUid; retain D843's earlier principal field for callers.
  const apiKeyUid = props.keyUid ?? (props as GrantProps & { apiKeyUid?: string | null }).apiKeyUid ?? null;
  // The usage row first, so a failing activity line cannot skip it; its UNIQUE
  // execution_id keeps a second write for the same call out.
  const log = async (outcome: ToolOutcome, errorCategory: UsageErrorCategory | null = null) => {
    await recordUsage(env, {
      executionId, userId: user?.id ?? Number(props.userId), surface: 'mcp', operation: tool.name, outcome: outcome === 'timeout' ? 'error' : outcome,
      errorCategory, durationMs: Date.now() - started, apiKeyUid, grantId, client: props.clientName ?? null, companyId,
    });
    if (user) await logToolCall(env, user, { tool: tool.name, company: companyId, client: props.clientName, outcome, keyUid: apiKeyUid });
  };
  try {
    user = await grantUser(env, props);
    stage = 'scope';
    if (!scope.includes(tool.requiredScope)) {
      throw new ToolRefused(props.keyUid
        ? `This key needs ${tool.requiredScope} for ${tool.name}. Create a key with that permission.`
        : `This token needs ${tool.requiredScope} for ${tool.name}. Reconnect with that permission.`, 'insufficient_scope');
    }
    if (!(await toolEntitled(env, user, tool.entitlement))) throw new ToolRefused(NOT_AVAILABLE);
    if (grantId && !(await withinGrantLimit(env, grantId))) {
      await log('rate_limited', 'rate_limited');
      return errorResult('Too many calls from this connection. Wait a minute and try again.', 'rate_limited', executionId);
    }
    stage = 'company';
    let company: ToolRun['company'] = null;
    if (tool.company) {
      company = await grantCompany(env, props, user, args.company, tool.requiredScope === 'validate:write');
      companyId = company.id;
    }
    // The granted companies that still pass the check; one the user has lost drops out.
    const companies = await liveCompanies(env, props, user);
    let connected: number[] = [];
    if (tool.requiresConnection) {
      connected = await connectedCompanies(env, user.id, tool.provider, companies.map((c) => c.id));
      if (!connected.length) throw new ToolRefused(NOT_AVAILABLE);
      if (company && !connected.includes(company.id)) {
        throw new ToolRefused(`That connection is not switched on for ${company.name}. Switch it on from Connect a tool.`);
      }
    }
    stage = 'run';
    const operation = toolOperation(tool.name);
    const priced = listed(operation, policy);
    if (!priced) console.warn('[mcp] tool has no metering price:', tool.name);
    const quote = priced ? quoteFor(operation, 1, policy) : 0;
    const runUser = user;
    // One id and abort signal connect D842's timeout to D843 usage and D844's hold.
    const result = await withTimeout(tool.timeoutMs ?? TOOL_TIMEOUT_MS, async (signal) => {
      const runTool = async () => {
        signal.throwIfAborted();
        return tool.run({ env, props, user: runUser, companies, company, args, connected, executionId, signal });
      };
      return quote > 0
        ? (await meteredCall(env, { userId: runUser.id, executionId, operation, quoteMicrousd: quote,
          pricingVersion: policy.version, apiKeyUid, signal }, runTool)).value
        : await runTool();
    });
    if (grantId && env.OAUTH_KV) {
      await env.OAUTH_KV.put(lastUsedKey(grantId), new Date().toISOString(), { expirationTtl: 31 * 86_400 }).catch(() => {});
    }
    await log('ok');
    return { ...text(result), _meta: { ...toolMeta(tool), execution_id: executionId, [EXECUTION_META]: executionId } };
  } catch (e) {
    if (e instanceof ToolTimeout) {
      await log('timeout', 'timeout');
      return errorResult('That call took too long and was stopped. Try again, or ask for less at once.', 'timeout', executionId);
    }
    if (e instanceof ToolRefused) {
      // A refusal inside a tool is about its access to the company.
      await log('refused', stage === 'run' ? 'company' : stage);
      return errorResult(e.sentence, e.code, executionId);
    }
    if (e instanceof ToolError) {
      const code = mcpCode(e.code);
      await log('refused', code === 'insufficient_tokens' ? 'insufficient_tokens' : toolErrorCategory(e.status));
      const sentence = code !== e.code ? budgetRefusalMessage(e.code) : e.sentence;
      return errorResult(sentence, code, executionId, { status: e.status });
    }
    if (e instanceof MeteringRefused) {
      // Every metering refusal is the AI token ledger's (no tokens, the member's limit, a pause or a hold in review): one category.
      await log('refused', 'insufficient_tokens');
      return errorResult(e.sentence, e.code, executionId);
    }
    console.error('[mcp] tool failed:', tool.name, (e as Error)?.message);
    await log('error', 'internal');
    return errorResult('StudioOS could not complete that call.', 'unavailable', executionId);
  }
}

/**
 * A call to a tool this principal is not listed is answered as an unknown
 * name is, in our words, before the SDK's handler: the SDK's own answer names
 * the tool as "not found". The SDK keeps its handlers in `_requestHandlers`;
 * `mcp_registry_d846.test.ts` fails if that ever moves.
 */
function gateCalls(server: McpServer, listed: ReadonlySet<string>, refusal: string | null) {
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: any, extra: any) => Promise<unknown>> })._requestHandlers;
  const inner = handlers.get('tools/call');
  if (!inner) throw new Error('[mcp] the SDK has no tools/call handler to gate');
  handlers.set('tools/call', (req, extra) => (listed.has(String(req?.params?.name))
    ? inner(req, extra)
    : Promise.resolve(text({ error: refusal ?? NOT_AVAILABLE }, true))));
}

export async function createServer(env: Env, props: GrantProps, grantId: string | null, scope: readonly string[] = []): Promise<McpServer> {
  const server = new McpServer({ name: 'StudioOS', version: '1.0.0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const { tools, refusal } = await listedTools(env, props, scope);
  for (const tool of tools) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.readOnly !== false, destructiveHint: false, openWorldHint: false },
      _meta: toolMeta(tool),
    }, (async (args: Record<string, unknown>) => callTool(env, props, grantId, tool, args ?? {}, scope)) as any);
  }
  // With nothing listed the SDK never installs its tool handlers; install them so tools/list answers [].
  if (!tools.length) (server as unknown as { setToolRequestHandlers(): void }).setToolRequestHandlers();
  gateCalls(server, new Set(tools.map((t) => t.name)), refusal);
  return server;
}

/** A fresh stateless server for one authenticated request, OAuth grant or member API key alike (D842). */
export async function serveMcp(request: Request, env: Env, props: GrantProps, grantId: string | null, scope: readonly string[]): Promise<Response> {
  const server = await createServer(env, props, grantId, scope);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** The provider's `apiHandler`: a fresh stateless server for each authenticated request. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The provider sets ctx.props to what completeAuthorization stored.
    const props = (ctx as unknown as { props: GrantProps }).props;
    const scope = (ctx as unknown as { auth?: { scope?: string[] } }).auth?.scope ?? [];
    return serveMcp(request, env, props, grantIdOf(request), scope);
  },
};

// The read tools are part of the server from the start.
import { READ_TOOLS } from './tools/context';
registerMcpTools(READ_TOOLS);

// The interview handlers register through the same gate as the reads.
import { INTERVIEW_TOOLS } from './tools/interviews';
import { ToolError } from '../services/assistantInterviews';
registerMcpTools(INTERVIEW_TOOLS);

// D846: the connector-backed reads, over StudioOS's own records (D713).
import { BUILD_TOOLS } from './tools/build';
import { CONNECTION_TOOLS } from './tools/connections';
registerMcpTools([...BUILD_TOOLS, ...CONNECTION_TOOLS]);
