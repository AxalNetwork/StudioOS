/**
 * Task #7 — Cloudflare Worker secrets management client.
 *
 * Thin wrapper around the Cloudflare API endpoints that manage Worker
 * script secrets. Used by the admin Integration Keys route to promote
 * admin-entered Client ID / Client Secret pairs into real Worker
 * secrets (so they live alongside the other env-pinned secrets and
 * `loadOauthCreds()`'s env-first lookup picks them up automatically
 * on the next isolate boot).
 *
 * Endpoints:
 *   PUT    /accounts/{account_id}/workers/scripts/{script}/secrets
 *           body: { name, text, type: 'secret_text' }
 *   DELETE /accounts/{account_id}/workers/scripts/{script}/secrets/{name}
 *
 * Required env (Worker secrets):
 *   - CLOUDFLARE_API_TOKEN     — scoped to `Workers Scripts: Edit`
 *   - CLOUDFLARE_ACCOUNT_ID    — 32-hex account UUID (reused from analytics)
 *   - CF_WORKER_SCRIPT_NAME    — defaults to 'studioos' (the prod script name)
 *
 * Never logs token values. Returns a structured result the caller maps
 * to a stable error code (`cloudflare_api_token_missing`,
 * `cf_api_forbidden`, `cf_api_failed`) for the UI toast.
 */
import type { Env } from '../types';

export interface CfSecretResult {
  ok: boolean;
  status: number;
  /** Stable error code for the route layer to surface to the UI. */
  code?: 'cloudflare_api_token_missing' | 'cf_api_forbidden' | 'cf_api_failed';
  /** Short human-readable detail (no token values, no secret values). */
  error?: string;
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function resolveConfig(env: Env): { token: string; accountId: string; script: string } | { missing: true } {
  const e = env as unknown as Record<string, string | undefined>;
  const token = e.CLOUDFLARE_API_TOKEN;
  const accountId = e.CLOUDFLARE_ACCOUNT_ID;
  const script = e.CF_WORKER_SCRIPT_NAME || 'studioos';
  if (!token || !accountId) return { missing: true };
  return { token, accountId, script };
}

function classifyError(status: number, body: string): CfSecretResult {
  // Trim body to avoid leaking large responses into logs / audit rows.
  const detail = (body || '').slice(0, 300);
  if (status === 401 || status === 403) {
    return { ok: false, status, code: 'cf_api_forbidden', error: detail || 'Cloudflare API rejected the token (401/403).' };
  }
  return { ok: false, status, code: 'cf_api_failed', error: detail || `Cloudflare API call failed (${status}).` };
}

/**
 * Push a single Worker secret. Overwrites any existing value with the
 * same name. The Cloudflare API treats PUT as upsert.
 */
export async function setSecret(env: Env, name: string, value: string): Promise<CfSecretResult> {
  const cfg = resolveConfig(env);
  if ('missing' in cfg) {
    return {
      ok: false,
      status: 0,
      code: 'cloudflare_api_token_missing',
      error: 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set as Worker secrets before integration keys can be promoted.',
    };
  }
  if (!name || !value) {
    return { ok: false, status: 0, code: 'cf_api_failed', error: 'secret name and value are required' };
  }
  let res: Response;
  try {
    res = await fetch(
      `${CF_API_BASE}/accounts/${encodeURIComponent(cfg.accountId)}/workers/scripts/${encodeURIComponent(cfg.script)}/secrets`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, text: value, type: 'secret_text' }),
      },
    );
  } catch (e: any) {
    // Network / fetch failure — never includes a token value.
    return { ok: false, status: 0, code: 'cf_api_failed', error: `network: ${String(e?.message || e).slice(0, 200)}` };
  }
  if (res.ok) return { ok: true, status: res.status };
  const body = await res.text().catch(() => '');
  return classifyError(res.status, body);
}

/**
 * Delete a single Worker secret by name. Treats 404 as success (the
 * secret is already absent — idempotent delete).
 */
export async function deleteSecret(env: Env, name: string): Promise<CfSecretResult> {
  const cfg = resolveConfig(env);
  if ('missing' in cfg) {
    return {
      ok: false,
      status: 0,
      code: 'cloudflare_api_token_missing',
      error: 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set as Worker secrets before integration keys can be promoted.',
    };
  }
  if (!name) return { ok: false, status: 0, code: 'cf_api_failed', error: 'secret name is required' };
  let res: Response;
  try {
    res = await fetch(
      `${CF_API_BASE}/accounts/${encodeURIComponent(cfg.accountId)}/workers/scripts/${encodeURIComponent(cfg.script)}/secrets/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cfg.token}` },
      },
    );
  } catch (e: any) {
    return { ok: false, status: 0, code: 'cf_api_failed', error: `network: ${String(e?.message || e).slice(0, 200)}` };
  }
  if (res.ok || res.status === 404) return { ok: true, status: res.status };
  const body = await res.text().catch(() => '');
  return classifyError(res.status, body);
}

/**
 * Mask a Client ID for safe display in the admin UI. Returns
 * `first4••••last4` when the value is at least 8 chars, otherwise
 * `null` (too short to mask meaningfully without leaking the whole
 * value).
 */
export function maskClientId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw);
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
