/**
 * WebSocket upgrade routes for real-time fan-out.
 *
 *   GET /api/pipeline/ws/:deal_id   — admin/partner only, joins PipelineRoom
 *   GET /api/onboarding/ws/:user_id — admin or owner, joins OnboardingChat
 *
 * Why ?token= in the query string: browsers cannot set Authorization
 * headers on the initial WebSocket handshake. The token is the same JWT
 * the rest of the API uses; we decode it here, enforce RBAC, then forward
 * the upgrade request to the DO with X-Auth-* headers.
 *
 * Rate limit: max 30 upgrade attempts per user per minute, KV-backed
 * (separate window from the regular HTTP rate limit so a noisy reconnect
 * loop doesn't lock the user out of the JSON API).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { decodeJWT } from '../auth';
import { getSQL } from '../db';

const realtime = new Hono<{ Bindings: Env }>();

const UPGRADE_LIMIT = 30;
const UPGRADE_WINDOW_S = 60;

async function checkUpgradeRate(env: Env, userId: number): Promise<boolean> {
  if (!env.RATE_LIMITS) return true;
  const key = `ws:upgrade:${userId}:${Math.floor(Date.now() / (UPGRADE_WINDOW_S * 1000))}`;
  const cur = parseInt((await env.RATE_LIMITS.get(key)) || '0', 10);
  if (cur >= UPGRADE_LIMIT) return false;
  await env.RATE_LIMITS.put(key, String(cur + 1), { expirationTtl: UPGRADE_WINDOW_S * 2 });
  return true;
}

async function authenticateForUpgrade(c: any): Promise<{ id: number; email: string; role: string } | null> {
  const token = c.req.query('token');
  if (!token) return null;
  try {
    const payload = await decodeJWT(c.env, token);
    const sql = getSQL(c.env);
    const rows = await sql`SELECT id, email, role, is_active FROM users WHERE id = ${payload.user_id}`;
    await sql.end();
    if (!rows.length || !rows[0].is_active) return null;
    return { id: rows[0].id, email: rows[0].email, role: rows[0].role };
  } catch {
    return null;
  }
}

// GET /api/pipeline/ws/:deal_id — broadcasts pipeline events for one deal.
// Allowed: admin, partner. Founders cannot snoop on other deals.
realtime.get('/pipeline/ws/:deal_id', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }
  if (!c.env.PIPELINE_ROOM) return c.json({ error: 'Realtime disabled' }, 503);

  const user = await authenticateForUpgrade(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!['admin', 'partner'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403);
  if (!(await checkUpgradeRate(c.env, user.id))) return c.json({ error: 'Too many WS upgrades' }, 429);

  const dealId = c.req.param('deal_id');
  // Special channel "overview" is the global board feed (all deals).
  // Otherwise must be a numeric deal_id.
  if (dealId !== 'overview' && !/^\d+$/.test(dealId)) {
    return c.json({ error: 'Invalid deal_id' }, 400);
  }

  const roomName = dealId === 'overview' ? 'overview' : `deal:${dealId}`;
  const id = c.env.PIPELINE_ROOM.idFromName(roomName);
  const stub = c.env.PIPELINE_ROOM.get(id);
  // Forward the upgrade to the DO with auth context attached.
  return stub.fetch(new Request('https://do/ws', {
    headers: {
      upgrade: 'websocket',
      'x-auth-user-id': String(user.id),
      'x-auth-role': user.role,
    },
  }));
});

// GET /api/onboarding/ws/:user_id — broadcasts new chat messages.
// Allowed: admin, OR the founder whose user_id matches.
realtime.get('/onboarding/ws/:user_id', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }
  if (!c.env.ONBOARDING_CHAT) return c.json({ error: 'Realtime disabled' }, 503);

  const user = await authenticateForUpgrade(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const targetUserId = c.req.param('user_id');
  if (!/^\d+$/.test(targetUserId)) return c.json({ error: 'Invalid user_id' }, 400);

  const isAdmin = user.role === 'admin';
  const isSelf = String(user.id) === targetUserId;
  if (!isAdmin && !isSelf) return c.json({ error: 'Forbidden' }, 403);
  if (!(await checkUpgradeRate(c.env, user.id))) return c.json({ error: 'Too many WS upgrades' }, 429);

  const id = c.env.ONBOARDING_CHAT.idFromName(`user:${targetUserId}`);
  const stub = c.env.ONBOARDING_CHAT.get(id);
  return stub.fetch(new Request('https://do/ws', {
    headers: {
      upgrade: 'websocket',
      'x-auth-user-id': String(user.id),
      'x-auth-role': user.role,
    },
  }));
});

// GET /api/realtime/room/:kind/:id/count — admin-only, exact connection
// count for one room. Used by the infra dashboard.
realtime.get('/realtime/room/:kind/:id/count', async (c) => {
  const user = await authenticateForUpgrade(c);
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin required' }, 403);
  const kind = c.req.param('kind');
  const id = c.req.param('id');
  let ns: DurableObjectNamespace | undefined;
  let name = '';
  if (kind === 'pipeline') { ns = c.env.PIPELINE_ROOM; name = `deal:${id}`; }
  else if (kind === 'onboarding') { ns = c.env.ONBOARDING_CHAT; name = `user:${id}`; }
  else return c.json({ error: 'Unknown kind' }, 400);
  if (!ns) return c.json({ error: 'Realtime disabled' }, 503);
  const doId = ns.idFromName(name);
  const stub = ns.get(doId);
  const r = await stub.fetch('https://do/count');
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
});

export default realtime;
