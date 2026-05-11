/**
 * Task #7 (2026-05-10) — Per-provider OAuth client credential store.
 *
 * Lets an admin configure SLACK_CLIENT_ID/SECRET (and the equivalents
 * for HubSpot, Salesforce, DocuSign) from the Admin UI without
 * redeploying the worker or running `wrangler secret put`. Each
 * provider's `ensureCreds()` calls `loadOauthCreds()` which checks
 * env vars FIRST (so an explicit deploy-time secret always wins) and
 * falls back to a row in `provider_oauth_keys`.
 *
 * Caching: per-isolate Map with a short TTL (60s). Invalidated on
 * write/delete. Workers are short-lived so this is just first-call
 * dedup within a request burst — not a long-lived cache.
 */
import type { Env } from '../types';
import { encryptString, decryptString } from './cryptoBox';

export type ManagedProviderKey = 'slack' | 'hubspot' | 'salesforce' | 'docusign';

export const MANAGED_PROVIDERS: ManagedProviderKey[] = ['slack', 'hubspot', 'salesforce', 'docusign'];

export interface ProviderEnvVarPair {
  id: string;
  secret: string;
}

/**
 * Map each managed provider to the env var names it has historically
 * read at deploy time. Kept as the SOLE source of truth so the admin
 * UI, the env-precedence check in `loadOauthCreds`, and the per-provider
 * `ensureCreds` calls can never disagree on what env vars to consult.
 */
export const PROVIDER_ENV_VARS: Record<ManagedProviderKey, { id: string; secret: string }> = {
  slack:      { id: 'SLACK_CLIENT_ID',      secret: 'SLACK_CLIENT_SECRET' },
  hubspot:    { id: 'HUBSPOT_CLIENT_ID',    secret: 'HUBSPOT_CLIENT_SECRET' },
  salesforce: { id: 'SF_CLIENT_ID',         secret: 'SF_CLIENT_SECRET' },
  docusign:   { id: 'DOCUSIGN_CLIENT_ID',   secret: 'DOCUSIGN_CLIENT_SECRET' },
};

interface CacheEntry {
  value: { id: string; secret: string; source: 'env' | 'db' } | null;
  exp: number;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<ManagedProviderKey, CacheEntry>();

let schemaEnsured = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaEnsured) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS provider_oauth_keys (
         provider_key       TEXT PRIMARY KEY,
         client_id          TEXT NOT NULL,
         client_secret_enc  TEXT NOT NULL,
         created_by_user_id INTEGER,
         created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_by_user_id INTEGER,
         updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    schemaEnsured = true;
  } catch (e) {
    console.warn('[providerOauthKeys] ensureSchema failed', e);
  }
}

function envCreds(env: Env, providerKey: ManagedProviderKey): ProviderEnvVarPair | null {
  const e = env as unknown as Record<string, string | undefined>;
  const map = PROVIDER_ENV_VARS[providerKey];
  const id = e[map.id];
  const secret = e[map.secret];
  if (id && secret) return { id, secret };
  return null;
}

/**
 * Primary lookup used by every provider's `ensureCreds()`. Returns
 * `null` if neither the env vars nor a DB row are configured — caller
 * is expected to throw `<provider>_oauth_unconfigured` so the route
 * layer can map to a 503 with an actionable error.
 */
export async function loadOauthCreds(
  env: Env,
  providerKey: ManagedProviderKey,
): Promise<{ id: string; secret: string; source: 'env' | 'db' } | null> {
  const now = Date.now();
  const hit = cache.get(providerKey);
  if (hit && hit.exp > now) return hit.value;

  // Env-first. Cache the env hit to skip the DB read on subsequent
  // calls within the TTL — important because `ensureCreds` is called
  // inside hot paths like `notify()` (Slack) and the OAuth refresh
  // loop (HubSpot/Salesforce/DocuSign).
  const env_ = envCreds(env, providerKey);
  if (env_) {
    const value = { id: env_.id, secret: env_.secret, source: 'env' as const };
    cache.set(providerKey, { value, exp: now + CACHE_TTL_MS });
    return value;
  }

  await ensureSchema(env);
  try {
    const row: any = await env.DB.prepare(
      `SELECT client_id, client_secret_enc FROM provider_oauth_keys WHERE provider_key = ?`,
    ).bind(providerKey).first();
    if (row?.client_id && row?.client_secret_enc) {
      const secret = await decryptString(env, String(row.client_secret_enc));
      if (secret) {
        const value = { id: String(row.client_id), secret, source: 'db' as const };
        cache.set(providerKey, { value, exp: now + CACHE_TTL_MS });
        return value;
      }
      // Decrypt failed (key rotation / tampered row). Treat as unconfigured.
      console.warn(`[providerOauthKeys] decrypt failed for ${providerKey} — treating as unconfigured`);
    }
  } catch (e) {
    console.warn(`[providerOauthKeys] DB read failed for ${providerKey}`, e);
  }

  cache.set(providerKey, { value: null, exp: now + CACHE_TTL_MS });
  return null;
}

/**
 * Task #3 — Rotate the secret for an EXISTING provider row in place.
 * Differs from setOauthCreds: client_id is left untouched (the
 * provider issues new secrets against the same client app, so
 * rotating doesn't change the public app identifier). Throws if no
 * row exists yet — caller should setOauthCreds() first.
 */
