/**
 * D855 §4 row 2 (#3733 part 1) — a member's own Linear, read-only, through
 * Linear's read-only MCP server (`MCP_PROVIDERS.linear`).
 *
 * A member would connect only by "Sign in with Linear": the generic MCP
 * sign-in (`routes/connector_mcp_oauth.ts`, D1080) serves the record and
 * writes the `oauth_mcp` row. That sign-in needs a directory entry
 * (`REGISTRY`), and Linear has none yet, so NO MEMBER CAN CONNECT LINEAR
 * TODAY: the listing and its page are a later part of #3733, made once the
 * record is checked against a live sign-in (D855.md §7). `connect` takes no
 * token, so a paste is refused and nothing reaches Linear or is stored.
 * Every read goes through `services/linear/reads.ts`.
 *
 *   connect        403 support_session_refused for a support session; 410
 *                  sign_in_only otherwise: there is no token to paste
 *   disconnect     the grant revoked at Linear, best effort, then the stored
 *                  tokens deleted (`revokeMcpConnection`)
 *   revokeGranted  a grant the route refused, revoked at Linear, best effort
 *   ready          D751: whether a sign-in can register (`mcpReadiness`)
 *
 * D848: `linearAdapter` runs the six reads and nothing else. Its errors keep
 * their category without reading a body: Linear's spent request or
 * complexity counter is already `rate_limited` by the time it gets here
 * (the record's `rate_limit_headers`, read by `openMcpSession`).
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { ConnectRefusal, registerProvider, type ConnectInput, type ConnectResult, type IntegrationRow } from '../registry';
import { MCP_PROVIDERS } from '../mcpProviders';
import {
  MCP_AUTH_TYPE, McpClientError, discoverMcp, resolveMcpClient, revokeMcpConnection, revokeMcpTokens, type McpCredentials,
} from '../mcpClient';
import { mcpPreregisteredFor, mcpReadiness } from '../mcpSignIn';
import { selectJwt } from '../../auth';
import {
  ConnectorError, categoryOfStatus, checkToolInput, classifyWith, healthOfCategory, oneCall, registerConnectorAdapter, toolOf,
  type ConnectorAdapter, type ConnectorContext, type ConnectorTool, type ErrorCategory, type ExecuteResult, type HealthResult,
} from '../contract';
import { LinearReadError, linearReadsFor } from '../../services/linear/reads';

type C = Context<{ Bindings: Env }>;

const LINEAR = MCP_PROVIDERS.linear;

/** A support session acting as the member (`impersonated_by`, as Mercury's reads it). */
const isSupportSession = async (c: C) => !!(await selectJwt(c))?.payload.impersonated_by;

export const SIGN_IN_ONLY = 'Connect Linear with Sign in with Linear. Axal VC never asks for a Linear key.';

async function connect(c: C, _user: User, _input: ConnectInput): Promise<ConnectResult> {
  if (await isSupportSession(c)) {
    throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect a member\'s Linear.');
  }
  throw new ConnectRefusal(410, 'sign_in_only', SIGN_IN_ONLY);
}

async function disconnect(c: C, _user: User, row: IntegrationRow): Promise<void> {
  if (row.auth_type !== MCP_AUTH_TYPE || row.provider_key !== LINEAR.key) return;
  await revokeMcpConnection(c.env, LINEAR, row, { preregistered: mcpPreregisteredFor(c.env, LINEAR) });
}

/** A grant refused after it was issued: its tokens revoked at Linear, best effort. */
async function revokeGranted(env: Env, result: ConnectResult): Promise<void> {
  const creds = result.credentials as Partial<McpCredentials>;
  if (typeof creds?.access_token !== 'string' || typeof creds.client_key !== 'string') return;
  try {
    const server = await discoverMcp(LINEAR, { resource: typeof creds.resource === 'string' ? creds.resource : undefined });
    const client = await resolveMcpClient(env, LINEAR, server, creds.client_key, { preregistered: mcpPreregisteredFor(env, LINEAR) });
    if (client) await revokeMcpTokens(server, client, { access_token: creds.access_token, refresh_token: creds.refresh_token });
  } catch { /* best effort: the refusal stands either way */ }
}

