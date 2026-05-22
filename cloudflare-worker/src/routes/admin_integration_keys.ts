/**
 * Task #7 (2026-05-10) — Admin REST API for managing per-provider
 * OAuth client credentials. Mounted at `/api/admin/integration-keys`.
 *
 *  GET    /                  → list status for every managed provider (no secrets)
 *  PUT    /:provider         → upsert {client_id, client_secret}
 *                              → pushes BOTH as Cloudflare Worker secrets
 *                                via the CF API, deletes the encrypted DB row
 *  POST   /:provider/rotate  → push a fresh client_secret as a Worker secret
 *  POST   /:provider/test    → dry-run probe against the provider
 *  DELETE /:provider         → delete both Worker secrets + cascade-disconnect
 *
 * Every route gates on `requireAdmin`. Writes are logged to both
 * `activity_logs` (hashed actor, T22.1) and `admin_audit_log` for the
 * Cloudflare-secret push / rotate / delete actions.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import {
  MANAGED_PROVIDERS,
  PROVIDER_ENV_VARS,
  type ManagedProviderKey,
  rotateOauthSecret,
  deleteOauthCredsAndDisconnect,
  deleteOauthCredsRowOnly,
  listProviderKeyStatus,
  _clearOauthCredsCache,
} from '../services/providerOauthKeys';
import { testOauthCreds } from '../services/providerOauthTest';
import { setSecret, deleteSecret, type CfSecretResult } from '../services/cloudflareSecrets';

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
    const actor = adminEmail ? await hashEmail(adminEmail) : null;
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actor, adminUserId).run();
  } catch (e) {
    console.warn('[admin_integration_keys] activity log failed', e);
  }
}

// admin_audit_log writer. Mirrors the shape used by routes/admin_telegram.ts
// (`telegram_pii_override`) — same `report_type` convention, same actor
// column tolerance for the legacy schema without `actor`.
let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const r = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all<{ name: string }>();
    _auditHasActor = (r.results || []).some((c) => String(c.name) === 'actor');
  } catch {
    _auditHasActor = false;
  }
  return _auditHasActor;
}
async function writeAudit(
  env: Env,
  opts: { adminId: number; adminEmail: string | null; action: string; provider: ManagedProviderKey; envVars: string[]; outcome: 'ok' | 'failed'; cfStatus?: number; cfCode?: string; extra?: Record<string, unknown> },
): Promise<void> {
  try {
    const filters = JSON.stringify({
      provider: opts.provider,
      env_vars: opts.envVars,
      outcome: opts.outcome,
      cf_status: opts.cfStatus ?? null,
      cf_code: opts.cfCode ?? null,
      ...(opts.extra || {}),
    });
    const reportType = 'integration_keys';
    if (await auditHasActor(env)) {
      const actor = opts.adminEmail ? await hashEmail(opts.adminEmail) : null;
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor) VALUES (?, ?, ?, ?, ?)`,
      ).bind(opts.adminId, opts.action, reportType, filters, actor).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, ?, ?)`,
      ).bind(opts.adminId, opts.action, reportType, filters).run();
    }
  } catch (e) {
    console.warn('[admin_integration_keys] audit write failed', (e as Error).message);
  }
}

/** Map a CF helper failure into a structured 502 JSON body. */
function cfErrorJson(c: any, res: CfSecretResult, fallback = 'cf_api_failed') {
  const code = res.code || fallback;
  // 503 for missing-token (the admin can fix it by setting the env var);
  // 502 for upstream API failures so the frontend distinguishes from 4xx
  // input validation errors.
  const httpStatus = code === 'cloudflare_api_token_missing' ? 503 : 502;
  return c.json({ error: code, detail: res.error || null, cf_status: res.status }, httpStatus);
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
  if (clientId.length > 4096 || clientSecret.length > 4096) {
    return c.json({ error: 'value_too_long' }, 400);
  }

  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.id, envMap.secret];

  // Push the client_id first. On failure we haven't touched anything yet.
  const idRes = await setSecret(c.env, envMap.id, clientId);
  if (!idRes.ok) {
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_push',
      provider, envVars, outcome: 'failed', cfStatus: idRes.status, cfCode: idRes.code,
    });
    return cfErrorJson(c, idRes);
  }
  // Push the client_secret. If this fails, roll back the client_id push
  // so we don't leave the pair half-set. Best-effort delete — even if
  // the rollback fails, the DB row was never written so re-trying the
  // save is still safe.
  const secretRes = await setSecret(c.env, envMap.secret, clientSecret);
  if (!secretRes.ok) {
    const rollback = await deleteSecret(c.env, envMap.id);
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_push',
      provider, envVars, outcome: 'failed', cfStatus: secretRes.status, cfCode: secretRes.code,
      extra: { rollback_ok: rollback.ok, rollback_status: rollback.status },
    });
    return cfErrorJson(c, secretRes);
  }

  // CF API push succeeded — drop any stale encrypted DB row WITHOUT
  // cascading status='disconnected' on user integrations (the
  // credentials are now live as Worker secrets, so existing OAuth
  // tokens issued under the same client_id remain valid).
  await deleteOauthCredsRowOnly(c.env, provider);
  _clearOauthCredsCache();

  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_push',
    provider, envVars, outcome: 'ok', cfStatus: secretRes.status,
  });
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_set', { provider, env_vars: envVars });
  // `source: 'env'` is the cosmetic post-promote state — the next
  // /api/admin/integration-keys GET will reflect the live env binding
  // (CF Worker isolates pick up new secrets on next boot; existing
  // isolates keep the env they booted with, but the panel renders fresh
  // from the next request's env so the UI will flip correctly).
  return c.json({ ok: true, provider, source: 'env', env_vars: envVars });
});

