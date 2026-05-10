/**
 * Task #7 (2026-05-10) — Admin REST API for managing per-provider
 * OAuth client credentials. Mounted at `/api/admin/integration-keys`.
 *
 *  GET    /                  → list status for every managed provider (no secrets)
 *  PUT    /:provider         → upsert {client_id, client_secret}
 *  DELETE /:provider         → remove + cascade-disconnect every active user integration
 *
 * Every route gates on `requireAdmin`. Writes are logged to
 * `activity_logs` with hashed actor (T22.1) so the audit trail can
 * track who set/rotated the credentials without leaking the admin's
 * email into the table.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import {
  MANAGED_PROVIDERS,
  type ManagedProviderKey,
  setOauthCreds,
  deleteOauthCredsAndDisconnect,
  listProviderKeyStatus,
} from '../services/providerOauthKeys';

const r = new Hono<{ Bindings: Env }>();

function isManaged(k: string): k is ManagedProviderKey {
  return (MANAGED_PROVIDERS as readonly string[]).includes(k);
}

async function logActivity(
  env: Env,
  adminUserId: number,
  adminEmail: string | null,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const actor = adminEmail ? hashEmail(adminEmail) : null;
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actor, adminUserId).run();
  } catch (e) {
    console.warn('[admin_integration_keys] activity log failed', e);
  }
}

r.get('/', async (c) => {
  await requireAdmin(c);
  const status = await listProviderKeyStatus(c.env);
  return c.json({ providers: status });
});

r.put('/:provider', async (c) => {
  const admin = await requireAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let body: { client_id?: string; client_secret?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const clientId = String(body.client_id || '').trim();
  const clientSecret = String(body.client_secret || '').trim();
  if (!clientId || !clientSecret) {
    return c.json({ error: 'client_id_and_client_secret_required' }, 400);
  }
  // Defensive length cap — both fields fit in a TEXT column comfortably,
  // but we don't want to accept a 10MB paste-bomb.
  if (clientId.length > 4096 || clientSecret.length > 4096) {
    return c.json({ error: 'value_too_long' }, 400);
  }
  try {
    await setOauthCreds(c.env, provider, clientId, clientSecret, admin.id);
  } catch (e: any) {
    return c.json({ error: e?.message || 'set_failed' }, 500);
  }
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_set', {
    provider, client_id_preview: clientId.slice(0, 12),
  });
  return c.json({ ok: true, provider, source: 'db' });
});

r.delete('/:provider', async (c) => {
  const admin = await requireAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let result;
  try {
    result = await deleteOauthCredsAndDisconnect(c.env, provider);
  } catch (e: any) {
    return c.json({ error: e?.message || 'delete_failed' }, 500);
  }
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_deleted', {
    provider,
    disconnected_users: result.disconnected_users,
  });
  return c.json({ ok: true, provider, ...result });
});

export default r;
