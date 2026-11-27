/**
 * D855 §4 row 5 (#3733 part 2) — a member's own Cloudflare, read-only,
 * through Cloudflare's REST API (pattern C, `api`), never an MCP server.
 *
 * The owner chose the REST API on 2026-11-01 (#3733): Cloudflare's Workers
 * Builds and Workers Observability MCP servers are deprecated in favour of
 * the Code Mode `execute()` server at `https://mcp.cloudflare.com/mcp`, which
 * this connector never calls. Every read goes through
 * `services/cloudflare/api.ts`, the only file that calls Cloudflare.
 *
 * NO MEMBER CAN CONNECT CLOUDFLARE TODAY. A connection would come from
 * "Sign in with Cloudflare", an OAuth client whose grant `checkGrantedScopes`
 * holds to read scopes; that client is not registered, and Cloudflare has no
 * directory entry (`REGISTRY`). `connect` takes no token, so a pasted API
 * token is refused and nothing reaches Cloudflare or is stored: a pasted token
 * cannot show its own permissions, so Axal could not tell a read token from an
 * edit one. The sign-in and the listing are a later part, once a live sign-in
 * confirms the scopes.
 *
 *   connect        403 support_session_refused for a support session; 410
 *                  sign_in_only otherwise
 *   disconnect,    nothing to end at Cloudflare: no grant is issued while
 *   revokeGranted  the sign-in is not built
 *
 * D848: `cloudflareAdapter` runs the seven reads and nothing else. Cloudflare's
 * five-minute block (a 429, or its throttle code 971) is `rate_limited`
 * (D855 §4's `classifyError` line), read from the status and the numeric
 * codes, never a message.
 *
 * VERCEL (#2408). Both read a venture's deploys. Neither feeds a timeline
 * yet: these reads answer a tool call and store nothing, so nothing is
 * reported twice. When a feed lands, a deploy is one deploy by its repository
 * and commit, whichever host built it (D855 §8).
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { ConnectRefusal, registerProvider, type ConnectInput, type ConnectResult, type IntegrationRow } from '../registry';
import { decryptCredentials } from '../secrets';
import { selectJwt } from '../../auth';
import {
  ConnectorError, categoryOfStatus, checkToolInput, classifyWith, healthOfCategory, oneCall, registerConnectorAdapter, toolOf,
  type ConnectorAdapter, type ConnectorContext, type ConnectorTool, type ErrorCategory, type ExecuteResult, type HealthResult,
} from '../contract';
import { CloudflareError, cloudflareReads, type CloudflareReads } from '../../services/cloudflare/api';

type C = Context<{ Bindings: Env }>;

const KEY = 'cloudflare';

/** A support session acting as the member (`impersonated_by`, as Linear's reads it). */
const isSupportSession = async (c: C) => !!(await selectJwt(c))?.payload.impersonated_by;

export const SIGN_IN_ONLY = 'Connect Cloudflare with Sign in with Cloudflare. Axal VC never asks for a Cloudflare API token.';

async function connect(c: C, _user: User, _input: ConnectInput): Promise<ConnectResult> {
  if (await isSupportSession(c)) {
    throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect a member\'s Cloudflare.');
  }
  throw new ConnectRefusal(410, 'sign_in_only', SIGN_IN_ONLY);
}

// ───────────────────────────────────────────────────────────── D848 contract

const ACCOUNT = { type: 'string', pattern: '^[0-9a-f]{32}$' };
const HOURS = { type: 'integer', minimum: 1, maximum: 72 };