// Rotate the secret. Pushes a fresh client_secret as a CF Worker
// secret (the client_id is left untouched — providers issue new
// secrets against the same client app). Also drops any stale DB row.
r.post('/:provider/rotate', async (c) => {
  const admin = await requireAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let body: { client_secret?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body → 400 below */ }
  const clientSecret = String(body.client_secret || '').trim();
  if (!clientSecret) {
    return c.json({ error: 'client_secret_required' }, 400);
  }
  if (clientSecret.length > 4096) {
    return c.json({ error: 'value_too_long' }, 400);
  }
  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.secret];

  const res = await setSecret(c.env, envMap.secret, clientSecret);
  if (!res.ok) {
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_rotate',
      provider, envVars, outcome: 'failed', cfStatus: res.status, cfCode: res.code,
    });
    // If a legacy DB row exists, keep the old rotate path as a fallback
    // so admins aren't locked out when CF API is unreachable. This
    // mirrors the spec's "Existing rows already in `provider_oauth_keys`
    // keep working until an admin re-saves them" requirement.
    if (res.code === 'cloudflare_api_token_missing') {
      try {
        const rotated = await rotateOauthSecret(c.env, provider, clientSecret, admin.id);
        await logActivity(c.env, admin.id, admin.email, 'integration_keys_rotated', { provider, fallback: 'db' });
        return c.json({ ok: true, provider, source: 'db', ...rotated });
      } catch { /* fall through to the CF error */ }
    }
    return cfErrorJson(c, res);
  }

  await deleteOauthCredsRowOnly(c.env, provider);
  _clearOauthCredsCache();
  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_rotate',
    provider, envVars, outcome: 'ok', cfStatus: res.status,
  });
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_rotated', { provider, env_vars: envVars });
  return c.json({ ok: true, provider, source: 'env', rotated_at: new Date().toISOString() });
});

// Dry-run a provider auth call to verify the configured credentials.
r.post('/:provider/test', async (c) => {
  const admin = await requireAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  let result;
  try {
    result = await testOauthCreds(c.env, provider);
  } catch (e: any) {
    return c.json({ error: e?.message || 'test_failed' }, 500);
  }
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_tested', {
    provider, ok: result.ok, reachable: result.reachable, http_status: result.http_status ?? null,
  });
  return c.json({ provider, ...result });
});

r.delete('/:provider', async (c) => {
  const admin = await requireAdmin(c);
  const provider = c.req.param('provider');
  if (!isManaged(provider)) {
    return c.json({ error: 'unknown_provider', allowed: MANAGED_PROVIDERS }, 400);
  }
  const envMap = PROVIDER_ENV_VARS[provider];
  const envVars = [envMap.id, envMap.secret];

  // Delete BOTH CF Worker secrets first. Both deletes are idempotent
  // (404 → ok). If the API token is missing we still want to clear
  // the DB row + cascade-disconnect, so we don't bail on token-missing
  // here — we just skip the CF call and rely on the existing DB delete.
  let cfId: CfSecretResult | null = null;
  let cfSecret: CfSecretResult | null = null;
  cfId = await deleteSecret(c.env, envMap.id);
  cfSecret = await deleteSecret(c.env, envMap.secret);
  const cfOk = (cfId.ok && cfSecret.ok) || cfId.code === 'cloudflare_api_token_missing';
  // If the API token is configured but the call genuinely failed
  // (4xx/5xx), surface the error rather than silently leaving the
  // Worker secret in place — admin needs to know the env vars are
  // still live.
  if (!cfOk && cfId.code !== 'cloudflare_api_token_missing') {
    const worst = !cfId.ok ? cfId : cfSecret!;
    await writeAudit(c.env, {
      adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_delete',
      provider, envVars, outcome: 'failed', cfStatus: worst.status, cfCode: worst.code,
      extra: { id_ok: cfId.ok, secret_ok: cfSecret!.ok },
    });
    return cfErrorJson(c, worst);
  }

  let result;
  try {
    result = await deleteOauthCredsAndDisconnect(c.env, provider);
  } catch (e: any) {
    return c.json({ error: e?.message || 'delete_failed' }, 500);
  }

  await writeAudit(c.env, {
    adminId: admin.id, adminEmail: admin.email, action: 'integration_key_cf_secret_delete',
    provider, envVars,
    outcome: cfId.code === 'cloudflare_api_token_missing' ? 'failed' : 'ok',
    cfStatus: cfSecret.status,
    cfCode: cfId.code === 'cloudflare_api_token_missing' ? cfId.code : undefined,
    extra: { disconnected_users: result.disconnected_users, removed_keys: result.removed_keys },
  });
  await logActivity(c.env, admin.id, admin.email, 'integration_keys_deleted', {
    provider, env_vars: envVars, disconnected_users: result.disconnected_users,
  });
  return c.json({ ok: true, provider, ...result, cf_token_missing: cfId.code === 'cloudflare_api_token_missing' });
});

export default r;
