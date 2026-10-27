/**
 * D1096 (#2961, #2408 part 1) — `POST /api/connectors/webhook/vercel`.
 *
 * Vercel sends every installation's events to one URL, signed with HMAC-SHA1
 * of the raw body and the Integration's client secret (`x-vercel-signature`).
 * The per-connection receiver (`/webhook/:provider/:uid`, SHA-256 against a
 * row's own key) cannot take them, so this route is mounted ahead of it.
 *
 *   1. The signature is checked, in constant time, before anything else: a
 *      missing or wrong one answers 404, before any lookup or log.
 *   2. The connection is found by the body's configuration id in
 *      `vercel_installations`, a bound lookup; an unknown one answers 404.
 *   3. THE BODY IS A NUDGE, NEVER A FACT. Nothing in it is stored: the
 *      connection is synced again, which re-reads Vercel. A 60-second KV key per
 *      connection and object drops repeats.
 *   4. `integration-configuration.removed` marks the connection Removed in
 *      Vercel and deletes its Vercel rows.
 *
 * Logs hold the event type and an outcome, never a body, a name or a domain.
 * UNVERIFIED until the owner's live check: which field carries the
 * configuration id, and which events an Integration may subscribe to.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { IntegrationRow } from '../integrations/registry';
import { clearVercelRows, syncVercel } from '../integrations/providers/vercel';
import { logEvent } from './integrations';

const vercelWebhook = new Hono<{ Bindings: Env }>();

/** The largest body taken; Vercel's events are small. */
export const MAX_BODY = 256 * 1024;
export const REPEAT_TTL_S = 60;
export const REMOVED = 'vercel_removed: Removed in Vercel. Connect Vercel again to read it.';

const notFound = (c: any) => c.json({ error: 'not_found' }, 404);

/** HMAC-SHA1 of the raw body, as lowercase hex. */
export async function vercelSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant time for equal lengths; a length mismatch is refused at once. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v && v.length <= max ? v : null);

/** The configuration id an event names (UNVERIFIED which field Vercel uses). */
export function configurationOf(event: any): string | null {
  const p = event?.payload;
  return str(p?.configuration?.id) ?? str(p?.configurationId) ?? str(event?.configurationId);
}

/** The object an event is about, for the repeat key: a deployment, a project, a domain, else the event type. */
export function objectOf(event: any): string {
  const p = event?.payload;
  const id = str(p?.deployment?.id, 128) ?? str(p?.project?.id, 128) ?? str(p?.domain?.name, 128) ?? str(event?.type, 64) ?? 'event';
  return id.replace(/[^A-Za-z0-9_.:-]/g, '_');
}

vercelWebhook.post('/', async (c) => {
  const signature = c.req.header('x-vercel-signature') || '';
  if (!/^[0-9a-f]{40}$/i.test(signature)) return notFound(c);
  const { loadOauthCreds } = await import('../services/providerOauthKeys');
  const creds = await loadOauthCreds(c.env, 'vercel');
  if (!creds?.secret) return notFound(c);
  const body = await c.req.text();
  if (body.length > MAX_BODY) return notFound(c);
  if (!sameDigest(await vercelSignature(creds.secret, body), signature.toLowerCase())) return notFound(c);

  let event: any;
  try { event = JSON.parse(body); } catch { return notFound(c); }
  const configuration = configurationOf(event);
  if (!configuration) return notFound(c);
  const row = await c.env.DB.prepare(
    `SELECT i.* FROM vercel_installations vi JOIN integrations i ON i.id = vi.integration_id
      WHERE vi.configuration_id = ? AND i.provider_key = 'vercel'`,
  ).bind(configuration).first<IntegrationRow>();
  if (!row) return notFound(c);
  const type = str(event?.type, 80) ?? 'unknown';

  if (type === 'integration-configuration.removed') {
    await c.env.DB.prepare(
      "UPDATE integrations SET status = 'error', last_error = ?, last_error_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(REMOVED, row.id).run();
    await clearVercelRows(c.env, row.id);
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: 'vercel',
      direction: 'inbound', event_type: 'webhook', status: 'ok', response_summary: 'Removed in Vercel; its Vercel rows were deleted.',
    });
    return c.json({ ok: true });
  }
  if (row.status !== 'active') return c.json({ ok: true, ignored: 'not_active' });

  const repeat = `vercel-nudge:${row.id}:${objectOf(event)}`;
  try {
    if (await c.env.RATE_LIMITS.get(repeat)) return c.json({ ok: true, dropped: 'repeat' });
    await c.env.RATE_LIMITS.put(repeat, '1', { expirationTtl: REPEAT_TTL_S });
  } catch { /* without the key a repeat syncs again; a sync only updates */ }

  const run = async () => {
    try {
      const out = await syncVercel(c.env, row);
      await c.env.DB.prepare('UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL, last_error_at = NULL WHERE id = ?').bind(row.id).run();
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: 'vercel',
        direction: 'inbound', event_type: 'webhook', status: 'ok', response_summary: `${type}: ${out.summary}`, payload: out.counts,
      });
    } catch (e) {
      const code = String((e as Error).message || 'sync_failed').split(/[:\s]/)[0].slice(0, 64);
      if (code === 'vercel_reconnect_required') {
        await c.env.DB.prepare(
          "UPDATE integrations SET status = 'error', last_error = ?, last_error_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).bind('vercel_reconnect_required: Reconnect Vercel.', row.id).run();
      }
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: 'vercel',
        direction: 'inbound', event_type: 'webhook', status: 'error', response_summary: `${type}: ${code}`,
      });
    }
  };
  try { c.executionCtx.waitUntil(run()); } catch { await run(); }
  return c.json({ ok: true });
});

export default vercelWebhook;
