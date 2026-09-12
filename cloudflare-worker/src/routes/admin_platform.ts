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
import { ensureAdminAuditLogTable } from './admin';
import {
  DEFAULT_TAKE_RATE_BPS, MAX_TAKE_RATE_BPS, TAKE_RATE_KEY, settlementMode, takeRate,
} from '../services/advisorMoney';

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

// ---------------------------------------------------------------------------
// 241 — the advisory take rate. SUPER ADMIN ONLY.
//
//   GET  /take-rate    what the platform charges an advisory session, and
//                      whether that is a stored decision or the default
//   PUT  /take-rate    change it, audited
//
// THIS IS NOT THE FLAGS PANEL the summary above says does not exist, and the
// distinction is worth keeping. `flags_available: false` is still true: there
// is no feature-flag registry, and nothing here creates one. What migration
// 241 adds is ONE typed platform number, in `platform_settings`, with an
// `updated_by` because a rate that decides what the platform charges is a
// thing somebody has to be answerable for having changed.
//
// NOTHING HERE MOVES MONEY. Advisory charging is off — `settlementMode()`
// answers 'none' until PR5b's flag flips — so this sets the rate that a
// future charge WOULD use and that today's ledger projects with. The response
// says so rather than leaving a percentage to imply otherwise. D75.
// ---------------------------------------------------------------------------
r.get('/take-rate', async (c) => {
  const admin = await requireSuperAdmin(c);
  void admin;
  const rate = await takeRate(c.env);
  return c.json({
    bps: rate.bps,
    // Both forms, because the store is basis points and every human reads
    // percent. Derived here so no component divides by 100 on its own.
    pct: rate.bps / 100,
    source: rate.source,
    updated_at: rate.updated_at,
    updated_by: rate.updated_by,
    max_bps: MAX_TAKE_RATE_BPS,
    default_bps: DEFAULT_TAKE_RATE_BPS,
    settlement: settlementMode(c.env),
    note: 'Applied to advisory sessions when a price is recorded, and stamped on that '
      + 'line so a later change to this rate cannot restate a past quarter.',
  });
});

r.put('/take-rate', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));

  // BASIS POINTS ONLY, and no coercion from a percentage. Accepting both would
  // make `15` ambiguous — 15 bps is 0.15% and 15% is 1500 — and the form that
  // guessed wrong would undercharge by a factor of a hundred without erroring.
  const raw = body.bps;
  const bps = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_TAKE_RATE_BPS) {
    return c.json({
      detail: `bps must be a whole number of basis points between 0 and ${MAX_TAKE_RATE_BPS} `
        + `(1500 = 15%). A percentage is not accepted here: 15 would be 0.15%.`,
    }, 400);
  }

  const before = await takeRate(c.env);
  const actor = String((admin as any)?.email || (admin as any)?.id || 'super_admin');
  await c.env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(TAKE_RATE_KEY, String(bps), new Date().toISOString(), actor).run();

  // AUDITED, and the BEFORE value is in the row. "Someone set it to 12%" does
  // not answer "what was it before, and for how long" — which is the question
  // asked when an advisor disputes a quarter. Best-effort, matching the
  // convention elsewhere: the setting has already changed, so a logging hiccup
  // must not imply it has not.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      (admin as any).id, 'advisor_take_rate_update', 'platform',
      JSON.stringify({ from_bps: before.bps, from_source: before.source, to_bps: bps }),
    ).run();
  } catch (e: any) {
    console.warn('[admin_platform] take-rate audit failed:', String(e?.message || e));
  }

  const after = await takeRate(c.env);
  return c.json({
    bps: after.bps,
    pct: after.bps / 100,
    source: after.source,
    updated_at: after.updated_at,
    updated_by: after.updated_by,
    previous_bps: before.bps,
    // SAID ON THE WRITE, not only on the read. An operator who has just
    // changed a rate is exactly the person who might assume it started
    // charging something.
    settlement: settlementMode(c.env),
    applies_from: 'Sessions priced after this change. Lines already recorded keep the rate '
      + 'they were stamped with.',
  });
});

export default r;
