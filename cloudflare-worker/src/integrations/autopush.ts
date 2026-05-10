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
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { IntegrationRow } from './registry';
import { getProviderImpl } from './registry';

interface AutoPushOpts {
  c: Context<{ Bindings: Env }>;
  user: User;
  providerKey: string;
  payload: unknown;
  /** Short event-type label written to integration_logs (e.g. 'auto_push:deal'). */
  eventType: string;
}

/**
 * Look up the user's active integration for `providerKey` and push.
 * Always best-effort: catches every error and never throws to the caller.
 * Schedules the work on `executionCtx.waitUntil` when present.
 */
export function schedulePush(opts: AutoPushOpts): void {
  const { c } = opts;
  const work = runPush(opts).catch((e: unknown) => {
    const msg = (e as Error)?.message || 'auto-push failed';
    console.warn(`[autopush:${opts.providerKey}] ${opts.eventType} failed: ${msg}`);
  });
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(work);
  } else {
    void work;
  }
}

async function runPush(opts: AutoPushOpts): Promise<void> {
  const { c, user, providerKey, payload, eventType } = opts;
  const integ = await c.env.DB.prepare(
    "SELECT * FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' LIMIT 1",
  ).bind(user.id, providerKey).first<IntegrationRow>();
  if (!integ) return;
  const impl = getProviderImpl(providerKey);
  if (!impl?.push) return;
  let summary = '';
  let externalId: string | null = null;
  let httpStatus: number | undefined;
  let status: 'ok' | 'error' = 'ok';
  try {
    const out = await impl.push(c, user, integ, payload);
    summary = out.summary || `${eventType} ok`;
    externalId = (out.external_id as string | null | undefined) ?? null;
    httpStatus = out.http_status;
  } catch (e) {
    status = 'error';
    summary = (e as Error)?.message?.slice(0, 500) || 'push threw';
  }
  try {
    await c.env.DB.prepare(
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
