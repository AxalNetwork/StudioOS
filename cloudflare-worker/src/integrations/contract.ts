/**
 * D848 (#2469) — one connector contract.
 *
 * Every provider adapter, whether it reaches its provider through an MCP
 * server (pattern B, `mcp`) or the provider's own API (pattern C, `api`),
 * implements `ConnectorAdapter`. The engine, the tool registry and flows then
 * treat every connector alike, and what is particular to a provider (its
 * token, its pagination, the shape of its errors) stays in its adapter.
 *
 * THE ADAPTER IS NOT A SECOND PROVIDER. `registry.ts`'s `ProviderImpl` still
 * drives the connect, sync, push and webhook routes. An adapter reuses that
 * provider's own functions: its `connect` is the same function, its `revoke`
 * the same `revokeGranted`. It adds what the engine needs and the routes never
 * had: the tools it can run, running one, and its health.
 *
 * WHAT CROSSES THE CONTRACT IS FIXED. A health state and an error category
 * are one of a few strings. A provider's own message, which may quote its
 * response, never reaches a caller: `classifyError` reduces it to a category,
 * and the server log keeps only that category and the HTTP status.
 *
 * AUTHORIZATION AND METERING ARE THE CALLER'S. `execute` runs one tool for a
 * connection the caller has already checked. It does not decide who may run
 * it, and it reserves or settles nothing: it reports the units it used, and
 * the metering around it prices them (#2466).
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { ConnectInput, ConnectResult, IntegrationRow } from './registry';

/** How an adapter reaches its provider: an MCP server, or the provider's own API. */
export type ConnectorPattern = 'mcp' | 'api';

export const HEALTH_STATES = ['ok', 'degraded', 'expired', 'disconnected', 'error'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const ERROR_CATEGORIES = ['auth', 'rate_limited', 'not_found', 'invalid_input', 'provider_down', 'unknown'] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** A JSON Schema for a tool's input. Every tool takes an object. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: false;
}

export interface ConnectorTool {
  /** The tool's name, as the connector's page names it (`connectorPages.ts`). */
  name: string;
  input_schema: ToolInputSchema;
  access: 'read' | 'write';
  /** What one unit of `usage.units` counts. */
  unit: 'call';
}

export interface ConnectorUsage {
  units: number;
  /** What the provider charged for the call, in integer micro-USD. Null when no price is known. */
  provider_cost_microusd: number | null;
}

/** The connection a tool runs on, already authorized by the caller. */
export interface ConnectorContext {
  env: Env;
  row: IntegrationRow;
}

export interface ExecuteResult {
  result: unknown;
  usage: ConnectorUsage;
}

export interface HealthResult {
  state: HealthState;
  /** Why the state is not `ok`; null when it is. */
  error_category: ErrorCategory | null;
}

export interface ConnectorAdapter {
  key: string;
  pattern: ConnectorPattern;
  /** What the connection can do, in words the connector's page uses. */
  capabilities(): readonly string[];
  tools(): readonly ConnectorTool[];
  connect(c: Context<{ Bindings: Env }>, user: User, input: ConnectInput): Promise<ConnectResult>;
  /** End a saved connection's grant at the provider. */
  disconnect(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void>;
  /** End a grant the member refused before any connection was saved. */
  revoke(env: Env, result: ConnectResult): Promise<void>;
  execute(tool: string, input: unknown, ctx: ConnectorContext): Promise<ExecuteResult>;
  health(ctx: ConnectorContext): Promise<HealthResult>;
  classifyError(e: unknown): ErrorCategory;
}

/**
 * An error an adapter throws on purpose, with its category already known:
 * an unknown tool, an input the tool does not take, missing credentials.
 * `classifyError` reads the category before anything else.
 */
export class ConnectorError extends Error {
  readonly category: ErrorCategory;
  constructor(category: ErrorCategory, code: string) {
    super(code);
    this.name = 'ConnectorError';
    this.category = category;
  }
}

/** An HTTP status, as a provider answered it, reduced to a category. */
export function categoryOfStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 400 || status === 409 || status === 422) return 'invalid_input';
  if (status >= 500 && status <= 599) return 'provider_down';
  return 'unknown';
}

/**
 * The category of anything an adapter's call threw. A `ConnectorError` says
 * its own. A network failure or a timeout is the provider being down. Anything
 * else is the adapter's `fromMessage`, which reads its provider's message
 * format, or `unknown`.
 */
export function classifyWith(e: unknown, fromMessage: (message: string) => ErrorCategory | null): ErrorCategory {
  if (e instanceof ConnectorError) return e.category;
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError' || e instanceof TypeError) return 'provider_down';
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return fromMessage(message) ?? 'unknown';
}

/** The health a failed check reports, from its error's category. */
export function healthOfCategory(category: ErrorCategory): HealthState {
  if (category === 'auth') return 'expired';
  if (category === 'rate_limited' || category === 'provider_down') return 'degraded';
  return 'error';
}

/**
 * A tool's input, checked against its schema: an object, with no field the
 * schema does not name, every required field present, and each field of its
 * declared type. A tool never reads a field it did not declare.
 */
export function checkToolInput(schema: ToolInputSchema, input: unknown): Record<string, unknown> {
  const given = input === undefined || input === null ? {} : input;
  if (typeof given !== 'object' || Array.isArray(given)) throw new ConnectorError('invalid_input', 'input_not_object');
  const fields = given as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) throw new ConnectorError('invalid_input', 'unknown_input_field');
  }
  for (const key of schema.required ?? []) {
    if (fields[key] === undefined || fields[key] === null) throw new ConnectorError('invalid_input', 'missing_input_field');
  }
  for (const [key, value] of Object.entries(fields)) {
    const type = schema.properties[key]?.type;
    if (type === 'string' && typeof value !== 'string') throw new ConnectorError('invalid_input', 'bad_input_field');
    if (type === 'integer' && !Number.isSafeInteger(value)) throw new ConnectorError('invalid_input', 'bad_input_field');
    if (type === 'boolean' && typeof value !== 'boolean') throw new ConnectorError('invalid_input', 'bad_input_field');
  }
  return fields;
}

/** The tool an adapter runs, or a refusal: a name it does not list is not run. */
export function toolOf(adapter: Pick<ConnectorAdapter, 'tools'>, name: string): ConnectorTool {
  const tool = adapter.tools().find((t) => t.name === name);
  if (!tool) throw new ConnectorError('not_found', 'unknown_tool');
  return tool;
}

/**
 * One call, with no provider price known. GitHub and Stripe bill nothing per
 * call that Axal can see, so the cost is not known rather than zero; the
 * metering around `execute` prices the units (#2466).
 */
export function oneCall(): ConnectorUsage {
  return { units: 1, provider_cost_microusd: null };
}

const ADAPTERS: Map<string, ConnectorAdapter> = new Map();

/** Called once at module load by each adapted provider, beside `registerProvider`. */
export function registerConnectorAdapter(adapter: ConnectorAdapter): void {
  ADAPTERS.set(adapter.key, adapter);
}

export function getConnectorAdapter(key: string): ConnectorAdapter | null {
  return ADAPTERS.get(key) ?? null;
}

export function connectorAdapterKeys(): string[] {
  return [...ADAPTERS.keys()].sort();
}
