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

/**
 * Epic 11 — extract the bearer JWT from either:
 *   1. `Sec-WebSocket-Protocol: bearer.<jwt>`  (preferred — RFC-compliant,
 *      keeps the token out of URL strings, server access logs, and HTTP
 *      Referer headers; the browser-side `useWebSocket` hook now sends this).
 *   2. `?token=<jwt>` query string  (legacy fallback for any client that
 *      hasn't been upgraded yet — kept so a partial deploy doesn't break
 *      live connections).
 *
 * Returns the raw JWT string, or `null` if neither carrier is present.
 */
function extractBearerToken(c: any): string | null {
  const proto = c.req.header('sec-websocket-protocol') || '';
  if (proto) {
    const offered = proto.split(',').map((s: string) => s.trim()).filter(Boolean);
    for (const p of offered) {
      if (p.startsWith('bearer.')) return p.slice('bearer.'.length);
    }
  }
  const q = c.req.query('token');
  return q || null;
}

async function authenticateForUpgrade(c: any): Promise<{ id: number; email: string; role: string; kyc_status: string | null } | null> {
  const token = extractBearerToken(c);
  if (!token) return null;
  try {
    const payload = await decodeJWT(c.env, token);
    const sql = getSQL(c.env);
    const rows = await sql`SELECT id, email, role, is_active, kyc_status FROM users WHERE id = ${payload.user_id}`;
    await sql.end();
    if (!rows.length || !rows[0].is_active) return null;
    return { id: rows[0].id, email: rows[0].email, role: rows[0].role, kyc_status: rows[0].kyc_status ?? null };
  } catch {
    return null;
  }
}

/**
 * Build the upgrade Request that gets handed to the Durable Object.
 * Forwards the original `Sec-WebSocket-Protocol` header verbatim so the DO
 * can echo the chosen subprotocol on its 101 response — the WebSocket
 * handshake REQUIRES the server to echo exactly one of the offered
 * subprotocols, otherwise the browser closes the socket with code 1006.
 */
function buildUpgradeRequest(c: any, user: { id: number; role: string }): Request {
  const headers: Record<string, string> = {
    upgrade: 'websocket',
    'x-auth-user-id': String(user.id),
    'x-auth-role': user.role,
  };
  const proto = c.req.header('sec-websocket-protocol');
  if (proto) headers['sec-websocket-protocol'] = proto;
  return new Request('https://do/ws', { headers });
}

// Mirror the global /api/* KYC gate for WS upgrades, which bypass the
// Authorization-header-based middleware because browsers can only auth via
// ?token=. Admins are exempt — same policy as the HTTP gate.
function kycOk(user: { role: string; kyc_status: string | null }): boolean {
  // Task #2 — KYC is investor-only. Admins always bypass; founders,
  // partners, and mentors never need KYC and pass through. Only
  // investors are required to be approved to subscribe to per-deal
  // realtime channels (the overview channel allows any authed user).
  if (user.role === 'admin') return true;
  if (user.role !== 'investor') return true;
  return user.kyc_status === 'approved';
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

  const dealId = c.req.param('deal_id');
  // Special channel "overview" is the global notifications + board feed —
  // any authenticated active user may subscribe (founders need it for the
  // bell). The PipelineRoom DO filters per-user `notification` frames by
  // socket attachment, and only emits aggregate events (vote_updated,
  // stage_change) on this channel — those are non-PII, board-level data.
  // Per-deal numeric rooms remain restricted to admin/partner/investor.
  const isOverview = dealId === 'overview';
  if (!isOverview) {
    if (!/^\d+$/.test(dealId)) return c.json({ error: 'Invalid deal_id' }, 400);
    if (!['admin', 'partner', 'investor'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403);
    if (!kycOk(user)) return c.json({ error: 'KYC verification required', kyc_required: true }, 403);
  }
  if (!(await checkUpgradeRate(c.env, user.id))) return c.json({ error: 'Too many WS upgrades' }, 429);

  const roomName = dealId === 'overview' ? 'overview' : `deal:${dealId}`;
  const id = c.env.PIPELINE_ROOM.idFromName(roomName);
  const stub = c.env.PIPELINE_ROOM.get(id);
  // Forward the upgrade to the DO with auth context attached.
  return stub.fetch(buildUpgradeRequest(c, user));
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
  // Note: NO KYC gate here. Founders self-watching their onboarding chat
  // is part of the pre-KYC onboarding flow itself. Admins are always exempt.
  if (!(await checkUpgradeRate(c.env, user.id))) return c.json({ error: 'Too many WS upgrades' }, 429);

  const id = c.env.ONBOARDING_CHAT.idFromName(`user:${targetUserId}`);
  const stub = c.env.ONBOARDING_CHAT.get(id);
  return stub.fetch(buildUpgradeRequest(c, user));
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
