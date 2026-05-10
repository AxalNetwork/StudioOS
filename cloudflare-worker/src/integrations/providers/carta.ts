/**
 * Task #5 — Carta provider.
 *
 * Read-only OAuth integration that mirrors the founder's Carta cap table
 * (issuer / stakeholders / securities) into local D1 tables
 * `cap_table_holders` + `cap_table_securities` with `source='carta'`.
 *
 * Scopes: `read:cap_table read:stakeholders read:securities`.
 * Cron cadence: every 6 hours (gated in index.ts).
 *
 * Disconnect flips Carta-sourced rows to `source='manual'` (rows preserved,
 * no destructive delete) and best-effort revokes the refresh token.
 *
 * Out of scope: write-back to Carta, Pulley, 409A artefact pulls.
 *
 * IMPORTANT: imported once from index.ts so registerProvider() runs at boot.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import {
  registerProvider,
  REGISTRY,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import { decryptCredentials, encryptCredentials, type CredentialBlob } from '../secrets';

const PROVIDER_KEY = 'carta';
const AUTH_HOST = 'https://login.carta.com';
const API_BASE = 'https://api.carta.com/v1alpha1';
const SCOPES = ['read:cap_table', 'read:stakeholders', 'read:securities'];

function redirectUri(env: Env): string {
  const base = (env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

function ensureCreds(env: Env): { id: string; secret: string } {
  const id = (env as unknown as Record<string, string | undefined>).CARTA_CLIENT_ID;
  const secret = (env as unknown as Record<string, string | undefined>).CARTA_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('carta_oauth_unconfigured: CARTA_CLIENT_ID/CARTA_CLIENT_SECRET secrets must be set on the worker.');
  }
  return { id, secret };
}

interface CartaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

async function exchangeCode(env: Env, code: string, codeVerifier: string | null): Promise<CartaTokenResponse> {
  const { id, secret } = ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(env),
    client_id: id,
    client_secret: secret,
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const res = await fetch(`${AUTH_HOST}/o/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`carta_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as CartaTokenResponse;
}

async function refreshAccessToken(env: Env, refreshToken: string): Promise<CartaTokenResponse> {
  const { id, secret } = ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
  });
  const res = await fetch(`${AUTH_HOST}/o/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`carta_refresh_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as CartaTokenResponse;
}

async function refreshAndPersist(env: Env, row: IntegrationRow): Promise<string> {
  const lockKey = `carta:refresh:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 30 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra may be unavailable */ }

  const reread = async (): Promise<CredentialBlob | null> => {
    const fresh = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').bind(row.id).first<{ credentials_enc: string }>();
    if (!fresh?.credentials_enc) return null;
    return await decryptCredentials(env, row.uid, fresh.credentials_enc);
  };

  if (!acquired) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const after = await reread();
      const at = typeof after?.access_token === 'string' ? after.access_token : '';
      if (at && at !== (await decryptCredentials(env, row.uid, row.credentials_enc))?.access_token) {
        return at;
      }
    }
  }

  try {
    const creds = await reread();
    const refreshToken = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (!refreshToken) throw new Error('carta_refresh_token_missing');
    const refreshed = await refreshAccessToken(env, refreshToken);
    const newCreds: CredentialBlob = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      token_type: refreshed.token_type || 'Bearer',
      issued_at: Date.now(),
      expires_in: refreshed.expires_in || null,
    };
    const enc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET credentials_enc = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, row.id).run();
    return refreshed.access_token;
  } finally {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

async function getActiveAccessToken(env: Env, row: IntegrationRow): Promise<string> {
  const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('carta_credentials_missing');
  const at = typeof creds.access_token === 'string' ? creds.access_token : '';
  if (!at) throw new Error('carta_credentials_incomplete');
  return at;
}

async function cartaFetch(env: Env, row: IntegrationRow, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getActiveAccessToken(env, row);
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    token = await refreshAndPersist(env, row);
    const headers2 = new Headers(init.headers || {});
    headers2.set('Authorization', `Bearer ${token}`);
    headers2.set('Accept', 'application/json');
    if (init.body && !headers2.has('Content-Type')) headers2.set('Content-Type', 'application/json');
    res = await fetch(url, { ...init, headers: headers2 });
  }
  return res;
}

