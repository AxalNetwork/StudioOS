/**
 * Integrations router (Cloudflare Worker stub).
 *
 * The full implementation lives in `backend/app/api/routes/integrations.py`
 * and uses Python Fernet (`crypto_box`) to encrypt API keys + webhook secrets
 * at rest. The Worker has no Fernet equivalent yet, so this stub only handles
 * the read endpoints the frontend hits on page load:
 *
 *   GET /api/integrations/available — static provider catalogue
 *   GET /api/integrations           — current user's integrations (no secrets)
 *
 * All write endpoints (connect, sync, push, delete, webhook) return 501 with
 * a clear "use the FastAPI backend" message until the encryption layer is
 * ported. This is enough to clear the "Could not load … Not found" error on
 * `IntegrationsPage` and let it render its empty state cleanly in production.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const integrations = new Hono<{ Bindings: Env }>();

const ALLOWED_ROLES = new Set(['admin', 'operator', 'service_provider', 'partner', 'investor', 'founder']);

const PROVIDER_CATALOGUE = [
  {
    provider_name: 'hubspot',
    integration_type: 'crm',
    display_name: 'HubSpot',
    description: 'Sync deals and contacts to your HubSpot CRM.',
    auth_type: 'api_key',
    docs_url: 'https://developers.hubspot.com/docs/api/overview',
  },
  {
    provider_name: 'salesforce',
    integration_type: 'crm',
    display_name: 'Salesforce',
    description: 'Push opportunities and accounts to Salesforce.',
    auth_type: 'api_key',
    docs_url: 'https://developer.salesforce.com/docs',
  },
  {
    provider_name: 'sumsub',
    integration_type: 'legal_provider',
    display_name: 'Sumsub KYC',
    description: 'Run identity verification and AML checks on partners and LPs.',
    auth_type: 'api_key',
    docs_url: 'https://developers.sumsub.com/api-reference/',
  },
  {
    provider_name: 'stripe_atlas',
    integration_type: 'legal_provider',
    display_name: 'Stripe Atlas',
    description: 'Automate Delaware C-Corp incorporation for spin-outs.',
    auth_type: 'api_key',
    docs_url: 'https://stripe.com/atlas',
  },
  {
    provider_name: 'cooley',
    integration_type: 'legal_provider',
    display_name: 'Cooley GO',
    description: 'Send deal documents to Cooley for review and execution.',
    auth_type: 'api_key',
    docs_url: 'https://www.cooleygo.com/',
  },
  {
    provider_name: 'pitchbook',
    integration_type: 'data_feed',
    display_name: 'PitchBook',
    description: 'Pull comparables and market data into project metrics.',
    auth_type: 'api_key',
    docs_url: 'https://pitchbook.com/news/articles/api',
  },
  {
    provider_name: 'custom',
    integration_type: 'custom',
    display_name: 'Custom Webhook',
    description: 'Send and receive events via a generic HMAC-signed webhook.',
    auth_type: 'webhook_secret',
    docs_url: null,
  },
];

function ensureRole(user: { role?: string | null }) {
  if (!ALLOWED_ROLES.has((user.role || '').toLowerCase())) {
    throw new Error('Forbidden');
  }
}

function safeJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

integrations.get('/available', async (c) => {
  const user = await requireAuth(c);
  ensureRole(user);
  return c.json({ ok: true, providers: PROVIDER_CATALOGUE });
});

// Register both `''` and `'/'` so `/api/integrations` (no trailing slash, what
// the frontend actually calls) doesn't fall through to the global notFound
// handler. Mirrors the FastAPI `@router.get("") + @router.get("/")` pattern.
const listMine = async (c: Context<{ Bindings: Env }>) => {
  const user = await requireAuth(c);
  ensureRole(user);
  const sql = getSQL(c.env);
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  const rows = isAdmin
    ? await sql`SELECT uid, integration_type, provider_name, display_name, status,
                       last_synced_at, last_error, webhook_secret_encrypted,
                       config_json, created_at, updated_at
                  FROM integrations ORDER BY datetime(created_at) DESC`
    : await sql`SELECT uid, integration_type, provider_name, display_name, status,
                       last_synced_at, last_error, webhook_secret_encrypted,
                       config_json, created_at, updated_at
                  FROM integrations
                 WHERE user_id = ${user.id}
                 ORDER BY datetime(created_at) DESC`;
  await sql.end();
  // We can't decrypt Fernet-encrypted keys from the Worker, so we omit the
  // preview rather than show garbled output. The FastAPI surface still shows
  // it correctly.
  const items = rows.map((r: any) => ({
    uid: r.uid,
    integration_type: r.integration_type,
    provider_name: r.provider_name,
    display_name: r.display_name,
    status: r.status,
    last_synced_at: r.last_synced_at || null,
    last_error: r.last_error || null,
    api_key_preview: null,
    has_webhook_secret: !!r.webhook_secret_encrypted,
    config: safeJson(r.config_json, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return c.json({ ok: true, items });
};
integrations.get('', listMine);
integrations.get('/', listMine);

// Write endpoints require the Fernet encryption layer. Until that's ported,
// route them back to the FastAPI surface with a clear 501.
const notImplemented = (c: Context<{ Bindings: Env }>) =>
  c.json(
    {
      ok: false,
      error: {
        code: 501,
        type: 'not_implemented',
        message:
          'Integration management is temporarily unavailable on this surface. ' +
          'Please retry in a moment or contact support if the issue persists.',
      },
    },
    501,
  );

integrations.post('/connect', notImplemented);
integrations.delete('/:uid', notImplemented);
integrations.post('/:uid/sync', notImplemented);
integrations.post('/:uid/push', notImplemented);
integrations.get('/:uid/logs', notImplemented);
integrations.post('/webhook/:provider/:uid', notImplemented);

export default integrations;