/** The seven reads. No tool takes a path, a URL, a query or a method. */
export const CLOUDFLARE_TOOLS: readonly ConnectorTool[] = Object.freeze([
  { name: 'list_accounts', input_schema: { type: 'object', properties: {}, additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'list_workers', input_schema: { type: 'object', properties: { account: ACCOUNT }, required: ['account'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'list_builds', input_schema: { type: 'object', properties: { account: ACCOUNT, worker: { type: 'string', pattern: '^[0-9a-f]{32}$' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['account', 'worker'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'get_build', input_schema: { type: 'object', properties: { account: ACCOUNT, build: { type: 'string', maxLength: 36 } }, required: ['account', 'build'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'get_build_logs', input_schema: { type: 'object', properties: { account: ACCOUNT, build: { type: 'string', maxLength: 36 } }, required: ['account', 'build'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'worker_errors', input_schema: { type: 'object', properties: { account: ACCOUNT, script: { type: 'string', maxLength: 63 }, hours: HOURS }, required: ['account', 'script'], additionalProperties: false }, access: 'read', unit: 'call' },
  { name: 'worker_requests', input_schema: { type: 'object', properties: { account: ACCOUNT, script: { type: 'string', maxLength: 63 }, hours: HOURS }, required: ['account', 'script'], additionalProperties: false }, access: 'read', unit: 'call' },
] as ConnectorTool[]);

/**
 * A Cloudflare read's error as a category, from its code and status only: a
 * spent limit or the five-minute block is `rate_limited`, a refused token
 * `auth`, a dropped connection `provider_down`, anything else its status (an
 * identifier that is not one is a 400, `invalid_input`).
 */
export function classifyCloudflareError(e: unknown): ErrorCategory {
  if (e instanceof CloudflareError) {
    if (e.code === 'rate_limited') return 'rate_limited';
    if (e.code === 'unauthorized' || e.code === 'not_connected') return 'auth';
    if (e.code === 'network_error') return 'provider_down';
    return e.status == null ? 'unknown' : categoryOfStatus(e.status);
  }
  return classifyWith(e, () => null);
}

/** The connection's reads, on its own stored token. */
async function readsFor(ctx: ConnectorContext): Promise<CloudflareReads> {
  if (ctx.row.provider_key !== KEY) throw new ConnectorError('auth', 'cloudflare_not_connected');
  const creds = ctx.row.credentials_enc ? await decryptCredentials(ctx.env, ctx.row.uid, ctx.row.credentials_enc) : null;
  const token = typeof creds?.access_token === 'string' ? creds.access_token : '';
  if (!token) throw new ConnectorError('auth', 'cloudflare_not_connected');
  return cloudflareReads(token);
}

async function executeCloudflare(name: string, input: unknown, ctx: ConnectorContext): Promise<ExecuteResult> {
  const tool = toolOf(cloudflareAdapter, name);
  const args = checkToolInput(tool.input_schema, input);
  const reads = await readsFor(ctx);
  const account = args.account as string;
  const result = await (async () => {
    switch (tool.name) {
      case 'list_accounts': return reads.listAccounts();
      case 'list_workers': return reads.listWorkers(account);
      case 'list_builds': return reads.listBuilds(account, args.worker as string, args.limit as number | undefined);
      case 'get_build': return reads.getBuild(account, args.build as string);
      case 'get_build_logs': return reads.getBuildLogs(account, args.build as string);
      case 'worker_errors': return reads.workerErrors(account, args.script as string, args.hours as number | undefined);
      case 'worker_requests': return reads.workerRequests(account, args.script as string, args.hours as number | undefined);
      default: throw new ConnectorError('invalid_input', 'unknown_tool');
    }
  })();
  return { result, usage: oneCall() };
}

/** Whether the connection's token still reads its accounts. */
async function cloudflareHealth(ctx: ConnectorContext): Promise<HealthResult> {
  try {
    await (await readsFor(ctx)).listAccounts();
    return { state: 'ok', error_category: null };
  } catch (e) {
    const category = classifyCloudflareError(e);
    return { state: healthOfCategory(category), error_category: category };
  }
}

/** Nothing to end at Cloudflare: no grant is ever issued while the sign-in is not built. */
async function disconnect(_c: C, _user: User, _row: IntegrationRow): Promise<void> {}
async function revoke(_env: Env, _result: ConnectResult): Promise<void> {}

registerProvider({ key: KEY, connect, disconnect, revokeGranted: revoke });

export const cloudflareAdapter: ConnectorAdapter = {
  key: KEY,
  pattern: 'api',
  capabilities: () => ['Read-only'],
  tools: () => CLOUDFLARE_TOOLS,
  connect,
  disconnect,
  revoke,
  execute: executeCloudflare,
  health: cloudflareHealth,
  classifyError: classifyCloudflareError,
};
registerConnectorAdapter(cloudflareAdapter);
