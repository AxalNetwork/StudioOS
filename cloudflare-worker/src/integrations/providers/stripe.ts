/**
 * Task #6 (DG) — Stripe provider (Live, Growth tier).
 *
 * Founder OAuth-connects their Stripe account via Stripe Connect (read_only
 * scope). On first sync (and via webhook deltas + 15-min cron) we pull MRR /
 * ARR / paying_customers / monthly_churn_pct from /v1/subscriptions and
 * project them into:
 *   - `metrics_snapshots` rows tagged `source='stripe'` (history),
 *   - `financial_models.assumptions_json` (current MRR/ARR/users/churn) so
 *     the cap-table simulator + scoring engine see live numbers.
 *
 * Anti-cheat: when a self-reported (`source!='stripe'`) snapshot in the last
 * 30 days disagrees with the latest Stripe snapshot by >20% (MRR), we insert
 * a row into `metric_anomalies`; scoring + portfolio surfaces read this
 * table to flag the project.
 *
 * Webhook delivery uses the existing platform endpoint /api/billing/stripe/
 * webhook (Stripe Connect events arrive there with `event.account` set);
 * routes/billing.ts dispatches Connect-account events to `handleStripeConnectEvent`
 * exported below. The per-uid /api/integrations/webhook/stripe/:uid receiver
 * is also wired as a fallback for direct account-level webhooks.
 */
