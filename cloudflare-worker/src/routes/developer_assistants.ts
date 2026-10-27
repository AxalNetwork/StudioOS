/**
 * D1316 (#3474) — Account › Builder › MCP and services, the overview it reads
 * (#2418, the "Builder Page" and "MCP Services Page" canvases):
 *
 *   GET /api/developer/assistants/overview
 *     → { server_url, scopes[{ scope, label }], tools[{ name, title, description, required_scope, read_only }],
 *         limits{ window_seconds, per_connection_per_minute, per_member_per_minute, tool_timeout_ms,
 *                 interview_submissions_per_day, placements_per_day },
 *         can_grant, grantable_count }
 *
 * Signed in; 404 with the MCP flag off, as every assistant route is. The tools
 * are the registry's (`registeredTools()`), each under its listed name: an alias
 * (D1315's `structure_with_studioos`) is never listed. The limits are the
 * constants the server enforces, read from where it reads them, so this read
 * cannot drift from them. Nothing here is the caller's data except how many
 * companies they could connect, from the consent page's own rule.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { SCOPES, mcpEnabled, publicOrigin, MCP_PATH } from '../mcp/oauth';
import { registeredTools, TOOL_TIMEOUT_MS } from '../mcp/server';
import { GRANT_CALLS_PER_MINUTE, USER_CALLS_PER_MINUTE, grantableCompanies } from '../mcp/grants';
import { LIMITS } from '../services/assistantInterviews';
import { SCOPE_COPY } from './mcp_consent';

export const developerAssistants = new Hono<{ Bindings: Env }>();

developerAssistants.get('/overview', async (c) => {
  if (!mcpEnabled(c.env)) return c.json({ detail: 'Not found' }, 404);
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  const grantable = await grantableCompanies(c.env, user);
  return c.json({
    server_url: `${publicOrigin(c.env)}${MCP_PATH}`,
    scopes: SCOPES.map((scope) => ({ scope, label: SCOPE_COPY[scope] })),
    tools: registeredTools().map((t) => ({
      name: t.name, title: t.title, description: t.description, required_scope: t.requiredScope, read_only: t.readOnly !== false,
    })),
    limits: {
      window_seconds: 60,
      per_connection_per_minute: GRANT_CALLS_PER_MINUTE,
      per_member_per_minute: USER_CALLS_PER_MINUTE,
      tool_timeout_ms: TOOL_TIMEOUT_MS,
      interview_submissions_per_day: LIMITS.submissionsPerDay,
      placements_per_day: LIMITS.placementsPerDay,
    },
    can_grant: grantable.length > 0,
    grantable_count: grantable.length,
  });
});