const ready = (env: Env) => mcpReadiness(env, LINEAR, mcpPreregisteredFor(env, LINEAR));

registerProvider({ key: 'linear', connect, disconnect, revokeGranted, ready });

// ───────────────────────────────────────────────────────────── D848 contract

const ISSUE = { type: 'string', maxLength: 64 };
const NONE = { type: 'object', properties: {}, additionalProperties: false } as const;

/** The six reads, one per tool on the record's allowlist, under the same names. */
export const LINEAR_TOOLS: readonly ConnectorTool[] = Object.freeze([
  { name: 'list_issues', input_schema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 }, team: ISSUE, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'get_issue', input_schema: { type: 'object', properties: { id: ISSUE }, required: ['id'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'list_comments', input_schema: { type: 'object', properties: { issue: ISSUE }, required: ['issue'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'list_projects', input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'get_project', input_schema: { type: 'object', properties: { id: ISSUE }, required: ['id'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'list_teams', input_schema: NONE, access: 'read', unit: 'call' },
] as ConnectorTool[]);

/**
 * A Linear read's error as a category. The codes only, never a body: a spent
 * counter or a 429 is `rate_limited`, a refused or expired grant `auth`, an
 * identifier that is not one `invalid_input`, a dropped connection
 * `provider_down`.
 */
export function classifyLinearError(e: unknown): ErrorCategory {
  if (e instanceof LinearReadError) {
    if (e.code === 'rate_limited') return 'rate_limited';
    if (e.code === 'unauthorized' || e.code === 'not_connected') return 'auth';
    if (e.code === 'bad_id' || e.code === 'not_allowed') return 'invalid_input';
    return e.status == null ? 'unknown' : categoryOfStatus(e.status);
  }
  if (e instanceof McpClientError) {
    if (e.code === 'rate_limited') return 'rate_limited';
    if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return 'auth';
    if (e.code === 'timeout' || e.code === 'network_error') return 'provider_down';
    if (e.code === 'path_not_allowed') return 'invalid_input';
    return e.status == null ? 'unknown' : categoryOfStatus(e.status);
  }
  return classifyWith(e, () => null);
}

async function executeLinear(name: string, input: unknown, ctx: ConnectorContext): Promise<ExecuteResult> {
  const tool = toolOf(linearAdapter, name);
  const args = checkToolInput(tool.input_schema, input);
  if (ctx.row.auth_type !== MCP_AUTH_TYPE || ctx.row.provider_key !== LINEAR.key) throw new ConnectorError('auth', 'linear_not_connected');
  const reads = await linearReadsFor(ctx.env, ctx.row);
  const result = await (async () => {
    switch (tool.name) {
      case 'list_issues': return reads.listIssues({ query: args.query as string | undefined, team: args.team as string | undefined, limit: args.limit as number | undefined });
      case 'get_issue': return reads.getIssue(args.id as string);
      case 'list_comments': return reads.listComments(args.issue as string);
      case 'list_projects': return reads.listProjects({ limit: args.limit as number | undefined });
      case 'get_project': return reads.getProject(args.id as string);
      case 'list_teams': return reads.listTeams();
      default: throw new ConnectorError('invalid_input', 'unknown_tool');
    }
  })();
  return { result, usage: oneCall() };
}

/** Whether the connection's grant still opens a session on Linear's read-only server. */
async function linearHealth(ctx: ConnectorContext): Promise<HealthResult> {
  try {
    await linearReadsFor(ctx.env, ctx.row);
    return { state: 'ok', error_category: null };
  } catch (e) {
    const category = classifyLinearError(e);
    return { state: healthOfCategory(category), error_category: category };
  }
}

export const linearAdapter: ConnectorAdapter = {
  key: LINEAR.key,
  pattern: 'mcp',
  capabilities: () => ['Read-only'],
  tools: () => LINEAR_TOOLS,
  connect,
  disconnect,
  revoke: revokeGranted,
  execute: executeLinear,
  health: linearHealth,
  classifyError: classifyLinearError,
};
registerConnectorAdapter(linearAdapter);