export async function rotateOauthSecret(
  env: Env,
  providerKey: ManagedProviderKey,
  newClientSecret: string,
  adminUserId: number,
): Promise<{ rotated_at: string }> {
  if (!newClientSecret.trim()) throw new Error('client_secret is required');
  await ensureSchema(env);
  const existing: any = await env.DB.prepare(
    `SELECT 1 FROM provider_oauth_keys WHERE provider_key = ?`,
  ).bind(providerKey).first();
  if (!existing) throw new Error('provider_not_configured');
  const enc = await encryptString(env, newClientSecret);
  await env.DB.prepare(
    `UPDATE provider_oauth_keys
        SET client_secret_enc  = ?,
            updated_by_user_id = ?,
            updated_at         = CURRENT_TIMESTAMP
      WHERE provider_key = ?`,
  ).bind(enc, adminUserId, providerKey).run();
  cache.delete(providerKey);
  return { rotated_at: new Date().toISOString() };
}

/** Admin upsert. Encrypts the secret before write. Invalidates cache. */
export async function setOauthCreds(
  env: Env,
  providerKey: ManagedProviderKey,
  clientId: string,
  clientSecret: string,
  adminUserId: number,
): Promise<void> {
  if (!clientId.trim() || !clientSecret.trim()) {
    throw new Error('client_id and client_secret are both required');
  }
  await ensureSchema(env);
  const enc = await encryptString(env, clientSecret);
  // ON CONFLICT (provider_key) DO UPDATE — singleton row per provider.
  await env.DB.prepare(
    `INSERT INTO provider_oauth_keys
       (provider_key, client_id, client_secret_enc, created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(provider_key) DO UPDATE SET
       client_id          = excluded.client_id,
       client_secret_enc  = excluded.client_secret_enc,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at         = CURRENT_TIMESTAMP`,
  ).bind(providerKey, clientId.trim(), enc, adminUserId, adminUserId).run();
  cache.delete(providerKey);
}

/**
 * Admin delete. Returns the number of `integrations` rows that were
 * forced into `status='disconnected'` as a side-effect — those users
 * will need to re-authorize once new keys are set.
 *
 * NOTE: We do NOT hard-delete the per-user `integrations` rows here:
 *  - The user picked their channel/preferences when they connected,
 *    and re-deleting them would silently drop those.
 *  - Marking `status='disconnected'` is what the marketplace UI
 *    already keys off when deciding to render a "Reconnect" button.
 *  - The user's encrypted token blob becomes useless against a new
 *    OAuth app anyway, so leaving it in place is harmless.
 */
export async function deleteOauthCredsAndDisconnect(
  env: Env,
  providerKey: ManagedProviderKey,
): Promise<{ removed_keys: boolean; disconnected_users: number }> {
  await ensureSchema(env);
  const del = await env.DB.prepare(
    `DELETE FROM provider_oauth_keys WHERE provider_key = ?`,
  ).bind(providerKey).run();
  const removed = ((del?.meta as any)?.changes ?? 0) > 0;

  let disconnected = 0;
  try {
    const upd = await env.DB.prepare(
      `UPDATE integrations
          SET status = 'disconnected',
              last_error = 'oauth_keys_revoked_by_admin',
              updated_at = CURRENT_TIMESTAMP
        WHERE provider_key = ? AND status = 'active'`,
    ).bind(providerKey).run();
    disconnected = Number((upd?.meta as any)?.changes ?? 0);
  } catch (e) {
    // `integrations` may not exist yet on a brand-new dev DB — non-fatal.
    console.warn('[providerOauthKeys] disconnect-cascade failed', e);
  }
  cache.delete(providerKey);
  return { removed_keys: removed, disconnected_users: disconnected };
}

/** Admin list — never returns the secret. `client_id_preview` is the
 *  full client_id (it's not a secret) so the UI can show "configured
 *  for app abc12345…". */
export interface ProviderKeyStatus {
  provider_key: ManagedProviderKey;
  source: 'env' | 'db' | 'unconfigured';
  has_keys: boolean;
  client_id_preview: string | null;
  updated_at: string | null;
  updated_by_user_id: number | null;
  active_integrations: number;
}

export async function listProviderKeyStatus(env: Env): Promise<ProviderKeyStatus[]> {
  await ensureSchema(env);
  let dbRows: Array<{ provider_key: string; client_id: string; updated_at: string; updated_by_user_id: number | null }> = [];
  try {
    const r: any = await env.DB.prepare(
      `SELECT provider_key, client_id, updated_at, updated_by_user_id FROM provider_oauth_keys`,
    ).all();
    dbRows = (r?.results || []) as typeof dbRows;
  } catch (e) {
    console.warn('[providerOauthKeys] list failed', e);
  }
  // Per-provider integration counts (best-effort — table may not exist yet).
  const counts = new Map<string, number>();
  try {
    const r: any = await env.DB.prepare(
      `SELECT provider_key, COUNT(*) AS n FROM integrations WHERE status = 'active' GROUP BY provider_key`,
    ).all();
    for (const row of (r?.results || []) as Array<{ provider_key: string; n: number }>) {
      counts.set(String(row.provider_key), Number(row.n));
    }
  } catch { /* table may not exist */ }
  const dbMap = new Map(dbRows.map(r => [r.provider_key, r] as const));
  return MANAGED_PROVIDERS.map((pk) => {
    const env_ = envCreds(env, pk);
    const db = dbMap.get(pk);
    let source: 'env' | 'db' | 'unconfigured' = 'unconfigured';
    let preview: string | null = null;
    if (env_) {
      source = 'env';
      preview = env_.id;
    } else if (db) {
      source = 'db';
      preview = db.client_id;
    }
    return {
      provider_key: pk,
      source,
      has_keys: source !== 'unconfigured',
      client_id_preview: preview,
      updated_at: db?.updated_at ?? null,
      updated_by_user_id: db?.updated_by_user_id ?? null,
      active_integrations: counts.get(pk) ?? 0,
    };
  });
}

/** Test hook — clears the in-isolate cache. Not exported via the route layer. */
export function _clearOauthCredsCache(): void {
  cache.clear();
}
