/**
 * Task #7 (2026-05-10) — Admin REST API for managing per-provider
 * OAuth client credentials. Mounted at `/api/admin/integration-keys`.
 *
 *  GET    /                  → list status for every managed provider (no secrets)
 *  PUT    /:provider         → upsert {client_id, client_secret}
 *                              → pushes BOTH as Cloudflare Worker secrets
 *                                via the CF API, deletes the encrypted DB row
 *  POST   /:provider/rotate  → push a fresh client_secret as a Worker secret
 *                              (wherever the key lives — D227: the console
 *                              offers rotate and remove for a key held as a
 *                              Worker secret too, which is where a save puts it)
 *  POST   /:provider/test    → dry-run probe against the provider
 *  DELETE /:provider         → delete both Worker secrets + cascade-disconnect
 *
 * D223 — WHO MAY WRITE. PUT, rotate and DELETE write (or delete) Worker
 * secrets on production's own `studioos` script, so they sit behind
 * `requireSuperAdminWriteBar` (a TOTP session, a recent step-up, the holder):
 * the same bar as the deploy dispatch those secrets sit beside. Before D223
 * they were `requireAdmin`, so every admin, a branch's included, could
 * overwrite a provider's OAuth pair.
 *
 * THE READS STAY `requireAdmin`, deliberately. `GET /` returns where each key
 * lives, the client-id preview (the public half of the pair) and a count of
 * connected users; `POST /:provider/test` exercises the configured pair
 * against the provider and changes nothing. Neither returns a secret or moves
 * one, and an admin triaging "Slack won't connect" needs both.
 *
 * Every write is audited ONCE through `logAdminAction` (D159's single
 * definition): one `activity_logs` row and one `admin_audit_log` row per
 * request, with the action names and the `provider` / `outcome` keys that
 * `readProviderKeyLastSet` (D213) matches.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import {
  MANAGED_PROVIDERS,
  PROVIDER_ENV_VARS,
  type ManagedProviderKey,
  rotateOauthSecret,
  deleteOauthCredsAndDisconnect,
  deleteOauthCredsRowOnly,
  listProviderKeyStatus,
  keyHeldAsWorkerSecret,
  _clearOauthCredsCache,
} from '../services/providerOauthKeys';
import { testOauthCreds } from '../services/providerOauthTest';
import { setSecret, deleteSecret, type CfSecretResult } from '../services/cloudflareSecrets';
import { refusalBody } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

function isManaged(k: string): k is ManagedProviderKey {
  return (MANAGED_PROVIDERS as readonly string[]).includes(k);
}

/**
 * The one audit write per request, through D159's `logAdminAction`.
 *
 * It replaced two hand-written INSERTs (an `activity_logs` row under one
 * action name and an `admin_audit_log` row under another), which is the drift
 * D159 consolidated. The details keep the keys D213's "last set" read matches:
 * `provider` and `outcome`, with `'failed'` for a refusal so a write Cloudflare
 * refused is never dated as a set.
 */
async function audit(
  env: Env,
  actor: { id: number; email: string },
  opts: { action: string; provider: ManagedProviderKey; envVars: string[]; outcome: 'ok' | 'failed'; cfStatus?: number; cfCode?: string; extra?: Record<string, unknown> },
): Promise<void> {
  await logAdminAction(env, actor.id, actor.email, opts.action, {
    provider: opts.provider,
    env_vars: opts.envVars,
    outcome: opts.outcome,
    cf_status: opts.cfStatus ?? null,
    cf_code: opts.cfCode ?? null,
    ...(opts.extra || {}),
  });
}

/** Map a CF helper failure into a structured 502 JSON body. */
function cfErrorJson(c: any, res: CfSecretResult, fallback = 'cf_api_failed') {
  const code = res.code || fallback;
  // 503 for missing-token (the admin can fix it by setting the env var);
  // 502 for upstream API failures so the frontend distinguishes from 4xx
  // input validation errors.
  const httpStatus = code === 'cloudflare_api_token_missing' ? 503 : 502;
  // D278 — Cloudflare's text is the admin's to read on `upstream`.
  return c.json(refusalBody({
    code,
    message: code === 'cloudflare_api_token_missing'
      ? 'The Cloudflare API token is not set, so keys cannot be changed from here.'
      : 'Cloudflare did not accept the change. Nothing changed; the upstream field says why.',
    raw: res.error || null,
    audience: 'admin',
    extra: { cf_status: res.status },
  }), httpStatus);
}