import type { Context } from 'hono';
import { stripTrailingSlashes } from '../../util/url';
import type { Env, User } from '../../types';
import {
  registerProvider,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import {
  decryptCredentials,
  type CredentialBlob,
} from '../secrets';

const PROVIDER_KEY = 'stripe';
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_CONNECT = 'https://connect.stripe.com';

function redirectUri(env: Env): string {
  const base = stripTrailingSlashes(env.APP_URL || '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

function ensureCreds(env: Env): { clientId: string; secret: string } {
  const clientId = env.STRIPE_CONNECT_CLIENT_ID;
  const secret = env.STRIPE_SECRET_KEY;
  if (!clientId || !secret) {
    throw new Error('stripe_oauth_unconfigured: STRIPE_CONNECT_CLIENT_ID and STRIPE_SECRET_KEY must be set on the worker.');
  }
  return { clientId, secret };
}

// ───────────────────────────────────────────────────────────── token helpers

interface StripeOAuthToken {
  access_token: string;
  refresh_token: string;
  stripe_user_id: string;
  scope?: string;
  livemode?: boolean;
  token_type?: string;
}

async function exchangeCode(env: Env, code: string): Promise<StripeOAuthToken> {
  const { secret } = ensureCreds(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
  });
  const res = await fetch(`${STRIPE_CONNECT}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${secret}`,
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`stripe_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as StripeOAuthToken;
}

async function deauthorize(env: Env, stripeUserId: string): Promise<void> {
  const { clientId, secret } = ensureCreds(env);
  try {
    await fetch(`${STRIPE_CONNECT}/oauth/deauthorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${secret}`,
      },
      body: new URLSearchParams({ client_id: clientId, stripe_user_id: stripeUserId }),
    });
  } catch (e) {
    console.warn('[stripe] deauthorize failed (non-fatal):', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── Stripe API

interface StripeListResponse<T> { data: T[]; has_more: boolean; }
interface StripeSubscriptionItem {
  quantity: number;
  price: { unit_amount: number | null; currency: string; recurring?: { interval?: 'day'|'week'|'month'|'year'; interval_count?: number } | null };
}
interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  created: number;
  canceled_at: number | null;
  items: { data: StripeSubscriptionItem[] };
}
interface StripeAccount { id: string; business_profile?: { name?: string|null } | null; email?: string|null; display_name?: string|null; }

async function stripeGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Stripe-Version': '2024-06-20' },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`stripe_api_failed ${path}: ${r.status} ${txt.slice(0, 300)}`);
  }
  return await r.json() as T;
}

async function fetchAccount(token: string): Promise<StripeAccount> {
  return await stripeGet<StripeAccount>(token, '/v1/account');
}

/** Pull all pages (cap 10 = 1000 rows) of an /v1/{resource} listing. */
async function listAll<T>(token: string, basePath: string): Promise<T[]> {
  const out: T[] = [];
  let starting_after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const url = `${basePath}${sep}limit=100${starting_after ? `&starting_after=${starting_after}` : ''}`;
    const body = await stripeGet<StripeListResponse<T & { id: string }>>(token, url);
    out.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    starting_after = body.data[body.data.length - 1].id;
  }
  return out;
}

/** Normalize subscription item amount to monthly USD-cents. */
function monthlyCents(item: StripeSubscriptionItem): number {
  const amt = item.price?.unit_amount ?? 0;
  const qty = item.quantity || 1;
  const recur = item.price?.recurring;
  const interval = recur?.interval || 'month';
  const count = recur?.interval_count || 1;
  const perPeriod = amt * qty;
  switch (interval) {
    case 'year': return perPeriod / (12 * count);
    case 'month': return perPeriod / count;
    case 'week': return (perPeriod * 52) / (12 * count);
    case 'day': return (perPeriod * 365) / (12 * count);
    default: return perPeriod;
  }
}

interface StripeMetrics {
  mrr: number;             // USD (not cents)
  arr: number;
  paying_customers: number;
  monthly_churn_pct: number; // 0..100
  active_subs: number;
}

async function computeStripeMetrics(token: string): Promise<StripeMetrics> {
  const active = await listAll<StripeSubscription>(token, '/v1/subscriptions?status=active');
  const trialing = await listAll<StripeSubscription>(token, '/v1/subscriptions?status=trialing');
  const allActive = [...active, ...trialing];
  let mrrCents = 0;
  const customers = new Set<string>();
  for (const sub of allActive) {
    customers.add(sub.customer);
    for (const it of sub.items?.data || []) mrrCents += monthlyCents(it);
  }
  const mrr = Math.round(mrrCents) / 100;
  const arr = mrr * 12;

  // Churn — count canceled subs in last 30d / (canceled + still-active 30d ago).
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
  const canceledRecent = await listAll<StripeSubscription>(
    token,
    `/v1/subscriptions?status=canceled&created[gte]=${cutoff - 365 * 86400}`,
  );
  const cancelledIn30 = canceledRecent.filter(s => (s.canceled_at || 0) >= cutoff).length;
  const denom = cancelledIn30 + allActive.length;
  const monthly_churn_pct = denom > 0 ? (cancelledIn30 / denom) * 100 : 0;

  return {
    mrr,
    arr,
    paying_customers: customers.size,
    monthly_churn_pct: Math.round(monthly_churn_pct * 100) / 100,
    active_subs: allActive.length,
  };
}

// ───────────────────────────────────────────────────────────── connect

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) {
    throw new Error('stripe_requires_oauth: provide oauth_code from /oauth/stripe/callback.');
  }
  const tok = await exchangeCode(c.env, input.oauth_code);
  const account = await fetchAccount(tok.access_token);
  const credentials: CredentialBlob = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    stripe_user_id: tok.stripe_user_id,
    livemode: !!tok.livemode,
    scope: tok.scope || 'read_only',
    token_type: 'Bearer',
  } as CredentialBlob;
  const displayName = account.business_profile?.name
    || account.display_name
    || account.email
    || account.id;
  return {
    credentials,
    scopes: [tok.scope || 'read_only'],
    external_account_id: tok.stripe_user_id,
    external_account_name: displayName,
    capabilities: ['Pull MRR/ARR', 'Customer count', 'Churn analytics', 'Webhook deltas'],
    config: { livemode: !!tok.livemode },
  };
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { clientId } = ensureCreds(c.env);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_only',
    redirect_uri: redirectUri(c.env),
    state,
    'stripe_user[business_type]': 'company',
  });
  return `${STRIPE_CONNECT}/oauth/authorize?${params.toString()}`;
}

// ───────────────────────────────────────────────────────────── projection

/**
 * Resolve which project this integration's Stripe data should write to.
 * Order: explicit `config_json.project_id` (set via PATCH /:uid/config) →
 * the user's solo project (only if they own exactly one). Returns null
 * when ambiguous; sync skips snapshot writes in that case.
 */
async function resolveProjectId(env: Env, row: IntegrationRow): Promise<number | null> {
  const cfg = row.config_json ? safeJson<Record<string, unknown>>(row.config_json, {}) : {};
  const explicit = Number(cfg.project_id);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  try {
    const owned = await env.DB.prepare(
      'SELECT id FROM projects WHERE owner_user_id = ? AND (deleted_at IS NULL OR deleted_at = "") LIMIT 2',
    ).bind(row.user_id).all<{ id: number }>();
    const rows = owned.results || [];
    if (rows.length === 1) return rows[0].id;
  } catch { /* projects table shape varies in dev */ }
  return null;
}

function safeJson<T>(s: string | null, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

async function ensureMetricAnomalies(env: Env): Promise<void> {
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS metric_anomalies (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'project_id INTEGER NOT NULL, ' +
      'metric TEXT NOT NULL, ' +
      'self_value REAL, stripe_value REAL, delta_pct REAL, ' +
      'source TEXT NOT NULL DEFAULT "stripe", ' +
      'severity TEXT NOT NULL DEFAULT "warn", ' +
      'created_at TEXT NOT NULL DEFAULT (datetime("now")))',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_metric_anomalies_project ON metric_anomalies(project_id, datetime(created_at) DESC)');
  } catch (e) { console.warn('[stripe] ensureMetricAnomalies:', (e as Error).message); }
}

/**
 * Write a stripe-sourced metrics_snapshots row + upsert the relevant
 * fields onto financial_models.assumptions_json. Also writes the anomaly
 * flag when self-reported MRR diverges by >20%.
 */
async function projectMetricsToProject(
  env: Env, projectId: number, m: StripeMetrics,
): Promise<void> {
  // Lazy schema bootstrap (mirror progress.ts ensureMetricsSnapshotsSchema
  // shape). Using inline ensure avoids cross-import cycles.
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS metrics_snapshots (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, ' +
      'snapshot_date TEXT NOT NULL, mrr REAL, arr REAL, cac REAL, ltv REAL, ' +
      'monthly_churn_pct REAL, active_users INTEGER, new_users INTEGER, ' +
      'notes TEXT, source TEXT, created_by INTEGER, ' +
      'created_at TEXT NOT NULL DEFAULT (datetime("now")))',
    );
  } catch { /* table exists */ }

  const date = new Date().toISOString().slice(0, 10);
  // Replace today's stripe row to avoid duplicates on re-sync.
  try {
    await env.DB.prepare(
      'DELETE FROM metrics_snapshots WHERE project_id = ? AND snapshot_date = ? AND source = "stripe"',
    ).bind(projectId, date).run();
  } catch { /* non-fatal */ }
  await env.DB.prepare(
    'INSERT INTO metrics_snapshots (project_id, snapshot_date, mrr, arr, monthly_churn_pct, active_users, source) ' +
    'VALUES (?, ?, ?, ?, ?, ?, "stripe")',
  ).bind(projectId, date, m.mrr, m.arr, m.monthly_churn_pct, m.paying_customers).run();

  // Upsert into financial_models.assumptions_json — keep existing keys but
  // overwrite the live-source ones. Best-effort; the financials route's
  // lazy schema ensure handles older shapes.
  try {
    const row = await env.DB.prepare(
      'SELECT assumptions_json FROM financial_models WHERE project_id = ?',
    ).bind(projectId).first<{ assumptions_json: string | null }>();
    const assumptions = safeJson<Record<string, unknown>>(row?.assumptions_json || null, {});
    assumptions.mrr = m.mrr;
    assumptions.arr = m.arr;
    assumptions.paying_customers = m.paying_customers;
    assumptions.monthly_churn_pct = m.monthly_churn_pct;
    assumptions._sources = {
      ...(assumptions._sources as Record<string, string> || {}),
      mrr: 'stripe',
      arr: 'stripe',
      paying_customers: 'stripe',
      monthly_churn_pct: 'stripe',
    };
    assumptions._stripe_synced_at = new Date().toISOString();
    if (row) {
      await env.DB.prepare(
        'UPDATE financial_models SET assumptions_json = ?, updated_at = datetime("now") WHERE project_id = ?',
      ).bind(JSON.stringify(assumptions), projectId).run();
    } else {
      // Insert with deterministic values for legacy NOT-NULL columns
      // (`name`, `inputs_json`) on stale schemas — see ensureFinancialsModelSchema.
      try {
        await env.DB.prepare(
          'INSERT INTO financial_models (project_id, assumptions_json, name, inputs_json) VALUES (?, ?, ?, ?)',
        ).bind(projectId, JSON.stringify(assumptions), 'stripe-imported', '{}').run();
      } catch {
        await env.DB.prepare(
          'INSERT INTO financial_models (project_id, assumptions_json) VALUES (?, ?)',
        ).bind(projectId, JSON.stringify(assumptions)).run();
      }
    }
  } catch (e) {
    console.warn('[stripe] financial_models upsert failed:', (e as Error).message);
  }

  // Anti-cheat — compare against most recent self-reported MRR snapshot in
  // the last 30 days; flag >20% delta.
  await ensureMetricAnomalies(env);
  try {
    const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
    const self = await env.DB.prepare(
      `SELECT mrr FROM metrics_snapshots
        WHERE project_id = ? AND (source IS NULL OR source != 'stripe')
          AND snapshot_date >= ? AND mrr IS NOT NULL
        ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
    ).bind(projectId, cutoff).first<{ mrr: number | null }>();
    const selfMrr = Number(self?.mrr || 0);
    if (selfMrr > 0) {
      const delta = Math.abs(selfMrr - m.mrr) / selfMrr;
      if (delta > 0.2) {
        await env.DB.prepare(
          'INSERT INTO metric_anomalies (project_id, metric, self_value, stripe_value, delta_pct, severity) ' +
          'VALUES (?, "mrr", ?, ?, ?, ?)',
        ).bind(projectId, selfMrr, m.mrr, Math.round(delta * 10000) / 100, delta > 0.5 ? 'high' : 'warn').run();
      }
    }
  } catch (e) {
    console.warn('[stripe] anomaly check failed:', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── sync / webhook

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('stripe_credentials_missing');
  const token = String(creds.access_token || '');
  if (!token) throw new Error('stripe_access_token_missing');

  const metrics = await computeStripeMetrics(token);

  const projectId = await resolveProjectId(c.env, row);
  if (projectId) await projectMetricsToProject(c.env, projectId, metrics);

  // Cache latest snapshot on the integration config so the UI can render
  // current Stripe values without re-querying.
  try {
    const cfg = safeJson<Record<string, unknown>>(row.config_json, {});
    cfg.latest_metrics = { ...metrics, fetched_at: new Date().toISOString() };
    await c.env.DB.prepare(
      'UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(JSON.stringify(cfg), row.id).run();
  } catch { /* non-fatal */ }

  return {
    summary: `mrr=$${metrics.mrr.toFixed(2)} customers=${metrics.paying_customers} churn=${metrics.monthly_churn_pct}% project=${projectId ?? 'unset'}`,
    counts: {
      mrr_cents: Math.round(metrics.mrr * 100),
      customers: metrics.paying_customers,
      active_subs: metrics.active_subs,
    },
  };
}

const RESYNC_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.created',
  'customer.deleted',
]);

async function webhook(
  c: Context<{ Bindings: Env }>, row: IntegrationRow, body: string, _signature: string | null,
): Promise<{ summary: string }> {
  let evt: { type?: string };
  try { evt = JSON.parse(body); } catch { return { summary: 'invalid_json' }; }
  const type = String(evt.type || '');
  if (!RESYNC_EVENTS.has(type)) return { summary: `noop ${type}` };
  // Re-run the full sync. Stripe's eventual-consistency guarantees mean a
  // delta-only path is fragile; a fresh aggregate is the simplest correct.
  const stubUser = { id: row.user_id } as User;
  const out = await sync(c, stubUser, row);
  return { summary: `${type} → ${out.summary}` };
}

// Stripe-Signature is `t=…,v1=…` HMAC over `${t}.${body}` keyed by the
// per-endpoint webhook signing secret. The integration row's
// webhook_secret_enc holds that key (set via PATCH /:uid/config when the
// founder pastes their endpoint signing secret), or falls back to the
// platform STRIPE_WEBHOOK_SECRET via the centralized billing handler.
async function verifyWebhook(secret: string, body: string, headers: Headers): Promise<boolean> {
  const header = headers.get('stripe-signature') || '';
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const seg of header.split(',')) {
    const [k, v] = seg.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts['t']; const v1 = parts['v1'];
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
  const stripeUserId = typeof creds?.stripe_user_id === 'string' ? creds.stripe_user_id as string : '';
  if (stripeUserId) await deauthorize(c.env, stripeUserId);
}

function validateConfig(
  patch: Record<string, unknown>, _existing: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const ALLOWED = new Set(['project_id']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown_config_key: ${k}` };
    if (k === 'project_id') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'project_id_must_be_positive_integer' };
      out[k] = Math.trunc(n);
    }
  }
  return { ok: true, patch: out };
}

async function postConnect(c: Context<{ Bindings: Env }>, user: User, row: IntegrationRow): Promise<void> {
  try {
    const fresh = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
      .bind(row.id).first<IntegrationRow>();
    if (fresh) await sync(c, user, fresh);
  } catch (e) {
    console.warn('[stripe] postConnect first sync:', (e as Error).message);
  }
}

const impl: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  sync,
  webhook,
  disconnect,
  validateConfig,
  verifyWebhook,
  postConnect,
};
registerProvider(impl);

/**
 * Dispatch a Stripe Connect platform-webhook event (event.account=acct_…)
 * to the right per-integration sync. Called from routes/billing.ts so
 * webhooks update within seconds without requiring per-account webhook
 * configuration.
 */
export async function handleStripeConnectEvent(
  env: Env,
  event: { type?: string; account?: string; data?: { object?: Record<string, unknown> } },
): Promise<void> {
  const acct = event.account;
  if (!acct) return;
  const type = String(event.type || '');
  if (!RESYNC_EVENTS.has(type)) return;
  const row = await env.DB.prepare(
    "SELECT * FROM integrations WHERE provider_key = 'stripe' AND external_account_id = ? AND status = 'active'",
  ).bind(acct).first<IntegrationRow>();
  if (!row) return;
  const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
  const stubUser = { id: row.user_id } as User;
  try {
    const out = await sync(stubCtx, stubUser, row);
    await env.DB.prepare(
      'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
    ).bind(row.id).run();
    console.info(`[stripe] connect-webhook ${type} acct=${acct}: ${out.summary}`);
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 500) || 'webhook sync failed';
    try {
      await env.DB.prepare('UPDATE integrations SET last_error = ? WHERE id = ?').bind(msg, row.id).run();
    } catch { /* non-fatal */ }
  }
}

/** Public sync entry-point used by /api/progress/metrics/:projectId/import-stripe. */
export async function syncStripeForUser(env: Env, userId: number, projectId: number): Promise<{
  ok: boolean; imported: number; detail?: string; mrr?: number; customers?: number;
}> {
  const row = await env.DB.prepare(
    "SELECT * FROM integrations WHERE provider_key = 'stripe' AND user_id = ? AND status = 'active' LIMIT 1",
  ).bind(userId).first<IntegrationRow>();
  if (!row) return { ok: false, imported: 0, detail: 'not_connected' };
  const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds?.access_token) return { ok: false, imported: 0, detail: 'credentials_missing' };
  try {
    const metrics = await computeStripeMetrics(String(creds.access_token));
    await projectMetricsToProject(env, projectId, metrics);
    await env.DB.prepare(
      'UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
    ).bind(row.id).run();
    return { ok: true, imported: 1, mrr: metrics.mrr, customers: metrics.paying_customers };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
    try { await env.DB.prepare('UPDATE integrations SET last_error = ? WHERE id = ?').bind(msg, row.id).run(); } catch { /* non-fatal */ }
    return { ok: false, imported: 0, detail: msg };
  }
}

/** Cron entry-point — 15-min reconcile across every active Stripe integration. */
export async function syncAllStripeIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  let scanned = 0, ok = 0, failed = 0;
  let rows: { results: IntegrationRow[] };
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM integrations WHERE provider_key = 'stripe' AND status = 'active' LIMIT 200",
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
      console.info(`[stripe] cron sync ok integration=${row.id}: ${out.summary}`);
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) || 'sync failed';
      try {
        await env.DB.prepare('UPDATE integrations SET last_error = ? WHERE id = ?').bind(msg, row.id).run();
      } catch { /* non-fatal */ }
      console.error(`[stripe] cron sync failed integration=${row.id}: ${msg}`);
    }
  }
  return { scanned, ok, failed };
}
