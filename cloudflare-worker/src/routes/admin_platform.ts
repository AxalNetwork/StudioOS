/**
 * HQ · Platform — canvas H6, "Keys, flags, jobs".
 *
 * SUPER ADMIN ONLY.
 *
 *   GET /summary      connected integrations, scheduled-job health, and the
 *                     one of the three that has no store
 *
 * TWO OF THE THREE ARE REAL.
 *
 *   Keys   `integrations` carries a provider, a display name and a status
 *          (active | paused | error | disconnected), which is what the
 *          artboard's Slack and Telegram rows are. The **secret itself is
 *          never read here** and never leaves the worker — this endpoint
 *          counts and states, it does not reveal. The artboard's "reveal on
 *          click, re-hide after thirty seconds" belongs to the console that
 *          owns key material, not to a read-only HQ summary.
 *   Jobs   `cron_run_history` records every scheduled run with its status
 *          and error, so "last run 03:14 · 2 retries · Degraded" is
 *          computable: a trigger whose most recent run failed is degraded,
 *          and one that has not run inside its window is stale.
 *   Flags  NOT RECORDED. There is no feature-flag store. What exists under
 *          that name is per-user settings (`services/userSettings.ts`), which
 *          is a different thing: a user's own preference, not a platform
 *          switch an operator can throw. Drawing a flags panel over it would
 *          claim a control room that does not exist.
 *
 * Mounted at /api/admin/platform BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';

const r = new Hono<{ Bindings: Env }>();

/** How far back a scheduled trigger may go silent before it is stale. */
const STALE_AFTER_HOURS = 26;

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // ── Keys and connections ──────────────────────────────────────────────
  let integrations: unknown;
  try {
    const rows = await env.DB.prepare(
      `SELECT provider_key, status, COUNT(*) AS n
         FROM integrations GROUP BY provider_key, status ORDER BY provider_key`,
    ).all<{ provider_key: string; status: string; n: number }>();
    const byProvider = new Map<string, Record<string, number>>();
    let total = 0;
    let unhealthy = 0;
    for (const row of rows.results || []) {
      const key = String(row.provider_key);
      const status = String(row.status);
      const n = Number(row.n) || 0;
      if (!byProvider.has(key)) byProvider.set(key, {});
      byProvider.get(key)![status] = n;
      total += n;
      if (status === 'error' || status === 'disconnected') unhealthy += n;
    }
    integrations = {
      available: true,
      total,
      unhealthy,
      providers: [...byProvider.entries()].map(([provider, by_status]) => ({ provider, by_status })),
      // Said explicitly so nobody wires a reveal into this payload later.
      secrets_included: false,
      secrets_note: 'Key material is never read by this endpoint. It counts connections and reports their state.',
    };
  } catch {
    integrations = { available: false, reason: 'The integrations table could not be read.' };
  }

  // ── Scheduled jobs ────────────────────────────────────────────────────
  let jobs: unknown;
  try {
    // The latest run per trigger. `MAX(started_at)` with a GROUP BY picks the
    // row it came from in SQLite's bare-column rule, which is exactly what is
    // wanted here and is why the query is written this way rather than with a
    // window function D1 would also accept but that reads worse.
    const rows = await env.DB.prepare(
      `SELECT trigger_name, MAX(started_at) AS started_at, status, finished_at, error
         FROM cron_run_history GROUP BY trigger_name ORDER BY trigger_name`,
    ).all<Record<string, unknown>>();
    const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 3600_000).toISOString();
    const list = (rows.results || []).map((row) => {
      const started = String(row.started_at || '');
      const status = String(row.status || '');
      // A run that never finished is not the same as one that failed, and
      // neither is the same as a trigger that stopped firing. Three states,
      // not one "unhealthy" bucket.
      const state = status === 'error' || status === 'failed'
        ? 'failed'
        : (started && started < cutoff ? 'stale' : (row.finished_at ? 'ok' : 'running'));
      return {
        trigger_name: String(row.trigger_name || ''),
        last_started_at: started || null,
        last_finished_at: (row.finished_at as string) || null,
        status: status || null,
        error: (row.error as string) || null,
        state,
      };
    });
    jobs = {
      available: true,
      stale_after_hours: STALE_AFTER_HOURS,
      triggers: list,
      failing: list.filter((j) => j.state === 'failed').length,
      stale: list.filter((j) => j.state === 'stale').length,
    };
  } catch {
    jobs = { available: false, reason: 'The scheduled-run history could not be read.' };
  }

  return c.json({
    integrations,
    jobs,

    // The third of the three, and why it is not drawn.
    flags_available: false,
    flags_reason:
      'There is no feature-flag store. What the codebase calls flags is per-user settings '
      + '(services/userSettings.ts) — a person\'s own preference, not a platform switch an operator '
      + 'can throw. A flags panel over that would claim a control room the product does not have.',

    ...DERIVED_UNAVAILABLE,
  });
});

export default r;