// D227 — each key carries `state` (env | db | unset | unreadable) and the
// payload carries `db_readable`, so a table that did not answer reads as
// "unknown" on the console rather than as "not configured". `providers` keeps
// its name and every field it had.
r.get('/', async (c) => {
  await requireAdmin(c);
  const status = await listProviderKeyStatus(c.env);
  return c.json({
    providers: status.items,
    db_readable: status.db_readable,
    ...(status.db_readable ? {} : {
      unreadable_reason:
        'The table that holds database-kept keys could not be read, so for any provider without a Worker '
        + 'secret it is unknown whether a key is kept there.',
    }),
  });
});

r.put('/:provider', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
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
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_push',
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
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_push',
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

  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_push',
    provider, envVars, outcome: 'ok', cfStatus: secretRes.status,
  });
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
  const admin = await requireSuperAdminWriteBar(c);
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
    // If a legacy DB row exists, keep the old rotate path as a fallback
    // so admins aren't locked out when CF API is unreachable. This
    // mirrors the spec's "Existing rows already in `provider_oauth_keys`
    // keep working until an admin re-saves them" requirement.
    //
    // ONE AUDIT ROW WHICHEVER WAY IT ENDS (D223): the fallback's success is
    // the outcome of this request, so it is recorded once, as a rotate that
    // landed in the table, rather than as a Cloudflare refusal followed by a
    // second row saying it worked after all.
    //
    // NOT FOR A KEY HELD AS A WORKER SECRET (D227). The Worker secret wins over
    // any row (`loadOauthCreds`), so rotating a row under it would answer "ok"
    // and change nothing a user's connection reads.
    if (res.code === 'cloudflare_api_token_missing' && !keyHeldAsWorkerSecret(c.env, provider)) {
      try {
        const rotated = await rotateOauthSecret(c.env, provider, clientSecret, admin.id);
        await audit(c.env, admin, {
          action: 'integration_key_cf_secret_rotate',
          provider, envVars, outcome: 'ok', cfStatus: res.status, cfCode: res.code,
          extra: { fallback: 'db' },
        });
        return c.json({ ok: true, provider, source: 'db', ...rotated });
      } catch { /* fall through to the CF error */ }
    }
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_rotate',
      provider, envVars, outcome: 'failed', cfStatus: res.status, cfCode: res.code,
    });
    return cfErrorJson(c, res);
  }

  await deleteOauthCredsRowOnly(c.env, provider);
  _clearOauthCredsCache();
  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_rotate',
    provider, envVars, outcome: 'ok', cfStatus: res.status,
  });
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
    return c.json(refusalBody({ code: 'test_failed', message: 'The key could not be tested. Try again in a moment.', raw: e, audience: 'admin' }), 500);
  }
  // A probe with production's credentials is a privileged act even though it
  // writes nothing, so it is recorded — through the same helper as the writes.
  await logAdminAction(c.env, admin.id, admin.email, 'integration_keys_tested', {
    provider, ok: result.ok, reachable: result.reachable, http_status: result.http_status ?? null,
  });
  return c.json({ provider, ...result });
});

r.delete('/:provider', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
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
    await audit(c.env, admin, {
      action: 'integration_key_cf_secret_delete',
      provider, envVars, outcome: 'failed', cfStatus: worst.status, cfCode: worst.code,
      extra: { id_ok: cfId.ok, secret_ok: cfSecret!.ok },
    });
    return cfErrorJson(c, worst);
  }

  let result;
  try {
    result = await deleteOauthCredsAndDisconnect(c.env, provider);
  } catch (e: any) {
    return c.json(refusalBody({ code: 'delete_failed', message: 'The key could not be deleted. Nothing changed; try again in a moment.', raw: e, audience: 'admin' }), 500);
  }

  await audit(c.env, admin, {
    action: 'integration_key_cf_secret_delete',
    provider, envVars,
    outcome: cfId.code === 'cloudflare_api_token_missing' ? 'failed' : 'ok',
    cfStatus: cfSecret.status,
    cfCode: cfId.code === 'cloudflare_api_token_missing' ? cfId.code : undefined,
    extra: { disconnected_users: result.disconnected_users, removed_keys: result.removed_keys },
  });
  return c.json({ ok: true, provider, ...result, cf_token_missing: cfId.code === 'cloudflare_api_token_missing' });
});

export default r;
