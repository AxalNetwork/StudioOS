/**
 * D849 (#2472) — the limits in force on the caller's assistant connections and
 * API keys (plan §3):
 *
 *   GET /api/developer/limits  → { window_seconds, member, connection, keys_enabled, keys[] }
 *
 * `member` is the cap across every connection and key the member holds;
 * `connection` is each assistant grant's own cap; each live key carries its
 * own rate and monthly cap (`null` when the member set none). The figures are
 * the ones `callTool` enforces (`mcp/grants.ts`), read from the same
 * constants, so this read cannot drift from them. Signed in with a session; it
 * never returns a secret, a hash or a key's scopes.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { GRANT_CALLS_PER_MINUTE, USER_CALLS_PER_MINUTE } from '../mcp/grants';
import { KEY_PREFIX, apiKeysEnabled, isLive, listKeys, looksLikeKey } from '../services/apiKeys';

export const developerLimits = new Hono<{ Bindings: Env }>();

developerLimits.get('/', async (c) => {
  const bearer = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (looksLikeKey(bearer)) return c.json({ detail: 'Sign in to read your limits.', code: 'session_required' }, 401);
  let user;
  try { user = await requireAuth(c); } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  const keysEnabled = apiKeysEnabled(c.env);
  const rows = keysEnabled ? (await listKeys(c.env, user.id)).filter((r) => isLive(r)) : [];
  return c.json({
    window_seconds: 60,
    member: { calls_per_minute: USER_CALLS_PER_MINUTE },
    connection: { calls_per_minute: GRANT_CALLS_PER_MINUTE },
    keys_enabled: keysEnabled,
    keys: rows.map((r) => ({
      uid: r.uid, name: r.name, prefix: `${KEY_PREFIX}${r.key_id}`,
      rate_per_minute: r.rate_per_minute, monthly_limit_microusd: r.monthly_limit_microusd,
    })),
  });
});