// ───────────────────────────────────────────────────────────── connect

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) {
    throw new Error('carta_requires_oauth_code: complete the OAuth handshake first.');
  }
  const cfg = (input.config || {}) as Record<string, unknown>;
  const verifier = typeof cfg.pkce_verifier === 'string' ? cfg.pkce_verifier : null;
  const tokens = await exchangeCode(c.env, input.oauth_code, verifier);
  if (!tokens.refresh_token) {
    throw new Error(
      'carta_no_refresh_token: Carta did not return a refresh_token. Reconnect and grant offline access.',
    );
  }
  const credentials: CredentialBlob = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    issued_at: Date.now(),
    expires_in: tokens.expires_in || null,
  };

  // Pick the first issuer the user has access to as the active issuer.
  // Carta's read endpoints are scoped to an issuer id; we persist it on
  // the integration row so subsequent syncs hit the same company. We
  // bypass the `cartaFetch` helper here because the integration row
  // doesn't exist in DB yet (the route layer inserts it after `connect`
  // returns), so refresh-on-401 isn't applicable.
  let issuerId: string | null = null;
  let issuerName: string | null = null;
  try {
    const res = await fetch(`${API_BASE}/issuers`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const out = await res.json() as { issuers?: Array<{ id: string; legal_name?: string; name?: string }>; results?: Array<{ id: string; legal_name?: string; name?: string }> };
      const arr = out.issuers || out.results || [];
      if (arr.length > 0) {
        issuerId = arr[0].id;
        issuerName = arr[0].legal_name || arr[0].name || null;
      }
    }
  } catch { /* non-fatal — sync will retry issuer discovery */ }

  return {
    credentials,
    scopes: SCOPES,
    external_account_id: issuerId,
    external_account_name: issuerName,
    capabilities: ['Cap-table sync', 'Stakeholder import', 'Securities import'],
    config: {
      issuer_id: issuerId,
      issuer_name: issuerName,
    },
  };
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = ensureCreds(c.env);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(c.env),
    scope: SCOPES.join(' '),
    state,
  });
  // Recover PKCE challenge from oauth_state_tokens.extra_json (foundation
  // stashes it there). Carta supports PKCE on confidential clients too.
  try {
    const row = await c.env.DB.prepare(
      'SELECT extra_json FROM oauth_state_tokens WHERE state = ?',
    ).bind(state).first<{ extra_json: string | null }>();
    if (row?.extra_json) {
      const extra = JSON.parse(row.extra_json) as Record<string, unknown>;
      const challenge = typeof extra.challenge === 'string' ? extra.challenge : '';
      if (challenge) {
        params.set('code_challenge', challenge);
        params.set('code_challenge_method', 'S256');
      }
    }
  } catch { /* PKCE optional */ }
  return `${AUTH_HOST}/o/authorize/?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── sync

interface CartaStakeholder {
  id: string;
  name?: string;
  legal_name?: string;
  email?: string;
  type?: string;          // INDIVIDUAL / ENTITY
}

interface CartaSecurity {
  id: string;
  stakeholder_id?: string;
  share_class?: string;
  security_type?: string; // common_stock / preferred / option / safe / convertible
  quantity?: number;
  shares?: number;
  shares_authorized?: number;
  shares_issued?: number;
  name?: string;
}

async function fetchAllPages<T>(env: Env, row: IntegrationRow, firstPath: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let path: string | null = firstPath;
  let pages = 0;
  while (path && pages < 50) {
    const res: Response = await cartaFetch(env, row, path);
    if (!res.ok) throw new Error(`carta_fetch_failed: ${res.status} ${path}`);
    const body = await res.json() as Record<string, unknown>;
    const arr = (body[key] as T[]) || (body.results as T[]) || [];
    for (const r of arr) out.push(r);
    const next = body.next || (body as Record<string, Record<string, string>>).links?.next;
    path = (typeof next === 'string' && next) ? next : null;
    pages++;
  }
  return out;
}

async function ensureIssuer(env: Env, row: IntegrationRow): Promise<{ id: string; name: string | null }> {
  const cfg = row.config_json ? safeParse(row.config_json) : {};
  let issuerId = typeof cfg.issuer_id === 'string' ? cfg.issuer_id : null;
  let issuerName = typeof cfg.issuer_name === 'string' ? cfg.issuer_name : null;
  if (issuerId) return { id: issuerId, name: issuerName };
  // Lazy discover.
  const res = await cartaFetch(env, row, '/issuers');
  if (!res.ok) throw new Error(`carta_issuers_lookup_failed: ${res.status}`);
  const out = await res.json() as { issuers?: Array<{ id: string; legal_name?: string; name?: string }>; results?: Array<{ id: string; legal_name?: string; name?: string }> };
  const arr = out.issuers || out.results || [];
  if (arr.length === 0) throw new Error('carta_no_issuer_access');
  issuerId = arr[0].id;
  issuerName = arr[0].legal_name || arr[0].name || null;
  const newCfg = { ...cfg, issuer_id: issuerId, issuer_name: issuerName };
  await env.DB.prepare('UPDATE integrations SET config_json = ? WHERE id = ?')
    .bind(JSON.stringify(newCfg), row.id).run();
  return { id: issuerId, name: issuerName };
}

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  const counts = { pulled: 0, holders: 0, securities: 0, errors: 0 };
  const issuer = await ensureIssuer(c.env, row);

  // Fetch stakeholders + securities in parallel.
  let stakeholders: CartaStakeholder[] = [];
  let securities: CartaSecurity[] = [];
  try {
    const [sh, sec] = await Promise.all([
      fetchAllPages<CartaStakeholder>(c.env, row, `/issuers/${encodeURIComponent(issuer.id)}/stakeholders`, 'stakeholders'),
      fetchAllPages<CartaSecurity>(c.env, row, `/issuers/${encodeURIComponent(issuer.id)}/securities`, 'securities'),
    ]);
    stakeholders = sh;
    securities = sec;
  } catch (e) {
    counts.errors++;
    throw e;
  }

  // ── Securities upsert (share classes / option pools / preferred rounds).
  const seenSecurityIds = new Set<string>();
  for (const s of securities) {
    if (!s.id) continue;
    seenSecurityIds.add(s.id);
    const name = s.name || s.share_class || s.security_type || `Security ${s.id.slice(0, 8)}`;
    try {
      await c.env.DB.prepare(
        'INSERT INTO cap_table_securities (user_id, name, share_class, shares_authorized, shares_issued, source, carta_id) ' +
        "VALUES (?, ?, ?, ?, ?, 'carta', ?) " +
        'ON CONFLICT(user_id, carta_id) WHERE carta_id IS NOT NULL DO UPDATE SET ' +
        'name = excluded.name, share_class = excluded.share_class, ' +
        'shares_authorized = excluded.shares_authorized, shares_issued = excluded.shares_issued, ' +
        "source = 'carta', updated_at = CURRENT_TIMESTAMP",
      ).bind(
        row.user_id,
        name,
        s.share_class || s.security_type || null,
        s.shares_authorized ?? null,
        s.shares_issued ?? s.quantity ?? s.shares ?? null,
        s.id,
      ).run();
      counts.securities++;
    } catch { counts.errors++; }
  }

  // ── Holders upsert (one row per stakeholder × security pairing). We
  // collapse to one row per stakeholder when no securities are reported,
  // otherwise create one row per holding so the UI can show class detail.
  const securitiesByStakeholder = new Map<string, CartaSecurity[]>();
  for (const s of securities) {
    if (!s.stakeholder_id) continue;
    const arr = securitiesByStakeholder.get(s.stakeholder_id) || [];
    arr.push(s);
    securitiesByStakeholder.set(s.stakeholder_id, arr);
  }
  const seenHolderKeys = new Set<string>(); // `${stakeholderId}:${securityId|''}`
  for (const sh of stakeholders) {
    if (!sh.id) continue;
    const name = sh.legal_name || sh.name || `Stakeholder ${sh.id.slice(0, 8)}`;
    const email = sh.email || null;
    const type = (sh.type || '').toLowerCase() || null;
    const holdings = securitiesByStakeholder.get(sh.id) || [];
    if (holdings.length === 0) {
      // Empty-string sentinel (NOT NULL) for `carta_security_id` because
      // SQLite/D1 UNIQUE indexes treat NULLs as distinct — using NULL
      // here would re-insert (duplicate) the holder row on every sync.
      // Reconcile already uses `|| ''` to recompute the same key.
      seenHolderKeys.add(`${sh.id}:`);
      try {
        await c.env.DB.prepare(
          'INSERT INTO cap_table_holders (user_id, name, email, security_type, shares, source, carta_stakeholder_id, carta_security_id) ' +
          "VALUES (?, ?, ?, ?, 0, 'carta', ?, '') " +
          'ON CONFLICT(user_id, carta_stakeholder_id, carta_security_id) WHERE carta_stakeholder_id IS NOT NULL DO UPDATE SET ' +
          "name = excluded.name, email = excluded.email, security_type = excluded.security_type, source = 'carta', updated_at = CURRENT_TIMESTAMP",
        ).bind(row.user_id, name, email, type, sh.id).run();
        counts.holders++;
      } catch { counts.errors++; }
    } else {
      for (const h of holdings) {
        seenHolderKeys.add(`${sh.id}:${h.id}`);
        const shares = h.quantity ?? h.shares ?? h.shares_issued ?? 0;
        try {
          await c.env.DB.prepare(
            'INSERT INTO cap_table_holders (user_id, name, email, security_type, shares, source, carta_stakeholder_id, carta_security_id) ' +
            "VALUES (?, ?, ?, ?, ?, 'carta', ?, ?) " +
            'ON CONFLICT(user_id, carta_stakeholder_id, carta_security_id) WHERE carta_stakeholder_id IS NOT NULL DO UPDATE SET ' +
            "name = excluded.name, email = excluded.email, security_type = excluded.security_type, " +
            "shares = excluded.shares, source = 'carta', updated_at = CURRENT_TIMESTAMP",
          ).bind(
            row.user_id, name, email,
            h.share_class || h.security_type || type,
            shares, sh.id, h.id,
          ).run();
          counts.holders++;
        } catch { counts.errors++; }
      }
    }
  }
  counts.pulled = counts.holders + counts.securities;

  // ── Reconcile: anything currently in DB with source='carta' for this
  // user that we no longer see in the upstream feed gets flipped back to
  // 'manual' (rather than deleted) so the founder can keep the row if it
  // was the last view of a now-removed Carta entry. This mirrors the
  // disconnect semantics.
  try {
    const existingHolders = await c.env.DB.prepare(
      "SELECT id, carta_stakeholder_id, carta_security_id FROM cap_table_holders WHERE user_id = ? AND source = 'carta'",
    ).bind(row.user_id).all<{ id: number; carta_stakeholder_id: string | null; carta_security_id: string | null }>();
    for (const h of (existingHolders.results || [])) {
      const key = `${h.carta_stakeholder_id || ''}:${h.carta_security_id || ''}`;
      if (!seenHolderKeys.has(key) && h.carta_stakeholder_id) {
        await c.env.DB.prepare(
          "UPDATE cap_table_holders SET source = 'manual', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).bind(h.id).run();
      }
    }
    const existingSecurities = await c.env.DB.prepare(
      "SELECT id, carta_id FROM cap_table_securities WHERE user_id = ? AND source = 'carta'",
    ).bind(row.user_id).all<{ id: number; carta_id: string | null }>();
    for (const s of (existingSecurities.results || [])) {
      if (s.carta_id && !seenSecurityIds.has(s.carta_id)) {
        await c.env.DB.prepare(
          "UPDATE cap_table_securities SET source = 'manual', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).bind(s.id).run();
      }
    }
  } catch { /* non-fatal reconcile */ }

  return {
    summary: `pulled holders=${counts.holders} securities=${counts.securities} errors=${counts.errors}`,
    counts,
  };
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  // Flip Carta-sourced rows back to manual; rows are PRESERVED.
  try {
    await c.env.DB.prepare(
      "UPDATE cap_table_holders SET source = 'manual', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'carta'",
    ).bind(row.user_id).run();
    await c.env.DB.prepare(
      "UPDATE cap_table_securities SET source = 'manual', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'carta'",
    ).bind(row.user_id).run();
  } catch (e) {
    console.warn('[carta] disconnect flip-to-manual failed:', (e as Error).message);
  }

  // Best-effort token revoke.
  try {
    const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    const refresh = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (refresh) {
      const { id, secret } = ensureCreds(c.env);
      const body = new URLSearchParams({
        token: refresh,
        client_id: id,
        client_secret: secret,
      });
      await fetch(`${AUTH_HOST}/o/revoke_token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    }
  } catch (e) {
    console.warn('[carta] revoke failed (non-fatal):', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── validateConfig

function validateConfig(
  patch: Record<string, unknown>,
  _existing: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const ALLOWED = new Set(['issuer_id', 'issuer_name']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown_config_key: ${k}` };
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'string' || v.length > 200) return { ok: false, error: `invalid_${k}` };
    out[k] = v;
  }
  return { ok: true, patch: out };
}

// ───────────────────────────────────────────────────────────── side-effects

/**
 * Fire-and-forget hook the integrations route invokes via `waitUntil`
 * after a fresh connect (both the api-key path and the OAuth callback).
 * Eliminates the up-to-6-hour "dead period" until the first cron tick by
 * running an immediate first sync. Errors are non-fatal — the cron will
 * retry on its normal cadence.
 */
async function postConnect(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void> {
  try {
    // Re-load row to pick up the freshly-persisted issuer_id config the
    // `connect()` call discovered (it's written by the integrations route
    // layer right before postConnect fires).
    const fresh = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
      .bind(row.id).first<IntegrationRow>();
    if (fresh) {
      await sync(c, user, fresh);
      // sync() itself does NOT touch `integrations.last_synced_at` —
      // the route layer (and the cron) wrap it. postConnect bypasses
      // both, so update it here so the UI banner flips from "awaiting
      // first sync" to "synced N min ago" without waiting on cron.
      await c.env.DB.prepare(
        "UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?",
      ).bind(row.id).run();
    }
  } catch (e) {
    console.warn('[carta] postConnect first sync:', (e as Error).message);
    try {
      await c.env.DB.prepare(
        "UPDATE integrations SET last_error = ? WHERE id = ?",
      ).bind(((e as Error).message || 'first_sync_failed').slice(0, 500), row.id).run();
    } catch { /* swallow — the cron will retry */ }
  }
}

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  sync,
  disconnect,
  validateConfig,
  postConnect,
};
registerProvider(impl);
void REGISTRY;

/**
 * Cron entry-point. Iterates every active carta integration and runs sync.
 * Per-integration error isolation. Called from index.ts scheduled() on a
 * 6-hour cadence.
 */
export async function syncAllCartaIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  let scanned = 0, ok = 0, failed = 0;
  let rows: { results: IntegrationRow[] };
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM integrations WHERE provider_key = 'carta' AND status = 'active' LIMIT 200",
    ).all<IntegrationRow>() as unknown as { results: IntegrationRow[] };
  } catch {
    return { scanned: 0, ok: 0, failed: 0 };
  }
  for (const row of (rows.results || [])) {
    scanned++;
    try {
      const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
      const stubUser = { id: row.user_id } as User;
      const out = await sync(stubCtx, stubUser, row);
      await env.DB.prepare(
        'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      ).bind(row.id).run();
      ok++;
      console.info(`[carta] cron sync ok integration=${row.id}: ${out.summary}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
      try {
        await env.DB.prepare(
          'UPDATE integrations SET last_error = ?, status = CASE WHEN ? LIKE \'%refresh%\' THEN \'error\' ELSE status END WHERE id = ?',
        ).bind(msg, msg, row.id).run();
      } catch { /* non-fatal */ }
      console.error(`[carta] cron sync failed integration=${row.id}: ${msg}`);
    }
  }
  return { scanned, ok, failed };
}
