/**
 * Task #2 — shared helper for background auto-pushes triggered from
 * outside the integrations route (e.g. routes/deals.ts on stage change,
 * routes/projects.ts on project create). Centralises three things:
 *   1. lookup of the user's active integration row,
 *   2. dispatch to the provider impl's `push`,
 *   3. integration_logs row on success/failure so the connected card's
 *      "View logs" reflects every background push, not just user-initiated
 *      sync/push calls.
 */
import type { Context, ExecutionContext } from 'hono';
import type { Env, User } from '../types';
import type { IntegrationRow } from './registry';
import { getProviderImpl } from './registry';

interface AutoPushBase {
  user: User;
  providerKey: string;
  payload: unknown;
  /** Short event-type label written to integration_logs (e.g. 'auto_push:deal_stage_change'). */
  eventType: string;
}
interface AutoPushFromContextOpts extends AutoPushBase {
  c: Context<{ Bindings: Env }>;
}
interface AutoPushFromEnvOpts extends AutoPushBase {
  env: Env;
  executionCtx?: ExecutionContext;
}

/**
 * Context-flavour: schedule a background push from an HTTP route. Fires on
 * `executionCtx.waitUntil` so the API response stays snappy. Always
 * best-effort — never throws.
 */
export function schedulePush(opts: AutoPushFromContextOpts): void {
  const work = runPushInternal({
    env: opts.c.env,
    user: opts.user,
    providerKey: opts.providerKey,
    payload: opts.payload,
    eventType: opts.eventType,
  }).catch((e: unknown) => {
    const msg = (e as Error)?.message || 'auto-push failed';
    console.warn(`[autopush:${opts.providerKey}] ${opts.eventType} failed: ${msg}`);
  });
  if (opts.c.executionCtx?.waitUntil) {
    opts.c.executionCtx.waitUntil(work);
  } else {
    void work;
  }
}

/**
 * Env-flavour: schedule a background push from a queue worker / cron / any
 * non-Hono caller. Same logging guarantees as `schedulePush`.
 */
export function schedulePushFromEnv(opts: AutoPushFromEnvOpts): void {
  const work = runPushInternal(opts).catch((e: unknown) => {
    const msg = (e as Error)?.message || 'auto-push failed';
    console.warn(`[autopush:${opts.providerKey}] ${opts.eventType} failed: ${msg}`);
  });
  if (opts.executionCtx?.waitUntil) {
    opts.executionCtx.waitUntil(work);
  } else {
    void work;
  }
}

interface RunPushArgs extends AutoPushBase { env: Env; }

async function runPushInternal(args: RunPushArgs): Promise<void> {
  const { env, user, providerKey, payload, eventType } = args;
  const integ = await env.DB.prepare(
    "SELECT * FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' LIMIT 1",
  ).bind(user.id, providerKey).first<IntegrationRow>();
  if (!integ) return;
  const impl = getProviderImpl(providerKey);
  if (!impl?.push) return;
  // Provider `push` signatures take a Hono Context, but in practice every
  // shipping provider only reads `c.env`. Mirror the same env-stub pattern
  // used by syncAllHubspotIntegrations / calendar.ts cron paths.
  const stubCtx = { env } as unknown as Context<{ Bindings: Env }>;
  let summary = '';
  let externalId: string | null = null;
  let httpStatus: number | undefined;
  let status: 'ok' | 'error' = 'ok';
  try {
    const out = await impl.push(stubCtx, user, integ, payload);
    summary = out.summary || `${eventType} ok`;
    externalId = (out.external_id as string | null | undefined) ?? null;
    httpStatus = out.http_status;
  } catch (e) {
    status = 'error';
    summary = (e as Error)?.message?.slice(0, 500) || 'push threw';
  }
  try {
    await env.DB.prepare(
      'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      integ.id,
      user.id,
      providerKey,
      'outbound',
      eventType,
      status,
      httpStatus ?? null,
      null,
      summary,
      externalId,
      JSON.stringify(payload ?? null),
    ).run();
  } catch (e) {
    console.warn(`[autopush:${providerKey}] log insert failed: ${(e as Error).message}`);
  }
}
