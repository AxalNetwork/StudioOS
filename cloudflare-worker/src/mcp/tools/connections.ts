/**
 * D846 (#2467) — `list_connections`: the member's own connections switched on
 * for each granted company, for an assistant with `connectors:read`.
 *
 * STATE ONLY. Each connection is its provider, its status and when it last
 * synced or last failed, read from the `integrations` row. Never a token, a
 * credential, a webhook secret, an account id or a stored error's text (one
 * can carry what a provider echoed back). No provider is called (D713): this
 * reads what StudioOS holds about the connection, not data through it.
 *
 * A personal connection not switched on for a granted company is not listed:
 * the grant reaches companies, and the connection is not that company's.
 */
import type { Env } from '../../types';
import type { McpTool } from '../server';
import { getDescriptor } from '../../integrations/registry';

interface ConnectionRow { project_id: number; provider_key: string; status: string; last_synced_at: string | null; last_error_at: string | null }

export async function connectionStates(env: Env, userId: number, companies: Array<{ id: number; name: string }>) {
  if (!companies.length) return [];
  const r = await env.DB.prepare(
    'SELECT p.id AS project_id, i.provider_key, i.status, i.last_synced_at, i.last_error_at FROM integrations i ' +
    'JOIN integration_companies ic ON ic.integration_id = i.id AND ic.enabled = 1 ' +
    'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
    'JOIN projects p ON p.company_id = ic.company_id AND p.deleted_at IS NULL ' +
    'WHERE i.user_id = ? AND p.id IN (SELECT value FROM json_each(?)) ORDER BY p.id, i.provider_key, i.id',
  ).bind(userId, JSON.stringify(companies.map((c) => c.id))).all<ConnectionRow>();
  const rows = r.results || [];
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    connections: rows.filter((row) => Number(row.project_id) === c.id).map((row) => ({
      provider: row.provider_key,
      name: getDescriptor(row.provider_key)?.display_name ?? row.provider_key,
      status: row.status,
      last_synced_at: row.last_synced_at ?? null,
      last_failed_at: row.last_error_at ?? null,
    })),
  }));
}

export const CONNECTION_TOOLS: McpTool[] = [
  {
    name: 'list_connections',
    requiredScope: 'connectors:read',
    source: 'connector',
    version: '1.0.0',
    title: 'List connections',
    description: 'List, for each company this connection was approved for, the tools you have connected and switched on for it: the provider, its status, when it last synced and when it last failed. Never a token or a credential, and no provider is called.',
    inputSchema: {},
    company: false,
    run: async ({ env, user, companies }) => ({ companies: await connectionStates(env, Number(user.id), companies) }),
  },
];
