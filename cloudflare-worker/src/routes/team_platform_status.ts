/**
 * D4162 (#4162, H4 of #4137) — the banner every team sees while HQ has paused
 * all AI agents (SA6b), mounted at `/api/teams/platform-status`.
 *
 *   GET /   any signed-in member → { paused, since, by_name }
 *
 * The admin who paused is named, never by email; the reason stays HQ's.
 *
 * Mounted above `agent_engine.ts`, the first `/api/teams` router in index.ts:
 * the team routers below it answer 404 `team_agents_off` to every
 * `/api/teams/*` path while their flag is off (`team_agents.ts`'s
 * `use('*')`), and the banner must read either way.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { platformStatus } from '../services/agents/aiPolicy';
import agentEngineRoutes from './agent_engine';

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  await requireAuth(c);
  return c.json(await platformStatus(c.env));
});

export const mount: RouteMount = { path: '/api/teams/platform-status', router: r, before: [agentEngineRoutes] };
export default r;
