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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { Env } from '../types';
import {
  ToolRefused, grantCompany, grantIdOf, grantUser, lastUsedKey, logToolCall, withinGrantLimit, type GrantProps,
} from './grants';
import { newExecutionId, recordUsage, type UsageErrorCategory, type UsageOutcome } from '../services/apiUsage';

export interface ToolRun {
  env: Env;
  props: GrantProps;
  user: Awaited<ReturnType<typeof grantUser>>;
  /** The granted companies the user can still write to. */
  companies: Array<{ id: number; name: string }>;
  /** The checked company, when the tool takes one. */
  company: { id: number; name: string } | null;
  args: Record<string, unknown>;
}

export interface McpTool {
  name: string;
  requiredScope: 'validate:read' | 'validate:write';
  title: string;
  description: string;
  /** A zod raw shape; the SDK turns it into the tool's JSON schema. */
  inputSchema: Record<string, any>;
  /** True when the tool takes a `company` argument that must be checked against the grant. */
  company: boolean;
  /** Read-only tools are annotated so; a write tool (#1497) sets false. */
  readOnly?: boolean;
  run: (r: ToolRun) => Promise<unknown>;
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
  ...(executionId ? { _meta: { execution_id: executionId } } : {}),
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

/** Run one tool call under the grant's checks. Exported for tests. */
export async function callTool(env: Env, props: GrantProps, grantId: string | null, tool: McpTool, args: Record<string, unknown>, scope: readonly string[] = []) {
  const executionId = newExecutionId();
  const started = Date.now();
  let user: Awaited<ReturnType<typeof grantUser>> | null = null;
  let companyId: number | null = null;
  let stage: CallStage = 'auth';
  // The member's API key (#2464) rides on the principal once keys exist; until then it is absent.
  const apiKeyUid = (props as GrantProps & { apiKeyUid?: string | null }).apiKeyUid ?? null;
  // The usage row first, so a failing activity line cannot skip it; its UNIQUE
  // execution_id keeps a second write for the same call out.
  const log = async (outcome: UsageOutcome, errorCategory: UsageErrorCategory | null = null) => {
    await recordUsage(env, {
      executionId, userId: user?.id ?? Number(props.userId), surface: 'mcp', operation: tool.name, outcome,
      errorCategory, durationMs: Date.now() - started, apiKeyUid, grantId, client: props.clientName ?? null, companyId,
    });
    if (user) await logToolCall(env, user, { tool: tool.name, company: companyId, client: props.clientName, outcome });
  };
  try {
    user = await grantUser(env, props);
    stage = 'scope';
    if (!scope.includes(tool.requiredScope)) throw new ToolRefused(`This token needs ${tool.requiredScope} for ${tool.name}. Reconnect with that permission.`);
    if (grantId && !(await withinGrantLimit(env, grantId))) {
      await log('rate_limited', 'rate_limited');
      return text({ error: 'Too many calls from this connection. Wait a minute and try again.' }, true, executionId);
    }
    stage = 'company';
    let company: ToolRun['company'] = null;
    if (tool.company) {
      company = await grantCompany(env, props, user, args.company, tool.requiredScope === 'validate:write');
      companyId = company.id;
    }
    // The granted companies that still pass the check; one the user has lost drops out.
    const companies = (await Promise.all(props.companies.map(async (id) => {
      try { return await grantCompany(env, props, user!, id); } catch { return null; }
    }))).filter((c): c is { id: number; name: string } => c !== null);
    stage = 'run';
    const result = await tool.run({ env, props, user, companies, company, args });
    if (grantId && env.OAUTH_KV) {
      await env.OAUTH_KV.put(lastUsedKey(grantId), new Date().toISOString(), { expirationTtl: 31 * 86_400 }).catch(() => {});
    }
    await log('ok');
    return text(result, false, executionId);
  } catch (e) {
    if (e instanceof ToolRefused) {
      // A refusal inside a tool is about its access to the company.
      await log('refused', stage === 'run' ? 'company' : stage);
      return text({ error: e.sentence }, true, executionId);
    }
    if (e instanceof ToolError) {
      await log('refused', toolErrorCategory(e.status));
      return text({ error: e.sentence, code: e.code, status: e.status }, true, executionId);
    }
    console.error('[mcp] tool failed:', tool.name, (e as Error)?.message);
    await log('error', 'internal');
    return text({ error: 'StudioOS could not complete that call.' }, true, executionId);
  }
}

export function createServer(env: Env, props: GrantProps, grantId: string | null, scope: readonly string[] = []): McpServer {
  const server = new McpServer({ name: 'StudioOS', version: '1.0.0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  for (const tool of REGISTRY) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.readOnly !== false, destructiveHint: false, openWorldHint: false },
    }, (async (args: Record<string, unknown>) => callTool(env, props, grantId, tool, args ?? {}, scope)) as any);
  }
  return server;
}

/** The provider's `apiHandler`: a fresh stateless server for each authenticated request. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The provider sets ctx.props to what completeAuthorization stored.
    const props = (ctx as unknown as { props: GrantProps }).props;
    const scope = (ctx as unknown as { auth?: { scope?: string[] } }).auth?.scope ?? [];
    const server = createServer(env, props, grantIdOf(request), scope);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

// The read tools are part of the server from the start.
import { READ_TOOLS } from './tools/context';
registerMcpTools(READ_TOOLS);

// The interview handlers register through the same gate as the reads.
import { INTERVIEW_TOOLS } from './tools/interviews';
import { ToolError } from '../services/assistantInterviews';
registerMcpTools(INTERVIEW_TOOLS);
